use openpixel_core::{ConvertOptions, ImageFormat};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// What kind of work a job is. The pool mechanics (queue, workers,
/// pause/resume/cancel/retry) are kind-agnostic; the kind tells a
/// handler how to interpret the job's `params`, and tells the API
/// which engine owns it. Image jobs are the original kind; PDF/OCR/
/// document jobs arrive in later phases.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum JobKind {
    #[default]
    Image,
    Pdf,
    Ocr,
    Document,
}

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
///
/// `kind` + `params` generalise the job beyond images (Studio
/// Phase 1): an image job has `kind = Image` and `params = null`
/// (its work is fully described by `target` + `options`); a PDF
/// job in Phase 2 will carry `kind = Pdf` and its operation in
/// `params` (e.g. `{"operation": "merge"}`). Both new fields have
/// serde defaults, so job JSON written before Phase 1 still parses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: u64,
    pub input: PathBuf,
    pub output: PathBuf,
    pub target: ImageFormat,
    pub options: ConvertOptions,
    #[serde(default)]
    pub kind: JobKind,
    #[serde(default)]
    pub params: serde_json::Value,
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
            kind: JobKind::default(),
            params: serde_json::Value::Null,
            status: JobStatus::Queued,
        }
    }

    /// Build a non-image job: the kind + open-JSON params describe
    /// the work; `target`/`options` keep their image defaults and
    /// are ignored by that kind's handler.
    pub fn with_kind(mut self, kind: JobKind, params: serde_json::Value) -> Self {
        self.kind = kind;
        self.params = params;
        self
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
