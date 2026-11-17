use crate::error::{OpenPixelError, Result};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Phase 1 security limits (engineering targets, enforced in the engine).
/// Tune in `EngineConfig`; never remove them silently.
pub const MAX_FILE_SIZE_BYTES: u64 = 100 * 1024 * 1024; // 100 MiB
pub const MAX_PIXELS: u64 = 100_000_000; // 100 MP — decompression-bomb guard
/// Single source of truth lives in `openpixel-formats`; re-exported here
/// so Phase 1 callers (`security::MAX_DIMENSION`) still compile.
pub use openpixel_formats::MAX_DIMENSION;

/// Default wall-clock limit for one decode/encode call (Studio
/// Phase 1, closes Phase 9 accepted risk A8): 5 minutes. Enforced
/// where a `'static` closure is available — the jobs pool (via
/// `JobManager::for_engine`, which reads this value) and the CLI.
/// The engine itself cannot spawn the timeout thread from a `&self`
/// method (the closure would borrow `self`), so `Engine` enforces
/// only the RSS pre-flight check; see `Engine::check_resource_limits`.
pub const DEFAULT_PROCESSING_TIMEOUT: Duration = Duration::from_secs(300);
/// Default process RSS cap (Studio Phase 1, closes Phase 9 accepted
/// risk A9 as a pre-flight check, Linux only): 2 GiB. The jobs
/// documentation bounds the worst case at 1.6 GiB (4 workers x
/// 100 MP x 4 bytes), so a 2 GiB cap leaves headroom for legitimate
/// batches while refusing to start work on an already-bloated
/// process. This is not a cgroup — a deployment that needs a hard
/// cap should use `ulimit` / cgroup limits.
pub const DEFAULT_MAX_RSS_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub max_file_size_bytes: u64,
    pub max_pixels: u64,
    pub max_dimension: u32,
    /// JPEG quality used when the caller does not specify one (1..=100).
    pub default_jpeg_quality: u8,
    /// Background used when flattening alpha for formats without it.
    pub default_background: [u8; 3],
    /// Wall-clock limit for one decode/encode call. Read by the
    /// jobs pool and the CLI (see `DEFAULT_PROCESSING_TIMEOUT`).
    /// Phase 8: the CLI enforces it as a true kill (the conversion
    /// runs in a supervised child process); the in-process jobs
    /// pool enforces it as a thread timeout (detach, not kill).
    pub processing_timeout: Duration,
    /// Process RSS cap in bytes. The engine itself only
    /// pre-flights it (Linux only — refuse to start work when the
    /// process is already over the cap). Phase 8: the CLI enforces
    /// it for real, killing a child process whose RSS passes the
    /// cap (Linux only); see `docs/SECURITY.md`.
    pub max_rss_bytes: u64,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            max_file_size_bytes: MAX_FILE_SIZE_BYTES,
            max_pixels: MAX_PIXELS,
            max_dimension: MAX_DIMENSION,
            default_jpeg_quality: 85,
            default_background: [255, 255, 255],
            processing_timeout: DEFAULT_PROCESSING_TIMEOUT,
            max_rss_bytes: DEFAULT_MAX_RSS_BYTES,
        }
    }
}

pub fn check_file_size(len: u64, config: &EngineConfig) -> Result<()> {
    if len > config.max_file_size_bytes {
        return Err(OpenPixelError::LimitExceeded(format!(
            "input file is {len} bytes, limit is {} bytes",
            config.max_file_size_bytes
        )));
    }
    Ok(())
}

pub fn check_dimensions(width: u32, height: u32, config: &EngineConfig) -> Result<()> {
    if width == 0 || height == 0 {
        return Err(OpenPixelError::InvalidArgument(
            "image has zero width or height".to_string(),
        ));
    }
    if width > config.max_dimension || height > config.max_dimension {
        return Err(OpenPixelError::LimitExceeded(format!(
            "dimension {width}x{height} exceeds max dimension {}",
            config.max_dimension
        )));
    }
    let pixels = width as u64 * height as u64;
    if pixels > config.max_pixels {
        return Err(OpenPixelError::LimitExceeded(format!(
            "{pixels} pixels exceeds max {0} pixels (decompression-bomb guard)",
            config.max_pixels
        )));
    }
    Ok(())
}

/// Reject path traversal (`..`, absolute escapes) and NUL bytes.
/// Callers must still join the result under their own output directory.
pub fn validate_output_path(path: &Path) -> Result<PathBuf> {
    let s = path.to_string_lossy();
    if s.contains('\0') {
        return Err(OpenPixelError::UnsafePath(path.to_path_buf()));
    }
    for component in path.components() {
        if let std::path::Component::ParentDir = component {
            return Err(OpenPixelError::UnsafePath(path.to_path_buf()));
        }
    }
    Ok(path.to_path_buf())
}

/// Parse a background colour: "white", "black", or "#RRGGBB".
pub fn parse_background(s: &str) -> Result<[u8; 3]> {
    match s.trim().to_ascii_lowercase().as_str() {
        "white" => Ok([255, 255, 255]),
        "black" => Ok([0, 0, 0]),
        other => {
            let hex = other.strip_prefix('#').unwrap_or(other);
            if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
                let r = u8::from_str_radix(&hex[0..2], 16).map_err(|_| {
                    OpenPixelError::InvalidArgument(format!("invalid background '{s}'"))
                })?;
                let g = u8::from_str_radix(&hex[2..4], 16).map_err(|_| {
                    OpenPixelError::InvalidArgument(format!("invalid background '{s}'"))
                })?;
                let b = u8::from_str_radix(&hex[4..6], 16).map_err(|_| {
                    OpenPixelError::InvalidArgument(format!("invalid background '{s}'"))
                })?;
                Ok([r, g, b])
            } else {
                Err(OpenPixelError::InvalidArgument(format!(
                    "invalid background '{s}' — use white, black, or #RRGGBB"
                )))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_oversize_and_huge_dimensions() {
        let cfg = EngineConfig::default();
        assert!(check_file_size(MAX_FILE_SIZE_BYTES + 1, &cfg).is_err());
        assert!(check_dimensions(20000, 10, &cfg).is_err());
        assert!(check_dimensions(20000, 20000, &cfg).is_err());
        assert!(check_dimensions(100, 100, &cfg).is_ok());
    }

    #[test]
    fn rejects_parent_dir_paths() {
        assert!(validate_output_path(Path::new("../evil.png")).is_err());
        assert!(validate_output_path(Path::new("out/photo.png")).is_ok());
    }

    #[test]
    fn parses_backgrounds() {
        assert_eq!(parse_background("white").unwrap(), [255, 255, 255]);
        assert_eq!(parse_background("#ff0000").unwrap(), [255, 0, 0]);
        assert!(parse_background("purple").is_err());
    }
}
