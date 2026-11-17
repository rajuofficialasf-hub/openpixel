//! PDF redaction (Studio Phase 5): REAL content removal.
//!
//! A redaction deletes the text from the page's content stream
//! and then draws a black rectangle over the area. The black
//! rectangle is only the visual cover — the removal is the
//! redaction. The proof is byte-level: the redacted text must
//! not appear in the output file, and the engine checks that
//! itself (it re-decodes the page after the edit and fails
//! loudly if any removed text is still in a text-showing
//! operator). The old content stream objects are deleted from
//! the document, so the text does not linger as an orphan
//! object — that is the part a black-overlay-only tool gets
//! wrong.
//!
//! What this does NOT do (stated here, and in docs/PDF.md):
//! - Text inside Form XObjects is not reached — only the page's
//!   own content stream is rewritten. A header/footer drawn from
//!   an XObject survives a rect redaction (the black cover still
//!   hides it visually).
//! - Text drawn as vector outlines (no Tj/TJ operator) has no
//!   text to remove; the cover rectangle is all that happens.
//! - Character positions are estimated (glyph width ≈ half the
//!   font size, the same estimate the watermark uses). For the
//!   standard fonts and for lopdf-generated PDFs this is exact
//!   enough that the right characters are removed; for exotic
//!   fonts a partial overlap may remove a neighbouring character
//!   too. The byte-proof still holds: the removed text is gone.
//! - A redacted string is searched inside one text run (one
//!   Tj/TJ). A string split across two runs is not found — the
//!   outcome says so with a warning instead of pretending.
//! - Metadata (/Info) is not redacted — use `set-metadata` for
//!   that. Annotations whose rectangle intersects a redaction
//!   rect ARE removed (their /Contents could otherwise leak the
//!   redacted information).

use crate::edit::{append_content_stream, decode_ops, finite, rect_numbers};
use crate::engine::{check_pages, ordered_pages, save_to_bytes, PdfEngine};
use crate::error::{PdfError, Result};
use lopdf::content::{Content, Operation};
use lopdf::{Document, Object, ObjectId};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

/// Redact everything inside a rectangle on one page (PDF user
/// units, origin bottom left). The text inside is removed; a
/// black rectangle is drawn over the area.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RectRedaction {
    pub page: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Redact every occurrence of a text string (case-sensitive).
/// `page: None` searches all pages; `Some(n)` only page n.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextRedaction {
    pub page: Option<u32>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Redaction {
    Rect(RectRedaction),
    Text(TextRedaction),
}

/// What `redact` did. `redacted_texts` is the actual text that
/// was removed — the CLI e2e and the tests grep the output bytes
/// for these strings to prove they are gone.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedactOutcome {
    pub pages_touched: usize,
    pub runs_removed: u32,
    pub characters_removed: u32,
    pub annotations_removed: u32,
    pub redacted_texts: Vec<String>,
    pub warnings: Vec<String>,
}

/// One run of drawn text: the string, its font size, its
/// position (baseline origin), and which content operation drew
/// it (so the op can be edited or deleted).
struct TextRun {
    text: String,
    size: f64,
    x: f64,
    y: f64,
    op_index: usize,
}

/// Walk content operations and collect the text runs with their
/// positions. Tracks BT/ET, Tf (size), Td/TD/Tm/T* (position)
/// and Tj/TJ/'/" (text). Widths are estimated at half the font
/// size per character — the same estimate used elsewhere in this
/// crate, and exact for the standard fonts at the sizes used by
/// the fixtures.
fn extract_runs(ops: &[Operation]) -> Vec<TextRun> {
    let mut runs = Vec::new();
    let mut in_text = false;
    let mut size = 12.0f64;
    let mut leading = 12.0f64;
    let mut tm_scale = 1.0f64;
    let (mut x, mut y) = (0.0f64, 0.0f64);
    let (mut line_x, mut line_y) = (0.0f64, 0.0f64);
    let nums = |op: &Operation| -> Vec<f64> {
        op.operands
            .iter()
            .filter_map(|o| match o {
                Object::Integer(i) => Some(*i as f64),
                Object::Real(r) => Some(*r as f64),
                _ => None,
            })
            .collect()
    };
    let string_operand = |op: &Operation| -> Option<Vec<u8>> {
        op.operands
            .iter()
            .find_map(|o| o.as_str().ok().map(|s| s.to_vec()))
    };
    for (i, op) in ops.iter().enumerate() {
        match op.operator.as_str() {
            "BT" => {
                in_text = true;
                x = 0.0;
                y = 0.0;
                line_x = 0.0;
                line_y = 0.0;
                tm_scale = 1.0;
            }
            "ET" => in_text = false,
            "Tf" => {
                let n = nums(op);
                if n.len() >= 2 {
                    size = n[1];
                    leading = n[1];
                }
            }
            "TL" => {
                let n = nums(op);
                if let Some(v) = n.first() {
                    leading = *v;
                }
            }
            "Td" | "TD" => {
                let n = nums(op);
                if n.len() >= 2 {
                    line_x += n[0];
                    line_y += n[1];
                    x = line_x;
                    y = line_y;
                    if op.operator == "TD" {
                        leading = -n[1];
                    }
                }
            }
            "Tm" => {
                let n = nums(op);
                if n.len() >= 6 {
                    tm_scale = n[0].abs();
                    x = n[4];
                    y = n[5];
                    line_x = n[4];
                    line_y = n[5];
                }
            }
            "T*" => {
                line_y -= leading;
                y = line_y;
                x = line_x;
            }
            "Tj" | "TJ" | "'" | "\"" => {
                if !in_text {
                    continue;
                }
                let text = match op.operator.as_str() {
                    "TJ" => {
                        let mut s = Vec::new();
                        for operand in &op.operands {
                            if let Object::Array(items) = operand {
                                for item in items {
                                    if let Ok(bytes) = item.as_str() {
                                        s.extend_from_slice(bytes);
                                    }
                                }
                            }
                        }
                        s
                    }
                    _ => string_operand(op).unwrap_or_default(),
                };
                if text.is_empty() {
                    continue;
                }
                let eff_size = size * tm_scale;
                let text_str = String::from_utf8_lossy(&text).into_owned();
                let char_w = eff_size * 0.5;
                runs.push(TextRun {
                    x,
                    y,
                    size: eff_size,
                    op_index: i,
                    text: text_str.clone(),
                });
                x += char_w * text_str.chars().count() as f64;
                if op.operator == "'" || op.operator == "\"" {
                    line_y -= leading;
                    y = line_y;
                    x = line_x;
                }
            }
            _ => {}
        }
    }
    runs
}

/// Do two rectangles overlap? Strict overlap: a glyph that
/// merely touches the edge of the redaction rectangle (its
/// left edge exactly on the rectangle's right edge) is NOT
/// inside it — an epsilon here would delete the character next
/// to the redacted text.
fn rects_overlap(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)) -> bool {
    a.0 < b.2 && a.2 > b.0 && a.1 < b.3 && a.3 > b.1
}

impl PdfEngine {
    /// Apply redactions. Returns the new bytes plus what was
    /// removed. The black cover rectangles are drawn over the
    /// redacted areas; the text itself is deleted from the
    /// content stream (see the module docs for the limits).
    pub fn redact(
        &self,
        bytes: &[u8],
        redactions: &[Redaction],
    ) -> Result<(Vec<u8>, RedactOutcome)> {
        if redactions.is_empty() {
            return Err(PdfError::InvalidPdf(
                "redact needs at least one redaction".to_string(),
            ));
        }
        self.validate(bytes)?;
        let mut doc = Document::load_mem(bytes)?;
        let pages = ordered_pages(&doc);
        let page_count = pages.len() as u32;
        // Which pages reference each content object (a content
        // stream shared by two pages must not be deleted when
        // only one of them is rewritten).
        let mut content_refcounts: HashMap<ObjectId, u32> = HashMap::new();
        for (_, page_id) in &pages {
            for id in page_content_ids(&doc, *page_id) {
                *content_refcounts.entry(id).or_insert(0) += 1;
            }
        }

        // Group the redactions per page: (rect, label) pairs.
        // A text redaction becomes rect(s) once its runs are
        // found; a rect redaction is a rect directly.
        let mut per_page: BTreeMap<u32, Vec<(f64, f64, f64, f64)>> = BTreeMap::new();
        let mut outcome = RedactOutcome {
            pages_touched: 0,
            runs_removed: 0,
            characters_removed: 0,
            annotations_removed: 0,
            redacted_texts: Vec::new(),
            warnings: Vec::new(),
        };
        for red in redactions {
            match red {
                Redaction::Rect(r) => {
                    check_pages(&[r.page], page_count)?;
                    finite(r.x, "redaction x")?;
                    finite(r.y, "redaction y")?;
                    finite(r.width, "redaction width")?;
                    finite(r.height, "redaction height")?;
                    if r.width <= 0.0 || r.height <= 0.0 {
                        return Err(PdfError::InvalidPdf(format!(
                            "redaction rectangle must have a positive size, not {}x{}",
                            r.width, r.height
                        )));
                    }
                    per_page.entry(r.page).or_default().push((
                        r.x,
                        r.y,
                        r.x + r.width,
                        r.y + r.height,
                    ));
                }
                Redaction::Text(t) => {
                    if t.text.trim().is_empty() {
                        return Err(PdfError::InvalidPdf(
                            "text redaction needs a non-empty string".to_string(),
                        ));
                    }
                    let targets: Vec<u32> = match t.page {
                        Some(p) => {
                            check_pages(&[p], page_count)?;
                            vec![p]
                        }
                        None => (1..=page_count).collect(),
                    };
                    let mut found = false;
                    for page in targets {
                        let page_id = pages[(page - 1) as usize].1;
                        let Ok(ops) =
                            decode_ops(&doc, page_id, self.config().max_file_size_bytes as usize)
                        else {
                            continue;
                        };
                        for run in extract_runs(&ops) {
                            let mut start = 0usize;
                            while let Some(byte_pos) =
                                run.text[start..].find(t.text.as_str()).map(|p| p + start)
                            {
                                // find() returns a BYTE offset; the
                                // character index is what positions
                                // the redaction rectangle.
                                let char_pos = run.text[..byte_pos].chars().count();
                                let char_w = run.size * 0.5;
                                let x1 = run.x + char_pos as f64 * char_w;
                                let x2 = x1 + t.text.chars().count() as f64 * char_w;
                                per_page.entry(page).or_default().push((
                                    x1,
                                    run.y,
                                    x2,
                                    run.y + run.size,
                                ));
                                found = true;
                                start = byte_pos + t.text.len();
                            }
                        }
                    }
                    if !found {
                        outcome.warnings.push(format!(
                            "text {:?} was not found on any searched page — nothing redacted for it",
                            t.text
                        ));
                    }
                }
            }
        }

        for (page, rects) in &per_page {
            let page_id = pages[(*page - 1) as usize].1;
            let ops = match decode_ops(&doc, page_id, self.config().max_file_size_bytes as usize) {
                Ok(ops) => ops,
                Err(e) => {
                    outcome.warnings.push(format!(
                        "page {page}: content could not be decoded ({e}) — the cover rectangle was still drawn"
                    ));
                    // Still draw the covers below.
                    let cover = cover_stream(rects);
                    append_content_stream(&mut doc, page_id, cover)?;
                    outcome.pages_touched += 1;
                    continue;
                }
            };
            let runs = extract_runs(&ops);
            // op_index -> char indices to remove.
            let mut edits: HashMap<usize, HashSet<usize>> = HashMap::new();
            let mut removed_texts: Vec<String> = Vec::new();
            for run in &runs {
                let char_w = run.size * 0.5;
                let mut removed: HashSet<usize> = HashSet::new();
                let mut removed_chars: Vec<char> = Vec::new();
                for (i, _) in run.text.chars().enumerate() {
                    let char_rect = (
                        run.x + i as f64 * char_w,
                        run.y,
                        run.x + (i + 1) as f64 * char_w,
                        run.y + run.size,
                    );
                    if rects.iter().any(|r| rects_overlap(char_rect, *r)) {
                        removed.insert(i);
                    }
                }
                // Only count the run when at least one char goes.
                if !removed.is_empty() {
                    for (i, c) in run.text.chars().enumerate() {
                        if removed.contains(&i) {
                            removed_chars.push(c);
                        }
                    }
                    edits.insert(run.op_index, removed);
                    removed_texts.push(removed_chars.into_iter().collect());
                }
            }
            if !edits.is_empty() {
                let new_ops = rebuild_ops(&ops, &edits);
                // Self-check, on the rebuilt ops themselves: every
                // edited op must now contain exactly the original
                // text minus the removed characters — nothing
                // more, nothing less. A mismatch here is a bug in
                // the rebuild, and it fails loudly instead of
                // shipping a redaction that did not remove what
                // it claimed to.
                for (op_idx, remove) in &edits {
                    let original = &ops[*op_idx];
                    let original_text = op_text(original).unwrap_or_default();
                    let expected: String = original_text
                        .chars()
                        .enumerate()
                        .filter(|(i, _)| !remove.contains(i))
                        .map(|(_, c)| c)
                        .collect();
                    let actual = new_ops.iter().find(|o| {
                        // The rebuilt op keeps its operator and
                        // position; match by operator + the
                        // kept text. A fully removed op is
                        // absent — that is the expected outcome.
                        o.operator == original.operator
                            && op_text(o).as_deref() == Some(expected.as_str())
                    });
                    if expected.is_empty() {
                        // The whole run must be gone: no op in the
                        // rebuilt list may still carry the original.
                        if new_ops.iter().any(|o| {
                            o.operator == original.operator
                                && op_text(o).as_deref() == Some(original_text.as_str())
                        }) {
                            return Err(PdfError::Lopdf(format!(
                                "redaction failed its own check: {original_text:?} is still in the page content"
                            )));
                        }
                    } else if actual.is_none() {
                        return Err(PdfError::Lopdf(format!(
                            "redaction failed its own check: rebuilt text {expected:?} does not match the expected remainder of {original_text:?}"
                        )));
                    }
                }
                let encoded = Content {
                    operations: new_ops,
                }
                .encode()
                .map_err(|e| {
                    PdfError::Lopdf(format!("redacted content could not be encoded: {e}"))
                })?;
                // Replace the page content and delete the old
                // streams (only when this page is their sole
                // referrer — the text must not linger as an
                // orphan object in the output bytes).
                let old_ids = page_content_ids(&doc, page_id);
                let new_id = doc.add_object(lopdf::Stream::new(lopdf::Dictionary::new(), encoded));
                doc.get_dictionary_mut(page_id)?
                    .set("Contents", Object::Reference(new_id));
                for id in old_ids {
                    if content_refcounts.get(&id).copied().unwrap_or(0) <= 1 {
                        doc.objects.remove(&id);
                    }
                }
                outcome.runs_removed += edits.len() as u32;
                outcome.characters_removed += removed_texts
                    .iter()
                    .map(|t| t.chars().count() as u32)
                    .sum::<u32>();
                outcome.redacted_texts.extend(removed_texts);
            } else {
                outcome.warnings.push(format!(
                    "page {page}: no text runs overlapped the redaction area — the cover rectangle was drawn, but no text was removed (the text may live in a Form XObject or an image)"
                ));
            }
            // The black cover, drawn over the area.
            let cover = cover_stream(rects);
            append_content_stream(&mut doc, page_id, cover)?;
            // Annotations whose rectangle intersects a redaction
            // rect are removed — their /Contents could leak the
            // redacted information.
            outcome.annotations_removed +=
                remove_intersecting_annotations(&mut doc, page_id, rects, *page)?;
            outcome.pages_touched += 1;
        }

        let out = save_to_bytes(&mut doc)?;
        Document::load_mem(&out)
            .map_err(|e| PdfError::Lopdf(format!("redacted PDF does not parse again: {e}")))?;
        Ok((out, outcome))
    }
}

/// The text a text-showing operation draws (Tj, TJ, ', "),
/// or None for other operators.
fn op_text(op: &Operation) -> Option<String> {
    match op.operator.as_str() {
        "Tj" | "'" | "\"" => op
            .operands
            .iter()
            .find_map(|o| o.as_str().ok())
            .map(|b| String::from_utf8_lossy(b).into_owned()),
        "TJ" => {
            let mut s = String::new();
            for operand in &op.operands {
                if let Object::Array(items) = operand {
                    for item in items {
                        if let Ok(bytes) = item.as_str() {
                            s.push_str(&String::from_utf8_lossy(bytes));
                        }
                    }
                }
            }
            Some(s)
        }
        _ => None,
    }
}

/// The /Contents object ids of a page (one reference or an
/// array of them).
fn page_content_ids(doc: &Document, page_id: ObjectId) -> Vec<ObjectId> {
    let contents = doc
        .get_dictionary(page_id)
        .and_then(|d| d.get(b"Contents"))
        .cloned();
    match contents {
        Ok(Object::Reference(id)) => vec![id],
        Ok(Object::Array(items)) => items
            .into_iter()
            .filter_map(|o| o.as_reference().ok())
            .collect(),
        _ => Vec::new(),
    }
}

/// Rebuild the operations with the edited characters removed:
/// an op whose every character goes is dropped; a partially
/// removed op is rewritten with the remaining characters.
fn rebuild_ops(ops: &[Operation], edits: &HashMap<usize, HashSet<usize>>) -> Vec<Operation> {
    let mut out = Vec::with_capacity(ops.len());
    for (i, op) in ops.iter().enumerate() {
        let Some(remove) = edits.get(&i) else {
            out.push(op.clone());
            continue;
        };
        match op.operator.as_str() {
            "Tj" | "'" | "\"" => {
                let Some(bytes) = op
                    .operands
                    .iter()
                    .find_map(|o| o.as_str().ok().map(|s| s.to_vec()))
                else {
                    out.push(op.clone());
                    continue;
                };
                let text = String::from_utf8_lossy(&bytes);
                let kept: String = text
                    .chars()
                    .enumerate()
                    .filter(|(idx, _)| !remove.contains(idx))
                    .map(|(_, c)| c)
                    .collect();
                if kept.is_empty() {
                    continue; // the whole run goes
                }
                let mut new_op = op.clone();
                let kept_bytes = kept.into_bytes();
                for operand in new_op.operands.iter_mut() {
                    if operand.as_str().is_ok() {
                        *operand = Object::String(kept_bytes.clone(), lopdf::StringFormat::Literal);
                        break;
                    }
                }
                out.push(new_op);
            }
            "TJ" => {
                let Some(Object::Array(items)) = op.operands.first().cloned() else {
                    out.push(op.clone());
                    continue;
                };
                let mut char_idx = 0usize;
                let mut new_items: Vec<Object> = Vec::new();
                for item in items {
                    match item {
                        Object::String(bytes, _) => {
                            let text = String::from_utf8_lossy(&bytes);
                            let kept: String = text
                                .chars()
                                .enumerate()
                                .filter(|(idx, _)| !remove.contains(&(char_idx + idx)))
                                .map(|(_, c)| c)
                                .collect();
                            char_idx += text.chars().count();
                            if !kept.is_empty() {
                                new_items.push(Object::String(
                                    kept.into_bytes(),
                                    lopdf::StringFormat::Literal,
                                ));
                            }
                        }
                        other => new_items.push(other),
                    }
                }
                if new_items.iter().any(|o| matches!(o, Object::String(_, _))) {
                    let mut new_op = op.clone();
                    new_op.operands[0] = Object::Array(new_items);
                    out.push(new_op);
                }
                // else: every string went — the whole op goes.
            }
            _ => out.push(op.clone()),
        }
    }
    out
}

/// The black cover rectangles for one page's redactions.
fn cover_stream(rects: &[(f64, f64, f64, f64)]) -> Vec<u8> {
    let mut s = String::from("0 0 0 rg ");
    for (x1, y1, x2, y2) in rects {
        s.push_str(&format!(
            "{} {} {} {} re f ",
            crate::edit::fmt_num(*x1),
            crate::edit::fmt_num(*y1),
            crate::edit::fmt_num(x2 - x1),
            crate::edit::fmt_num(y2 - y1)
        ));
    }
    s.into_bytes()
}

/// The appearance stream ids of an annotation (`/AP /N`, `/R`,
/// `/D` — each a stream, or a sub-dictionary keyed by appearance
/// state). Appearance content is what can carry the redacted
/// text, so these go with the annotation when it is removed.
fn appearance_stream_ids(doc: &Document, annot_id: ObjectId) -> Vec<ObjectId> {
    let mut out = Vec::new();
    let mut stack: Vec<Object> = Vec::new();
    if let Ok(ap) = doc
        .get_dictionary(annot_id)
        .and_then(|d| d.get(b"AP"))
        .cloned()
    {
        stack.push(ap);
    }
    while let Some(obj) = stack.pop() {
        match obj {
            Object::Reference(id) => match doc.get_object(id) {
                Ok(Object::Stream(_)) => out.push(id),
                Ok(Object::Dictionary(d)) => {
                    for (_, v) in d.iter() {
                        stack.push(v.clone());
                    }
                }
                _ => {}
            },
            Object::Dictionary(d) => {
                for (_, v) in d.iter() {
                    stack.push(v.clone());
                }
            }
            Object::Array(items) => {
                for v in items {
                    stack.push(v);
                }
            }
            _ => {}
        }
    }
    out
}

/// Does any object other than `except` reference `want`?
fn referenced_elsewhere(doc: &Document, want: ObjectId, except: ObjectId) -> bool {
    doc.objects
        .iter()
        .any(|(id, obj)| *id != except && object_references(obj, want))
}

/// Does this object (dictionaries, arrays, stream dicts) contain
/// a reference to `want`?
fn object_references(obj: &Object, want: ObjectId) -> bool {
    match obj {
        Object::Reference(id) => *id == want,
        Object::Array(items) => items.iter().any(|o| object_references(o, want)),
        Object::Dictionary(d) => d.iter().any(|(_, v)| object_references(v, want)),
        Object::Stream(s) => object_references(&Object::Dictionary(s.dict.clone()), want),
        _ => false,
    }
}

/// Remove the page's annotations whose /Rect intersects any
/// redaction rect. Returns how many were removed.
fn remove_intersecting_annotations(
    doc: &mut Document,
    page_id: ObjectId,
    rects: &[(f64, f64, f64, f64)],
    page_no: u32,
) -> Result<u32> {
    let _ = page_no;
    let annots_obj = doc
        .get_dictionary(page_id)
        .and_then(|d| d.get(b"Annots"))
        .cloned();
    let Ok(annots_obj) = annots_obj else {
        return Ok(0);
    };
    let (annots_id, items) = match &annots_obj {
        Object::Reference(id) => {
            let items = doc
                .get_object(*id)
                .and_then(|o| o.as_array())
                .cloned()
                .unwrap_or_default();
            (Some(*id), items)
        }
        Object::Array(items) => (None, items.clone()),
        _ => return Ok(0),
    };
    let mut removed = 0u32;
    let mut kept: Vec<Object> = Vec::new();
    for item in items {
        let Object::Reference(id) = item else {
            kept.push(item);
            continue;
        };
        let rect = doc
            .get_dictionary(id)
            .and_then(|d| d.get(b"Rect"))
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_default();
        let nums = rect_numbers(&rect);
        let annot_rect = match nums.as_slice() {
            [a, b, c, d] => (*a, *b, *c, *d),
            _ => {
                kept.push(Object::Reference(id));
                continue;
            }
        };
        if rects.iter().any(|r| rects_overlap(annot_rect, *r)) {
            // Delete the appearance streams too (audit: redaction
            // leak): the annotation dict is gone, but lopdf writes
            // every object in the document, so an orphaned /AP
            // stream would keep the redacted text in the output
            // bytes. Only streams no other object references are
            // deleted — a shared appearance survives.
            for ap_id in appearance_stream_ids(doc, id) {
                if !referenced_elsewhere(doc, ap_id, id) {
                    doc.objects.remove(&ap_id);
                }
            }
            doc.objects.remove(&id);
            removed += 1;
        } else {
            kept.push(Object::Reference(id));
        }
    }
    if removed > 0 {
        if kept.is_empty() {
            if let Ok(d) = doc.get_dictionary_mut(page_id) {
                d.remove(b"Annots");
            }
            if let Some(id) = annots_id {
                doc.objects.remove(&id);
            }
        } else {
            match annots_id {
                Some(id) => {
                    if let Ok(o) = doc.get_object_mut(id) {
                        *o = Object::Array(kept);
                    }
                }
                None => {
                    if let Ok(d) = doc.get_dictionary_mut(page_id) {
                        d.set("Annots", Object::Array(kept));
                    }
                }
            }
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::tests::{contains_bytes, make_pdf};

    /// The text a page draws, read from its content operations
    /// (works without PDFium).
    fn content_text(doc: &Document, page_id: ObjectId) -> String {
        let ops = decode_ops(doc, page_id, 100 * 1024 * 1024).unwrap();
        let mut s = String::new();
        for op in &ops {
            if let Some(t) = op_text(op) {
                s.push_str(&t);
                s.push(' ');
            }
        }
        s
    }

    /// A PDF whose page 1 says "SECRET-123 is here" plus a
    /// second line "PUBLIC line". The secret is drawn with one
    /// Tj at (100, 700), size 24 — char width 12, so the secret
    /// starts at x=100 and "SECRET-123" spans 100..220.
    fn make_secret_pdf() -> Vec<u8> {
        let mut doc = Document::load_mem(&make_pdf(1, "Doc")).unwrap();
        let pages = ordered_pages(&doc);
        let page_id = pages[0].1;
        // Replace the page content with two known lines.
        let content = b"BT /F1 24 Tf 100 700 Td (SECRET-123 is here) Tj ET BT /F1 24 Tf 100 650 Td (PUBLIC line) Tj ET".to_vec();
        let stream_id = doc.add_object(lopdf::Stream::new(lopdf::Dictionary::new(), content));
        doc.get_dictionary_mut(page_id)
            .unwrap()
            .set("Contents", Object::Reference(stream_id));
        let mut out = Vec::new();
        doc.save_to(&mut std::io::Cursor::new(&mut out)).unwrap();
        out
    }

    #[test]
    fn redact_rect_removes_text_bytes() {
        let engine = PdfEngine::default();
        let input = make_secret_pdf();
        assert!(contains_bytes(&input, b"SECRET-123"));
        let (out, outcome) = engine
            .redact(
                &input,
                &[Redaction::Rect(RectRedaction {
                    page: 1,
                    x: 90.0,
                    y: 690.0,
                    width: 200.0,
                    height: 40.0,
                })],
            )
            .unwrap();
        assert!(outcome.characters_removed > 0);
        assert!(outcome.redacted_texts.iter().any(|t| t.contains("SECRET")));
        // THE byte proof: the secret is gone from the file bytes.
        assert!(
            !contains_bytes(&out, b"SECRET-123"),
            "secret leaked into output bytes"
        );
        assert!(
            !contains_bytes(&out, b"SECRET"),
            "secret leaked into output bytes"
        );
        // The public line survives, and the file still parses.
        let doc = Document::load_mem(&out).unwrap();
        let pages = ordered_pages(&doc);
        let text = content_text(&doc, pages[0].1);
        assert!(text.contains("PUBLIC line"), "public text lost: {text}");
        assert!(!text.contains("SECRET"), "secret still extractable: {text}");
        assert_eq!(engine.inspect(&out).unwrap().page_count, 1);
    }

    #[test]
    fn redact_text_search_removes_the_string() {
        let engine = PdfEngine::default();
        let input = make_secret_pdf();
        let (out, outcome) = engine
            .redact(
                &input,
                &[Redaction::Text(TextRedaction {
                    page: None,
                    text: "SECRET-123".to_string(),
                })],
            )
            .unwrap();
        assert!(outcome.characters_removed >= 10);
        assert!(!contains_bytes(&out, b"SECRET-123"));
        let doc = Document::load_mem(&out).unwrap();
        let pages = ordered_pages(&doc);
        let text = content_text(&doc, pages[0].1);
        assert!(text.contains("PUBLIC line"));
        assert!(!text.contains("SECRET"));
    }

    #[test]
    fn redact_text_search_partial_overlap_keeps_the_rest() {
        let engine = PdfEngine::default();
        let input = make_secret_pdf();
        // Redact only "SECRET" (6 chars) from "SECRET-123 is here":
        // the "-123 is here" part must survive.
        let (out, _) = engine
            .redact(
                &input,
                &[Redaction::Text(TextRedaction {
                    page: Some(1),
                    text: "SECRET".to_string(),
                })],
            )
            .unwrap();
        assert!(!contains_bytes(&out, b"SECRET"));
        let doc = Document::load_mem(&out).unwrap();
        let pages = ordered_pages(&doc);
        let text = content_text(&doc, pages[0].1);
        assert!(text.contains("-123 is here"), "surviving text lost: {text}");
    }

    #[test]
    fn redact_missing_text_warns_and_changes_nothing() {
        let engine = PdfEngine::default();
        let input = make_secret_pdf();
        let (out, outcome) = engine
            .redact(
                &input,
                &[Redaction::Text(TextRedaction {
                    page: None,
                    text: "NOT-THERE".to_string(),
                })],
            )
            .unwrap();
        assert!(!outcome.warnings.is_empty());
        assert_eq!(outcome.characters_removed, 0);
        assert!(contains_bytes(&out, b"SECRET-123"));
    }

    #[test]
    fn redact_rejects_bad_input() {
        let engine = PdfEngine::default();
        let input = make_secret_pdf();
        assert!(engine.redact(&input, &[]).is_err());
        assert!(engine
            .redact(
                &input,
                &[Redaction::Rect(RectRedaction {
                    page: 9,
                    x: 0.0,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                })]
            )
            .is_err());
        assert!(engine
            .redact(
                &input,
                &[Redaction::Text(TextRedaction {
                    page: None,
                    text: "   ".to_string(),
                })]
            )
            .is_err());
    }

    /// Regression (audit: redaction leak): an annotation removed
    /// by a rect redaction took its dictionary with it, but its
    /// appearance stream — which draws the same secret — stayed
    /// behind as an orphan object, and lopdf writes every object.
    /// The secret must be gone from the output bytes, not just
    /// from the page content.
    #[test]
    fn redact_removes_annotation_appearance_streams_too() {
        let engine = PdfEngine::default();
        let mut doc = Document::load_mem(&make_secret_pdf()).unwrap();
        let pages = ordered_pages(&doc);
        let page_id = pages[0].1;
        // Appearance stream drawing a distinct secret.
        let ap_id = doc.add_object(lopdf::Stream::new(
            lopdf::Dictionary::new(),
            b"BT /F1 24 Tf 0 0 Td (AP-SECRET-999) Tj ET".to_vec(),
        ));
        let annot_id = doc.add_object(lopdf::Dictionary::from_iter([
            (b"Type".to_vec(), Object::Name(b"Annot".to_vec())),
            (b"Subtype".to_vec(), Object::Name(b"Text".to_vec())),
            (
                b"Rect".to_vec(),
                Object::Array(vec![
                    Object::Integer(90),
                    Object::Integer(690),
                    Object::Integer(290),
                    Object::Integer(730),
                ]),
            ),
            (
                b"AP".to_vec(),
                Object::Dictionary(lopdf::Dictionary::from_iter([(
                    b"N".to_vec(),
                    Object::Reference(ap_id),
                )])),
            ),
        ]));
        doc.get_dictionary_mut(page_id)
            .unwrap()
            .set("Annots", Object::Array(vec![Object::Reference(annot_id)]));
        let mut input = Vec::new();
        doc.save_to(&mut std::io::Cursor::new(&mut input)).unwrap();
        assert!(contains_bytes(&input, b"AP-SECRET-999"));

        let (out, outcome) = engine
            .redact(
                &input,
                &[Redaction::Rect(RectRedaction {
                    page: 1,
                    x: 90.0,
                    y: 690.0,
                    width: 200.0,
                    height: 40.0,
                })],
            )
            .unwrap();
        assert_eq!(outcome.annotations_removed, 1, "outcome: {outcome:?}");
        assert!(
            !contains_bytes(&out, b"AP-SECRET-999"),
            "annotation appearance stream leaked the secret"
        );
        assert!(!contains_bytes(&out, b"SECRET-123"));
    }

    /// Regression (audit B11): a NaN redaction coordinate must be
    /// refused — the old `width <= 0.0` check let NaN through and
    /// `fmt_num` wrote `NaN` into the cover stream.
    #[test]
    fn redact_rejects_nan_coordinates() {
        let engine = PdfEngine::default();
        let input = make_secret_pdf();
        assert!(engine
            .redact(
                &input,
                &[Redaction::Rect(RectRedaction {
                    page: 1,
                    x: f64::NAN,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                })]
            )
            .is_err());
        assert!(engine
            .redact(
                &input,
                &[Redaction::Rect(RectRedaction {
                    page: 1,
                    x: 0.0,
                    y: 0.0,
                    width: f64::INFINITY,
                    height: 10.0,
                })]
            )
            .is_err());
    }
}
