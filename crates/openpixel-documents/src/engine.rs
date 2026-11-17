//! The document conversion engine (Studio Phase 3).
//!
//! Routes every conversion through the registry table in
//! `openpixel-formats::conversion`:
//! * **LibreOffice rows** — Office ↔ PDF and Office ↔ Office,
//!   via the [`LibreOffice`] adapter (desktop/server only).
//! * **PdfText rows** — PDF → TXT/HTML/EPUB/DOCX, via the PDF
//!   engine's PDFium text extraction (needs the `pdfium`
//!   feature + a libpdfium binary; without it the honest
//!   `NotImplemented` error, never an empty file).
//!
//! Pairs with no row are refused with the list of targets the
//! source *can* convert to, so the caller can suggest them.

use crate::error::{DocumentError, Result};
use crate::libreoffice::{LibreOffice, DEFAULT_TIMEOUT_SECS};
use openpixel_core::processing::{EngineHealth, HealthDetail, OptimizeLevel, ProcessingEngine};
use openpixel_core::{OpenPixelError, Result as CoreResult};
use openpixel_formats::{conversion_targets, find_conversion, ConversionEngine};
use openpixel_pdf::{discover_document, is_ole2, pdfium_available, DocumentFormat, PdfEngine};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Options for one document conversion.
#[derive(Debug, Clone)]
pub struct DocumentOptions {
    /// Extension hint for the source (e.g. `"doc"`), used when
    /// the bytes alone cannot name the format — legacy OLE2
    /// files (doc/xls/ppt) share one magic. The CLI sets this
    /// from the input file's extension.
    pub source_hint: Option<String>,
    /// LibreOffice timeout, seconds.
    pub timeout_secs: u64,
}

impl Default for DocumentOptions {
    fn default() -> Self {
        Self {
            source_hint: None,
            timeout_secs: DEFAULT_TIMEOUT_SECS,
        }
    }
}

/// What `inspect` reports for a document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentInfo {
    pub format: DocumentFormat,
    /// How the format was identified (`"signature"`,
    /// `"extension"`, `"mime"`, `"none"`).
    pub method: String,
    /// `"high"`, `"low"` or `"none"`.
    pub confidence: String,
    pub size_bytes: u64,
}

/// Measured result of one conversion.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversionOutcome {
    pub source: DocumentFormat,
    pub target: String,
    pub engine: ConversionEngine,
    pub input_bytes: u64,
    pub output_bytes: u64,
    /// What the user actually gets (fidelity note from the table).
    pub fidelity: String,
}

/// The documents engine. Stateless; the PDF engine is held for
/// the PdfText routes. (`PdfEngine` has no `Debug`, so neither
/// does this.)
#[derive(Default)]
pub struct DocumentEngine {
    pdf: PdfEngine,
}

impl DocumentEngine {
    pub fn new() -> Self {
        Self::default()
    }

    /// Detect the source format. `source_hint` is the input file's
    /// extension when the caller knows it (needed for legacy OLE2
    /// files, which share one magic).
    pub fn detect_source(&self, bytes: &[u8], source_hint: Option<&str>) -> Result<DocumentFormat> {
        let found = discover_document(bytes, source_hint, None);
        if found.format != DocumentFormat::Unknown {
            return Ok(found.format);
        }
        if is_ole2(bytes) {
            return Err(DocumentError::UnknownFormat(
                "legacy Office file (OLE2) — pass its .doc, .xls or .ppt extension so it can be told apart".to_string(),
            ));
        }
        Err(DocumentError::UnknownFormat(
            "signature did not match any known document format".to_string(),
        ))
    }

    /// Convert `bytes` to `target` (a format id, e.g. `"pdf"`).
    /// Returns the outcome and the output bytes.
    pub fn convert(
        &self,
        bytes: &[u8],
        target: &str,
        options: &DocumentOptions,
    ) -> Result<(ConversionOutcome, Vec<u8>)> {
        // Audit: the LibreOffice path never checked the input
        // size — only the `ProcessingEngine::validate` trait
        // method did, and `convert()` does not call it. A
        // multi-hundred-MB document would be written to a temp
        // file and handed to soffice unchecked. Enforce the same
        // 100 MiB limit the image/PDF engines use.
        openpixel_core::security::check_file_size(bytes.len() as u64, &Default::default())?;
        let target = target.trim().trim_start_matches('.').to_ascii_lowercase();
        let source = self.detect_source(bytes, options.source_hint.as_deref())?;
        let row = find_conversion(source.id(), &target).ok_or_else(|| {
            let available: Vec<&str> = conversion_targets(source.id())
                .iter()
                .map(|c| c.target)
                .collect();
            DocumentError::UnsupportedConversion {
                src: source.id().to_string(),
                dst: target.clone(),
                reason: if available.is_empty() {
                    format!("{source:?} cannot be converted to anything")
                } else {
                    format!("{} can convert to: {}", source.id(), available.join(", "))
                },
            }
        })?;
        let out = match row.engine {
            ConversionEngine::LibreOffice => self.convert_via_libreoffice(
                bytes,
                source,
                &target,
                Duration::from_secs(options.timeout_secs),
            )?,
            ConversionEngine::PdfText => self.convert_via_pdf_text(bytes, &target)?,
        };
        Ok((
            ConversionOutcome {
                source,
                target: target.clone(),
                engine: row.engine,
                input_bytes: bytes.len() as u64,
                output_bytes: out.len() as u64,
                fidelity: row.fidelity.to_string(),
            },
            out,
        ))
    }

    fn convert_via_libreoffice(
        &self,
        bytes: &[u8],
        source: DocumentFormat,
        target: &str,
        timeout: Duration,
    ) -> Result<Vec<u8>> {
        // A PDF source must be a readable PDF first — encrypted
        // PDFs are refused here, not by LibreOffice's silence.
        if source == DocumentFormat::Pdf {
            self.pdf.validate(bytes).map_err(DocumentError::Pdf)?;
        }
        let lo = LibreOffice::discover().ok_or_else(|| {
            DocumentError::NotAvailable(
                "no `soffice` binary on PATH (install LibreOffice; see docs/PDF.md)".to_string(),
            )
        })?;
        lo.convert(bytes, source.id(), target, timeout)
    }

    fn convert_via_pdf_text(&self, bytes: &[u8], target: &str) -> Result<Vec<u8>> {
        self.pdf.validate(bytes).map_err(DocumentError::Pdf)?;
        let pages = self
            .pdf
            .extract_text(bytes, None)
            .map_err(DocumentError::Pdf)?;
        let title = self
            .pdf
            .inspect(bytes)
            .map_err(DocumentError::Pdf)?
            .title
            .unwrap_or_else(|| "Document".to_string());
        Ok(match target {
            "txt" => PdfEngine::text_to_txt(&pages).into_bytes(),
            "html" => PdfEngine::text_to_html(&pages, &title).into_bytes(),
            "epub" => PdfEngine::text_to_epub(&pages, &title).map_err(DocumentError::Pdf)?,
            "docx" => PdfEngine::text_to_docx(&pages, &title).map_err(DocumentError::Pdf)?,
            _ => {
                return Err(DocumentError::UnsupportedConversion {
                    src: "pdf".to_string(),
                    dst: target.to_string(),
                    reason: "no PDF-text builder for this target".to_string(),
                })
            }
        })
    }
}

impl ProcessingEngine for DocumentEngine {
    type Options = DocumentOptions;
    type Info = DocumentInfo;
    type Output = Vec<u8>;

    fn name(&self) -> &'static str {
        "documents"
    }

    fn validate(&self, bytes: &[u8]) -> CoreResult<()> {
        openpixel_core::security::check_file_size(bytes.len() as u64, &Default::default())?;
        self.detect_source(bytes, None)
            .map(|_| ())
            .map_err(OpenPixelError::from)
    }

    fn inspect(&self, bytes: &[u8]) -> CoreResult<DocumentInfo> {
        let found = discover_document(bytes, None, None);
        Ok(DocumentInfo {
            format: found.format,
            method: format!("{:?}", found.method).to_ascii_lowercase(),
            confidence: format!("{:?}", found.confidence).to_ascii_lowercase(),
            size_bytes: bytes.len() as u64,
        })
    }

    fn process(
        &self,
        bytes: &[u8],
        target: &str,
        options: &DocumentOptions,
    ) -> CoreResult<Vec<u8>> {
        self.convert(bytes, target, options)
            .map(|(_, out)| out)
            .map_err(OpenPixelError::from)
    }

    fn optimize(&self, _bytes: &[u8], _level: OptimizeLevel) -> CoreResult<Vec<u8>> {
        Err(OpenPixelError::NotImplemented(
            "documents have no in-format optimize — convert to PDF, then compress with `openpixel pdf compress`".to_string(),
        ))
    }

    fn health_check(&self) -> EngineHealth {
        let lo = LibreOffice::discover();
        let lo_note = match &lo {
            Some(lo) => match lo.version() {
                Ok(v) => v,
                Err(e) => format!("found but --version failed: {e}"),
            },
            None => {
                "no `soffice` binary on PATH — install LibreOffice (see docs/PDF.md)".to_string()
            }
        };
        EngineHealth {
            engine: "documents",
            ok: true,
            details: vec![
                HealthDetail {
                    name: "libreoffice".to_string(),
                    ok: lo.is_some(),
                    note: lo_note,
                },
                HealthDetail {
                    name: "pdf text extraction".to_string(),
                    ok: pdfium_available(),
                    note: if pdfium_available() {
                        "PDFium available — PDF -> TXT/HTML/EPUB/DOCX work".to_string()
                    } else {
                        "PDFium not compiled in — PDF -> TXT/HTML/EPUB/DOCX return NotImplemented (build with --features pdfium)".to_string()
                    },
                },
                HealthDetail {
                    name: "conversion table".to_string(),
                    ok: true,
                    note: format!(
                        "{} source -> target rows registered",
                        openpixel_formats::DOCUMENT_CONVERSIONS.len()
                    ),
                },
            ],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use openpixel_pdf::{build_zip, ZipEntry};

    /// A minimal 1-page PDF with the text "Doc page 1", built
    /// with lopdf the same way the PDF engine's own tests do.
    fn make_pdf() -> Vec<u8> {
        use lopdf::{dictionary, Document, Object, Stream};
        use std::io::Cursor;
        let mut doc = Document::with_version("1.5");
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica", "Encoding" => "WinAnsiEncoding",
        });
        let pages_id = doc.add_object(dictionary! {
            "Type" => "Pages", "Kids" => Object::Array(vec![]), "Count" => Object::Integer(0),
        });
        let content = b"BT /F1 24 Tf 100 700 Td (Doc page 1) Tj ET".to_vec();
        let stream_id = doc.add_object(Stream::new(dictionary! {}, content));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => Object::Reference(pages_id),
            "MediaBox" => Object::Array(vec![Object::Integer(0), Object::Integer(0), Object::Integer(612), Object::Integer(792)]),
            "Resources" => dictionary! { "Font" => dictionary! { "F1" => Object::Reference(font_id) } },
            "Contents" => Object::Reference(stream_id),
        });
        if let Ok(p) = doc.get_dictionary_mut(pages_id) {
            p.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
            p.set("Count", Object::Integer(1));
        }
        let catalog_id = doc.add_object(
            dictionary! { "Type" => "Catalog", "Pages" => Object::Reference(pages_id) },
        );
        doc.trailer.set("Root", Object::Reference(catalog_id));
        let mut out = Vec::new();
        doc.save_to(&mut Cursor::new(&mut out)).unwrap();
        out
    }

    /// A minimal .docx: the three parts LibreOffice needs to open
    /// it (content types, rels, one document with a heading and a
    /// paragraph).
    fn make_docx() -> Vec<u8> {
        build_zip(&[
            ZipEntry {
                name: "[Content_Types].xml".to_string(),
                data: b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>".to_vec(),
                compress: true,
            },
            ZipEntry {
                name: "_rels/.rels".to_string(),
                data: b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>".to_vec(),
                compress: true,
            },
            ZipEntry {
                name: "word/document.xml".to_string(),
                data: b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Docx heading</w:t></w:r></w:p><w:p><w:r><w:t>A paragraph with bold text.</w:t></w:r></w:p></w:body></w:document>".to_vec(),
                compress: true,
            },
        ])
    }

    #[test]
    fn unsupported_pairs_name_their_alternatives() {
        let engine = DocumentEngine::new();
        let pdf = make_pdf();
        // PDF -> XLSX has no route anywhere.
        let err = engine
            .convert(&pdf, "xlsx", &DocumentOptions::default())
            .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("unsupported conversion"), "{msg}");
        assert!(msg.contains("html"), "{msg}");
        assert!(msg.contains("txt"), "{msg}");
    }

    #[test]
    fn validate_rejects_garbage_and_accepts_documents() {
        let engine = DocumentEngine::new();
        // Non-UTF-8 binary garbage is no document at all. (Plain
        // ASCII text *is* a valid .txt document, so it validates.)
        assert!(engine
            .validate(b"\x00\x01\x02\x03\xff\xfe\x00\x01")
            .is_err());
        assert!(engine.validate(&make_pdf()).is_ok());
        assert!(engine.validate(&make_docx()).is_ok());
        // Legacy OLE2 without an extension hint: honest about
        // why it cannot be named.
        let ole2: &[u8] = b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1\x00\x00\x00\x00";
        let err = engine.validate(ole2).unwrap_err();
        assert!(err.to_string().contains("OLE2"), "{err}");
    }

    #[test]
    fn detect_source_uses_the_extension_hint_for_ole2() {
        let engine = DocumentEngine::new();
        let ole2: &[u8] = b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1\x00\x00\x00\x00";
        let opts = DocumentOptions {
            source_hint: Some("doc".to_string()),
            timeout_secs: 30,
        };
        assert_eq!(
            engine
                .detect_source(ole2, opts.source_hint.as_deref())
                .unwrap(),
            DocumentFormat::Doc
        );
    }

    #[test]
    fn optimize_is_an_honest_not_implemented() {
        let engine = DocumentEngine::new();
        let err = <DocumentEngine as ProcessingEngine>::optimize(
            &engine,
            &make_pdf(),
            OptimizeLevel::Balanced,
        )
        .unwrap_err();
        assert!(matches!(err, OpenPixelError::NotImplemented(_)));
    }

    #[test]
    fn health_check_reports_libreoffice_and_pdfium_truthfully() {
        let engine = DocumentEngine::new();
        let health = engine.health_check();
        assert_eq!(health.engine, "documents");
        let lo = health
            .details
            .iter()
            .find(|d| d.name == "libreoffice")
            .unwrap();
        assert_eq!(lo.ok, LibreOffice::is_available());
        let text = health
            .details
            .iter()
            .find(|d| d.name == "pdf text extraction")
            .unwrap();
        assert_eq!(text.ok, pdfium_available());
    }

    /// LibreOffice conversions. On a machine without soffice
    /// (CI) the test asserts the honest NotAvailable path
    /// instead of failing; here (LibreOffice installed) it runs
    /// the real conversions.
    #[test]
    fn libreoffice_converts_docx_and_txt_to_pdf() {
        let engine = DocumentEngine::new();
        let Some(_) = LibreOffice::discover() else {
            let err = engine
                .convert(&make_docx(), "pdf", &DocumentOptions::default())
                .unwrap_err();
            assert!(matches!(err, DocumentError::NotAvailable(_)));
            return;
        };
        let (outcome, out) = engine
            .convert(&make_docx(), "pdf", &DocumentOptions::default())
            .unwrap();
        assert_eq!(outcome.source, DocumentFormat::Docx);
        assert_eq!(outcome.target, "pdf");
        assert!(out.starts_with(b"%PDF-"), "docx -> pdf must be a real PDF");
        let pages = engine.pdf.page_count(&out).unwrap();
        assert_eq!(pages, 1);
        // Text extraction needs PDFium (the CLI build has it;
        // a bare `cargo test -p openpixel-documents` does not).
        if pdfium_available() {
            let text = engine.pdf.extract_text(&out, None).unwrap();
            assert!(
                text[0].text.contains("Docx heading"),
                "text must survive: {}",
                text[0].text
            );
        } else {
            assert!(matches!(
                engine.pdf.extract_text(&out, None),
                Err(openpixel_pdf::PdfError::NotImplemented(_))
            ));
        }

        let (outcome, out) = engine
            .convert(
                b"Hello text file\nSecond line\n",
                "pdf",
                &DocumentOptions::default(),
            )
            .unwrap();
        assert_eq!(outcome.source, DocumentFormat::Txt);
        assert!(out.starts_with(b"%PDF-"));
    }

    #[test]
    fn libreoffice_pdf_to_html_works_and_pdf_to_xlsx_refuses() {
        let engine = DocumentEngine::new();
        let Some(_) = LibreOffice::discover() else {
            return;
        };
        let pdf = make_pdf();
        let (outcome, out) = engine
            .convert(&pdf, "html", &DocumentOptions::default())
            .unwrap();
        assert_eq!(outcome.source, DocumentFormat::Pdf);
        let html = String::from_utf8_lossy(&out);
        assert!(
            html.contains("Doc page 1"),
            "pdf -> html must carry the text"
        );
    }

    #[test]
    fn pdf_text_routes_need_pdfium_and_say_so_without_it() {
        let engine = DocumentEngine::new();
        let pdf = make_pdf();
        if pdfium_available() {
            let (_, out) = engine
                .convert(&pdf, "txt", &DocumentOptions::default())
                .unwrap();
            assert!(String::from_utf8_lossy(&out).contains("Doc page 1"));
        } else {
            let err = engine
                .convert(&pdf, "txt", &DocumentOptions::default())
                .unwrap_err();
            assert!(
                matches!(
                    err,
                    DocumentError::Pdf(openpixel_pdf::PdfError::NotImplemented(_))
                ),
                "without PDFium the error must be NotImplemented, got: {err}"
            );
        }
    }

    #[test]
    fn zero_timeout_kills_the_conversion() {
        let engine = DocumentEngine::new();
        let Some(_) = LibreOffice::discover() else {
            return;
        };
        let opts = DocumentOptions {
            source_hint: None,
            timeout_secs: 0,
        };
        let err = engine.convert(&make_docx(), "pdf", &opts).unwrap_err();
        assert!(matches!(err, DocumentError::Timeout(_)), "got: {err}");
    }
}
