//! openpixel-pdf — Studio PDF engine.
//!
//! Phase 1: document format detection (signature-first, never the
//! extension), `PdfEngine` with validate/inspect/merge/split.
//! Phase 2: page operations (rotate/extract/remove/reorder/
//! duplicate/insert/replace/reverse/booklet/N-up), PDF→image
//! rendering via PDFium (optional `pdfium` feature), image→PDF.
//! Phase 3: compression (screen/ebook/printer — image
//! downsample + structure pass), security (RC4-128 protect/
//! unlock, watermarks), text extraction (PDFium) with TXT/HTML/
//! EPUB/DOCX exports. Editing beyond watermarks lands in
//! Phase 5 — `optimize()` is real since Phase 3.
//!
//! PDFium rendering and text extraction share one optional
//! `pdfium` feature (dynamic libpdfium binary, see
//! `LICENSE_AUDIT.md` and `docs/PDF.md`); without it, both fail
//! with fetch instructions instead of a fake result.

pub mod compress;
pub mod engine;
pub mod error;
pub mod format;
pub mod images;
pub mod pages;
pub mod render;
pub mod security;
pub mod text;
pub mod zip;

pub use compress::{CompressMode, CompressOptions, CompressOutcome};
pub use engine::{PdfConfig, PdfEngine, PdfInfo, PdfOperation, PdfOptions};
pub use error::{PdfError, Result};
pub use format::{
    detect_document_format, discover_document, is_ole2, DocumentDiscovery, DocumentFormat,
};
pub use images::{named_page_size, PageSize};
pub use render::RenderedPage;
pub use security::{PdfPermissions, WatermarkOptions};
pub use text::{PageText, TextLine};
pub use zip::{build_zip, ZipEntry};

/// Whether PDFium can actually be used right now. The documents
/// engine reports this in its health check instead of guessing.
/// "Available" means the `pdfium` feature is compiled in AND a
/// libpdfium binary is found at runtime — a compile-time-only
/// check lied on machines with the feature on but no library
/// installed (CI, Phase 3 run e9cfc29: all three CLI jobs failed
/// because the test took the "available" branch and unwrapped a
/// conversion that honestly refused). Without PDFium, PDF →
/// TXT/HTML/EPUB/DOCX extraction is an honest `NotImplemented`.
pub fn pdfium_available() -> bool {
    render::pdfium_library_present()
}
