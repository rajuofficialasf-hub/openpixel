//! Text extraction and text exports (Studio Phase 3).
//!
//! Extraction runs on PDFium (the `pdfium` feature, same worker
//! thread as rendering — one binding per process). Without the
//! feature, `extract_text` fails with fetch instructions, never
//! with an empty string: an empty result would look like a
//! scanned page, and a scanned page is a different fact.
//!
//! **Layout detection, honestly scoped:** PDFium segments are
//! grouped into lines by their vertical centres (see
//! `render::worker::extract_one`). That recovers reading order
//! for ordinary single-column documents. Multi-column layouts,
//! tables and rotated text are NOT re-flowed — the lines come
//! out in top-to-bottom, left-to-right order, which for a
//! two-column page interleaves the columns. That limit is in
//! `docs/PDF.md`. A scanned/image-only page has no text layer
//! at all: its lines list is empty, and the caller must say so
//! (OCR is Phase 4).
//!
//! **Exports are text-only:** TXT, HTML and EPUB re-flow the
//! extracted lines; DOCX is a minimal Word document with one
//! paragraph per line. None of them preserves the original
//! fonts, colours, images or exact layout — the output is the
//! document's *text*, and every format says so in its header.

use crate::engine::PdfEngine;
#[cfg(not(feature = "pdfium"))]
use crate::error::PdfError;
use crate::error::Result;
use crate::zip::{build_zip, ZipEntry};
use serde::{Deserialize, Serialize};

/// One visual line of text: its text and its box, measured in
/// points from the **top-left** of the page.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextLine {
    pub text: String,
    pub x: f32,
    pub y_top: f32,
    pub width: f32,
    pub height: f32,
}

/// All the text of one page, in reading order.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageText {
    pub page: u32,
    /// Lines joined with `\n`.
    pub text: String,
    pub lines: Vec<TextLine>,
}

#[cfg(not(feature = "pdfium"))]
fn missing_pdfium_text_error() -> PdfError {
    PdfError::NotImplemented(
        "PDF text extraction needs PDFium (feature `pdfium`) and a libpdfium binary. Rebuild with --features pdfium and run scripts/pdfium/fetch-pdfium.sh (see docs/PDF.md)".to_string(),
    )
}

impl PdfEngine {
    /// Extract text from pages (1-based; `None` = every page).
    /// Requires the `pdfium` feature — without it this returns a
    /// clear NotImplemented error, never an empty result.
    pub fn extract_text(&self, bytes: &[u8], pages: Option<&[u32]>) -> Result<Vec<PageText>> {
        self.validate(bytes)?;
        let count = self.page_count(bytes)?;
        let targets: Vec<u32> = match pages {
            Some(list) => {
                crate::engine::check_pages(list, count)?;
                list.to_vec()
            }
            None => (1..=count).collect(),
        };
        self.extract_text_inner(bytes, &targets)
    }

    #[cfg(feature = "pdfium")]
    fn extract_text_inner(&self, bytes: &[u8], targets: &[u32]) -> Result<Vec<PageText>> {
        crate::render::worker::extract_pages(bytes, targets)
    }

    #[cfg(not(feature = "pdfium"))]
    fn extract_text_inner(&self, _bytes: &[u8], _targets: &[u32]) -> Result<Vec<PageText>> {
        Err(missing_pdfium_text_error())
    }

    /// Plain text: lines in reading order, pages separated by a
    /// `--- Page N ---` header. Empty pages still get a header,
    /// so a missing page is visible instead of silently absent.
    pub fn text_to_txt(pages: &[PageText]) -> String {
        let mut out = String::new();
        for (i, page) in pages.iter().enumerate() {
            if i > 0 {
                out.push('\n');
            }
            out.push_str(&format!("--- Page {} ---\n", page.page));
            out.push_str(&page.text);
            out.push('\n');
        }
        out
    }

    /// Semantic HTML: one `<section>` per page, one `<p>` per
    /// line, indented by its x position. No fonts, no colours,
    /// no images — the document's text, re-flowed.
    pub fn text_to_html(pages: &[PageText], title: &str) -> String {
        let mut out = String::new();
        out.push_str("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n");
        out.push_str(&format!("<title>{}</title>\n", escape_html(title)));
        out.push_str("<style>body{font-family:sans-serif;max-width:72ch;margin:2em auto;line-height:1.5}section{margin-bottom:2em}h2{font-size:1em;color:#475569}</style>\n</head>\n<body>\n");
        out.push_str(&format!("<h1>{}</h1>\n", escape_html(title)));
        for page in pages {
            out.push_str(&format!("<section>\n<h2>Page {}</h2>\n", page.page));
            for line in &page.lines {
                let indent = (line.x / 36.0).clamp(0.0, 8.0);
                out.push_str(&format!(
                    "<p style=\"margin-left:{indent:.1}em\">{}</p>\n",
                    escape_html(&line.text)
                ));
            }
            out.push_str("</section>\n");
        }
        out.push_str("</body>\n</html>\n");
        out
    }

    /// A basic reflowable EPUB 3: one chapter per PDF page, text
    /// only. The `mimetype` entry is first and stored, as the
    /// EPUB spec requires. No cover, no embedded fonts.
    pub fn text_to_epub(pages: &[PageText], title: &str) -> Result<Vec<u8>> {
        let mut entries = vec![ZipEntry {
            name: "mimetype".to_string(),
            data: b"application/epub+zip".to_vec(),
            compress: false,
        }];
        entries.push(ZipEntry {
            name: "META-INF/container.xml".to_string(),
            data: b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"><rootfiles><rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles></container>\n".to_vec(),
            compress: true,
        });
        let mut manifest = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<package xmlns=\"http://www.idpf.org/2007/opf\" unique-identifier=\"bookid\" version=\"3.0\">\n<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:identifier id=\"bookid\">openpixel-epub</dc:identifier><dc:title>");
        manifest.push_str(&escape_xml(title));
        manifest.push_str("</dc:title><dc:language>en</dc:language><dc:creator>OpenPixel Studio</dc:creator><meta property=\"dcterms:modified\">2026-11-16T00:00:00Z</meta></metadata>\n<manifest>\n<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n");
        let mut spine = String::from("<spine>\n");
        for (i, page) in pages.iter().enumerate() {
            manifest.push_str(&format!(
                "<item id=\"ch{}\" href=\"chapter-{}.xhtml\" media-type=\"application/xhtml+xml\"/>\n",
                i + 1,
                i + 1
            ));
            spine.push_str(&format!("<itemref idref=\"ch{}\"/>\n", i + 1));
            let mut chapter = String::from("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>");
            chapter.push_str(&escape_xml(&format!("Page {}", page.page)));
            chapter.push_str("</title></head><body>\n");
            for line in &page.lines {
                chapter.push_str(&format!("<p>{}</p>\n", escape_xml(&line.text)));
            }
            chapter.push_str("</body></html>\n");
            entries.push(ZipEntry {
                name: format!("OEBPS/chapter-{}.xhtml", i + 1),
                data: chapter.into_bytes(),
                compress: true,
            });
        }
        manifest.push_str("</manifest>\n");
        manifest.push_str(&spine);
        manifest.push_str("</spine>\n</package>\n");
        entries.push(ZipEntry {
            name: "OEBPS/content.opf".to_string(),
            data: manifest.into_bytes(),
            compress: true,
        });
        let mut nav = String::from("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\"><head><title>Contents</title></head><body><nav epub:type=\"toc\"><ol>\n");
        for (i, page) in pages.iter().enumerate() {
            nav.push_str(&format!(
                "<li><a href=\"chapter-{}.xhtml\">Page {}</a></li>\n",
                i + 1,
                page.page
            ));
        }
        nav.push_str("</ol></nav></body></html>\n");
        entries.push(ZipEntry {
            name: "OEBPS/nav.xhtml".to_string(),
            data: nav.into_bytes(),
            compress: true,
        });
        Ok(build_zip(&entries))
    }

    /// A minimal Word document: one paragraph per extracted line.
    /// Text only — no fonts, styles, tables or images. Verified
    /// by round-tripping through LibreOffice in the CLI e2e.
    pub fn text_to_docx(pages: &[PageText], title: &str) -> Result<Vec<u8>> {
        let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>
"#;
        let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>
"#;
        let core = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{}</dc:title><dc:creator>OpenPixel Studio</dc:creator></cp:coreProperties>
"#,
            escape_xml(title)
        );
        let app = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>OpenPixel Studio</Application></Properties>
"#;
        let mut document = String::from(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
"#,
        );
        document.push_str(&format!(
            "<w:p><w:pPr><w:pStyle w:val=\"Title\"/></w:pPr><w:r><w:t>{}</w:t></w:r></w:p>\n",
            escape_xml(title)
        ));
        for page in pages {
            for line in &page.lines {
                document.push_str(&format!(
                    "<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>\n",
                    escape_xml(&line.text)
                ));
            }
            document.push_str("<w:p><w:r><w:br/></w:r></w:p>\n");
        }
        document.push_str("</w:body></w:document>\n");
        Ok(build_zip(&[
            ZipEntry {
                name: "[Content_Types].xml".to_string(),
                data: content_types.as_bytes().to_vec(),
                compress: true,
            },
            ZipEntry {
                name: "_rels/.rels".to_string(),
                data: rels.as_bytes().to_vec(),
                compress: true,
            },
            ZipEntry {
                name: "docProps/core.xml".to_string(),
                data: core.into_bytes(),
                compress: true,
            },
            ZipEntry {
                name: "docProps/app.xml".to_string(),
                data: app.as_bytes().to_vec(),
                compress: true,
            },
            ZipEntry {
                name: "word/document.xml".to_string(),
                data: document.into_bytes(),
                compress: true,
            },
        ]))
    }
}

fn escape_html(s: &str) -> String {
    escape_xml(s)
}

fn escape_xml(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            // Audit B13: XML 1.0 forbids control characters
            // except tab/LF/CR — extracted text can carry them,
            // and one would make the whole EPUB/DOCX unparseable.
            // They are dropped, not escaped (there is no escape
            // for them in XML 1.0).
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            _ => out.push(c),
        }
    }
    out
}

#[cfg(all(test, feature = "pdfium"))]
mod tests {
    use super::*;
    use crate::engine::tests::make_pdf;

    #[test]
    fn extracts_real_text_with_layout() {
        let engine = PdfEngine::default();
        let doc = make_pdf(2, "Hello");
        let pages = engine.extract_text(&doc, None).unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0].page, 1);
        assert!(pages[0].text.contains("Hello page 1"));
        assert_eq!(pages[0].lines.len(), 1);
        assert_eq!(pages[0].lines[0].text, "Hello page 1");
        assert!(pages[1].text.contains("Hello page 2"));
        // Single page, in order.
        let one = engine.extract_text(&doc, Some(&[2])).unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].page, 2);
        assert!(engine.extract_text(&doc, Some(&[3])).is_err());
    }

    /// Regression (audit B13): XML 1.0 forbids control
    /// characters — one NUL in extracted text would make the
    /// whole EPUB/DOCX unparseable. They are dropped; tab, LF
    /// and CR survive, and the usual escapes still apply.
    #[test]
    fn escape_xml_drops_forbidden_control_characters() {
        assert_eq!(escape_xml("a\x00b\x07c\x1fd"), "abcd");
        assert_eq!(escape_xml("a\tb\nc\rd"), "a\tb\nc\rd");
        assert_eq!(escape_xml("<a & b>"), "&lt;a &amp; b&gt;");
    }

    #[test]
    fn txt_html_epub_docx_exports_hold_the_text() {
        let engine = PdfEngine::default();
        let doc = make_pdf(2, "Export");
        let pages = engine.extract_text(&doc, None).unwrap();
        let txt = PdfEngine::text_to_txt(&pages);
        assert!(txt.contains("--- Page 1 ---"));
        assert!(txt.contains("Export page 2"));
        let html = PdfEngine::text_to_html(&pages, "Test Doc");
        assert!(html.contains("<h1>Test Doc</h1>"));
        assert!(html.contains("Export page 1"));
        assert!(html.contains("<section>"));
        let epub = PdfEngine::text_to_epub(&pages, "Test Doc").unwrap();
        // mimetype first + stored, and the text is inside the
        // (deflated) chapter — unzip it to check.
        assert_eq!(&epub[30..38], b"mimetype");
        assert_eq!(u16::from_le_bytes([epub[8], epub[9]]), 0);
        let chapter =
            unzip_entry(&epub, "OEBPS/chapter-2.xhtml").expect("chapter 2 must be in the EPUB");
        assert!(chapter.contains("Export page 2"));
        let docx = PdfEngine::text_to_docx(&pages, "Test Doc").unwrap();
        assert_eq!(&docx[0..2], b"PK");
        let document_xml =
            unzip_entry(&docx, "word/document.xml").expect("document.xml must be in the DOCX");
        assert!(document_xml.contains("Export page 1"));
        assert!(document_xml.contains("Export page 2"));
    }

    /// Read one entry out of a ZIP made by `build_zip`, by
    /// walking the local file headers and inflating deflate
    /// entries. (Test-only; the crate has a ZIP writer, not a
    /// reader.)
    fn unzip_entry(zip: &[u8], want: &str) -> Option<String> {
        use std::io::Read as _;
        let mut pos = 0usize;
        while pos + 30 <= zip.len() && zip[pos..pos + 4] == [0x50, 0x4b, 0x03, 0x04] {
            let method = u16::from_le_bytes([zip[pos + 8], zip[pos + 9]]);
            let name_len = u16::from_le_bytes([zip[pos + 26], zip[pos + 27]]) as usize;
            let extra_len = u16::from_le_bytes([zip[pos + 28], zip[pos + 29]]) as usize;
            let name_start = pos + 30;
            let name_end = name_start + name_len;
            let data_start = name_end + extra_len;
            // Compressed size is at offset 18; for stored entries
            // it equals the uncompressed size.
            let comp_len =
                u32::from_le_bytes([zip[pos + 18], zip[pos + 19], zip[pos + 20], zip[pos + 21]])
                    as usize;
            let data_end = data_start + comp_len;
            if data_end > zip.len() {
                return None;
            }
            if let Ok(name) = std::str::from_utf8(&zip[name_start..name_end]) {
                if name == want {
                    let raw = &zip[data_start..data_end];
                    let bytes = match method {
                        0 => raw.to_vec(),
                        8 => {
                            let mut dec =
                                flate2::read::DeflateDecoder::new(std::io::Cursor::new(raw));
                            let mut out = Vec::new();
                            dec.read_to_end(&mut out).ok()?;
                            out
                        }
                        _ => return None,
                    };
                    return String::from_utf8(bytes).ok();
                }
            }
            pos = data_end;
        }
        None
    }
}

/// Without the `pdfium` feature, extraction fails with fetch
/// instructions — never an empty string.
#[cfg(all(test, not(feature = "pdfium")))]
mod no_feature_tests {
    use super::*;
    use crate::engine::tests::make_pdf;

    #[test]
    fn extract_without_pdfium_feature_is_an_honest_error() {
        let engine = PdfEngine::default();
        let doc = make_pdf(2, "NoFeature");
        let err = engine.extract_text(&doc, None).unwrap_err();
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
