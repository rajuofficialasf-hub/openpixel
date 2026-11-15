use crate::format::ImageFormat;
use serde::{Deserialize, Serialize};

/// What `info` reports about an image — no pixel data, cheap to obtain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageInfo {
    pub format: ImageFormat,
    pub width: u32,
    pub height: u32,
    /// e.g. "rgba8", "rgb8", "luma8", "rgb16" — from the decoded image.
    pub color_type: String,
    pub has_alpha: bool,
    pub file_size_bytes: u64,
    /// True when the source is animated / multi-frame. Phase 1 decodes
    /// only the first frame/page and says so in `note`.
    pub is_animated: bool,
    pub frame_count: Option<u32>,
    pub note: Option<String>,
}

/// Options for one conversion. Format-specific options live here so a
/// caller cannot apply e.g. JPEG quality to a PNG and silently lose it:
/// quality is only honoured for JPEG/WebP, png_compression only for PNG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvertOptions {
    /// 1..=100. Honoured for JPEG (and WebP in later phases).
    pub quality: Option<u8>,
    /// PNG compression: 0 = fast, 1 = default, 2 = best. Default 1.
    pub png_compression: Option<u8>,
    /// Background for flattening alpha when the target has no alpha.
    pub background: [u8; 3],
    /// Preserve metadata where the encoder supports it. Phase 1: EXIF/ICC
    /// are NOT yet copied — this flag is accepted, recorded, and honoured
    /// only where implemented; see CODECS.md. Default false = strip.
    pub preserve_metadata: bool,
}

impl Default for ConvertOptions {
    fn default() -> Self {
        Self {
            quality: None,
            png_compression: None,
            background: [255, 255, 255],
            preserve_metadata: false,
        }
    }
}

impl ConvertOptions {
    pub fn jpeg_quality(&self, default: u8) -> u8 {
        self.quality.unwrap_or(default).clamp(1, 100)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvertResult {
    pub source_format: ImageFormat,
    pub target_format: ImageFormat,
    pub width: u32,
    pub height: u32,
    pub input_bytes: u64,
    pub output_bytes: u64,
    pub output_path: String,
}
