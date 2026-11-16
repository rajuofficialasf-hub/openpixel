//! openpixel-pdf — Studio Phase 1 foundation.
//!
//! The PDF engine. Phase 1 scope is deliberately narrow: document
//! format detection (signature-first, never the extension),
//! `PdfEngine` with validate/inspect/merge/split, and the
//! `ProcessingEngine` trait implementation. Compression, rendering
//! to images, text extraction and editing land in Phases 2–5 —
//! `optimize()` says so honestly until then.
//!
//! PDFium rendering is an optional `pdfium` feature (dynamic
//! libpdfium binary, see `LICENSE_AUDIT.md`); the prototype lives
//! in `examples/pdfium_render.rs` and is not part of the default
//! build.

pub mod engine;
pub mod error;
pub mod format;

pub use engine::{PdfConfig, PdfEngine, PdfInfo, PdfOperation, PdfOptions};
pub use error::{PdfError, Result};
pub use format::{discover_document, DocumentDiscovery, DocumentFormat};
