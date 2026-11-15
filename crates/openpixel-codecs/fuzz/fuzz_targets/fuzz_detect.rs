//! Fuzz the format detector: magic-byte sniffing + discovery.
//!
//! The detector is the security boundary for untrusted input — it
//! runs on every file before anything else. It must never panic,
//! index out of bounds, or loop on any byte string, including empty
//! and truncated inputs.

#![no_main]

use libfuzzer_sys::fuzz_target;
use openpixel_formats::{detect_format, discover, ImageFormat};

fuzz_target!(|data: &[u8]| {
    let format = detect_format(data);
    // Every variant must be displayable / listable — a detector
    // returning a broken enum would be a bug in itself.
    let _ = format.id();
    let _ = format.extensions();
    let _ = format.mime_types();
    let _ = format.to_string();
    // Discovery with a lying extension/MIME pair (the common case).
    let found = discover(data, Some("png"), Some("image/png"));
    let _ = (found.format, found.confidence, found.has_mismatch());
    let _ = ImageFormat::from_name("jpg");
    let _ = ImageFormat::from_mime("image/jpeg");
});
