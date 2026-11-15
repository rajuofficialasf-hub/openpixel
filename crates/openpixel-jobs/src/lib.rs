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
pub use manager::{default_workers, JobManager, JobManagerConfig, WorkFn, MAX_WORKERS};
pub use types::{BatchProgress, Job, JobResult, JobStatus};

/// Peak resident set size of this process in bytes, read from
/// `/proc/self/status` (`VmHWM`, Linux only). Returns `None` on
/// non-Linux platforms or when the field cannot be read. Used by the
/// `openpixel bench` command; `/usr/bin/time` is not installed on
/// this VM, so the benchmark measures RSS itself instead of relying
/// on an external tool.
pub fn peak_rss_bytes() -> Option<u64> {
    read_status_kib("VmHWM").map(|kib| kib * 1024)
}

/// Current resident set size of this process in bytes (Linux only,
/// `/proc/self/status` `VmRSS`).
pub fn current_rss_bytes() -> Option<u64> {
    read_status_kib("VmRSS").map(|kib| kib * 1024)
}

fn read_status_kib(field: &str) -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix(field) {
            let num: String = rest.chars().filter(|c| c.is_ascii_digit()).collect();
            return num.parse::<u64>().ok();
        }
    }
    None
}
