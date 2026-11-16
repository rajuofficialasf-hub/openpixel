//! Document conversion errors.
//!
//! Every failure names the conversion it was attempting and, for
//! LibreOffice failures, carries the tail of soffice's own log —
//! including its "no export filter" message, which is the honest
//! reason a conversion is refused rather than a generic error.

use openpixel_core::OpenPixelError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DocumentError {
    #[error("LibreOffice is not available: {0}")]
    NotAvailable(String),

    #[error("unsupported conversion: {src} -> {dst} ({reason})")]
    UnsupportedConversion {
        src: String,
        dst: String,
        reason: String,
    },

    #[error("LibreOffice conversion failed ({src} -> {dst}): {detail}")]
    ConversionFailed {
        src: String,
        dst: String,
        detail: String,
    },

    #[error("conversion timed out after {0}s (LibreOffice was killed)")]
    Timeout(u64),

    #[error("unknown document format: {0}")]
    UnknownFormat(String),

    #[error(transparent)]
    Pdf(#[from] openpixel_pdf::PdfError),

    #[error(transparent)]
    Core(#[from] OpenPixelError),

    #[error(transparent)]
    Security(#[from] openpixel_security::SecurityError),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, DocumentError>;

impl From<DocumentError> for OpenPixelError {
    fn from(e: DocumentError) -> Self {
        match e {
            DocumentError::NotAvailable(msg) => OpenPixelError::NotImplemented(format!(
                "LibreOffice is not available ({msg}) — document conversion needs LibreOffice on this machine; see docs/PDF.md"
            )),
            DocumentError::UnsupportedConversion { src, dst, reason } => {
                OpenPixelError::NotImplemented(format!(
                    "unsupported conversion: {src} -> {dst} ({reason})"
                ))
            }
            DocumentError::ConversionFailed { src, dst, detail } => {
                OpenPixelError::Internal(format!(
                    "LibreOffice conversion failed ({src} -> {dst}): {detail}"
                ))
            }
            DocumentError::Timeout(secs) => OpenPixelError::Internal(format!(
                "document conversion timed out after {secs}s"
            )),
            DocumentError::UnknownFormat(msg) => {
                OpenPixelError::InvalidArgument(format!("unknown document format: {msg}"))
            }
            DocumentError::Pdf(e) => OpenPixelError::from(e),
            DocumentError::Core(e) => e,
            DocumentError::Security(e) => match e {
                openpixel_security::SecurityError::RssCapExceeded { current, cap } => {
                    OpenPixelError::LimitExceeded(format!(
                        "resident memory {current} bytes exceeds the cap of {cap} bytes"
                    ))
                }
                openpixel_security::SecurityError::UnsafePath(msg) => {
                    OpenPixelError::InvalidArgument(format!("unsafe path: {msg}"))
                }
                other => OpenPixelError::Internal(other.to_string()),
            },
            DocumentError::Io(e) => OpenPixelError::Internal(format!("I/O error: {e}")),
        }
    }
}
