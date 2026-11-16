//! OpenPixel OCR engine (Studio Phase 4).
//!
//! Native OCR is Tesseract behind the `native-ocr` feature; the
//! `OcrEngine` trait keeps a second engine pluggable later
//! (PaddleOCR is deferred, not promised). The browser uses
//! tesseract.js instead — see docs/OCR.md. Accuracy is never
//! claimed to be 100%: see the benchmark table in docs/OCR.md.

pub mod engine;
pub mod error;
pub mod preprocess;
pub mod result;

#[cfg(feature = "native-ocr")]
pub mod tesseract;

pub use engine::{OcrEngine, OcrOptions, PreprocessMode};
pub use error::OcrError;
pub use result::{OcrResult, OcrWord};

#[cfg(feature = "native-ocr")]
pub use tesseract::{SearchablePage, TesseractEngine};
