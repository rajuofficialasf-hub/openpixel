use crate::error::{OpenPixelError, Result};
use crate::image::{ConvertOptions, ConvertResult, ImageInfo, ProcessOptions};
use crate::security::{check_dimensions, check_file_size, validate_output_path, EngineConfig};
use openpixel_codecs::{CodecRegistry, DecodedImage};
use openpixel_formats::{detect_format, discover, DiscoveryResult, FormatCapability, ImageFormat};
use std::fs;
use std::path::{Path, PathBuf};

/// The unified engine interface. Applications (web / desktop / CLI / WASM)
/// must go through this — they never call a codec directly.
///
/// Phase 2: the engine owns a [`CodecRegistry`] and asks it for the
/// codec for a format. It holds no format list and no codec code of
/// its own. To add a format, register a codec — the engine, the CLI
/// and the capability listing all follow automatically.
pub struct Engine {
    config: EngineConfig,
    registry: CodecRegistry,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new(EngineConfig::default())
    }
}

impl Engine {
    pub fn new(config: EngineConfig) -> Self {
        Self {
            config,
            registry: CodecRegistry::default(),
        }
    }

    /// Build an engine over a custom registry — how tests inject a
    /// fake codec, and how Phase 3 will inject a native codec.
    pub fn with_registry(config: EngineConfig, registry: CodecRegistry) -> Self {
        Self { config, registry }
    }

    pub fn config(&self) -> &EngineConfig {
        &self.config
    }

    pub fn registry(&self) -> &CodecRegistry {
        &self.registry
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

    /// Full discovery: signature first, extension/MIME only as a
    /// low-confidence fallback, with mismatch reporting.
    /// `extension` is the file extension without the dot, if any.
    pub fn discover_format(
        &self,
        bytes: &[u8],
        extension: Option<&str>,
        mime: Option<&str>,
    ) -> DiscoveryResult {
        discover(bytes, extension, mime)
    }

    /// Capabilities are built by the registry from the codecs actually
    /// registered — never a hard-coded list.
    pub fn get_capabilities(&self) -> Vec<FormatCapability> {
        self.registry.capabilities()
    }

    pub fn get_capability(&self, format: ImageFormat) -> Option<FormatCapability> {
        self.registry.capability(format)
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

    /// Read a file, detect its format by signature and decode it to
    /// the canonical `DecodedImage`. The CLI uses this to load a
    /// watermark image; `process` uses it for the source image.
    pub fn decode_file(&self, path: &Path) -> Result<DecodedImage> {
        let (_, img, _) = self.read_and_decode(path)?;
        Ok(img)
    }

    /// Shared decode path: read -> signature detect -> registry
    /// lookup -> decode -> dimension limits. Returns the detected
    /// format, the image, and the input byte count.
    fn read_and_decode(&self, path: &Path) -> Result<(ImageFormat, DecodedImage, u64)> {
        let bytes = self.read_input(path)?;
        let format = detect_format(&bytes);
        if format == ImageFormat::Unknown {
            return Err(OpenPixelError::UnknownFormat);
        }
        let codec = self.registry.get(format).ok_or_else(|| {
            let status = self
                .registry
                .capability(format)
                .map(|c| c.status.to_string())
                .unwrap_or_else(|| "not implemented".to_string());
            OpenPixelError::NotImplemented(format!(
                "{format} is detected but not decodable in this build ({status})",
                format = format.id()
            ))
        })?;
        // Header-only dimensions where the codec supports it, then a
        // full decode for colour type / alpha — Phase 2 trades a decode
        // for correctness; header-only colour info lands in Phase 4.
        let (width, height) = codec.dimensions(&bytes)?;
        check_dimensions(width, height, &self.config)?;
        let img = codec.decode(&bytes)?;
        check_dimensions(img.width, img.height, &self.config)?;
        Ok((format, img, bytes.len() as u64))
    }

    pub fn get_image_info(&self, path: &Path) -> Result<ImageInfo> {
        let (format, img, file_size_bytes) = self.read_and_decode(path)?;
        Ok(ImageInfo {
            format,
            width: img.width,
            height: img.height,
            color_type: img.pixel_format.name().to_string(),
            has_alpha: img.has_alpha(),
            file_size_bytes,
            is_animated: img.is_animated,
            frame_count: img.frame_count,
            note: img.note,
        })
    }

    /// Convert one file. Pipeline (Phase 2):
    /// signature detect -> registry lookup (source + target) ->
    /// decode via source codec -> canonical `DecodedImage` ->
    /// encode via target codec (alpha flattening inside the codec) ->
    /// output validation (re-detect what was written).
    pub fn convert(
        &self,
        input: &Path,
        output: &Path,
        target: ImageFormat,
        options: &ConvertOptions,
    ) -> Result<ConvertResult> {
        let (source_format, img, input_bytes) = self.read_and_decode(input)?;
        self.encode_and_write(&img, source_format, input_bytes, target, output, options)
    }

    /// Convert one file with a processing pipeline in between:
    /// decode -> pipeline (in order) -> encode. An empty pipeline
    /// behaves exactly like [`Engine::convert`]. Pipeline errors
    /// (crop out of bounds, resize to 0, oversize result) are typed
    /// errors, raised before anything is written.
    pub fn process(
        &self,
        input: &Path,
        output: &Path,
        target: ImageFormat,
        options: &ProcessOptions,
    ) -> Result<ConvertResult> {
        let (source_format, img, input_bytes) = self.read_and_decode(input)?;
        let processed = options.pipeline.apply(&img)?;
        check_dimensions(processed.width, processed.height, &self.config)?;
        self.encode_and_write(
            &processed,
            source_format,
            input_bytes,
            target,
            output,
            &options.convert,
        )
    }

    /// Alias for [`Engine::process`], named after what it does for
    /// callers that think in conversions rather than processing.
    pub fn convert_with_pipeline(
        &self,
        input: &Path,
        output: &Path,
        target: ImageFormat,
        options: &ProcessOptions,
    ) -> Result<ConvertResult> {
        self.process(input, output, target, options)
    }

    /// Infer the target format from the output extension, then
    /// convert. The *source* is still detected by signature, never
    /// by extension.
    pub fn convert_to_path(
        &self,
        input: &Path,
        output: &Path,
        options: &ConvertOptions,
    ) -> Result<ConvertResult> {
        let target = target_from_output_path(output)?;
        self.convert(input, output, target, options)
    }

    /// Like [`Engine::convert_to_path`], but with a pipeline.
    pub fn process_to_path(
        &self,
        input: &Path,
        output: &Path,
        options: &ProcessOptions,
    ) -> Result<ConvertResult> {
        let target = target_from_output_path(output)?;
        self.process(input, output, target, options)
    }

    /// Shared tail of `convert` / `process`: target capability check
    /// -> encode via the target codec -> output validation
    /// (re-detect what was written) -> write the file.
    fn encode_and_write(
        &self,
        img: &DecodedImage,
        source_format: ImageFormat,
        input_bytes: u64,
        target: ImageFormat,
        output: &Path,
        options: &ConvertOptions,
    ) -> Result<ConvertResult> {
        let target_cap = self.registry.capability(target).ok_or_else(|| {
            OpenPixelError::InvalidArgument(format!("unknown target format {target}"))
        })?;
        if !target_cap.can_encode {
            return Err(OpenPixelError::NotImplemented(format!(
                "{} cannot be encoded in this build ({})",
                target.id(),
                target_cap.status
            )));
        }
        let target_codec = self.registry.get(target).ok_or_else(|| {
            OpenPixelError::NotImplemented(format!("no encoder registered for {}", target.id()))
        })?;
        validate_output_path(output)?;
        if let Some(parent) = output.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|e| OpenPixelError::Io {
                    path: parent.to_path_buf(),
                    source: e,
                })?;
            }
        }
        let mut params = options.to_encode_params();
        if params.quality.is_none() {
            params.quality = Some(self.config.default_jpeg_quality);
        }
        let out = target_codec.encode(img, &params)?;
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
            width: img.width,
            height: img.height,
            input_bytes,
            output_bytes: out.len() as u64,
            output_path: output.to_string_lossy().to_string(),
        })
    }
}

/// Target format from an output path's extension.
fn target_from_output_path(output: &Path) -> Result<ImageFormat> {
    let ext = output.extension().and_then(|e| e.to_str()).ok_or_else(|| {
        OpenPixelError::InvalidArgument(
            "output path needs an extension, e.g. output.png".to_string(),
        )
    })?;
    ImageFormat::from_name(ext).ok_or_else(|| {
        OpenPixelError::InvalidArgument(format!("unknown output extension '.{ext}'"))
    })
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
    use image::{DynamicImage, Rgb, RgbImage};

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
    fn rejects_unknown_format_and_unimplemented_heic() {
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
        let dst = dir.path().join("b.heic");
        assert!(matches!(
            engine.convert(&src, &dst, ImageFormat::Heic, &ConvertOptions::default()),
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

    #[test]
    fn capabilities_come_from_the_registry() {
        let engine = Engine::default();
        let caps = engine.get_capabilities();
        assert_eq!(caps.len(), 21);
        assert_eq!(caps.iter().filter(|c| c.can_encode).count(), 15);
        // Removing a codec removes it from the capability list too.
        let mut registry = CodecRegistry::default();
        registry.remove(ImageFormat::Webp);
        let engine = Engine::with_registry(EngineConfig::default(), registry);
        assert_eq!(engine.get_capabilities().len(), 20);
        assert!(engine.get_capability(ImageFormat::Webp).is_none());
        let src_dir = tempfile::tempdir().unwrap();
        let src = src_dir.path().join("a.png");
        test_image_rgb().save(&src).unwrap();
        let dst = src_dir.path().join("b.webp");
        assert!(engine
            .convert(&src, &dst, ImageFormat::Webp, &ConvertOptions::default())
            .is_err());
    }

    #[test]
    fn svg_source_converts_to_png_and_avif_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let svg = dir.path().join("a.svg");
        fs::write(
            &svg,
            b"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"6\"><rect width=\"8\" height=\"6\" fill=\"#ff0000\"/></svg>",
        )
        .unwrap();
        let engine = Engine::default();
        // SVG is detected by the strict start-of-file sniff.
        let info = engine.get_image_info(&svg).unwrap();
        assert_eq!(info.format, ImageFormat::Svg);
        assert_eq!((info.width, info.height), (8, 6));
        let png = dir.path().join("b.png");
        let r = engine
            .convert(&svg, &png, ImageFormat::Png, &ConvertOptions::default())
            .unwrap();
        assert_eq!(r.source_format, ImageFormat::Svg);
        assert_eq!(r.target_format, ImageFormat::Png);

        // PNG -> AVIF -> PNG through the engine, with output validation.
        let src = dir.path().join("c.png");
        test_image_rgb().save(&src).unwrap();
        let avif = dir.path().join("d.avif");
        engine
            .convert(&src, &avif, ImageFormat::Avif, &ConvertOptions::default())
            .unwrap();
        assert_eq!(
            engine.get_image_info(&avif).unwrap().format,
            ImageFormat::Avif
        );
        let back = dir.path().join("e.png");
        engine
            .convert(&avif, &back, ImageFormat::Png, &ConvertOptions::default())
            .unwrap();
        assert_eq!(
            engine.get_image_info(&back).unwrap().format,
            ImageFormat::Png
        );
    }

    #[test]
    fn process_resize_grayscale_rotate_combined() {
        use crate::{Operation, Pipeline, ProcessOptions};
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.png");
        test_image_rgb().save(&src).unwrap();
        let dst = dir.path().join("b.png");
        let engine = Engine::default();
        // 8x6 -> resize 4x3 -> rotate 90 (3x4) -> grayscale.
        let pipeline = Pipeline::from_operations(vec![
            Operation::Resize {
                width: 4,
                height: 3,
            },
            Operation::Rotate90,
            Operation::Grayscale,
        ]);
        let opts = ProcessOptions::new(ConvertOptions::default(), pipeline);
        let r = engine.process(&src, &dst, ImageFormat::Png, &opts).unwrap();
        assert_eq!((r.width, r.height), (3, 4));
        let info = engine.get_image_info(&dst).unwrap();
        assert_eq!((info.width, info.height), (3, 4));
        assert_eq!(info.color_type, "luma8");
        // Every output pixel must be grey.
        let decoded = engine.decode_file(&dst).unwrap();
        let rgba = decoded.to_rgba8();
        for px in rgba.as_chunks::<4>().0 {
            assert_eq!(px[0], px[1]);
            assert_eq!(px[1], px[2]);
        }
    }

    #[test]
    fn process_empty_pipeline_matches_convert_and_alias_works() {
        use crate::{Operation, Pipeline, ProcessOptions};
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.png");
        test_image_rgb().save(&src).unwrap();
        let engine = Engine::default();
        let empty = ProcessOptions::default();
        assert!(empty.pipeline.is_empty());
        let dst = dir.path().join("b.png");
        let r = engine
            .process(&src, &dst, ImageFormat::Png, &empty)
            .unwrap();
        assert_eq!((r.width, r.height), (8, 6));
        // convert_with_pipeline is the same call under the other name.
        let dst2 = dir.path().join("c.jpg");
        let opts = ProcessOptions::new(
            ConvertOptions::default(),
            Pipeline::from_operations(vec![Operation::FlipHorizontal]),
        );
        let r2 = engine
            .convert_with_pipeline(&src, &dst2, ImageFormat::Jpeg, &opts)
            .unwrap();
        assert_eq!(r2.target_format, ImageFormat::Jpeg);
        // process_to_path infers the target from the extension.
        let dst3 = dir.path().join("d.webp");
        let r3 = engine.process_to_path(&src, &dst3, &opts).unwrap();
        assert_eq!(r3.target_format, ImageFormat::Webp);
    }

    #[test]
    fn process_rejects_bad_pipeline_before_writing() {
        use crate::{Operation, Pipeline, ProcessOptions};
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.png");
        test_image_rgb().save(&src).unwrap();
        let dst = dir.path().join("b.png");
        let engine = Engine::default();
        let opts = ProcessOptions::new(
            ConvertOptions::default(),
            Pipeline::from_operations(vec![Operation::Crop {
                x: 0,
                y: 0,
                width: 99,
                height: 99,
            }]),
        );
        assert!(matches!(
            engine.process(&src, &dst, ImageFormat::Png, &opts),
            Err(OpenPixelError::InvalidArgument(_))
        ));
        assert!(!dst.exists(), "failed process must not write output");
        let opts = ProcessOptions::new(
            ConvertOptions::default(),
            Pipeline::from_operations(vec![Operation::Resize {
                width: 0,
                height: 10,
            }]),
        );
        assert!(engine.process(&src, &dst, ImageFormat::Png, &opts).is_err());
    }

    #[test]
    fn decode_file_returns_decoded_image() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.png");
        test_image_rgba().save(&src).unwrap();
        let engine = Engine::default();
        let img = engine.decode_file(&src).unwrap();
        assert_eq!((img.width, img.height), (8, 6));
        assert!(img.has_alpha());
    }

    #[test]
    fn discovery_reports_a_lying_extension() {
        let engine = Engine::default();
        let png = b"\x89PNG\r\n\x1A\nxxxx";
        let r = engine.discover_format(png, Some("jpg"), None);
        assert_eq!(r.format, ImageFormat::Png);
        assert!(r.has_mismatch());
    }
}
