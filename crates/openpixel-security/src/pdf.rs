//! PDF sanitisation — byte-level scan (Phase 1 first line of defence).
//!
//! PDFs can carry JavaScript, launch actions and embedded files.
//! Nothing in this codebase ever executes embedded PDF JavaScript
//! — there is no JS engine in the processing path — but a file that
//! *contains* it must be identified before it is handed to any
//! other tool (a renderer, an Office converter, a viewer), and a
//! caller that asked for strict handling must get a refusal, not
//! a silent pass.
//!
//! What this scan is and is not:
//! * It looks for the canonical PDF name spellings readers execute
//!   (`/JavaScript`, `/JS`, `/AA`, `/OpenAction`, `/Launch`,
//!   `/EmbeddedFiles`, `/Filespec`). PDF names are case-sensitive,
//!   so only the canonical spellings are matched.
//! * It CANNOT see inside compressed content streams or object
//!   streams — a marker hidden there is invisible to a byte scan.
//!   Structural inspection (walking the lopdf object tree, which
//!   decompresses object streams) is the stronger check and lands
//!   in Phase 5. Until then, treat a clean scan as "no marker
//!   found", never as "proven safe".

use crate::error::SecurityError;

/// What the byte scan found in a PDF.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PdfSanitisationReport {
    /// `/JavaScript` or `/JS` action present.
    pub has_javascript: bool,
    /// `/EmbeddedFiles` or `/Filespec` present.
    pub has_embedded_files: bool,
    /// `/Launch` action present (can start another program).
    pub has_launch_actions: bool,
    /// `/AA` (additional actions) or `/OpenAction` (runs on open).
    pub has_auto_actions: bool,
    /// Every matched marker, in scan order, for logging.
    pub markers: Vec<String>,
}

impl PdfSanitisationReport {
    /// True when nothing suspicious was found.
    pub fn is_clean(&self) -> bool {
        self.markers.is_empty()
    }
}

/// What a caller allows in a PDF. The default denies everything
/// executable or launchable and allows embedded files only when
/// the caller explicitly opts in (they are inert data, but they
/// can hide anything — including another PDF).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PdfSanitisationPolicy {
    pub allow_javascript: bool,
    pub allow_embedded_files: bool,
    pub allow_launch_actions: bool,
    pub allow_auto_actions: bool,
}

impl PdfSanitisationPolicy {
    /// Allow everything (only for a caller that inspects the file
    /// itself, e.g. a security audit tool — never for processing).
    pub fn permissive() -> Self {
        Self {
            allow_javascript: true,
            allow_embedded_files: true,
            allow_launch_actions: true,
            allow_auto_actions: true,
        }
    }
}

/// Scan PDF bytes for dangerous markers. Never fails — a file that
/// is not a PDF at all simply reports no markers.
pub fn scan_pdf_bytes(bytes: &[u8]) -> PdfSanitisationReport {
    let mut report = PdfSanitisationReport::default();
    // `/JavaScript` first: it also starts with `/JS`, so check it
    // before the shorter pattern to avoid double-counting.
    if contains_name(bytes, b"/JavaScript") {
        report.has_javascript = true;
        report.markers.push("/JavaScript".to_string());
    }
    if !report.has_javascript && contains_name(bytes, b"/JS") {
        report.has_javascript = true;
        report.markers.push("/JS".to_string());
    }
    if contains_name(bytes, b"/EmbeddedFiles") || contains_name(bytes, b"/Filespec") {
        report.has_embedded_files = true;
        report.markers.push("/EmbeddedFiles".to_string());
    }
    if contains_name(bytes, b"/Launch") {
        report.has_launch_actions = true;
        report.markers.push("/Launch".to_string());
    }
    if contains_name(bytes, b"/AA") || contains_name(bytes, b"/OpenAction") {
        report.has_auto_actions = true;
        report.markers.push("/OpenAction/AA".to_string());
    }
    report
}

/// Scan and enforce a policy: returns the report when the file is
/// allowed, or [`SecurityError::PdfDenied`] naming the first denied
/// marker when it is not.
pub fn check_pdf_bytes(
    bytes: &[u8],
    policy: &PdfSanitisationPolicy,
) -> Result<PdfSanitisationReport, SecurityError> {
    let report = scan_pdf_bytes(bytes);
    if report.has_javascript && !policy.allow_javascript {
        return Err(SecurityError::PdfDenied(
            "PDF contains JavaScript (/JavaScript or /JS)".to_string(),
        ));
    }
    if report.has_launch_actions && !policy.allow_launch_actions {
        return Err(SecurityError::PdfDenied(
            "PDF contains a launch action (/Launch)".to_string(),
        ));
    }
    if report.has_auto_actions && !policy.allow_auto_actions {
        return Err(SecurityError::PdfDenied(
            "PDF contains an auto-run action (/AA or /OpenAction)".to_string(),
        ));
    }
    if report.has_embedded_files && !policy.allow_embedded_files {
        return Err(SecurityError::PdfDenied(
            "PDF contains embedded files (/EmbeddedFiles)".to_string(),
        ));
    }
    Ok(report)
}

/// True when `name` appears as a PDF name object: the bytes match
/// and the next byte is a PDF delimiter (whitespace, `/`, `>`,
/// `[`, `<`, `(` or end of input) — so `/JSX` or `/JSon` do not
/// match `/JS`.
fn contains_name(haystack: &[u8], name: &[u8]) -> bool {
    if haystack.len() < name.len() {
        return false;
    }
    for i in 0..=(haystack.len() - name.len()) {
        if &haystack[i..i + name.len()] != name {
            continue;
        }
        let delimited = match haystack.get(i + name.len()) {
            None => true,
            Some(b) => matches!(
                b,
                b' ' | b'\t' | b'\n' | b'\r' | 0x0C | b'/' | b'>' | b'[' | b'<' | b'(' | 0
            ),
        };
        if delimited {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_pdf_scans_clean() {
        let pdf = b"%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n";
        let report = scan_pdf_bytes(pdf);
        assert!(report.is_clean());
        assert!(check_pdf_bytes(pdf, &PdfSanitisationPolicy::default()).is_ok());
    }

    #[test]
    fn javascript_and_openaction_are_found_and_denied() {
        let pdf = b"%PDF-1.7\n<< /Type /Catalog /OpenAction 5 0 R >>\n<< /S /JavaScript /JS (app.alert('x')) >>\n";
        let report = scan_pdf_bytes(pdf);
        assert!(report.has_javascript);
        assert!(report.has_auto_actions);
        assert!(!report.has_embedded_files);
        let err = check_pdf_bytes(pdf, &PdfSanitisationPolicy::default()).unwrap_err();
        assert!(matches!(err, SecurityError::PdfDenied(_)));
        // A permissive policy lets it through (the caller owns the risk).
        assert!(check_pdf_bytes(pdf, &PdfSanitisationPolicy::permissive()).is_ok());
    }

    #[test]
    fn embedded_files_and_launch_are_found() {
        let pdf = b"<< /EmbeddedFiles 3 0 R >>\n<< /S /Launch /Win << /F (cmd.exe) >> >>\n";
        let report = scan_pdf_bytes(pdf);
        assert!(report.has_embedded_files);
        assert!(report.has_launch_actions);
        assert!(!report.has_javascript);
    }

    #[test]
    fn similar_names_do_not_false_positive() {
        // /JSX and /JSON are not /JS; /Launchpad is not /Launch.
        let pdf = b"<< /JSX 1 0 R /JSON (x) /Launchpad 2 0 R >>\n";
        let report = scan_pdf_bytes(pdf);
        assert!(report.is_clean(), "markers: {:?}", report.markers);
    }
}
