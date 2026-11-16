//! Document format detection — signature first, never the extension.
//!
//! The same discipline as `openpixel-formats::discover`, extended
//! to documents: PDF (`%PDF-`), RTF (`{\rtf`), ZIP-based Office /
//! EPUB (central-directory entry names + the `mimetype` entry),
//! HTML (leading tag), and plain text (valid UTF-8 fallback).
//! CSV has no signature at all — it is only ever an
//! extension/MIME fallback, and the result says so (Low
//! confidence). A ZIP that is none of the known document types is
//! `Unknown`, not a guessed Office format.

use openpixel_formats::{Confidence, DetectionMethod};
use serde::{Deserialize, Serialize};

/// Document formats the Studio engines know about. `Unknown` is a
/// real answer, not a failure: it means no signature matched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentFormat {
    Pdf,
    Docx,
    Xlsx,
    Pptx,
    Odt,
    Ods,
    Odp,
    Epub,
    Rtf,
    Txt,
    Csv,
    Html,
    Unknown,
}

impl DocumentFormat {
    /// Short stable id, e.g. `"pdf"`, `"docx"`.
    pub fn id(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Docx => "docx",
            Self::Xlsx => "xlsx",
            Self::Pptx => "pptx",
            Self::Odt => "odt",
            Self::Ods => "ods",
            Self::Odp => "odp",
            Self::Epub => "epub",
            Self::Rtf => "rtf",
            Self::Txt => "txt",
            Self::Csv => "csv",
            Self::Html => "html",
            Self::Unknown => "unknown",
        }
    }

    /// Parse a format id or extension (without the dot).
    pub fn from_name(name: &str) -> Option<Self> {
        let n = name.trim().trim_start_matches('.').to_ascii_lowercase();
        Some(match n.as_str() {
            "pdf" => Self::Pdf,
            "docx" | "doc" => Self::Docx,
            "xlsx" | "xls" => Self::Xlsx,
            "pptx" | "ppt" => Self::Pptx,
            "odt" => Self::Odt,
            "ods" => Self::Ods,
            "odp" => Self::Odp,
            "epub" => Self::Epub,
            "rtf" => Self::Rtf,
            "txt" => Self::Txt,
            "csv" => Self::Csv,
            "html" | "htm" => Self::Html,
            _ => return None,
        })
    }

    /// Parse a MIME type.
    pub fn from_mime(mime: &str) -> Option<Self> {
        let m = mime.trim().to_ascii_lowercase();
        Some(match m.as_str() {
            "application/pdf" => Self::Pdf,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => Self::Docx,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Self::Xlsx,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation" => {
                Self::Pptx
            }
            "application/vnd.oasis.opendocument.text" => Self::Odt,
            "application/vnd.oasis.opendocument.spreadsheet" => Self::Ods,
            "application/vnd.oasis.opendocument.presentation" => Self::Odp,
            "application/epub+zip" => Self::Epub,
            "application/rtf" | "text/rtf" => Self::Rtf,
            "text/plain" => Self::Txt,
            "text/csv" => Self::Csv,
            "text/html" => Self::Html,
            _ => return None,
        })
    }
}

/// The result of document discovery — same shape as image
/// discovery, so callers treat both uniformly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentDiscovery {
    pub format: DocumentFormat,
    pub method: DetectionMethod,
    pub confidence: Confidence,
    pub extension_claim: Option<DocumentFormat>,
    pub mime_claim: Option<DocumentFormat>,
}

impl DocumentDiscovery {
    pub fn has_mismatch(&self) -> bool {
        self.extension_claim
            .map(|f| f != self.format)
            .unwrap_or(false)
            || self.mime_claim.map(|f| f != self.format).unwrap_or(false)
    }
}

/// Detect a document format from magic bytes only. `Unknown` when
/// nothing matches — including a ZIP that is none of the known
/// document types.
pub fn detect_document_format(bytes: &[u8]) -> DocumentFormat {
    if bytes.starts_with(b"%PDF-") {
        return DocumentFormat::Pdf;
    }
    if bytes.starts_with(b"{\\rtf") {
        return DocumentFormat::Rtf;
    }
    if is_zip(bytes) {
        return detect_zip_document(bytes);
    }
    if is_html(bytes) {
        return DocumentFormat::Html;
    }
    // Plain text: valid UTF-8 (or UTF-16 with BOM) and nothing
    // else matched. Low confidence — it is a content heuristic,
    // not a magic number.
    if is_plain_text(bytes) {
        return DocumentFormat::Txt;
    }
    DocumentFormat::Unknown
}

/// Full discovery: signature first, extension / MIME only as a
/// low-confidence fallback. Never let the fallback override a
/// signature.
pub fn discover_document(
    bytes: &[u8],
    extension: Option<&str>,
    mime: Option<&str>,
) -> DocumentDiscovery {
    let by_signature = detect_document_format(bytes);
    let extension_claim = extension.and_then(DocumentFormat::from_name);
    let mime_claim = mime.and_then(DocumentFormat::from_mime);

    if by_signature != DocumentFormat::Unknown {
        let confidence = if by_signature == DocumentFormat::Txt {
            // Plain-text detection is a heuristic, not a magic.
            Confidence::Low
        } else {
            Confidence::High
        };
        return DocumentDiscovery {
            format: by_signature,
            method: DetectionMethod::Signature,
            confidence,
            extension_claim: extension_claim.filter(|f| *f != by_signature),
            mime_claim: mime_claim.filter(|f| *f != by_signature),
        };
    }
    if let Some(f) = extension_claim {
        return DocumentDiscovery {
            format: f,
            method: DetectionMethod::Extension,
            confidence: Confidence::Low,
            extension_claim: None,
            mime_claim: mime_claim.filter(|m| *m != f),
        };
    }
    if let Some(f) = mime_claim {
        return DocumentDiscovery {
            format: f,
            method: DetectionMethod::Mime,
            confidence: Confidence::Low,
            extension_claim: None,
            mime_claim: None,
        };
    }
    DocumentDiscovery {
        format: DocumentFormat::Unknown,
        method: DetectionMethod::None,
        confidence: Confidence::None,
        extension_claim: None,
        mime_claim: None,
    }
}

fn is_zip(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06")
}

/// A ZIP is a document container: read the central directory entry
/// names (and the `mimetype` entry's stored content, when present)
/// to tell Office / EPUB / ODF apart. No decompression is needed —
/// entry names live in the central directory, and `mimetype` is
/// stored uncompressed by spec.
fn detect_zip_document(bytes: &[u8]) -> DocumentFormat {
    let entries = zip_entry_names(bytes);
    let has = |name: &str| entries.iter().any(|e| e == name);
    if has("word/document.xml") {
        return DocumentFormat::Docx;
    }
    if has("xl/workbook.xml") {
        return DocumentFormat::Xlsx;
    }
    if has("ppt/presentation.xml") {
        return DocumentFormat::Pptx;
    }
    if let Some(mimetype) = zip_stored_entry_content(bytes, "mimetype") {
        let mimetype = String::from_utf8_lossy(&mimetype);
        if mimetype == "application/epub+zip" {
            return DocumentFormat::Epub;
        }
        if let Some(kind) = mimetype.strip_prefix("application/vnd.oasis.opendocument.") {
            return match kind {
                "text" => DocumentFormat::Odt,
                "spreadsheet" => DocumentFormat::Ods,
                "presentation" => DocumentFormat::Odp,
                _ => DocumentFormat::Unknown,
            };
        }
    }
    // EPUB without a readable mimetype entry: every EPUB carries
    // META-INF/container.xml, which Office files do not.
    if has("META-INF/container.xml") {
        return DocumentFormat::Epub;
    }
    DocumentFormat::Unknown
}

/// Entry names from a ZIP's central directory (preferred), falling
/// back to scanning local file headers for streaming ZIPs whose
/// central directory is absent.
fn zip_entry_names(bytes: &[u8]) -> Vec<String> {
    if let Some(names) = zip_central_names(bytes) {
        return names;
    }
    zip_local_names(bytes)
}

fn zip_central_names(bytes: &[u8]) -> Option<Vec<String>> {
    // End of central directory: PK\x05\x06 in the last 64 KiB.
    let scan_from = bytes.len().saturating_sub(65_557);
    let mut eocd = None;
    for i in scan_from..bytes.len().saturating_sub(22) {
        if &bytes[i..i + 4] == b"PK\x05\x06" {
            eocd = Some(i);
        }
    }
    let eocd = eocd?;
    let total = u16::from_le_bytes([bytes[eocd + 10], bytes[eocd + 11]]) as usize;
    let cd_offset = u32::from_le_bytes(bytes[eocd + 16..eocd + 20].try_into().ok()?) as usize;
    let mut names = Vec::new();
    let mut pos = cd_offset;
    for _ in 0..total {
        if pos + 46 > bytes.len() || &bytes[pos..pos + 4] != b"PK\x01\x02" {
            break;
        }
        let name_len = u16::from_le_bytes([bytes[pos + 28], bytes[pos + 29]]) as usize;
        let extra_len = u16::from_le_bytes([bytes[pos + 30], bytes[pos + 31]]) as usize;
        let comment_len = u16::from_le_bytes([bytes[pos + 32], bytes[pos + 33]]) as usize;
        let start = pos + 46;
        let end = start.saturating_add(name_len).min(bytes.len());
        names.push(String::from_utf8_lossy(&bytes[start..end]).into_owned());
        pos = start + name_len + extra_len + comment_len;
    }
    Some(names)
}

fn zip_local_names(bytes: &[u8]) -> Vec<String> {
    let mut names = Vec::new();
    let mut pos = 0;
    while pos + 30 <= bytes.len() {
        if &bytes[pos..pos + 4] != b"PK\x03\x04" {
            break;
        }
        let method = u16::from_le_bytes([bytes[pos + 8], bytes[pos + 9]]);
        let comp_size = u32::from_le_bytes(bytes[pos + 18..pos + 22].try_into().unwrap()) as usize;
        let name_len = u16::from_le_bytes([bytes[pos + 26], bytes[pos + 27]]) as usize;
        let extra_len = u16::from_le_bytes([bytes[pos + 28], bytes[pos + 29]]) as usize;
        let name_start = pos + 30;
        let name_end = name_start.saturating_add(name_len).min(bytes.len());
        names.push(String::from_utf8_lossy(&bytes[name_start..name_end]).into_owned());
        // Stored (0) and deflated (8) entries alike: the next local
        // header follows the compressed data.
        let _ = method;
        pos = name_end + extra_len + comp_size;
    }
    names
}

/// Content of a *stored* (method 0) ZIP entry, looked up by name.
/// Compressed entries return `None` — callers that need them must
/// decompress (Phase 3 Office work); detection never needs to.
fn zip_stored_entry_content(bytes: &[u8], wanted: &str) -> Option<Vec<u8>> {
    let mut pos = 0;
    while pos + 30 <= bytes.len() {
        if &bytes[pos..pos + 4] != b"PK\x03\x04" {
            return None;
        }
        let method = u16::from_le_bytes([bytes[pos + 8], bytes[pos + 9]]);
        let comp_size = u32::from_le_bytes(bytes[pos + 18..pos + 22].try_into().ok()?) as usize;
        let name_len = u16::from_le_bytes([bytes[pos + 26], bytes[pos + 27]]) as usize;
        let extra_len = u16::from_le_bytes([bytes[pos + 28], bytes[pos + 29]]) as usize;
        let name_start = pos + 30;
        let name_end = name_start.saturating_add(name_len).min(bytes.len());
        let name = String::from_utf8_lossy(&bytes[name_start..name_end]);
        let data_start = name_end + extra_len;
        if name == wanted {
            if method != 0 {
                return None;
            }
            let data_end = data_start.saturating_add(comp_size).min(bytes.len());
            return Some(bytes[data_start..data_end].to_vec());
        }
        pos = data_start + comp_size;
    }
    None
}

/// HTML: optional BOM + whitespace, then `<!doctype html` or
/// `<html` (case-insensitive).
fn is_html(bytes: &[u8]) -> bool {
    let mut b = bytes;
    if b.starts_with(&[0xEF, 0xBB, 0xBF]) {
        b = &b[3..];
    }
    let b = {
        let mut i = 0;
        while i < b.len() && matches!(b[i], b' ' | b'\t' | b'\n' | b'\r') {
            i += 1;
        }
        &b[i..]
    };
    let lower: Vec<u8> = b.iter().take(15).map(|c| c.to_ascii_lowercase()).collect();
    lower.starts_with(b"<!doctype html") || lower.starts_with(b"<html")
}

/// Plain text: valid UTF-8 (or UTF-16 with BOM), no NUL bytes,
/// and nothing else matched. A heuristic, not a magic number.
fn is_plain_text(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }
    if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        return true;
    }
    if bytes.contains(&0) {
        return false;
    }
    std::str::from_utf8(bytes).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal stored (uncompressed) ZIP with the given
    /// entry names — the same shape real Office/EPUB files have
    /// for their directory entries (contents are empty).
    fn make_zip(entries: &[&str]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central = Vec::new();
        for name in entries {
            let local_offset = out.len() as u32;
            out.extend_from_slice(b"PK\x03\x04");
            out.extend_from_slice(&20u16.to_le_bytes()); // version
            out.extend_from_slice(&0u16.to_le_bytes()); // flags
            out.extend_from_slice(&0u16.to_le_bytes()); // method: stored
            out.extend_from_slice(&0u16.to_le_bytes()); // time
            out.extend_from_slice(&0u16.to_le_bytes()); // date
            out.extend_from_slice(&0u32.to_le_bytes()); // crc
            out.extend_from_slice(&0u32.to_le_bytes()); // comp size
            out.extend_from_slice(&0u32.to_le_bytes()); // size
            out.extend_from_slice(&(name.len() as u16).to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes()); // extra len
            out.extend_from_slice(name.as_bytes());
            central.extend_from_slice(b"PK\x01\x02");
            central.extend_from_slice(&20u16.to_le_bytes());
            central.extend_from_slice(&20u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u32.to_le_bytes());
            central.extend_from_slice(&0u32.to_le_bytes());
            central.extend_from_slice(&0u32.to_le_bytes());
            central.extend_from_slice(&(name.len() as u16).to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u32.to_le_bytes());
            central.extend_from_slice(&local_offset.to_le_bytes());
            central.extend_from_slice(name.as_bytes());
        }
        let cd_offset = out.len() as u32;
        let cd_size = central.len() as u32;
        out.extend_from_slice(&central);
        out.extend_from_slice(b"PK\x05\x06");
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        out.extend_from_slice(&cd_size.to_le_bytes());
        out.extend_from_slice(&cd_offset.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out
    }

    #[test]
    fn pdf_rtf_html_txt_detected_by_signature() {
        assert_eq!(
            detect_document_format(b"%PDF-1.7 rest"),
            DocumentFormat::Pdf
        );
        assert_eq!(detect_document_format(b"{\\rtf1 rest"), DocumentFormat::Rtf);
        assert_eq!(
            detect_document_format(b"  <!DOCTYPE html><head>"),
            DocumentFormat::Html
        );
        assert_eq!(
            detect_document_format(b"hello, plain text\nsecond line"),
            DocumentFormat::Txt
        );
        assert_eq!(
            detect_document_format(b"\x00\x01\x02\x03"),
            DocumentFormat::Unknown
        );
    }

    #[test]
    fn office_and_epub_detected_from_zip_entries() {
        assert_eq!(
            detect_document_format(&make_zip(&["[Content_Types].xml", "word/document.xml"])),
            DocumentFormat::Docx
        );
        assert_eq!(
            detect_document_format(&make_zip(&["xl/workbook.xml", "xl/worksheets/sheet1.xml"])),
            DocumentFormat::Xlsx
        );
        assert_eq!(
            detect_document_format(&make_zip(&["ppt/presentation.xml"])),
            DocumentFormat::Pptx
        );
        assert_eq!(
            detect_document_format(&make_zip(&["META-INF/container.xml", "OEBPS/content.opf"])),
            DocumentFormat::Epub
        );
        // A ZIP with none of the known entries is Unknown, not a guess.
        assert_eq!(
            detect_document_format(&make_zip(&["random/file.bin"])),
            DocumentFormat::Unknown
        );
    }

    #[test]
    fn signature_beats_lying_extension() {
        let r = discover_document(b"%PDF-1.7", Some("docx"), None);
        assert_eq!(r.format, DocumentFormat::Pdf);
        assert_eq!(r.method, DetectionMethod::Signature);
        assert_eq!(r.confidence, Confidence::High);
        assert!(r.has_mismatch());
        assert_eq!(r.extension_claim, Some(DocumentFormat::Docx));
    }

    #[test]
    fn csv_is_extension_only_never_signature() {
        // "a,b\n1,2" is valid UTF-8, so it detects as Txt by
        // signature — CSV needs the extension to claim it.
        let r = discover_document(b"a,b\n1,2\n", Some("csv"), None);
        assert_eq!(r.format, DocumentFormat::Txt);
        let r = discover_document(b"\x00\x01\x02", Some("csv"), None);
        assert_eq!(r.format, DocumentFormat::Csv);
        assert_eq!(r.method, DetectionMethod::Extension);
        assert_eq!(r.confidence, Confidence::Low);
    }

    #[test]
    fn unknown_when_nothing_matches() {
        let r = discover_document(b"\x00\x01\x02\x03", Some("xyz"), None);
        assert_eq!(r.format, DocumentFormat::Unknown);
        assert_eq!(r.method, DetectionMethod::None);
    }
}
