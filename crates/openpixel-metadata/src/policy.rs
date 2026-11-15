//! Metadata preservation: splicing metadata back into encoded output.
//!
//! The engine encodes pixels first (the codec never sees metadata),
//! then this module splices the source's metadata blocks into the
//! encoded bytes — but only where the target container actually
//! supports them. Anything that cannot be carried is reported in
//! [`PreservationReport::dropped`]; nothing is ever silently
//! claimed as preserved.
//!
//! Per-format preservation matrix (Phase 5, see `docs/API.md`):
//!
//! | target | EXIF | ICC | XMP |
//! |--------|------|-----|-----|
//! | JPEG   | APP1 segment | APP2 `ICC_PROFILE` chunks | APP1 XMP segment |
//! | PNG    | `eXIf` chunk | `iCCP` chunk (zlib) | `iTXt` chunk |
//! | TIFF   | dropped — the image-rs TIFF encoder has no metadata injection; rewriting IFDs byte-level was not attempted |
//! | WebP   | dropped — would need a VP8X extended-format remux; not attempted |
//! | GIF/BMP/TGA/ICO/PNM/QOI/AVIF/JXL/JP2/HDR/EXR/SVG | dropped — no EXIF/ICC/XMP container support in this build |
//!
//! GPS is part of the EXIF block, so it is preserved exactly when
//! EXIF is preserved (and dropped exactly when EXIF is dropped).

use crate::types::{Metadata, MetadataPolicy};
use openpixel_formats::ImageFormat;

/// What actually happened when a policy was applied to one output.
#[derive(Debug, Clone, Default)]
pub struct PreservationReport {
    /// Categories that made it into the output, e.g. `["exif", "icc"]`.
    pub preserved: Vec<&'static str>,
    /// Categories that were requested but could not be carried:
    /// `(category, reason)`.
    pub dropped: Vec<(&'static str, String)>,
}

/// Splice `metadata` into already-encoded `output` bytes for
/// `target`, honouring `policy`. Returns the (possibly unchanged)
/// bytes plus the report. Never fails on corrupt metadata — a
/// missing raw block is reported as dropped, not an error.
pub fn apply_policy(
    target: ImageFormat,
    output: Vec<u8>,
    metadata: &Metadata,
    policy: &MetadataPolicy,
) -> (Vec<u8>, PreservationReport) {
    let mut report = PreservationReport::default();
    let wants_exif = policy.wants_exif() && metadata.has_exif;
    let wants_icc = policy.wants_icc() && metadata.has_icc();
    let wants_xmp = policy.wants_xmp() && metadata.has_xmp;
    if !wants_exif && !wants_icc && !wants_xmp {
        // Nothing requested (Strip / NormalizeOrientation), or the
        // source simply has no metadata of the requested kind.
        return (output, report);
    }
    match target {
        ImageFormat::Jpeg => {
            let mut out = output;
            if wants_exif {
                match &metadata.raw_exif_app1 {
                    Some(app1) => {
                        out = insert_jpeg_app1(out, app1);
                        report.preserved.push("exif");
                    }
                    None => report.dropped.push((
                        "exif",
                        "source EXIF could not be re-read as raw bytes".to_string(),
                    )),
                }
            }
            if wants_icc {
                match &metadata.raw_icc {
                    Some(icc) => {
                        out = insert_jpeg_icc(out, icc);
                        report.preserved.push("icc");
                    }
                    None => report
                        .dropped
                        .push(("icc", "source ICC bytes are unavailable".to_string())),
                }
            }
            if wants_xmp {
                match &metadata.raw_xmp {
                    Some(xmp) => {
                        out = insert_jpeg_xmp(out, xmp);
                        report.preserved.push("xmp");
                    }
                    None => report
                        .dropped
                        .push(("xmp", "source XMP bytes are unavailable".to_string())),
                }
            }
            (out, report)
        }
        ImageFormat::Png => {
            let mut out = output;
            if wants_exif {
                match &metadata.raw_exif_tiff {
                    Some(tiff) => {
                        out = insert_png_chunk(out, b"eXIf", tiff);
                        report.preserved.push("exif");
                    }
                    None => report.dropped.push((
                        "exif",
                        "source EXIF could not be re-read as raw TIFF bytes".to_string(),
                    )),
                }
            }
            if wants_icc {
                match &metadata.raw_icc {
                    Some(icc) => {
                        out = insert_png_iccp(out, icc);
                        report.preserved.push("icc");
                    }
                    None => report
                        .dropped
                        .push(("icc", "source ICC bytes are unavailable".to_string())),
                }
            }
            if wants_xmp {
                match &metadata.raw_xmp {
                    Some(xmp) => {
                        out = insert_png_itxt_xmp(out, xmp);
                        report.preserved.push("xmp");
                    }
                    None => report
                        .dropped
                        .push(("xmp", "source XMP bytes are unavailable".to_string())),
                }
            }
            (out, report)
        }
        _ => {
            if wants_exif {
                report.dropped.push((
                    "exif",
                    format!(
                        "{} has no EXIF container support in Phase 5 (see docs/API.md)",
                        target.id()
                    ),
                ));
            }
            if wants_icc {
                report.dropped.push((
                    "icc",
                    format!(
                        "{} has no ICC container support in Phase 5 (see docs/API.md)",
                        target.id()
                    ),
                ));
            }
            if wants_xmp {
                report.dropped.push((
                    "xmp",
                    format!(
                        "{} has no XMP container support in Phase 5 (see docs/API.md)",
                        target.id()
                    ),
                ));
            }
            (output, report)
        }
    }
}

// ---- JPEG splicing ---------------------------------------------------------

/// Insert an APP1 segment (already including its payload, e.g. the
/// `Exif\0\0` header) right after the SOI marker.
fn insert_jpeg_app1(mut jpeg: Vec<u8>, payload: &[u8]) -> Vec<u8> {
    if jpeg.len() < 2 || jpeg[0] != 0xFF || jpeg[1] != 0xD8 {
        return jpeg;
    }
    let segment_len = payload.len() + 2;
    if segment_len > 0xFFFF {
        return jpeg; // A single APP1 segment cannot hold this.
    }
    let mut segment = Vec::with_capacity(segment_len + 2);
    segment.extend_from_slice(&[0xFF, 0xE1]);
    segment.extend_from_slice(&(segment_len as u16).to_be_bytes());
    segment.extend_from_slice(payload);
    jpeg.splice(2..2, segment);
    jpeg
}

/// Insert an XMP APP1 segment (`http://ns.adobe.com/xap/1.0/\0` +
/// packet) right after the SOI marker.
fn insert_jpeg_xmp(mut jpeg: Vec<u8>, xmp: &[u8]) -> Vec<u8> {
    if jpeg.len() < 2 || jpeg[0] != 0xFF || jpeg[1] != 0xD8 {
        return jpeg;
    }
    let mut payload = b"http://ns.adobe.com/xap/1.0/\x00".to_vec();
    payload.extend_from_slice(xmp);
    let segment_len = payload.len() + 2;
    if segment_len > 0xFFFF {
        return jpeg;
    }
    let mut segment = Vec::with_capacity(segment_len + 2);
    segment.extend_from_slice(&[0xFF, 0xE1]);
    segment.extend_from_slice(&(segment_len as u16).to_be_bytes());
    segment.extend_from_slice(&payload);
    jpeg.splice(2..2, segment);
    jpeg
}

/// Insert ICC APP2 segments (`ICC_PROFILE\0` + chunk index/count),
/// chunked to fit the 64 KiB segment limit, right after SOI.
fn insert_jpeg_icc(mut jpeg: Vec<u8>, icc: &[u8]) -> Vec<u8> {
    if jpeg.len() < 2 || jpeg[0] != 0xFF || jpeg[1] != 0xD8 {
        return jpeg;
    }
    const MAX_CHUNK: usize = 65_519; // 65 535 - 2 (len) - 14 (header)
    let total = icc.chunks(MAX_CHUNK).count().max(1);
    if total > 255 {
        return jpeg; // ICC chunk count is a single byte.
    }
    let mut segments = Vec::new();
    for (i, chunk) in icc.chunks(MAX_CHUNK).enumerate() {
        let mut segment = Vec::with_capacity(chunk.len() + 16);
        segment.extend_from_slice(&[0xFF, 0xE2]);
        segment.extend_from_slice(&((chunk.len() + 16) as u16).to_be_bytes());
        segment.extend_from_slice(b"ICC_PROFILE\x00");
        segment.push((i + 1) as u8);
        segment.push(total as u8);
        segment.extend_from_slice(chunk);
        segments.extend_from_slice(&segment);
    }
    jpeg.splice(2..2, segments);
    jpeg
}

// ---- PNG splicing ------------------------------------------------------------

/// CRC-32 (IEEE, PNG polynomial) over `bytes`.
pub fn png_crc32(bytes: &[u8]) -> u32 {
    const TABLE: [u32; 256] = make_crc_table();
    const fn make_crc_table() -> [u32; 256] {
        let mut table = [0u32; 256];
        let mut i = 0;
        while i < 256 {
            let mut c = i as u32;
            let mut k = 0;
            while k < 8 {
                c = if c & 1 != 0 {
                    0xEDB8_8320 ^ (c >> 1)
                } else {
                    c >> 1
                };
                k += 1;
            }
            table[i] = c;
            i += 1;
        }
        table
    }
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in bytes {
        crc = TABLE[((crc ^ u32::from(b)) & 0xFF) as usize] ^ (crc >> 8);
    }
    crc ^ 0xFFFF_FFFF
}

fn png_chunk(chunk_type: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + 12);
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(chunk_type);
    out.extend_from_slice(data);
    let mut crc_input = Vec::with_capacity(data.len() + 4);
    crc_input.extend_from_slice(chunk_type);
    crc_input.extend_from_slice(data);
    out.extend_from_slice(&png_crc32(&crc_input).to_be_bytes());
    out
}

/// Insert a chunk right after the IHDR chunk (the earliest legal
/// position for `eXIf` / `iCCP` / `iTXt`). If no IHDR is found the
/// bytes are returned unchanged.
fn insert_png_chunk(png: Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let Some(ihdr_end) = png_ihdr_end(&png) else {
        return png;
    };
    let chunk = png_chunk(chunk_type, data);
    let mut out = Vec::with_capacity(png.len() + chunk.len());
    out.extend_from_slice(&png[..ihdr_end]);
    out.extend_from_slice(&chunk);
    out.extend_from_slice(&png[ihdr_end..]);
    out
}

/// Byte offset just past the IHDR chunk (signature + length +
/// type + data + CRC), or `None` when the PNG is malformed.
fn png_ihdr_end(png: &[u8]) -> Option<usize> {
    if png.len() < 8 + 8 || &png[..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let len = u32::from_be_bytes([png[8], png[9], png[10], png[11]]) as usize;
    if &png[12..16] != b"IHDR" {
        return None;
    }
    let end = 8usize.checked_add(8)?.checked_add(len)?.checked_add(4)?;
    if end > png.len() {
        return None;
    }
    Some(end)
}

/// PNG `iCCP`: profile name `ICC Profile`, NUL, compression
/// method 0, zlib-compressed profile bytes.
fn insert_png_iccp(png: Vec<u8>, icc: &[u8]) -> Vec<u8> {
    use flate2::{write::ZlibEncoder, Compression};
    use std::io::Write;
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    if encoder.write_all(icc).is_err() {
        return png;
    }
    let compressed = match encoder.finish() {
        Ok(c) => c,
        Err(_) => return png,
    };
    let mut data = b"ICC Profile\x00".to_vec();
    data.push(0); // compression method: zlib
    data.extend_from_slice(&compressed);
    insert_png_chunk(png, b"iCCP", &data)
}

/// PNG `iTXt` XMP: keyword `XML:com.adobe.xmp`, uncompressed,
/// empty language + translated keyword, packet text.
fn insert_png_itxt_xmp(png: Vec<u8>, xmp: &[u8]) -> Vec<u8> {
    let mut data = b"XML:com.adobe.xmp\x00".to_vec();
    data.push(0); // compression flag: uncompressed
    data.push(0); // compression method
    data.push(0); // empty language tag
    data.push(0); // empty translated keyword
    data.extend_from_slice(xmp);
    insert_png_chunk(png, b"iTXt", &data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::extract_metadata;
    use crate::test_helpers::{
        adobe_icc, ascii, build_tiff, jpeg_with_segments, shorts, TiffEntry,
    };
    use crate::types::MetadataField;
    use image::ImageEncoder;
    use openpixel_formats::ImageFormat;

    /// Metadata with EXIF (orientation 6), an Adobe ICC profile and
    /// an XMP packet, as extracted from a JPEG carrying all three.
    fn full_metadata() -> Metadata {
        let icc = adobe_icc();
        let mut app1_exif = b"Exif\x00\x00".to_vec();
        app1_exif.extend_from_slice(&build_tiff(
            &[
                TiffEntry::raw(0x010F, 2, 6, ascii("Canon")),
                TiffEntry::raw(0x0112, 3, 1, shorts(&[6], true)),
            ],
            true,
        ));
        let mut app2 = b"ICC_PROFILE\x00".to_vec();
        app2.extend_from_slice(&[1, 1]);
        app2.extend_from_slice(&icc);
        let mut app1_xmp = b"http://ns.adobe.com/xap/1.0/\x00".to_vec();
        app1_xmp.extend_from_slice(b"<x:xmpmeta/>");
        let jpeg = jpeg_with_segments(&[(0xE1, app1_exif), (0xE2, app2), (0xE1, app1_xmp)]);
        extract_metadata(&jpeg, ImageFormat::Jpeg)
    }

    fn jpeg_bytes() -> Vec<u8> {
        let img =
            image::RgbImage::from_fn(4, 4, |x, y| image::Rgb([x as u8 * 40, y as u8 * 40, 128]));
        let mut out = Vec::new();
        {
            let mut cursor = std::io::Cursor::new(&mut out);
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 90)
                .encode(&img, 4, 4, image::ExtendedColorType::Rgb8)
                .unwrap();
        }
        out
    }

    fn png_bytes() -> Vec<u8> {
        let img =
            image::RgbImage::from_fn(4, 4, |x, y| image::Rgb([x as u8 * 40, y as u8 * 40, 128]));
        let mut out = Vec::new();
        {
            let mut cursor = std::io::Cursor::new(&mut out);
            image::codecs::png::PngEncoder::new(&mut cursor)
                .write_image(&img, 4, 4, image::ExtendedColorType::Rgb8)
                .unwrap();
        }
        out
    }

    #[test]
    fn crc32_matches_the_standard_check_value() {
        assert_eq!(png_crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(png_crc32(b"IEND"), 0xAE42_6082);
    }

    #[test]
    fn preserve_jpeg_round_trips_all_three_categories() {
        let meta = full_metadata();
        assert!(meta.has_exif && meta.has_icc() && meta.has_xmp);
        let (out, report) = apply_policy(
            ImageFormat::Jpeg,
            jpeg_bytes(),
            &meta,
            &MetadataPolicy::Preserve,
        );
        assert_eq!(report.preserved, vec!["exif", "icc", "xmp"]);
        assert!(report.dropped.is_empty());
        let back = extract_metadata(&out, ImageFormat::Jpeg);
        assert!(back.has_exif);
        assert_eq!(back.orientation, Some(6));
        assert_eq!(back.make.as_deref(), Some("Canon"));
        assert!(back.has_icc());
        assert_eq!(back.raw_icc.as_deref(), meta.raw_icc.as_deref());
        assert!(back.has_xmp);
    }

    #[test]
    fn preserve_png_round_trips_all_three_categories() {
        let meta = full_metadata();
        let (out, report) = apply_policy(
            ImageFormat::Png,
            png_bytes(),
            &meta,
            &MetadataPolicy::Preserve,
        );
        assert_eq!(report.preserved, vec!["exif", "icc", "xmp"]);
        assert!(report.dropped.is_empty());
        let back = extract_metadata(&out, ImageFormat::Png);
        assert!(back.has_exif);
        assert_eq!(back.orientation, Some(6));
        assert!(back.has_icc());
        assert_eq!(back.raw_icc.as_deref(), meta.raw_icc.as_deref());
        assert!(back.has_xmp);
        // The PNG still decodes to the same pixels.
        let decoded = image::load_from_memory(&out).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (4, 4));
    }

    #[test]
    fn preserve_selected_keeps_only_the_chosen_category() {
        let meta = full_metadata();
        let (out, report) = apply_policy(
            ImageFormat::Jpeg,
            jpeg_bytes(),
            &meta,
            &MetadataPolicy::PreserveSelected {
                fields: vec![MetadataField::Icc],
            },
        );
        assert_eq!(report.preserved, vec!["icc"]);
        assert!(report.dropped.is_empty());
        let back = extract_metadata(&out, ImageFormat::Jpeg);
        assert!(!back.has_exif);
        assert!(back.has_icc());
        assert!(!back.has_xmp);
    }

    #[test]
    fn preserve_color_profiles_keeps_only_icc() {
        let meta = full_metadata();
        let (out, report) = apply_policy(
            ImageFormat::Png,
            png_bytes(),
            &meta,
            &MetadataPolicy::PreserveColorProfiles,
        );
        assert_eq!(report.preserved, vec!["icc"]);
        let back = extract_metadata(&out, ImageFormat::Png);
        assert!(!back.has_exif);
        assert!(back.has_icc());
        assert!(!back.has_xmp);
    }

    #[test]
    fn tiff_and_webp_honestly_drop_everything() {
        let meta = full_metadata();
        for target in [ImageFormat::Tiff, ImageFormat::Webp, ImageFormat::Bmp] {
            let (out, report) =
                apply_policy(target, vec![1, 2, 3], &meta, &MetadataPolicy::Preserve);
            assert!(report.preserved.is_empty(), "{target}");
            assert_eq!(report.dropped.len(), 3, "{target}");
            assert_eq!(out, vec![1, 2, 3], "bytes unchanged for {target}");
            assert!(report
                .dropped
                .iter()
                .all(|(_, reason)| reason.contains("no ")));
        }
    }

    #[test]
    fn strip_leaves_bytes_untouched() {
        let meta = full_metadata();
        let input = jpeg_bytes();
        let (out, report) = apply_policy(
            ImageFormat::Jpeg,
            input.clone(),
            &meta,
            &MetadataPolicy::Strip,
        );
        assert_eq!(out, input);
        assert!(report.preserved.is_empty() && report.dropped.is_empty());
    }

    #[test]
    fn policy_names_parse_and_round_trip() {
        assert_eq!(
            MetadataPolicy::from_name("preserve"),
            Some(MetadataPolicy::Preserve)
        );
        assert_eq!(
            MetadataPolicy::from_name("STRIP"),
            Some(MetadataPolicy::Strip)
        );
        assert_eq!(
            MetadataPolicy::from_name("color-profiles"),
            Some(MetadataPolicy::PreserveColorProfiles)
        );
        assert_eq!(
            MetadataPolicy::from_name("normalize-orientation"),
            Some(MetadataPolicy::NormalizeOrientation)
        );
        assert_eq!(
            MetadataPolicy::from_name("selected:exif,icc"),
            Some(MetadataPolicy::PreserveSelected {
                fields: vec![MetadataField::Exif, MetadataField::Icc]
            })
        );
        assert_eq!(MetadataPolicy::from_name("selected:"), None);
        assert_eq!(MetadataPolicy::from_name("selected:bogus"), None);
        assert_eq!(MetadataPolicy::from_name("bogus"), None);
        assert_eq!(MetadataPolicy::Preserve.name(), "preserve");
        assert_eq!(
            MetadataPolicy::PreserveSelected {
                fields: vec![MetadataField::Exif, MetadataField::Xmp]
            }
            .name(),
            "selected:exif,xmp"
        );
    }
}
