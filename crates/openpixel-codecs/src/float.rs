//! Helpers shared by the float (HDR/EXR) codecs.
//!
//! Phase 3 decodes HDR/EXR to 8-bit SDR: the canonical `DecodedImage`
//! has no float pixel format yet, so values above 1.0 are clamped on
//! decode and encode starts from 8-bit data scaled to 0.0–1.0. A full
//! float pipeline (no clamping, 16-bit half-float EXR) is a later
//! phase — the adapters say so in their `note`, they do not pretend
//! the clamp does not happen.

use crate::types::DecodedImage;

/// Note attached to every image decoded from a float source.
pub const CLAMP_NOTE: &str =
    "HDR values clamped to 8-bit SDR in Phase 3; full float pipeline is a later phase";

/// RGB8 pixels as native-endian f32 bytes (0.0–1.0), for encoders
/// that only accept `Rgb32F` (HDR, EXR).
pub fn rgb32f_bytes(image: &DecodedImage) -> Vec<u8> {
    let rgb = image.to_dynamic().to_rgb8();
    let mut out = Vec::with_capacity(rgb.len() * 4);
    for v in rgb.as_raw() {
        out.extend_from_slice(&(*v as f32 / 255.0).to_ne_bytes());
    }
    out
}

/// RGBA8 pixels as native-endian f32 bytes (0.0–1.0), for the EXR
/// encoder when the source has alpha.
pub fn rgba32f_bytes(image: &DecodedImage) -> Vec<u8> {
    let rgba = image.to_dynamic().to_rgba8();
    let mut out = Vec::with_capacity(rgba.len() * 4);
    for v in rgba.as_raw() {
        out.extend_from_slice(&(*v as f32 / 255.0).to_ne_bytes());
    }
    out
}

/// True when the decoded image came from a float source. Callers
/// check this *before* `DecodedImage::from_dynamic` converts it,
/// because after conversion the float origin is no longer visible.
pub fn is_float_source(dynamic: &image::DynamicImage) -> bool {
    matches!(
        dynamic.color(),
        image::ColorType::Rgb32F | image::ColorType::Rgba32F
    )
}

/// Build the canonical image from a float dynamic image, with the
/// honest clamp note attached. `from_dynamic` maps Rgb32F/Rgba32F to
/// Rgba8 via `to_rgba8`, which clamps — the note records that.
pub fn from_float_dynamic(dynamic: &image::DynamicImage) -> DecodedImage {
    let mut img = DecodedImage::from_dynamic(dynamic);
    img.note = Some(CLAMP_NOTE.to_string());
    img
}
