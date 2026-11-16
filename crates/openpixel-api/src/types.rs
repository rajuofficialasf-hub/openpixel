//! Shared `/api/v1` request/response types.
//!
//! Conventions:
//! * Every response is JSON; every error is an [`ErrorResponse`]
//!   with a stable machine-readable `code` and a human `message`.
//! * Ids are opaque strings on the wire (`file_id`, `job_id` is a
//!   number only because the jobs pool assigns sequential u64s
//!   today — the API does not promise they stay sequential).
//! * `params` is open JSON (`serde_json::Value`): each engine
//!   validates its own operation params, so the API layer never
//!   has to know every engine's options.

use crate::{JobKind, JobStatus};
use serde::{Deserialize, Serialize};

/// Base path for every endpoint: `/api/v1/...`.
pub const BASE_PATH: &str = "/api/v1";

/// Marker type so callers can refer to the version in code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ApiVersion;

impl ApiVersion {
    pub const V1: &'static str = "v1";
}

/// One machine-readable API error.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApiError {
    /// Stable code, e.g. `"unknown_format"`, `"limit_exceeded"`,
    /// `"not_implemented"`, `"timeout"`, `"invalid_argument"`.
    pub code: String,
    /// Human-readable message, safe to show to the user.
    pub message: String,
    /// Optional extra detail (field name, limit value, …).
    pub details: Option<String>,
}

impl ApiError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }
}

/// The error envelope every failing endpoint returns.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ErrorResponse {
    pub error: ApiError,
}

/// `GET /api/v1/health` — liveness + per-engine health.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    /// `"ok"` when every required engine reports healthy.
    pub status: String,
    /// API version, `"v1"`.
    pub version: String,
    /// One entry per engine (`"image"`, `"pdf"`, …).
    pub engines: Vec<EngineStatus>,
}

/// One engine's health line.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineStatus {
    pub name: String,
    pub ok: bool,
    pub note: String,
}

/// `POST /api/v1/files` response — a file the server accepted for
/// processing. The file itself is stored by the backend; the API
/// only ever returns ids and metadata, never paths.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileUploadResponse {
    pub file_id: String,
    pub name: String,
    pub size_bytes: u64,
    /// Format id detected by signature, if any.
    pub detected_format: Option<String>,
}

/// `POST /api/v1/jobs` — ask for work. `operation` names the
/// engine operation (`"convert"`, `"merge"`, `"ocr"`, …);
/// `params` carries its options as open JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateJobRequest {
    pub kind: JobKind,
    pub input_file_id: String,
    pub operation: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// `GET /api/v1/jobs/{id}` — one job's state. `output_file_id`
/// is set once the job is done; `error` carries the failure
/// message when it failed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobResponse {
    pub id: u64,
    pub kind: JobKind,
    pub status: JobStatus,
    pub input_file_id: String,
    pub output_file_id: Option<String>,
    /// 0.0–1.0 while running, `None` when unknown.
    pub progress: Option<f32>,
    pub error: Option<String>,
}

/// `POST /api/v1/image/convert` (and the future
/// `/api/v1/pdf/...` equivalents) — the inline conversion
/// request. `target_format` is a format id string (`"jpeg"`,
/// `"webp"`, `"pdf"`); unknown ids are a `not_implemented`
/// error, never a silent substitution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvertRequest {
    pub target_format: String,
    pub quality: Option<u8>,
    #[serde(default)]
    pub metadata_policy: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_response_round_trips_through_json() {
        let resp = ErrorResponse {
            error: ApiError {
                code: "limit_exceeded".to_string(),
                message: "file is too big".to_string(),
                details: Some("100 MiB".to_string()),
            },
        };
        let json = serde_json::to_string(&resp).unwrap();
        let back: ErrorResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(back, resp);
        assert!(json.contains("limit_exceeded"));
    }

    #[test]
    fn job_request_and_response_round_trip() {
        let req = CreateJobRequest {
            kind: JobKind::Image,
            input_file_id: "file-abc".to_string(),
            operation: "convert".to_string(),
            params: serde_json::json!({"target_format": "webp", "quality": 85}),
        };
        let json = serde_json::to_string(&req).unwrap();
        let back: CreateJobRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(back.kind, JobKind::Image);
        assert_eq!(back.params["quality"], 85);

        let resp = JobResponse {
            id: 7,
            kind: JobKind::Image,
            status: JobStatus::Done,
            input_file_id: "file-abc".to_string(),
            output_file_id: Some("file-def".to_string()),
            progress: Some(1.0),
            error: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        let back: JobResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(back.status, JobStatus::Done);
        assert_eq!(back.output_file_id.as_deref(), Some("file-def"));
    }

    #[test]
    fn health_response_lists_engines() {
        let resp = HealthResponse {
            status: "ok".to_string(),
            version: ApiVersion::V1.to_string(),
            engines: vec![EngineStatus {
                name: "image".to_string(),
                ok: true,
                note: "16 formats".to_string(),
            }],
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"version\":\"v1\""));
        assert!(json.contains("\"name\":\"image\""));
    }
}
