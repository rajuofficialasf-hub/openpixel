//! Page operations for `PdfEngine` (Studio Phase 2).
//!
//! Every list-based operation builds its output from an explicit
//! ordered list of (source document, page id) pairs via
//! [`build_document`], so extract/remove/reorder/duplicate/
//! insert/replace/reverse/booklet all share the Phase 1 page-graph
//! copier. Rotate mutates `/Rotate` in place. N-up is the
//! exception: it rebuilds pages as Form XObjects.
//!
//! Honest limits (also in `docs/PDF.md`):
//! * Page labels, outlines/bookmarks and `/Info` are not carried
//!   over by the copier (Phase 1 limit, unchanged).
//! * N-up ignores a source page's `/Rotate` (the form is built
//!   from the unrotated box) and the output sheet takes the first
//!   page's size; pages of different sizes are scaled into equal
//!   cells.

use crate::engine::{
    build_document, check_pages, copy_object_into, fresh_document, inherited_attribute, num,
    out_pages_id, page_box, page_box_rect, save_to_bytes, PdfEngine,
};
use crate::error::{PdfError, Result};
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};
use std::collections::HashMap;

impl PdfEngine {
    /// Rotate pages by 90, 180 or 270 degrees clockwise (added to
    /// any existing `/Rotate`). `pages: None` rotates every page.
    /// `/Rotate` in PDF must be a multiple of 90 — other angles
    /// are refused with a clear error, not silently rounded.
    pub fn rotate(&self, bytes: &[u8], pages: Option<&[u32]>, degrees: u16) -> Result<Vec<u8>> {
        if !matches!(degrees, 0 | 90 | 180 | 270) {
            return Err(PdfError::InvalidPdf(format!(
                "rotate degrees must be 90, 180 or 270, not {degrees}"
            )));
        }
        self.validate(bytes)?;
        let mut doc = Document::load_mem(bytes)?;
        let page_map = doc.get_pages();
        let count = page_map.len() as u32;
        let targets: Vec<u32> = match pages {
            Some(list) => {
                check_pages(list, count)?;
                list.to_vec()
            }
            None => (1..=count).collect(),
        };
        for page_num in targets {
            let page_id = page_map[&page_num];
            let current = doc
                .get_dictionary(page_id)
                .and_then(|d| d.get(b"Rotate"))
                .and_then(|o| o.as_i64())
                .unwrap_or(0);
            let new = (current + degrees as i64).rem_euclid(360);
            doc.get_dictionary_mut(page_id)?
                .set("Rotate", Object::Integer(new));
        }
        save_to_bytes(&mut doc)
    }

    /// Keep exactly these pages (1-based, in the given order;
    /// repeats are allowed) in one output document.
    pub fn extract(&self, bytes: &[u8], pages: &[u32]) -> Result<Vec<u8>> {
        if pages.is_empty() {
            return Err(PdfError::InvalidPdf(
                "extract needs at least one page".to_string(),
            ));
        }
        self.validate(bytes)?;
        let src = Document::load_mem(bytes)?;
        let count = src.get_pages().len() as u32;
        check_pages(pages, count)?;
        if pages.len() as u32 > self.config().max_pages {
            return Err(PdfError::InvalidPdf(format!(
                "extract would produce more than {} pages",
                self.config().max_pages
            )));
        }
        let map: HashMap<u32, ObjectId> = src.get_pages().into_iter().collect();
        let items: Vec<(&Document, ObjectId)> = pages.iter().map(|p| (&src, map[p])).collect();
        build_document(&items, &src.version)
    }

    /// Drop these pages, keep the rest in order. Removing every
    /// page is an error — a PDF with no pages is not a document.
    pub fn remove(&self, bytes: &[u8], pages: &[u32]) -> Result<Vec<u8>> {
        self.validate(bytes)?;
        let count = self.page_count(bytes)?;
        check_pages(pages, count)?;
        // Audit B15: the old `pages.contains(p)` inside the
        // filter was quadratic in the caller's list length — a
        // long JSON page list made this O(count x list).
        let drop: std::collections::HashSet<u32> = pages.iter().copied().collect();
        let keep: Vec<u32> = (1..=count).filter(|p| !drop.contains(p)).collect();
        if keep.is_empty() {
            return Err(PdfError::InvalidPdf(
                "removing every page would leave an empty PDF".to_string(),
            ));
        }
        self.extract(bytes, &keep)
    }

    /// Reorder all pages. `order` must be a permutation of
    /// 1..=page_count — every page exactly once.
    pub fn reorder(&self, bytes: &[u8], order: &[u32]) -> Result<Vec<u8>> {
        self.validate(bytes)?;
        let count = self.page_count(bytes)?;
        let mut sorted = order.to_vec();
        sorted.sort_unstable();
        let expected: Vec<u32> = (1..=count).collect();
        if sorted != expected {
            return Err(PdfError::InvalidPdf(
                "reorder must list every page exactly once, e.g. 3,1,2 for a 3-page PDF"
                    .to_string(),
            ));
        }
        self.extract(bytes, order)
    }

    /// Duplicate these pages, each copy placed right after its
    /// original.
    pub fn duplicate(&self, bytes: &[u8], pages: &[u32]) -> Result<Vec<u8>> {
        self.validate(bytes)?;
        let count = self.page_count(bytes)?;
        check_pages(pages, count)?;
        // Audit B15: see `remove` — same quadratic `contains`.
        let dup: std::collections::HashSet<u32> = pages.iter().copied().collect();
        let mut list = Vec::new();
        for n in 1..=count {
            list.push(n);
            if dup.contains(&n) {
                list.push(n);
            }
        }
        self.extract(bytes, &list)
    }

    /// Insert all pages of `documents` before page `at` (1-based;
    /// `at == page_count + 1` appends at the end).
    pub fn insert(&self, bytes: &[u8], at: u32, documents: &[Vec<u8>]) -> Result<Vec<u8>> {
        if documents.is_empty() {
            return Err(PdfError::InvalidPdf(
                "insert needs at least one document".to_string(),
            ));
        }
        self.validate(bytes)?;
        let src = Document::load_mem(bytes)?;
        let count = src.get_pages().len() as u32;
        if at == 0 || at > count + 1 {
            return Err(PdfError::PageOutOfRange(at, count + 1));
        }
        let mut parsed = Vec::with_capacity(documents.len());
        let mut total = count;
        for b in documents {
            self.validate(b)?;
            let doc = Document::load_mem(b)?;
            total += doc.get_pages().len() as u32;
            if total > self.config().max_pages {
                return Err(PdfError::InvalidPdf(format!(
                    "inserted PDF would have more than {} pages",
                    self.config().max_pages
                )));
            }
            parsed.push(doc);
        }
        let mut items: Vec<(&Document, ObjectId)> = Vec::with_capacity(total as usize);
        let src_pages = crate::engine::ordered_pages(&src);
        for (n, id) in &src_pages {
            if *n == at {
                for d in &parsed {
                    for (_, pid) in crate::engine::ordered_pages(d) {
                        items.push((d, pid));
                    }
                }
            }
            items.push((&src, *id));
        }
        if at == count + 1 {
            for d in &parsed {
                for (_, pid) in crate::engine::ordered_pages(d) {
                    items.push((d, pid));
                }
            }
        }
        build_document(&items, &src.version)
    }

    /// Replace page `page` with all pages of `replacement`,
    /// spliced in at the same position.
    pub fn replace(&self, bytes: &[u8], page: u32, replacement: &[u8]) -> Result<Vec<u8>> {
        self.validate(bytes)?;
        self.validate(replacement)?;
        let src = Document::load_mem(bytes)?;
        let count = src.get_pages().len() as u32;
        if page == 0 || page > count {
            return Err(PdfError::PageOutOfRange(page, count));
        }
        let repl = Document::load_mem(replacement)?;
        let repl_count = repl.get_pages().len() as u32;
        if count - 1 + repl_count > self.config().max_pages {
            return Err(PdfError::InvalidPdf(format!(
                "replaced PDF would have more than {} pages",
                self.config().max_pages
            )));
        }
        let mut items: Vec<(&Document, ObjectId)> = Vec::new();
        for (n, id) in crate::engine::ordered_pages(&src) {
            if n == page {
                for (_, pid) in crate::engine::ordered_pages(&repl) {
                    items.push((&repl, pid));
                }
            } else {
                items.push((&src, id));
            }
        }
        build_document(&items, &src.version)
    }

    /// Reverse the page order.
    pub fn reverse(&self, bytes: &[u8]) -> Result<Vec<u8>> {
        self.validate(bytes)?;
        let count = self.page_count(bytes)?;
        let order: Vec<u32> = (1..=count).rev().collect();
        self.extract(bytes, &order)
    }

    /// Reorder pages into booklet (duplex-print) imposition,
    /// padding with blank pages to a multiple of four. For N
    /// pages (padded), the order is [N, 1, 2, N-1, N-2, 3, 4,
    /// N-3, …] — the standard 4-page signature.
    pub fn booklet(&self, bytes: &[u8]) -> Result<Vec<u8>> {
        self.validate(bytes)?;
        let src = Document::load_mem(bytes)?;
        let count = src.get_pages().len() as u32;
        let padded = count.div_ceil(4) * 4;
        let mut order = Vec::with_capacity(padded as usize);
        for i in 0..padded / 4 {
            order.push(padded - 2 * i);
            order.push(2 * i + 1);
            order.push(2 * i + 2);
            order.push(padded - 2 * i - 1);
        }
        let mut out = fresh_document(&src.version);
        let pages_id = out_pages_id(&mut out);
        let map: HashMap<u32, ObjectId> = src.get_pages().into_iter().collect();
        let (bw, bh) = page_box(&src, map[&1]);
        for n in order {
            if n <= count {
                crate::engine::copy_page_into(&src, map[&n], &mut out, pages_id)?;
            } else {
                blank_page(&mut out, pages_id, bw, bh)?;
            }
        }
        crate::engine::finish_document(&mut out, pages_id);
        save_to_bytes(&mut out)
    }

    /// N-up layout: `cols` × `rows` source pages per output
    /// sheet (each 1..=16). The output sheet takes the first
    /// page's size; each source page is scaled into its cell.
    /// A source page's `/Rotate` is ignored (see module docs).
    pub fn nup(&self, bytes: &[u8], cols: u32, rows: u32) -> Result<Vec<u8>> {
        if cols == 0 || rows == 0 || cols > 16 || rows > 16 {
            return Err(PdfError::InvalidPdf(
                "N-up columns and rows must each be 1..=16".to_string(),
            ));
        }
        self.validate(bytes)?;
        let src = Document::load_mem(bytes)?;
        let pages = crate::engine::ordered_pages(&src);
        let per_sheet = (cols * rows) as usize;
        let (sheet_w, sheet_h) = page_box(&src, pages[0].1);
        let cell_w = sheet_w / cols as f64;
        let cell_h = sheet_h / rows as f64;
        let mut out = fresh_document(&src.version);
        let pages_id = out_pages_id(&mut out);
        for chunk in pages.chunks(per_sheet) {
            let mut xobjects = Dictionary::new();
            let mut content = Vec::new();
            for (k, (_, page_id)) in chunk.iter().enumerate() {
                let form_id = page_as_form(
                    &src,
                    *page_id,
                    &mut out,
                    self.config().max_file_size_bytes as usize,
                )?;
                let (_, _, w, h) = page_box_rect(&src, *page_id);
                let name = format!("Fm{k}");
                xobjects.set(name.clone(), Object::Reference(form_id));
                let col = (k as u32) % cols;
                let row = (k as u32) / cols;
                let x = col as f64 * cell_w;
                let y = sheet_h - ((row + 1) as f64 * cell_h);
                let sx = cell_w / w;
                let sy = cell_h / h;
                content.extend_from_slice(
                    format!("q {sx:.4} 0 0 {sy:.4} {x:.2} {y:.2} cm /{name} Do Q\n").as_bytes(),
                );
            }
            let content_id = out.add_object(Stream::new(dictionary! {}, content));
            let page_id = out.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => Object::Reference(pages_id),
                "MediaBox" => Object::Array(vec![num(0.0), num(0.0), num(sheet_w), num(sheet_h)]),
                "Resources" => dictionary! { "XObject" => Object::Dictionary(xobjects) },
                "Contents" => Object::Reference(content_id),
            });
            let kids = out
                .get_dictionary_mut(pages_id)
                .and_then(|p| p.get_mut(b"Kids"))
                .and_then(|o| o.as_array_mut())?;
            kids.push(Object::Reference(page_id));
        }
        crate::engine::finish_document(&mut out, pages_id);
        save_to_bytes(&mut out)
    }
}

/// Append a blank page (empty content, no resources) to the
/// output document's Pages node.
fn blank_page(out: &mut Document, pages_id: ObjectId, width: f64, height: f64) -> Result<()> {
    let content_id = out.add_object(Stream::new(dictionary! {}, Vec::new()));
    let page_id = out.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => Object::Reference(pages_id),
        "MediaBox" => Object::Array(vec![num(0.0), num(0.0), num(width), num(height)]),
        "Resources" => dictionary! {},
        "Contents" => Object::Reference(content_id),
    });
    let kids = out
        .get_dictionary_mut(pages_id)
        .and_then(|p| p.get_mut(b"Kids"))
        .and_then(|o| o.as_array_mut())?;
    kids.push(Object::Reference(page_id));
    Ok(())
}

/// Turn one source page into a Form XObject in `out`: its content
/// (decoded with a bomb-safe limit — source streams may be
/// FlateDecode-compressed) plus its effective Resources, with a
/// `/Matrix` translating the MediaBox origin to (0,0) and a
/// `/BBox` of the page's size. The caller draws the form with a
/// `cm` that scales it into its cell.
fn page_as_form(
    src: &Document,
    page_id: ObjectId,
    out: &mut Document,
    max_decompressed: usize,
) -> Result<ObjectId> {
    let mut content = Vec::new();
    if let Ok(contents) = src.get_dictionary(page_id).and_then(|d| d.get(b"Contents")) {
        let refs: Vec<ObjectId> = match contents {
            Object::Reference(id) => vec![*id],
            Object::Array(items) => items.iter().filter_map(|i| i.as_reference().ok()).collect(),
            _ => vec![],
        };
        // Audit B9: each stream is capped individually, but a
        // page with many content streams could still sum past
        // any sane size — cap the concatenated total too.
        let mut total = 0usize;
        for id in refs {
            if let Ok(Object::Stream(stream)) = src.get_object(id) {
                let bytes = stream
                    .decompressed_content_with_limit(max_decompressed)
                    .map_err(|e| {
                        PdfError::Lopdf(format!("could not decode page content stream: {e}"))
                    })?;
                total += bytes.len();
                if total > max_decompressed {
                    return Err(PdfError::Lopdf(format!(
                        "page content streams total more than {max_decompressed} bytes decompressed"
                    )));
                }
                content.extend_from_slice(&bytes);
                content.push(b'\n');
            }
        }
    }
    let resources = match src
        .get_dictionary(page_id)
        .and_then(|d| d.get(b"Resources"))
    {
        Ok(v) => copy_object_into(src, out, v)?,
        Err(_) => match inherited_attribute(src, page_id, b"Resources") {
            Some(v) => copy_object_into(src, out, &v)?,
            None => Object::Dictionary(Dictionary::new()),
        },
    };
    let (x1, y1, w, h) = page_box_rect(src, page_id);
    let form_id = out.add_object(Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Form",
            "BBox" => Object::Array(vec![num(0.0), num(0.0), num(w), num(h)]),
            "Matrix" => Object::Array(vec![num(1.0), num(0.0), num(0.0), num(1.0), num(-x1), num(-y1)]),
            "Resources" => resources,
        },
        content,
    ));
    Ok(form_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::tests::{contains_bytes, make_pdf};

    fn page_rotates(doc: &[u8]) -> Vec<i64> {
        let parsed = Document::load_mem(doc).unwrap();
        parsed
            .get_pages()
            .values()
            .map(|&id| {
                parsed
                    .get_dictionary(id)
                    .and_then(|d| d.get(b"Rotate"))
                    .and_then(|o| o.as_i64())
                    .unwrap_or(0)
            })
            .collect()
    }

    #[test]
    fn rotate_sets_and_accumulates() {
        let engine = PdfEngine::default();
        let doc = make_pdf(3, "R");
        let out = engine.rotate(&doc, Some(&[2]), 90).unwrap();
        assert_eq!(page_rotates(&out), vec![0, 90, 0]);
        let out2 = engine.rotate(&out, Some(&[2]), 90).unwrap();
        assert_eq!(page_rotates(&out2), vec![0, 180, 0]);
        let all = engine.rotate(&doc, None, 270).unwrap();
        assert_eq!(page_rotates(&all), vec![270, 270, 270]);
        assert!(engine.rotate(&doc, None, 45).is_err());
        assert!(engine.rotate(&doc, Some(&[4]), 90).is_err());
    }

    #[test]
    fn extract_remove_reorder_duplicate_reverse() {
        let engine = PdfEngine::default();
        let doc = make_pdf(5, "P");
        let ext = engine.extract(&doc, &[3, 1]).unwrap();
        assert_eq!(engine.page_count(&ext).unwrap(), 2);
        assert!(contains_bytes(&ext, b"P page 3"));
        assert!(contains_bytes(&ext, b"P page 1"));
        assert!(!contains_bytes(&ext, b"P page 2"));
        let rem = engine.remove(&doc, &[2, 4]).unwrap();
        assert_eq!(engine.page_count(&rem).unwrap(), 3);
        assert!(contains_bytes(&rem, b"P page 5"));
        assert!(!contains_bytes(&rem, b"P page 2"));
        assert!(engine.remove(&doc, &[1, 2, 3, 4, 5]).is_err());
        let ord = engine.reorder(&doc, &[5, 3, 1, 4, 2]).unwrap();
        assert_eq!(engine.page_count(&ord).unwrap(), 5);
        assert!(engine.reorder(&doc, &[1, 2, 2]).is_err());
        assert!(engine.reorder(&doc, &[1, 2]).is_err());
        let dup = engine.duplicate(&doc, &[2]).unwrap();
        assert_eq!(engine.page_count(&dup).unwrap(), 6);
        assert!(contains_bytes(&dup, b"P page 2"));
        let rev = engine.reverse(&doc).unwrap();
        assert_eq!(engine.page_count(&rev).unwrap(), 5);
        assert!(contains_bytes(&rev, b"P page 5"));
    }

    #[test]
    fn insert_and_replace_splice_pages() {
        let engine = PdfEngine::default();
        let doc = make_pdf(3, "A");
        let other = make_pdf(2, "B");
        let ins = engine
            .insert(&doc, 2, std::slice::from_ref(&other))
            .unwrap();
        assert_eq!(engine.page_count(&ins).unwrap(), 5);
        assert!(contains_bytes(&ins, b"B page 1"));
        let end = engine
            .insert(&doc, 4, std::slice::from_ref(&other))
            .unwrap();
        assert_eq!(engine.page_count(&end).unwrap(), 5);
        assert!(engine
            .insert(&doc, 0, std::slice::from_ref(&other))
            .is_err());
        assert!(engine
            .insert(&doc, 5, std::slice::from_ref(&other))
            .is_err());
        let rep = engine.replace(&doc, 2, &other).unwrap();
        assert_eq!(engine.page_count(&rep).unwrap(), 4);
        assert!(contains_bytes(&rep, b"B page 2"));
        assert!(!contains_bytes(&rep, b"A page 2"));
        assert!(contains_bytes(&rep, b"A page 3"));
        assert!(engine.replace(&doc, 4, &other).is_err());
    }

    #[test]
    fn booklet_pads_and_imposes() {
        let engine = PdfEngine::default();
        let doc = make_pdf(5, "K");
        let out = engine.booklet(&doc).unwrap();
        // 5 pages -> padded to 8, order [8,1,2,7,6,3,4,5]:
        // page 8 and page 7 are blank, so only 5 text pages remain.
        assert_eq!(engine.page_count(&out).unwrap(), 8);
        for n in 1..=5 {
            assert!(contains_bytes(&out, format!("K page {n}").as_bytes()));
        }
        let four = engine.booklet(&make_pdf(4, "F")).unwrap();
        assert_eq!(engine.page_count(&four).unwrap(), 4);
    }

    #[test]
    fn nup_two_by_two_makes_one_sheet() {
        let engine = PdfEngine::default();
        let doc = make_pdf(4, "N");
        let out = engine.nup(&doc, 2, 2).unwrap();
        assert_eq!(engine.page_count(&out).unwrap(), 1);
        // Every source page's text survives in the sheet.
        for n in 1..=4 {
            assert!(contains_bytes(&out, format!("N page {n}").as_bytes()));
        }
        let info = engine.inspect(&out).unwrap();
        assert_eq!(info.page_sizes, vec![(612.0, 792.0)]);
        // Five pages -> two sheets (2x2 + 1).
        let five = engine.nup(&make_pdf(5, "N"), 2, 2).unwrap();
        assert_eq!(engine.page_count(&five).unwrap(), 2);
        assert!(engine.nup(&doc, 0, 2).is_err());
        assert!(engine.nup(&doc, 17, 2).is_err());
    }

    #[test]
    fn inspect_reports_page_sizes() {
        let engine = PdfEngine::default();
        let info = engine.inspect(&make_pdf(2, "S")).unwrap();
        assert_eq!(info.page_sizes, vec![(612.0, 792.0), (612.0, 792.0)]);
    }

    /// Render the N-up sheet: all four cells must actually show
    /// their page's text (a form that draws nothing would pass
    /// the byte checks above but render blank).
    #[test]
    #[cfg(feature = "pdfium")]
    fn nup_sheet_renders_all_four_cells() {
        let engine = PdfEngine::default();
        let doc = make_pdf(4, "N");
        let out = engine.nup(&doc, 2, 2).unwrap();
        let pages = engine.render_to_images(&out, None, 1.0).unwrap();
        assert_eq!(pages.len(), 1);
        let luma = pages[0].image.to_dynamic().to_luma8();
        let (w, h) = (luma.width(), luma.height());
        assert_eq!((w, h), (612, 792));
        for (x0, y0) in [(0, 0), (w / 2, 0), (0, h / 2), (w / 2, h / 2)] {
            let dark = (0..w / 2)
                .flat_map(|dx| (0..h / 2).map(move |dy| (x0 + dx, y0 + dy)))
                .filter(|(x, y)| luma.get_pixel(*x, *y).0[0] < 128)
                .count();
            assert!(dark > 0, "quadrant at ({x0},{y0}) rendered blank");
        }
    }
}
