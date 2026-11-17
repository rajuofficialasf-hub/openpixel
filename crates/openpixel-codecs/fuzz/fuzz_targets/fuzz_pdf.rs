//! Fuzz the PDF engine's parse-level paths with arbitrary bytes.
//!
//! The PDF parser is the security boundary for untrusted documents:
//! it runs on every file before anything else. It must never panic,
//! index out of bounds, or loop on any byte string, including empty
//! and truncated inputs. Rendering is NOT fuzzed here (it needs a
//! libpdfium binary); signing is NOT fuzzed (feature-gated, and its
//! CMS parsing is covered by unit tests in the pdf crate).

#![no_main]

use libfuzzer_sys::fuzz_target;
use openpixel_pdf::{
    CompressMode, CompressOptions, PdfEngine, RectRedaction, Redaction, TextRedaction,
};

fuzz_target!(|data: &[u8]| {
    let engine = PdfEngine::default();
    // Parse + info paths (lopdf load, page-tree walk, content
    // streams). Every call returns a Result — a panic here is a bug.
    let _ = engine.validate(data);
    let _ = engine.page_count(data);
    let _ = engine.inspect(data);
    let _ = engine.extract_text(data, None);
    // Content-stream rewriting on whatever survived validation:
    // compression (image recompression incl. the capped Flate
    // decode), sanitisation (threat detection + removal) and
    // redaction (rect + text search through content streams).
    let _ = engine.compress(data, CompressMode::Ebook, CompressOptions::default());
    let _ = engine.sanitize(data);
    let _ = engine.redact(
        data,
        &[Redaction::Rect(RectRedaction {
            page: 1,
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 20.0,
        })],
    );
    let _ = engine.redact(
        data,
        &[Redaction::Text(TextRedaction {
            page: None,
            text: "x".to_string(),
        })],
    );
});
