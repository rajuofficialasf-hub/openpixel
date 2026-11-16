//! PDFium rendering (Studio Phase 2).
//!
//! Renders PDF pages to images via the optional `pdfium` feature.
//! The libpdfium binary is loaded at runtime — never compiled in,
//! never committed. Resolution order:
//! 1. `OPENPIXEL_PDFIUM_PATH` (a file),
//! 2. `OPENPIXEL_PDFIUM_DIR` (a directory holding the library),
//! 3. next to the current executable (so a release tarball can
//!    ship `libpdfium.so` beside the `openpixel` binary),
//! 4. the system library,
//! 5. `./target/pdfium` (dev convenience — where
//!    `scripts/pdfium/fetch-pdfium.sh` puts it).
//!
//! When nothing is found, the error says exactly how to fetch it
//! — a missing render is a clear error, never a fake image.
//!
//! Threading (an upstream constraint, handled honestly):
//! pdfium-render promotes the library bindings into a global
//! `OnceCell` — PDFium allows exactly ONE binding per process —
//! and a `Pdfium` handle is `!Send`. So all rendering runs on a
//! single dedicated worker thread that owns the one `Pdfium`
//! handle; callers send jobs over a channel and wait for the
//! result. Any thread may request a render; the worker serialises
//! them. The worker lives for the process lifetime (detached).

use crate::engine::PdfEngine;
use crate::error::{PdfError, Result};
use openpixel_core::DecodedImage;

/// One rendered page (1-based page number + RGBA8 pixels).
#[derive(Debug, Clone)]
pub struct RenderedPage {
    pub page: u32,
    pub image: DecodedImage,
}

fn missing_libpdfium_error() -> PdfError {
    PdfError::NotImplemented(
        "PDF rendering needs libpdfium, which was not found. Set OPENPIXEL_PDFIUM_PATH to the library file, place it next to the openpixel binary, or run scripts/pdfium/fetch-pdfium.sh (see docs/PDF.md)".to_string(),
    )
}

/// Whether PDFium can actually be used right now: the `pdfium`
/// feature is compiled in AND a libpdfium binary is found at
/// runtime (a resolvable library file, or a system library that
/// binds). A compile-time-only check lied on machines with the
/// feature on but no library installed (CI): the documents tests
/// took the "available" branch and unwrapped a conversion that
/// honestly refused — see the Phase 3 CI run (e9cfc29), all three
/// CLI jobs. This probe only locates/binds the library; it never
/// initialises PDFium, so it cannot disturb the render worker's
/// single binding.
#[cfg(feature = "pdfium")]
pub(crate) fn pdfium_library_present() -> bool {
    use pdfium_render::prelude::Pdfium;
    worker::resolve_pdfium_library().is_some() || Pdfium::bind_to_system_library().is_ok()
}

/// Without the feature there is no PDFium code at all.
#[cfg(not(feature = "pdfium"))]
pub(crate) fn pdfium_library_present() -> bool {
    false
}

/// The render worker (feature `pdfium` only). One thread owns the
/// one `Pdfium`; everyone else talks to it over a channel. The
/// channel carries both job kinds — rendering and text extraction
/// (Phase 3) — because PDFium allows exactly one binding per
/// process, so a second worker thread could not bind its own.
#[cfg(feature = "pdfium")]
pub(crate) mod worker {
    use super::*;
    use crate::text::PageText;
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::sync::{Arc, OnceLock};

    struct RenderJob {
        pdf: Arc<Vec<u8>>,
        page: u32,
        scale: f32,
        reply: Sender<Result<DecodedImage>>,
    }

    struct TextJob {
        pdf: Arc<Vec<u8>>,
        page: u32,
        reply: Sender<Result<PageText>>,
    }

    enum Job {
        Render(RenderJob),
        Text(TextJob),
    }

    fn tx() -> &'static Sender<Job> {
        static TX: OnceLock<Sender<Job>> = OnceLock::new();
        TX.get_or_init(|| {
            let (tx, rx) = channel::<Job>();
            std::thread::spawn(move || run_worker(rx));
            tx
        })
    }

    fn run_worker(rx: Receiver<Job>) {
        let pdfium = match bind_pdfium() {
            Ok(p) => p,
            Err(e) => {
                // Binding failed (usually: no libpdfium). The
                // failure is deterministic, so answer every queued
                // job with the same error and exit.
                let (not_implemented, msg) = match &e {
                    PdfError::NotImplemented(m) => (true, m.clone()),
                    other => (false, other.to_string()),
                };
                while let Ok(job) = rx.recv() {
                    match job {
                        Job::Render(j) => {
                            let err = if not_implemented {
                                PdfError::NotImplemented(msg.clone())
                            } else {
                                PdfError::Lopdf(msg.clone())
                            };
                            let _ = j.reply.send(Err(err));
                        }
                        Job::Text(j) => {
                            let err = if not_implemented {
                                PdfError::NotImplemented(msg.clone())
                            } else {
                                PdfError::Lopdf(msg.clone())
                            };
                            let _ = j.reply.send(Err(err));
                        }
                    }
                }
                return;
            }
        };
        while let Ok(job) = rx.recv() {
            match job {
                Job::Render(j) => {
                    let result = render_one(&pdfium, &j.pdf, j.page, j.scale);
                    if j.reply.send(result).is_err() {
                        // Caller went away; keep serving the rest.
                    }
                }
                Job::Text(j) => {
                    let result = extract_one(&pdfium, &j.pdf, j.page);
                    if j.reply.send(result).is_err() {
                        // Caller went away; keep serving the rest.
                    }
                }
            }
        }
    }

    fn bind_pdfium() -> Result<pdfium_render::prelude::Pdfium> {
        use pdfium_render::prelude::Pdfium;
        let bindings = match resolve_pdfium_library() {
            Some(path) => Pdfium::bind_to_library(&path).map_err(|e| {
                PdfError::Lopdf(format!(
                    "could not bind libpdfium at {}: {e}",
                    path.display()
                ))
            })?,
            None => Pdfium::bind_to_system_library().map_err(|_| missing_libpdfium_error())?,
        };
        Ok(Pdfium::new(bindings))
    }

    /// Locate a libpdfium binary using the same resolution order as
    /// `bind_pdfium` (env vars, beside the binary, dev `target/pdfium`
    /// cache). `None` when no file is found — the system library is
    /// NOT checked here; `bind_to_system_library` covers that path.
    pub(crate) fn resolve_pdfium_library() -> Option<std::path::PathBuf> {
        use pdfium_render::prelude::Pdfium;
        use std::path::PathBuf;
        if let Ok(p) = std::env::var("OPENPIXEL_PDFIUM_PATH") {
            let p = PathBuf::from(p);
            if p.is_file() {
                return Some(p);
            }
        }
        if let Ok(d) = std::env::var("OPENPIXEL_PDFIUM_DIR") {
            let p = Pdfium::pdfium_platform_library_name_at_path(&d);
            if p.is_file() {
                return Some(p);
            }
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let p = Pdfium::pdfium_platform_library_name_at_path(dir);
                if p.is_file() {
                    return Some(p);
                }
            }
        }
        let dev = PathBuf::from("target/pdfium");
        let p = Pdfium::pdfium_platform_library_name_at_path(&dev);
        if p.is_file() {
            return Some(p);
        }
        // Compile-time workspace location (dev/test builds):
        // the workspace `target/pdfium` cache, wherever the
        // test binary runs from (cargo test runs with CWD =
        // the package dir).
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/pdfium");
        let p = Pdfium::pdfium_platform_library_name_at_path(&dev);
        if p.is_file() {
            return Some(p);
        }
        None
    }

    fn render_one(
        pdfium: &pdfium_render::prelude::Pdfium,
        pdf_bytes: &[u8],
        page: u32,
        scale: f32,
    ) -> Result<DecodedImage> {
        use pdfium_render::prelude::*;
        let document = pdfium
            .load_pdf_from_byte_slice(pdf_bytes, None)
            .map_err(|e| PdfError::Lopdf(format!("PDFium could not load the PDF: {e}")))?;
        let pdf_page = document
            .pages()
            .get((page - 1) as i32)
            .map_err(|e| PdfError::Lopdf(format!("PDFium could not get page {page}: {e}")))?;
        let target_w = ((pdf_page.width().value * scale).round() as i32).max(1);
        let bitmap = pdf_page
            .render_with_config(&PdfRenderConfig::new().set_target_width(target_w))
            .map_err(|e| PdfError::Lopdf(format!("PDFium could not render page {page}: {e}")))?;
        let image = bitmap.as_image().map_err(|e| {
            PdfError::Lopdf(format!(
                "could not convert rendered page {page} to an image: {e}"
            ))
        })?;
        Ok(DecodedImage::from_dynamic(&image))
    }

    /// Render `targets` (1-based) via the worker thread, in order.
    pub(super) fn render_pages(
        bytes: &[u8],
        targets: &[u32],
        scale: f32,
    ) -> Result<Vec<RenderedPage>> {
        let pdf = Arc::new(bytes.to_vec());
        let mut out = Vec::with_capacity(targets.len());
        for &page in targets {
            let (reply_tx, reply_rx) = channel();
            tx().send(Job::Render(RenderJob {
                pdf: Arc::clone(&pdf),
                page,
                scale,
                reply: reply_tx,
            }))
            .map_err(|_| PdfError::Lopdf("PDF render worker is gone".to_string()))?;
            let image = reply_rx
                .recv()
                .map_err(|_| PdfError::Lopdf("PDF render worker is gone".to_string()))??;
            out.push(RenderedPage { page, image });
        }
        Ok(out)
    }

    /// Extract text from `targets` (1-based) via the worker
    /// thread, in order. Layout comes from the segments' bounds
    /// (see `crate::text`).
    pub(crate) fn extract_pages(bytes: &[u8], targets: &[u32]) -> Result<Vec<PageText>> {
        let pdf = Arc::new(bytes.to_vec());
        let mut out = Vec::with_capacity(targets.len());
        for &page in targets {
            let (reply_tx, reply_rx) = channel();
            tx().send(Job::Text(TextJob {
                pdf: Arc::clone(&pdf),
                page,
                reply: reply_tx,
            }))
            .map_err(|_| PdfError::Lopdf("PDF render worker is gone".to_string()))?;
            let text = reply_rx
                .recv()
                .map_err(|_| PdfError::Lopdf("PDF render worker is gone".to_string()))??;
            out.push(text);
        }
        Ok(out)
    }

    /// One page's text, with layout: PDFium segments grouped into
    /// lines by their vertical centres, lines top-to-bottom,
    /// segments left-to-right, a space inserted where two segments
    /// on one line are more than 2 pt apart.
    fn extract_one(
        pdfium: &pdfium_render::prelude::Pdfium,
        pdf_bytes: &[u8],
        page: u32,
    ) -> Result<PageText> {
        use pdfium_render::prelude::*;
        let document = pdfium
            .load_pdf_from_byte_slice(pdf_bytes, None)
            .map_err(|e| PdfError::Lopdf(format!("PDFium could not load the PDF: {e}")))?;
        let pdf_page = document
            .pages()
            .get((page - 1) as i32)
            .map_err(|e| PdfError::Lopdf(format!("PDFium could not get page {page}: {e}")))?;
        let page_height = pdf_page.height().value;
        let text = pdf_page
            .text()
            .map_err(|e| PdfError::Lopdf(format!("PDFium could not read page {page} text: {e}")))?;
        // Segments in document order; each carries its bounds.
        let mut segs: Vec<(f32, f32, f32, f32, String)> = Vec::new();
        for seg in text.segments().iter() {
            let b = seg.bounds();
            let t = seg.text();
            if t.trim().is_empty() {
                continue;
            }
            // PDF origin is bottom-left; y_top is from the top.
            let y_top = page_height - b.top().value;
            segs.push((b.left().value, y_top, b.width().value, b.height().value, t));
        }
        // Sort by line (top), then by x.
        segs.sort_by(|a, b| {
            a.1.partial_cmp(&b.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
        });
        let mut lines: Vec<crate::text::TextLine> = Vec::new();
        for (x, y_top, w, h, t) in segs {
            let center = y_top + h / 2.0;
            let join = lines
                .last_mut()
                .filter(|line: &&mut crate::text::TextLine| {
                    let line_center = line.y_top + line.height / 2.0;
                    (center - line_center).abs() <= line.height.max(h) * 0.6
                });
            match join {
                Some(line) => {
                    let gap = x - (line.x + line.width);
                    if gap > 2.0
                        && !line.text.ends_with(char::is_whitespace)
                        && !t.starts_with(char::is_whitespace)
                    {
                        line.text.push(' ');
                    }
                    line.text.push_str(&t);
                    let right = (line.x + line.width).max(x + w);
                    line.width = right - line.x;
                    line.height = line.height.max(h);
                    line.y_top = line.y_top.min(y_top);
                }
                None => lines.push(crate::text::TextLine {
                    text: t,
                    x,
                    y_top,
                    width: w,
                    height: h,
                }),
            }
        }
        let text_all = lines
            .iter()
            .map(|l| l.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        Ok(PageText {
            page,
            text: text_all,
            lines,
        })
    }
}

impl PdfEngine {
    /// Render pages to images (1-based page numbers; `None`
    /// renders every page). `scale` is the render scale (1.0 =
    /// 72 DPI, 2.0 = 144 DPI); it must be within 0.25..=6.0 and
    /// the resulting width must fit the image engine's dimension
    /// limit. Requires the `pdfium` feature — without it this
    /// returns a clear NotImplemented error, never a fake image.
    pub fn render_to_images(
        &self,
        bytes: &[u8],
        pages: Option<&[u32]>,
        scale: f32,
    ) -> Result<Vec<RenderedPage>> {
        if !(0.25..=6.0).contains(&scale) || !scale.is_finite() {
            return Err(PdfError::InvalidPdf(format!(
                "render scale must be 0.25..=6.0, not {scale}"
            )));
        }
        self.validate(bytes)?;
        let count = self.page_count(bytes)?;
        let targets: Vec<u32> = match pages {
            Some(list) => {
                crate::engine::check_pages(list, count)?;
                list.to_vec()
            }
            None => (1..=count).collect(),
        };
        let rendered = self.render_to_images_inner(bytes, &targets, scale)?;
        for r in &rendered {
            if r.image.width > openpixel_core::security::MAX_DIMENSION
                || r.image.height > openpixel_core::security::MAX_DIMENSION
            {
                return Err(PdfError::InvalidPdf(format!(
                    "rendered page {} would be {}x{} px, over the {} px limit — use a smaller scale",
                    r.page,
                    r.image.width,
                    r.image.height,
                    openpixel_core::security::MAX_DIMENSION
                )));
            }
        }
        Ok(rendered)
    }

    #[cfg(feature = "pdfium")]
    fn render_to_images_inner(
        &self,
        bytes: &[u8],
        targets: &[u32],
        scale: f32,
    ) -> Result<Vec<RenderedPage>> {
        worker::render_pages(bytes, targets, scale)
    }

    #[cfg(not(feature = "pdfium"))]
    fn render_to_images_inner(
        &self,
        _bytes: &[u8],
        _targets: &[u32],
        _scale: f32,
    ) -> Result<Vec<RenderedPage>> {
        Err(missing_libpdfium_error())
    }
}

#[cfg(all(test, feature = "pdfium"))]
mod tests {
    use super::*;
    use crate::engine::tests::make_pdf;
    use crate::pdfium_available;

    #[test]
    fn pdfium_available_agrees_with_render() {
        // Regression: the old implementation returned only
        // `cfg!(feature = "pdfium")` — true on CI, where the
        // feature is on but no libpdfium binary exists, so the
        // documents test took the "available" branch and unwrapped
        // a conversion that honestly refused (Phase 3 run e9cfc29,
        // all three CLI jobs). Availability must agree with an
        // actual render attempt in both directions.
        let engine = PdfEngine::default();
        let doc = make_pdf(1, "Agree");
        let available = pdfium_available();
        let rendered = engine.render_to_images(&doc, None, 1.0);
        assert_eq!(
            rendered.is_ok(),
            available,
            "pdfium_available()={available} but render returned {rendered:?}"
        );
    }

    #[test]
    fn renders_real_pages_with_visible_text() {
        let engine = PdfEngine::default();
        let doc = make_pdf(3, "Render");
        let pages = engine.render_to_images(&doc, None, 2.0).unwrap();
        assert_eq!(pages.len(), 3);
        for (i, rendered) in pages.iter().enumerate() {
            assert_eq!(rendered.page, i as u32 + 1);
            // 612 pt * 2 = 1224 px wide, 792 pt * 2 = 1584 px tall.
            assert_eq!(rendered.image.width, 1224);
            assert_eq!(rendered.image.height, 1584);
            // The page is black text on white: an all-white render
            // is a silent failure, not a render.
            let dark = rendered
                .image
                .to_dynamic()
                .to_luma8()
                .pixels()
                .filter(|p| p.0[0] < 128)
                .count();
            assert!(dark > 0, "page {} rendered all-white", i + 1);
        }
        // A single page, smaller scale — same worker, same binding.
        let one = engine.render_to_images(&doc, Some(&[2]), 1.0).unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].image.width, 612);
        assert!(engine.render_to_images(&doc, Some(&[4]), 2.0).is_err());
        assert!(engine.render_to_images(&doc, None, 0.1).is_err());
        assert!(engine.render_to_images(&doc, None, 7.0).is_err());
    }
}

/// Without the `pdfium` feature, render fails with fetch
/// instructions — never a fake image, never a link error.
#[cfg(all(test, not(feature = "pdfium")))]
mod no_feature_tests {
    use super::*;
    use crate::engine::tests::make_pdf;
    use crate::pdfium_available;

    #[test]
    fn pdfium_available_is_false_without_feature() {
        assert!(!pdfium_available());
    }

    #[test]
    fn render_without_pdfium_feature_is_an_honest_error() {
        let engine = PdfEngine::default();
        let doc = make_pdf(2, "NoFeature");
        let err = engine.render_to_images(&doc, None, 1.0).unwrap_err();
        assert!(
            matches!(err, PdfError::NotImplemented(_)),
            "expected NotImplemented, got {err}"
        );
        assert!(
            err.to_string().contains("fetch-pdfium.sh"),
            "error must say how to fetch libpdfium: {err}"
        );
    }
}
