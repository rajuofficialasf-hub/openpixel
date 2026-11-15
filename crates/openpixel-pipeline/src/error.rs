use thiserror::Error;

/// Errors from the processing pipeline. The engine (`openpixel-core`)
/// maps these onto its own `OpenPixelError` — applications never see
/// pipeline internals, but the reason stays typed.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum PipelineError {
    #[error("invalid pipeline operation: {0}")]
    InvalidArgument(String),

    #[error("pipeline security limit exceeded: {0}")]
    LimitExceeded(String),
}

pub type PipelineResult<T> = Result<T, PipelineError>;

impl PipelineError {
    pub fn invalid(msg: impl Into<String>) -> Self {
        Self::InvalidArgument(msg.into())
    }

    pub fn limit(msg: impl Into<String>) -> Self {
        Self::LimitExceeded(msg.into())
    }
}
