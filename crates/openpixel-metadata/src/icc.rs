//! ICC profile handling.
//!
//! Detection and description parsing are byte-level (the ICC header
//! and tag table are simple fixed-offset structures). Colour
//! conversion itself is a real transform via `tintbox` 0.5.0 (MIT) —
//! a pure-Rust reimplementation of LittleCMS, verified by its
//! authors as bit-identical to lcms2 by differential testing. No
//! system `liblcms2` is needed, so this builds anywhere the engine
//! builds.
//!
//! Evaluation note (see `docs/CODECS.md`): the `lcms2` Rust crate
//! (MIT) wraps the C library and needs `liblcms2-dev` headers at
//! build time — this machine has only the runtime `liblcms2.so.2`,
//! no headers, and adding a system build dependency for one
//! transform was rejected in favour of the pure-Rust tintbox, which
//! was verified to build and transform here. If tintbox ever becomes
//! unmaintained, `lcms2` + `liblcms2-dev` (apt candidate 2.14) is
//! the documented fallback — the `convert_to_srgb` API does not
//! change.

use crate::error::{MetadataError, MetadataResult};
use crate::types::IccProfile;
use openpixel_codecs::{DecodedImage, PixelFormat};

/// Parse an ICC profile header + `desc` tag. Returns `None` when
/// the bytes are not a plausible ICC profile (too short, bad size);
/// a profile with an unreadable description still parses, with
/// `description: None`.
pub fn parse_icc(bytes: &[u8]) -> Option<IccProfile> {
    if bytes.len() < 132 {
        return None;
    }
    let size = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    if size == 0 || size > bytes.len() + 1024 {
        return None;
    }
    // ICC signature "acsp" at offset 36.
    if &bytes[36..40] != b"acsp" {
        return None;
    }
    let class = String::from_utf8_lossy(&bytes[12..16]).trim().to_string();
    let profile_class = match class.as_str() {
        "scnr" => "Input",
        "mntr" => "Display",
        "prtr" => "Output",
        "link" => "DeviceLink",
        "spac" => "ColorSpace",
        "abst" => "Abstract",
        "nmcl" => "NamedColor",
        _ => "Unknown",
    }
    .to_string();
    let color_space = String::from_utf8_lossy(&bytes[16..20]).trim().to_string();
    let description = read_icc_description(bytes);
    let is_srgb = description
        .as_deref()
        .is_some_and(|d| d.to_ascii_lowercase().contains("srgb"));
    Some(IccProfile {
        size_bytes: bytes.len(),
        color_space,
        profile_class,
        description,
        is_srgb,
    })
}

/// Read the `desc` tag's ASCII text, if the tag table has one.
fn read_icc_description(bytes: &[u8]) -> Option<String> {
    let tag_count = u32::from_be_bytes([bytes[128], bytes[129], bytes[130], bytes[131]]) as usize;
    if tag_count > 4096 {
        return None;
    }
    for i in 0..tag_count {
        let base = 132usize.checked_add(i.checked_mul(12)?)?;
        let entry = bytes.get(base..base.checked_add(12)?)?;
        if &entry[0..4] != b"desc" {
            continue;
        }
        let offset = u32::from_be_bytes([entry[4], entry[5], entry[6], entry[7]]) as usize;
        let size = u32::from_be_bytes([entry[8], entry[9], entry[10], entry[11]]) as usize;
        let tag = bytes.get(offset..offset.checked_add(size)?)?;
        if tag.len() < 8 {
            return None;
        }
        return match &tag[0..4] {
            b"desc" => read_text_description(tag),
            b"mluc" => read_mluc(tag),
            _ => None,
        };
    }
    None
}

/// ICC v2 `textDescription`: type sig, reserved, ASCII count, ASCII bytes.
fn read_text_description(tag: &[u8]) -> Option<String> {
    if tag.len() < 12 {
        return None;
    }
    let ascii_len = u32::from_be_bytes([tag[8], tag[9], tag[10], tag[11]]) as usize;
    let ascii = tag.get(12..12usize.checked_add(ascii_len)?)?;
    let text = String::from_utf8_lossy(ascii);
    let text = text.trim_end_matches('\0').trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// ICC v4 `multiLocalizedUnicode`: type sig, reserved, record
/// count, record size, then 12-byte records (language, country,
/// length, offset) and UTF-16BE strings. The first record wins.
fn read_mluc(tag: &[u8]) -> Option<String> {
    if tag.len() < 16 {
        return None;
    }
    let count = u32::from_be_bytes([tag[8], tag[9], tag[10], tag[11]]) as usize;
    if count == 0 {
        return None;
    }
    let record_size = u32::from_be_bytes([tag[12], tag[13], tag[14], tag[15]]) as usize;
    if record_size < 12 {
        return None;
    }
    let record = tag.get(16..16usize.checked_add(record_size)?)?;
    let length = u32::from_be_bytes([record[4], record[5], record[6], record[7]]) as usize;
    let offset = u32::from_be_bytes([record[8], record[9], record[10], record[11]]) as usize;
    let raw = tag.get(offset..offset.checked_add(length)?)?;
    let units: Vec<u16> = raw
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| u16::from_be_bytes([c[0], c[1]]))
        .collect();
    let text = String::from_utf16_lossy(&units);
    let text = text.trim_end_matches('\0').trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Convert an RGB/RGBA8 image from its embedded ICC profile to
/// sRGB, using a real tintbox (LittleCMS-equivalent) transform with
/// the relative-colorimetric intent. The alpha channel is copied
/// through untouched. Returns the image unchanged when the profile
/// already describes sRGB, and an error when the profile is not an
/// RGB profile or the transform cannot be built — the caller decides
/// whether to fail the conversion or warn and continue.
pub fn convert_to_srgb(image: &DecodedImage, icc_bytes: &[u8]) -> MetadataResult<DecodedImage> {
    let profile = parse_icc(icc_bytes).ok_or_else(|| {
        MetadataError::Colour("embedded ICC profile is not parseable".to_string())
    })?;
    if profile.color_space != "RGB" {
        return Err(MetadataError::Colour(format!(
            "ICC colour space '{}' cannot be converted to sRGB in Phase 5 (RGB only)",
            profile.color_space
        )));
    }
    if profile.is_srgb {
        return Ok(image.clone());
    }
    let src = tintbox::profile::Profile::open(icc_bytes).map_err(|e| {
        MetadataError::Colour(format!("tintbox could not open the ICC profile: {e}"))
    })?;
    let srgb_writable = tintbox::profile::virtuals::build_srgb_profile();
    let srgb = tintbox::profile::Profile::from_writable(&srgb_writable).map_err(|e| {
        MetadataError::Colour(format!("tintbox could not build the sRGB profile: {e}"))
    })?;
    let intent = tintbox::profile::RenderingIntent::RelativeColorimetric;
    let n_pixels = image
        .width
        .checked_mul(image.height)
        .ok_or_else(|| MetadataError::Colour("image dimensions overflow".to_string()))?
        as usize;
    let (in_fmt, out_fmt, flags) = match image.pixel_format {
        PixelFormat::Rgb8 => (
            tintbox::format::decode::TYPE_RGB_8,
            tintbox::format::decode::TYPE_RGB_8,
            tintbox::transform::Flags::NOOPTIMIZE,
        ),
        PixelFormat::Rgba8 => (
            tintbox::format::decode::TYPE_RGBA_8,
            tintbox::format::decode::TYPE_RGBA_8,
            // Without COPY_ALPHA the transform leaves the extra
            // channel zeroed; alpha must pass through untouched.
            tintbox::transform::Flags::NOOPTIMIZE.union(tintbox::transform::Flags::COPY_ALPHA),
        ),
        other => {
            return Err(MetadataError::Colour(format!(
                "ICC conversion needs RGB8/RGBA8 pixels, got {}",
                other.name()
            )));
        }
    };
    let transform = tintbox::transform::Transform::new_with_formats(
        &[&src, &srgb],
        &[intent, intent],
        &[false, false],
        &[1.0, 1.0],
        flags,
        in_fmt,
        out_fmt,
    )
    .map_err(|e| MetadataError::Colour(format!("tintbox could not build the transform: {e}")))?;
    let mut out_data = vec![0u8; image.data.len()];
    transform.do_transform(&image.data, &mut out_data, n_pixels);
    Ok(DecodedImage {
        width: image.width,
        height: image.height,
        pixel_format: image.pixel_format,
        data: out_data,
        is_animated: image.is_animated,
        frame_count: image.frame_count,
        note: image.note.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{adobe_icc, srgb_icc};
    use openpixel_codecs::{DecodedImage, PixelFormat};

    fn rgb_image(data: Vec<u8>) -> DecodedImage {
        DecodedImage {
            width: 2,
            height: 1,
            pixel_format: PixelFormat::Rgb8,
            data,
            is_animated: false,
            frame_count: None,
            note: None,
        }
    }

    #[test]
    fn parses_srgb_and_adobe_profiles() {
        let srgb = parse_icc(&srgb_icc()).expect("sRGB parses");
        assert_eq!(srgb.color_space, "RGB");
        assert_eq!(srgb.profile_class, "Display");
        assert!(srgb.is_srgb);
        assert!(srgb.description.as_deref().unwrap().contains("sRGB"));

        let adobe = parse_icc(&adobe_icc()).expect("Adobe parses");
        assert_eq!(adobe.color_space, "RGB");
        assert!(!adobe.is_srgb);
        assert!(adobe.description.as_deref().unwrap().contains("Adobe RGB"));
    }

    #[test]
    fn short_or_garbage_bytes_are_not_a_profile() {
        assert!(parse_icc(&[]).is_none());
        assert!(parse_icc(&[0u8; 200]).is_none());
    }

    #[test]
    fn srgb_to_srgb_is_identity() {
        let img = rgb_image(vec![255, 0, 0, 0, 128, 255]);
        let out = convert_to_srgb(&img, &srgb_icc()).unwrap();
        assert_eq!(out.data, img.data);
    }

    #[test]
    fn adobe_rgb_red_converts_to_a_different_srgb_value() {
        // Pure Adobe RGB red (255,0,0) is outside the sRGB gamut's
        // red primary, so the sRGB encoding of the same colour must
        // differ from the input bytes — this proves a real transform
        // ran, not an identity copy.
        let img = rgb_image(vec![255, 0, 0, 128, 128, 128]);
        let out = convert_to_srgb(&img, &adobe_icc()).unwrap();
        assert_eq!((out.width, out.height), (2, 1));
        assert_ne!(
            out.data, img.data,
            "Adobe red must change under sRGB conversion"
        );
        // The converted red is still a strong red, and mid-grey is
        // essentially unchanged (grey is on the neutral axis).
        assert!(out.data[0] > 200, "red stays strong: {:?}", out.data);
        assert!(out.data[1] < 80, "green stays low: {:?}", out.data);
        assert!(
            (out.data[3] as i32 - 128).abs() <= 3,
            "grey barely moves: {:?}",
            out.data
        );
    }

    #[test]
    fn rgba_keeps_alpha_through_conversion() {
        let img = DecodedImage {
            width: 1,
            height: 1,
            pixel_format: PixelFormat::Rgba8,
            data: vec![255, 0, 0, 128],
            is_animated: false,
            frame_count: None,
            note: None,
        };
        let out = convert_to_srgb(&img, &adobe_icc()).unwrap();
        assert_eq!(out.data[3], 128, "alpha is copied, not transformed");
        assert_eq!(out.pixel_format, PixelFormat::Rgba8);
    }

    #[test]
    fn non_rgb_profile_is_an_honest_error() {
        // A grey profile: build one from the sRGB bytes and patch
        // the colour-space signature to GRAY.
        let mut grey = srgb_icc();
        grey[16..20].copy_from_slice(b"GRAY");
        let img = rgb_image(vec![10, 20, 30, 40, 50, 60]);
        assert!(convert_to_srgb(&img, &grey).is_err());
    }

    #[test]
    fn garbage_profile_is_an_error_not_a_panic() {
        let img = rgb_image(vec![10, 20, 30, 40, 50, 60]);
        assert!(convert_to_srgb(&img, &[0u8; 200]).is_err());
        assert!(convert_to_srgb(&img, b"not an icc profile at all, far too short").is_err());
    }
}
