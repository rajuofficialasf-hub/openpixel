//! OCR accuracy benchmark (Studio Phase 4).
//!
//! OCRs every fixture in `tests/fixtures/` (rendered from KNOWN
//! text by `gen_fixtures.py`) in every preprocess mode and reports
//! character + word error rates. Run with `-- --nocapture` to see
//! the table; the numbers in docs/OCR.md come from this test's
//! output. Accuracy is never 100% — the thresholds below are
//! regression guards with margin, not a claim of perfection.
//!
//! Requires the `native-ocr` feature and a Tesseract install; the
//! test skips (with a printed note) when Tesseract is unavailable,
//! so a `cargo test` without the system library still passes.

#![cfg(feature = "native-ocr")]

use openpixel_codecs::DecodedImage;
use openpixel_ocr::{OcrEngine, OcrOptions, PreprocessMode, SearchablePage, TesseractEngine};
use std::path::PathBuf;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn load_image(name: &str) -> DecodedImage {
    let bytes = std::fs::read(fixtures_dir().join(name)).unwrap();
    let dynimg = image::load_from_memory(&bytes).unwrap();
    DecodedImage::from_dynamic(&dynimg)
}

fn ground_truth(name: &str) -> String {
    std::fs::read_to_string(fixtures_dir().join(name)).unwrap()
}

/// Levenshtein distance over chars (CER) or words (WER).
fn levenshtein<T: PartialEq>(a: &[T], b: &[T]) -> usize {
    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0usize; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        cur[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cost = if ca == cb { 0 } else { 1 };
            cur[j + 1] = (prev[j + 1] + 1).min(cur[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

fn cer(truth: &str, got: &str) -> f64 {
    let t: Vec<char> = truth.chars().collect();
    let g: Vec<char> = got.chars().collect();
    if t.is_empty() {
        return if g.is_empty() { 0.0 } else { 1.0 };
    }
    levenshtein(&t, &g) as f64 / t.len() as f64
}

fn wer(truth: &str, got: &str) -> f64 {
    let t: Vec<&str> = truth.split_whitespace().collect();
    let g: Vec<&str> = got.split_whitespace().collect();
    if t.is_empty() {
        return if g.is_empty() { 0.0 } else { 1.0 };
    }
    levenshtein(&t, &g) as f64 / t.len() as f64
}

/// Fixtures: (stem, language). Ground truth lives in `<stem>.txt`.
const FIXTURES: &[(&str, &str)] = &[
    ("eng-clean", "eng"),
    ("eng-noisy", "eng"),
    ("eng-lowdpi", "eng"),
    ("eng-skewed", "eng"),
    ("ben-clean", "ben"),
    ("ben-noisy", "ben"),
    ("ben-lowdpi", "ben"),
];

#[test]
fn accuracy_table() {
    let engine = match TesseractEngine::new() {
        Ok(e) => e,
        Err(e) => {
            println!("SKIPPED: Tesseract unavailable ({e})");
            return;
        }
    };
    if let Err(e) = engine.health_check() {
        println!("SKIPPED: Tesseract health check failed ({e})");
        return;
    }
    println!("engine: {}", engine.version());
    println!(
        "{:<14} {:<7} {:<8} {:<8} {:<8}",
        "fixture", "lang", "mode", "CER", "WER"
    );
    let mut clean_eng_light = None;
    let mut clean_ben_light = None;
    for (stem, lang) in FIXTURES {
        let truth = ground_truth(&format!("{stem}.txt"));
        let image = load_image(&format!("{stem}.png"));
        for mode in [
            PreprocessMode::None,
            PreprocessMode::Light,
            PreprocessMode::Full,
        ] {
            let options = OcrOptions {
                languages: vec![lang.to_string()],
                preprocess: mode,
                ..OcrOptions::default()
            };
            let result = engine.recognize(&image, &options).unwrap();
            let c = cer(&truth, &result.text);
            let w = wer(&truth, &result.text);
            println!(
                "{stem:<14} {lang:<7} {mode:<8?} {c:<8.3} {w:<8.3} (conf {:.0}%, {} words, {} ms)",
                result.mean_confidence,
                result.words.len(),
                result.duration_ms
            );
            if *stem == "eng-clean" && mode == PreprocessMode::Light {
                clean_eng_light = Some(c);
            }
            if *stem == "ben-clean" && mode == PreprocessMode::Light {
                clean_ben_light = Some(c);
            }
        }
    }
    // Regression guards (measured values have wide margin — see
    // docs/OCR.md; a collapse here means the engine or the
    // fixtures broke, not that OCR is expected to be perfect).
    // The Bengali guard is deliberately loose (0.20 vs a measured
    // 0.130): conjunct accuracy varies a little between Tesseract
    // / traineddata builds, and the guard must catch a real
    // breakage (shaping lost, wrong language data), not a
    // 2-point drift.
    let eng = clean_eng_light.expect("eng-clean/light ran");
    assert!(eng < 0.05, "eng-clean CER {eng:.3} is over the 0.05 guard");
    let ben = clean_ben_light.expect("ben-clean/light ran");
    assert!(ben < 0.20, "ben-clean CER {ben:.3} is over the 0.20 guard");
}

#[test]
fn searchable_pdf_is_a_real_pdf_with_the_text_layer() {
    let engine = match TesseractEngine::new() {
        Ok(e) => e,
        Err(e) => {
            println!("SKIPPED: Tesseract unavailable ({e})");
            return;
        }
    };
    if let Err(e) = engine.health_check() {
        println!("SKIPPED: Tesseract health check failed ({e})");
        return;
    }
    for (stem, lang, needle) in [
        ("eng-clean", "eng", "OpenPixel"),
        ("ben-clean", "ben", "ঢাকায়"),
    ] {
        let bytes = std::fs::read(fixtures_dir().join(format!("{stem}.png"))).unwrap();
        let options = OcrOptions {
            languages: vec![lang.to_string()],
            ..OcrOptions::default()
        };
        let (pdf, results) = engine
            .searchable_pdf(
                &[SearchablePage {
                    image_bytes: &bytes,
                    filename: stem,
                }],
                "OpenPixel OCR benchmark",
                &options,
            )
            .unwrap();
        assert!(pdf.starts_with(b"%PDF-"), "{stem}: not a PDF");
        // The returned result describes the text layer itself.
        assert_eq!(results.len(), 1);
        assert!(
            results[0].text.contains(needle),
            "{stem}: text layer result {0:?} lacks {needle}",
            results[0].text
        );
        // lopdf parses it as a genuine 1-page PDF.
        let doc = lopdf::Document::load_mem(&pdf).unwrap();
        assert_eq!(doc.get_pages().len(), 1, "{stem}: page count");
    }
}
