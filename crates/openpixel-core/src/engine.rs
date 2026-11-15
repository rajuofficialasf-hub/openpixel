use crate::capability::{capability, registry, FormatCapability};
use crate::error::{OpenPixelError, Result};
use crate::format::{detect_format, ImageFormat};
use crate::image::{ConvertOptions, ConvertResult, ImageInfo};
use crate::security::{check_dimensions, check_file_size, validate_output_path, EngineConfig};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{DynamicImage, ImageEncoder};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

/// The unified engine interface. Applications (web / desktop / CLI / WASM)
/// must go through this — they never call a codec directly.
pub struct Engine {
    config: EngineConfig,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new(EngineConfig::default())
    }
}

impl Engine {
    pub fn new(config: EngineConfig) -> Self {
        Self { config }
    }

    pub fn config(&self) -> &EngineConfig {
        &self.config
    }

    /// Detect the actual format from magic bytes (never the extension).
    pub fn detect_format(&self, bytes: &[u8]) -> ImageFormat {
        detect_format(bytes)
    }

    pub fn detect_format_from_file(&self, path: &Path) -> Result<ImageFormat> {
        let bytes = self.read_input(path)?;
        let format = detect_format(&bytes);
        if format == ImageFormat::Unknown {
            return Err(OpenPixelError::UnknownFormat);
        }
        Ok(format)
    }

    pub fn get_capabilities(&self) -> Vec<FormatCapability> {
        registry()
    }

    pub fn get_capability(&self, format: ImageFormat) -> Option<FormatCapability> {
        capability(format)
    }

    fn read_input(&self, path: &Path) -> Result<Vec<u8>> {
        let meta = fs::metadata(path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                OpenPixelError::NotFound(path.to_path_buf())
            } else {
                OpenPixelError::Io {
                    path: path.to_path_buf(),
                    source: e,
                }
            }
        })?;
        check_file_size(meta.len(), &self.config)?;
        fs::read(path).map_err(|e| OpenPixelError::Io {
            path: path.to_path_buf(),
            source: e,
        })
    }

    /// Cheap header info: format + dimensions + colour type, without
    /// forcing a full pixel decode where the reader supports it.
    /// Phase 1 uses image-rs `ImageReader`, which reads the header first.
    pub fn get_image_info(&self, path: &Path) -> Result<ImageInfo> {
        let bytes = self.read_input(path)?;
        let format = detect_format(&bytes);
        if format == ImageFormat::Unknown {
            return Err(OpenPixelError::UnknownFormat);
        }
        let cap = capability(format);
        if let Some(c) = &cap {
            if !c.can_decode {
                return Err(OpenPixelError::NotImplemented(format!(
                    "{} is detected but not decodable in this build ({})",
                    format.id(),
                    c.status
                )));
            }
        }
        let image_format = format.to_image_format().ok_or_else(|| {
            OpenPixelError::NotImplemented(format!("no decoder wired for {}", format.id()))
        })?;
        let reader = image::ImageReader::with_format(Cursor::new(&bytes), image_format);
        let (width, height) = reader
            .into_dimensions()
            .map_err(|e| OpenPixelError::Decode(e.to_string()))?;
        check_dimensions(width, height, &self.config)?;
        // Decode once for colour type / alpha — Phase 1 trades a decode
        // for correctness; header-only colour info lands in Phase 4.
        let img = image::ImageReader::with_format(Cursor::new(&bytes), image_format)
            .decode()
            .map_err(|e| OpenPixelError::Decode(e.to_string()))?;
        let color_type = format!("{:?}", img.color()).to_lowercase();
        let has_alpha = img.color().has_alpha();
        let is_animated = format == ImageFormat::Gif;
        Ok(ImageInfo {
            format,
            width,
            height,
            color_type,
            has_alpha,
            file_size_bytes: bytes.len() as u64,
            is_animated,
            frame_count: if is_animated { Some(1) } else { None },
            note: if is_animated {
                Some("animated GIF: Phase 1 decodes the first frame only".to_string())
            } else if format == ImageFormat::Tiff {
                Some("multi-page TIFF: Phase 1 decodes the first page only".to_string())
            } else {
                None
            },
        })
    }

    /// Convert one file. Pipeline (Phase 1):
    /// signature detect -> validate -> decode -> canonical DynamicImage
    /// -> flatten alpha if target lacks it -> encode -> validate output.
    pub fn convert(
        &self,
        input: &Path,
        output: &Path,
        target: ImageFormat,
        options: &ConvertOptions,
    ) -> Result<ConvertResult> {
        let target_cap = capability(target).ok_or_else(|| {
            OpenPixelError::InvalidArgument(format!("unknown target format {target}"))
        })?;
        if !target_cap.can_encode {
            return Err(OpenPixelError::NotImplemented(format!(
                "{} cannot be encoded in this build ({})",
                target.id(),
                target_cap.status
            )));
        }
        validate_output_path(output)?;
        let bytes = self.read_input(input)?;
        let source_format = detect_format(&bytes);
        if source_format == ImageFormat::Unknown {
            return Err(OpenPixelError::UnknownFormat);
        }
        if capability(source_format)
            .map(|c| !c.can_decode)
            .unwrap_or(true)
        {
            return Err(OpenPixelError::NotImplemented(format!(
                "{} is detected but not decodable in this build",
                source_format.id()
            )));
        }
        let source_image_format = source_format.to_image_format().ok_or_else(|| {
            OpenPixelError::NotImplemented(format!("no decoder wired for {}", source_format.id()))
        })?;
        let img = image::ImageReader::with_format(Cursor::new(&bytes), source_image_format)
            .decode()
            .map_err(|e| OpenPixelError::Decode(e.to_string()))?;
        let (width, height) = (img.width(), img.height());
        check_dimensions(width, height, &self.config)?;

        // Flatten alpha for targets without it (JPEG, BMP).
        let img = if !target_cap.supports_alpha && img.color().has_alpha() {
            flatten_alpha(&img, options.background)
        } else {
            img
        };

        if let Some(parent) = output.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|e| OpenPixelError::Io {
                    path: parent.to_path_buf(),
                    source: e,
                })?;
            }
        }
        let mut out: Vec<u8> = Vec::new();
        encode(
            &img,
            target,
            options,
            self.config.default_jpeg_quality,
            &mut out,
        )?;
        // Output validation: re-detect what we just wrote.
        // TGA has no magic bytes, so it cannot be re-detected — for TGA
        // only check that something was written.
        if target == ImageFormat::Tga {
            if out.is_empty() {
                return Err(OpenPixelError::Encode("wrote empty TGA output".to_string()));
            }
        } else {
            let written_format = detect_format(&out);
            if written_format != target {
                return Err(OpenPixelError::Encode(format!(
                    "output validation failed: wrote {written_format}, expected {target}"
                )));
            }
        }
        fs::write(output, &out).map_err(|e| OpenPixelError::Io {
            path: output.to_path_buf(),
            source: e,
        })?;
        Ok(ConvertResult {
            source_format,
            target_format: target,
            width,
            height,
            input_bytes: bytes.len() as u64,
            output_bytes: out.len() as u64,
            output_path: output.to_string_lossy().to_string(),
        })
    }

    /// Infer the target format from the output extension, then convert.
    /// The *source* is still detected by signature, never by extension.
    pub fn convert_to_path(
        &self,
        input: &Path,
        output: &Path,
        options: &ConvertOptions,
    ) -> Result<ConvertResult> {
        let ext = output.extension().and_then(|e| e.to_str()).ok_or_else(|| {
            OpenPixelError::InvalidArgument(
                "output path needs an extension, e.g. output.png".to_string(),
            )
        })?;
        let target = ImageFormat::from_name(ext).ok_or_else(|| {
            OpenPixelError::InvalidArgument(format!("unknown output extension '.{ext}'"))
        })?;
        self.convert(input, output, target, options)
    }
}

fn flatten_alpha(img: &DynamicImage, bg: [u8; 3]) -> DynamicImage {
    let rgba = img.to_rgba8();
    let mut rgb = image::RgbImage::new(rgba.width(), rgba.height());
    for (x, y, px) in rgba.enumerate_pixels() {
        let a = px[3] as f32 / 255.0;
        let blend = |fg: u8, b: u8| ((fg as f32 * a) + (b as f32 * (1.0 - a))).round() as u8;
        rgb.put_pixel(
            x,
            y,
            image::Rgb([
                blend(px[0], bg[0]),
                blend(px[1], bg[1]),
                blend(px[2], bg[2]),
            ]),
        );
    }
    DynamicImage::ImageRgb8(rgb)
}

fn encode(
    img: &DynamicImage,
    target: ImageFormat,
    options: &ConvertOptions,
    default_quality: u8,
    out: &mut Vec<u8>,
) -> Result<()> {
    match target {
        ImageFormat::Jpeg => {
            let rgb = img.to_rgb8();
            let mut cursor = Cursor::new(out);
            let mut encoder =
                JpegEncoder::new_with_quality(&mut cursor, options.jpeg_quality(default_quality));
            encoder
                .encode(
                    &rgb,
                    rgb.width(),
                    rgb.height(),
                    image::ExtendedColorType::Rgb8,
                )
                .map_err(|e| OpenPixelError::Encode(e.to_string()))?;
        }
        ImageFormat::Png => {
            let compression = match options.png_compression.unwrap_or(1) {
                0 => CompressionType::Fast,
                2 => CompressionType::Best,
                _ => CompressionType::Default,
            };
            let mut cursor = Cursor::new(out);
            let encoder =
                PngEncoder::new_with_quality(&mut cursor, compression, FilterType::Adaptive);
            // PngEncoder::encode needs raw bytes + colour type.
            let (data, color) = raw_bytes(img);
            encoder
                .write_image(&data, img.width(), img.height(), color)
                .map_err(|e| OpenPixelError::Encode(e.to_string()))?;
        }
        _ => {
            // BMP / GIF / TIFF / WebP / TGA / ICO / PNM / QOI via image-rs.
            let fmt = target.to_image_format().ok_or_else(|| {
                OpenPixelError::NotImplemented(format!("no encoder wired for {}", target.id()))
            })?;
            let mut cursor = Cursor::new(out);
            img.write_to(&mut cursor, fmt)
                .map_err(|e| OpenPixelError::Encode(e.to_string()))?;
        }
    }
    Ok(())
}

fn raw_bytes(img: &DynamicImage) -> (Vec<u8>, image::ExtendedColorType) {
    use image::ExtendedColorType as C;
    match img.color() {
        image::ColorType::Rgb8 => (img.to_rgb8().into_raw(), C::Rgb8),
        image::ColorType::Rgba8 => (img.to_rgba8().into_raw(), C::Rgba8),
        image::ColorType::L8 => (img.to_luma8().into_raw(), C::L8),
        image::ColorType::La8 => (img.to_luma_alpha8().into_raw(), C::La8),
        image::ColorType::Rgb16 => (
            img.to_rgb16()
                .as_raw()
                .iter()
                .flat_map(|v| v.to_ne_bytes())
                .collect(),
            C::Rgb16,
        ),
        image::ColorType::Rgba16 => (
            img.to_rgba16()
                .as_raw()
                .iter()
                .flat_map(|v| v.to_ne_bytes())
                .collect(),
            C::Rgba16,
        ),
        _ => (img.to_rgba8().into_raw(), C::Rgba8),
    }
}

/// Helper used by tests / CLI to build an output path next to the input.
pub fn default_output_path(input: &Path, target: ImageFormat) -> PathBuf {
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "output".to_string());
    let parent = input.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    parent.join(format!("{stem}.{}", target.extensions()[0]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    fn test_image_rgba() -> DynamicImage {
        let mut im = image::RgbaImage::new(8, 6);
        for (x, y, px) in im.enumerate_pixels_mut() {
            *px = image::Rgba([
                x as u8 * 30,
                y as u8 * 40,
                128,
                if x < 4 { 255 } else { 128 },
            ]);
        }
        DynamicImage::ImageRgba8(im)
    }

    fn test_image_rgb() -> DynamicImage {
        let mut im = RgbImage::new(8, 6);
        for (x, y, px) in im.enumerate_pixels_mut() {
            *px = Rgb([x as u8 * 30, y as u8 * 40, 128]);
        }
        DynamicImage::ImageRgb8(im)
    }

    #[test]
    fn png_roundtrip_preserves_dimensions_and_alpha() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.png");
        let dst = dir.path().join("b.png");
        test_image_rgba().save(&src).unwrap();
        let engine = Engine::default();
        let r = engine
            .convert(&src, &dst, ImageFormat::Png, &ConvertOptions::default())
            .unwrap();
        assert_eq!((r.width, r.height), (8, 6));
        assert_eq!(r.source_format, ImageFormat::Png);
        let info = engine.get_image_info(&dst).unwrap();
        assert!(info.has_alpha);
    }

    #[test]
    fn png_to_jpeg_flattens_alpha_and_detects_by_signature() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.png");
        let dst = dir.path().join("b.jpg");
        test_image_rgba().save(&src).unwrap();
        let engine = Engine::default();
        let r = engine
            .convert(&src, &dst, ImageFormat::Jpeg, &ConvertOptions::default())
            .unwrap();
        assert_eq!(r.target_format, ImageFormat::Jpeg);
        let info = engine.get_image_info(&dst).unwrap();
        assert_eq!(info.format, ImageFormat::Jpeg);
        assert!(!info.has_alpha);
    }

    #[test]
    fn jpeg_to_bmp_and_webp_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.jpg");
        test_image_rgb().save(&src).unwrap();
        let engine = Engine::default();
        for target in [
            ImageFormat::Bmp,
            ImageFormat::Webp,
            ImageFormat::Gif,
            ImageFormat::Tiff,
        ] {
            let dst = dir.path().join(format!("out.{}", target.extensions()[0]));
            let r = engine
                .convert(&src, &dst, target, &ConvertOptions::default())
                .unwrap();
            assert_eq!(r.target_format, target);
            assert_eq!(engine.get_image_info(&dst).unwrap().format, target);
        }
    }

    #[test]
    fn rejects_unknown_format_and_unimplemented_avif() {
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join("bad.bin");
        fs::write(&bad, b"this is not an image at all").unwrap();
        let engine = Engine::default();
        assert!(matches!(
            engine.get_image_info(&bad),
            Err(OpenPixelError::UnknownFormat)
        ));
        let src = dir.path().join("a.png");
        test_image_rgb().save(&src).unwrap();
        let dst = dir.path().join("b.avif");
        assert!(matches!(
            engine.convert(&src, &dst, ImageFormat::Avif, &ConvertOptions::default()),
            Err(OpenPixelError::NotImplemented(_))
        ));
    }

    #[test]
    fn rejects_missing_file() {
        let engine = Engine::default();
        assert!(matches!(
            engine.get_image_info(Path::new("/no/such/file.png")),
            Err(OpenPixelError::NotFound(_))
        ));
    }
}
