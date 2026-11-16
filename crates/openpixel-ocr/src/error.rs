use thiserror::Error;

/// OCR errors — typed, never panics, never fake results.
#[derive(Debug, Error)]
pub enum OcrError {
    #[error("OCR engine is not available: {0}")]
    Unavailable(String),
    #[error("language data not found for '{0}': {1}")]
    LanguageDataMissing(String, String),
    #[error("OCR failed: {0}")]
    Engine(String),
    #[error("unsupported image for OCR: {0}")]
    UnsupportedImage(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}
