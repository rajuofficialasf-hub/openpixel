use thiserror::Error;

/// Errors from metadata / animation work. A corrupt metadata block is
/// never an error here — `extract_metadata` degrades to partial data
/// with warnings instead. These errors are for operations that cannot
/// proceed at all (no frames, frame index out of range, an image that
/// cannot be decoded as the requested frame type).
#[derive(Debug, Error)]
pub enum MetadataError {
    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("unsupported: {0}")]
    Unsupported(String),

    #[error("frame index {index} is out of range: this image has {count} frame(s)")]
    FrameOutOfRange { index: u32, count: u32 },

    #[error("no frames found: {0}")]
    NoFrames(String),

    #[error("colour conversion failed: {0}")]
    Colour(String),
}

pub type MetadataResult<T> = std::result::Result<T, MetadataError>;
