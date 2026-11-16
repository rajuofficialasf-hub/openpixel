//! openpixel-security — Studio Phase 1 (promoted from stub).
//!
//! The shared enforcement layer every engine goes through. It is
//! deliberately dependency-free (std + thiserror only) so it can be
//! used from native code, the jobs pool, the CLI and — via the
//! wasm32-gated paths — the WASM build.
//!
//! What lives here:
//! * [`TempWorkspace`] — an isolated temp directory per job, removed
//!   automatically on drop (no leftovers, no path traversal).
//! * [`run_with_timeout`] — bounds one synchronous call in wall-clock
//!   time. Honest limit: on timeout the caller gets an error, but the
//!   worker thread is *detached*, not killed — it runs to completion
//!   in the background. True kill semantics need process isolation
//!   (a child process), which is Phase 8 backend work, not this crate.
//!   On wasm32 (single-threaded) the work runs inline with no timeout.
//! * [`check_rss_cap`] — a pre-flight RSS check (Linux `/proc`,
//!   a no-op elsewhere). It cannot stop a call that is already
//!   running; it refuses to *start* work when the process is
//!   already over the cap. A real cgroup cap is a deployment
//!   decision, not an engine default.
//! * PDF sanitisation ([`scan_pdf_bytes`], [`check_pdf_bytes`]) —
//!   byte-level detection of JavaScript, embedded files and launch
//!   actions in PDF bytes. This is a first line of defence, not a
//!   proof: PDF names are case-sensitive, so the scan looks for the
//!   canonical spellings readers actually execute. Structural
//!   inspection (lopdf object walk) lands in Phase 5; no PDF
//!   JavaScript is ever executed anywhere in this codebase.
//!
//! This crate closes the Phase 9 accepted risks A8 (no processing
//! timeouts) and A9 (no RSS cap) — see `docs/SECURITY-AUDIT.md`
//! for the exact mitigation and its limits.

pub mod error;
pub mod pdf;
pub mod rss;
pub mod timeout;
pub mod workspace;

pub use error::{SecurityError, TimeoutError};
pub use pdf::{check_pdf_bytes, scan_pdf_bytes, PdfSanitisationPolicy, PdfSanitisationReport};
pub use rss::{check_rss_cap, current_rss_bytes, peak_rss_bytes};
pub use timeout::run_with_timeout;
pub use workspace::TempWorkspace;
