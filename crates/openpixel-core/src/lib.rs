//! OpenPixel Core — Phase 2.
//!
//! The unified engine interface. Applications (web / desktop / CLI / WASM)
//! go through [`Engine`]; they never call a codec directly.
//!
//! Pipeline (Phase 2):
//! signature detection / discovery -> validation -> registry lookup ->
//! codec adapter decode -> canonical [`DecodedImage`] -> encode via
//! the target codec -> output validation (re-detect what was written).
//!
//! What changed in Phase 2 vs Phase 1:
//! * Format identity lives in `openpixel-formats` (pure, no codec dep).
//! * Codecs live behind `Codec` / `Decoder` / `Encoder` traits in
//!   `openpixel-codecs`, with a dynamic [`CodecRegistry`]. The engine
//!   asks the registry what is available; it no longer hard-codes a
//!   format list or calls `image` directly.
//! * The public `Engine` API is unchanged — Phase 1 callers still compile.
//!
//! Honest limits — see `docs/CODECS.md`:
//! * JPEG / PNG / BMP / GIF / TIFF / WebP / TGA / ICO / PNM / QOI only.
//! * AVIF / HEIC / JXL / JPEG 2000 / SVG / EXR / RAW / PSD: detected,
//!   not decoded or encoded.
//! * GIF: first frame only. TIFF: first page only.
//! * Metadata (EXIF/ICC/XMP) is NOT yet copied to outputs.

pub mod engine;
pub mod error;
pub mod image;
pub mod security;

pub use engine::{default_output_path, Engine};
pub use error::{OpenPixelError, Result};
pub use image::{ConvertOptions, ConvertResult, ImageInfo};
pub use openpixel_codecs::{CodecRegistry, DecodedImage, EncodeParams, PixelFormat};
pub use openpixel_formats::{
    detect_format, discover, Confidence, DetectionMethod, DiscoveryResult, FormatCapability,
    ImageFormat, MAX_DIMENSION,
};
pub use security::EngineConfig;
