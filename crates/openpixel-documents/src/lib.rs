//! openpixel-documents — Studio document conversion engine.
//!
//! Phase 3: Office ↔ PDF and Office ↔ Office via LibreOffice
//! headless (desktop/server only), plus PDF → TXT/HTML/EPUB/DOCX
//! (text-only) via the PDF engine's PDFium text extraction.
//! Every conversion routes through the registry table in
//! `openpixel-formats::conversion`; pairs with no row are refused
//! honestly, never faked.

pub mod engine;
pub mod error;
pub mod libreoffice;

pub use engine::{ConversionOutcome, DocumentEngine, DocumentInfo, DocumentOptions};
pub use error::{DocumentError, Result};
pub use libreoffice::{LibreOffice, DEFAULT_TIMEOUT_SECS};
