use openpixel_core::{ConvertOptions, ImageFormat};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Status of one job. `Paused` is a queue-level state: the manager
/// was paused while this job was still queued, so it has not started
/// and will not start until `resume()`. A running job is never
/// paused mid-call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum JobStatus {
    Queued,
    Running,
    Done,
    Failed,
    Cancelled,
    Paused,
}

impl JobStatus {
    /// True once the job will never run again without an explicit
    /// `retry_failed()` (which only re-queues `Failed` jobs).
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Done | Self::Failed | Self::Cancelled)
    }
}

/// One unit of batch work: convert `input` to `output` in `target`
/// format with `options`. The `id` is assigned by the manager on
/// submit; a job built by hand carries `id = 0` until submitted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: u64,
    pub input: PathBuf,
    pub output: PathBuf,
    pub target: ImageFormat,
    pub options: ConvertOptions,
    pub status: JobStatus,
}

impl Job {
    pub fn new(
        input: PathBuf,
        output: PathBuf,
        target: ImageFormat,
        options: ConvertOptions,
    ) -> Self {
        Self {
            id: 0,
            input,
            output,
            target,
            options,
            status: JobStatus::Queued,
        }
    }
}

/// The recorded outcome of one job that ran (or was attempted).
/// `bytes` is the output file size on success, 0 on failure.
/// `error` is the failure message on failure, `None` on success.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobResult {
    pub job_id: u64,
    pub input: PathBuf,
    pub output: PathBuf,
    pub bytes: u64,
    pub duration_ms: u64,
    pub error: Option<String>,
    pub status: JobStatus,
}

/// Snapshot of the whole batch: counts by status plus the total.
/// `completed` is `done + failed + cancelled` — jobs that reached a
/// terminal state without needing a retry.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct BatchProgress {
    pub total: usize,
    pub queued: usize,
    pub running: usize,
    pub done: usize,
    pub failed: usize,
    pub cancelled: usize,
    pub paused: usize,
}

impl BatchProgress {
    pub fn completed(&self) -> usize {
        self.done + self.failed + self.cancelled
    }
}
