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
//! * GIF: first frame only on plain decode (frame enumeration +
//!   extraction live in `openpixel-metadata`, Phase 5). TIFF: first
//!   page only on plain decode (page count + extraction in Phase 5).
//! * Metadata (EXIF/ICC/XMP) is copied to JPEG/PNG outputs only
//!   when the metadata policy asks for it (Phase 5); every other
//!   target honestly reports the drop.

pub mod engine;
pub mod error;
pub mod image;
pub mod security;

pub use engine::{default_output_path, Engine};
pub use error::{OpenPixelError, Result};
pub use image::{ConvertOptions, ConvertResult, ImageInfo, ProcessOptions, TargetSizeOutcome};
pub use openpixel_codecs::{CodecRegistry, DecodedImage, EncodeParams, PixelFormat};
pub use openpixel_formats::{
    detect_format, discover, Confidence, DetectionMethod, DiscoveryResult, FormatCapability,
    ImageFormat, MAX_DIMENSION,
};
pub use openpixel_metadata::{AnimationInfo, FrameInfo, Metadata, MetadataField, MetadataPolicy};
pub use openpixel_pipeline::{
    Operation, Pipeline, PipelineError, PipelineSpec, WatermarkPosition, WatermarkSpec,
};
pub use security::EngineConfig;
