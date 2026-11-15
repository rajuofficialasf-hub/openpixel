use serde::{Deserialize, Serialize};

/// Canonical pixel format. This is the engine's own vocabulary — no
/// `image` crate type leaks through the Codec trait boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PixelFormat {
    Rgb8,
    Rgba8,
    Luma8,
    LumaAlpha8,
    Rgb16,
    Rgba16,
}

impl PixelFormat {
    pub fn has_alpha(self) -> bool {
        matches!(self, Self::Rgba8 | Self::LumaAlpha8 | Self::Rgba16)
    }
    pub fn channels(self) -> usize {
        match self {
            Self::Rgb8 | Self::Rgb16 => 3,
            Self::Rgba8 | Self::Rgba16 => 4,
            Self::Luma8 => 1,
            Self::LumaAlpha8 => 2,
        }
    }
    pub fn bytes_per_pixel(self) -> usize {
        match self {
            Self::Rgb8 => 3,
            Self::Rgba8 => 4,
            Self::Luma8 => 1,
            Self::LumaAlpha8 => 2,
            Self::Rgb16 => 6,
            Self::Rgba16 => 8,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Rgb8 => "rgb8",
            Self::Rgba8 => "rgba8",
            Self::Luma8 => "luma8",
            Self::LumaAlpha8 => "luma_alpha8",
            Self::Rgb16 => "rgb16",
            Self::Rgba16 => "rgba16",
        }
    }
}

/// The canonical decoded image every codec must produce. One frame only
/// in Phase 2 — animation frames are a Phase 5 concern, and `note`
/// says so when the source had more frames.
#[derive(Debug, Clone)]
pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    pub pixel_format: PixelFormat,
    /// Raw pixel bytes, row-major, in `pixel_format` order.
    /// 16-bit formats store little-endian (native-endian) u16s.
    pub data: Vec<u8>,
    pub is_animated: bool,
    pub frame_count: Option<u32>,
    pub note: Option<String>,
}

impl DecodedImage {
    pub fn has_alpha(&self) -> bool {
        self.pixel_format.has_alpha()
    }

    /// Flatten alpha onto a background colour, producing an RGB8 image.
    /// Used when the target format has no alpha (JPEG, BMP).
    pub fn flatten_alpha(&self, background: [u8; 3]) -> DecodedImage {
        let rgba = self.to_rgba8();
        let mut rgb = Vec::with_capacity((self.width * self.height * 3) as usize);
        for px in rgba.as_chunks::<4>().0 {
            let a = px[3] as f32 / 255.0;
            for (i, &b) in background.iter().enumerate() {
                let v = (px[i] as f32 * a) + (b as f32 * (1.0 - a));
                rgb.push(v.round() as u8);
            }
        }
        DecodedImage {
            width: self.width,
            height: self.height,
            pixel_format: PixelFormat::Rgb8,
            data: rgb,
            is_animated: self.is_animated,
            frame_count: self.frame_count,
            note: self.note.clone(),
        }
    }

    pub fn to_rgba8(&self) -> Vec<u8> {
        match self.pixel_format {
            PixelFormat::Rgba8 => self.data.clone(),
            PixelFormat::Rgb8 => self
                .data
                .as_chunks::<3>()
                .0
                .iter()
                .flat_map(|p| [p[0], p[1], p[2], 255])
                .collect(),
            PixelFormat::Luma8 => self.data.iter().flat_map(|&v| [v, v, v, 255]).collect(),
            PixelFormat::LumaAlpha8 => self
                .data
                .as_chunks::<2>()
                .0
                .iter()
                .flat_map(|p| [p[0], p[0], p[0], p[1]])
                .collect(),
            // 16-bit: drop to 8-bit by taking the high byte of each u16
            // (little-endian storage, so byte 1 of each 2-byte pair).
            PixelFormat::Rgb16 => self
                .data
                .as_chunks::<6>()
                .0
                .iter()
                .flat_map(|p| [p[1], p[3], p[5], 255])
                .collect(),
            PixelFormat::Rgba16 => self
                .data
                .as_chunks::<8>()
                .0
                .iter()
                .flat_map(|p| [p[1], p[3], p[5], p[7]])
                .collect(),
        }
    }

    /// Rebuild an `image` crate image. 16-bit handling is lossy in the
    /// Rgb16 branch (high byte only) — see `to_rgba8`; full 16-bit
    /// round-tripping is tracked for Phase 4.
    pub fn to_dynamic(&self) -> image::DynamicImage {
        use image::DynamicImage;
        match self.pixel_format {
            PixelFormat::Rgb8 => DynamicImage::ImageRgb8(
                image::RgbImage::from_raw(self.width, self.height, self.data.clone())
                    .unwrap_or_else(|| image::RgbImage::new(self.width, self.height)),
            ),
            PixelFormat::Rgba8 => DynamicImage::ImageRgba8(
                image::RgbaImage::from_raw(self.width, self.height, self.data.clone())
                    .unwrap_or_else(|| image::RgbaImage::new(self.width, self.height)),
            ),
            PixelFormat::Luma8 => DynamicImage::ImageLuma8(
                image::GrayImage::from_raw(self.width, self.height, self.data.clone())
                    .unwrap_or_else(|| image::GrayImage::new(self.width, self.height)),
            ),
            PixelFormat::LumaAlpha8 => DynamicImage::ImageLumaA8(
                image::GrayAlphaImage::from_raw(self.width, self.height, self.data.clone())
                    .unwrap_or_else(|| image::GrayAlphaImage::new(self.width, self.height)),
            ),
            PixelFormat::Rgb16 => {
                let raw: Vec<u16> = self
                    .data
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|c| u16::from_ne_bytes([c[0], c[1]]))
                    .collect();
                DynamicImage::ImageRgb16(
                    image::ImageBuffer::from_raw(self.width, self.height, raw)
                        .unwrap_or_else(|| image::ImageBuffer::new(self.width, self.height)),
                )
            }
            PixelFormat::Rgba16 => {
                let raw: Vec<u16> = self
                    .data
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|c| u16::from_ne_bytes([c[0], c[1]]))
                    .collect();
                DynamicImage::ImageRgba16(
                    image::ImageBuffer::from_raw(self.width, self.height, raw)
                        .unwrap_or_else(|| image::ImageBuffer::new(self.width, self.height)),
                )
            }
        }
    }

    pub fn from_dynamic(img: &image::DynamicImage) -> DecodedImage {
        use image::ColorType;
        let (pixel_format, data) = match img.color() {
            ColorType::Rgb8 => (PixelFormat::Rgb8, img.to_rgb8().into_raw()),
            ColorType::Rgba8 => (PixelFormat::Rgba8, img.to_rgba8().into_raw()),
            ColorType::L8 => (PixelFormat::Luma8, img.to_luma8().into_raw()),
            ColorType::La8 => (PixelFormat::LumaAlpha8, img.to_luma_alpha8().into_raw()),
            ColorType::Rgb16 => (
                PixelFormat::Rgb16,
                img.to_rgb16()
                    .as_raw()
                    .iter()
                    .flat_map(|v| v.to_ne_bytes())
                    .collect(),
            ),
            ColorType::Rgba16 => (
                PixelFormat::Rgba16,
                img.to_rgba16()
                    .as_raw()
                    .iter()
                    .flat_map(|v| v.to_ne_bytes())
                    .collect(),
            ),
            _ => (PixelFormat::Rgba8, img.to_rgba8().into_raw()),
        };
        DecodedImage {
            width: img.width(),
            height: img.height(),
            pixel_format,
            data,
            is_animated: false,
            frame_count: None,
            note: None,
        }
    }
}

/// Format-specific encode parameters. A codec honours only the fields
/// that apply to it — JPEG quality must never silently change a PNG.
#[derive(Debug, Clone, Copy)]
pub struct EncodeParams {
    /// 1..=100, JPEG (and later WebP/AVIF). `None` = codec default.
    pub quality: Option<u8>,
    /// PNG: 0=fast, 1=default, 2=best.
    pub png_compression: Option<u8>,
    /// Background for flattening alpha when the target has no alpha.
    pub background: [u8; 3],
}

impl Default for EncodeParams {
    fn default() -> Self {
        Self {
            quality: None,
            png_compression: None,
            background: [255, 255, 255],
        }
    }
}

impl EncodeParams {
    pub fn jpeg_quality(&self, default: u8) -> u8 {
        self.quality.unwrap_or(default).clamp(1, 100)
    }
}
