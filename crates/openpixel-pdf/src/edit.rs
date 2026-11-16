//! PDF editor (Studio Phase 5): overlay content, flatten,
//! metadata editing.
//!
//! Overlays are NEW content layered onto a page — they never edit
//! existing text objects in place. lopdf cannot rewrite a text
//! run reliably (glyph encodings, split operators), and claiming
//! otherwise would be fake, so the API and the UI say "add"
//! everywhere: add text, add an image, add a shape, highlight,
//! draw, comment, page numbers, header/footer. What an overlay
//! draws is real and verifiable: it renders with PDFium and its
//! text is readable with `pdf extract-text`.
//!
//! Text uses the standard 14 fonts (no embedding) and WinAnsi:
//! non-ASCII characters become `?`, exactly like the Phase 3
//! watermark — a silent mojibake would be worse.
//!
//! Flatten renders annotation appearance streams into page
//! content and then removes the annotations; annotations without
//! an appearance have nothing visible to keep and are counted as
//! dropped (with a warning), not silently rendered.

use crate::engine::PdfEngine;
use crate::engine::{add_resource, check_pages, num, ordered_pages, page_box, save_to_bytes};
use crate::error::{PdfError, Result};
use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

/// An RGB colour, components 0.0..=1.0.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rgb {
    pub r: f64,
    pub g: f64,
    pub b: f64,
}

impl Rgb {
    pub fn grey(v: f64) -> Self {
        Self { r: v, g: v, b: v }
    }
    fn check(&self) -> Result<()> {
        for (name, v) in [("r", self.r), ("g", self.g), ("b", self.b)] {
            if !v.is_finite() || !(0.0..=1.0).contains(&v) {
                return Err(PdfError::InvalidPdf(format!(
                    "colour component {name} must be 0.0..=1.0, not {v}"
                )));
            }
        }
        Ok(())
    }
    /// `r g b` as a PDF colour operand (fill or stroke).
    fn pdf(&self) -> String {
        format!(
            "{} {} {}",
            fmt_num(self.r),
            fmt_num(self.g),
            fmt_num(self.b)
        )
    }
}

/// A standard PDF font (no embedding — every viewer has them).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayFont {
    Helvetica,
    HelveticaBold,
    TimesRoman,
    TimesBold,
    Courier,
    CourierBold,
}

impl OverlayFont {
    fn base_font(self) -> &'static str {
        match self {
            OverlayFont::Helvetica => "Helvetica",
            OverlayFont::HelveticaBold => "Helvetica-Bold",
            OverlayFont::TimesRoman => "Times-Roman",
            OverlayFont::TimesBold => "Times-Bold",
            OverlayFont::Courier => "Courier",
            OverlayFont::CourierBold => "Courier-Bold",
        }
    }
}

/// Where page numbers go.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PageNumberPosition {
    BottomCenter,
    BottomRight,
    TopCenter,
    TopRight,
}

/// One overlay operation. `page` is 1-based; `pages: None` on the
/// document-wide ops means every page. Image overlays reference
/// `images` passed to [`PdfEngine::edit`] by index — the JSON
/// form of an op never carries raw image bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OverlayOp {
    /// Add one line of text at (x, y) — PDF origin is the bottom
    /// left of the page. `{n}` / `{total}` are NOT substituted
    /// here (that is what `page_numbers` is for).
    Text {
        page: u32,
        x: f64,
        y: f64,
        text: String,
        size: f64,
        color: Rgb,
        font: OverlayFont,
    },
    /// Add a decoded image (PNG, JPEG, …) drawn at the given
    /// rect. Alpha is flattened onto white, like `from_images`.
    Image {
        page: u32,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        image_index: usize,
    },
    /// Add a rectangle: fill, stroke, or both (both when both
    /// colours are given; at least one is required).
    Rect {
        page: u32,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        fill: Option<Rgb>,
        stroke: Option<Rgb>,
        stroke_width: f64,
    },
    /// Add a straight line.
    Line {
        page: u32,
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        color: Rgb,
        width: f64,
    },
    /// Add a circle (four cubic Bézier curves).
    Circle {
        page: u32,
        cx: f64,
        cy: f64,
        r: f64,
        fill: Option<Rgb>,
        stroke: Option<Rgb>,
        stroke_width: f64,
    },
    /// Add a translucent filled rectangle over existing content
    /// (the text underneath stays readable — the rectangle is
    /// drawn at 40% opacity by default, not as an opaque cover).
    Highlight {
        page: u32,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        color: Rgb,
        opacity: f32,
    },
    /// Add a freehand polyline (at least two points).
    Draw {
        page: u32,
        points: Vec<(f64, f64)>,
        color: Rgb,
        width: f64,
    },
    /// Add a text annotation (comment) at (x, y). The comment
    /// text lives in the annotation dictionary — it is visible in
    /// any viewer that shows comments, and it is NOT page content.
    Comment {
        page: u32,
        x: f64,
        y: f64,
        text: String,
        author: Option<String>,
    },
    /// Add "Page N of M" (or the given format, with `{n}` and
    /// `{total}` substituted) to every page, or to `pages`.
    PageNumbers {
        pages: Option<Vec<u32>>,
        format: String,
        position: PageNumberPosition,
        size: f64,
    },
    /// Add a header line and/or a footer line to every page, or
    /// to `pages`. Header is centred near the top, footer centred
    /// near the bottom.
    HeaderFooter {
        pages: Option<Vec<u32>>,
        header: Option<String>,
        footer: Option<String>,
        size: f64,
    },
}

/// What `edit` did, per document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditOutcome {
    pub ops_applied: usize,
    pub pages_touched: usize,
    pub comments_added: usize,
    pub warnings: Vec<String>,
}

/// What `flatten` did.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlattenOutcome {
    pub annotations_flattened: u32,
    pub annotations_dropped: u32,
    pub form_fields_removed: u32,
    pub warnings: Vec<String>,
}

/// New metadata values. `Some("")` clears a field; `None` leaves
/// it unchanged.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MetadataEdit {
    pub title: Option<String>,
    pub author: Option<String>,
    pub subject: Option<String>,
    pub keywords: Option<String>,
    pub creator: Option<String>,
    pub producer: Option<String>,
}

/// A number formatted for a content stream: integers stay integers.
pub(crate) fn fmt_num(v: f64) -> String {
    if v.fract() == 0.0 && v.abs() < 9.0e15 {
        format!("{}", v as i64)
    } else {
        format!("{v:.2}")
    }
}

/// Escape a literal PDF string; non-ASCII becomes `?` (WinAnsi).
fn pdf_string(text: &str) -> String {
    let safe: String = text
        .chars()
        .map(|c| if c.is_ascii() { c } else { '?' })
        .collect();
    format!(
        "({})",
        safe.replace('\\', "\\\\")
            .replace('(', "\\(")
            .replace(')', "\\)")
    )
}

/// Append a content stream to a page (same rule as the Phase 3
/// watermark: a single reference becomes a two-element array).
pub(crate) fn append_content_stream(
    doc: &mut Document,
    page_id: ObjectId,
    content: Vec<u8>,
) -> Result<()> {
    let content_id = doc.add_object(Stream::new(Dictionary::new(), content));
    let contents = doc
        .get_dictionary(page_id)
        .and_then(|d| d.get(b"Contents"))
        .cloned();
    match contents {
        Ok(Object::Reference(id)) => {
            doc.get_dictionary_mut(page_id)?.set(
                "Contents",
                Object::Array(vec![Object::Reference(id), Object::Reference(content_id)]),
            );
        }
        Ok(Object::Array(mut items)) => {
            items.push(Object::Reference(content_id));
            doc.get_dictionary_mut(page_id)?
                .set("Contents", Object::Array(items));
        }
        _ => {
            doc.get_dictionary_mut(page_id)?
                .set("Contents", Object::Reference(content_id));
        }
    }
    Ok(())
}

/// Per-document overlay state: one font object per font kind,
/// one ExtGState per opacity, shared across pages.
struct OverlayState {
    fonts: HashMap<OverlayFont, (ObjectId, &'static str)>,
    states: HashMap<u32, ObjectId>,
    next_font: u32,
}

impl OverlayState {
    fn new() -> Self {
        Self {
            fonts: HashMap::new(),
            states: HashMap::new(),
            next_font: 0,
        }
    }

    /// The resource name for a font (creating the font object on
    /// first use). Names are F1, F2, … in first-use order.
    fn font(&mut self, doc: &mut Document, font: OverlayFont) -> Result<(ObjectId, String)> {
        if let Some(&(id, name)) = self.fonts.get(&font) {
            return Ok((id, name.to_string()));
        }
        let id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => font.base_font(),
            "Encoding" => "WinAnsiEncoding",
        });
        self.next_font += 1;
        // Leak the name string into the map via a static: the
        // names are F1..F6 at most (six fonts), so store them in a
        // small fixed table instead.
        let static_name: &'static str = match self.next_font {
            1 => "F1",
            2 => "F2",
            3 => "F3",
            4 => "F4",
            5 => "F5",
            _ => "F6",
        };
        self.fonts.insert(font, (id, static_name));
        Ok((id, static_name.to_string()))
    }

    /// The resource name for an ExtGState with this opacity
    /// (creating it on first use). Names are GS1, GS2, ….
    fn graphics_state(&mut self, doc: &mut Document, opacity: f32) -> Result<(ObjectId, String)> {
        let key = opacity.to_bits();
        if let Some(&id) = self.states.get(&key) {
            return Ok((id, gs_name_for(&self.states, key)));
        }
        let id = doc.add_object(dictionary! {
            "Type" => "ExtGState",
            "ca" => Object::Real(opacity),
            "CA" => Object::Real(opacity),
        });
        self.states.insert(key, id);
        Ok((id, gs_name_for(&self.states, key)))
    }
}

/// Deterministic GS name for an opacity key: GS1 for the first
/// distinct opacity inserted, GS2 for the second, … (insertion
/// order is the HashMap order, so sort the keys instead — the
/// name only has to be stable within one document build).
fn gs_name_for(states: &HashMap<u32, ObjectId>, key: u32) -> String {
    let mut keys: Vec<u32> = states.keys().copied().collect();
    keys.sort_unstable();
    let pos = keys
        .iter()
        .position(|&k| k == key)
        .map(|i| i + 1)
        .unwrap_or(1);
    format!("GS{pos}")
}

impl PdfEngine {
    /// Apply overlay operations to a PDF. `images` supplies the
    /// image bytes for `OverlayOp::Image` by index. The output is
    /// a valid PDF with the same pages plus the new content; no
    /// existing content is modified. An empty op list is an error
    /// (it would be a no-op copy, and the caller asked for an edit).
    /// Returns the new bytes plus what was applied.
    pub fn edit(
        &self,
        bytes: &[u8],
        ops: &[OverlayOp],
        images: &[Vec<u8>],
    ) -> Result<(Vec<u8>, EditOutcome)> {
        if ops.is_empty() {
            return Err(PdfError::InvalidPdf(
                "edit needs at least one overlay operation".to_string(),
            ));
        }
        self.validate(bytes)?;
        let mut doc = Document::load_mem(bytes)?;
        let pages = ordered_pages(&doc);
        let page_count = pages.len() as u32;
        let mut state = OverlayState::new();
        let mut by_page: BTreeMap<u32, Vec<String>> = BTreeMap::new();
        let mut comments: Vec<(u32, ObjectId)> = Vec::new();
        let mut applied = 0usize;
        let mut warnings = Vec::new();

        for op in ops {
            match op {
                OverlayOp::Text {
                    page,
                    x,
                    y,
                    text,
                    size,
                    color,
                    font,
                } => {
                    check_pages(&[*page], page_count)?;
                    validate_text(text, *size)?;
                    color.check()?;
                    let (font_id, name) = state.font(&mut doc, *font)?;
                    let page_id = pages[(*page - 1) as usize].1;
                    add_resource(&mut doc, page_id, b"Font", &name, font_id)?;
                    by_page.entry(*page).or_default().push(format!(
                        "BT /{name} {} Tf {} rg {} {} Td {} Tj ET",
                        fmt_num(*size),
                        color.pdf(),
                        fmt_num(*x),
                        fmt_num(*y),
                        pdf_string(text)
                    ));
                    applied += 1;
                }
                OverlayOp::Image {
                    page,
                    x,
                    y,
                    width,
                    height,
                    image_index,
                } => {
                    check_pages(&[*page], page_count)?;
                    if *width <= 0.0 || *height <= 0.0 {
                        return Err(PdfError::InvalidPdf(format!(
                            "image overlay size must be positive, not {width}x{height}"
                        )));
                    }
                    let raw = images.get(*image_index).ok_or_else(|| {
                        PdfError::InvalidPdf(format!(
                            "image overlay references image {image_index}, but only {} image(s) were supplied",
                            images.len()
                        ))
                    })?;
                    let (w, h, xobj_id) = self.embed_image(&mut doc, raw)?;
                    let _ = (w, h);
                    let page_id = pages[(*page - 1) as usize].1;
                    add_resource(&mut doc, page_id, b"XObject", "ImE", xobj_id)?;
                    by_page.entry(*page).or_default().push(format!(
                        "q {} 0 0 {} {} {} cm /ImE Do Q",
                        fmt_num(*width),
                        fmt_num(*height),
                        fmt_num(*x),
                        fmt_num(*y)
                    ));
                    applied += 1;
                }
                OverlayOp::Rect {
                    page,
                    x,
                    y,
                    width,
                    height,
                    fill,
                    stroke,
                    stroke_width,
                } => {
                    check_pages(&[*page], page_count)?;
                    if *width <= 0.0 || *height <= 0.0 {
                        return Err(PdfError::InvalidPdf(format!(
                            "rectangle size must be positive, not {width}x{height}"
                        )));
                    }
                    let (fill, stroke) = match (fill, stroke) {
                        (None, None) => {
                            return Err(PdfError::InvalidPdf(
                                "rectangle needs a fill or a stroke colour".to_string(),
                            ))
                        }
                        (f, s) => (f, s),
                    };
                    if let Some(c) = fill {
                        c.check()?;
                    }
                    if let Some(c) = stroke {
                        c.check()?;
                    }
                    if *stroke_width < 0.0 {
                        return Err(PdfError::InvalidPdf(
                            "stroke width must not be negative".to_string(),
                        ));
                    }
                    let mut s = String::new();
                    if let Some(f) = fill {
                        s.push_str(&format!("{} rg ", f.pdf()));
                    }
                    if let Some(c) = stroke {
                        s.push_str(&format!("{} RG {} w ", c.pdf(), fmt_num(*stroke_width)));
                    }
                    let paint = match (fill.is_some(), stroke.is_some()) {
                        (true, true) => "B",
                        (true, false) => "f",
                        (false, true) => "S",
                        (false, false) => unreachable!(),
                    };
                    s.push_str(&format!(
                        "{} {} {} {} re {}",
                        fmt_num(*x),
                        fmt_num(*y),
                        fmt_num(*width),
                        fmt_num(*height),
                        paint
                    ));
                    by_page.entry(*page).or_default().push(s);
                    applied += 1;
                }
                OverlayOp::Line {
                    page,
                    x1,
                    y1,
                    x2,
                    y2,
                    color,
                    width,
                } => {
                    check_pages(&[*page], page_count)?;
                    color.check()?;
                    if *width < 0.0 {
                        return Err(PdfError::InvalidPdf(
                            "line width must not be negative".to_string(),
                        ));
                    }
                    by_page.entry(*page).or_default().push(format!(
                        "{} RG {} w {} {} m {} {} l S",
                        color.pdf(),
                        fmt_num(*width),
                        fmt_num(*x1),
                        fmt_num(*y1),
                        fmt_num(*x2),
                        fmt_num(*y2)
                    ));
                    applied += 1;
                }
                OverlayOp::Circle {
                    page,
                    cx,
                    cy,
                    r,
                    fill,
                    stroke,
                    stroke_width,
                } => {
                    check_pages(&[*page], page_count)?;
                    if *r <= 0.0 {
                        return Err(PdfError::InvalidPdf(format!(
                            "circle radius must be positive, not {r}"
                        )));
                    }
                    if fill.is_none() && stroke.is_none() {
                        return Err(PdfError::InvalidPdf(
                            "circle needs a fill or a stroke colour".to_string(),
                        ));
                    }
                    if let Some(c) = fill {
                        c.check()?;
                    }
                    if let Some(c) = stroke {
                        c.check()?;
                    }
                    let mut s = String::new();
                    if let Some(f) = fill {
                        s.push_str(&format!("{} rg ", f.pdf()));
                    }
                    if let Some(c) = stroke {
                        s.push_str(&format!("{} RG {} w ", c.pdf(), fmt_num(*stroke_width)));
                    }
                    // Four cubic Bézier curves, k = 0.5523.
                    let k = 0.5523 * r;
                    s.push_str(&format!(
                        "{} {} m {} {} {} {} {} {} c {} {} {} {} {} {} c {} {} {} {} {} {} c {} {} {} {} {} {} c {}",
                        fmt_num(cx + r),
                        fmt_num(*cy),
                        fmt_num(cx + r),
                        fmt_num(cy + k),
                        fmt_num(cx + k),
                        fmt_num(cy + r),
                        fmt_num(*cx),
                        fmt_num(cy + r),
                        fmt_num(cx - k),
                        fmt_num(cy + r),
                        fmt_num(cx - r),
                        fmt_num(cy + k),
                        fmt_num(cx - r),
                        fmt_num(*cy),
                        fmt_num(cx - r),
                        fmt_num(cy - k),
                        fmt_num(cx - k),
                        fmt_num(cy - r),
                        fmt_num(*cx),
                        fmt_num(cy - r),
                        fmt_num(cx + k),
                        fmt_num(cy - r),
                        fmt_num(cx + r),
                        fmt_num(cy - k),
                        fmt_num(cx + r),
                        fmt_num(*cy),
                        match (fill.is_some(), stroke.is_some()) {
                            (true, true) => "B",
                            (true, false) => "f",
                            (false, true) => "S",
                            (false, false) => unreachable!(),
                        }
                    ));
                    by_page.entry(*page).or_default().push(s);
                    applied += 1;
                }
                OverlayOp::Highlight {
                    page,
                    x,
                    y,
                    width,
                    height,
                    color,
                    opacity,
                } => {
                    check_pages(&[*page], page_count)?;
                    if *width <= 0.0 || *height <= 0.0 {
                        return Err(PdfError::InvalidPdf(format!(
                            "highlight size must be positive, not {width}x{height}"
                        )));
                    }
                    color.check()?;
                    if !(0.0..=1.0).contains(&(*opacity as f64)) {
                        return Err(PdfError::InvalidPdf(format!(
                            "highlight opacity must be 0.0..=1.0, not {opacity}"
                        )));
                    }
                    let (gs_id, gs_name) = state.graphics_state(&mut doc, *opacity)?;
                    let page_id = pages[(*page - 1) as usize].1;
                    add_resource(&mut doc, page_id, b"ExtGState", &gs_name, gs_id)?;
                    by_page.entry(*page).or_default().push(format!(
                        "q /{gs_name} gs {} rg {} {} {} {} re f Q",
                        color.pdf(),
                        fmt_num(*x),
                        fmt_num(*y),
                        fmt_num(*width),
                        fmt_num(*height)
                    ));
                    applied += 1;
                }
                OverlayOp::Draw {
                    page,
                    points,
                    color,
                    width,
                } => {
                    check_pages(&[*page], page_count)?;
                    if points.len() < 2 {
                        return Err(PdfError::InvalidPdf(
                            "draw needs at least two points".to_string(),
                        ));
                    }
                    color.check()?;
                    for (x, y) in points {
                        if !x.is_finite() || !y.is_finite() {
                            return Err(PdfError::InvalidPdf(
                                "draw points must be finite numbers".to_string(),
                            ));
                        }
                    }
                    let mut s = format!(
                        "{} RG {} w 1 J 1 j {} {} m",
                        color.pdf(),
                        fmt_num(*width),
                        fmt_num(points[0].0),
                        fmt_num(points[0].1)
                    );
                    for (x, y) in &points[1..] {
                        s.push_str(&format!(" {} {} l", fmt_num(*x), fmt_num(*y)));
                    }
                    s.push_str(" S");
                    by_page.entry(*page).or_default().push(s);
                    applied += 1;
                }
                OverlayOp::Comment {
                    page,
                    x,
                    y,
                    text,
                    author,
                } => {
                    check_pages(&[*page], page_count)?;
                    if text.trim().is_empty() {
                        return Err(PdfError::InvalidPdf(
                            "comment text must not be empty".to_string(),
                        ));
                    }
                    let annot_id = doc.add_object(dictionary! {
                        "Type" => "Annot",
                        "Subtype" => "Text",
                        "Rect" => Object::Array(vec![
                            num(*x), num(*y), num(x + 20.0), num(y + 20.0),
                        ]),
                        "Contents" => Object::String(
                            text.as_bytes().to_vec(),
                            lopdf::StringFormat::Literal,
                        ),
                        "Open" => Object::Boolean(false),
                        "C" => Object::Array(vec![
                            Object::Real(1.0), Object::Real(1.0), Object::Real(0.0),
                        ]),
                    });
                    if let Some(a) = author {
                        if let Ok(d) = doc.get_dictionary_mut(annot_id) {
                            d.set(
                                "T",
                                Object::String(a.as_bytes().to_vec(), lopdf::StringFormat::Literal),
                            );
                        }
                    }
                    comments.push((*page, annot_id));
                    applied += 1;
                }
                OverlayOp::PageNumbers {
                    pages: only,
                    format,
                    position,
                    size,
                } => {
                    if *size <= 0.0 || *size > 200.0 {
                        return Err(PdfError::InvalidPdf(format!(
                            "page number font size must be 0..=200 pt, not {size}"
                        )));
                    }
                    let targets: Vec<u32> = match only {
                        Some(list) => {
                            check_pages(list, page_count)?;
                            list.clone()
                        }
                        None => (1..=page_count).collect(),
                    };
                    let (font_id, name) = state.font(&mut doc, OverlayFont::Helvetica)?;
                    for n in targets {
                        let page_id = pages[(n - 1) as usize].1;
                        let (w, h) = page_box(&doc, page_id);
                        let label = format
                            .replace("{n}", &n.to_string())
                            .replace("{total}", &page_count.to_string());
                        let safe: String = label
                            .chars()
                            .map(|c| if c.is_ascii() { c } else { '?' })
                            .collect();
                        let text_w = size * 0.5 * safe.chars().count() as f64;
                        let (x, y) = match position {
                            PageNumberPosition::BottomCenter => ((w - text_w) / 2.0, 30.0),
                            PageNumberPosition::BottomRight => (w - text_w - 36.0, 30.0),
                            PageNumberPosition::TopCenter => ((w - text_w) / 2.0, h - 36.0),
                            PageNumberPosition::TopRight => (w - text_w - 36.0, h - 36.0),
                        };
                        add_resource(&mut doc, page_id, b"Font", &name, font_id)?;
                        by_page.entry(n).or_default().push(format!(
                            "BT /{name} {} Tf 0 0 0 rg {} {} Td {} Tj ET",
                            fmt_num(*size),
                            fmt_num(x),
                            fmt_num(y),
                            pdf_string(&safe)
                        ));
                        applied += 1;
                    }
                }
                OverlayOp::HeaderFooter {
                    pages: only,
                    header,
                    footer,
                    size,
                } => {
                    if header.is_none() && footer.is_none() {
                        return Err(PdfError::InvalidPdf(
                            "header/footer needs a header or a footer text".to_string(),
                        ));
                    }
                    if *size <= 0.0 || *size > 200.0 {
                        return Err(PdfError::InvalidPdf(format!(
                            "header/footer font size must be 0..=200 pt, not {size}"
                        )));
                    }
                    let targets: Vec<u32> = match only {
                        Some(list) => {
                            check_pages(list, page_count)?;
                            list.clone()
                        }
                        None => (1..=page_count).collect(),
                    };
                    let (font_id, name) = state.font(&mut doc, OverlayFont::Helvetica)?;
                    for n in targets {
                        let page_id = pages[(n - 1) as usize].1;
                        let (w, h) = page_box(&doc, page_id);
                        for (text, y) in [(header.as_deref(), h - 36.0), (footer.as_deref(), 30.0)]
                        {
                            let Some(text) = text else { continue };
                            if text.trim().is_empty() {
                                continue;
                            }
                            let safe: String = text
                                .chars()
                                .map(|c| if c.is_ascii() { c } else { '?' })
                                .collect();
                            let text_w = size * 0.5 * safe.chars().count() as f64;
                            let x = (w - text_w) / 2.0;
                            add_resource(&mut doc, page_id, b"Font", &name, font_id)?;
                            by_page.entry(n).or_default().push(format!(
                                "BT /{name} {} Tf 0 0 0 rg {} {} Td {} Tj ET",
                                fmt_num(*size),
                                fmt_num(x),
                                fmt_num(y),
                                pdf_string(&safe)
                            ));
                            applied += 1;
                        }
                    }
                }
            }
        }

        // One content stream per touched page, appended after the
        // page's own content (overlays draw on top, like the
        // watermark). Comments are annotations, not content — but
        // they still change the page, so a page that only got a
        // comment counts as touched too.
        let mut touched: std::collections::HashSet<u32> = by_page.keys().copied().collect();
        for (page, _) in &comments {
            touched.insert(*page);
        }
        let pages_touched = touched.len();
        for (page, chunks) in &by_page {
            let page_id = pages[(*page - 1) as usize].1;
            let content = chunks.join("\n");
            append_content_stream(&mut doc, page_id, content.into_bytes())?;
        }
        let mut comments_added = 0usize;
        for (page, annot_id) in comments {
            let page_id = pages[(page - 1) as usize].1;
            append_annotation(&mut doc, page_id, annot_id)?;
            comments_added += 1;
        }
        if applied == 0 {
            warnings.push(
                "no overlay operations applied (all ops were empty after validation)".to_string(),
            );
        }
        let mut out = Vec::new();
        doc.save_to(&mut std::io::Cursor::new(&mut out))?;
        Ok((
            out,
            EditOutcome {
                ops_applied: applied,
                pages_touched,
                comments_added,
                warnings,
            },
        ))
    }

    /// Embed one decoded image as a FlateDecode RGB XObject and
    /// return (pixel width, pixel height, object id). Alpha is
    /// flattened onto white, like `from_images`.
    fn embed_image(&self, doc: &mut Document, raw: &[u8]) -> Result<(u32, u32, ObjectId)> {
        use flate2::{write::ZlibEncoder, Compression};
        use openpixel_core::Engine;
        use std::io::Write;
        let engine = Engine::default();
        let (_, img) = engine.decode_bytes(raw, None).map_err(|e| {
            PdfError::InvalidPdf(format!("overlay image could not be decoded: {e}"))
        })?;
        let rgb = img.to_dynamic().to_rgb8();
        let (w, h) = (rgb.width(), rgb.height());
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
        encoder
            .write_all(rgb.as_raw())
            .map_err(|e| PdfError::Lopdf(format!("could not compress overlay image: {e}")))?;
        let compressed = encoder
            .finish()
            .map_err(|e| PdfError::Lopdf(format!("could not compress overlay image: {e}")))?;
        let id = doc.add_object(Stream::new(
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
        Ok((w, h, id))
    }

    /// Set document metadata (/Info). Each `Some` value is
    /// written; `Some("")` clears the field; `None` leaves it
    /// unchanged. Returns the new document bytes.
    pub fn set_metadata(&self, bytes: &[u8], edit: MetadataEdit) -> Result<Vec<u8>> {
        if edit.title.is_none()
            && edit.author.is_none()
            && edit.subject.is_none()
            && edit.keywords.is_none()
            && edit.creator.is_none()
            && edit.producer.is_none()
        {
            return Err(PdfError::InvalidPdf(
                "set-metadata needs at least one field".to_string(),
            ));
        }
        self.validate(bytes)?;
        let mut doc = Document::load_mem(bytes)?;
        let info_id = match doc
            .trailer
            .get(b"Info")
            .ok()
            .and_then(|o| o.as_reference().ok())
        {
            Some(id) => id,
            None => {
                let id = doc.add_object(Dictionary::new());
                doc.trailer.set("Info", Object::Reference(id));
                id
            }
        };
        let mut set = |key: &[u8], value: &Option<String>| -> Result<()> {
            let Some(v) = value else { return Ok(()) };
            let dict = doc.get_dictionary_mut(info_id)?;
            if v.is_empty() {
                dict.remove(key);
            } else {
                dict.set(
                    key,
                    Object::String(v.as_bytes().to_vec(), lopdf::StringFormat::Literal),
                );
            }
            Ok(())
        };
        set(b"Title", &edit.title)?;
        set(b"Author", &edit.author)?;
        set(b"Subject", &edit.subject)?;
        set(b"Creator", &edit.creator)?;
        set(b"Producer", &edit.producer)?;
        set(b"Keywords", &edit.keywords)?;
        save_to_bytes(&mut doc)
    }
}

/// Validate overlay text + size.
fn validate_text(text: &str, size: f64) -> Result<()> {
    if text.trim().is_empty() {
        return Err(PdfError::InvalidPdf(
            "overlay text must not be empty".to_string(),
        ));
    }
    if size <= 0.0 || size > 200.0 {
        return Err(PdfError::InvalidPdf(format!(
            "overlay font size must be 0..=200 pt, not {size}"
        )));
    }
    Ok(())
}

/// Append an annotation object id to a page's /Annots array
/// (creating the array when the page has none).
pub(crate) fn append_annotation(
    doc: &mut Document,
    page_id: ObjectId,
    annot_id: ObjectId,
) -> Result<()> {
    let annots = doc
        .get_dictionary(page_id)
        .and_then(|d| d.get(b"Annots"))
        .cloned();
    match annots {
        Ok(Object::Reference(id)) => {
            let arr = doc
                .get_object_mut(id)
                .and_then(|o| o.as_array_mut())
                .map_err(|e| PdfError::Lopdf(e.to_string()))?;
            arr.push(Object::Reference(annot_id));
        }
        Ok(Object::Array(mut items)) => {
            items.push(Object::Reference(annot_id));
            doc.get_dictionary_mut(page_id)?
                .set("Annots", Object::Array(items));
        }
        _ => {
            doc.get_dictionary_mut(page_id)?
                .set("Annots", Object::Array(vec![Object::Reference(annot_id)]));
        }
    }
    Ok(())
}

/// Decode a page's content stream into operations (for flatten:
/// appearance streams are inlined as operations, with their
/// resource names remapped). Fails cleanly when the stream does
/// not parse — the caller decides whether that is fatal.
pub(crate) fn decode_ops(doc: &Document, page_id: ObjectId) -> Result<Vec<Operation>> {
    let content = doc
        .get_and_decode_page_content(page_id)
        .map_err(|e| PdfError::Lopdf(format!("could not decode page content: {e}")))?;
    Ok(content.operations)
}

impl PdfEngine {
    /// Flatten annotations and form fields into page content.
    ///
    /// An annotation with an appearance stream is rendered into
    /// the page content (its appearance ops, wrapped in the
    /// rect/bbox/matrix transform, with its resource names
    /// remapped when they would collide with the page's own) and
    /// then removed. An annotation WITHOUT an appearance has
    /// nothing visible to keep: it is removed and counted as
    /// dropped, with a warning — its text is NOT silently
    /// rendered. Form fields (/AcroForm) are removed after their
    /// widgets are flattened or dropped; a field value that only
    /// exists as a widget appearance survives through that
    /// appearance, otherwise it is lost (warned). The output is
    /// re-parsed before returning, so a broken save is an error
    /// here, not a corrupt file on disk.
    pub fn flatten(&self, bytes: &[u8]) -> Result<(Vec<u8>, FlattenOutcome)> {
        self.validate(bytes)?;
        let mut doc = Document::load_mem(bytes)?;
        let pages = ordered_pages(&doc);
        let mut outcome = FlattenOutcome {
            annotations_flattened: 0,
            annotations_dropped: 0,
            form_fields_removed: 0,
            warnings: Vec::new(),
        };

        // Form fields first (count only — the widgets are
        // annotations on the pages and are handled below).
        let mut field_ids: Vec<ObjectId> = Vec::new();
        if let Ok(acro) = doc
            .trailer
            .get(b"Root")
            .and_then(|r| r.as_reference())
            .and_then(|root| doc.get_dictionary(root))
            .and_then(|c| c.get(b"AcroForm"))
            .cloned()
        {
            let acro_id = match &acro {
                Object::Reference(id) => Some(*id),
                _ => None,
            };
            let fields = match &acro {
                Object::Reference(id) => doc
                    .get_dictionary(*id)
                    .and_then(|d| d.get(b"Fields"))
                    .cloned()
                    .ok(),
                Object::Dictionary(d) => d.get(b"Fields").cloned().ok(),
                _ => None,
            };
            if let Some(Object::Array(items)) = fields {
                for item in items {
                    if let Object::Reference(id) = item {
                        collect_field_ids(&doc, id, &mut field_ids);
                    }
                }
            }
            outcome.form_fields_removed = field_ids.len() as u32;
            if let Some(id) = acro_id {
                doc.objects.remove(&id);
            }
        }

        for (page_no, page_id) in &pages {
            // The /Annots value (array or reference to one).
            let annots_obj = doc
                .get_dictionary(*page_id)
                .and_then(|d| d.get(b"Annots"))
                .cloned();
            let Ok(annots_obj) = annots_obj else { continue };
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
                _ => continue,
            };
            if items.is_empty() {
                continue;
            }
            let mut flat_content: Vec<u8> = Vec::new();
            for item in items {
                let Object::Reference(annot_id) = item else {
                    continue;
                };
                let subtype = doc
                    .get_dictionary(annot_id)
                    .and_then(|d| d.get(b"Subtype"))
                    .and_then(|s| s.as_name())
                    .map(|n| String::from_utf8_lossy(n).into_owned())
                    .unwrap_or_else(|_| "Unknown".to_string());
                match flatten_annotation(&mut doc, *page_id, annot_id, &mut outcome) {
                    Ok(Some(chunk)) => {
                        flat_content.extend_from_slice(&chunk);
                        outcome.annotations_flattened += 1;
                    }
                    Ok(None) => {
                        outcome.annotations_dropped += 1;
                        outcome.warnings.push(format!(
                            "page {page_no}: {subtype} annotation without an appearance was removed (nothing visible to flatten)"
                        ));
                    }
                    Err(e) => {
                        // A broken annotation must not abort the
                        // whole document: drop it and say so.
                        outcome.annotations_dropped += 1;
                        outcome.warnings.push(format!(
                            "page {page_no}: {subtype} annotation could not be flattened ({e}) and was removed"
                        ));
                    }
                }
                doc.objects.remove(&annot_id);
            }
            if !flat_content.is_empty() {
                append_content_stream(&mut doc, *page_id, flat_content)?;
            }
            if let Ok(d) = doc.get_dictionary_mut(*page_id) {
                d.remove(b"Annots");
            }
            if let Some(id) = annots_id {
                doc.objects.remove(&id);
            }
        }

        // Remove the catalog /AcroForm key and the field dicts.
        if let Ok(root) = doc.trailer.get(b"Root").and_then(|r| r.as_reference()) {
            if let Ok(catalog) = doc.get_dictionary_mut(root) {
                catalog.remove(b"AcroForm");
            }
        }
        for id in field_ids {
            doc.objects.remove(&id);
        }
        if outcome.form_fields_removed > 0 {
            outcome.warnings.push(format!(
                "removed {} form field(s); a field value survives only when its widget had an appearance stream",
                outcome.form_fields_removed
            ));
        }
        let out = save_to_bytes(&mut doc)?;
        // The output must parse again — a broken save is an error
        // here, not a corrupt file handed to the user.
        Document::load_mem(&out)
            .map_err(|e| PdfError::Lopdf(format!("flattened PDF does not parse again: {e}")))?;
        Ok((out, outcome))
    }
}

/// Collect a field dict id plus its /Kids recursively (a field
/// tree: parent fields own child fields).
fn collect_field_ids(doc: &Document, id: ObjectId, out: &mut Vec<ObjectId>) {
    if out.contains(&id) {
        return;
    }
    out.push(id);
    if let Ok(d) = doc.get_dictionary(id) {
        if let Ok(Object::Array(kids)) = d.get(b"Kids").cloned() {
            for kid in kids {
                if let Object::Reference(kid_id) = kid {
                    collect_field_ids(doc, kid_id, out);
                }
            }
        }
    }
}

/// Flatten ONE annotation. Returns `Some(content)` when the
/// appearance was inlined (the content bytes to append to the
/// page), `None` when the annotation has no appearance (drop
/// it), or an error when the appearance cannot be used (the
/// caller drops it and records the warning).
fn flatten_annotation(
    doc: &mut Document,
    page_id: ObjectId,
    annot_id: ObjectId,
    outcome: &mut FlattenOutcome,
) -> Result<Option<Vec<u8>>> {
    let _ = outcome;
    let annot = doc
        .get_dictionary(annot_id)
        .cloned()
        .map_err(|e| PdfError::Lopdf(e.to_string()))?;
    // /AP /N: the normal appearance. It may be a stream, or a
    // sub-dictionary keyed by appearance state (take any stream).
    let ap = annot.get(b"AP").cloned().ok();
    let normal = match ap {
        Some(Object::Dictionary(ap)) => ap.get(b"N").cloned().ok(),
        _ => None,
    };
    let ap_stream_id = match normal {
        Some(Object::Reference(id)) => Some(id),
        Some(Object::Dictionary(states)) => states.iter().find_map(|(_, v)| v.as_reference().ok()),
        _ => None,
    };
    let Some(ap_id) = ap_stream_id else {
        return Ok(None);
    };
    let ap_stream = match doc.get_object(ap_id) {
        Ok(Object::Stream(s)) => s.clone(),
        _ => return Ok(None),
    };
    // /Rect (annotation rect in page space) and /BBox + /Matrix
    // (appearance space). A degenerate bbox cannot be mapped.
    let rect = annot
        .get(b"Rect")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();
    let rect = rect_numbers(&rect);
    let bbox = ap_stream
        .dict
        .get(b"BBox")
        .and_then(|b| b.as_array())
        .cloned()
        .unwrap_or_default();
    let bbox = rect_numbers(&bbox);
    let matrix = ap_stream
        .dict
        .get(b"Matrix")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();
    let matrix = rect_numbers(&matrix);
    let (rx1, ry1, rx2, ry2) = match rect.as_slice() {
        [a, b, c, d] => (*a, *b, *c, *d),
        _ => return Ok(None),
    };
    let (bx1, by1, bx2, by2) = match bbox.as_slice() {
        [a, b, c, d] => (*a, *b, *c, *d),
        _ => (0.0, 0.0, 1.0, 1.0),
    };
    if (bx2 - bx1).abs() < 1e-9 || (by2 - by1).abs() < 1e-9 {
        return Ok(None);
    }
    let (a, b, c, d, e, f) = match matrix.as_slice() {
        [a, b, c, d, e, f] => (*a, *b, *c, *d, *e, *f),
        _ => (1.0, 0.0, 0.0, 1.0, 0.0, 0.0),
    };
    let sx = (rx2 - rx1) / (bx2 - bx1);
    let sy = (ry2 - ry1) / (by2 - by1);
    let tx = rx1 - bx1 * sx;
    let ty = ry1 - by1 * sy;

    // Resources: the appearance's own dict, or (when it has none)
    // the page's — in which case no merge and no rename is needed.
    let ap_resources = ap_stream.dict.get(b"Resources").cloned().ok();
    let mut renames: HashMap<(String, String), String> = HashMap::new();
    if let Some(Object::Dictionary(res)) = &ap_resources {
        merge_resources(doc, page_id, res, &mut renames)?;
    } else if let Some(Object::Reference(rid)) = &ap_resources {
        if let Ok(res) = doc.get_dictionary(*rid).cloned() {
            merge_resources(doc, page_id, &res, &mut renames)?;
        }
    }
    // Decode the appearance content, remap resource names that
    // collided, re-encode, and wrap it in the transform.
    let raw = ap_stream
        .decompressed_content()
        .map_err(|e| PdfError::Lopdf(format!("appearance content could not be decoded: {e}")))?;
    let content = Content::decode(&raw)
        .map_err(|e| PdfError::Lopdf(format!("appearance content could not be parsed: {e}")))?;
    let mut ops = content.operations;
    remap_resource_names(&mut ops, &renames);
    let encoded = Content { operations: ops }
        .encode()
        .map_err(|e| PdfError::Lopdf(format!("appearance content could not be encoded: {e}")))?;
    // The appearance stream object itself is deleted by the
    // caller (it is part of the annotation being removed); the
    // /R and /D appearances go with it — remove them here so
    // they do not linger as orphans.
    if let Ok(Object::Dictionary(ap)) = annot.get(b"AP").cloned() {
        for key in [b"R".as_slice(), b"D".as_slice()] {
            if let Ok(id) = ap.get(key).and_then(|v| v.as_reference()) {
                doc.objects.remove(&id);
            }
        }
    }
    doc.objects.remove(&ap_id);
    let mut out = format!(
        "q {} 0 0 {} {} {} cm {} {} {} {} {} {} cm ",
        fmt_num(sx),
        fmt_num(sy),
        fmt_num(tx),
        fmt_num(ty),
        fmt_num(a),
        fmt_num(b),
        fmt_num(c),
        fmt_num(d),
        fmt_num(e),
        fmt_num(f)
    )
    .into_bytes();
    out.extend_from_slice(&encoded);
    out.extend_from_slice(b" Q");
    Ok(Some(out))
}

/// The page's effective resource dict for a category (its own
/// Resources, or the inherited one), cloned. `None` when the
/// page has no such category.
fn effective_category(doc: &Document, page_id: ObjectId, category: &[u8]) -> Option<Dictionary> {
    let res = match doc
        .get_dictionary(page_id)
        .and_then(|d| d.get(b"Resources"))
    {
        Ok(Object::Reference(rid)) => doc.get_dictionary(*rid).cloned().ok(),
        Ok(Object::Dictionary(d)) => Some(d.clone()),
        _ => match crate::engine::inherited_attribute(doc, page_id, b"Resources") {
            Some(Object::Dictionary(d)) => Some(d),
            Some(Object::Reference(rid)) => doc.get_dictionary(rid).cloned().ok(),
            _ => None,
        },
    }?;
    match res.get(category) {
        Ok(Object::Dictionary(d)) => Some(d.clone()),
        Ok(Object::Reference(rid)) => doc.get_dictionary(*rid).cloned().ok(),
        _ => None,
    }
}

/// Merge an appearance stream's Resources into the page's,
/// renaming entries whose name already points at a different
/// object. `renames` records (category, old name) → new name so
/// the appearance content can be rewritten.
fn merge_resources(
    doc: &mut Document,
    page_id: ObjectId,
    ap_res: &Dictionary,
    renames: &mut HashMap<(String, String), String>,
) -> Result<()> {
    for category in [
        "Font",
        "ExtGState",
        "XObject",
        "ColorSpace",
        "Pattern",
        "Shading",
        "Properties",
    ] {
        let Ok(Object::Dictionary(cat)) = ap_res.get(category.as_bytes()).cloned() else {
            continue;
        };
        for (name, value) in cat.iter() {
            let name = String::from_utf8_lossy(name).into_owned();
            let Ok(id) = value.as_reference() else {
                continue;
            };
            let existing = effective_category(doc, page_id, category.as_bytes())
                .and_then(|d| d.get(name.as_bytes()).cloned().ok())
                .and_then(|v| v.as_reference().ok());
            match existing {
                Some(existing_id) if existing_id == id => {}
                Some(_) => {
                    // Collision: rename the appearance's entry.
                    let mut new_name = format!("{name}f");
                    loop {
                        let taken = effective_category(doc, page_id, category.as_bytes())
                            .and_then(|d| d.get(new_name.as_bytes()).cloned().ok())
                            .is_some();
                        if !taken {
                            break;
                        }
                        new_name.push('f');
                    }
                    renames.insert((category.to_string(), name.clone()), new_name.clone());
                    add_resource(doc, page_id, category.as_bytes(), &new_name, id)?;
                }
                None => {
                    add_resource(doc, page_id, category.as_bytes(), &name, id)?;
                }
            }
        }
    }
    Ok(())
}

/// Rewrite resource names in decoded operations after a merge
/// renamed them. Only the operators whose operand is a resource
/// name are touched, and only for the category that operator
/// looks up (Tf → Font, Do → XObject, gs → ExtGState, cs/CS →
/// ColorSpace, sh → Shading, BDC/DP → Properties, scn/SCN →
/// ColorSpace then Pattern).
fn remap_resource_names(ops: &mut [Operation], renames: &HashMap<(String, String), String>) {
    if renames.is_empty() {
        return;
    }
    for op in ops.iter_mut() {
        let categories: &[&str] = match op.operator.as_str() {
            "Tf" => &["Font"],
            "Do" => &["XObject"],
            "gs" => &["ExtGState"],
            "cs" | "CS" => &["ColorSpace"],
            "sh" => &["Shading"],
            "BDC" | "DP" => &["Properties"],
            "scn" | "SCN" => &["ColorSpace", "Pattern"],
            _ => continue,
        };
        for operand in op.operands.iter_mut() {
            let Object::Name(name) = operand else {
                continue;
            };
            let name_str = String::from_utf8_lossy(name).into_owned();
            for cat in categories {
                if let Some(new) = renames.get(&((*cat).to_string(), name_str.clone())) {
                    *operand = Object::Name(new.as_bytes().to_vec());
                    break;
                }
            }
        }
    }
}

/// Numbers from a PDF array object (integers and reals).
pub(crate) fn rect_numbers(arr: &[Object]) -> Vec<f64> {
    arr.iter()
        .filter_map(|o| match o {
            Object::Integer(i) => Some(*i as f64),
            Object::Real(r) => Some(*r as f64),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::tests::{contains_bytes, make_pdf};

    /// The text a page draws, read from its content operations
    /// (works without PDFium — it proves an overlay is real text
    /// in the content stream, not a bitmap).
    fn content_text(doc: &Document, page_id: ObjectId) -> String {
        let ops = decode_ops(doc, page_id).unwrap();
        let mut s = String::new();
        for op in &ops {
            match op.operator.as_str() {
                "Tj" | "'" | "\"" => {
                    for operand in &op.operands {
                        if let Ok(b) = operand.as_str() {
                            s.push_str(&String::from_utf8_lossy(b));
                        }
                    }
                    s.push(' ');
                }
                "TJ" => {
                    for operand in &op.operands {
                        if let Object::Array(items) = operand {
                            for item in items {
                                if let Ok(b) = item.as_str() {
                                    s.push_str(&String::from_utf8_lossy(b));
                                }
                            }
                        }
                    }
                    s.push(' ');
                }
                _ => {}
            }
        }
        s
    }

    fn text_op(page: u32, text: &str) -> OverlayOp {
        OverlayOp::Text {
            page,
            x: 50.0,
            y: 600.0,
            text: text.to_string(),
            size: 14.0,
            color: Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
            },
            font: OverlayFont::Helvetica,
        }
    }

    #[test]
    fn edit_text_overlay_is_extractable_and_keeps_original() {
        let engine = PdfEngine::default();
        let input = make_pdf(1, "Original");
        let (out, outcome) = engine
            .edit(&input, &[text_op(1, "ADDED TEXT")], &[])
            .unwrap();
        assert_eq!(outcome.ops_applied, 1);
        assert_eq!(outcome.pages_touched, 1);
        let doc = Document::load_mem(&out).unwrap();
        let pages = ordered_pages(&doc);
        let text = content_text(&doc, pages[0].1);
        assert!(text.contains("ADDED TEXT"), "overlay text missing: {text}");
        assert!(
            text.contains("Original page 1"),
            "original text lost: {text}"
        );
    }

    #[test]
    #[cfg(feature = "pdfium")]
    fn edit_text_overlay_is_extractable_by_pdfium() {
        // The same overlay, read back through PDFium's real text
        // extraction (needs the pdfium feature, like the other
        // extraction tests in this crate).
        let engine = PdfEngine::default();
        let input = make_pdf(1, "Original");
        let (out, _) = engine
            .edit(&input, &[text_op(1, "ADDED TEXT")], &[])
            .unwrap();
        let pages = engine.extract_text(&out, None).unwrap();
        let text = PdfEngine::text_to_txt(&pages);
        assert!(
            text.contains("ADDED TEXT"),
            "overlay not extractable: {text}"
        );
        assert!(
            text.contains("Original page 1"),
            "original text lost: {text}"
        );
    }

    #[test]
    fn edit_shapes_page_numbers_and_header_footer() {
        let engine = PdfEngine::default();
        let input = make_pdf(2, "Doc");
        let ops = vec![
            OverlayOp::Rect {
                page: 1,
                x: 10.0,
                y: 10.0,
                width: 100.0,
                height: 50.0,
                fill: Some(Rgb {
                    r: 0.9,
                    g: 0.0,
                    b: 0.0,
                }),
                stroke: None,
                stroke_width: 1.0,
            },
            OverlayOp::Circle {
                page: 1,
                cx: 200.0,
                cy: 200.0,
                r: 30.0,
                fill: None,
                stroke: Some(Rgb {
                    r: 0.0,
                    g: 0.0,
                    b: 1.0,
                }),
                stroke_width: 2.0,
            },
            OverlayOp::Line {
                page: 1,
                x1: 0.0,
                y1: 0.0,
                x2: 100.0,
                y2: 100.0,
                color: Rgb::grey(0.0),
                width: 1.0,
            },
            OverlayOp::Draw {
                page: 2,
                points: vec![(10.0, 10.0), (20.0, 30.0), (40.0, 10.0)],
                color: Rgb::grey(0.0),
                width: 1.5,
            },
            OverlayOp::Highlight {
                page: 2,
                x: 100.0,
                y: 690.0,
                width: 200.0,
                height: 20.0,
                color: Rgb {
                    r: 1.0,
                    g: 1.0,
                    b: 0.0,
                },
                opacity: 0.4,
            },
            OverlayOp::PageNumbers {
                pages: None,
                format: "Page {n} of {total}".to_string(),
                position: PageNumberPosition::BottomCenter,
                size: 10.0,
            },
            OverlayOp::HeaderFooter {
                pages: None,
                header: Some("CONFIDENTIAL".to_string()),
                footer: Some("Footer line".to_string()),
                size: 9.0,
            },
        ];
        let (out, outcome) = engine.edit(&input, &ops, &[]).unwrap();
        assert_eq!(outcome.ops_applied, 11); // 5 shapes + 2 page numbers + 2 headers + 2 footers
        assert_eq!(outcome.pages_touched, 2);
        let info = engine.inspect(&out).unwrap();
        assert_eq!(info.page_count, 2);
        let doc = Document::load_mem(&out).unwrap();
        let pages = ordered_pages(&doc);
        let text = format!(
            "{} {}",
            content_text(&doc, pages[0].1),
            content_text(&doc, pages[1].1)
        );
        assert!(text.contains("Page 1 of 2"), "page number missing: {text}");
        assert!(text.contains("Page 2 of 2"), "page number missing: {text}");
        assert!(text.contains("CONFIDENTIAL"), "header missing: {text}");
        assert!(text.contains("Footer line"), "footer missing: {text}");
    }

    #[test]
    fn edit_image_overlay_embeds_an_xobject() {
        let engine = PdfEngine::default();
        let input = make_pdf(1, "Doc");
        // A 4x4 red PNG, built in the test.
        let mut png = Vec::new();
        {
            let img = image::RgbImage::from_pixel(4, 4, image::Rgb([255, 0, 0]));
            image::DynamicImage::ImageRgb8(img)
                .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
                .unwrap();
        }
        let op = OverlayOp::Image {
            page: 1,
            x: 100.0,
            y: 100.0,
            width: 50.0,
            height: 50.0,
            image_index: 0,
        };
        let (out, outcome) = engine.edit(&input, &[op], &[png]).unwrap();
        assert_eq!(outcome.ops_applied, 1);
        let doc = Document::load_mem(&out).unwrap();
        let pages = ordered_pages(&doc);
        let resources = doc
            .get_dictionary(pages[0].1)
            .unwrap()
            .get(b"Resources")
            .unwrap()
            .as_reference()
            .unwrap();
        let xobjects = match doc
            .get_dictionary(resources)
            .unwrap()
            .get(b"XObject")
            .unwrap()
            .clone()
        {
            Object::Reference(id) => doc.get_dictionary(id).unwrap().clone(),
            Object::Dictionary(d) => d,
            _ => panic!("no XObject dict"),
        };
        assert!(xobjects.get(b"ImE").is_ok(), "image XObject missing");
    }

    #[test]
    fn edit_comment_adds_a_text_annotation() {
        let engine = PdfEngine::default();
        let input = make_pdf(1, "Doc");
        let (out, outcome) = engine
            .edit(
                &input,
                &[OverlayOp::Comment {
                    page: 1,
                    x: 100.0,
                    y: 100.0,
                    text: "Review this".to_string(),
                    author: Some("Raju".to_string()),
                }],
                &[],
            )
            .unwrap();
        assert_eq!(outcome.comments_added, 1);
        let doc = Document::load_mem(&out).unwrap();
        let pages = ordered_pages(&doc);
        let annots = doc
            .get_dictionary(pages[0].1)
            .unwrap()
            .get(b"Annots")
            .unwrap()
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(annots.len(), 1);
        let id = annots[0].as_reference().unwrap();
        let d = doc.get_dictionary(id).unwrap();
        assert_eq!(d.get(b"Subtype").unwrap().as_name().unwrap(), b"Text");
        let contents = d.get(b"Contents").unwrap().as_str().unwrap();
        assert_eq!(contents, b"Review this");
    }

    #[test]
    fn edit_rejects_bad_input() {
        let engine = PdfEngine::default();
        let input = make_pdf(1, "Doc");
        assert!(engine.edit(&input, &[], &[]).is_err());
        assert!(engine.edit(&input, &[text_op(9, "x")], &[]).is_err());
        assert!(engine.edit(&input, &[text_op(1, "   ")], &[]).is_err());
        assert!(engine
            .edit(
                &input,
                &[OverlayOp::Rect {
                    page: 1,
                    x: 0.0,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                    fill: None,
                    stroke: None,
                    stroke_width: 1.0,
                }],
                &[]
            )
            .is_err());
        assert!(engine
            .edit(
                &input,
                &[OverlayOp::Image {
                    page: 1,
                    x: 0.0,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                    image_index: 0,
                }],
                &[]
            )
            .is_err());
    }

    #[test]
    fn set_metadata_writes_and_clears() {
        let engine = PdfEngine::default();
        let input = make_pdf(1, "Doc");
        let out = engine
            .set_metadata(
                &input,
                MetadataEdit {
                    title: Some("New Title".to_string()),
                    author: Some("Me".to_string()),
                    ..Default::default()
                },
            )
            .unwrap();
        let info = engine.inspect(&out).unwrap();
        assert_eq!(info.title.as_deref(), Some("New Title"));
        assert_eq!(info.author.as_deref(), Some("Me"));
        let out2 = engine
            .set_metadata(
                &out,
                MetadataEdit {
                    title: Some(String::new()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(engine.inspect(&out2).unwrap().title, None);
        assert!(engine
            .set_metadata(&input, MetadataEdit::default())
            .is_err());
    }

    /// Build a PDF with two annotations on page 1: a highlight
    /// with a red-rect appearance stream, and a bare text
    /// annotation with no appearance.
    fn make_annotated_pdf() -> Vec<u8> {
        let mut doc = Document::load_mem(&make_pdf(1, "Doc")).unwrap();
        let pages = ordered_pages(&doc);
        let page_id = pages[0].1;
        let ap_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Form",
                "BBox" => Object::Array(vec![
                    Object::Integer(0), Object::Integer(0),
                    Object::Integer(100), Object::Integer(100),
                ]),
                "Resources" => Dictionary::new(),
            },
            b"1 0 0 rg 10 10 50 20 re f".to_vec(),
        ));
        let hl_id = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Highlight",
            "Rect" => Object::Array(vec![
                Object::Integer(10), Object::Integer(10),
                Object::Integer(60), Object::Integer(30),
            ]),
            "AP" => dictionary! { "N" => Object::Reference(ap_id) },
            "QuadPoints" => Object::Array(vec![
                Object::Integer(10), Object::Integer(10),
                Object::Integer(60), Object::Integer(10),
                Object::Integer(10), Object::Integer(30),
                Object::Integer(60), Object::Integer(30),
            ]),
        });
        let bare_id = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Text",
            "Rect" => Object::Array(vec![
                Object::Integer(100), Object::Integer(100),
                Object::Integer(120), Object::Integer(120),
            ]),
            "Contents" => Object::String(b"bare note".to_vec(), lopdf::StringFormat::Literal),
        });
        doc.get_dictionary_mut(page_id).unwrap().set(
            "Annots",
            Object::Array(vec![Object::Reference(hl_id), Object::Reference(bare_id)]),
        );
        let mut out = Vec::new();
        doc.save_to(&mut std::io::Cursor::new(&mut out)).unwrap();
        out
    }

    #[test]
    fn flatten_renders_appearance_and_drops_bare_annotation() {
        let engine = PdfEngine::default();
        let input = make_annotated_pdf();
        let (out, outcome) = engine.flatten(&input).unwrap();
        assert_eq!(outcome.annotations_flattened, 1);
        assert_eq!(outcome.annotations_dropped, 1);
        assert_eq!(outcome.form_fields_removed, 0);
        assert!(!outcome.warnings.is_empty());
        // The flattened page still parses and keeps its text.
        let info = engine.inspect(&out).unwrap();
        assert_eq!(info.page_count, 1);
        let doc = Document::load_mem(&out).unwrap();
        let pages = ordered_pages(&doc);
        assert!(
            content_text(&doc, pages[0].1).contains("Doc page 1"),
            "flattened page lost its text"
        );
        // The appearance's red rect is now page content.
        let content = doc.get_and_decode_page_content(pages[0].1).unwrap();
        let encoded = content.encode().unwrap();
        let text = String::from_utf8_lossy(&encoded);
        assert!(
            text.contains("1 0 0 rg"),
            "appearance not in page content: {text}"
        );
        assert!(
            text.contains("re"),
            "appearance rect not in page content: {text}"
        );
        // No annotations remain, and the bare note's text is gone
        // from the file bytes entirely.
        assert!(doc
            .get_dictionary(pages[0].1)
            .unwrap()
            .get(b"Annots")
            .is_err());
        assert!(
            !contains_bytes(&out, b"bare note"),
            "bare note leaked into output"
        );
    }

    #[test]
    fn flatten_removes_acroform() {
        let engine = PdfEngine::default();
        let mut doc = Document::load_mem(&make_annotated_pdf()).unwrap();
        let pages = ordered_pages(&doc);
        let page_id = pages[0].1;
        // A widget annotation (with an appearance) whose parent is
        // a text field.
        let ap_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Form",
                "BBox" => Object::Array(vec![
                    Object::Integer(0), Object::Integer(0),
                    Object::Integer(100), Object::Integer(20),
                ]),
                "Resources" => Dictionary::new(),
            },
            b"0.9 0.9 0.9 rg 0 0 100 20 re f".to_vec(),
        ));
        let field_id = doc.add_object(dictionary! {
            "FT" => "Tx",
            "T" => Object::String(b"name".to_vec(), lopdf::StringFormat::Literal),
            "V" => Object::String(b"Raju".to_vec(), lopdf::StringFormat::Literal),
        });
        let widget_id = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "Rect" => Object::Array(vec![
                Object::Integer(100), Object::Integer(500),
                Object::Integer(200), Object::Integer(520),
            ]),
            "Parent" => Object::Reference(field_id),
            "AP" => dictionary! { "N" => Object::Reference(ap_id) },
        });
        let acro_id = doc.add_object(dictionary! {
            "Fields" => Object::Array(vec![Object::Reference(field_id)]),
        });
        let root = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        doc.get_dictionary_mut(root)
            .unwrap()
            .set("AcroForm", Object::Reference(acro_id));
        doc.get_dictionary_mut(page_id)
            .unwrap()
            .set("Annots", Object::Array(vec![Object::Reference(widget_id)]));
        let mut input = Vec::new();
        doc.save_to(&mut std::io::Cursor::new(&mut input)).unwrap();
        let (out, outcome) = engine.flatten(&input).unwrap();
        assert_eq!(outcome.annotations_flattened, 1);
        assert_eq!(outcome.form_fields_removed, 1);
        let doc = Document::load_mem(&out).unwrap();
        let root = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        assert!(doc.get_dictionary(root).unwrap().get(b"AcroForm").is_err());
        // The field value "Raju" was only in the field dict — it
        // is gone (the widget had no text appearance).
        assert!(
            !contains_bytes(&out, b"Raju"),
            "field value leaked into output"
        );
    }
}
