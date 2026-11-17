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
//!   (a child process), which is Phase 8: see [`isolated`].
//!   On wasm32 (single-threaded) the work runs inline with no timeout.
//! * [`isolated::run_command_isolated`] (Phase 8) — the real
//!   enforcement: runs the work as a child process the parent can
//!   **kill** on timeout and on RSS breach (Linux `/proc` polling).
//!   This is what the CLI uses for `convert` / `process` / `batch`.
//! * [`check_rss_cap`] — a pre-flight RSS check (Linux `/proc`,
//!   a no-op elsewhere). It cannot stop a call that is already
//!   running; it refuses to *start* work when the process is
//!   already over the cap. A real cgroup cap is a deployment
//!   decision, not an engine default. For a running call the cap
//!   is enforced by [`isolated::run_command_isolated`], which
//!   polls the *child's* RSS instead of this process's.
//! * [`rss_bytes_for_pid`] — the per-pid RSS reader the isolation
//!   monitor polls (Linux `/proc/<pid>/status`).
//! * PDF sanitisation ([`scan_pdf_bytes`], [`check_pdf_bytes`]) —
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
//! for the exact mitigation and its limits. Phase 1 closed them
//! only as a thread timeout (detach, not kill) and a pre-flight
//! RSS check; Phase 8 (`isolated`) closes them for real on the
//! CLI paths, where the work runs in a child process the parent
//! can kill. The in-process callers (desktop, WASM) still use
//! the Phase 1 mechanisms — see `docs/SECURITY.md`.

pub mod error;
pub mod isolated;
pub mod pdf;
pub mod rss;
pub mod timeout;
pub mod workspace;

pub use error::{SecurityError, TimeoutError};
pub use isolated::{
    platform_support, process_exists, run_command_isolated, IsolatedOutput, IsolationError,
    IsolationLimits, IsolationSupport, DEFAULT_POLL_INTERVAL,
};
pub use pdf::{check_pdf_bytes, scan_pdf_bytes, PdfSanitisationPolicy, PdfSanitisationReport};
pub use rss::{check_rss_cap, current_rss_bytes, peak_rss_bytes, rss_bytes_for_pid};
pub use timeout::run_with_timeout;
pub use workspace::TempWorkspace;
