use thiserror::Error;

/// What can go wrong inside the security layer. These are all
/// *refusals* — the crate never silently allows an unsafe operation.
#[derive(Debug, Error)]
pub enum SecurityError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("processing timed out after {0:?}")]
    Timeout(std::time::Duration),

    #[error("worker thread panicked while processing")]
    WorkerPanicked,

    #[error("resident memory {current} bytes exceeds the cap of {cap} bytes")]
    RssCapExceeded { current: u64, cap: u64 },

    #[error("unsafe path: {0}")]
    UnsafePath(String),

    #[error("PDF refused by sanitisation policy: {0}")]
    PdfDenied(String),
}

/// The two ways [`crate::run_with_timeout`] can fail without a result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeoutError {
    /// The work did not finish within the timeout. The worker thread
    /// was detached and keeps running in the background — it cannot
    /// be killed without process isolation.
    TimedOut(std::time::Duration),
    /// The worker thread panicked. The panic message is not carried
    /// (the channel only reports the disconnect); the caller should
    /// treat this as an internal error, never as a timeout.
    WorkerPanicked,
}
