//! `PdfEngine` — Studio Phase 1 foundation.
//!
//! Phase 1 scope: validate, inspect, merge, split. Compression,
//! rendering, text extraction and editing land in Phases 2–5.
//!
//! Merge/split work by copying page object graphs between lopdf
//! documents: each page dictionary and every object it references
//! (resources, content streams, fonts, XObjects) is deep-copied
//! with remapped object ids. Inherited attributes (`/Resources`,
//! `/MediaBox`, `/CropBox`, `/Rotate` from ancestor Pages nodes)
//! are resolved from the source page tree and materialised onto
//! the copied page, so the output does not depend on the source's
//! tree structure. Two honest limits of this Phase 1 copier:
//! * Page *labels*, outlines/bookmarks and the document `/Info`
//!   dictionary are not carried over (Phase 2/5).
//! * AcroForm / annotations that reference objects outside the
//!   page graph are copied as far as the graph reaches; a page
//!   whose annotations point at shared document-level objects may
//!   lose those links (Phase 5 handles annotations properly).

use crate::error::{PdfError, Result};
use crate::format::{detect_document_format, DocumentFormat};
use lopdf::{Dictionary, Document, Object, ObjectId, Stream};
use openpixel_core::{EngineHealth, HealthDetail, OptimizeLevel, ProcessingEngine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;

/// Limits for one PDF operation. Defaults match the image engine's
/// file-size limit (100 MiB) and cap pages at 10 000 — a merge of
/// ten thousand pages is already a pathological job.
#[derive(Debug, Clone)]
pub struct PdfConfig {
    pub max_pages: u32,
    pub max_file_size_bytes: u64,
}

impl Default for PdfConfig {
    fn default() -> Self {
        Self {
            max_pages: 10_000,
            max_file_size_bytes: openpixel_core::security::MAX_FILE_SIZE_BYTES,
        }
    }
}

/// What `inspect` reports about a PDF.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfInfo {
    pub page_count: u32,
    pub version: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub creator: Option<String>,
    pub producer: Option<String>,
    pub encrypted: bool,
}

/// The operation `process()` runs on one document (Phase 1: split
/// only — merge takes several inputs, so it is a native method,
/// not a trait operation).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PdfOperation {
    /// Extract these 1-based inclusive page ranges, one output
    /// document per range.
    Split { ranges: Vec<(u32, u32)> },
}

/// Options for `PdfEngine::process`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfOptions {
    pub operation: PdfOperation,
}

impl Default for PdfOptions {
    fn default() -> Self {
        // No ranges: `process` refuses with a clear error instead
        // of guessing what to split.
        Self {
            operation: PdfOperation::Split { ranges: vec![] },
        }
    }
}

/// The PDF engine (lopdf-backed).
pub struct PdfEngine {
    config: PdfConfig,
}

impl Default for PdfEngine {
    fn default() -> Self {
        Self::new(PdfConfig::default())
    }
}

impl PdfEngine {
    pub fn new(config: PdfConfig) -> Self {
        Self { config }
    }

    pub fn config(&self) -> &PdfConfig {
        &self.config
    }

    /// Parse and validate: PDF signature, size limit, lopdf parse,
    /// not encrypted, page count within the limit.
    pub fn validate(&self, bytes: &[u8]) -> Result<()> {
        if bytes.len() as u64 > self.config.max_file_size_bytes {
            return Err(PdfError::InvalidPdf(format!(
                "PDF is {} bytes, limit is {} bytes",
                bytes.len(),
                self.config.max_file_size_bytes
            )));
        }
        if detect_document_format(bytes) != DocumentFormat::Pdf {
            return Err(PdfError::InvalidPdf(
                "not a PDF file (signature did not match %PDF-)".to_string(),
            ));
        }
        let doc = Document::load_mem(bytes)
            .map_err(|e| PdfError::InvalidPdf(format!("lopdf could not parse the PDF: {e}")))?;
        if doc.is_encrypted() {
            return Err(PdfError::Encrypted);
        }
        let pages = doc.get_pages().len() as u32;
        if pages == 0 {
            return Err(PdfError::InvalidPdf("PDF has no pages".to_string()));
        }
        if pages > self.config.max_pages {
            return Err(PdfError::InvalidPdf(format!(
                "PDF has {pages} pages, limit is {}",
                self.config.max_pages
            )));
        }
        Ok(())
    }

    /// Parse the document and report its metadata. Fails on the
    /// same inputs `validate` refuses.
    pub fn inspect(&self, bytes: &[u8]) -> Result<PdfInfo> {
        self.validate(bytes)?;
        let doc = Document::load_mem(bytes)?;
        let info = doc
            .trailer
            .get(b"Info")
            .ok()
            .and_then(|o| o.as_reference().ok())
            .and_then(|id| doc.get_dictionary(id).ok());
        let get_str = |key: &[u8]| -> Option<String> {
            let dict = info?;
            let obj = dict.get(key).ok()?;
            match obj {
                Object::String(bytes, _) => Some(decode_pdf_string(bytes)),
                _ => None,
            }
        };
        Ok(PdfInfo {
            page_count: doc.get_pages().len() as u32,
            version: doc.version.clone(),
            title: get_str(b"Title"),
            author: get_str(b"Author"),
            creator: get_str(b"Creator"),
            producer: get_str(b"Producer"),
            encrypted: doc.is_encrypted(),
        })
    }

    /// Page count of a PDF (validates first).
    pub fn page_count(&self, bytes: &[u8]) -> Result<u32> {
        Ok(self.inspect(bytes)?.page_count)
    }

    /// Merge several PDFs into one, in order. Every input must
    /// validate; an empty list is an error, not an empty PDF.
    pub fn merge(&self, documents: &[Vec<u8>]) -> Result<Vec<u8>> {
        if documents.is_empty() {
            return Err(PdfError::InvalidPdf(
                "merge needs at least one document".to_string(),
            ));
        }
        let mut parsed = Vec::with_capacity(documents.len());
        let mut version = "1.5".to_string();
        for bytes in documents {
            self.validate(bytes)?;
            let doc = Document::load_mem(bytes)?;
            if parsed.is_empty() {
                version = doc.version.clone();
            }
            parsed.push(doc);
        }
        let mut out = fresh_document(&version);
        let pages_id = out_pages_id(&mut out);
        let mut total = 0u32;
        for src in &parsed {
            let pages: Vec<(u32, ObjectId)> = src.get_pages().into_iter().collect();
            total += pages.len() as u32;
            if total > self.config.max_pages {
                return Err(PdfError::InvalidPdf(format!(
                    "merged PDF would have more than {} pages",
                    self.config.max_pages
                )));
            }
            for (_, page_id) in pages {
                copy_page_into(src, page_id, &mut out, pages_id)?;
            }
        }
        finish_document(&mut out, pages_id);
        save_to_bytes(&mut out)
    }

    /// Split one PDF into one document per range. Ranges are
    /// 1-based inclusive; `[(1, 2), (3, 5)]` on a 5-page document
    /// yields a 2-page and a 3-page document.
    pub fn split(&self, bytes: &[u8], ranges: &[(u32, u32)]) -> Result<Vec<Vec<u8>>> {
        if ranges.is_empty() {
            return Err(PdfError::InvalidRange(0, 0));
        }
        self.validate(bytes)?;
        let src = Document::load_mem(bytes)?;
        let page_count = src.get_pages().len() as u32;
        for &(start, end) in ranges {
            if start == 0 || end == 0 || start > end || end > page_count {
                if end > page_count || start == 0 || end == 0 {
                    return Err(PdfError::PageOutOfRange(end.max(start), page_count));
                }
                return Err(PdfError::InvalidRange(start, end));
            }
        }
        let mut outputs = Vec::with_capacity(ranges.len());
        for &(start, end) in ranges {
            let mut out = fresh_document(&src.version);
            let pages_id = out_pages_id(&mut out);
            let pages: Vec<(u32, ObjectId)> = src.get_pages().into_iter().collect();
            for (num, page_id) in pages {
                if (start..=end).contains(&num) {
                    copy_page_into(&src, page_id, &mut out, pages_id)?;
                }
            }
            finish_document(&mut out, pages_id);
            outputs.push(save_to_bytes(&mut out)?);
        }
        Ok(outputs)
    }
}

impl ProcessingEngine for PdfEngine {
    type Options = PdfOptions;
    type Info = PdfInfo;
    type Output = Vec<Vec<u8>>;

    fn name(&self) -> &'static str {
        "pdf"
    }

    fn validate(&self, bytes: &[u8]) -> openpixel_core::Result<()> {
        PdfEngine::validate(self, bytes).map_err(Into::into)
    }

    fn inspect(&self, bytes: &[u8]) -> openpixel_core::Result<Self::Info> {
        PdfEngine::inspect(self, bytes).map_err(Into::into)
    }

    fn process(
        &self,
        bytes: &[u8],
        target: &str,
        options: &PdfOptions,
    ) -> openpixel_core::Result<Vec<Vec<u8>>> {
        if target != "pdf" {
            return Err(openpixel_core::OpenPixelError::NotImplemented(format!(
                "PDF engine output target must be 'pdf', not '{target}'"
            )));
        }
        match &options.operation {
            PdfOperation::Split { ranges } => self.split(bytes, ranges).map_err(Into::into),
        }
    }

    fn optimize(&self, _bytes: &[u8], _level: OptimizeLevel) -> openpixel_core::Result<Vec<u8>> {
        Err(openpixel_core::OpenPixelError::NotImplemented(
            "PDF compression lands in Phase 3 — this engine only merges and splits in Phase 1"
                .to_string(),
        ))
    }

    fn health_check(&self) -> EngineHealth {
        EngineHealth {
            engine: "pdf",
            ok: true,
            details: vec![
                HealthDetail {
                    name: "lopdf (pure Rust)".to_string(),
                    ok: true,
                    note: "merge/split/pages/metadata — exact pin in LICENSE_AUDIT.md".to_string(),
                },
                HealthDetail {
                    name: "merge".to_string(),
                    ok: true,
                    note: "native method PdfEngine::merge".to_string(),
                },
                HealthDetail {
                    name: "split".to_string(),
                    ok: true,
                    note: "trait process() with PdfOperation::Split".to_string(),
                },
                HealthDetail {
                    name: "optimize (compression)".to_string(),
                    ok: false,
                    note: "not implemented — Phase 3".to_string(),
                },
                HealthDetail {
                    name: "render to image (PDFium)".to_string(),
                    ok: false,
                    note: "prototype only — Phase 2, see examples/pdfium_render.rs".to_string(),
                },
            ],
        }
    }
}

/// A fresh output document: catalog + empty Pages node. Returns
/// the document; the caller fills the Pages node and calls
/// `finish_document` to set the page count.
fn fresh_document(version: &str) -> Document {
    let mut doc = Document::with_version(version);
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
    doc
}

/// The Pages node id of a document built by `fresh_document`.
fn out_pages_id(doc: &mut Document) -> ObjectId {
    let catalog_id = doc
        .trailer
        .get(b"Root")
        .and_then(|o| o.as_reference())
        .expect("fresh document always has a catalog");
    doc.get_dictionary(catalog_id)
        .and_then(|cat| cat.get(b"Pages"))
        .and_then(|o| o.as_reference())
        .expect("fresh document catalog always has /Pages")
}

/// Set the Pages `/Count` from the `/Kids` array after all pages
/// were copied in.
fn finish_document(doc: &mut Document, pages_id: ObjectId) {
    let count = doc
        .get_dictionary(pages_id)
        .and_then(|p| p.get(b"Kids"))
        .and_then(|o| o.as_array())
        .map(|kids| kids.len() as i64)
        .unwrap_or(0);
    if let Ok(pages) = doc.get_dictionary_mut(pages_id) {
        pages.set("Count", Object::Integer(count));
    }
}

/// Copy one page (and everything it references) from `src` into
/// `out`, appending it to the output Pages node.
fn copy_page_into(
    src: &Document,
    page_id: ObjectId,
    out: &mut Document,
    out_pages_id: ObjectId,
) -> Result<()> {
    let mut copier = PageCopier {
        src,
        out,
        map: HashMap::new(),
    };
    let new_page_id = copier.copy_reference(page_id)?;
    // Re-parent: the copied page still points at the *source*
    // Pages node (copied along with it) — point it at the output
    // Pages node instead, and drop the stray copied node if it is
    // now unreferenced (harmless either way; the writer only
    // writes reachable objects — lopdf writes all objects in the
    // map, so remove the orphan to keep the file clean).
    let mut orphan_parent = None;
    if let Ok(page) = copier.out.get_dictionary_mut(new_page_id) {
        if let Ok(Object::Reference(parent)) = page.get(b"Parent") {
            orphan_parent = Some(*parent);
        }
        page.set("Parent", Object::Reference(out_pages_id));
    }
    // Materialise inherited attributes the page itself lacks.
    for key in [b"Resources".as_slice(), b"MediaBox", b"CropBox", b"Rotate"] {
        let has_own = copier
            .out
            .get_dictionary(new_page_id)
            .and_then(|p| p.get(key))
            .is_ok();
        if has_own {
            continue;
        }
        if let Some(value) = inherited_attribute(src, page_id, key) {
            let copied = copier.copy_object(&value)?;
            if let Ok(page) = copier.out.get_dictionary_mut(new_page_id) {
                page.set(key, copied);
            }
        }
    }
    if let Some(parent) = orphan_parent {
        // Only remove it when nothing else references it (the
        // page was its only referrer after re-parenting).
        let referenced = copier
            .out
            .objects
            .values()
            .any(|o| object_references(o, parent));
        if !referenced {
            let _ = copier.out.remove_object(&parent);
        }
    }
    // Append to the output Kids array.
    let kids = out
        .get_dictionary_mut(out_pages_id)
        .and_then(|p| p.get_mut(b"Kids"))
        .and_then(|o| o.as_array_mut())?;
    kids.push(Object::Reference(new_page_id));
    Ok(())
}

/// Walk the source page tree (`/Parent` chain) for an attribute
/// the page itself does not carry. Returns the raw object (a
/// reference is returned as-is; the caller copies it).
fn inherited_attribute(src: &Document, mut page_id: ObjectId, key: &[u8]) -> Option<Object> {
    let mut depth = 0;
    loop {
        let dict = src.get_dictionary(page_id).ok()?;
        if let Ok(value) = dict.get(key) {
            return Some(value.clone());
        }
        let parent = dict.get(b"Parent").ok()?.as_reference().ok()?;
        page_id = parent;
        depth += 1;
        if depth > 32 {
            return None;
        }
    }
}

/// Deep-copy one object graph from the source document into the
/// target, remapping every reference through `map`.
struct PageCopier<'a> {
    src: &'a Document,
    out: &'a mut Document,
    map: HashMap<ObjectId, ObjectId>,
}

impl<'a> PageCopier<'a> {
    /// Copy the object `id` refers to (once — later references
    /// reuse the same new id) and return the new id.
    fn copy_reference(&mut self, id: ObjectId) -> Result<ObjectId> {
        if let Some(&mapped) = self.map.get(&id) {
            return Ok(mapped);
        }
        let new_id = self.out.try_new_object_id()?;
        // Insert before recursing: a cyclic graph (a resource
        // referencing its own page) must not loop forever.
        self.map.insert(id, new_id);
        let obj = self
            .src
            .get_object(id)
            .map_err(|e| PdfError::Lopdf(e.to_string()))?
            .clone();
        let copied = self.copy_object(&obj)?;
        self.out.set_object(new_id, copied);
        Ok(new_id)
    }

    fn copy_object(&mut self, obj: &Object) -> Result<Object> {
        Ok(match obj {
            Object::Reference(id) => Object::Reference(self.copy_reference(*id)?),
            Object::Array(items) => {
                let mut out = Vec::with_capacity(items.len());
                for item in items {
                    out.push(self.copy_object(item)?);
                }
                Object::Array(out)
            }
            Object::Dictionary(dict) => {
                let mut out = Dictionary::new();
                for (key, value) in dict.iter() {
                    out.set(key.clone(), self.copy_object(value)?);
                }
                Object::Dictionary(out)
            }
            Object::Stream(stream) => {
                let dict = match self.copy_object(&Object::Dictionary(stream.dict.clone()))? {
                    Object::Dictionary(d) => d,
                    _ => unreachable!(),
                };
                let mut new_stream = Stream::new(dict, stream.content.clone());
                new_stream.allows_compression = stream.allows_compression;
                Object::Stream(new_stream)
            }
            other => other.clone(),
        })
    }
}

/// True when object `o` contains a reference to `id` anywhere in
/// its (shallow) structure — used to decide whether a copied
/// parent node is still referenced.
fn object_references(o: &Object, id: ObjectId) -> bool {
    match o {
        Object::Reference(other) => *other == id,
        Object::Array(items) => items.iter().any(|i| object_references(i, id)),
        Object::Dictionary(dict) => dict.iter().any(|(_, v)| object_references(v, id)),
        Object::Stream(stream) => stream.dict.iter().any(|(_, v)| object_references(v, id)),
        _ => false,
    }
}

/// Serialise a document to bytes.
fn save_to_bytes(doc: &mut Document) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut cursor = Cursor::new(&mut out);
    doc.save_to(&mut cursor)?;
    Ok(out)
}

/// Decode a PDF string object: UTF-16BE with BOM, otherwise
/// lossy UTF-8 (PDFDocEncoding bytes outside ASCII degrade
/// gracefully rather than failing the whole inspect).
fn decode_pdf_string(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let units: Vec<u16> = bytes[2..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;

    fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    /// Build a minimal real PDF with `pages` pages, each showing
    /// one text line, via lopdf itself (no checked-in fixtures).
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

    #[test]
    fn validate_accepts_a_real_pdf_and_rejects_garbage() {
        let engine = PdfEngine::default();
        assert!(engine.validate(&make_pdf(2, "A")).is_ok());
        assert!(engine.validate(b"not a pdf at all").is_err());
        assert!(engine.validate(b"").is_err());
        assert!(engine
            .validate(b"%PDF-1.7\ntrailing garbage, no xref")
            .is_err());
    }

    #[test]
    fn inspect_reports_pages_and_metadata() {
        let engine = PdfEngine::default();
        let info = engine.inspect(&make_pdf(3, "Meta")).unwrap();
        assert_eq!(info.page_count, 3);
        assert_eq!(info.title.as_deref(), Some("Meta doc"));
        assert_eq!(info.author.as_deref(), Some("openpixel-test"));
        assert!(!info.encrypted);
    }

    #[test]
    fn merge_two_pdfs_keeps_all_pages_and_text() {
        let engine = PdfEngine::default();
        let a = make_pdf(3, "AAA");
        let b = make_pdf(2, "BBB");
        let merged = engine.merge(&[a, b]).unwrap();
        assert_eq!(engine.page_count(&merged).unwrap(), 5);
        // The text really is in the output (content streams are
        // uncompressed in these fixtures, so a byte search is a
        // genuine content check, not a page-count proxy).
        assert!(contains_bytes(&merged, b"AAA page 3"));
        assert!(contains_bytes(&merged, b"BBB page 2"));
        // And the merged file parses as a PDF again.
        assert!(engine.validate(&merged).is_ok());
    }

    #[test]
    fn split_ranges_produce_the_right_counts() {
        let engine = PdfEngine::default();
        let doc = make_pdf(5, "S");
        let parts = engine.split(&doc, &[(1, 2), (3, 5)]).unwrap();
        assert_eq!(parts.len(), 2);
        assert_eq!(engine.page_count(&parts[0]).unwrap(), 2);
        assert_eq!(engine.page_count(&parts[1]).unwrap(), 3);
        assert!(contains_bytes(&parts[0], b"S page 1"));
        assert!(contains_bytes(&parts[1], b"S page 5"));
    }

    #[test]
    fn split_rejects_bad_ranges() {
        let engine = PdfEngine::default();
        let doc = make_pdf(3, "R");
        assert!(engine.split(&doc, &[(0, 1)]).is_err());
        assert!(engine.split(&doc, &[(2, 1)]).is_err());
        assert!(engine.split(&doc, &[(1, 4)]).is_err());
        assert!(engine.split(&doc, &[]).is_err());
    }

    #[test]
    fn merge_rejects_empty_input_and_garbage() {
        let engine = PdfEngine::default();
        assert!(engine.merge(&[]).is_err());
        assert!(engine.merge(&[b"garbage".to_vec()]).is_err());
    }

    #[test]
    fn trait_process_splits_and_optimize_is_honest() {
        let engine = PdfEngine::default();
        let doc = make_pdf(4, "T");
        let out = <PdfEngine as ProcessingEngine>::process(
            &engine,
            &doc,
            "pdf",
            &PdfOptions {
                operation: PdfOperation::Split {
                    ranges: vec![(2, 3)],
                },
            },
        )
        .unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(engine.page_count(&out[0]).unwrap(), 2);
        let err =
            <PdfEngine as ProcessingEngine>::process(&engine, &doc, "png", &PdfOptions::default())
                .unwrap_err();
        assert!(matches!(
            err,
            openpixel_core::OpenPixelError::NotImplemented(_)
        ));
        let err = engine.optimize(&doc, OptimizeLevel::Balanced).unwrap_err();
        assert!(matches!(
            err,
            openpixel_core::OpenPixelError::NotImplemented(_)
        ));
        let health = engine.health_check();
        assert_eq!(health.engine, "pdf");
        assert!(health.ok);
    }
}
