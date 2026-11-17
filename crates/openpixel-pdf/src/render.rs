//! PDFium rendering (Studio Phase 2).
//!
//! Renders PDF pages to images via the optional `pdfium` feature.
//! The libpdfium binary is loaded at runtime — never compiled in,
//! never committed. Resolution order:
//! 1. `OPENPIXEL_PDFIUM_PATH` (a file),
//! 2. `OPENPIXEL_PDFIUM_DIR` (a directory holding the library),
//! 3. next to the current executable (so a release tarball can
//!    ship `libpdfium.so` beside the `openpixel` binary),
//! 4. the Tauri resource directory (Phase 8: the desktop bundle
//!    ships the library as a Tauri resource — on Linux that is
//!    `/usr/lib/<exe_name>/`, NOT beside the binary; see
//!    `tauri_resource_candidates`),
//! 5. the system library,
//! 6. `./target/pdfium` (dev convenience — where
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

    /// Tauri resource-directory candidates for `exe` (Phase 8).
    /// Tauri 2 `bundle.resources` lands a bundled file in the app's
    /// resource dir, which is NOT beside the binary on Linux/macOS
    /// (Tauri 2.12 `resource_dir`, `tauri/src/path/desktop.rs`):
    /// - Linux .deb: `/usr/lib/<exe_name>/` (binary in `/usr/bin/`);
    /// - Linux AppImage: `$APPDIR/usr/lib/<exe_name>/`;
    /// - running unbundled from `src-tauri/target/(debug|release)/`:
    ///   `<exe_dir>/../lib/<exe_name>/`;
    /// - macOS .app: `<exe_dir>/../Resources`
    ///   (`Contents/MacOS` -> `Contents/Resources`);
    /// - Windows: the resource dir IS the exe dir, already covered
    ///   by the beside-the-binary step above.
    /// The `resources/` subdir variants cover the case where the
    /// bundler preserves the source directory structure
    /// (`resources/libpdfium.so` -> `$RESOURCES/resources/...`),
    /// and `APPDIR` is checked explicitly in case `current_exe`
    /// resolves outside the AppImage mount. Candidates are pure
    /// path arithmetic (no filesystem access); the caller checks
    /// `is_file()`. The exe's file stem is the `<exe_name>` —
    /// `openpixel-desktop` for the installed app.
    pub(crate) fn tauri_resource_candidates(exe: &std::path::Path) -> Vec<std::path::PathBuf> {
        use pdfium_render::prelude::Pdfium;
        use std::path::PathBuf;
        let mut out: Vec<PathBuf> = Vec::new();
        let Some(exe_dir) = exe.parent() else {
            return out;
        };
        let mut push_dir = |dir: PathBuf| {
            let p = Pdfium::pdfium_platform_library_name_at_path(&dir);
            if !out.contains(&p) {
                out.push(p);
            }
        };
        if let Some(stem) = exe.file_stem() {
            let stem = stem.to_string_lossy().into_owned();
            // <exe_dir>/../lib/<stem>/ — deb, AppImage, dev target/lib/.
            push_dir(exe_dir.join("..").join("lib").join(&stem));
            push_dir(exe_dir.join("..").join("lib").join(&stem).join("resources"));
            if let Ok(appdir) = std::env::var("APPDIR") {
                push_dir(PathBuf::from(&appdir).join("usr").join("lib").join(&stem));
                push_dir(
                    PathBuf::from(&appdir)
                        .join("usr")
                        .join("lib")
                        .join(&stem)
                        .join("resources"),
                );
            }
        }
        // macOS .app: Contents/MacOS -> Contents/Resources.
        push_dir(exe_dir.join("..").join("Resources"));
        push_dir(exe_dir.join("..").join("Resources").join("resources"));
        // Defensive: a `resources/` dir beside the binary.
        push_dir(exe_dir.join("resources"));
        out
    }

    /// Locate a libpdfium binary using the same resolution order as
    /// `bind_pdfium` (env vars, beside the binary, Tauri resource
    /// dir, dev `target/pdfium` cache). `None` when no file is
    /// found — the system library is NOT checked here;
    /// `bind_to_system_library` covers that path.
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
            // Tauri resource dir (Phase 8 desktop bundle).
            for p in tauri_resource_candidates(&exe) {
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
        let info = self.inspect(bytes)?;
        let count = info.page_count;
        let targets: Vec<u32> = match pages {
            Some(list) => {
                crate::engine::check_pages(list, count)?;
                list.to_vec()
            }
            None => (1..=count).collect(),
        };
        // Audit B8: the old code rendered every page in PDFium
        // first and only checked the dimensions afterwards — a
        // huge page (e.g. 100 000 pt wide) at scale 6 would
        // allocate the full bitmap inside the renderer before
        // the check ever ran. Reject up front, from the page
        // boxes; the post-render check below stays as defence
        // in depth (PDFium's own rounding could differ by a
        // pixel).
        for &page in &targets {
            let (w, h) = info.page_sizes[(page - 1) as usize];
            let pw = (w * scale as f64).ceil();
            let ph = (h * scale as f64).ceil();
            let limit = openpixel_core::security::MAX_DIMENSION as f64;
            if pw > limit || ph > limit {
                return Err(PdfError::InvalidPdf(format!(
                    "rendered page {page} would be {pw:.0}x{ph:.0} px, over the {} px limit — use a smaller scale",
                    openpixel_core::security::MAX_DIMENSION
                )));
            }
            if (pw as u64) * (ph as u64) > openpixel_core::security::MAX_PIXELS {
                return Err(PdfError::InvalidPdf(format!(
                    "rendered page {page} would be {pw:.0}x{ph:.0} px, over the {} MP pixel limit — use a smaller scale",
                    openpixel_core::security::MAX_PIXELS
                )));
            }
        }
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
    fn tauri_resource_candidates_cover_deb_appimage_and_macos_layouts() {
        // The platform library name is OS-dependent (libpdfium.so
        // on Linux); assert on the directory tail, not the filename.
        let has_tail = |paths: &[std::path::PathBuf], tail: &str| {
            paths
                .iter()
                .any(|p| p.to_string_lossy().replace('\\', "/").contains(tail))
        };
        // Installed .deb: /usr/bin/openpixel-desktop ->
        // /usr/lib/openpixel-desktop/libpdfium.so.
        let deb = super::worker::tauri_resource_candidates(std::path::Path::new(
            "/usr/bin/openpixel-desktop",
        ));
        assert!(
            has_tail(&deb, "bin/../lib/openpixel-desktop/libpdfium"),
            "deb candidates: {deb:?}"
        );
        // AppImage mount: $APPDIR/usr/bin/... ->
        // $APPDIR/usr/lib/openpixel-desktop/libpdfium.so.
        let appimage = super::worker::tauri_resource_candidates(std::path::Path::new(
            "/tmp/.mount-OpenPixel/usr/bin/openpixel-desktop",
        ));
        assert!(
            has_tail(
                &appimage,
                ".mount-OpenPixel/usr/bin/../lib/openpixel-desktop/libpdfium"
            ),
            "appimage candidates: {appimage:?}"
        );
        // macOS .app: Contents/MacOS/OpenPixel ->
        // Contents/Resources/libpdfium.dylib.
        let macos = super::worker::tauri_resource_candidates(std::path::Path::new(
            "/Applications/OpenPixel.app/Contents/MacOS/OpenPixel",
        ));
        assert!(
            has_tail(&macos, "MacOS/../Resources/libpdfium"),
            "macos candidates: {macos:?}"
        );
        // The resource-dir candidates never outrank the env vars:
        // resolve_pdfium_library checks OPENPIXEL_PDFIUM_* first
        // (order is asserted by the CLI e2e, not here).
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

    /// Regression (audit B8): an oversized page must be refused
    /// BEFORE PDFium allocates the bitmap — the old code rendered
    /// first and checked afterwards. A 20 000 pt page is over
    /// the per-side limit at scale 1; a 12 000 x 12 000 pt page
    /// fits per side but is 144 MP, over the pixel limit.
    #[test]
    fn oversized_pages_are_refused_before_rendering() {
        use crate::engine::ordered_pages;
        use lopdf::{Document, Object};
        let engine = PdfEngine::default();
        for (w, h, want) in [
            (20_000i64, 20_000i64, "px limit"),
            (12_000, 12_000, "pixel limit"),
        ] {
            let mut doc = Document::load_mem(&make_pdf(1, "Big")).unwrap();
            let pages = ordered_pages(&doc);
            let page_id = pages[0].1;
            doc.get_dictionary_mut(page_id).unwrap().set(
                "MediaBox",
                Object::Array(vec![
                    Object::Integer(0),
                    Object::Integer(0),
                    Object::Integer(w),
                    Object::Integer(h),
                ]),
            );
            let mut bytes = Vec::new();
            doc.save_to(&mut std::io::Cursor::new(&mut bytes)).unwrap();
            let err = engine.render_to_images(&bytes, None, 1.0).unwrap_err();
            assert!(
                err.to_string().contains(want),
                "expected a {want} error, got: {err}"
            );
        }
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
