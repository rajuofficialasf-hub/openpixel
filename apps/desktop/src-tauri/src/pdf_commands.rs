//! Tauri commands for PDF / OCR / document work (Studio Phase 7).
//!
//! Same pattern as [`crate::commands`]: the `do_*` functions are
//! the testable core (bytes in / bytes or outcomes out, no Tauri
//! state), and the `#[tauri::command]` wrappers only add file I/O,
//! state lookup and logging.
//!
//! Honesty rules, carried over from the CLI:
//! * `openpixel-pdf` is built WITH the `pdfium` feature (Phase 8)
//!   and the desktop bundle ships libpdfium as a Tauri resource,
//!   so `pdf_extract_text` and `pdf_to_images` (and PDF-input
//!   `pdf_ocr_searchable`) work out of the box. On a machine where
//!   the bundled library is missing they still return the engine's
//!   clear "needs libpdfium" error — never an empty result.
//! * Tesseract and LibreOffice are runtime probes, never
//!   compile-time claims: see `get_desktop_capabilities`.

use openpixel_core::{ConvertOptions, DecodedImage, Engine, ImageFormat};
use openpixel_documents::{ConversionOutcome, DocumentEngine, DocumentOptions, LibreOffice};
use openpixel_formats::{DocumentConversion, DOCUMENT_CONVERSIONS};
#[cfg(feature = "native-ocr")]
use openpixel_ocr::OcrEngine;
use openpixel_ocr::{OcrOptions, OcrResult, PreprocessMode};
#[cfg(feature = "native-ocr")]
use openpixel_ocr::{SearchablePage, TesseractEngine};
use openpixel_pdf::{
    CompressMode, CompressOptions, CompressOutcome, EditOutcome, FlattenOutcome, MetadataEdit,
    OverlayFont, OverlayOp, PageNumberPosition, PageText, PdfEngine, PdfInfo, PdfThreats,
    RectRedaction, RedactOutcome, Redaction, RepairOutcome, Rgb, SanitizeOutcome,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::str::FromStr;

use crate::commands::AppState;

/// Runtime capability probe: what this machine can actually do
/// right now (see `get_desktop_capabilities`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopCapabilities {
    /// The `pdfium` feature is compiled in AND a libpdfium binary
    /// was found. False in this build (feature off) — rendering
    /// and PDFium text extraction report honestly when called.
    pub pdfium_present: bool,
    pub tesseract_present: bool,
    pub tesseract_version: Option<String>,
    pub tesseract_languages: Vec<String>,
    pub libreoffice_present: bool,
    pub libreoffice_version: Option<String>,
}

/// What a one-file PDF operation returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfFileResult {
    pub output: String,
    pub page_count: u32,
    pub input_bytes: u64,
    pub output_bytes: u64,
}

/// What `pdf_split` returns: one output path per range.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfSplitResult {
    pub outputs: Vec<String>,
    pub page_counts: Vec<u32>,
}

/// What `pdf_compress` returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfCompressResult {
    pub output: String,
    pub outcome: CompressOutcome,
}

/// What `pdf_edit` returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfEditResult {
    pub output: String,
    pub outcome: EditOutcome,
}

/// What `pdf_redact` returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfRedactResult {
    pub output: String,
    pub outcome: RedactOutcome,
}

/// What `pdf_flatten` returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfFlattenResult {
    pub output: String,
    pub outcome: FlattenOutcome,
}

/// What `pdf_sanitize` returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfSanitizeResult {
    pub output: String,
    pub outcome: SanitizeOutcome,
}

/// What `pdf_repair` returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfRepairResult {
    pub output: String,
    pub outcome: RepairOutcome,
}

/// What `pdf_extract_text` returns. `output` is set when the
/// caller asked for a file (txt/html/epub/docx).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfTextResult {
    pub pages: Vec<PageText>,
    pub text: String,
    pub output: Option<String>,
}

/// What `pdf_to_images` returns: one image path per rendered page.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfImagesResult {
    pub outputs: Vec<String>,
}

/// What `pdf_ocr_searchable` returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrSearchableResult {
    pub output: String,
    pub page_count: usize,
    pub results: Vec<OcrResult>,
}

/// One page operation, as sent by the frontend (JSON). `op` is
/// one of: rotate, extract, remove, reorder, duplicate, reverse,
/// booklet, nup.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfPageOpRequest {
    pub op: String,
    pub pages: Option<Vec<u32>>,
    pub degrees: Option<u16>,
    pub order: Option<Vec<u32>>,
    pub cols: Option<u32>,
    pub rows: Option<u32>,
}

/// Overlay edits, as sent by the frontend (JSON). At least one of
/// `text`, `page_numbers`, `header` / `footer` must be set.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PdfEditRequest {
    pub text: Option<String>,
    pub text_page: Option<u32>,
    pub text_x: Option<f64>,
    pub text_y: Option<f64>,
    pub text_size: Option<f64>,
    /// Add "Page N of M" to every page.
    pub page_numbers: bool,
    /// bottom-center | bottom-right | top-center | top-right.
    pub page_number_position: Option<String>,
    pub header: Option<String>,
    pub footer: Option<String>,
}

/// Redactions, as sent by the frontend (JSON). At least one of
/// `texts` / `rects` must be non-empty.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PdfRedactRequest {
    pub texts: Vec<String>,
    pub rects: Vec<RectRedaction>,
}

/// OCR options, as sent by the frontend (JSON).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrRequest {
    /// e.g. ["eng"] or ["eng", "ben"].
    pub languages: Vec<String>,
    /// Tesseract page segmentation mode 0..=13 (default 3).
    pub psm: Option<u8>,
    /// none | light | full (default light).
    pub preprocess: Option<String>,
}

/// Read a whole file, refusing oversized inputs BEFORE allocating
/// (audit finding B7b — the CLI's `check_input_size` equivalent).
/// The 100 MiB engine limit applies to every PDF/image/key file
/// read here; a larger file fails with a clear limit error instead
/// of an unbounded allocation.
fn read_bytes(path: &Path) -> Result<Vec<u8>, String> {
    if let Ok(meta) = std::fs::metadata(path) {
        openpixel_core::security::check_file_size(meta.len(), &Default::default())
            .map_err(|e| e.to_string())?;
    }
    std::fs::read(path).map_err(|e| format!("cannot read '{}': {e}", path.display()))
}

fn write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("cannot create '{}': {e}", parent.display()))?;
        }
    }
    std::fs::write(path, bytes).map_err(|e| format!("cannot write '{}': {e}", path.display()))
}

fn pdf_engine() -> PdfEngine {
    PdfEngine::default()
}

fn parse_page_number_position(name: Option<&str>) -> Result<PageNumberPosition, String> {
    match name.unwrap_or("bottom-center") {
        "bottom-center" => Ok(PageNumberPosition::BottomCenter),
        "bottom-right" => Ok(PageNumberPosition::BottomRight),
        "top-center" => Ok(PageNumberPosition::TopCenter),
        "top-right" => Ok(PageNumberPosition::TopRight),
        other => Err(format!(
            "unknown page-number position '{other}' — use bottom-center, bottom-right, top-center or top-right"
        )),
    }
}

fn parse_ocr_options(req: &OcrRequest) -> Result<OcrOptions, String> {
    let preprocess = PreprocessMode::from_str(req.preprocess.as_deref().unwrap_or("light"))?;
    let options = OcrOptions {
        languages: req.languages.clone(),
        psm: req.psm.unwrap_or(3),
        dpi: None,
        preprocess,
    };
    options.validate().map_err(|e| e.to_string())?;
    Ok(options)
}

// ---- Testable core ----

pub fn do_desktop_capabilities() -> DesktopCapabilities {
    // Tesseract is a compile-time feature (`native-ocr`, on by
    // default) AND a runtime install: with the feature off — the
    // Android path — the probe reports absent instead of claiming
    // anything, and the OCR commands below return the same honest
    // error instead of failing to compile.
    #[cfg(feature = "native-ocr")]
    let (tesseract_present, tesseract_version, tesseract_languages) = match TesseractEngine::new() {
        Ok(engine) => (true, Some(engine.version()), engine.available_languages()),
        Err(_) => (false, None, Vec::new()),
    };
    #[cfg(not(feature = "native-ocr"))]
    let (tesseract_present, tesseract_version, tesseract_languages): (
        bool,
        Option<String>,
        Vec<String>,
    ) = (false, None, Vec::new());
    let (libreoffice_present, libreoffice_version) = match LibreOffice::discover() {
        Some(lo) => (true, lo.version().ok()),
        None => (false, None),
    };
    DesktopCapabilities {
        pdfium_present: openpixel_pdf::pdfium_available(),
        tesseract_present,
        tesseract_version,
        tesseract_languages,
        libreoffice_present,
        libreoffice_version,
    }
}

pub fn do_pdf_info(path: &Path) -> Result<PdfInfo, String> {
    let bytes = read_bytes(path)?;
    pdf_engine().inspect(&bytes).map_err(|e| e.to_string())
}

pub fn do_pdf_inspect(path: &Path) -> Result<PdfThreats, String> {
    let bytes = read_bytes(path)?;
    pdf_engine()
        .inspect_threats(&bytes)
        .map_err(|e| e.to_string())
}

pub fn do_pdf_merge(paths: &[PathBuf]) -> Result<(Vec<u8>, u32), String> {
    if paths.is_empty() {
        return Err("merge needs at least one input PDF".to_string());
    }
    let mut docs = Vec::with_capacity(paths.len());
    for path in paths {
        docs.push(read_bytes(path)?);
    }
    let engine = pdf_engine();
    let out = engine.merge(&docs).map_err(|e| e.to_string())?;
    let count = engine.page_count(&out).map_err(|e| e.to_string())?;
    Ok((out, count))
}

pub fn do_pdf_split(path: &Path, ranges: &[(u32, u32)]) -> Result<Vec<(Vec<u8>, u32)>, String> {
    let bytes = read_bytes(path)?;
    let engine = pdf_engine();
    let parts = engine.split(&bytes, ranges).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(parts.len());
    for part in &parts {
        out.push((
            part.clone(),
            engine.page_count(part).map_err(|e| e.to_string())?,
        ));
    }
    Ok(out)
}

pub fn do_pdf_page_op(path: &Path, req: &PdfPageOpRequest) -> Result<(Vec<u8>, u32), String> {
    let bytes = read_bytes(path)?;
    let engine = pdf_engine();
    let op = req.op.trim().to_ascii_lowercase();
    let out = match op.as_str() {
        "rotate" => {
            let degrees = req
                .degrees
                .ok_or_else(|| "rotate needs degrees (90, 180 or 270)".to_string())?;
            engine
                .rotate(&bytes, req.pages.as_deref(), degrees)
                .map_err(|e| e.to_string())?
        }
        "extract" => {
            let pages = req
                .pages
                .as_ref()
                .filter(|p| !p.is_empty())
                .ok_or_else(|| "extract needs a non-empty pages list".to_string())?;
            engine.extract(&bytes, pages).map_err(|e| e.to_string())?
        }
        "remove" => {
            let pages = req
                .pages
                .as_ref()
                .filter(|p| !p.is_empty())
                .ok_or_else(|| "remove needs a non-empty pages list".to_string())?;
            engine.remove(&bytes, pages).map_err(|e| e.to_string())?
        }
        "reorder" => {
            let order = req
                .order
                .as_ref()
                .filter(|o| !o.is_empty())
                .ok_or_else(|| "reorder needs a non-empty order list".to_string())?;
            engine.reorder(&bytes, order).map_err(|e| e.to_string())?
        }
        "duplicate" => {
            let pages = req
                .pages
                .as_ref()
                .filter(|p| !p.is_empty())
                .ok_or_else(|| "duplicate needs a non-empty pages list".to_string())?;
            engine.duplicate(&bytes, pages).map_err(|e| e.to_string())?
        }
        "reverse" => engine.reverse(&bytes).map_err(|e| e.to_string())?,
        "booklet" => engine.booklet(&bytes).map_err(|e| e.to_string())?,
        "nup" => {
            let cols = req.cols.ok_or_else(|| "n-up needs cols".to_string())?;
            let rows = req.rows.ok_or_else(|| "n-up needs rows".to_string())?;
            engine.nup(&bytes, cols, rows).map_err(|e| e.to_string())?
        }
        other => {
            return Err(format!(
                "unknown page operation '{other}' — use rotate, extract, remove, reorder, duplicate, reverse, booklet or nup"
            ));
        }
    };
    let count = engine.page_count(&out).map_err(|e| e.to_string())?;
    Ok((out, count))
}

pub fn do_pdf_compress(
    path: &Path,
    mode: &str,
    strip_metadata: bool,
) -> Result<(Vec<u8>, CompressOutcome), String> {
    let bytes = read_bytes(path)?;
    let mode = CompressMode::from_name(mode)
        .ok_or_else(|| format!("unknown compress mode '{mode}' — use screen, ebook or printer"))?;
    pdf_engine()
        .compress(
            &bytes,
            mode,
            CompressOptions {
                strip_metadata,
                images: true,
            },
        )
        .map_err(|e| e.to_string())
}

pub fn do_pdf_edit(path: &Path, req: &PdfEditRequest) -> Result<(Vec<u8>, EditOutcome), String> {
    let bytes = read_bytes(path)?;
    let mut ops: Vec<OverlayOp> = Vec::new();
    if let Some(text) = &req.text {
        if text.trim().is_empty() {
            return Err("overlay text must not be empty".to_string());
        }
        ops.push(OverlayOp::Text {
            page: req.text_page.unwrap_or(1),
            x: req.text_x.unwrap_or(72.0),
            y: req.text_y.unwrap_or(720.0),
            text: text.clone(),
            size: req.text_size.unwrap_or(14.0),
            color: Rgb::grey(0.0),
            font: OverlayFont::HelveticaBold,
        });
    }
    if req.page_numbers {
        ops.push(OverlayOp::PageNumbers {
            pages: None,
            format: "Page {n} of {total}".to_string(),
            position: parse_page_number_position(req.page_number_position.as_deref())?,
            size: 10.0,
        });
    }
    if req.header.is_some() || req.footer.is_some() {
        ops.push(OverlayOp::HeaderFooter {
            pages: None,
            header: req.header.clone(),
            footer: req.footer.clone(),
            size: 10.0,
        });
    }
    if ops.is_empty() {
        return Err(
            "edit needs at least one overlay: text, page numbers, or a header/footer".to_string(),
        );
    }
    pdf_engine()
        .edit(&bytes, &ops, &[])
        .map_err(|e| e.to_string())
}

pub fn do_pdf_redact(
    path: &Path,
    req: &PdfRedactRequest,
) -> Result<(Vec<u8>, RedactOutcome), String> {
    let bytes = read_bytes(path)?;
    let mut redactions: Vec<Redaction> = Vec::new();
    for text in &req.texts {
        if text.is_empty() {
            return Err("redaction text must not be empty".to_string());
        }
        redactions.push(Redaction::Text(openpixel_pdf::TextRedaction {
            page: None,
            text: text.clone(),
        }));
    }
    for rect in &req.rects {
        redactions.push(Redaction::Rect(rect.clone()));
    }
    if redactions.is_empty() {
        return Err("redact needs at least one text or rectangle redaction".to_string());
    }
    pdf_engine()
        .redact(&bytes, &redactions)
        .map_err(|e| e.to_string())
}

pub fn do_pdf_flatten(path: &Path) -> Result<(Vec<u8>, FlattenOutcome), String> {
    let bytes = read_bytes(path)?;
    pdf_engine().flatten(&bytes).map_err(|e| e.to_string())
}

pub fn do_pdf_set_metadata(path: &Path, edit: &MetadataEdit) -> Result<Vec<u8>, String> {
    let bytes = read_bytes(path)?;
    pdf_engine()
        .set_metadata(&bytes, edit.clone())
        .map_err(|e| e.to_string())
}

pub fn do_pdf_sanitize(path: &Path) -> Result<(Vec<u8>, SanitizeOutcome), String> {
    let bytes = read_bytes(path)?;
    pdf_engine().sanitize(&bytes).map_err(|e| e.to_string())
}

pub fn do_pdf_repair(path: &Path) -> Result<(Vec<u8>, RepairOutcome), String> {
    let bytes = read_bytes(path)?;
    pdf_engine().repair(&bytes).map_err(|e| e.to_string())
}

pub fn do_pdf_extract_text(path: &Path, pages: Option<&[u32]>) -> Result<Vec<PageText>, String> {
    let bytes = read_bytes(path)?;
    pdf_engine()
        .extract_text(&bytes, pages)
        .map_err(|e| e.to_string())
}

pub fn do_pdf_from_images(paths: &[PathBuf], page_size: Option<&str>) -> Result<Vec<u8>, String> {
    if paths.is_empty() {
        return Err("images-to-pdf needs at least one image".to_string());
    }
    let size = match page_size {
        Some(name) => Some(
            openpixel_pdf::named_page_size(name)
                .ok_or_else(|| format!("unknown page size '{name}' — use a4, a5 or letter"))?,
        ),
        None => None,
    };
    let mut images = Vec::with_capacity(paths.len());
    for path in paths {
        images.push(read_bytes(path)?);
    }
    pdf_engine()
        .from_images(&images, size)
        .map_err(|e| e.to_string())
}

pub fn do_pdf_to_images(
    engine: &Engine,
    path: &Path,
    pages: Option<&[u32]>,
    scale: f32,
    format: &str,
) -> Result<Vec<(u32, Vec<u8>)>, String> {
    let bytes = read_bytes(path)?;
    let target = match format.to_ascii_lowercase().as_str() {
        "png" => ImageFormat::Png,
        "jpeg" | "jpg" => ImageFormat::Jpeg,
        other => {
            return Err(format!(
                "pdf-to-image format must be png or jpeg, not '{other}'"
            ));
        }
    };
    let rendered = pdf_engine()
        .render_to_images(&bytes, pages, scale)
        .map_err(|e| e.to_string())?;
    let options = ConvertOptions::default();
    let mut out = Vec::with_capacity(rendered.len());
    for page in &rendered {
        let (_, encoded) = engine
            .encode_decoded(&page.image, target, &options)
            .map_err(|e| e.to_string())?;
        out.push((page.page, encoded));
    }
    Ok(out)
}

pub fn do_ocr_recognize(
    engine: &Engine,
    path: &Path,
    req: &OcrRequest,
) -> Result<OcrResult, String> {
    let options = parse_ocr_options(req)?;
    let bytes = read_bytes(path)?;
    let (_, image) = engine
        .decode_bytes(&bytes, None)
        .map_err(|e| e.to_string())?;
    recognize_with_tesseract(&image, &options)
}

/// The one place that touches `TesseractEngine`: with
/// `native-ocr` off (the Android path) this is an honest error,
/// not a compile failure — see the module docs.
#[cfg(feature = "native-ocr")]
fn recognize_with_tesseract(
    image: &DecodedImage,
    options: &OcrOptions,
) -> Result<OcrResult, String> {
    let ocr = TesseractEngine::new().map_err(|e| e.to_string())?;
    ocr.recognize(image, options).map_err(|e| e.to_string())
}

#[cfg(not(feature = "native-ocr"))]
fn recognize_with_tesseract(
    _image: &DecodedImage,
    _options: &OcrOptions,
) -> Result<OcrResult, String> {
    Err(ocr_unavailable_message())
}

#[cfg(not(feature = "native-ocr"))]
fn ocr_unavailable_message() -> String {
    "OCR is not available in this build: Tesseract support (feature `native-ocr`) is off — rebuild with default features on a machine with libtesseract installed (see docs/OCR.md)".to_string()
}

pub fn do_pdf_ocr_searchable(
    paths: &[PathBuf],
    req: &OcrRequest,
    title: &str,
) -> Result<(Vec<u8>, Vec<OcrResult>), String> {
    let options = parse_ocr_options(req)?;
    if paths.is_empty() {
        return Err("searchable PDF needs at least one image".to_string());
    }
    let mut raw: Vec<Vec<u8>> = Vec::with_capacity(paths.len());
    for path in paths {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext == "pdf" {
            return Err(
                "a PDF input needs PDFium rendering first, which this tool does not do — pick image pages instead (see docs/DESKTOP.md)"
                    .to_string(),
            );
        }
        raw.push(read_bytes(path)?);
    }
    let names: Vec<String> = (1..=raw.len()).map(|i| format!("page {i}")).collect();
    searchable_pdf_bytes(&raw, &names, &options, title)
}

/// The one place that touches `TesseractEngine::searchable_pdf`:
/// with `native-ocr` off this is an honest error, not a compile
/// failure — see `recognize_with_tesseract`.
#[cfg(feature = "native-ocr")]
fn searchable_pdf_bytes(
    raw: &[Vec<u8>],
    names: &[String],
    options: &OcrOptions,
    title: &str,
) -> Result<(Vec<u8>, Vec<OcrResult>), String> {
    let pages: Vec<SearchablePage<'_>> = raw
        .iter()
        .zip(names.iter())
        .map(|(bytes, name)| SearchablePage {
            image_bytes: bytes,
            filename: name,
        })
        .collect();
    let ocr = TesseractEngine::new().map_err(|e| e.to_string())?;
    ocr.searchable_pdf(&pages, title, options)
        .map_err(|e| e.to_string())
}

#[cfg(not(feature = "native-ocr"))]
fn searchable_pdf_bytes(
    _raw: &[Vec<u8>],
    _names: &[String],
    _options: &OcrOptions,
    _title: &str,
) -> Result<(Vec<u8>, Vec<OcrResult>), String> {
    Err(ocr_unavailable_message())
}

pub fn do_doc_convert(
    path: &Path,
    target: &str,
    source_hint: Option<&str>,
) -> Result<(ConversionOutcome, Vec<u8>), String> {
    let bytes = read_bytes(path)?;
    let hint = source_hint.map(str::to_string).or_else(|| {
        path.extension()
            .and_then(|e| e.to_str())
            .map(str::to_string)
    });
    DocumentEngine::new()
        .convert(
            &bytes,
            target,
            &DocumentOptions {
                source_hint: hint,
                timeout_secs: openpixel_documents::DEFAULT_TIMEOUT_SECS,
            },
        )
        .map_err(|e| e.to_string())
}

pub fn do_doc_formats() -> Vec<DocumentConversion> {
    DOCUMENT_CONVERSIONS.to_vec()
}

// ---- Tauri command wrappers (file I/O + logging only) ----

fn pdf_file_result(output: &Path, input_bytes: u64, bytes: &[u8]) -> Result<PdfFileResult, String> {
    Ok(PdfFileResult {
        output: output.to_string_lossy().into_owned(),
        page_count: pdf_engine().page_count(bytes).map_err(|e| e.to_string())?,
        input_bytes,
        output_bytes: bytes.len() as u64,
    })
}

#[tauri::command]
pub fn get_desktop_capabilities() -> DesktopCapabilities {
    do_desktop_capabilities()
}

#[tauri::command]
pub fn pdf_info(state: tauri::State<'_, AppState>, path: String) -> Result<PdfInfo, String> {
    let result = do_pdf_info(Path::new(&path));
    if let Err(e) = &result {
        state.log("ERROR", &format!("pdf info {path} failed: {e}"));
    }
    result
}

#[tauri::command]
pub fn pdf_inspect(state: tauri::State<'_, AppState>, path: String) -> Result<PdfThreats, String> {
    let result = do_pdf_inspect(Path::new(&path));
    if let Err(e) = &result {
        state.log("ERROR", &format!("pdf inspect {path} failed: {e}"));
    }
    result
}

#[tauri::command]
pub fn pdf_merge(
    state: tauri::State<'_, AppState>,
    inputs: Vec<String>,
    output: String,
) -> Result<PdfFileResult, String> {
    let paths: Vec<PathBuf> = inputs.iter().map(PathBuf::from).collect();
    let input_bytes: u64 = paths
        .iter()
        .map(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0))
        .sum();
    let result = do_pdf_merge(&paths).and_then(|(bytes, _)| {
        write_bytes(Path::new(&output), &bytes)?;
        pdf_file_result(Path::new(&output), input_bytes, &bytes)
    });
    match &result {
        Ok(r) => state.log(
            "INFO",
            &format!(
                "pdf merge {} inputs -> {} ({} pages)",
                inputs.len(),
                output,
                r.page_count
            ),
        ),
        Err(e) => state.log("ERROR", &format!("pdf merge failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn pdf_split(
    state: tauri::State<'_, AppState>,
    input: String,
    ranges: Vec<[u32; 2]>,
    output_dir: String,
) -> Result<PdfSplitResult, String> {
    let stem = Path::new(&input)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "split".to_string());
    let parsed: Vec<(u32, u32)> = ranges.iter().map(|r| (r[0], r[1])).collect();
    let result = do_pdf_split(Path::new(&input), &parsed).and_then(|parts| {
        let mut outputs = Vec::with_capacity(parts.len());
        let mut page_counts = Vec::with_capacity(parts.len());
        for (i, (bytes, count)) in parts.iter().enumerate() {
            let out_path = Path::new(&output_dir).join(format!("{stem}-part{}.pdf", i + 1));
            write_bytes(&out_path, bytes)?;
            outputs.push(out_path.to_string_lossy().into_owned());
            page_counts.push(*count);
        }
        Ok(PdfSplitResult {
            outputs,
            page_counts,
        })
    });
    match &result {
        Ok(r) => state.log(
            "INFO",
            &format!(
                "pdf split {input} -> {} parts in {output_dir}",
                r.outputs.len()
            ),
        ),
        Err(e) => state.log("ERROR", &format!("pdf split {input} failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn pdf_page_op(
    state: tauri::State<'_, AppState>,
    input: String,
    output: String,
    request: PdfPageOpRequest,
) -> Result<PdfFileResult, String> {
    let input_bytes = std::fs::metadata(&input).map(|m| m.len()).unwrap_or(0);
    let op = request.op.clone();
    let result = do_pdf_page_op(Path::new(&input), &request).and_then(|(bytes, _)| {
        write_bytes(Path::new(&output), &bytes)?;
        pdf_file_result(Path::new(&output), input_bytes, &bytes)
    });
    match &result {
        Ok(r) => state.log(
            "INFO",
            &format!("pdf {op} {input} -> {output} ({} pages)", r.page_count),
        ),
        Err(e) => state.log("ERROR", &format!("pdf {op} {input} failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn pdf_compress(
    state: tauri::State<'_, AppState>,
    input: String,
    output: String,
    mode: String,
    strip_metadata: bool,
) -> Result<PdfCompressResult, String> {
    let result =
        do_pdf_compress(Path::new(&input), &mode, strip_metadata).and_then(|(bytes, outcome)| {
            write_bytes(Path::new(&output), &bytes)?;
            Ok(PdfCompressResult { output, outcome })
        });
    match &result {
        Ok(r) => state.log(
            "INFO",
            &format!(
                "pdf compress {input} ({}) -> {} ({} bytes saved)",
                mode, r.output, r.outcome.saved_bytes
            ),
        ),
        Err(e) => state.log("ERROR", &format!("pdf compress {input} failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn pdf_edit(
    state: tauri::State<'_, AppState>,
    input: String,
    output: String,
    request: PdfEditRequest,
) -> Result<PdfEditResult, String> {
    let result = do_pdf_edit(Path::new(&input), &request).and_then(|(bytes, outcome)| {
        write_bytes(Path::new(&output), &bytes)?;
        Ok(PdfEditResult { output, outcome })
    });
    match &result {
        Ok(r) => state.log(
            "INFO",
            &format!(
                "pdf edit {input} -> {} ({} ops applied)",
                r.output, r.outcome.ops_applied
            ),
        ),
        Err(e) => state.log("ERROR", &format!("pdf edit {input} failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn pdf_redact(
    state: tauri::State<'_, AppState>,
    input: String,
    output: String,
    request: PdfRedactRequest,
) -> Result<PdfRedactResult, String> {
    let result = do_pdf_redact(Path::new(&input), &request).and_then(|(bytes, outcome)| {
        write_bytes(Path::new(&output), &bytes)?;
        Ok(PdfRedactResult { output, outcome })
    });
    match &result {
        Ok(r) => state.log(
            "INFO",
            &format!(
                "pdf redact {input} -> {} ({} characters removed)",
                r.output, r.outcome.characters_removed
            ),
        ),
        Err(e) => state.log("ERROR", &format!("pdf redact {input} failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn pdf_flatten(
    state: tauri::State<'_, AppState>,
    input: String,
    output: String,
) -> Result<PdfFlattenResult, String> {
    let result = do_pdf_flatten(Path::new(&input)).and_then(|(bytes, outcome)| {
        write_bytes(Path::new(&output), &bytes)?;
        Ok(PdfFlattenResult { output, outcome })
    });
    match &result {
        Ok(r) => state.log("INFO", &format!("pdf flatten {input} -> {}", r.output)),
        Err(e) => state.log("ERROR", &format!("pdf flatten {input} failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn pdf_set_metadata(
    state: tauri::State<'_, AppState>,
    input: String,
    output: String,
    edit: MetadataEdit,
) -> Result<PdfFileResult, String> {
    let input_bytes = std::fs::metadata(&input).map(|m| m.len()).unwrap_or(0);
    let result = do_pdf_set_metadata(Path::new(&input), &edit).and_then(|bytes| {
        write_bytes(Path::new(&output), &bytes)?;
        pdf_file_result(Path::new(&output), input_bytes, &bytes)
    });
    match &result {
        Ok(r) => state.log("INFO", &format!("pdf set-metadata {input} -> {}", r.output)),
        Err(e) => state.log("ERROR", &format!("pdf set-metadata {input} failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn pdf_sanitize(
    state: tauri::State<'_, AppState>,
    input: String,
    output: String,
) -> Result<PdfSanitizeResult, String> {
    let result = do_pdf_sanitize(Path::new(&input)).and_then(|(bytes, outcome)| {
        write_bytes(Path::new(&output), &bytes)?;
        Ok(PdfSanitizeResult { output, outcome })
    });
    match &result {
        Ok(r) => state.log("INFO", &format!("pdf sanitize {input} -> {}", r.output)),
        Err(e) => state.log("ERROR", &format!("pdf sanitize {input} failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn pdf_repair(
    state: tauri::State<'_, AppState>,
    input: String,
    output: String,
) -> Result<PdfRepairResult, String> {
    let result = do_pdf_repair(Path::new(&input)).and_then(|(bytes, outcome)| {
        write_bytes(Path::new(&output), &bytes)?;
        Ok(PdfRepairResult { output, outcome })
    });
    match &result {
        Ok(r) => state.log(
            "INFO",
            &format!(
                "pdf repair {input} -> {} (recovery: {})",
                r.output, r.outcome.recovery
            ),
        ),
        Err(e) => state.log("ERROR", &format!("pdf repair {input} failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn pdf_extract_text(
    state: tauri::State<'_, AppState>,
    input: String,
    pages: Option<Vec<u32>>,
    format: String,
    output: Option<String>,
) -> Result<PdfTextResult, String> {
    let result = do_pdf_extract_text(Path::new(&input), pages.as_deref()).and_then(|page_texts| {
        let text = PdfEngine::text_to_txt(&page_texts);
        let out_path = match (&output, format.trim().to_ascii_lowercase().as_str()) {
            (Some(path), "txt") => {
                write_bytes(Path::new(path), text.as_bytes())?;
                Some(path.clone())
            }
            (Some(path), "html") => {
                let title = do_pdf_info(Path::new(&input))
                    .ok()
                    .and_then(|i| i.title)
                    .unwrap_or_else(|| "Document".to_string());
                write_bytes(
                    Path::new(path),
                    PdfEngine::text_to_html(&page_texts, &title).as_bytes(),
                )?;
                Some(path.clone())
            }
            (Some(path), "epub") => {
                let title = do_pdf_info(Path::new(&input))
                    .ok()
                    .and_then(|i| i.title)
                    .unwrap_or_else(|| "Document".to_string());
                let bytes =
                    PdfEngine::text_to_epub(&page_texts, &title).map_err(|e| e.to_string())?;
                write_bytes(Path::new(path), &bytes)?;
                Some(path.clone())
            }
            (Some(path), "docx") => {
                let title = do_pdf_info(Path::new(&input))
                    .ok()
                    .and_then(|i| i.title)
                    .unwrap_or_else(|| "Document".to_string());
                let bytes =
                    PdfEngine::text_to_docx(&page_texts, &title).map_err(|e| e.to_string())?;
                write_bytes(Path::new(path), &bytes)?;
                Some(path.clone())
            }
            (Some(_), other) => {
                return Err(format!(
                    "extract-text output format must be txt, html, epub or docx, not '{other}'"
                ));
            }
            (None, _) => None,
        };
        Ok(PdfTextResult {
            pages: page_texts,
            text,
            output: out_path,
        })
    });
    if let Err(e) = &result {
        state.log("ERROR", &format!("pdf extract-text {input} failed: {e}"));
    }
    result
}

#[tauri::command]
pub fn pdf_from_images(
    state: tauri::State<'_, AppState>,
    inputs: Vec<String>,
    output: String,
    page_size: Option<String>,
) -> Result<PdfFileResult, String> {
    let paths: Vec<PathBuf> = inputs.iter().map(PathBuf::from).collect();
    let result = do_pdf_from_images(&paths, page_size.as_deref()).and_then(|bytes| {
        let input_bytes: u64 = paths
            .iter()
            .map(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0))
            .sum();
        write_bytes(Path::new(&output), &bytes)?;
        pdf_file_result(Path::new(&output), input_bytes, &bytes)
    });
    match &result {
        Ok(r) => state.log(
            "INFO",
            &format!(
                "pdf from-images {} inputs -> {} ({} pages)",
                inputs.len(),
                output,
                r.page_count
            ),
        ),
        Err(e) => state.log("ERROR", &format!("pdf from-images failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn pdf_to_images(
    state: tauri::State<'_, AppState>,
    input: String,
    output_dir: String,
    pages: Option<Vec<u32>>,
    scale: f32,
    format: String,
) -> Result<PdfImagesResult, String> {
    let stem = Path::new(&input)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "page".to_string());
    let result = do_pdf_to_images(
        &state.engine,
        Path::new(&input),
        pages.as_deref(),
        scale,
        &format,
    )
    .and_then(|rendered| {
        let mut outputs = Vec::with_capacity(rendered.len());
        for (page, bytes) in &rendered {
            let out_path = Path::new(&output_dir).join(format!(
                "{stem}-p{page}.{format}",
                format = format.trim().to_ascii_lowercase()
            ));
            write_bytes(&out_path, bytes)?;
            outputs.push(out_path.to_string_lossy().into_owned());
        }
        Ok(PdfImagesResult { outputs })
    });
    match &result {
        Ok(r) => state.log(
            "INFO",
            &format!(
                "pdf to-images {input} -> {} images in {output_dir}",
                r.outputs.len()
            ),
        ),
        Err(e) => state.log("ERROR", &format!("pdf to-images {input} failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn ocr_recognize(
    state: tauri::State<'_, AppState>,
    input: String,
    request: OcrRequest,
) -> Result<OcrResult, String> {
    let result = do_ocr_recognize(&state.engine, Path::new(&input), &request);
    match &result {
        Ok(r) => state.log(
            "INFO",
            &format!(
                "ocr {input}: {} words, mean confidence {:.0}% ({} ms)",
                r.words.len(),
                r.mean_confidence,
                r.duration_ms
            ),
        ),
        Err(e) => state.log("ERROR", &format!("ocr {input} failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn pdf_ocr_searchable(
    state: tauri::State<'_, AppState>,
    inputs: Vec<String>,
    output: String,
    request: OcrRequest,
    title: String,
) -> Result<OcrSearchableResult, String> {
    let paths: Vec<PathBuf> = inputs.iter().map(PathBuf::from).collect();
    let result = do_pdf_ocr_searchable(&paths, &request, &title).and_then(|(bytes, results)| {
        write_bytes(Path::new(&output), &bytes)?;
        Ok(OcrSearchableResult {
            output,
            page_count: results.len(),
            results,
        })
    });
    match &result {
        Ok(r) => state.log(
            "INFO",
            &format!(
                "pdf ocr searchable {} inputs -> {} ({} pages)",
                inputs.len(),
                r.output,
                r.page_count
            ),
        ),
        Err(e) => state.log("ERROR", &format!("pdf ocr searchable failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn doc_convert(
    state: tauri::State<'_, AppState>,
    input: String,
    output: String,
    target: String,
    source_hint: Option<String>,
) -> Result<ConversionOutcome, String> {
    let result = do_doc_convert(Path::new(&input), &target, source_hint.as_deref()).and_then(
        |(outcome, bytes)| {
            write_bytes(Path::new(&output), &bytes)?;
            Ok(outcome)
        },
    );
    match &result {
        Ok(r) => state.log(
            "INFO",
            &format!(
                "doc convert {input} -> {output} ({} -> {}, {})",
                r.source.id(),
                r.target,
                r.input_bytes
            ),
        ),
        Err(e) => state.log("ERROR", &format!("doc convert {input} failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn doc_formats() -> Vec<DocumentConversion> {
    do_doc_formats()
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Document, Object, Stream};
    use std::io::Cursor;

    /// Minimal real PDF, same shape as openpixel-pdf's own test
    /// fixture (which is cfg(test) there): `pages` pages, each
    /// showing one text line "(<label> page N)".
    fn fixture_pdf(dir: &Path, name: &str, pages: u32, label: &str) -> PathBuf {
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
        let path = dir.join(name);
        std::fs::write(&path, out).unwrap();
        path
    }

    fn fixture_png(dir: &Path) -> PathBuf {
        let mut img = image::ImageBuffer::new(64, 48);
        for (x, _y, px) in img.enumerate_pixels_mut() {
            *px = image::Rgba([255u8, 0, 0, 255]);
            let _ = x;
        }
        let path = dir.join("fixture.png");
        img.save(&path).expect("write fixture png");
        path
    }

    fn ocr_req() -> OcrRequest {
        OcrRequest {
            languages: vec!["eng".to_string()],
            psm: Some(3),
            preprocess: Some("light".to_string()),
        }
    }

    #[test]
    fn capabilities_report_the_real_machine() {
        let caps = do_desktop_capabilities();
        // This VM has LibreOffice 24.2.7.2 installed. pdfium is a
        // runtime probe, not a compile-time claim: the capability
        // must agree with openpixel_pdf::pdfium_available() — true
        // here (Phase 8 ships the bundled library and the dev
        // target/pdfium cache exists), false on a machine with no
        // library at any resolution step. Tesseract is asserted in
        // the cfg-gated test below (it is absent when `native-ocr`
        // is off).
        assert!(
            caps.libreoffice_present,
            "libreoffice should be present on this VM"
        );
        assert!(
            caps.libreoffice_version
                .as_deref()
                .unwrap_or("")
                .contains("LibreOffice"),
            "libreoffice version: {:?}",
            caps.libreoffice_version
        );
        assert_eq!(
            caps.pdfium_present,
            openpixel_pdf::pdfium_available(),
            "pdfium_present must agree with pdfium_available()"
        );
    }

    #[test]
    #[cfg(feature = "native-ocr")]
    fn capabilities_report_tesseract() {
        let caps = do_desktop_capabilities();
        assert!(
            caps.tesseract_present,
            "tesseract should be present on this VM"
        );
        assert!(
            caps.tesseract_version
                .as_deref()
                .unwrap_or("")
                .contains("5.3"),
            "tesseract version: {:?}",
            caps.tesseract_version
        );
        assert!(caps.tesseract_languages.contains(&"eng".to_string()));
    }

    #[test]
    #[cfg(not(feature = "native-ocr"))]
    fn capabilities_report_no_tesseract_without_the_feature() {
        let caps = do_desktop_capabilities();
        assert!(!caps.tesseract_present);
        assert!(caps.tesseract_version.is_none());
        assert!(caps.tesseract_languages.is_empty());
    }

    #[test]
    fn pdf_info_and_inspect_on_fixture() {
        let dir = tempfile::tempdir().expect("tempdir");
        let pdf = fixture_pdf(dir.path(), "a.pdf", 3, "Alpha");
        let info = do_pdf_info(&pdf).expect("info");
        assert_eq!(info.page_count, 3);
        assert_eq!(info.title.as_deref(), Some("Alpha doc"));
        assert_eq!(info.author.as_deref(), Some("openpixel-test"));
        assert!(!info.encrypted);
        assert_eq!(info.page_sizes.len(), 3);
        let threats = do_pdf_inspect(&pdf).expect("inspect");
        assert!(threats.is_clean());
        assert!(do_pdf_info(&dir.path().join("missing.pdf")).is_err());
    }

    #[test]
    fn pdf_merge_and_split_round_trip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let a = fixture_pdf(dir.path(), "a.pdf", 2, "A");
        let b = fixture_pdf(dir.path(), "b.pdf", 3, "B");
        let (merged, count) = do_pdf_merge(&[a.clone(), b.clone()]).expect("merge");
        assert_eq!(count, 5);
        let merged_path = dir.path().join("merged.pdf");
        std::fs::write(&merged_path, &merged).unwrap();
        assert_eq!(do_pdf_info(&merged_path).unwrap().page_count, 5);
        let parts = do_pdf_split(&merged_path, &[(1, 2), (3, 5)]).expect("split");
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].1, 2);
        assert_eq!(parts[1].1, 3);
        assert!(do_pdf_split(&merged_path, &[(1, 6)]).is_err());
        assert!(do_pdf_merge(&[]).is_err());
    }

    #[test]
    fn pdf_page_ops_cover_every_op() {
        let dir = tempfile::tempdir().expect("tempdir");
        let pdf = fixture_pdf(dir.path(), "a.pdf", 4, "P");
        let op = |name: &str,
                  pages: Option<Vec<u32>>,
                  degrees: Option<u16>,
                  order: Option<Vec<u32>>,
                  cols: Option<u32>,
                  rows: Option<u32>| {
            PdfPageOpRequest {
                op: name.to_string(),
                pages,
                degrees,
                order,
                cols,
                rows,
            }
        };
        let (_, n) =
            do_pdf_page_op(&pdf, &op("rotate", None, Some(90), None, None, None)).expect("rotate");
        assert_eq!(n, 4);
        let (_, n) = do_pdf_page_op(
            &pdf,
            &op("extract", Some(vec![2, 4]), None, None, None, None),
        )
        .expect("extract");
        assert_eq!(n, 2);
        let (_, n) = do_pdf_page_op(&pdf, &op("remove", Some(vec![1]), None, None, None, None))
            .expect("remove");
        assert_eq!(n, 3);
        let (_, n) = do_pdf_page_op(
            &pdf,
            &op("reorder", None, None, Some(vec![4, 3, 2, 1]), None, None),
        )
        .expect("reorder");
        assert_eq!(n, 4);
        let (_, n) = do_pdf_page_op(
            &pdf,
            &op("duplicate", Some(vec![1]), None, None, None, None),
        )
        .expect("duplicate");
        assert_eq!(n, 5);
        let (_, n) =
            do_pdf_page_op(&pdf, &op("reverse", None, None, None, None, None)).expect("reverse");
        assert_eq!(n, 4);
        let (_, n) =
            do_pdf_page_op(&pdf, &op("booklet", None, None, None, None, None)).expect("booklet");
        assert_eq!(n, 4);
        let (_, n) =
            do_pdf_page_op(&pdf, &op("nup", None, None, None, Some(2), Some(2))).expect("nup");
        assert_eq!(n, 1);
        assert!(do_pdf_page_op(&pdf, &op("rotate", None, Some(45), None, None, None)).is_err());
        assert!(do_pdf_page_op(&pdf, &op("bogus", None, None, None, None, None)).is_err());
    }

    #[test]
    fn pdf_compress_edit_redact_flatten_metadata_sanitize_repair() {
        let dir = tempfile::tempdir().expect("tempdir");
        let pdf = fixture_pdf(dir.path(), "a.pdf", 2, "Hello");
        let (bytes, outcome) = do_pdf_compress(&pdf, "ebook", false).expect("compress");
        assert!(!bytes.is_empty());
        assert_eq!(outcome.input_bytes, std::fs::metadata(&pdf).unwrap().len());
        assert!(do_pdf_compress(&pdf, "bogus", false).is_err());

        let (edited, outcome) = do_pdf_edit(
            &pdf,
            &PdfEditRequest {
                text: Some("DRAFT".to_string()),
                text_page: Some(1),
                text_x: Some(72.0),
                text_y: Some(700.0),
                text_size: Some(14.0),
                page_numbers: true,
                page_number_position: Some("bottom-center".to_string()),
                header: None,
                footer: None,
            },
        )
        .expect("edit");
        assert!(outcome.ops_applied >= 2);
        assert!(edited.windows(5).any(|w| w == b"DRAFT"));
        assert!(do_pdf_edit(&pdf, &PdfEditRequest::default()).is_err());

        let (redacted, outcome) = do_pdf_redact(
            &pdf,
            &PdfRedactRequest {
                texts: vec!["Hello page 1".to_string()],
                rects: vec![],
            },
        )
        .expect("redact");
        assert!(!outcome.redacted_texts.is_empty());
        assert!(!redacted
            .windows(b"Hello page 1".len())
            .any(|w| w == b"Hello page 1"));

        let (flat, _) = do_pdf_flatten(&pdf).expect("flatten");
        assert!(!flat.is_empty());
        let edited_meta = do_pdf_set_metadata(
            &pdf,
            &MetadataEdit {
                title: Some("New Title".to_string()),
                ..MetadataEdit::default()
            },
        )
        .expect("set metadata");
        let meta_path = dir.path().join("meta.pdf");
        std::fs::write(&meta_path, &edited_meta).unwrap();
        assert_eq!(
            do_pdf_info(&meta_path).unwrap().title.as_deref(),
            Some("New Title")
        );
        let (_, outcome) = do_pdf_sanitize(&pdf).expect("sanitize");
        assert_eq!(outcome.javascript_removed, 0);
        let (_, outcome) = do_pdf_repair(&pdf).expect("repair");
        assert!(!outcome.recovery.is_empty());
    }

    #[test]
    fn pdf_extract_text_and_to_images_use_pdfium_or_fail_honestly() {
        // Phase 8: the `pdfium` feature is on and the dev
        // target/pdfium cache exists, so both commands succeed on
        // this VM. On a machine with no libpdfium at any resolution
        // step they must still fail with the clear "needs libpdfium"
        // error — never an empty result. The branch is decided by
        // the same probe the UI reads, not by the test's wishes.
        let dir = tempfile::tempdir().expect("tempdir");
        let pdf = fixture_pdf(dir.path(), "a.pdf", 1, "Hello");
        if openpixel_pdf::pdfium_available() {
            let pages = do_pdf_extract_text(&pdf, None).expect("extract text");
            assert_eq!(pages.len(), 1);
            assert!(
                pages[0].text.contains("Hello"),
                "extracted text: {:?}",
                pages[0].text
            );
            let engine = Engine::new(openpixel_core::EngineConfig::default());
            let images =
                do_pdf_to_images(&engine, &pdf, None, 1.0, "png").expect("render to images");
            assert_eq!(images.len(), 1);
            assert!(images[0].1.starts_with(b"\x89PNG"));
        } else {
            let err = do_pdf_extract_text(&pdf, None).unwrap_err();
            assert!(
                err.to_ascii_lowercase().contains("pdfium"),
                "extract-text error: {err}"
            );
            let engine = Engine::new(openpixel_core::EngineConfig::default());
            let err = do_pdf_to_images(&engine, &pdf, None, 1.0, "png").unwrap_err();
            assert!(
                err.to_ascii_lowercase().contains("pdfium"),
                "to-images error: {err}"
            );
        }
    }

    #[test]
    fn pdf_from_images_builds_a_real_pdf() {
        let dir = tempfile::tempdir().expect("tempdir");
        let png = fixture_png(dir.path());
        let bytes = do_pdf_from_images(&[png], Some("a4")).expect("from images");
        assert!(bytes.starts_with(b"%PDF-"));
        let out = dir.path().join("images.pdf");
        std::fs::write(&out, &bytes).unwrap();
        assert_eq!(do_pdf_info(&out).unwrap().page_count, 1);
        assert!(do_pdf_from_images(&[], None).is_err());
        assert!(do_pdf_from_images(&[dir.path().join("nope.png")], None).is_err());
    }

    #[test]
    #[cfg(feature = "native-ocr")]
    fn ocr_recognize_reads_the_fixture_text() {
        let dir = tempfile::tempdir().expect("tempdir");
        let fixture = dir.path().join("eng-clean.png");
        std::fs::write(
            &fixture,
            include_bytes!("../../../../crates/openpixel-ocr/tests/fixtures/eng-clean.png"),
        )
        .unwrap();
        let engine = Engine::new(openpixel_core::EngineConfig::default());
        let result = do_ocr_recognize(&engine, &fixture, &ocr_req()).expect("ocr");
        assert!(
            result.text.contains("OpenPixel"),
            "ocr text did not contain 'OpenPixel': {:?}",
            result.text
        );
        assert!(result.mean_confidence > 50.0);
        assert!(result.words.iter().any(|w| w.text == "OpenPixel"));
    }

    #[test]
    #[cfg(feature = "native-ocr")]
    fn pdf_ocr_searchable_builds_a_real_pdf() {
        let dir = tempfile::tempdir().expect("tempdir");
        let fixture = dir.path().join("eng-clean.png");
        std::fs::write(
            &fixture,
            include_bytes!("../../../../crates/openpixel-ocr/tests/fixtures/eng-clean.png"),
        )
        .unwrap();
        let (bytes, results) =
            do_pdf_ocr_searchable(&[fixture], &ocr_req(), "OCR test").expect("searchable pdf");
        assert!(bytes.starts_with(b"%PDF-"));
        assert_eq!(results.len(), 1);
        assert!(results[0].text.contains("OpenPixel"));
        // A PDF input is refused honestly: no PDFium rendering here.
        let pdf = fixture_pdf(dir.path(), "a.pdf", 1, "Hello");
        assert!(do_pdf_ocr_searchable(&[pdf], &ocr_req(), "x").is_err());
    }

    /// With `native-ocr` off (the Android path) the OCR commands
    /// fail with a clear "not in this build" error — never a
    /// compile failure and never a fake result.
    #[test]
    #[cfg(not(feature = "native-ocr"))]
    fn ocr_commands_fail_honestly_without_the_feature() {
        let dir = tempfile::tempdir().expect("tempdir");
        let fixture = dir.path().join("eng-clean.png");
        std::fs::write(
            &fixture,
            include_bytes!("../../../../crates/openpixel-ocr/tests/fixtures/eng-clean.png"),
        )
        .unwrap();
        let engine = Engine::new(openpixel_core::EngineConfig::default());
        let err = do_ocr_recognize(&engine, &fixture, &ocr_req()).unwrap_err();
        assert!(err.contains("native-ocr"), "ocr error: {err}");
        let err = do_pdf_ocr_searchable(&[fixture], &ocr_req(), "x").unwrap_err();
        assert!(err.contains("native-ocr"), "searchable-pdf error: {err}");
    }

    /// Audit finding B7b: an oversized file is refused by the
    /// metadata pre-check before any bytes are read (sparse file —
    /// no 100 MiB is actually written).
    #[test]
    fn read_bytes_refuses_oversized_files_before_reading() {
        let dir = tempfile::tempdir().expect("tempdir");
        let big = dir.path().join("big.pdf");
        let file = std::fs::File::create(&big).unwrap();
        file.set_len(100 * 1024 * 1024 + 1).unwrap();
        drop(file);
        let err = read_bytes(&big).unwrap_err();
        assert!(err.contains("limit"), "oversized error: {err}");
    }

    #[test]
    fn doc_formats_lists_the_registry_and_txt_converts_to_pdf() {
        let formats = do_doc_formats();
        assert_eq!(formats.len(), 31);
        assert!(formats
            .iter()
            .any(|f| f.source == "docx" && f.target == "pdf"));
        assert!(formats
            .iter()
            .any(|f| f.source == "pdf" && f.target == "txt"));
        let dir = tempfile::tempdir().expect("tempdir");
        let txt = dir.path().join("note.txt");
        std::fs::write(&txt, b"Hello from the desktop doc test.\nSecond line.\n").unwrap();
        let (outcome, bytes) = do_doc_convert(&txt, "pdf", None).expect("txt -> pdf");
        assert_eq!(outcome.target, "pdf");
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(do_doc_convert(&txt, "bogus-format", None).is_err());
    }
}
