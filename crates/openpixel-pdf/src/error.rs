use openpixel_core::OpenPixelError;
use thiserror::Error;

/// Errors the PDF engine can return. `lopdf` errors are kept as
/// their message (the lopdf error type does not implement
/// `std::error::Error` in a way that survives `#[from]` cleanly
/// for every variant, so the message is carried instead — the
/// original text is preserved verbatim).
#[derive(Debug, Error)]
pub enum PdfError {
    /// The input is not a usable PDF, or an argument about a PDF
    /// is invalid (bad page, bad degrees, bad scale, empty input).
    /// The message says which — the variant does not prefix it
    /// with "not a PDF file", because that would be wrong for the
    /// argument errors (e.g. a bad rotate angle on a real PDF).
    #[error("{0}")]
    InvalidPdf(String),

    #[error("PDF is encrypted and no password was supplied")]
    Encrypted,

    #[error("page {0} does not exist (document has {1} pages)")]
    PageOutOfRange(u32, u32),

    #[error("invalid page range {0}..={1}: start must be <= end and within the document")]
    InvalidRange(u32, u32),

    #[error("PDF error: {0}")]
    Lopdf(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("unsupported operation: {0}")]
    NotImplemented(String),
}

pub type Result<T> = std::result::Result<T, PdfError>;

impl From<lopdf::Error> for PdfError {
    fn from(e: lopdf::Error) -> Self {
        PdfError::Lopdf(e.to_string())
    }
}

impl From<PdfError> for OpenPixelError {
    fn from(e: PdfError) -> Self {
        match e {
            PdfError::InvalidPdf(msg) => OpenPixelError::InvalidArgument(msg),
            PdfError::Encrypted => OpenPixelError::InvalidArgument(
                "PDF is encrypted and no password was supplied".to_string(),
            ),
            PdfError::PageOutOfRange(page, count) => OpenPixelError::InvalidArgument(format!(
                "page {page} does not exist (document has {count} pages)"
            )),
            PdfError::InvalidRange(a, b) => {
                OpenPixelError::InvalidArgument(format!("invalid page range {a}..={b}"))
            }
            PdfError::Lopdf(msg) => OpenPixelError::Decode(format!("PDF error: {msg}")),
            PdfError::Io(e) => OpenPixelError::Io {
                path: std::path::PathBuf::new(),
                source: e,
            },
            PdfError::NotImplemented(msg) => OpenPixelError::NotImplemented(msg),
        }
    }
}
