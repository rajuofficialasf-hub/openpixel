//! Tesseract OCR engine (Studio Phase 4, `native-ocr` feature).
//!
//! Thin safe wrapper over the `tesseract-sys` C API (Tesseract
//! 5.x). Each `recognize` call creates and destroys its own
//! `TessBaseAPI` handle, so `TesseractEngine` is `Send + Sync` and
//! needs no worker thread (unlike PDFium, whose binding is
//! `!Send`). The searchable-PDF path uses Tesseract's own PDF
//! renderer, which embeds the image plus a text layer with a
//! proper ToUnicode map — so Bengali text is findable with
//! `pdftotext`, not just English.

use crate::engine::{resolve_tessdata_dir, OcrEngine, OcrOptions};
use crate::error::OcrError;
use crate::preprocess::preprocess;
use crate::result::{OcrResult, OcrWord};
use openpixel_codecs::DecodedImage;
use std::ffi::{CStr, CString};
use std::path::{Path, PathBuf};
use std::time::Instant;

/// Tesseract OCR engine. Holds only the tessdata directory; every
/// recognition creates a fresh API handle.
#[derive(Debug, Clone)]
pub struct TesseractEngine {
    tessdata_dir: PathBuf,
}

impl TesseractEngine {
    /// Resolve the tessdata directory (see `resolve_tessdata_dir`)
    /// and build the engine.
    pub fn new() -> Result<Self, OcrError> {
        Ok(Self {
            tessdata_dir: resolve_tessdata_dir(None)?,
        })
    }

    /// Build with an explicit tessdata directory.
    pub fn with_tessdata(dir: &Path) -> Result<Self, OcrError> {
        Ok(Self {
            tessdata_dir: resolve_tessdata_dir(Some(dir))?,
        })
    }

    pub fn tessdata_dir(&self) -> &Path {
        &self.tessdata_dir
    }

    fn check_languages(&self, options: &OcrOptions) -> Result<(), OcrError> {
        for lang in &options.languages {
            let file = self.tessdata_dir.join(format!("{lang}.traineddata"));
            if !file.exists() {
                return Err(OcrError::LanguageDataMissing(
                    lang.clone(),
                    format!(
                        "{lang}.traineddata not found in {}; install it (tesseract-ocr-{lang} or tessdata_fast) — see docs/OCR.md",
                        self.tessdata_dir.display()
                    ),
                ));
            }
        }
        Ok(())
    }

    /// Create + initialise one API handle for `options`. The caller
    /// must call `TessBaseAPIEnd` + `TessBaseAPIDelete` on the
    /// returned handle on every path (the `ApiGuard` below does it).
    unsafe fn init_api(
        &self,
        options: &OcrOptions,
    ) -> Result<*mut tesseract_sys::TessBaseAPI, OcrError> {
        unsafe {
            let api = tesseract_sys::TessBaseAPICreate();
            if api.is_null() {
                return Err(OcrError::Engine(
                    "could not create a Tesseract API handle".to_string(),
                ));
            }
            let guard = ApiGuard(api);
            let datapath = CString::new(self.tessdata_dir.to_string_lossy().as_bytes())
                .map_err(|_| OcrError::Engine("tessdata path is not valid UTF-8".to_string()))?;
            let lang = CString::new(options.language_string())
                .map_err(|_| OcrError::Engine("language string contains a NUL byte".to_string()))?;
            let rc = tesseract_sys::TessBaseAPIInit3(api, datapath.as_ptr(), lang.as_ptr());
            if rc != 0 {
                return Err(OcrError::Engine(format!(
                    "Tesseract failed to initialise for '{}' in {}",
                    options.language_string(),
                    self.tessdata_dir.display()
                )));
            }
            let psm = CString::new("tessedit_pageseg_mode").unwrap();
            let psm_value = CString::new(options.psm.to_string()).unwrap();
            tesseract_sys::TessBaseAPISetVariable(api, psm.as_ptr(), psm_value.as_ptr());
            if let Some(dpi) = options.dpi {
                tesseract_sys::TessBaseAPISetSourceResolution(api, dpi as std::os::raw::c_int);
            }
            Ok(guard.forget())
        }
    }
}

/// Owns a `TessBaseAPI` handle; ends + deletes it on drop, so every
/// error path cleans up.
struct ApiGuard(*mut tesseract_sys::TessBaseAPI);

impl ApiGuard {
    fn forget(self) -> *mut tesseract_sys::TessBaseAPI {
        let api = self.0;
        std::mem::forget(self);
        api
    }
}

impl Drop for ApiGuard {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_null() {
                tesseract_sys::TessBaseAPIEnd(self.0);
                tesseract_sys::TessBaseAPIDelete(self.0);
            }
        }
    }
}

impl OcrEngine for TesseractEngine {
    fn name(&self) -> &'static str {
        "tesseract"
    }

    fn version(&self) -> String {
        unsafe {
            let v = tesseract_sys::TessVersion();
            if v.is_null() {
                return "tesseract (unknown version)".to_string();
            }
            format!("tesseract {}", CStr::from_ptr(v).to_string_lossy().trim())
        }
    }

    fn available_languages(&self) -> Vec<String> {
        let mut langs = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&self.tessdata_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if let Some(lang) = name.strip_suffix(".traineddata") {
                    langs.push(lang.to_string());
                }
            }
        }
        langs.sort();
        langs
    }

    fn recognize(&self, image: &DecodedImage, options: &OcrOptions) -> Result<OcrResult, OcrError> {
        options.validate()?;
        self.check_languages(options)?;
        if image.width == 0 || image.height == 0 {
            return Err(OcrError::UnsupportedImage(
                "image has zero width or height".to_string(),
            ));
        }
        let started = Instant::now();
        let (prepared, steps) = preprocess(image, options.preprocess)?;
        let gray = prepared.to_dynamic().to_luma8();
        let (width, height) = (gray.width(), gray.height());
        let bytes = gray.into_raw();
        if bytes.len() != (width as usize) * (height as usize) {
            return Err(OcrError::UnsupportedImage(
                "greyscale conversion produced an unexpected buffer size".to_string(),
            ));
        }

        unsafe {
            let api = self.init_api(options)?;
            let _guard = ApiGuard(api);
            tesseract_sys::TessBaseAPISetImage(
                api,
                bytes.as_ptr(),
                width as std::os::raw::c_int,
                height as std::os::raw::c_int,
                1,
                width as std::os::raw::c_int,
            );
            let rc = tesseract_sys::TessBaseAPIRecognize(api, std::ptr::null_mut());
            if rc != 0 {
                return Err(OcrError::Engine(format!(
                    "Tesseract recognition failed (code {rc})"
                )));
            }
            let text_ptr = tesseract_sys::TessBaseAPIGetUTF8Text(api);
            let text = if text_ptr.is_null() {
                String::new()
            } else {
                let s = CStr::from_ptr(text_ptr).to_string_lossy().into_owned();
                tesseract_sys::TessDeleteText(text_ptr);
                s
            };
            let words = read_words(api)?;
            let mean_confidence = if words.is_empty() {
                0.0
            } else {
                words.iter().map(|w| w.confidence).sum::<f32>() / words.len() as f32
            };
            Ok(OcrResult {
                text: text.trim_end_matches(['\n', '\r', '\x0c']).to_string(),
                words,
                mean_confidence,
                language: options.language_string(),
                engine: self.version(),
                width,
                height,
                duration_ms: started.elapsed().as_millis() as u64,
                preprocessed: steps,
            })
        }
    }

    fn health_check(&self) -> Result<(), OcrError> {
        if !self.tessdata_dir.join("eng.traineddata").exists()
            && !self.tessdata_dir.join("ben.traineddata").exists()
        {
            return Err(OcrError::Unavailable(format!(
                "tessdata directory {} holds no eng/ben traineddata",
                self.tessdata_dir.display()
            )));
        }
        // A fresh handle that initialises proves the library loads.
        let options = OcrOptions::default();
        unsafe {
            let api = self.init_api(&options)?;
            let _guard = ApiGuard(api);
        }
        Ok(())
    }
}

/// Read the word-level results from the iterator after recognition.
/// The iterator yields words in reading order; empty strings are
/// skipped (they carry no text).
unsafe fn read_words(api: *mut tesseract_sys::TessBaseAPI) -> Result<Vec<OcrWord>, OcrError> {
    unsafe {
        let it = tesseract_sys::TessBaseAPIGetIterator(api);
        if it.is_null() {
            return Ok(Vec::new());
        }
        let page_it = it as *mut tesseract_sys::TessPageIterator;
        // The capi bindings take the iterator level as a plain
        // u32 (RIL_WORD = 3); the rustified enum would need a cast
        // at every call site.
        let level = tesseract_sys::PageIteratorLevel::RIL_WORD as u32;
        let mut words = Vec::new();
        loop {
            let text_ptr = tesseract_sys::TessResultIteratorGetUTF8Text(it, level);
            if !text_ptr.is_null() {
                let text = CStr::from_ptr(text_ptr).to_string_lossy().into_owned();
                tesseract_sys::TessDeleteText(text_ptr);
                if !text.trim().is_empty() {
                    let (mut x1, mut y1, mut x2, mut y2) = (0, 0, 0, 0);
                    let has_box = tesseract_sys::TessPageIteratorBoundingBox(
                        page_it, level, &mut x1, &mut y1, &mut x2, &mut y2,
                    ) != 0;
                    let confidence = tesseract_sys::TessResultIteratorConfidence(it, level);
                    let (x, y, w, h) = if has_box && x2 > x1 && y2 > y1 {
                        (x1 as u32, y1 as u32, (x2 - x1) as u32, (y2 - y1) as u32)
                    } else {
                        (0, 0, 0, 0)
                    };
                    words.push(OcrWord {
                        text,
                        confidence,
                        x,
                        y,
                        width: w,
                        height: h,
                    });
                }
            }
            if tesseract_sys::TessPageIteratorNext(page_it, level) == 0 {
                break;
            }
        }
        Ok(words)
    }
}

/// One page of a searchable PDF: the original image bytes (PNG,
/// JPEG, TIFF, … — anything Leptonica can read) plus a filename
/// used for the page title.
pub struct SearchablePage<'a> {
    pub image_bytes: &'a [u8],
    pub filename: &'a str,
}

impl TesseractEngine {
    /// Build a searchable PDF: each page shows the original image
    /// with an invisible OCR text layer (Tesseract's own PDF
    /// renderer, which embeds the font + ToUnicode map, so Bengali
    /// text is findable with `pdftotext`). Returns the genuine PDF
    /// bytes plus one `OcrResult` per page, read from the same
    /// recognition the text layer was built from — so the reported
    /// confidence describes the text layer itself, not a second
    /// OCR pass. `title` is the document title.
    ///
    /// Note: this path OCRs the image as given (like `tesseract
    /// … pdf`) — the pipeline preprocessing of `recognize` does
    /// not apply, because the renderer embeds the very image it
    /// OCRs. The per-page results carry `preprocessed: []`.
    pub fn searchable_pdf(
        &self,
        pages: &[SearchablePage<'_>],
        title: &str,
        options: &OcrOptions,
    ) -> Result<(Vec<u8>, Vec<OcrResult>), OcrError> {
        options.validate()?;
        self.check_languages(options)?;
        if pages.is_empty() {
            return Err(OcrError::Engine(
                "searchable PDF needs at least one page".to_string(),
            ));
        }
        let tmp = tempfile::tempdir()
            .map_err(|e| OcrError::Engine(format!("could not create a temp dir: {e}")))?;
        let output_base = tmp.path().join("out");
        let output_base_c = CString::new(output_base.to_string_lossy().as_bytes())
            .map_err(|_| OcrError::Engine("temp path is not valid UTF-8".to_string()))?;
        let title_c = CString::new(title)
            .map_err(|_| OcrError::Engine("title contains a NUL byte".to_string()))?;
        let datapath = CString::new(self.tessdata_dir.to_string_lossy().as_bytes())
            .map_err(|_| OcrError::Engine("tessdata path is not valid UTF-8".to_string()))?;

        unsafe {
            let api = self.init_api(options)?;
            let _api_guard = ApiGuard(api);
            let renderer = tesseract_sys::TessPDFRendererCreate(
                output_base_c.as_ptr(),
                datapath.as_ptr(),
                0, // textonly = false: image + text layer
            );
            if renderer.is_null() {
                return Err(OcrError::Engine(
                    "Tesseract could not create the PDF renderer".to_string(),
                ));
            }
            let _renderer_guard = RendererGuard(renderer);
            if tesseract_sys::TessResultRendererBeginDocument(renderer, title_c.as_ptr()) == 0 {
                return Err(OcrError::Engine(
                    "Tesseract could not start the searchable PDF document".to_string(),
                ));
            }
            let mut results = Vec::with_capacity(pages.len());
            for (i, page) in pages.iter().enumerate() {
                let started = Instant::now();
                let pix =
                    leptonica_sys::pixReadMem(page.image_bytes.as_ptr(), page.image_bytes.len());
                if pix.is_null() {
                    return Err(OcrError::UnsupportedImage(format!(
                        "Leptonica could not read page {} ({}): not a supported image",
                        i + 1,
                        page.filename
                    )));
                }
                let mut pix_ptr = pix;
                let filename_c = CString::new(page.filename).map_err(|_| {
                    OcrError::Engine("page filename contains a NUL byte".to_string())
                })?;
                let ok = tesseract_sys::TessBaseAPIProcessPage(
                    api,
                    pix,
                    i as std::os::raw::c_int,
                    filename_c.as_ptr(),
                    std::ptr::null(),
                    0,
                    renderer,
                );
                if ok == 0 {
                    leptonica_sys::pixDestroy(&mut pix_ptr);
                    return Err(OcrError::Engine(format!(
                        "Tesseract failed on searchable-PDF page {} ({})",
                        i + 1,
                        page.filename
                    )));
                }
                // ProcessPage leaves the recognition in the handle:
                // read the same text + words the renderer just
                // embedded, so the report describes the text layer.
                let text_ptr = tesseract_sys::TessBaseAPIGetUTF8Text(api);
                let text = if text_ptr.is_null() {
                    String::new()
                } else {
                    let s = CStr::from_ptr(text_ptr).to_string_lossy().into_owned();
                    tesseract_sys::TessDeleteText(text_ptr);
                    s
                };
                let words = read_words(api)?;
                let mean_confidence = if words.is_empty() {
                    0.0
                } else {
                    words.iter().map(|w| w.confidence).sum::<f32>() / words.len() as f32
                };
                let (width, height) = (
                    leptonica_sys::pixGetWidth(pix) as u32,
                    leptonica_sys::pixGetHeight(pix) as u32,
                );
                leptonica_sys::pixDestroy(&mut pix_ptr);
                results.push(OcrResult {
                    text: text.trim_end_matches(['\n', '\r', '\x0c']).to_string(),
                    words,
                    mean_confidence,
                    language: options.language_string(),
                    engine: self.version(),
                    width,
                    height,
                    duration_ms: started.elapsed().as_millis() as u64,
                    preprocessed: Vec::new(),
                });
            }
            if tesseract_sys::TessResultRendererEndDocument(renderer) == 0 {
                return Err(OcrError::Engine(
                    "Tesseract could not finish the searchable PDF document".to_string(),
                ));
            }
            // `_renderer_guard` drops here (end of scope) and deletes
            // the renderer — the documented cleanup after EndDocument.
            let pdf_path = tmp.path().join("out.pdf");
            let bytes = std::fs::read(&pdf_path).map_err(|e| {
                OcrError::Engine(format!(
                    "searchable PDF was not written to {}: {e}",
                    pdf_path.display()
                ))
            })?;
            Ok((bytes, results))
        }
    }
}

/// Owns a `TessResultRenderer`; deletes it on drop (including every
/// error path — the renderer must be deleted exactly once).
struct RendererGuard(*mut tesseract_sys::TessResultRenderer);

impl Drop for RendererGuard {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_null() {
                tesseract_sys::TessDeleteResultRenderer(self.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_resolves_tessdata_and_lists_languages() {
        let engine = match TesseractEngine::new() {
            Ok(e) => e,
            Err(OcrError::Unavailable(_)) => return, // no tesseract installed: skip
            Err(e) => panic!("unexpected error: {e}"),
        };
        let langs = engine.available_languages();
        assert!(langs.contains(&"eng".to_string()), "langs: {langs:?}");
        assert!(engine.health_check().is_ok());
        assert!(engine.version().starts_with("tesseract "));
    }
}
