//! PDF compression (Studio Phase 3).
//!
//! Two passes, both real:
//!
//! 1. **Image pass** — every embedded image XObject whose drawn
//!    size on the page is known (found in a page content stream as
//!    `… cm /Name Do`) is downscaled to the mode's target DPI and
//!    re-encoded as JPEG (Lanczos3, via the image engine).
//!    Uncompressed (FlateDecode) RGB images are re-encoded as
//!    JPEG at the mode's quality even when no downsampling is
//!    needed — that is where the big saving is for PDFs built
//!    from images. Images that are already JPEG at or under their
//!    target size, carry transparency (`/SMask`), are 1-bit
//!    masks, use a colour space or filter this pass cannot
//!    decode, or are drawn from inside a Form XObject (so no
//!    drawn size can be found) are skipped — and counted, with the
//!    reason recorded, never silently dropped. Re-encoding a JPEG
//!    as a JPEG loses a little quality every time (lossy → lossy);
//!    that is the price of the size, and it is stated in
//!    `docs/PDF.md`.
//!
//! 2. **Structure pass** — lopdf's `Document::compress()` (Flate
//!    every stream that allows it), saved with object streams +
//!    xref streams at compression level 9, optionally with the
//!    `/Info` metadata stripped.
//!
//! **Honesty rule:** the outcome reports the measured input and
//! output sizes. When the compressed file is *larger* than the
//! input and no transformation was requested, the original bytes
//! are returned instead and the note says so — the caller never
//! gets a bigger file labelled "compressed". A requested
//! transformation (metadata strip) is always returned,
//! even when it costs bytes, and the outcome reports the honest
//! (possibly negative) saving. Font subsetting is NOT done:
//! lopdf exposes no API for subsetting fonts that are already
//! embedded, so it is not claimed.

use crate::engine::{inherited_attribute, PdfEngine};
use crate::error::Result;
use lopdf::{Dictionary, Document, Object, ObjectId, SaveOptions, Stream};
use openpixel_core::{ConvertOptions, Engine, ImageFormat};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;

/// Compression mode: the target DPI for embedded images and the
/// JPEG quality used when they are re-encoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CompressMode {
    /// 72 DPI, JPEG quality 50 — smallest, for screens.
    Screen,
    /// 150 DPI, JPEG quality 75 — the balanced default.
    Ebook,
    /// 300 DPI, JPEG quality 90 — print-quality, least loss.
    Printer,
}

impl CompressMode {
    pub fn target_dpi(&self) -> f64 {
        match self {
            CompressMode::Screen => 72.0,
            CompressMode::Ebook => 150.0,
            CompressMode::Printer => 300.0,
        }
    }

    pub fn jpeg_quality(&self) -> u8 {
        match self {
            CompressMode::Screen => 50,
            CompressMode::Ebook => 75,
            CompressMode::Printer => 90,
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        match name.to_ascii_lowercase().as_str() {
            "screen" => Some(CompressMode::Screen),
            "ebook" => Some(CompressMode::Ebook),
            "printer" => Some(CompressMode::Printer),
            _ => None,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            CompressMode::Screen => "screen",
            CompressMode::Ebook => "ebook",
            CompressMode::Printer => "printer",
        }
    }
}

/// Options for [`PdfEngine::compress`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompressOptions {
    /// Strip the document `/Info` metadata (title/author/…).
    pub strip_metadata: bool,
    /// Run the image downsample/re-encode pass. `false` means
    /// structure-only (lossless — used by `optimize(Lossless)`).
    pub images: bool,
}

impl Default for CompressOptions {
    fn default() -> Self {
        Self {
            strip_metadata: false,
            images: true,
        }
    }
}

/// Measured result of one compression. `saved_bytes` is negative
/// when the compressed file was larger (in which case the original
/// bytes are returned and `note` says so).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressOutcome {
    pub mode: CompressMode,
    pub input_bytes: u64,
    pub output_bytes: u64,
    /// Size of the compressed attempt, even when the original was
    /// kept because it was smaller.
    pub compressed_bytes: u64,
    pub saved_bytes: i64,
    /// Percent saved, negative when the attempt was larger.
    pub saved_percent: f64,
    pub images_total: usize,
    pub images_recompressed: usize,
    pub images_skipped: usize,
    /// Why images were skipped (capped at 8 entries; the count
    /// above is exact).
    pub skipped_reasons: Vec<String>,
    pub metadata_stripped: bool,
    pub note: Option<String>,
}

impl PdfEngine {
    /// Compress a PDF: image downsample/re-encode (unless
    /// `options.images` is false) + structure optimisation, saved
    /// with object streams. Returns the output bytes and the
    /// measured outcome. When the compressed file is larger than
    /// the input, the **original** bytes are returned and the
    /// outcome says so.
    pub fn compress(
        &self,
        bytes: &[u8],
        mode: CompressMode,
        options: CompressOptions,
    ) -> Result<(Vec<u8>, CompressOutcome)> {
        self.validate(bytes)?;
        let mut doc = Document::load_mem(bytes)?;
        let input_bytes = bytes.len() as u64;

        let mut outcome = CompressOutcome {
            mode,
            input_bytes,
            output_bytes: input_bytes,
            compressed_bytes: input_bytes,
            saved_bytes: 0,
            saved_percent: 0.0,
            images_total: 0,
            images_recompressed: 0,
            images_skipped: 0,
            skipped_reasons: Vec::new(),
            metadata_stripped: false,
            note: None,
        };

        if options.images {
            self.recompress_images(&mut doc, mode, &mut outcome)?;
        }
        if options.strip_metadata {
            outcome.metadata_stripped = strip_info(&mut doc);
        }

        // Structure pass: Flate every compressible stream, then
        // save with object streams + xref streams at level 9.
        doc.compress();
        let save_options = SaveOptions::builder()
            .use_object_streams(true)
            .use_xref_streams(true)
            .compression_level(9)
            .build();
        let mut compressed = Vec::new();
        doc.save_with_options(&mut Cursor::new(&mut compressed), save_options)?;

        outcome.compressed_bytes = compressed.len() as u64;
        let transformed = options.strip_metadata;
        if (compressed.len() as u64) < input_bytes || transformed {
            // Smaller wins. A requested transformation (metadata
            // strip) is returned even when it costs
            // bytes — the caller asked for the change, and the
            // outcome reports the honest (possibly negative)
            // saving instead of silently returning the original
            // with its metadata still inside.
            outcome.output_bytes = compressed.len() as u64;
            outcome.saved_bytes = input_bytes as i64 - compressed.len() as i64;
            outcome.saved_percent = outcome.saved_bytes as f64 / input_bytes as f64 * 100.0;
            if (compressed.len() as u64) >= input_bytes {
                outcome.note = Some(format!(
                    "output ({} bytes) is larger than the input ({} bytes); the transformed file is returned because metadata strip was requested",
                    compressed.len(),
                    input_bytes
                ));
            }
            Ok((compressed, outcome))
        } else {
            outcome.saved_bytes = 0;
            outcome.saved_percent = 0.0;
            outcome.note = Some(format!(
                "compressed output ({} bytes) was not smaller than the input ({} bytes); the original was kept",
                compressed.len(),
                input_bytes
            ));
            Ok((bytes.to_vec(), outcome))
        }
    }

    /// The image pass: find image XObjects, work out their drawn
    /// size from the page content streams, downscale + JPEG
    /// re-encode the ones that are bigger than the mode's target.
    fn recompress_images(
        &self,
        doc: &mut Document,
        mode: CompressMode,
        outcome: &mut CompressOutcome,
    ) -> Result<()> {
        let drawn = image_display_sizes(doc);
        // Collect the image objects first: decoding mutates the
        // document, so the iteration cannot borrow it at the same
        // time.
        let mut images: Vec<(ObjectId, u32, u32)> = Vec::new();
        for (id, obj) in doc.objects.iter() {
            if let Object::Stream(stream) = obj {
                let is_image = stream
                    .dict
                    .get(b"Subtype")
                    .map(|v| *v == Object::Name(b"Image".to_vec()))
                    .unwrap_or(false);
                if !is_image {
                    continue;
                }
                let w = stream
                    .dict
                    .get(b"Width")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let h = stream
                    .dict
                    .get(b"Height")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                if w > 0 && h > 0 {
                    images.push((*id, w as u32, h as u32));
                }
            }
        }
        outcome.images_total = images.len();
        let engine = Engine::default();
        for (id, w, h) in images {
            match Self::recompress_one(doc, &engine, id, w, h, mode, &drawn) {
                Ok(true) => outcome.images_recompressed += 1,
                Ok(false) => {}
                Err(reason) => {
                    outcome.images_skipped += 1;
                    if outcome.skipped_reasons.len() < 8 {
                        outcome.skipped_reasons.push(reason);
                    }
                }
            }
        }
        Ok(())
    }

    /// Recompress one image XObject. `Ok(true)` = replaced,
    /// `Ok(false)` = already a JPEG at or under its target size
    /// (not counted as skipped), `Err(reason)` = skipped, with
    /// the reason.
    fn recompress_one(
        doc: &mut Document,
        engine: &Engine,
        id: ObjectId,
        w: u32,
        h: u32,
        mode: CompressMode,
        drawn: &HashMap<ObjectId, (f64, f64)>,
    ) -> std::result::Result<bool, String> {
        let stream = match doc.get_object(id) {
            Ok(Object::Stream(s)) => s.clone(),
            _ => return Err("image object vanished".to_string()),
        };
        // Transparency, masks and non-8-bit images are out of
        // scope for a JPEG re-encode.
        if stream.dict.get(b"SMask").is_ok() {
            return Err("has transparency (/SMask)".to_string());
        }
        if stream
            .dict
            .get(b"ImageMask")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            return Err("1-bit image mask".to_string());
        }
        let bpc = stream
            .dict
            .get(b"BitsPerComponent")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        if bpc != 8 {
            return Err(format!("{bpc}-bit samples (only 8-bit is re-encoded)"));
        }
        if stream.dict.get(b"DecodeParms").is_ok() {
            return Err("has /DecodeParms (predictor not decoded)".to_string());
        }
        let color_space = stream
            .dict
            .get(b"ColorSpace")
            .cloned()
            .unwrap_or(Object::Name(b"DeviceRGB".to_vec()));
        let gray = match &color_space {
            Object::Name(n) if n == b"DeviceRGB" => false,
            Object::Name(n) if n == b"DeviceGray" => true,
            _ => {
                return Err("colour space is not DeviceRGB/DeviceGray".to_string());
            }
        };
        // The drawn size decides the target: an image shown at
        // 200×150 pt needs at most 200×150 px at 72 DPI.
        let (drawn_w, drawn_h) = match drawn.get(&id) {
            Some(&(dw, dh)) => (dw, dh),
            None => {
                return Err(
                    "drawn size unknown (not referenced by a page content stream)".to_string(),
                );
            }
        };
        let scale = mode.target_dpi() / 72.0;
        let target_w = ((drawn_w * scale).round() as u32).max(1);
        let target_h = ((drawn_h * scale).round() as u32).max(1);
        // Recompress when the image is oversized for its drawn
        // size (downsample + re-encode) OR when it is stored
        // uncompressed (FlateDecode RGB → JPEG at the mode's
        // quality, even at the same size — that is where the
        // big saving is for PDFs built from images). An image
        // that is already JPEG at or under its target size is
        // left alone: re-encoding it would only lose quality.
        let needs_resize = w > target_w || h > target_h;
        let is_flate =
            matches!(&stream.dict.get(b"Filter"), Ok(Object::Name(f)) if f == b"FlateDecode");
        if !needs_resize && !is_flate {
            return Ok(false);
        }
        // Decode the image.
        let filter = stream.dict.get(b"Filter").cloned();
        let decoded = match &filter {
            Ok(Object::Name(f)) if f == b"DCTDecode" => engine
                .decode_bytes(&stream.content, None)
                .map(|(_, img)| img.to_dynamic())
                .map_err(|e| format!("embedded JPEG could not be decoded: {e}"))?,
            Ok(Object::Name(f)) if f == b"FlateDecode" => {
                let raw = stream
                    .decompressed_content()
                    .map_err(|e| format!("FlateDecode image could not be decoded: {e}"))?;
                let channels = if gray { 1 } else { 3 };
                if raw.len() != w as usize * h as usize * channels {
                    return Err(format!(
                        "FlateDecode image has {} raw bytes, expected {}",
                        raw.len(),
                        w as usize * h as usize * channels
                    ));
                }
                if gray {
                    image::DynamicImage::ImageLuma8(
                        image::GrayImage::from_raw(w, h, raw)
                            .ok_or_else(|| "bad grayscale samples".to_string())?,
                    )
                } else {
                    image::DynamicImage::ImageRgb8(
                        image::RgbImage::from_raw(w, h, raw)
                            .ok_or_else(|| "bad RGB samples".to_string())?,
                    )
                }
            }
            Ok(Object::Name(f)) => {
                return Err(format!(
                    "filter {} is not re-encoded (only DCTDecode/FlateDecode)",
                    String::from_utf8_lossy(f)
                ));
            }
            Ok(_) => {
                return Err("multi-filter image stream is not re-encoded".to_string());
            }
            Err(_) => {
                return Err("image stream has no /Filter".to_string());
            }
        };
        // Downscale (Lanczos3) when oversized, then re-encode as
        // JPEG at the mode's quality. At the same size the
        // decoded image is encoded as-is.
        let resized = if needs_resize {
            decoded.resize_exact(target_w, target_h, image::imageops::FilterType::Lanczos3)
        } else {
            decoded
        };
        let rgb = resized.to_rgb8();
        let decoded_img =
            openpixel_core::DecodedImage::from_dynamic(&image::DynamicImage::ImageRgb8(rgb));
        let options = ConvertOptions {
            quality: Some(mode.jpeg_quality()),
            ..ConvertOptions::default()
        };
        let (_, jpeg) = engine
            .encode_decoded(&decoded_img, ImageFormat::Jpeg, &options)
            .map_err(|e| format!("JPEG re-encode failed: {e}"))?;
        // Replace the stream: DCTDecode JPEG, no SMask, RGB 8-bit.
        // Dimensions are the resized ones, or the originals when
        // only the encoding changed.
        let (final_w, final_h) = if needs_resize {
            (target_w, target_h)
        } else {
            (w, h)
        };
        let mut dict = Dictionary::new();
        dict.set("Type", Object::Name(b"XObject".to_vec()));
        dict.set("Subtype", Object::Name(b"Image".to_vec()));
        dict.set("Width", Object::Integer(final_w as i64));
        dict.set("Height", Object::Integer(final_h as i64));
        dict.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
        dict.set("BitsPerComponent", Object::Integer(8));
        dict.set("Filter", Object::Name(b"DCTDecode".to_vec()));
        let mut new_stream = Stream::new(dict, jpeg);
        new_stream.allows_compression = false;
        doc.set_object(id, Object::Stream(new_stream));
        Ok(true)
    }
}

/// Strip the document `/Info` dictionary (metadata). Returns
/// `true` when anything was removed.
fn strip_info(doc: &mut Document) -> bool {
    let info_id = doc
        .trailer
        .get(b"Info")
        .ok()
        .and_then(|o| o.as_reference().ok());
    let Some(id) = info_id else {
        return false;
    };
    doc.trailer.remove(b"Info");
    doc.objects.remove(&id);
    true
}

/// Drawn size (width, height in points) of every image XObject
/// referenced by a page content stream, taking the largest size
/// when an image is drawn on several pages.
///
/// The scan only understands the common case — a single `cm`
/// before each `Do` (`q w 0 0 h x y cm /Im0 Do Q`). Images drawn
/// through Form XObjects, nested `cm`s or annotation appearances
/// are not found, and their images are skipped by the caller with
/// the reason recorded.
fn image_display_sizes(doc: &Document) -> HashMap<ObjectId, (f64, f64)> {
    let mut sizes: HashMap<ObjectId, (f64, f64)> = HashMap::new();
    let max_decompressed = doc
        .objects
        .values()
        .filter_map(|o| match o {
            Object::Stream(s) => Some(s.content.len()),
            _ => None,
        })
        .sum::<usize>()
        .saturating_add(1 << 20);
    for (_, page_id) in doc.get_pages() {
        // Name → image object id, from this page's Resources.
        let mut names: HashMap<String, ObjectId> = HashMap::new();
        let resources = doc
            .get_dictionary(page_id)
            .and_then(|d| d.get(b"Resources"))
            .ok()
            .cloned()
            .or_else(|| inherited_attribute(doc, page_id, b"Resources"));
        if let Some(Object::Dictionary(res)) = resources {
            if let Ok(Object::Dictionary(xobjects)) = res.get(b"XObject") {
                for (name, value) in xobjects.iter() {
                    if let Ok(id) = value.as_reference() {
                        names.insert(
                            String::from_utf8_lossy(name)
                                .trim_start_matches('/')
                                .to_string(),
                            id,
                        );
                    }
                }
            }
        }
        if names.is_empty() {
            continue;
        }
        // Content streams of this page.
        let content_ids: Vec<ObjectId> =
            match doc.get_dictionary(page_id).and_then(|d| d.get(b"Contents")) {
                Ok(Object::Reference(id)) => vec![*id],
                Ok(Object::Array(items)) => {
                    items.iter().filter_map(|i| i.as_reference().ok()).collect()
                }
                _ => vec![],
            };
        for cid in content_ids {
            let Ok(Object::Stream(stream)) = doc.get_object(cid) else {
                continue;
            };
            let Ok(bytes) = stream.decompressed_content_with_limit(max_decompressed) else {
                continue;
            };
            let tokens: Vec<&[u8]> = bytes
                .split(|b| b.is_ascii_whitespace())
                .filter(|t| !t.is_empty())
                .collect();
            for (i, tok) in tokens.iter().enumerate() {
                if *tok != b"Do" || i < 8 {
                    continue;
                }
                let name_tok = tokens[i - 1];
                let op_tok = tokens[i - 2];
                if op_tok != b"cm" || !name_tok.starts_with(b"/") {
                    continue;
                }
                let nums: Vec<f64> = tokens[i - 8..i - 2]
                    .iter()
                    .map(|t| {
                        std::str::from_utf8(t)
                            .unwrap_or("")
                            .parse::<f64>()
                            .unwrap_or(f64::NAN)
                    })
                    .collect();
                if nums.iter().any(|v| !v.is_finite()) {
                    continue;
                }
                let (a, b, c, d) = (nums[0], nums[1], nums[2], nums[3]);
                // Axis-aligned rotations swap the axes; the sum is
                // exact for those and a safe overestimate otherwise.
                let drawn_w = a.abs() + c.abs();
                let drawn_h = b.abs() + d.abs();
                let name = String::from_utf8_lossy(&name_tok[1..]).into_owned();
                if let Some(&img_id) = names.get(&name) {
                    let entry = sizes.entry(img_id).or_insert((0.0, 0.0));
                    entry.0 = entry.0.max(drawn_w);
                    entry.1 = entry.1.max(drawn_h);
                }
            }
        }
    }
    sizes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::tests::make_pdf;
    use lopdf::dictionary;

    /// A PDF whose page shows a big photo (1024×768) drawn at
    /// 256×192 pt, plus a small image already at display size.
    /// Built with `from_images` (1 px = 1 pt) then re-laid out by
    /// hand is overkill — instead build it directly: two image
    /// XObjects drawn with explicit `cm` matrices.
    fn photo_pdf() -> Vec<u8> {
        // Big photo: 1024x768 gradient JPEG (real DCTDecode data).
        let mut grad = image::RgbImage::new(1024, 768);
        for (x, y, p) in grad.enumerate_pixels_mut() {
            *p = image::Rgb([((x / 4) % 256) as u8, ((y / 4) % 256) as u8, 128]);
        }
        let mut jpg = Vec::new();
        image::DynamicImage::ImageRgb8(grad)
            .write_to(&mut Cursor::new(&mut jpg), image::ImageFormat::Jpeg)
            .unwrap();
        let mut doc = Document::with_version("1.5");
        let img_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 1024i64,
                "Height" => 768i64,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
                "Filter" => "DCTDecode",
            },
            jpg,
        ));
        let content = b"q 256 0 0 192 0 0 cm /Im0 Do Q".to_vec();
        let content_id = doc.add_object(Stream::new(Dictionary::new(), content));
        let pages_id = doc.add_object(dictionary! {
            "Type" => "Pages",
            "Kids" => Object::Array(vec![]),
            "Count" => Object::Integer(0),
        });
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => Object::Reference(pages_id),
            "MediaBox" => Object::Array(vec![Object::Integer(0), Object::Integer(0), Object::Integer(612), Object::Integer(792)]),
            "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => Object::Reference(img_id) } },
            "Contents" => Object::Reference(content_id),
        });
        if let Ok(pages) = doc.get_dictionary_mut(pages_id) {
            pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
            pages.set("Count", Object::Integer(1));
        }
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set("Root", Object::Reference(catalog_id));
        let mut out = Vec::new();
        doc.save_to(&mut Cursor::new(&mut out)).unwrap();
        out
    }

    #[test]
    fn screen_mode_shrinks_a_photo_pdf() {
        let engine = PdfEngine::default();
        let pdf = photo_pdf();
        let (out, outcome) = engine
            .compress(&pdf, CompressMode::Screen, CompressOptions::default())
            .unwrap();
        assert_eq!(outcome.images_total, 1);
        assert_eq!(outcome.images_recompressed, 1);
        assert_eq!(outcome.images_skipped, 0);
        assert!(outcome.saved_bytes > 0, "outcome: {outcome:?}");
        assert!(out.len() < pdf.len());
        // Still a valid 1-page PDF, and the image is now 256x192.
        assert_eq!(engine.page_count(&out).unwrap(), 1);
        let doc = Document::load_mem(&out).unwrap();
        let img = doc
            .objects
            .values()
            .find_map(|o| match o {
                Object::Stream(s)
                    if s.dict
                        .get(b"Subtype")
                        .map(|v| *v == Object::Name(b"Image".to_vec()))
                        .unwrap_or(false) =>
                {
                    Some(s)
                }
                _ => None,
            })
            .unwrap();
        assert_eq!(img.dict.get(b"Width").unwrap().as_i64().unwrap(), 256);
        assert_eq!(img.dict.get(b"Height").unwrap().as_i64().unwrap(), 192);
        assert_eq!(
            img.dict.get(b"Filter").unwrap(),
            &Object::Name(b"DCTDecode".to_vec())
        );
    }

    #[test]
    fn flate_image_is_recompressed_even_without_downsampling() {
        // A PDF built from images (like `pdf from-images`) stores
        // RGB pixels as FlateDecode — big, uncompressed. Drawn at
        // its full size, screen mode needs no downsampling, but
        // the JPEG re-encode at q50 must still happen: that is
        // the whole saving for this class of PDF.
        let engine = PdfEngine::default();
        let mut grad = image::RgbImage::new(1024, 768);
        for (x, y, p) in grad.enumerate_pixels_mut() {
            *p = image::Rgb([((x / 4) % 256) as u8, ((y / 4) % 256) as u8, 128]);
        }
        let raw = grad.into_raw();
        // The stream content must be genuinely Flate-compressed:
        // a raw RGB body behind a FlateDecode filter is an
        // invalid PDF (lopdf silently decodes it to empty), and
        // `from_images` compresses with ZlibEncoder the same way.
        use std::io::Write as _;
        let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::best());
        encoder.write_all(&raw).unwrap();
        let compressed = encoder.finish().unwrap();
        let mut doc = Document::with_version("1.5");
        let img_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 1024i64,
                "Height" => 768i64,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
                "Filter" => "FlateDecode",
            },
            compressed,
        ));
        let content = b"q 1024 0 0 768 0 0 cm /Im0 Do Q".to_vec();
        let content_id = doc.add_object(Stream::new(Dictionary::new(), content));
        let pages_id = doc.add_object(dictionary! {
            "Type" => "Pages",
            "Kids" => Object::Array(vec![]),
            "Count" => Object::Integer(0),
        });
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => Object::Reference(pages_id),
            "MediaBox" => Object::Array(vec![Object::Integer(0), Object::Integer(0), Object::Integer(1024), Object::Integer(768)]),
            "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => Object::Reference(img_id) } },
            "Contents" => Object::Reference(content_id),
        });
        if let Ok(pages) = doc.get_dictionary_mut(pages_id) {
            pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
            pages.set("Count", Object::Integer(1));
        }
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set("Root", Object::Reference(catalog_id));
        let mut pdf = Vec::new();
        doc.save_to(&mut Cursor::new(&mut pdf)).unwrap();
        let (out, outcome) = engine
            .compress(&pdf, CompressMode::Screen, CompressOptions::default())
            .unwrap();
        assert_eq!(outcome.images_total, 1);
        assert_eq!(outcome.images_recompressed, 1, "outcome: {outcome:?}");
        assert!(outcome.saved_bytes > 0, "outcome: {outcome:?}");
        assert!(out.len() < pdf.len());
        assert_eq!(engine.page_count(&out).unwrap(), 1);
        // Same dimensions (no downsampling was needed), new filter.
        let doc = Document::load_mem(&out).unwrap();
        let img = doc
            .objects
            .values()
            .find_map(|o| match o {
                Object::Stream(s)
                    if s.dict
                        .get(b"Subtype")
                        .map(|v| *v == Object::Name(b"Image".to_vec()))
                        .unwrap_or(false) =>
                {
                    Some(s)
                }
                _ => None,
            })
            .unwrap();
        assert_eq!(img.dict.get(b"Width").unwrap().as_i64().unwrap(), 1024);
        assert_eq!(img.dict.get(b"Height").unwrap().as_i64().unwrap(), 768);
        assert_eq!(
            img.dict.get(b"Filter").unwrap(),
            &Object::Name(b"DCTDecode".to_vec())
        );
    }

    #[test]
    fn printer_mode_keeps_more_than_screen() {
        let engine = PdfEngine::default();
        let pdf = photo_pdf();
        let (screen, _) = engine
            .compress(&pdf, CompressMode::Screen, CompressOptions::default())
            .unwrap();
        let (printer, _) = engine
            .compress(&pdf, CompressMode::Printer, CompressOptions::default())
            .unwrap();
        // Printer targets 300 DPI on a 256 pt draw = 1067 px wide,
        // wider than the 1024 px source, so nothing is re-encoded
        // and the file only gets the structure pass.
        assert!(printer.len() >= screen.len());
        assert!(screen.len() < pdf.len());
    }

    #[test]
    fn text_pdf_reports_honestly_when_nothing_shrinks() {
        let engine = PdfEngine::default();
        let pdf = make_pdf(2, "T");
        let (out, outcome) = engine
            .compress(&pdf, CompressMode::Ebook, CompressOptions::default())
            .unwrap();
        assert_eq!(outcome.images_total, 0);
        // The outcome is honest either way: if nothing shrank,
        // the original is returned with a note.
        if outcome.note.is_some() {
            assert_eq!(out, pdf);
            assert_eq!(outcome.saved_bytes, 0);
        } else {
            assert!(out.len() <= pdf.len());
            assert!(outcome.saved_bytes >= 0);
        }
        assert_eq!(engine.page_count(&out).unwrap(), 2);
    }

    #[test]
    fn strip_metadata_removes_title() {
        let engine = PdfEngine::default();
        let pdf = make_pdf(1, "M");
        let (out, outcome) = engine
            .compress(
                &pdf,
                CompressMode::Ebook,
                CompressOptions {
                    strip_metadata: true,
                    images: false,
                },
            )
            .unwrap();
        assert!(outcome.metadata_stripped);
        let info = engine.inspect(&out).unwrap();
        assert_eq!(info.title, None);
        assert_eq!(info.author, None);
        // The stripped file is returned even when it is larger
        // than the tiny original (the transformation was asked
        // for), so the title must be gone from the bytes too.
        assert!(!out.windows(5).any(|w| w == b"M doc"));
    }

    #[test]
    fn modes_parse_by_name() {
        assert_eq!(
            CompressMode::from_name("screen"),
            Some(CompressMode::Screen)
        );
        assert_eq!(CompressMode::from_name("EBOOK"), Some(CompressMode::Ebook));
        assert_eq!(
            CompressMode::from_name("printer"),
            Some(CompressMode::Printer)
        );
        assert_eq!(CompressMode::from_name("extreme"), None);
    }
}
