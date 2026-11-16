//! The document conversion registry (Studio Phase 3).
//!
//! Pure data, like the image capability registry: which document
//! conversions exist, what runs them, and where they run. The
//! table is the single source of truth — the documents engine
//! routes through it, the CLI prints it (`openpixel doc formats`),
//! and the API types mirror it.
//!
//! Every row here was verified against LibreOffice 24.2.7.2
//! headless (see `docs/PDF.md` for the measured matrix) or
//! against the PDF engine's PDFium text extraction. Rows that
//! LibreOffice refuses — PDF → DOCX/XLSX/PPTX/TXT/EPUB/ODT/RTF
//! ("no export filter") and PPTX → TXT — are deliberately ABSENT:
//! the engine returns `NotImplemented` for them instead of
//! pretending they work. PDF → TXT/HTML/EPUB/DOCX (text-only) go
//! through the PDF engine, never LibreOffice.

use serde::{Deserialize, Serialize};

/// What performs a conversion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversionEngine {
    /// LibreOffice headless (`soffice --convert-to`). Desktop /
    /// server only — it is a ~286 MB system install, not a library.
    LibreOffice,
    /// The PDF engine's PDFium text extraction, re-flowed into a
    /// text format. Text only: no fonts, images or layout.
    PdfText,
}

/// Where a conversion can run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunsWhere {
    /// CLI and desktop app only (LibreOffice lives on the machine).
    CliDesktop,
    /// Runs in the browser too (WASM). No document conversion
    /// runs in the browser today — the variant exists so the
    /// matrix can say so honestly per row.
    Browser,
}

/// One row of the conversion matrix.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocumentConversion {
    /// Source format id, e.g. `"docx"`.
    pub source: &'static str,
    /// Target format id, e.g. `"pdf"`.
    pub target: &'static str,
    /// What performs it.
    pub engine: ConversionEngine,
    /// Where it can run.
    pub runs_where: RunsWhere,
    /// What the user actually gets (fidelity, limits).
    pub fidelity: &'static str,
}

/// The full conversion matrix. Source and target are format ids
/// (`DocumentFormat::id`); look rows up with
/// [`find_conversion`].
pub static DOCUMENT_CONVERSIONS: &[DocumentConversion] = &[
    // PDF out: LibreOffice renders the document to PDF. Layout is
    // re-rendered, so complex formatting may shift a little.
    DocumentConversion { source: "pdf", target: "html", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "LibreOffice re-renders the PDF as HTML; text survives, exact layout does not" },
    DocumentConversion { source: "pdf", target: "txt", engine: ConversionEngine::PdfText, runs_where: RunsWhere::CliDesktop, fidelity: "Text only, one section per page; fonts, images and layout are not preserved" },
    DocumentConversion { source: "pdf", target: "epub", engine: ConversionEngine::PdfText, runs_where: RunsWhere::CliDesktop, fidelity: "Basic reflowable EPUB 3, one chapter per page; text only, no images or original layout" },
    DocumentConversion { source: "pdf", target: "docx", engine: ConversionEngine::PdfText, runs_where: RunsWhere::CliDesktop, fidelity: "Text only — one paragraph per line; fonts, images, tables and layout are NOT preserved" },
    DocumentConversion { source: "docx", target: "pdf", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "LibreOffice re-renders to PDF; headings, bold/italic and tables survive, complex formatting may shift" },
    DocumentConversion { source: "docx", target: "odt", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "Native round-trip through LibreOffice; formatting preserved as well as ODF allows" },
    DocumentConversion { source: "docx", target: "txt", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "Plain text, formatting lost" },
    DocumentConversion { source: "docx", target: "rtf", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "Rich text; most formatting survives" },
    DocumentConversion { source: "docx", target: "html", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "HTML export; styling is approximate" },
    DocumentConversion { source: "doc", target: "pdf", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "Legacy Word format, read by LibreOffice; re-rendered to PDF, complex formatting may shift" },
    DocumentConversion { source: "xlsx", target: "pdf", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "LibreOffice re-renders the sheet to PDF; cell values and table layout survive" },
    DocumentConversion { source: "xlsx", target: "ods", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "Native round-trip through LibreOffice; values and formatting preserved as well as ODF allows" },
    DocumentConversion { source: "xlsx", target: "csv", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "First sheet as CSV; formulas become values, formatting lost" },
    DocumentConversion { source: "xlsx", target: "html", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "HTML table export; styling is approximate" },
    DocumentConversion { source: "xls", target: "pdf", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "Legacy Excel format, read by LibreOffice; re-rendered to PDF" },
    DocumentConversion { source: "pptx", target: "pdf", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "One PDF page per slide; slide text and shapes survive" },
    DocumentConversion { source: "pptx", target: "odp", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "Native round-trip through LibreOffice; slide content preserved as well as ODF allows" },
    DocumentConversion { source: "ppt", target: "pdf", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "Legacy PowerPoint format, read by LibreOffice; one PDF page per slide" },
    DocumentConversion { source: "odt", target: "pdf", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "LibreOffice re-renders to PDF; formatting survives well" },
    DocumentConversion { source: "odt", target: "docx", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "Native round-trip through LibreOffice; formatting preserved as well as OOXML allows" },
    DocumentConversion { source: "ods", target: "pdf", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "LibreOffice re-renders the sheet to PDF" },
    DocumentConversion { source: "ods", target: "xlsx", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "Native round-trip through LibreOffice; values and formatting preserved as well as OOXML allows" },
    DocumentConversion { source: "odp", target: "pdf", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "One PDF page per slide" },
    DocumentConversion { source: "odp", target: "pptx", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "Native round-trip through LibreOffice; slide content preserved as well as OOXML allows" },
    DocumentConversion { source: "rtf", target: "pdf", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "LibreOffice re-renders to PDF; rich-text formatting survives" },
    DocumentConversion { source: "txt", target: "pdf", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "Plain text rendered as a PDF page" },
    DocumentConversion { source: "txt", target: "docx", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "Plain text wrapped as a Word document" },
    DocumentConversion { source: "csv", target: "pdf", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "Rendered as a table; the file name appears as a header" },
    DocumentConversion { source: "csv", target: "xlsx", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "Imported as a sheet; values preserved, no formatting" },
    DocumentConversion { source: "html", target: "pdf", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "LibreOffice renders the page to PDF; lists and emphasis survive, CSS is approximate" },
    DocumentConversion { source: "html", target: "docx", engine: ConversionEngine::LibreOffice, runs_where: RunsWhere::CliDesktop, fidelity: "HTML imported as a Word document; structure survives, styling is approximate" },
];

/// Find the conversion row for a source → target pair, or `None`
/// when the pair is not supported (never guess a conversion).
pub fn find_conversion(source: &str, target: &str) -> Option<&'static DocumentConversion> {
    let s = source.trim().trim_start_matches('.').to_ascii_lowercase();
    let t = target.trim().trim_start_matches('.').to_ascii_lowercase();
    DOCUMENT_CONVERSIONS
        .iter()
        .find(|c| c.source == s && c.target == t)
}

/// All targets a source format can convert to.
pub fn conversion_targets(source: &str) -> Vec<&'static DocumentConversion> {
    let s = source.trim().trim_start_matches('.').to_ascii_lowercase();
    DOCUMENT_CONVERSIONS
        .iter()
        .filter(|c| c.source == s)
        .collect()
}

/// The LibreOffice `--convert-to` filter name for a target, or
/// `None` when LibreOffice has no such filter (PDF-text targets
/// and unsupported pairs).
pub fn libreoffice_filter(target: &str) -> Option<&'static str> {
    Some(
        match target
            .trim()
            .trim_start_matches('.')
            .to_ascii_lowercase()
            .as_str()
        {
            "pdf" => "pdf",
            "docx" | "doc" => "docx",
            "xlsx" | "xls" => "xlsx",
            "pptx" | "ppt" => "pptx",
            "odt" => "odt",
            "ods" => "ods",
            "odp" => "odp",
            "html" => "html",
            "txt" => "txt",
            "csv" => "csv",
            "rtf" => "rtf",
            _ => return None,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_has_no_duplicate_rows() {
        let mut seen = std::collections::HashSet::new();
        for c in DOCUMENT_CONVERSIONS {
            assert!(
                seen.insert((c.source, c.target)),
                "duplicate conversion row {} -> {}",
                c.source,
                c.target
            );
            assert!(
                !c.fidelity.is_empty(),
                "row {} -> {} needs a fidelity note",
                c.source,
                c.target
            );
        }
    }

    #[test]
    fn honest_gaps_are_absent_from_the_table() {
        // These pairs have NO route at all — LibreOffice has no
        // export filter for them and the PDF engine cannot build
        // them — so they must not appear, and the engine refuses
        // them instead of faking them. (pdf -> txt and pdf ->
        // docx exist, but via PdfText, not LibreOffice — see the
        // positive assertions below.)
        for target in ["xlsx", "pptx", "odt", "rtf"] {
            assert!(
                find_conversion("pdf", target).is_none(),
                "pdf -> {target} must not be in the table (LibreOffice has no export filter)"
            );
        }
        assert!(find_conversion("pptx", "txt").is_none());
        // …but the PDF-text routes that DO exist are there.
        assert!(find_conversion("pdf", "txt").is_some());
        assert_eq!(
            find_conversion("pdf", "txt").unwrap().engine,
            ConversionEngine::PdfText
        );
        assert!(find_conversion("pdf", "docx").is_some());
        assert_eq!(
            find_conversion("pdf", "docx").unwrap().engine,
            ConversionEngine::PdfText
        );
        assert!(find_conversion("pdf", "epub").is_some());
        assert_eq!(
            find_conversion("pdf", "epub").unwrap().engine,
            ConversionEngine::PdfText
        );
        assert!(find_conversion("pdf", "html").is_some());
        assert_eq!(
            find_conversion("pdf", "html").unwrap().engine,
            ConversionEngine::LibreOffice
        );
    }

    #[test]
    fn every_row_runs_cli_desktop_only() {
        // No document conversion runs in the browser today.
        assert!(DOCUMENT_CONVERSIONS
            .iter()
            .all(|c| c.runs_where == RunsWhere::CliDesktop));
    }

    #[test]
    fn lookups_are_case_and_dot_insensitive() {
        assert!(find_conversion("DOCX", ".pdf").is_some());
        assert_eq!(conversion_targets("pdf").len(), 4);
        assert_eq!(libreoffice_filter("pdf"), Some("pdf"));
        assert_eq!(libreoffice_filter("epub"), None);
    }
}
