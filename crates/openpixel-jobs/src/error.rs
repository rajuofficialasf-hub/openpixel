use thiserror::Error;

/// Errors from the job manager itself (not from a job's work — a
/// failed job is recorded in its [`crate::JobResult`], never raised
/// here).
#[derive(Debug, Error)]
pub enum JobError {
    #[error("no such job: id {0}")]
    JobNotFound(u64),

    #[error("worker count {0} is out of range (must be 1..=8)")]
    InvalidWorkerCount(usize),
}

pub type Result<T> = std::result::Result<T, JobError>;
