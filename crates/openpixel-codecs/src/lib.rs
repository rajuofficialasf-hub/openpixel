//! openpixel-codecs — codec traits, adapters and the dynamic registry.
//!
//! Phase 2 architecture:
//! * [`Codec`] / [`Decoder`] / [`Encoder`] — the traits every codec
//!   implements. A new codec is a new struct, never an engine change.
//! * [`ImageRsCodec`] — the image-rs 0.25 adapter (10 formats).
//!   A native codec (libavif, libheif, …) is a second adapter for the
//!   same format; registering it replaces the pure-Rust one.
//! * [`CodecRegistry`] — holds the registered codecs and builds the
//!   capability list from them, plus the planned (unimplemented)
//!   formats. The UI/CLI generate format options from this.
//! * [`DecodedImage`] — the canonical representation every decoder
//!   must produce and every encoder must accept.

pub mod error;
pub mod image_rs;
pub mod planned;
pub mod registry;
pub mod traits;
pub mod types;

pub use error::{CodecError, CodecResult};
pub use image_rs::ImageRsCodec;
pub use planned::planned_capabilities;
pub use registry::CodecRegistry;
pub use traits::{Codec, Decoder, Encoder};
pub use types::{DecodedImage, EncodeParams, PixelFormat};
