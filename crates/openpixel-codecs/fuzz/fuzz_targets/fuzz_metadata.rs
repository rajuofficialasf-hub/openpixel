//! Fuzz the metadata / animation parsers: EXIF, ICC, XMP, GIF /
//! APNG / WebP frame info and GIF/TIFF frame extraction.
//!
//! These are hand-written, bounds-checked parsers over untrusted
//! bytes. Corrupt input must degrade to partial data + warnings
//! (or a typed `MetadataError`), never a panic, an out-of-bounds
//! index, or an unbounded allocation. The Phase 9 caps (16 MiB
//! zlib expansion, 100 000 scanned frames, GIF/TIFF dimension
//! pre-checks) are exercised here by mutated seeds.

#![no_main]

use libfuzzer_sys::fuzz_target;
use openpixel_formats::detect_format;

fuzz_target!(|data: &[u8]| {
    let format = detect_format(data);
    let meta = openpixel_metadata::extract_metadata(data, format);
    let _ = meta.summary();
    let _ = meta.warnings.len();
    let anim = openpixel_metadata::animation_info(data, format);
    let _ = (anim.frame_count, anim.is_animated, anim.frames.len());
    if anim.frame_count > 0 {
        // First frame/page only — later frames are the same code
        // path with a different index, and the engine bounds the
        // index through `FrameOutOfRange`.
        let _ = openpixel_metadata::extract_gif_frame(data, 0);
        let _ = openpixel_metadata::extract_tiff_page(data, 0);
    }
});
