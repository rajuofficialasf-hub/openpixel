//! Fuzz the decode path: detect, then dimensions, then decode.
//!
//! Mirrors the engine's own order (`Engine::read_decode_frame`):
//! dimensions are checked against the engine limits (16 384 px /
//! side, 100 MP) *before* decoding, so a header claiming a gigantic
//! image is skipped here exactly as the engine skips it. Decoding
//! must then never panic or abort — any error is a `CodecError`,
//! never a crash. (A codec that allocates from an unchecked header
//! would show up here as an OOM under the fuzzer's RSS limit.)

#![no_main]

use libfuzzer_sys::fuzz_target;
use openpixel_codecs::CodecRegistry;
use openpixel_formats::{detect_format, ImageFormat};

/// Same limits as `openpixel_core::EngineConfig` (duplicated here
/// because the fuzz crate cannot depend on core without pulling the
/// whole engine into the fuzz build — keep in sync by hand).
const MAX_DIMENSION: u32 = 16_384;
const MAX_PIXELS: u64 = 100_000_000;

fuzz_target!(|data: &[u8]| {
    let format = detect_format(data);
    if format == ImageFormat::Unknown {
        return;
    }
    let registry = CodecRegistry::default();
    let Some(codec) = registry.get(format) else {
        return;
    };
    let Ok((w, h)) = codec.dimensions(data) else {
        return;
    };
    if w == 0
        || h == 0
        || w > MAX_DIMENSION
        || h > MAX_DIMENSION
        || w as u64 * h as u64 > MAX_PIXELS
    {
        return;
    }
    // Decode errors are expected for corrupt input; a panic, abort
    // or unbounded allocation is the failure this target hunts.
    let _ = codec.decode(data);
});
