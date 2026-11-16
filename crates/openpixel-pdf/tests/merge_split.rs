//! Merge + split on REAL multi-page PDF files, generated with
//! lopdf itself (no checked-in binary fixtures) and cross-checked
//! with `pdfinfo` when it is installed.

use openpixel_core::{OptimizeLevel, ProcessingEngine};
use openpixel_pdf::{PdfEngine, PdfOperation, PdfOptions};
use std::process::Command;

#[path = "common.rs"]
mod common;
use common::make_pdf;

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// `pdfinfo` (poppler-utils) is the independent cross-check. When
/// it is not installed the count checks still run via the crate;
/// the pdfinfo assertions are skipped, not faked.
fn pdfinfo_available() -> bool {
    Command::new("pdfinfo")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn pdfinfo_pages(path: &std::path::Path) -> u32 {
    let out = Command::new("pdfinfo")
        .arg(path)
        .output()
        .expect("pdfinfo must be available when this is called");
    assert!(out.status.success(), "pdfinfo failed on {path:?}");
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text
        .lines()
        .find(|l| l.starts_with("Pages:"))
        .expect("pdfinfo output has a Pages: line");
    line.trim_start_matches("Pages:")
        .trim()
        .parse()
        .expect("pdfinfo Pages: value is a number")
}

#[test]
fn merge_two_real_pdfs_and_verify_with_pdfinfo() {
    let engine = PdfEngine::default();
    let a = make_pdf(3, "AAA");
    let b = make_pdf(2, "BBB");
    let merged = engine.merge(&[a, b]).unwrap();
    assert_eq!(engine.page_count(&merged).unwrap(), 5);
    // Content really merged, not just the page count: the text of
    // both sources is present in the output bytes.
    assert!(contains_bytes(&merged, b"AAA page 3"));
    assert!(contains_bytes(&merged, b"BBB page 1"));

    if pdfinfo_available() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("merged.pdf");
        std::fs::write(&path, &merged).unwrap();
        assert_eq!(pdfinfo_pages(&path), 5);
    }
}

#[test]
fn split_real_pdf_ranges_and_verify_with_pdfinfo() {
    let engine = PdfEngine::default();
    let doc = make_pdf(5, "S");
    let parts = engine.split(&doc, &[(1, 2), (3, 5)]).unwrap();
    assert_eq!(parts.len(), 2);
    assert_eq!(engine.page_count(&parts[0]).unwrap(), 2);
    assert_eq!(engine.page_count(&parts[1]).unwrap(), 3);
    assert!(contains_bytes(&parts[0], b"S page 2"));
    assert!(contains_bytes(&parts[1], b"S page 4"));

    if pdfinfo_available() {
        let dir = tempfile::tempdir().unwrap();
        for (i, part) in parts.iter().enumerate() {
            let path = dir.path().join(format!("part{i}.pdf"));
            std::fs::write(&path, part).unwrap();
            assert_eq!(pdfinfo_pages(&path), if i == 0 { 2 } else { 3 });
        }
    }
}

#[test]
fn split_single_pages_then_remerge() {
    let engine = PdfEngine::default();
    let doc = make_pdf(4, "R");
    let singles = engine
        .split(&doc, &[(1, 1), (2, 2), (3, 3), (4, 4)])
        .unwrap();
    assert_eq!(singles.len(), 4);
    for part in &singles {
        assert_eq!(engine.page_count(part).unwrap(), 1);
    }
    let merged = engine.merge(&singles).unwrap();
    assert_eq!(engine.page_count(&merged).unwrap(), 4);
    assert!(contains_bytes(&merged, b"R page 4"));
}

#[test]
fn trait_process_split_and_optimize_refusal() {
    let engine = PdfEngine::default();
    let doc = make_pdf(4, "T");
    let out = <PdfEngine as ProcessingEngine>::process(
        &engine,
        &doc,
        "pdf",
        &PdfOptions {
            operation: PdfOperation::Split {
                ranges: vec![(2, 3)],
            },
        },
    )
    .unwrap();
    assert_eq!(out.len(), 1);
    assert_eq!(engine.page_count(&out[0]).unwrap(), 2);

    // Wrong target and optimize are honest NotImplemented errors,
    // not silent no-ops.
    let err =
        <PdfEngine as ProcessingEngine>::process(&engine, &doc, "png", &PdfOptions::default())
            .unwrap_err();
    assert!(matches!(
        err,
        openpixel_core::OpenPixelError::NotImplemented(_)
    ));
    let err = <PdfEngine as ProcessingEngine>::optimize(&engine, &doc, OptimizeLevel::Balanced)
        .unwrap_err();
    assert!(matches!(
        err,
        openpixel_core::OpenPixelError::NotImplemented(_)
    ));
}
