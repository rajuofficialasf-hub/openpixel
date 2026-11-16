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

/// One row of the document conversion matrix
/// (`GET /api/v1/documents/conversions`). A mirror of
/// `openpixel_formats::DocumentConversion` with owned strings,
/// so the wire type does not borrow the registry table. Rows
/// that do not exist are not listed — the API never advertises
/// a conversion the engine refuses.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocumentConversion {
    /// Source format id, e.g. `"docx"`.
    pub source: String,
    /// Target format id, e.g. `"pdf"`.
    pub target: String,
    /// `"libre_office"` or `"pdf_text"`.
    pub engine: String,
    /// `"cli_desktop"` today; `"browser"` when a conversion can
    /// run in the browser (none do yet).
    pub runs_where: String,
    /// What the user actually gets (fidelity note).
    pub fidelity: String,
}

impl DocumentConversion {
    /// Mirror one registry row into its wire form.
    pub fn from_registry(row: &openpixel_formats::DocumentConversion) -> Self {
        Self {
            source: row.source.to_string(),
            target: row.target.to_string(),
            engine: match row.engine {
                openpixel_formats::ConversionEngine::LibreOffice => "libre_office".to_string(),
                openpixel_formats::ConversionEngine::PdfText => "pdf_text".to_string(),
            },
            runs_where: match row.runs_where {
                openpixel_formats::RunsWhere::CliDesktop => "cli_desktop".to_string(),
                openpixel_formats::RunsWhere::Browser => "browser".to_string(),
            },
            fidelity: row.fidelity.to_string(),
        }
    }
}

/// The whole conversion matrix, in wire form.
pub fn list_document_conversions() -> Vec<DocumentConversion> {
    openpixel_formats::DOCUMENT_CONVERSIONS
        .iter()
        .map(DocumentConversion::from_registry)
        .collect()
}

/// `POST /api/v1/documents/convert` — convert an uploaded file
/// to `target_format`. The source format is detected from the
/// file (signature first); unknown pairs are a
/// `not_implemented` error naming the targets the source can
/// convert to.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentConvertRequest {
    pub target_format: String,
    /// LibreOffice timeout, seconds. Defaults to 120 server-side.
    pub timeout_secs: Option<u64>,
}

/// `POST /api/v1/documents/convert` response — the converted
/// file's id plus the measured outcome.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentConvertResponse {
    pub output_file_id: String,
    pub source_format: String,
    pub target_format: String,
    /// `"libre_office"` or `"pdf_text"`.
    pub engine: String,
    pub input_bytes: u64,
    pub output_bytes: u64,
    pub fidelity: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_conversion_matrix_mirrors_the_registry() {
        // The API lists exactly the registry rows — no more, no
        // less — so it never advertises a conversion the engine
        // refuses.
        let listed = list_document_conversions();
        assert_eq!(listed.len(), openpixel_formats::DOCUMENT_CONVERSIONS.len());
        assert!(listed.iter().all(|c| c.runs_where == "cli_desktop"));
        let pdf_xlsx = listed
            .iter()
            .find(|c| c.source == "pdf" && c.target == "xlsx");
        assert!(
            pdf_xlsx.is_none(),
            "pdf -> xlsx has no route and must not be listed"
        );
        let docx_pdf = listed
            .iter()
            .find(|c| c.source == "docx" && c.target == "pdf")
            .unwrap();
        assert_eq!(docx_pdf.engine, "libre_office");
        let pdf_txt = listed
            .iter()
            .find(|c| c.source == "pdf" && c.target == "txt")
            .unwrap();
        assert_eq!(pdf_txt.engine, "pdf_text");
        let json = serde_json::to_string(&docx_pdf).unwrap();
        let back: DocumentConversion = serde_json::from_str(&json).unwrap();
        assert_eq!(back, *docx_pdf);
    }

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
