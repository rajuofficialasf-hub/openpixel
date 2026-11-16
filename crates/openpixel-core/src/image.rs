use openpixel_codecs::EncodeParams;
use openpixel_formats::ImageFormat;
use openpixel_metadata::MetadataPolicy;
use openpixel_pipeline::Pipeline;
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
    /// True when the source is animated / multi-frame. Phase 5
    /// reports the real frame count (GIF / APNG / animated WebP /
    /// multi-page TIFF), not just "first frame".
    pub is_animated: bool,
    pub frame_count: Option<u32>,
    pub note: Option<String>,
    /// EXIF orientation tag (1..=8), when the source carries one.
    pub orientation: Option<u8>,
    pub has_exif: bool,
    pub has_icc: bool,
    pub has_xmp: bool,
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
    /// Preserve metadata where the encoder supports it. Phase 5:
    /// honoured via [`Self::effective_policy`] — `true` means
    /// `MetadataPolicy::Preserve`, `false` means `Strip`, unless
    /// `metadata_policy` is set, which wins. Kept for Phase 1–4
    /// callers; new code should set `metadata_policy` directly.
    pub preserve_metadata: bool,
    /// Metadata policy for this conversion. `None` = fall back to
    /// `preserve_metadata` (above). Default `None` = strip.
    pub metadata_policy: Option<MetadataPolicy>,
    /// Convert only this frame (GIF) / page (TIFF), 0-based.
    /// `None` = first frame/page. For APNG / animated WebP only
    /// frame 0 is extractable in Phase 5 — any other index is an
    /// error, not a silent first-frame substitution.
    pub selected_frame: Option<u32>,
    /// Convert the pixels to sRGB using the source's embedded ICC
    /// profile (real tintbox transform) before encoding. When the
    /// profile already is sRGB this is a no-op; when the source has
    /// no ICC profile, or the transform fails, the pixels are kept
    /// as-is and a warning is recorded — never a silent failure.
    pub convert_to_srgb: bool,
}

impl Default for ConvertOptions {
    fn default() -> Self {
        Self {
            quality: None,
            png_compression: None,
            background: [255, 255, 255],
            preserve_metadata: false,
            metadata_policy: None,
            selected_frame: None,
            convert_to_srgb: false,
        }
    }
}

impl ConvertOptions {
    pub fn jpeg_quality(&self, default: u8) -> u8 {
        self.quality.unwrap_or(default).clamp(1, 100)
    }

    /// The policy that actually applies: an explicit
    /// `metadata_policy` wins; otherwise the legacy
    /// `preserve_metadata` bool maps to Preserve / Strip.
    pub fn effective_policy(&self) -> MetadataPolicy {
        match &self.metadata_policy {
            Some(policy) => policy.clone(),
            None => {
                if self.preserve_metadata {
                    MetadataPolicy::Preserve
                } else {
                    MetadataPolicy::Strip
                }
            }
        }
    }

    /// Translate the engine-level options into the codec-level params.
    /// The codec honours only the fields that apply to its format.
    pub fn to_encode_params(&self) -> EncodeParams {
        EncodeParams {
            quality: self.quality,
            png_compression: self.png_compression,
            background: self.background,
        }
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
    /// Warnings that do not fail the conversion but the caller
    /// should show: animated source flattened to one frame,
    /// metadata dropped because the target cannot carry it, colour
    /// conversion that could not run, corrupt source metadata.
    pub warnings: Vec<String>,
    /// Metadata categories actually written into the output
    /// (e.g. `["exif", "icc"]`) — empty when stripped or dropped.
    pub metadata_preserved: Vec<String>,
    /// Metadata categories requested but not carried, as
    /// `"category: reason"` strings.
    pub metadata_dropped: Vec<String>,
    /// The EXIF orientation transform applied, if any, e.g.
    /// `"EXIF orientation 6 (rotated 90° clockwise) applied"`.
    pub orientation_applied: Option<String>,
}

/// Options for one processed conversion: the encode options plus the
/// pipeline to run between decode and encode. `pipeline` is empty by
/// default, which makes `process` behave exactly like `convert`.
/// (Not serializable: a pipeline can hold a watermark image.)
#[derive(Debug, Clone, Default)]
pub struct ProcessOptions {
    pub convert: ConvertOptions,
    pub pipeline: Pipeline,
}

/// What a target-size search returns, beyond the plain
/// `ConvertResult`: the quality the search settled on (lossy
/// targets only — `None` for PNG, where the compression level is
/// the knob instead), and whether the target was actually met.
/// When `target_met` is false the bytes are still the smallest
/// result the search found, and the warning in `result.warnings`
/// says the target was missed — the caller must show it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetSizeOutcome {
    pub result: ConvertResult,
    pub quality_used: Option<u8>,
    pub target_met: bool,
}

impl ProcessOptions {
    pub fn new(convert: ConvertOptions, pipeline: Pipeline) -> Self {
        Self { convert, pipeline }
    }
}
