//! openpixel-pdf — Studio PDF engine.
//!
//! Phase 1: document format detection (signature-first, never the
//! extension), `PdfEngine` with validate/inspect/merge/split.
//! Phase 2: page operations (rotate/extract/remove/reorder/
//! duplicate/insert/replace/reverse/booklet/N-up), PDF→image
//! rendering via PDFium (optional `pdfium` feature), image→PDF.
//! Compression and editing land in Phases 3 and 5 — `optimize()`
//! says so honestly until then.
//!
//! PDFium rendering is an optional `pdfium` feature (dynamic
//! libpdfium binary, see `LICENSE_AUDIT.md` and `docs/PDF.md`);
//! without it, `render_to_images` fails with fetch instructions
//! instead of a fake image.

pub mod engine;
pub mod error;
pub mod format;
pub mod images;
pub mod pages;
pub mod render;

pub use engine::{PdfConfig, PdfEngine, PdfInfo, PdfOperation, PdfOptions};
pub use error::{PdfError, Result};
pub use format::{discover_document, DocumentDiscovery, DocumentFormat};
pub use images::{named_page_size, PageSize};
pub use render::RenderedPage;
