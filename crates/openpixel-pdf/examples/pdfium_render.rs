//! PDFium render prototype (Studio Phase 1).
//!
//! Renders one real multi-page PDF (generated with lopdf, no
//! checked-in fixtures) to PNG images and records whether the
//! render path works in this environment.
//!
//! Usage:
//!   cargo run -p openpixel-pdf --example pdfium_render --features pdfium
//!
//! Without `--features pdfium` this prints what is missing and
//! exits 0 — the feature is opt-in, and the default build never
//! downloads or links PDFium.
//!
//! Where the library comes from: `pdfium-render` does NOT download
//! PDFium itself. This prototype first tries a system-installed
//! libpdfium, then downloads the prebuilt binary from
//! bblanchon/pdfium-binaries (GitHub releases, latest
//! `chromium/*` tag) into `<workspace>/target/pdfium/` — that
//! directory is build output, never committed. The URL, tag and
//! sha256 of whatever was downloaded are printed on every run so
//! the provenance can be recorded in `LICENSE_AUDIT.md`.
//! Download goes through the normal environment proxy
//! (`HTTPS_PROXY`), the same way `cargo` fetches crates.

#[cfg(feature = "pdfium")]
fn main() {
    if let Err(e) = run() {
        eprintln!("PDFium prototype FAILED: {e}");
        std::process::exit(1);
    }
}

#[cfg(not(feature = "pdfium"))]
fn main() {
    println!("PDFium prototype: feature `pdfium` is OFF.");
    println!("Re-run with: cargo run -p openpixel-pdf --example pdfium_render --features pdfium");
    println!("Without the feature, the default build has no PDFium dependency at all.");
}

#[cfg(feature = "pdfium")]
fn run() -> Result<(), String> {
    use lopdf::{dictionary, Document, Object, Stream};
    use pdfium_render::prelude::*;
    use std::io::Cursor;
    use std::path::PathBuf;

    // 1. A real 3-page PDF, generated with lopdf.
    let mut doc = Document::with_version("1.5");
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type1",
        "BaseFont" => "Helvetica", "Encoding" => "WinAnsiEncoding",
    });
    let pages_id = doc.add_object(dictionary! {
        "Type" => "Pages",
        "Kids" => Object::Array(vec![]),
        "Count" => Object::Integer(0),
    });
    let mut kids = Vec::new();
    for n in 1..=3u32 {
        let content = format!("BT /F1 24 Tf 100 700 Td (PDFium page {n}) Tj ET");
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
        pages_dict.set("Count", Object::Integer(3));
    }
    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => Object::Reference(pages_id),
    });
    doc.trailer.set("Root", Object::Reference(catalog_id));
    let mut pdf_bytes = Vec::new();
    doc.save_to(&mut Cursor::new(&mut pdf_bytes))
        .map_err(|e| format!("could not build fixture PDF: {e}"))?;
    println!("fixture: 3-page PDF, {} bytes", pdf_bytes.len());

    // 2. Find or fetch libpdfium.
    let cache_dir: PathBuf = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/pdfium");
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("could not create {}: {e}", cache_dir.display()))?;
    let lib_path = Pdfium::pdfium_platform_library_name_at_path(&cache_dir);

    let bindings = match Pdfium::bind_to_library(&lib_path) {
        Ok(b) => {
            println!("libpdfium: found cached copy at {}", lib_path.display());
            b
        }
        Err(_) => match Pdfium::bind_to_system_library() {
            Ok(b) => {
                println!("libpdfium: using system-installed library");
                b
            }
            Err(_) => {
                println!("libpdfium: not cached, not installed — downloading prebuilt binary…");
                download_pdfium(&cache_dir)?;
                Pdfium::bind_to_library(&lib_path)
                    .map_err(|e| format!("downloaded libpdfium but binding failed: {e}"))?
            }
        },
    };
    let pdfium = Pdfium::new(bindings);

    // 3. Render every page.
    let document = pdfium
        .load_pdf_from_byte_slice(&pdf_bytes, None)
        .map_err(|e| format!("PDFium could not load the fixture PDF: {e}"))?;
    let page_count = document.pages().len();
    println!("PDFium loaded the PDF: {page_count} pages");
    if page_count != 3 {
        return Err(format!("expected 3 pages, PDFium reported {page_count}"));
    }
    for i in 0..page_count {
        let page = document
            .pages()
            .get(i)
            .map_err(|e| format!("could not get page {i}: {e}"))?;
        let bitmap = page
            .render_with_config(&PdfRenderConfig::new().set_target_width(200.into()))
            .map_err(|e| format!("could not render page {i}: {e}"))?;
        let image = bitmap
            .as_image()
            .map_err(|e| format!("could not convert page {i} bitmap to image: {e}"))?;
        let out_path = cache_dir.join(format!("render-page-{i}.png"));
        image
            .save(&out_path)
            .map_err(|e| format!("could not save {}: {e}", out_path.display()))?;
        // The page is black text on white: a render that is all
        // white (or all black) is a silent failure, not a render.
        let luma = image.to_luma8();
        let dark = luma.pixels().filter(|p| p.0[0] < 128).count();
        println!(
            "page {i}: {}x{} px, {} bytes, {dark} dark pixels -> {}",
            image.width(),
            image.height(),
            std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0),
            out_path.display()
        );
        if dark == 0 {
            return Err(format!("page {i} rendered all-white — no text visible"));
        }
    }

    println!(
        "PDFium prototype: OK — 3 pages rendered to {}",
        cache_dir.display()
    );
    Ok(())
}

/// Download the latest prebuilt PDFium (linux x64) from
/// bblanchon/pdfium-binaries into `dir`. Prints the release tag,
/// URL and sha256 so the provenance is on record.
#[cfg(feature = "pdfium")]
fn download_pdfium(dir: &std::path::Path) -> Result<(), String> {
    use std::process::Command;

    // The GitHub *API* is rate-limited for unauthenticated calls
    // from a shared egress IP (60/hr) — so resolve the latest
    // release through the HTML redirect instead: /releases/latest
    // 302s to /releases/tag/chromium%2F<build>, which carries the
    // tag in the final URL and costs no API quota.
    let out = Command::new("curl")
        .args([
            "-fsSL",
            "-o",
            "/dev/null",
            "-w",
            "%{url_effective}",
            "https://github.com/bblanchon/pdfium-binaries/releases/latest",
        ])
        .output()
        .map_err(|e| format!("curl failed to resolve latest release: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "resolving latest pdfium-binaries release failed ({}): {}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    let final_url = String::from_utf8_lossy(&out.stdout);
    let tag = final_url
        .rsplit("/releases/tag/")
        .next()
        .ok_or_else(|| "could not parse tag from latest-release redirect".to_string())?;
    // `tag` is already percent-encoded in the URL (chromium%2F…),
    // which is exactly what the download URL needs.
    println!("pdfium-binaries latest release: {tag}");
    let url = format!(
        "https://github.com/bblanchon/pdfium-binaries/releases/download/{tag}/pdfium-linux-x64.tgz"
    );
    println!("downloading: {url}");
    let tgz = dir.join("pdfium-linux-x64.tgz");
    let status = Command::new("curl")
        .args(["-fsSL", "-o"])
        .arg(&tgz)
        .arg(&url)
        .status()
        .map_err(|e| format!("curl download failed: {e}"))?;
    if !status.success() {
        return Err(format!("downloading {url} failed ({status})"));
    }
    let sha = Command::new("sha256sum")
        .arg(&tgz)
        .output()
        .map_err(|e| format!("sha256sum failed: {e}"))?;
    println!(
        "sha256: {}  (record in LICENSE_AUDIT.md)",
        String::from_utf8_lossy(&sha.stdout).trim()
    );
    let status = Command::new("tar")
        .args(["--no-same-owner", "-xzf"])
        .arg(&tgz)
        .arg("-C")
        .arg(dir)
        .status()
        .map_err(|e| format!("tar extraction failed: {e}"))?;
    if !status.success() {
        return Err(format!("extracting pdfium tgz failed ({status})"));
    }
    // The archive contains lib/libpdfium.so; move it next to the
    // tgz so `bind_to_library` finds it by platform name.
    let extracted = dir.join("lib/libpdfium.so");
    let target = dir.join("libpdfium.so");
    if extracted.exists() {
        std::fs::rename(&extracted, &target)
            .map_err(|e| format!("could not move libpdfium.so into place: {e}"))?;
    }
    if !target.exists() {
        return Err(format!(
            "downloaded archive did not contain lib/libpdfium.so (looked in {})",
            dir.display()
        ));
    }
    println!("libpdfium ready at {}", target.display());
    Ok(())
}
