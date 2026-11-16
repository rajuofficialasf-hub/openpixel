//! Processing timeouts (closes Phase 9 accepted risk A8).
//!
//! [`run_with_timeout`] runs one synchronous call on a worker thread
//! and waits for it with a deadline. The contract, stated plainly:
//! * On time — the result is returned unchanged.
//! * On timeout — the caller gets [`TimeoutError::TimedOut`] and the
//!   worker thread is **detached**: it keeps running until the work
//!   finishes, holding whatever memory it allocated. It cannot be
//!   killed — Rust has no safe way to stop a thread mid-call, and
//!   killing it anyway would leave locks and allocators in an
//!   undefined state. True kill semantics need a child *process*
//!   (Phase 8 backend workers), not a thread.
//! * On panic — the worker died; the caller gets
//!   [`TimeoutError::WorkerPanicked`].
//! * On wasm32 — there are no threads. The work runs inline and the
//!   timeout is not enforced (the browser already runs the engine
//!   in a Web Worker and stays responsive). The parameter is accepted
//!   and ignored, so callers do not need `cfg` gates of their own.

use crate::error::TimeoutError;
#[cfg(not(target_arch = "wasm32"))]
use std::sync::mpsc;
use std::time::Duration;

/// Run `work` with a wall-clock deadline. See the module docs for
/// the exact timeout contract.
#[cfg(not(target_arch = "wasm32"))]
pub fn run_with_timeout<T, F>(timeout: Duration, work: F) -> Result<T, TimeoutError>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        // If the receiver is already gone (timeout fired), the send
        // fails silently — the result is simply dropped.
        let _ = tx.send(work());
    });
    match rx.recv_timeout(timeout) {
        Ok(value) => Ok(value),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(TimeoutError::TimedOut(timeout)),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(TimeoutError::WorkerPanicked),
    }
}

/// wasm32: single-threaded, no timeout enforcement possible.
#[cfg(target_arch = "wasm32")]
pub fn run_with_timeout<T, F>(timeout: Duration, work: F) -> Result<T, TimeoutError>
where
    F: FnOnce() -> T,
    T: Send,
{
    let _ = timeout;
    Ok(work())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn fast_work_returns_its_result() {
        let out = run_with_timeout(Duration::from_secs(5), || 42).unwrap();
        assert_eq!(out, 42);
    }

    #[test]
    fn slow_work_times_out_within_the_deadline() {
        let started = Instant::now();
        let err = run_with_timeout(Duration::from_millis(100), || {
            std::thread::sleep(Duration::from_secs(5));
            1
        })
        .unwrap_err();
        assert_eq!(err, TimeoutError::TimedOut(Duration::from_millis(100)));
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "timeout must return promptly, took {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn panicking_work_is_reported_not_swallowed() {
        let err = run_with_timeout(Duration::from_secs(5), || -> i32 {
            panic!("boom in worker")
        })
        .unwrap_err();
        assert_eq!(err, TimeoutError::WorkerPanicked);
    }
}
