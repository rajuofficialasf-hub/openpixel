//! Container-level metadata extraction.
//!
//! Reads the metadata blocks out of each container's own structure:
//! JPEG APP1 (EXIF/XMP) + APP2 (ICC), PNG chunks (`eXIf`, `iCCP`,
//! `iTXt`/`tEXt` XMP, `pHYs` resolution), TIFF IFDs directly, WebP
//! RIFF chunks (`EXIF`, `ICCP`, `XMP `). Every scan is bounds
//! checked; a truncated or inconsistent block is reported in
//! `Metadata::warnings` and the rest of the file still parses.
//! Nothing here allocates beyond the metadata itself, and no pixel
//! data is decoded.

use crate::exif::parse_tiff_exif;
use crate::icc::parse_icc;
use crate::types::Metadata;
use flate2::read::ZlibDecoder;
use openpixel_formats::ImageFormat;
use std::io::Read;

/// Cap on a single zlib-decompressed metadata block (PNG `iCCP`
/// profile, `zTXt` / compressed `iTXt` XMP). The compressed input is
/// already bounded by the engine's 100 MiB file limit, but zlib
/// expansion can be ~1000x, so an uncapped `read_to_end` would let a
/// few-KiB chunk allocate gigabytes (decompression bomb). Real ICC
/// profiles are a few hundred KiB at most and XMP packets are far
/// smaller than this; anything over the cap is treated as corrupt
/// metadata (warning + drop), never as a crash. Fixed in Phase 9.
const MAX_DECOMPRESSED_METADATA_BYTES: usize = 16 * 1024 * 1024;

/// Decompress `decoder` with the cap above. Returns `None` (with a
/// warning) when the stream errors or expands past the cap.
fn read_decompressed_capped(
    decoder: ZlibDecoder<&[u8]>,
    what: &str,
    warnings: &mut Vec<String>,
) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    match decoder
        .take(MAX_DECOMPRESSED_METADATA_BYTES as u64 + 1)
        .read_to_end(&mut out)
    {
        Ok(_) if out.len() > MAX_DECOMPRESSED_METADATA_BYTES => {
            warnings.push(format!(
                "{what} decompresses past the {MAX_DECOMPRESSED_METADATA_BYTES} byte limit; dropping it"
            ));
            None
        }
        Ok(_) => Some(out),
        Err(e) => {
            warnings.push(format!("{what} failed to decompress: {e}"));
            None
        }
    }
}

/// Extract metadata from raw file bytes of the given (detected)
/// format. Formats without a metadata container return an empty
/// `Metadata` — never an error.
pub fn extract_metadata(bytes: &[u8], format: ImageFormat) -> Metadata {
    match format {
        ImageFormat::Jpeg => extract_jpeg(bytes),
        ImageFormat::Png => extract_png(bytes),
        ImageFormat::Tiff => extract_tiff(bytes),
        ImageFormat::Webp => extract_webp(bytes),
        _ => Metadata::default(),
    }
}

fn apply_exif(meta: &mut Metadata, tiff: &[u8]) {
    meta.has_exif = true;
    meta.raw_exif_tiff = Some(tiff.to_vec());
    let (tags, warnings) = parse_tiff_exif(tiff);
    meta.warnings.extend(warnings);
    meta.orientation = tags.orientation;
    meta.make = tags.make;
    meta.model = tags.model;
    meta.date_time = tags.date_time;
    meta.date_time_original = tags.date_time_original;
    meta.software = tags.software;
    meta.artist = tags.artist;
    meta.description = tags.description;
    meta.gps = tags.gps;
    meta.x_resolution = tags.x_resolution;
    meta.y_resolution = tags.y_resolution;
    meta.resolution_unit = tags.resolution_unit;
}

fn apply_icc(meta: &mut Metadata, icc: &[u8]) {
    match parse_icc(icc) {
        Some(profile) => {
            meta.icc = Some(profile);
            meta.raw_icc = Some(icc.to_vec());
        }
        None => meta
            .warnings
            .push("ICC profile found but its header is not parseable".to_string()),
    }
}

fn apply_xmp(meta: &mut Metadata, xmp: &[u8]) {
    meta.has_xmp = true;
    meta.raw_xmp = Some(xmp.to_vec());
    match std::str::from_utf8(xmp) {
        Ok(text) => meta.xmp = Some(text.to_string()),
        Err(_) => meta
            .warnings
            .push("XMP packet is not valid UTF-8; kept as raw bytes only".to_string()),
    }
}

// ---- JPEG ---------------------------------------------------------------

const XMP_NAMESPACE: &[u8] = b"http://ns.adobe.com/xap/1.0/\x00";

fn extract_jpeg(bytes: &[u8]) -> Metadata {
    let mut meta = Metadata::default();
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        meta.warnings
            .push("not a JPEG (missing SOI marker)".to_string());
        return meta;
    }
    // ICC APP2 segments arrive in numbered chunks; collect them.
    let mut icc_chunks: Vec<Option<Vec<u8>>> = Vec::new();
    let mut icc_total: Option<usize> = None;
    let mut pos = 2usize;
    while pos + 4 <= bytes.len() {
        if bytes[pos] != 0xFF {
            break;
        }
        let marker = bytes[pos + 1];
        if marker == 0xD9 {
            break; // EOI
        }
        // Standalone markers have no length field.
        if marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            pos += 2;
            continue;
        }
        if marker == 0xDA {
            break; // SOS — entropy data follows; no more segments.
        }
        let len = u16::from_be_bytes([bytes[pos + 2], bytes[pos + 3]]) as usize;
        if len < 2 || pos + 2 + len > bytes.len() {
            meta.warnings.push(format!(
                "JPEG segment marker 0xFF{marker:02X} has a truncated length; stopping the metadata scan"
            ));
            break;
        }
        let data = &bytes[pos + 4..pos + 2 + len];
        match marker {
            0xE1 => {
                if data.starts_with(b"Exif\x00\x00") {
                    meta.raw_exif_app1 = Some(data.to_vec());
                    apply_exif(&mut meta, &data[6..]);
                } else if data.starts_with(XMP_NAMESPACE) {
                    apply_xmp(&mut meta, &data[XMP_NAMESPACE.len()..]);
                }
            }
            0xE2 if data.starts_with(b"ICC_PROFILE\x00") && data.len() >= 14 => {
                let chunk_no = data[12] as usize;
                let chunk_total = data[13] as usize;
                if chunk_total == 0 || chunk_no == 0 || chunk_no > chunk_total {
                    meta.warnings.push(format!(
                        "ICC APP2 chunk {chunk_no}/{chunk_total} has an invalid index"
                    ));
                } else {
                    if icc_total.is_none() {
                        icc_total = Some(chunk_total);
                        icc_chunks = vec![None; chunk_total];
                    }
                    if Some(chunk_total) == icc_total && chunk_no <= chunk_total {
                        icc_chunks[chunk_no - 1] = Some(data[14..].to_vec());
                    }
                }
            }
            _ => {}
        }
        pos += 2 + len;
    }
    if let Some(total) = icc_total {
        if icc_chunks.iter().all(|c| c.is_some()) {
            let mut icc = Vec::new();
            for chunk in icc_chunks.into_iter().flatten() {
                icc.extend_from_slice(&chunk);
            }
            apply_icc(&mut meta, &icc);
        } else {
            meta.warnings.push(format!(
                "ICC profile is incomplete: only {}/{} APP2 chunks present",
                icc_chunks.iter().filter(|c| c.is_some()).count(),
                total
            ));
        }
    }
    meta
}

// ---- PNG ----------------------------------------------------------------

fn extract_png(bytes: &[u8]) -> Metadata {
    let mut meta = Metadata::default();
    if bytes.len() < 8 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        meta.warnings.push("not a PNG (bad signature)".to_string());
        return meta;
    }
    let mut pos = 8usize;
    while pos + 8 <= bytes.len() {
        let len = u32::from_be_bytes([bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]])
            as usize;
        let chunk_type = &bytes[pos + 4..pos + 8];
        let data_start = pos + 8;
        let Some(data_end) = data_start.checked_add(len) else {
            break;
        };
        let Some(data) = bytes.get(data_start..data_end) else {
            meta.warnings
                .push("PNG chunk extends past the end of the file".to_string());
            break;
        };
        match chunk_type {
            b"eXIf" => apply_exif(&mut meta, data),
            b"iCCP" => {
                if let Some(icc) = parse_png_iccp(data, &mut meta.warnings) {
                    apply_icc(&mut meta, &icc);
                }
            }
            b"iTXt" | b"tEXt" | b"zTXt" => {
                if let Some(xmp) = parse_png_text_xmp(chunk_type, data, &mut meta.warnings) {
                    apply_xmp(&mut meta, &xmp);
                }
            }
            b"pHYs" if data.len() >= 9 && data[8] == 1 => {
                // Pixels per metre -> dots per inch.
                let ppux = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as f64;
                let ppuy = u32::from_be_bytes([data[4], data[5], data[6], data[7]]) as f64;
                meta.x_resolution = Some(ppux * 0.0254);
                meta.y_resolution = Some(ppuy * 0.0254);
                meta.resolution_unit = Some(2);
            }
            _ => {}
        }
        // data + 4 CRC bytes; a truncated CRC ends the scan silently.
        let Some(next) = data_end.checked_add(4) else {
            break;
        };
        if next > bytes.len() {
            break;
        }
        pos = next;
        if chunk_type == b"IEND" {
            break;
        }
    }
    meta
}

/// PNG `iCCP`: profile name NUL, compression method byte (0 =
/// zlib), zlib-compressed profile.
fn parse_png_iccp(data: &[u8], warnings: &mut Vec<String>) -> Option<Vec<u8>> {
    let nul = data.iter().position(|&b| b == 0)?;
    let rest = data.get(nul + 1..)?;
    if rest.first() != Some(&0) {
        warnings.push("PNG iCCP chunk has an unknown compression method".to_string());
        return None;
    }
    let decoder = ZlibDecoder::new(&rest[1..]);
    read_decompressed_capped(decoder, "PNG iCCP profile", warnings)
}

/// PNG text chunks carrying XMP (keyword `XML:com.adobe.xmp`).
fn parse_png_text_xmp(
    chunk_type: &[u8],
    data: &[u8],
    warnings: &mut Vec<String>,
) -> Option<Vec<u8>> {
    const KEYWORD: &[u8] = b"XML:com.adobe.xmp";
    match chunk_type {
        b"tEXt" => {
            let nul = data.iter().position(|&b| b == 0)?;
            if &data[..nul] == KEYWORD {
                Some(data[nul + 1..].to_vec())
            } else {
                None
            }
        }
        b"zTXt" => {
            let nul = data.iter().position(|&b| b == 0)?;
            if &data[..nul] != KEYWORD || data.get(nul + 1) != Some(&0) {
                return None;
            }
            let decoder = ZlibDecoder::new(&data[nul + 2..]);
            read_decompressed_capped(decoder, "PNG zTXt XMP", warnings)
        }
        b"iTXt" => {
            // keyword NUL, compression flag, compression method,
            // language tag NUL, translated keyword NUL, text.
            let nul = data.iter().position(|&b| b == 0)?;
            if &data[..nul] != KEYWORD {
                return None;
            }
            let rest = data.get(nul + 1..)?;
            if rest.len() < 2 {
                return None;
            }
            let (compressed, method) = (rest[0], rest[1]);
            if compressed == 1 && method != 0 {
                warnings.push("PNG iTXt XMP has an unknown compression method".to_string());
                return None;
            }
            let after_lang = rest.get(2..)?;
            let lang_end = after_lang.iter().position(|&b| b == 0)?;
            let after_translated = after_lang.get(lang_end + 1..)?;
            let trans_end = after_translated.iter().position(|&b| b == 0)?;
            let text = &after_translated[trans_end + 1..];
            if compressed == 1 {
                let decoder = ZlibDecoder::new(text);
                read_decompressed_capped(decoder, "PNG iTXt XMP", warnings)
            } else {
                Some(text.to_vec())
            }
        }
        _ => None,
    }
}

// ---- TIFF ----------------------------------------------------------------

fn extract_tiff(bytes: &[u8]) -> Metadata {
    let mut meta = Metadata::default();
    if bytes.len() < 8 || (&bytes[..2] != b"II" && &bytes[..2] != b"MM") {
        meta.warnings
            .push("not a TIFF (bad byte-order mark)".to_string());
        return meta;
    }
    apply_exif(&mut meta, bytes);
    meta
}

// ---- WebP -----------------------------------------------------------------

fn extract_webp(bytes: &[u8]) -> Metadata {
    let mut meta = Metadata::default();
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        meta.warnings
            .push("not a WebP (bad RIFF/WEBP header)".to_string());
        return meta;
    }
    let mut pos = 12usize;
    while pos + 8 <= bytes.len() {
        let fourcc = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes([
            bytes[pos + 4],
            bytes[pos + 5],
            bytes[pos + 6],
            bytes[pos + 7],
        ]) as usize;
        let data_start = pos + 8;
        let Some(data) = data_start
            .checked_add(size)
            .and_then(|end| bytes.get(data_start..end))
        else {
            meta.warnings
                .push("WebP chunk extends past the end of the file".to_string());
            break;
        };
        match fourcc {
            b"EXIF" => {
                // The chunk is the raw TIFF header; some writers
                // prefix it, so scan the first bytes for II/MM.
                let tiff = find_tiff_start(data).unwrap_or(data);
                apply_exif(&mut meta, tiff);
            }
            b"ICCP" => apply_icc(&mut meta, data),
            b"XMP " => apply_xmp(&mut meta, data),
            _ => {}
        }
        // Chunks are padded to even sizes.
        let Some(next) = data_start.checked_add(size + (size % 2)) else {
            break;
        };
        pos = next;
    }
    meta
}

fn find_tiff_start(data: &[u8]) -> Option<&[u8]> {
    for i in 0..data.len().saturating_sub(1) {
        if &data[i..i + 2] == b"II" || &data[i..i + 2] == b"MM" {
            return Some(&data[i..]);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{
        adobe_icc, ascii, build_tiff, jpeg_with_segments, png_with_chunks, shorts,
        webp_with_chunks, TiffEntry,
    };

    fn exif_tiff() -> Vec<u8> {
        build_tiff(
            &[
                TiffEntry::raw(0x010F, 2, 6, ascii("Canon")),
                TiffEntry::raw(0x0112, 3, 1, shorts(&[6], true)),
            ],
            true,
        )
    }

    fn xmp_packet() -> Vec<u8> {
        b"<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF></rdf:RDF></x:xmpmeta>".to_vec()
    }

    #[test]
    fn jpeg_exif_icc_xmp_all_extracted() {
        let icc = adobe_icc();
        let mut app1_exif = b"Exif\x00\x00".to_vec();
        app1_exif.extend_from_slice(&exif_tiff());
        let mut app2 = b"ICC_PROFILE\x00".to_vec();
        app2.extend_from_slice(&[1, 1]);
        app2.extend_from_slice(&icc);
        let mut app1_xmp = b"http://ns.adobe.com/xap/1.0/\x00".to_vec();
        app1_xmp.extend_from_slice(&xmp_packet());
        let jpeg = jpeg_with_segments(&[(0xE1, app1_exif), (0xE2, app2), (0xE1, app1_xmp)]);
        let meta = extract_metadata(&jpeg, ImageFormat::Jpeg);
        assert!(meta.warnings.is_empty(), "warnings: {:?}", meta.warnings);
        assert!(meta.has_exif);
        assert_eq!(meta.orientation, Some(6));
        assert_eq!(meta.make.as_deref(), Some("Canon"));
        assert!(meta.has_xmp);
        assert!(meta.xmp.as_deref().unwrap().contains("xmpmeta"));
        let icc_profile = meta.icc.expect("ICC parsed");
        assert_eq!(icc_profile.color_space, "RGB");
        assert!(!icc_profile.is_srgb);
        assert!(icc_profile
            .description
            .as_deref()
            .unwrap()
            .contains("Adobe RGB"));
        assert_eq!(meta.raw_icc.as_deref(), Some(icc.as_slice()));
        assert_eq!(meta.raw_exif_tiff.as_deref(), Some(exif_tiff().as_slice()));
    }

    #[test]
    fn jpeg_split_icc_chunks_reassembled() {
        let icc = srgb_icc_for_test();
        let half = icc.len() / 2;
        let mut chunk1 = b"ICC_PROFILE\x00".to_vec();
        chunk1.extend_from_slice(&[1, 2]);
        chunk1.extend_from_slice(&icc[..half]);
        let mut chunk2 = b"ICC_PROFILE\x00".to_vec();
        chunk2.extend_from_slice(&[2, 2]);
        chunk2.extend_from_slice(&icc[half..]);
        let jpeg = jpeg_with_segments(&[(0xE2, chunk1), (0xE2, chunk2)]);
        let meta = extract_metadata(&jpeg, ImageFormat::Jpeg);
        assert!(meta.warnings.is_empty(), "warnings: {:?}", meta.warnings);
        assert_eq!(meta.raw_icc.as_deref(), Some(icc.as_slice()));
        assert!(meta.icc.as_ref().unwrap().is_srgb);
    }

    fn srgb_icc_for_test() -> Vec<u8> {
        crate::test_helpers::srgb_icc()
    }

    #[test]
    fn jpeg_missing_icc_chunk_warns_and_drops_icc() {
        let icc = srgb_icc_for_test();
        let mut chunk1 = b"ICC_PROFILE\x00".to_vec();
        chunk1.extend_from_slice(&[1, 2]);
        chunk1.extend_from_slice(&icc[..10]);
        let jpeg = jpeg_with_segments(&[(0xE2, chunk1)]);
        let meta = extract_metadata(&jpeg, ImageFormat::Jpeg);
        assert!(meta.icc.is_none());
        assert!(!meta.warnings.is_empty());
    }

    #[test]
    fn jpeg_corrupt_app1_does_not_crash_extraction() {
        // APP1 length claims more bytes than the file has.
        let mut jpeg = vec![0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xFF, b'E', b'x'];
        jpeg.extend_from_slice(&[0xFF, 0xD9]);
        let meta = extract_metadata(&jpeg, ImageFormat::Jpeg);
        assert!(!meta.has_exif);
        assert!(!meta.warnings.is_empty());
        // Garbage that looks like EXIF but is not TIFF.
        let mut app1 = b"Exif\x00\x00".to_vec();
        app1.extend_from_slice(b"NOT-A-TIFF-HEADER-AT-ALL");
        let jpeg = jpeg_with_segments(&[(0xE1, app1)]);
        let meta = extract_metadata(&jpeg, ImageFormat::Jpeg);
        assert!(meta.has_exif); // the segment was found
        assert_eq!(meta.orientation, None); // but no tag could be read
        assert!(!meta.warnings.is_empty());
    }

    #[test]
    fn png_exif_iccp_itxt_phys_extracted() {
        use flate2::{write::ZlibEncoder, Compression};
        use std::io::Write;
        let icc = srgb_icc_for_test();
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&icc).unwrap();
        let compressed = encoder.finish().unwrap();
        let mut iccp = b"ICC Profile\x00".to_vec();
        iccp.push(0);
        iccp.extend_from_slice(&compressed);
        let mut itxt = b"XML:com.adobe.xmp\x00".to_vec();
        itxt.extend_from_slice(&[0, 0, 0, 0]);
        itxt.extend_from_slice(&xmp_packet());
        // pHYs: 11811 px/m = 300 dpi, unit metre.
        let mut phys = Vec::new();
        phys.extend_from_slice(&11811u32.to_be_bytes());
        phys.extend_from_slice(&11811u32.to_be_bytes());
        phys.push(1);
        let ihdr = vec![0, 0, 0, 4, 0, 0, 0, 4, 8, 2, 0, 0, 0];
        let png = png_with_chunks(&[
            (b"IHDR", ihdr),
            (b"eXIf", exif_tiff()),
            (b"iCCP", iccp),
            (b"iTXt", itxt),
            (b"pHYs", phys),
        ]);
        let meta = extract_metadata(&png, ImageFormat::Png);
        assert!(meta.warnings.is_empty(), "warnings: {:?}", meta.warnings);
        assert!(meta.has_exif);
        assert_eq!(meta.orientation, Some(6));
        assert!(meta.icc.as_ref().unwrap().is_srgb);
        assert!(meta.has_xmp);
        assert!((meta.x_resolution.unwrap() - 300.0).abs() < 0.01);
        assert_eq!(meta.resolution_unit, Some(2));
    }

    #[test]
    fn tiff_file_is_its_own_exif() {
        let meta = extract_metadata(&exif_tiff(), ImageFormat::Tiff);
        assert!(meta.has_exif);
        assert_eq!(meta.make.as_deref(), Some("Canon"));
        assert_eq!(meta.orientation, Some(6));
    }

    #[test]
    fn webp_exif_iccp_xmp_extracted() {
        let vp8x = vec![0x02 | 0x20 | 0x10, 0, 0, 0, 3, 0, 0, 3, 0, 0]; // A|E|X flags, 4x4 canvas
        let webp = webp_with_chunks(&[
            (b"VP8X", vp8x),
            (b"EXIF", exif_tiff()),
            (b"ICCP", srgb_icc_for_test()),
            (b"XMP ", xmp_packet()),
        ]);
        let meta = extract_metadata(&webp, ImageFormat::Webp);
        assert!(meta.warnings.is_empty(), "warnings: {:?}", meta.warnings);
        assert!(meta.has_exif);
        assert_eq!(meta.orientation, Some(6));
        assert!(meta.icc.as_ref().unwrap().is_srgb);
        assert!(meta.has_xmp);
    }

    #[test]
    fn formats_without_metadata_containers_are_empty() {
        let meta = extract_metadata(b"BMxxxx", ImageFormat::Bmp);
        assert!(!meta.has_exif);
        assert!(meta.warnings.is_empty());
    }

    /// Phase 9: a zlib bomb in a PNG iCCP chunk (a few KiB of
    /// compressed zeros expanding to > 16 MiB) must be dropped with
    /// a warning, not decompressed without bound.
    #[test]
    fn iccp_zlib_bomb_is_dropped_not_decompressed() {
        use flate2::{write::ZlibEncoder, Compression};
        use std::io::Write;
        let bomb = vec![0u8; 20 * 1024 * 1024];
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&bomb).unwrap();
        let compressed = encoder.finish().unwrap();
        assert!(
            compressed.len() < 1024 * 1024,
            "bomb fixture must compress small (got {} bytes)",
            compressed.len()
        );
        let mut iccp = b"Bomb Profile\x00".to_vec();
        iccp.push(0);
        iccp.extend_from_slice(&compressed);
        let mut warnings = Vec::new();
        assert!(parse_png_iccp(&iccp, &mut warnings).is_none());
        assert!(
            warnings
                .iter()
                .any(|w| w.contains("16") && w.contains("limit")),
            "warnings: {warnings:?}"
        );
        // A normal profile still decompresses fine through the same path.
        let icc = srgb_icc_for_test();
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&icc).unwrap();
        let compressed = encoder.finish().unwrap();
        let mut iccp = b"Normal Profile\x00".to_vec();
        iccp.push(0);
        iccp.extend_from_slice(&compressed);
        let mut warnings = Vec::new();
        let back = parse_png_iccp(&iccp, &mut warnings).expect("normal profile decodes");
        assert_eq!(back, icc);
        assert!(warnings.is_empty(), "warnings: {warnings:?}");
    }

    /// Phase 9: the same cap applies to compressed XMP in zTXt.
    #[test]
    fn ztxt_zlib_bomb_is_dropped_not_decompressed() {
        use flate2::{write::ZlibEncoder, Compression};
        use std::io::Write;
        let bomb = vec![0u8; 20 * 1024 * 1024];
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&bomb).unwrap();
        let compressed = encoder.finish().unwrap();
        let mut ztxt = b"XML:com.adobe.xmp\x00".to_vec();
        ztxt.push(0);
        ztxt.extend_from_slice(&compressed);
        let ihdr = vec![0, 0, 0, 4, 0, 0, 0, 4, 8, 2, 0, 0, 0];
        let png = png_with_chunks(&[(b"IHDR", ihdr), (b"zTXt", ztxt)]);
        let meta = extract_metadata(&png, ImageFormat::Png);
        assert!(!meta.has_xmp);
        assert!(
            meta.warnings.iter().any(|w| w.contains("limit")),
            "warnings: {:?}",
            meta.warnings
        );
    }
}
