//! openpixel-api — Studio Phase 1 (promoted from stub).
//!
//! The shared `/api/v1` contract: request/response types, job
//! types and error shapes. **Types only — no server, no HTTP.**
//! The future self-hosted backend (Phase 8) and the frontend
//! (Phase 6, via generated TypeScript in `packages/shared-types`)
//! both derive from these types, so the contract is defined once.
//!
//! Job status/result types are re-exported from `openpixel-jobs`
//! rather than re-defined here, so there is exactly one
//! `JobStatus` in the codebase. Format ids are plain strings
//! (`"jpeg"`, `"pdf"`) — the API must not fail to parse just
//! because a future engine adds a format the API crate does not
//! know about; engines resolve the string and answer
//! `NotImplemented` honestly when they cannot serve it.

pub mod types;

pub use openpixel_jobs::{BatchProgress, JobKind, JobResult, JobStatus};
pub use types::list_document_conversions;
pub use types::{
    ApiError, ApiVersion, ConvertRequest, CreateJobRequest, DocumentConversion,
    DocumentConvertRequest, DocumentConvertResponse, EngineStatus, ErrorResponse,
    FileUploadResponse, HealthResponse, JobResponse, BASE_PATH,
};

/// The API version every path is prefixed with.
pub const API_VERSION: &str = "v1";
