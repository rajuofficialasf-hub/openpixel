//! openpixel-jobs — batch job manager (Phase 6).
//!
//! A bounded worker pool over `std::thread` + `mpsc`-free shared state
//! (`Mutex` + `Condvar`). No async runtime, no new external crates.
//!
//! # Concurrency bound — read this first
//!
//! The pool has a fixed number of worker threads (`workers`, default
//! `min(available CPUs, 4)`, clamped to 1..=8). Each worker runs at
//! most one job at a time, so at most `workers` full-resolution images
//! are ever in RAM simultaneously. A job's image is itself bounded by
//! [`openpixel_core::EngineConfig`] (100 MiB file, 100 MP, 16 384 px
//! per side by default), so the worst-case live pixel data is
//! `workers x 100 MP x 4 bytes` (RGBA8) — 1.6 GiB at the default of
//! 4 workers. That is the bound, not a promise about a single image:
//! a 100 MP RGBA8 image alone is 400 MiB decoded. On a small machine,
//! or for very large images, run with fewer workers (`--workers 1`).
//! The engine enforces its limits inside every worker: a job that
//! exceeds them fails with `LimitExceeded`, it never crashes the pool
//! and never stops the batch.
//!
//! # What pause / resume / cancel / retry actually do
//!
//! * `pause()` pauses the *queue*: jobs that have not started yet do
//!   not start (their status becomes [`JobStatus::Paused`]).
//!   A job already running keeps running — a decode/encode call is
//!   never interrupted mid-call. `resume()` puts paused jobs back in
//!   the queue.
//! * `cancel(id)` cancels a queued or paused job. Cancelling a
//!   running job returns `false`: it cannot be interrupted mid-call
//!   and runs to completion. `cancel_all()` cancels every queued /
//!   paused job.
//! * `retry_failed()` re-queues every failed job once per call. The
//!   work function decides whether the retry can succeed (e.g. a
//!   transient error); a permanently corrupt file fails again and
//!   stays failed.
//! * A failed job never aborts the batch: its error is recorded in
//!   its [`JobResult`] and the pool carries on with the next job.
//!
//! # Phase 8 — isolated pools (true timeout-kill and RSS cap)
//!
//! The behaviour above is the *in-process* pool: its timeout
//! detaches the worker thread instead of killing it, and it has
//! no RSS enforcement while a job runs. [`JobManager::new_isolated`]
//! (and [`JobManager::for_engine_isolated`]) change the
//! enforcement, not the API: each job runs as a **child process**
//! built by an [`IsolatedRunner`], supervised under
//! [`JobManagerConfig::processing_timeout`] and
//! [`JobManagerConfig::max_rss_bytes`]. A job that overruns its
//! timeout or its RSS cap is **killed** (child terminated and
//! reaped) and recorded `Failed` with an error naming the limit.
//! The CLI's batch uses the isolated pool (its runner re-execs the
//! `openpixel` binary); the desktop app still uses the in-process
//! pool (`for_engine`), where the old detach behaviour applies —
//! see `docs/SECURITY.md` for the per-surface table.
//!
//! Two limits stay: `cancel()` still cannot stop a *running*
//! isolated job (the pool has no cancel-to-kill wiring — the
//! timeout and RSS cap are the kill paths), and RSS enforcement
//! is Linux-only (on Windows/macOS the cap is accepted and not
//! enforced; the timeout kill still works).
//!
//! # Example
//!
//! ```no_run
//! use openpixel_core::{ConvertOptions, Engine, EngineConfig, ImageFormat};
//! use openpixel_jobs::{JobManager, JobManagerConfig};
//! use std::path::PathBuf;
//! use std::sync::Arc;
//!
//! let engine = Arc::new(Engine::new(EngineConfig::default()));
//! let manager = JobManager::for_engine(JobManagerConfig::default(), engine).unwrap();
//! let id = manager.submit(
//!     PathBuf::from("in.png"),
//!     PathBuf::from("out.webp"),
//!     ImageFormat::Webp,
//!     ConvertOptions::default(),
//! );
//! manager.wait_all();
//! assert_eq!(manager.job(id).unwrap().status, openpixel_jobs::JobStatus::Done);
//! ```

pub mod error;
pub mod manager;
pub mod types;

pub use error::JobError;
pub use manager::{
    default_workers, ChildJobSpec, IsolatedRunner, JobHandler, JobManager, JobManagerConfig,
    WorkFn, MAX_WORKERS,
};
pub use types::{BatchProgress, Job, JobKind, JobResult, JobStatus};

/// Peak resident set size of this process in bytes (Linux only).
/// Re-exported from `openpixel-security` — there is one RSS reader
/// in the codebase, not one per crate.
pub use openpixel_security::peak_rss_bytes;

/// Current resident set size of this process in bytes (Linux only).
/// Re-exported from `openpixel-security`.
pub use openpixel_security::current_rss_bytes;
