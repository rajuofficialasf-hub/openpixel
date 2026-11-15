use thiserror::Error;

/// Errors from a single codec. The engine (`openpixel-core`) maps these
/// onto its own `OpenPixelError` — applications never see codec internals.
#[derive(Debug, Error)]
pub enum CodecError {
    #[error("decode failed: {0}")]
    Decode(String),
    #[error("encode failed: {0}")]
    Encode(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
}

pub type CodecResult<T> = Result<T, CodecError>;

impl From<image::ImageError> for CodecError {
    fn from(e: image::ImageError) -> Self {
        CodecError::Decode(e.to_string())
    }
}
