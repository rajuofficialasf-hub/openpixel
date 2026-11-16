//! Shared test fixtures for the openpixel-pdf integration tests.
//! Builds minimal real PDFs with lopdf (no checked-in binaries).

use lopdf::{dictionary, Document, Object, Stream};
use std::io::Cursor;

/// Build a minimal real PDF with `pages` pages, each showing one
/// text line `"{label} page {n}"`, via lopdf itself.
pub fn make_pdf(pages: u32, label: &str) -> Vec<u8> {
    let mut doc = Document::with_version("1.5");
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    });
    let pages_id = doc.add_object(dictionary! {
        "Type" => "Pages",
        "Kids" => Object::Array(vec![]),
        "Count" => Object::Integer(0),
    });
    let mut kids = Vec::new();
    for n in 1..=pages {
        let content = format!("BT /F1 24 Tf 100 700 Td ({label} page {n}) Tj ET");
        let stream_id = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => Object::Reference(pages_id),
            "MediaBox" => Object::Array(vec![
                Object::Integer(0), Object::Integer(0),
                Object::Integer(612), Object::Integer(792),
            ]),
            "Resources" => dictionary! {
                "Font" => dictionary! { "F1" => Object::Reference(font_id) },
            },
            "Contents" => Object::Reference(stream_id),
        });
        kids.push(Object::Reference(page_id));
    }
    if let Ok(pages_dict) = doc.get_dictionary_mut(pages_id) {
        pages_dict.set("Kids", Object::Array(kids));
        pages_dict.set("Count", Object::Integer(pages as i64));
    }
    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => Object::Reference(pages_id),
    });
    doc.trailer.set("Root", Object::Reference(catalog_id));
    let info_id = doc.add_object(dictionary! {
        "Title" => Object::String(format!("{label} doc").into_bytes(), lopdf::StringFormat::Literal),
        "Author" => Object::String(b"openpixel-test".to_vec(), lopdf::StringFormat::Literal),
    });
    doc.trailer.set("Info", Object::Reference(info_id));
    let mut out = Vec::new();
    doc.save_to(&mut Cursor::new(&mut out)).unwrap();
    out
}
