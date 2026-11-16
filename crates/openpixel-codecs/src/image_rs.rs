use crate::error::{CodecError, CodecResult};
use crate::traits::{Codec, Decoder, Encoder};
use crate::types::{DecodedImage, EncodeParams, PixelFormat};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::ImageEncoder;
use openpixel_formats::{FormatCapability, ImageFormat, MAX_DIMENSION};
use std::io::Cursor;

/// Map a format to the `image` crate format. This is the ONLY place
/// that mapping lives — `openpixel-formats` stays codec-free.
pub fn to_image_format(format: ImageFormat) -> Option<image::ImageFormat> {
    use image::ImageFormat as F;
    Some(match format {
        ImageFormat::Jpeg => F::Jpeg,
        ImageFormat::Png => F::Png,
        ImageFormat::Bmp => F::Bmp,
        ImageFormat::Gif => F::Gif,
        ImageFormat::Tiff => F::Tiff,
        ImageFormat::Webp => F::WebP,
        ImageFormat::Tga => F::Tga,
        ImageFormat::Ico => F::Ico,
        ImageFormat::Pnm => F::Pnm,
        ImageFormat::Qoi => F::Qoi,
        _ => return None,
    })
}

/// One adapter per format, backed by image-rs 0.25 (pure Rust).
/// A future native codec (libavif, libheif, …) is a second struct
/// implementing the same `Codec` trait — the engine never changes.
pub struct ImageRsCodec {
    format: ImageFormat,
}

impl ImageRsCodec {
    pub fn new(format: ImageFormat) -> Self {
        Self { format }
    }

    /// All formats image-rs handles in this build, in registry order.
    pub fn all() -> Vec<ImageRsCodec> {
        [
            ImageFormat::Jpeg,
            ImageFormat::Png,
            ImageFormat::Bmp,
            ImageFormat::Gif,
            ImageFormat::Tiff,
            ImageFormat::Webp,
            ImageFormat::Tga,
            ImageFormat::Ico,
            ImageFormat::Pnm,
            ImageFormat::Qoi,
        ]
        .into_iter()
        .map(Self::new)
        .collect()
    }
}

impl Decoder for ImageRsCodec {
    fn format(&self) -> ImageFormat {
        self.format
    }

    fn decode(&self, bytes: &[u8]) -> CodecResult<DecodedImage> {
        let image_format = to_image_format(self.format).ok_or_else(|| {
            CodecError::Unsupported(format!("no image-rs decoder for {}", self.format.id()))
        })?;
        let dynamic = image::ImageReader::with_format(Cursor::new(bytes), image_format)
            .decode()
            .map_err(|e| CodecError::Decode(e.to_string()))?;
        let mut img = DecodedImage::from_dynamic(&dynamic);
        if self.format == ImageFormat::Gif {
            img.is_animated = true;
            img.frame_count = Some(1);
            img.note = Some(
                "animated GIF: plain decode is the first frame only — use `openpixel frames` / `extract-frame` for the full animation (Phase 5)".to_string(),
            );
        } else if self.format == ImageFormat::Tiff {
            img.note = Some(
                "multi-page TIFF: plain decode is the first page only — use `openpixel frames` / `extract-frame` for all pages (Phase 5)".to_string(),
            );
        }
        Ok(img)
    }

    fn dimensions(&self, bytes: &[u8]) -> CodecResult<(u32, u32)> {
        let image_format = to_image_format(self.format).ok_or_else(|| {
            CodecError::Unsupported(format!("no image-rs decoder for {}", self.format.id()))
        })?;
        image::ImageReader::with_format(Cursor::new(bytes), image_format)
            .into_dimensions()
            .map_err(|e| CodecError::Decode(e.to_string()))
    }
}

impl Encoder for ImageRsCodec {
    fn encode(&self, image: &DecodedImage, params: &EncodeParams) -> CodecResult<Vec<u8>> {
        // Flatten alpha for targets without it, inside the codec —
        // the engine no longer needs to know which formats lack alpha.
        let cap = self.capability();
        let owned;
        let image = if !cap.supports_alpha && image.has_alpha() {
            owned = image.flatten_alpha(params.background);
            &owned
        } else {
            image
        };
        // ICO: image-rs writes the input's colour type as the embedded
        // PNG, and its own ICO decoder only accepts RGBA PNGs — an RGB
        // source produced an ICO the engine could not read back
        // ("The PNG is not in RGBA format!", found 16 Nov 2026 via
        // `openpixel info` on an RGB-source ICO). Normalise to RGBA8
        // first; ICO supports alpha, so nothing is lost (opaque
        // pixels get alpha 255).
        let owned_rgba;
        let image = if self.format == ImageFormat::Ico
            && image.pixel_format != PixelFormat::Rgba8
        {
            owned_rgba = DecodedImage {
                width: image.width,
                height: image.height,
                pixel_format: PixelFormat::Rgba8,
                data: image.to_rgba8(),
                is_animated: image.is_animated,
                frame_count: image.frame_count,
                note: image.note.clone(),
            };
            &owned_rgba
        } else {
            image
        };
        let mut out: Vec<u8> = Vec::new();
        match self.format {
            ImageFormat::Jpeg => {
                let rgb = image.to_dynamic().to_rgb8();
                let mut cursor = Cursor::new(&mut out);
                let mut encoder =
                    JpegEncoder::new_with_quality(&mut cursor, params.jpeg_quality(85));
                encoder
                    .encode(
                        &rgb,
                        rgb.width(),
                        rgb.height(),
                        image::ExtendedColorType::Rgb8,
                    )
                    .map_err(|e| CodecError::Encode(e.to_string()))?;
            }
            ImageFormat::Png => {
                let compression = match params.png_compression.unwrap_or(1) {
                    0 => CompressionType::Fast,
                    2 => CompressionType::Best,
                    _ => CompressionType::Default,
                };
                let mut cursor = Cursor::new(&mut out);
                let encoder =
                    PngEncoder::new_with_quality(&mut cursor, compression, FilterType::Adaptive);
                let (data, color) = raw_bytes(image);
                encoder
                    .write_image(&data, image.width, image.height, color)
                    .map_err(|e| CodecError::Encode(e.to_string()))?;
            }
            _ => {
                let fmt = to_image_format(self.format).ok_or_else(|| {
                    CodecError::Unsupported(format!("no image-rs encoder for {}", self.format.id()))
                })?;
                let mut cursor = Cursor::new(&mut out);
                image
                    .to_dynamic()
                    .write_to(&mut cursor, fmt)
                    .map_err(|e| CodecError::Encode(e.to_string()))?;
            }
        }
        Ok(out)
    }
}

fn raw_bytes(image: &DecodedImage) -> (Vec<u8>, image::ExtendedColorType) {
    use image::ExtendedColorType as C;
    match image.pixel_format {
        PixelFormat::Rgb8 => (image.data.clone(), C::Rgb8),
        PixelFormat::Rgba8 => (image.data.clone(), C::Rgba8),
        PixelFormat::Luma8 => (image.data.clone(), C::L8),
        PixelFormat::LumaAlpha8 => (image.data.clone(), C::La8),
        PixelFormat::Rgb16 => (image.data.clone(), C::Rgb16),
        PixelFormat::Rgba16 => (image.data.clone(), C::Rgba16),
    }
}

impl Codec for ImageRsCodec {
    fn capability(&self) -> FormatCapability {
        let f = self.format;
        let (alpha, anim, meta, icc, multi, note) = match f {
            ImageFormat::Jpeg => (false, false, true, true, false, "implemented"),
            ImageFormat::Png => (
                true,
                false,
                true,
                true,
                true,
                "implemented — APNG: frame info in Phase 5; plain decode is the first frame only",
            ),
            ImageFormat::Bmp => (false, false, false, false, false, "implemented"),
            ImageFormat::Gif => (
                true,
                true,
                false,
                false,
                true,
                "implemented — animation: frame enumeration + extraction in Phase 5; plain decode is the first frame only",
            ),
            ImageFormat::Tiff => (
                true,
                false,
                true,
                true,
                true,
                "implemented — multi-page: page count + extraction in Phase 5; plain decode is the first page only",
            ),
            ImageFormat::Webp => (
                true,
                true,
                false,
                false,
                true,
                "implemented — animated WebP: frame info in Phase 5; plain decode is the first frame only",
            ),
            _ => (true, false, false, false, false, "implemented"),
        };
        FormatCapability::new(
            f.id(),
            f.extensions().to_vec(),
            f.mime_types().to_vec(),
            true,
            true,
            alpha,
            anim,
            meta,
            icc,
            multi,
            "image-rs 0.25 (pure Rust)",
            "MIT OR Apache-2.0",
            note,
            MAX_DIMENSION,
        )
    }
}
