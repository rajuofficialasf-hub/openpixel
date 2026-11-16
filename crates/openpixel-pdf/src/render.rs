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

/// The render worker (feature `pdfium` only). One thread owns the
/// one `Pdfium`; everyone else talks to it over a channel.
#[cfg(feature = "pdfium")]
mod worker {
    use super::*;
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::sync::{Arc, OnceLock};

    struct RenderJob {
        pdf: Arc<Vec<u8>>,
        page: u32,
        scale: f32,
        reply: Sender<Result<DecodedImage>>,
    }

    fn tx() -> &'static Sender<RenderJob> {
        static TX: OnceLock<Sender<RenderJob>> = OnceLock::new();
        TX.get_or_init(|| {
            let (tx, rx) = channel::<RenderJob>();
            std::thread::spawn(move || run_worker(rx));
            tx
        })
    }

    fn run_worker(rx: Receiver<RenderJob>) {
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
                    let err = if not_implemented {
                        PdfError::NotImplemented(msg.clone())
                    } else {
                        PdfError::Lopdf(msg.clone())
                    };
                    let _ = job.reply.send(Err(err));
                }
                return;
            }
        };
        while let Ok(job) = rx.recv() {
            let result = render_one(&pdfium, &job.pdf, job.page, job.scale);
            if job.reply.send(result).is_err() {
                // Caller went away; keep serving the rest.
            }
        }
    }

    fn bind_pdfium() -> Result<pdfium_render::prelude::Pdfium> {
        use pdfium_render::prelude::Pdfium;
        use std::path::PathBuf;
        let resolve = || -> Option<PathBuf> {
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
        };
        let bindings = match resolve() {
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
            tx().send(RenderJob {
                pdf: Arc::clone(&pdf),
                page,
                scale,
                reply: reply_tx,
            })
            .map_err(|_| PdfError::Lopdf("PDF render worker is gone".to_string()))?;
            let image = reply_rx
                .recv()
                .map_err(|_| PdfError::Lopdf("PDF render worker is gone".to_string()))??;
            out.push(RenderedPage { page, image });
        }
        Ok(out)
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
