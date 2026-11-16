//! Image → PDF (Studio Phase 2).
//!
//! Embeds decoded images as FlateDecode RGB image XObjects, one
//! page per image. Alpha is flattened onto white (PDF image
//! XObjects here are DeviceRGB without an SMask — a transparent
//! PNG keeps its colours, not its transparency; documented in
//! `docs/PDF.md`). Page size defaults to the image size in points
//! (1 px = 1 pt); an explicit size fits the image inside it,
//! aspect preserved, centred.

use crate::engine::{num, save_to_bytes, PdfEngine};
use crate::error::{PdfError, Result};
use flate2::{write::ZlibEncoder, Compression};
use lopdf::{dictionary, Dictionary, Document, Object, Stream};
use openpixel_core::Engine;
use std::io::Write;

/// A page size for `from_images`: width × height in points.
pub type PageSize = (f64, f64);

/// Well-known page sizes in points.
pub fn named_page_size(name: &str) -> Option<PageSize> {
    match name.to_ascii_lowercase().as_str() {
        "a4" => Some((595.0, 842.0)),
        "letter" => Some((612.0, 792.0)),
        "a5" => Some((420.0, 595.0)),
        _ => None,
    }
}

impl PdfEngine {
    /// Build a PDF from images (PNG, JPEG, WebP, … — anything the
    /// image engine decodes). One page per image, in order.
    /// `page_size: None` makes each page the image's own size in
    /// points; `Some((w, h))` fits the image inside that page.
    pub fn from_images(&self, images: &[Vec<u8>], page_size: Option<PageSize>) -> Result<Vec<u8>> {
        if images.is_empty() {
            return Err(PdfError::InvalidPdf(
                "from-images needs at least one image".to_string(),
            ));
        }
        if images.len() as u32 > self.config().max_pages {
            return Err(PdfError::InvalidPdf(format!(
                "from-images would create more than {} pages",
                self.config().max_pages
            )));
        }
        let engine = Engine::default();
        let mut decoded = Vec::with_capacity(images.len());
        for (i, bytes) in images.iter().enumerate() {
            if bytes.len() as u64 > self.config().max_file_size_bytes {
                return Err(PdfError::InvalidPdf(format!(
                    "image {} is {} bytes, limit is {} bytes",
                    i + 1,
                    bytes.len(),
                    self.config().max_file_size_bytes
                )));
            }
            let (_, img) = engine.decode_bytes(bytes, None).map_err(|e| {
                PdfError::InvalidPdf(format!("image {} could not be decoded: {e}", i + 1))
            })?;
            decoded.push(img.to_dynamic().to_rgb8());
        }
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.add_object(Dictionary::from_iter(vec![
            ("Type", Object::Name(b"Pages".to_vec())),
            ("Kids", Object::Array(vec![])),
            ("Count", Object::Integer(0)),
        ]));
        let catalog_id = doc.add_object(Dictionary::from_iter(vec![
            ("Type", Object::Name(b"Catalog".to_vec())),
            ("Pages", Object::Reference(pages_id)),
        ]));
        doc.trailer.set("Root", Object::Reference(catalog_id));
        let mut kids = Vec::new();
        for rgb in &decoded {
            let (w, h) = (rgb.width(), rgb.height());
            let (page_w, page_h, draw_w, draw_h, draw_x, draw_y) = match page_size {
                Some((pw, ph)) => {
                    let scale = (pw / w as f64).min(ph / h as f64);
                    let dw = w as f64 * scale;
                    let dh = h as f64 * scale;
                    (pw, ph, dw, dh, (pw - dw) / 2.0, (ph - dh) / 2.0)
                }
                None => (w as f64, h as f64, w as f64, h as f64, 0.0, 0.0),
            };
            let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
            encoder
                .write_all(rgb.as_raw())
                .map_err(|e| PdfError::Lopdf(format!("could not compress image data: {e}")))?;
            let compressed = encoder
                .finish()
                .map_err(|e| PdfError::Lopdf(format!("could not compress image data: {e}")))?;
            let image_id = doc.add_object(Stream::new(
                dictionary! {
                    "Type" => "XObject",
                    "Subtype" => "Image",
                    "Width" => w as i64,
                    "Height" => h as i64,
                    "ColorSpace" => "DeviceRGB",
                    "BitsPerComponent" => 8,
                    "Filter" => "FlateDecode",
                },
                compressed,
            ));
            let content =
                format!("q {draw_w:.2} 0 0 {draw_h:.2} {draw_x:.2} {draw_y:.2} cm /Im0 Do Q");
            let content_id = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
            let page_id = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => Object::Reference(pages_id),
                "MediaBox" => Object::Array(vec![num(0.0), num(0.0), num(page_w), num(page_h)]),
                "Resources" => dictionary! {
                    "XObject" => dictionary! { "Im0" => Object::Reference(image_id) },
                },
                "Contents" => Object::Reference(content_id),
            });
            kids.push(Object::Reference(page_id));
        }
        if let Ok(pages) = doc.get_dictionary_mut(pages_id) {
            pages.set("Kids", Object::Array(kids));
            pages.set("Count", Object::Integer(decoded.len() as i64));
        }
        save_to_bytes(&mut doc)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real PNG (256×192 RGBA gradient) and a real JPEG
    /// (64×64), generated with the image engine itself.
    fn test_images() -> Vec<Vec<u8>> {
        let mut png = Vec::new();
        let mut rgba = Vec::new();
        for y in 0..192u32 {
            for x in 0..256u32 {
                rgba.extend_from_slice(&[(x % 256) as u8, (y % 256) as u8, 128, 255]);
            }
        }
        let img = image::RgbaImage::from_raw(256, 192, rgba).unwrap();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let mut jpg = Vec::new();
        let rgb = image::RgbImage::from_pixel(64, 64, image::Rgb([200, 30, 30]));
        image::DynamicImage::ImageRgb8(rgb)
            .write_to(
                &mut std::io::Cursor::new(&mut jpg),
                image::ImageFormat::Jpeg,
            )
            .unwrap();
        vec![png, jpg]
    }

    #[test]
    fn from_images_makes_a_real_two_page_pdf() {
        let engine = PdfEngine::default();
        let images = test_images();
        let pdf = engine.from_images(&images, None).unwrap();
        let info = engine.inspect(&pdf).unwrap();
        assert_eq!(info.page_count, 2);
        assert_eq!(info.page_sizes, vec![(256.0, 192.0), (64.0, 64.0)]);
        assert!(engine.validate(&pdf).is_ok());
        // A4 fit: both pages are A4, images centred inside.
        let a4 = engine.from_images(&images, Some((595.0, 842.0))).unwrap();
        assert_eq!(
            engine.inspect(&a4).unwrap().page_sizes,
            vec![(595.0, 842.0), (595.0, 842.0)]
        );
        assert!(engine.from_images(&[], None).is_err());
        assert!(engine
            .from_images(&[b"not an image".to_vec()], None)
            .is_err());
        assert_eq!(named_page_size("A4"), Some((595.0, 842.0)));
        assert_eq!(named_page_size("letter"), Some((612.0, 792.0)));
        assert_eq!(named_page_size("nope"), None);
    }

    /// Round-trip: the embedded images really render (a broken
    /// XObject would pass the page-count checks but render blank).
    #[test]
    #[cfg(feature = "pdfium")]
    fn from_images_round_trips_through_render() {
        let engine = PdfEngine::default();
        let pdf = engine.from_images(&test_images(), None).unwrap();
        let pages = engine.render_to_images(&pdf, None, 1.0).unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!((pages[0].image.width, pages[0].image.height), (256, 192));
        assert_eq!((pages[1].image.width, pages[1].image.height), (64, 64));
        for (i, rendered) in pages.iter().enumerate() {
            let dark = rendered
                .image
                .to_dynamic()
                .to_luma8()
                .pixels()
                .filter(|p| p.0[0] < 128)
                .count();
            assert!(dark > 1000, "rendered page {} is (near-)blank", i + 1);
        }
    }
}
