//! The shared processing contract (Studio Phase 1).
//!
//! Every engine — image, PDF, OCR, documents — implements
//! [`ProcessingEngine`]. The trait is deliberately small and
//! byte-oriented: engines take input bytes and return output bytes
//! (or engine-specific info), so the jobs pool, the CLI and the
//! future API can drive any engine through one interface.
//!
//! **Name note:** [`Engine`] also has inherent file-based methods
//! named `process`/`convert` (they take input/output *paths*).
//! The trait methods here take input *bytes*. When both are in
//! scope, call the trait method fully qualified —
//! `ProcessingEngine::process(&engine, bytes, target, options)` —
//! or the compiler will pick the inherent one.
//!
//! Honesty rule, built into the contract: a method may return
//! [`OpenPixelError::NotImplemented`] with a reason when an
//! operation is not available for that engine *yet* (e.g. PDF
//! compression before Phase 3). It must never fake success —
//! `health_check` reports exactly which operations are real, and
//! callers must surface that instead of pretending.
//!
//! Associated types keep each engine's options/info/output
//! strongly typed: the image engine's `Options` is
//! [`ProcessOptions`], the PDF engine's is `PdfOptions` (see
//! `openpixel-pdf`), and neither leaks into the other.

use crate::engine::Engine;
use crate::error::{OpenPixelError, Result};
use crate::image::{ConvertOptions, ConvertResult, ImageInfo, ProcessOptions};
use crate::security::check_file_size;
use openpixel_formats::{detect_format, ImageFormat};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// How aggressively an engine should shrink its output. The exact
/// meaning is per-engine and documented on each implementation:
/// for images, `Lossless` re-encodes at best quality/compression,
/// `Balanced` and `Aggressive` lower the lossy quality.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OptimizeLevel {
    Lossless,
    Balanced,
    Aggressive,
}

/// One line of a health check: what was checked and whether it is
/// actually available.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthDetail {
    pub name: String,
    pub ok: bool,
    pub note: String,
}

/// What `health_check` reports for one engine. `ok` is false when
/// the engine cannot do its core work at all (e.g. no codecs
/// registered); individual operations are listed in `details`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineHealth {
    pub engine: &'static str,
    pub ok: bool,
    pub details: Vec<HealthDetail>,
}

/// The shared processing contract. `Options`, `Info` and `Output`
/// are engine-specific; the method *shapes* are shared.
pub trait ProcessingEngine {
    type Options: Default;
    type Info;
    type Output;

    /// Short engine id, e.g. `"image"`, `"pdf"`, `"ocr"`.
    fn name(&self) -> &'static str;

    /// Validate input bytes without processing them: signature
    /// check, size limits, malformed-input detection. Must be
    /// cheap and must not decode the whole input.
    fn validate(&self, bytes: &[u8]) -> Result<()>;

    /// Inspect input without full processing: format, dimensions /
    /// page count, metadata summary.
    fn inspect(&self, bytes: &[u8]) -> Result<Self::Info>;

    /// Process input bytes into the engine's output. `target` is a
    /// format id the engine understands (e.g. `"jpeg"` for images,
    /// `"pdf"` for documents); unknown targets are a
    /// `NotImplemented` error, never a silent substitution.
    fn process(&self, bytes: &[u8], target: &str, options: &Self::Options) -> Result<Self::Output>;

    /// Shrink the input in its own format (re-encode at a lower
    /// quality / better compression, per `level`). Lossless input
    /// stays lossless where the format allows it; lossy input is
    /// re-encoded and the docs must say so.
    fn optimize(&self, bytes: &[u8], level: OptimizeLevel) -> Result<Vec<u8>>;

    /// Write processed bytes to `path` (path-traversal checked).
    /// Returns the bytes written. The default implementation just
    /// validates the path and writes; engines may override it to
    /// add output validation.
    fn export(&self, bytes: &[u8], path: &Path) -> Result<u64> {
        let safe = crate::security::validate_output_path(path)?;
        fs::write(&safe, bytes).map_err(|e| OpenPixelError::Io {
            path: safe.to_path_buf(),
            source: e,
        })?;
        Ok(bytes.len() as u64)
    }

    /// Report whether this engine can do its core work, and which
    /// operations are actually available.
    fn health_check(&self) -> EngineHealth;
}

impl ProcessingEngine for Engine {
    type Options = ProcessOptions;
    type Info = ImageInfo;
    type Output = (ConvertResult, Vec<u8>);

    fn name(&self) -> &'static str {
        "image"
    }

    fn validate(&self, bytes: &[u8]) -> Result<()> {
        check_file_size(bytes.len() as u64, self.config())?;
        if detect_format(bytes) == ImageFormat::Unknown {
            return Err(OpenPixelError::UnknownFormat);
        }
        Ok(())
    }

    fn inspect(&self, bytes: &[u8]) -> Result<ImageInfo> {
        self.get_image_info_bytes(bytes)
    }

    fn process(
        &self,
        bytes: &[u8],
        target: &str,
        options: &ProcessOptions,
    ) -> Result<(ConvertResult, Vec<u8>)> {
        let format = ImageFormat::from_name(target).ok_or_else(|| {
            OpenPixelError::NotImplemented(format!(
                "unknown image target format '{target}' — see `openpixel formats`"
            ))
        })?;
        self.process_bytes(bytes, format, options)
    }

    fn optimize(&self, bytes: &[u8], level: OptimizeLevel) -> Result<Vec<u8>> {
        let source = detect_format(bytes);
        if source == ImageFormat::Unknown {
            return Err(OpenPixelError::UnknownFormat);
        }
        if !self
            .registry()
            .capability(source)
            .map(|c| c.can_encode)
            .unwrap_or(false)
        {
            return Err(OpenPixelError::NotImplemented(format!(
                "{source} is decode-only — it cannot be re-encoded, so optimize has nothing to do"
            )));
        }
        // Re-encode in the source format. For JPEG the quality is
        // the lever (100/80/60); for PNG the compression level is
        // (always best — PNG is lossless, so "aggressive" cannot
        // mean anything else); for other encodable formats the
        // quality lever applies where the codec honours it.
        let mut options = ConvertOptions::default();
        match level {
            OptimizeLevel::Lossless => {
                options.quality = Some(100);
                options.png_compression = Some(2);
            }
            OptimizeLevel::Balanced => {
                options.quality = Some(80);
                options.png_compression = Some(1);
            }
            OptimizeLevel::Aggressive => {
                options.quality = Some(60);
                options.png_compression = Some(2);
            }
        }
        let (_, out) = self.convert_bytes(bytes, source, &options)?;
        Ok(out)
    }

    fn health_check(&self) -> EngineHealth {
        let capabilities = self.get_capabilities();
        let encodable = capabilities.iter().filter(|c| c.can_encode).count();
        let decodable = capabilities.iter().filter(|c| c.can_decode).count();
        EngineHealth {
            engine: "image",
            ok: !capabilities.is_empty() && encodable > 0,
            details: vec![
                HealthDetail {
                    name: "codecs registered".to_string(),
                    ok: !capabilities.is_empty(),
                    note: format!("{} formats known", capabilities.len()),
                },
                HealthDetail {
                    name: "decode".to_string(),
                    ok: decodable > 0,
                    note: format!("{decodable} formats decodable"),
                },
                HealthDetail {
                    name: "encode".to_string(),
                    ok: encodable > 0,
                    note: format!("{encodable} formats encodable"),
                },
                HealthDetail {
                    name: "processing timeout".to_string(),
                    ok: true,
                    note: format!(
                        "{}s per call (jobs pool / CLI enforced; see EngineConfig)",
                        self.config().processing_timeout.as_secs()
                    ),
                },
                HealthDetail {
                    name: "RSS cap".to_string(),
                    ok: true,
                    note: format!(
                        "{} bytes pre-flight check (Linux only)",
                        self.config().max_rss_bytes
                    ),
                },
            ],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::Engine;
    use crate::security::EngineConfig;

    /// A 1x1 red PNG, generated by the image crate (the same fixture
    /// style the engine tests use).
    fn red_png() -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(1, 1, image::Rgba([255, 0, 0, 255]));
        let mut out = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }

    #[test]
    fn trait_validate_inspect_process_round_trip() {
        let engine = Engine::new(EngineConfig::default());
        let png = red_png();
        assert!(engine.validate(&png).is_ok());
        assert!(engine.validate(b"not an image").is_err());
        let info = engine.inspect(&png).unwrap();
        assert_eq!((info.width, info.height), (1, 1));
        // Fully qualified: `Engine` also has an inherent
        // file-based `process()` — see the module docs.
        let (result, out) = <Engine as ProcessingEngine>::process(
            &engine,
            &png,
            "jpeg",
            &ProcessOptions::default(),
        )
        .unwrap();
        assert_eq!(result.target_format, ImageFormat::Jpeg);
        assert_eq!(detect_format(&out), ImageFormat::Jpeg);
    }

    #[test]
    fn trait_process_rejects_unknown_targets_honestly() {
        let engine = Engine::new(EngineConfig::default());
        let err = <Engine as ProcessingEngine>::process(
            &engine,
            &red_png(),
            "not-a-format",
            &ProcessOptions::default(),
        )
        .unwrap_err();
        assert!(matches!(err, OpenPixelError::NotImplemented(_)));
    }

    #[test]
    fn trait_optimize_shrinks_a_jpeg_and_keeps_png_lossless() {
        let engine = Engine::new(EngineConfig::default());
        // A 64x64 gradient has enough varying pixels that JPEG
        // quality genuinely changes the size (a 1x1 image does not).
        let mut img = image::RgbImage::new(64, 64);
        for (x, y, p) in img.enumerate_pixels_mut() {
            *p = image::Rgb([((x * 4) % 256) as u8, ((y * 4) % 256) as u8, 128]);
        }
        let mut png = Vec::new();
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        // JPEG: aggressive must be smaller than lossless.
        let (_, jpeg) = engine
            .convert_bytes(&png, ImageFormat::Jpeg, &ConvertOptions::default())
            .unwrap();
        let lossless = engine.optimize(&jpeg, OptimizeLevel::Lossless).unwrap();
        let aggressive = engine.optimize(&jpeg, OptimizeLevel::Aggressive).unwrap();
        assert_eq!(detect_format(&lossless), ImageFormat::Jpeg);
        assert_eq!(detect_format(&aggressive), ImageFormat::Jpeg);
        assert!(
            aggressive.len() < lossless.len(),
            "aggressive ({} bytes) must be smaller than lossless ({} bytes)",
            aggressive.len(),
            lossless.len()
        );
        // PNG: optimize returns a real PNG.
        let opt_png = engine.optimize(&png, OptimizeLevel::Balanced).unwrap();
        assert_eq!(detect_format(&opt_png), ImageFormat::Png);
    }

    #[test]
    fn trait_optimize_refuses_decode_only_sources() {
        let engine = Engine::new(EngineConfig::default());
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"></svg>";
        let err = engine.optimize(svg, OptimizeLevel::Balanced).unwrap_err();
        assert!(matches!(err, OpenPixelError::NotImplemented(_)));
    }

    #[test]
    fn trait_export_writes_bytes_and_rejects_traversal() {
        let engine = Engine::new(EngineConfig::default());
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("out.bin");
        let n = engine.export(b"hello", &out).unwrap();
        assert_eq!(n, 5);
        assert_eq!(std::fs::read(&out).unwrap(), b"hello");
        assert!(engine
            .export(b"x", std::path::Path::new("../evil.bin"))
            .is_err());
    }

    #[test]
    fn trait_health_check_reports_real_capabilities() {
        let engine = Engine::new(EngineConfig::default());
        let health = engine.health_check();
        assert_eq!(health.engine, "image");
        assert!(health.ok);
        assert!(health.details.iter().any(|d| d.name == "encode" && d.ok));
    }
}
