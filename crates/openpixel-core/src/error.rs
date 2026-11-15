use std::path::PathBuf;
use thiserror::Error;

/// All errors the engine can return. No error is silently swallowed:
/// callers get a typed reason they can show to the user or log.
#[derive(Debug, Error)]
pub enum OpenPixelError {
    #[error("I/O error for {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("file not found: {0}")]
    NotFound(PathBuf),

    #[error("unknown or unsupported image format (signature did not match any known format)")]
    UnknownFormat,

    #[error("{0} — see `openpixel formats` / `capabilities`")]
    NotImplemented(String),

    #[error("format {format} cannot encode to this target: {reason}")]
    EncodeUnsupported { format: String, reason: String },

    #[error("image decoding failed: {0}")]
    Decode(String),

    #[error("image encoding failed: {0}")]
    Encode(String),

    #[error("security limit exceeded: {0}")]
    LimitExceeded(String),

    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    #[error("output path is unsafe or outside the allowed directory: {0}")]
    UnsafePath(PathBuf),

    #[error("image crate error: {0}")]
    Image(#[from] image::ImageError),
}

pub type Result<T> = std::result::Result<T, OpenPixelError>;
