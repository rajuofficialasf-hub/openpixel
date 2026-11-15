use serde::{Deserialize, Serialize};

/// What one format can actually do in *this* build.
/// This is data only. Who can do it — which codec is registered — is
/// decided by `openpixel-codecs::CodecRegistry` (Phase 2). The UI / CLI
/// must generate its options from the registry's capabilities, never
/// hard-code a format as supported, and never advertise a false capability.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatCapability {
    pub format_id: &'static str,
    pub extensions: Vec<&'static str>,
    pub mime_types: Vec<&'static str>,
    pub can_decode: bool,
    pub can_encode: bool,
    pub supports_alpha: bool,
    pub supports_animation: bool,
    pub supports_metadata: bool,
    pub supports_icc: bool,
    pub supports_multiple_frames: bool,
    /// e.g. "image-rs 0.25 (pure Rust)" or "libavif (planned, Phase 3)"
    pub native_dependency: &'static str,
    pub license: &'static str,
    /// Short honest note, e.g. "implemented" / "planned — detection only".
    pub status: &'static str,
    pub max_dimension: u32,
}

impl FormatCapability {
    /// Builder for a codec that reports itself to the registry.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        format_id: &'static str,
        extensions: Vec<&'static str>,
        mime_types: Vec<&'static str>,
        can_decode: bool,
        can_encode: bool,
        supports_alpha: bool,
        supports_animation: bool,
        supports_metadata: bool,
        supports_icc: bool,
        supports_multiple_frames: bool,
        native_dependency: &'static str,
        license: &'static str,
        status: &'static str,
        max_dimension: u32,
    ) -> Self {
        Self {
            format_id,
            extensions,
            mime_types,
            can_decode,
            can_encode,
            supports_alpha,
            supports_animation,
            supports_metadata,
            supports_icc,
            supports_multiple_frames,
            native_dependency,
            license,
            status,
            max_dimension,
        }
    }
}
