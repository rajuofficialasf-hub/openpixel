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
//!
//! Phase 3 native codecs (see `docs/CODECS.md` for the evaluation):
//! * [`SvgCodec`] — resvg/usvg rasterisation, decode-only.
//! * [`AvifCodec`] — ravif encode + system dav1d decode.
//! * [`JxlCodec`] — jxl-oxide decode + zune-jpegxl (lossless) encode.
//! * [`HdrCodec`] / [`ExrCodec`] — image-rs hdr/exr, 8-bit SDR in
//!   Phase 3 (float values are clamped, and the note says so).
//! * [`Jpeg2000Codec`] — jpeg2k/openjp2, a pure-Rust OpenJPEG port.
//!
//! HEIC/HEIF follow-up (16 Nov 2026, see `docs/CODECS.md`):
//! * [`HeicCodec`] / [`HeifCodec`] — heifer 0.5.1, pure Rust,
//!   decode + lossy 4:2:0 encode, no C library.

pub mod error;
pub mod exr;
pub mod float;
pub mod hdr;
pub mod heic;
pub mod image_rs;
pub mod jpeg2000;
pub mod jxl;
pub mod planned;
pub mod registry;
pub mod svg;
pub mod traits;
pub mod types;

// The AVIF codec needs the native libdav1d C library (feature
// `native-avif`, on by default). It does not exist for wasm32, so a
// dav1d-free build compiles this module out entirely — see
// `docs/BUILD.md` ("WASM"). The `avif` module's own tests go with it.
#[cfg(feature = "native-avif")]
pub mod avif;

#[cfg(feature = "native-avif")]
pub use avif::AvifCodec;
pub use error::{CodecError, CodecResult};
pub use exr::ExrCodec;
pub use hdr::HdrCodec;
pub use heic::{HeicCodec, HeifCodec};
pub use image_rs::ImageRsCodec;
pub use jpeg2000::Jpeg2000Codec;
pub use jxl::JxlCodec;
pub use planned::planned_capabilities;
pub use registry::CodecRegistry;
pub use svg::SvgCodec;
pub use traits::{Codec, Decoder, Encoder};
pub use types::{DecodedImage, EncodeParams, PixelFormat};
