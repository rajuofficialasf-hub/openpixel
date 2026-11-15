//! OpenPixel Core — Phase 1.
//!
//! The unified engine interface. Applications (web / desktop / CLI / WASM)
//! go through [`Engine`]; they never call a codec directly.
//!
//! Pipeline (Phase 1):
//! signature detection -> validation -> decode (image-rs) ->
//! canonical `DynamicImage` -> alpha flattening if needed ->
//! encode -> output validation (re-detect what was written).
//!
//! Honest limits of Phase 1 — see `docs/CODECS.md`:
//! * JPEG / PNG / BMP / GIF / TIFF / WebP / TGA / ICO / PNM / QOI only.
//! * AVIF / HEIC / JXL / JPEG 2000 / SVG / EXR / RAW / PSD: detected,
//!   not decoded or encoded.
//! * GIF: first frame only. TIFF: first page only.
//! * Metadata (EXIF/ICC/XMP) is NOT yet copied to outputs.

pub mod capability;
pub mod engine;
pub mod error;
pub mod format;
pub mod image;
pub mod security;

pub use capability::{capability, implemented_formats, registry, FormatCapability};
pub use engine::{default_output_path, Engine};
pub use error::{OpenPixelError, Result};
pub use format::{detect_format, ImageFormat};
pub use image::{ConvertOptions, ConvertResult, ImageInfo};
pub use security::EngineConfig;
