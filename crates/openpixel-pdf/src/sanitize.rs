//! PDF sanitisation, inspection and repair (Studio Phase 5).
//!
//! Sanitisation is STRUCTURAL, not a byte filter: the document
//! is parsed, the dangerous objects are removed (JavaScript
//! actions, launch actions, embedded files, additional/auto
//! actions, XFA form data), every reference to a removed object
//! is cleaned out of the surviving objects, and the result is
//! re-parsed and re-inspected before it is returned. If anything
//! dangerous survives, sanitisation fails loudly instead of
//! handing back a file it claims is clean. Nothing is ever
//! executed — JavaScript and embedded files are data to be
//! removed, never run.
//!
//! The Phase 1 byte-scan in `openpixel-security` remains the
//! input-side guard (it sees the raw bytes before parsing); this
//! module is the removal that follows a positive scan.
//!
//! Repair is lopdf's lenient load plus a fresh save: a damaged
//! cross-reference table is rebuilt from scanning the file for
//! indirect objects, and the outcome reports whether the table
//! was read as written, corrected, or reconstructed. A file
//! that does not parse even leniently cannot be repaired —
//! that is an error, not a silent empty document.

use crate::engine::{save_to_bytes, PdfEngine};
use crate::error::{PdfError, Result};
use lopdf::xref::XrefRecovery;
use lopdf::{Dictionary, Document, Object, ObjectId};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// What `inspect_threats` found. Each entry names the object
/// it was found in, so the report is checkable.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PdfThreats {
    pub javascript: Vec<String>,
    pub embedded_files: Vec<String>,
    pub launch_actions: Vec<String>,
    pub auto_actions: Vec<String>,
    pub warnings: Vec<String>,
}

impl PdfThreats {
    pub fn is_clean(&self) -> bool {
        self.javascript.is_empty()
            && self.embedded_files.is_empty()
            && self.launch_actions.is_empty()
            && self.auto_actions.is_empty()
    }
}

/// What `sanitize` removed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SanitizeOutcome {
    pub javascript_removed: u32,
    pub embedded_files_removed: u32,
    pub launch_actions_removed: u32,
    pub auto_actions_removed: u32,
    pub warnings: Vec<String>,
}

/// What `repair` did.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepairOutcome {
    /// How the cross-reference table was read: "as written",
    /// "offset corrected", or "reconstructed".
    pub recovery: String,
    pub warnings: Vec<String>,
}

/// The name of a dictionary value, as a string, when it is one.
fn name_of(dict: &Dictionary, key: &[u8]) -> Option<String> {
    dict.get(key)
        .and_then(|v| v.as_name())
        .map(|n| String::from_utf8_lossy(n).into_owned())
        .ok()
}

/// Detect the threats in a parsed document (shared by
/// `inspect_threats` and by the sanitize post-check).
fn detect_threats(doc: &Document) -> PdfThreats {
    let mut threats = PdfThreats::default();
    // The catalog: /OpenAction and /AA run on open.
    if let Ok(root) = doc.trailer.get(b"Root").and_then(|r| r.as_reference()) {
        if let Ok(catalog) = doc.get_dictionary(root) {
            if let Ok(open) = catalog.get(b"OpenAction").cloned() {
                let kind = action_kind(doc, &open);
                threats.auto_actions.push(format!(
                    "catalog /OpenAction ({kind}) — runs when the document is opened"
                ));
            }
            if catalog.get(b"AA").is_ok() {
                threats
                    .auto_actions
                    .push("catalog /AA — additional actions".to_string());
            }
            if let Ok(Object::Dictionary(names)) = catalog.get(b"Names").cloned() {
                if let Ok(Object::Dictionary(js)) = names.get(b"JavaScript").cloned() {
                    let n = name_tree_count(&js);
                    threats.javascript.push(format!(
                        "catalog /Names /JavaScript name tree ({n} script(s))"
                    ));
                }
                if let Ok(Object::Dictionary(ef)) = names.get(b"EmbeddedFiles").cloned() {
                    let n = name_tree_count(&ef);
                    threats.embedded_files.push(format!(
                        "catalog /Names /EmbeddedFiles name tree ({n} file(s))"
                    ));
                }
            }
            if let Ok(Object::Reference(acro_id)) = catalog.get(b"AcroForm").cloned() {
                if let Ok(acro) = doc.get_dictionary(acro_id) {
                    if acro.get(b"XFA").is_ok() {
                        threats
                            .javascript
                            .push("AcroForm /XFA form data — can carry scripts".to_string());
                    }
                }
            }
        }
    }
    for (id, object) in doc.objects.iter() {
        let Object::Dictionary(dict) = object else {
            continue;
        };
        let label = format!("object {} {}", id.0, id.1);
        match name_of(dict, b"S").as_deref() {
            Some("JavaScript") => {
                threats
                    .javascript
                    .push(format!("{label}: JavaScript action"));
            }
            Some("Launch") => {
                threats
                    .launch_actions
                    .push(format!("{label}: Launch action"));
            }
            _ => {}
        }
        if dict.get(b"JS").is_ok() || dict.get(b"JavaScript").is_ok() {
            threats
                .javascript
                .push(format!("{label}: embedded JavaScript code"));
        }
        if dict.get(b"AA").is_ok() {
            threats
                .auto_actions
                .push(format!("{label}: additional actions (/AA)"));
        }
        if dict.get(b"EF").is_ok() || name_of(dict, b"Type").as_deref() == Some("Filespec") {
            let name = dict
                .get(b"UF")
                .or_else(|_| dict.get(b"F"))
                .and_then(|v| v.as_str())
                .map(|s| String::from_utf8_lossy(s).into_owned())
                .unwrap_or_else(|_| "(unnamed)".to_string());
            threats
                .embedded_files
                .push(format!("{label}: embedded file {name:?}"));
        }
    }
    threats
}

/// How many entries a name tree holds (its /Names array holds
/// name/value pairs).
fn name_tree_count(tree: &Dictionary) -> usize {
    match tree.get(b"Names").and_then(|n| n.as_array()) {
        Ok(items) => items.len() / 2,
        Err(_) => 0,
    }
}

/// The action kind of an action value (a dict, or a reference
/// to one): "JavaScript", "Launch", "GoTo", or "action".
fn action_kind(doc: &Document, value: &Object) -> String {
    let dict = match value {
        Object::Reference(id) => doc.get_dictionary(*id).ok().cloned(),
        Object::Dictionary(d) => Some(d.clone()),
        _ => None,
    };
    dict.and_then(|d| name_of(&d, b"S"))
        .unwrap_or_else(|| "action".to_string())
}

impl PdfEngine {
    /// Inspect a PDF for JavaScript, embedded files, launch
    /// actions and auto actions — without executing anything.
    /// The lists are empty for a clean file.
    pub fn inspect_threats(&self, bytes: &[u8]) -> Result<PdfThreats> {
        self.validate(bytes)?;
        let doc = Document::load_mem(bytes)?;
        Ok(detect_threats(&doc))
    }

    /// Remove JavaScript, launch actions, embedded files,
    /// additional/auto actions and XFA form data from a PDF.
    /// The content, pages and metadata are untouched. The output
    /// is re-parsed and re-inspected: if anything dangerous
    /// survives, this fails instead of returning the file.
    pub fn sanitize(&self, bytes: &[u8]) -> Result<(Vec<u8>, SanitizeOutcome)> {
        self.validate(bytes)?;
        let mut doc = Document::load_mem(bytes)?;
        let mut outcome = SanitizeOutcome {
            javascript_removed: 0,
            embedded_files_removed: 0,
            launch_actions_removed: 0,
            auto_actions_removed: 0,
            warnings: Vec::new(),
        };
        let mut delete: HashSet<ObjectId> = HashSet::new();

        // The catalog first: /OpenAction, /AA, the JavaScript and
        // EmbeddedFiles name trees, XFA. The /OpenAction value is
        // read before any mutable borrow, so its kind can be
        // checked without borrowing the document twice.
        let open_action = doc
            .trailer
            .get(b"Root")
            .and_then(|r| r.as_reference())
            .ok()
            .and_then(|root| {
                doc.get_dictionary(root)
                    .and_then(|c| c.get(b"OpenAction"))
                    .cloned()
                    .ok()
            });
        if let Some(open) = open_action {
            let kind = action_kind(&doc, &open);
            if kind == "JavaScript" || kind == "Launch" {
                if let Ok(root) = doc.trailer.get(b"Root").and_then(|r| r.as_reference()) {
                    if let Ok(catalog) = doc.get_dictionary_mut(root) {
                        catalog.remove(b"OpenAction");
                    }
                }
                outcome.auto_actions_removed += 1;
                outcome
                    .warnings
                    .push(format!("removed catalog /OpenAction ({kind} action)"));
            }
        }
        // The /Names dict and the removed subtrees are objects of
        // their own: removing the keys is not enough — lopdf
        // writes every object in the document, so an orphaned name
        // tree would still leak its file names into the output
        // bytes. Collect their ids first (immutable borrows only),
        // then edit the catalog.
        let names_value = doc
            .trailer
            .get(b"Root")
            .and_then(|r| r.as_reference())
            .ok()
            .and_then(|root| {
                doc.get_dictionary(root)
                    .and_then(|c| c.get(b"Names"))
                    .cloned()
                    .ok()
            });
        // The /Names dict is usually an INDIRECT object (a
        // reference), not an inline dictionary — resolve it first.
        // Removing the keys is not enough: lopdf writes every
        // object in the document, so an orphaned name tree would
        // still leak its file names into the output bytes.
        let (names_dict, names_id): (Option<Dictionary>, Option<ObjectId>) = match &names_value {
            Some(Object::Reference(id)) => (doc.get_dictionary(*id).cloned().ok(), Some(*id)),
            Some(Object::Dictionary(d)) => (Some(d.clone()), None),
            _ => (None, None),
        };
        // A name tree is a node tree (/Kids): collect the whole
        // subtree for deletion, not just the root node.
        if let Some(names) = &names_dict {
            for key in [b"JavaScript".as_slice(), b"EmbeddedFiles".as_slice()] {
                if let Ok(value) = names.get(key).cloned() {
                    if let Ok(sub_id) = value.as_reference() {
                        collect_name_tree_ids(&doc, sub_id, &mut delete);
                    }
                }
            }
        }
        // Edit the name tree itself (short borrows, one at a time).
        let mut names_after: Option<Dictionary> = None;
        if let Some(mut names) = names_dict {
            if let Ok(Object::Dictionary(js)) = names.get(b"JavaScript").cloned() {
                let n = name_tree_count(&js) as u32;
                outcome.javascript_removed += n;
                names.remove(b"JavaScript");
                outcome.warnings.push(format!(
                    "removed /Names /JavaScript name tree ({n} script(s))"
                ));
            }
            if let Ok(Object::Dictionary(ef)) = names.get(b"EmbeddedFiles").cloned() {
                let n = name_tree_count(&ef) as u32;
                outcome.embedded_files_removed += n;
                names.remove(b"EmbeddedFiles");
                outcome.warnings.push(format!(
                    "removed /Names /EmbeddedFiles name tree ({n} file(s))"
                ));
            }
            names_after = Some(names);
        }
        if let Ok(root) = doc.trailer.get(b"Root").and_then(|r| r.as_reference()) {
            if let Ok(catalog) = doc.get_dictionary_mut(root) {
                if catalog.get(b"AA").is_ok() {
                    catalog.remove(b"AA");
                    outcome.auto_actions_removed += 1;
                    outcome
                        .warnings
                        .push("removed catalog /AA (additional actions)".to_string());
                }
                // If the name tree is now empty, drop the /Names
                // key from the catalog and delete the (indirect)
                // name-tree object itself.
                if let Some(names) = &names_after {
                    if names.is_empty() {
                        catalog.remove(b"Names");
                        if let Some(id) = names_id {
                            delete.insert(id);
                        }
                    }
                }
            }
            // A non-empty name tree lives on: write the edited
            // dict back to its object (indirect) or to the catalog
            // (inline).
            if let Some(names) = names_after {
                if !names.is_empty() {
                    match names_id {
                        Some(id) => {
                            if let Ok(d) = doc.get_dictionary_mut(id) {
                                *d = names;
                            }
                        }
                        None => {
                            if let Ok(catalog) = doc.get_dictionary_mut(root) {
                                catalog.set("Names", Object::Dictionary(names));
                            }
                        }
                    }
                }
            }
            // XFA lives in the AcroForm.
            if let Ok(acro_id) = doc
                .get_dictionary(root)
                .and_then(|c| c.get(b"AcroForm"))
                .and_then(|a| a.as_reference())
            {
                if let Ok(acro) = doc.get_dictionary_mut(acro_id) {
                    if acro.get(b"XFA").is_ok() {
                        acro.remove(b"XFA");
                        outcome.javascript_removed += 1;
                        outcome.warnings.push(
                            "removed AcroForm /XFA form data (it can carry scripts)".to_string(),
                        );
                    }
                }
            }
        }

        // Every object: action dicts and file specs are deleted;
        // /AA, /JS and /JavaScript keys are stripped from the
        // dicts that survive.
        let ids: Vec<ObjectId> = doc.objects.keys().copied().collect();
        for id in ids {
            let Object::Dictionary(dict) = doc.objects.get(&id).cloned().unwrap_or(Object::Null)
            else {
                continue;
            };
            match name_of(&dict, b"S").as_deref() {
                Some("JavaScript") => {
                    delete.insert(id);
                    outcome.javascript_removed += 1;
                    continue;
                }
                Some("Launch") => {
                    delete.insert(id);
                    outcome.launch_actions_removed += 1;
                    continue;
                }
                _ => {}
            }
            if dict.get(b"EF").is_ok() || name_of(&dict, b"Type").as_deref() == Some("Filespec") {
                // The embedded file streams go with the spec.
                if let Ok(Object::Dictionary(ef)) = dict.get(b"EF").cloned() {
                    for (_, v) in ef.iter() {
                        if let Ok(stream_id) = v.as_reference() {
                            delete.insert(stream_id);
                        }
                    }
                }
                delete.insert(id);
                outcome.embedded_files_removed += 1;
                continue;
            }
            // A surviving dict: strip the dangerous keys.
            let mut changed = false;
            let mut dict = dict;
            if dict.get(b"AA").is_ok() {
                dict.remove(b"AA");
                outcome.auto_actions_removed += 1;
                changed = true;
            }
            for key in [b"JS".as_slice(), b"JavaScript".as_slice()] {
                if let Ok(value) = dict.get(key).cloned() {
                    if let Ok(stream_id) = value.as_reference() {
                        delete.insert(stream_id);
                    }
                    dict.remove(key);
                    outcome.javascript_removed += 1;
                    changed = true;
                }
            }
            if changed {
                doc.set_object(id, Object::Dictionary(dict));
            }
        }

        // Delete the collected objects, then sweep every
        // surviving object for references to them (no dangling
        // references in the output).
        for id in &delete {
            doc.objects.remove(id);
        }
        sweep_deleted(&mut doc, &delete);
        // The catalog /OpenAction may have pointed at a deleted
        // action dict — remove it now that the sweep knows.
        if let Ok(root) = doc.trailer.get(b"Root").and_then(|r| r.as_reference()) {
            if let Ok(catalog) = doc.get_dictionary_mut(root) {
                if let Ok(open) = catalog.get(b"OpenAction").cloned() {
                    if let Ok(id) = open.as_reference() {
                        if delete.contains(&id) {
                            catalog.remove(b"OpenAction");
                            outcome.auto_actions_removed += 1;
                            outcome.warnings.push(
                                "removed catalog /OpenAction (it pointed at a removed action)"
                                    .to_string(),
                            );
                        }
                    }
                }
            }
        }
        let out = save_to_bytes(&mut doc)?;
        // Post-check: the output must parse AND be clean. If
        // anything dangerous survived, this is an error — not a
        // file claimed clean.
        let check = Document::load_mem(&out)
            .map_err(|e| PdfError::Lopdf(format!("sanitised PDF does not parse again: {e}")))?;
        let remaining = detect_threats(&check);
        if !remaining.is_clean() {
            return Err(PdfError::Lopdf(format!(
                "sanitisation failed its own check — still present: {:?} {:?} {:?} {:?}",
                remaining.javascript,
                remaining.embedded_files,
                remaining.launch_actions,
                remaining.auto_actions
            )));
        }
        Ok((out, outcome))
    }

    /// Repair a damaged PDF: load it leniently (lopdf rebuilds
    /// a broken cross-reference table from scanning the file)
    /// and save it fresh. The outcome reports how the
    /// cross-reference table was read. A file that does not
    /// parse even leniently cannot be repaired.
    pub fn repair(&self, bytes: &[u8]) -> Result<(Vec<u8>, RepairOutcome)> {
        let mut doc = Document::load_mem(bytes).map_err(|e| {
            PdfError::InvalidPdf(format!(
                "could not be repaired — the file does not parse even leniently: {e}"
            ))
        })?;
        let recovery = match doc.xref_recovery {
            Some(XrefRecovery::OffsetCorrected) => "offset corrected",
            Some(XrefRecovery::Reconstructed) => "reconstructed",
            // XrefRecovery is non-exhaustive: a future lopdf may
            // add a variant, and it still means "recovered".
            Some(_) => "recovered",
            None => "as written",
        };
        let mut warnings = Vec::new();
        if recovery != "as written" {
            warnings.push(format!(
                "the cross-reference table was {recovery} — the file was damaged"
            ));
        } else {
            warnings.push(
                "no repair was needed — the cross-reference table read as written".to_string(),
            );
        }
        let out = save_to_bytes(&mut doc)?;
        Document::load_mem(&out)
            .map_err(|e| PdfError::Lopdf(format!("repaired PDF does not parse again: {e}")))?;
        Ok((
            out,
            RepairOutcome {
                recovery: recovery.to_string(),
                warnings,
            },
        ))
    }
}

/// Collect a name-tree node plus its /Kids recursively (for
/// deletion — a name tree is a node tree, and deleting only the
/// root would leave the child nodes as orphans in the output).
fn collect_name_tree_ids(doc: &Document, id: ObjectId, out: &mut HashSet<ObjectId>) {
    if !out.insert(id) {
        return;
    }
    if let Ok(d) = doc.get_dictionary(id) {
        if let Ok(Object::Array(kids)) = d.get(b"Kids").cloned() {
            for kid in kids {
                if let Ok(kid_id) = kid.as_reference() {
                    collect_name_tree_ids(doc, kid_id, out);
                }
            }
        }
    }
}

/// Remove references to deleted objects from every surviving
/// object (dictionaries, arrays, and the trailer), recursively.
fn sweep_deleted(doc: &mut Document, delete: &HashSet<ObjectId>) {
    if delete.is_empty() {
        return;
    }
    let ids: Vec<ObjectId> = doc.objects.keys().copied().collect();
    for id in ids {
        if let Some(object) = doc.objects.get(&id).cloned() {
            if let Some(cleaned) = clean_object(object, delete) {
                doc.set_object(id, cleaned);
            } else {
                doc.objects.remove(&id);
            }
        }
    }
    if let Some(Object::Dictionary(d)) =
        clean_object(Object::Dictionary(doc.trailer.clone()), delete)
    {
        doc.trailer = d;
    }
}

/// Clean one object: returns None when the object itself is a
/// reference to a deleted object (the caller drops it), or the
/// object with deleted references removed from inside it.
fn clean_object(object: Object, delete: &HashSet<ObjectId>) -> Option<Object> {
    match object {
        Object::Reference(id) => {
            if delete.contains(&id) {
                None
            } else {
                Some(Object::Reference(id))
            }
        }
        Object::Array(items) => {
            let kept: Vec<Object> = items
                .into_iter()
                .filter_map(|item| clean_object(item, delete))
                .collect();
            Some(Object::Array(kept))
        }
        Object::Dictionary(mut dict) => {
            let keys: Vec<Vec<u8>> = dict.iter().map(|(k, _)| k.clone()).collect();
            for key in keys {
                if let Ok(value) = dict.get(&key).cloned() {
                    if let Some(cleaned) = clean_object(value, delete) {
                        dict.set(key, cleaned);
                    } else {
                        dict.remove(&key);
                    }
                }
            }
            Some(Object::Dictionary(dict))
        }
        other => Some(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::ordered_pages;
    use crate::engine::tests::{contains_bytes, make_pdf};

    /// A PDF with a JavaScript action on open, a Launch action
    /// on a page, and an embedded file — the malicious fixture
    /// for sanitisation. Nothing here is executed: the actions
    /// are data in dictionaries.
    fn make_malicious_pdf() -> Vec<u8> {
        let mut doc = Document::load_mem(&make_pdf(1, "Doc")).unwrap();
        let pages = ordered_pages(&doc);
        let page_id = pages[0].1;
        // A JavaScript action (open action).
        let js_id = doc.add_object(lopdf::Dictionary::from_iter([
            (b"S".to_vec(), Object::Name(b"JavaScript".to_vec())),
            (
                b"JS".to_vec(),
                Object::String(b"app.alert(1)".to_vec(), lopdf::StringFormat::Literal),
            ),
        ]));
        // A Launch action, as the page's /AA (open action).
        let launch_id = doc.add_object(lopdf::Dictionary::from_iter([
            (b"S".to_vec(), Object::Name(b"Launch".to_vec())),
            (
                b"F".to_vec(),
                Object::String(b"evil.exe".to_vec(), lopdf::StringFormat::Literal),
            ),
        ]));
        doc.get_dictionary_mut(page_id).unwrap().set(
            "AA",
            lopdf::Dictionary::from_iter([(b"O".to_vec(), Object::Reference(launch_id))]),
        );
        // An embedded file.
        let stream_id = doc.add_object(lopdf::Stream::new(
            lopdf::Dictionary::new(),
            b"payload".to_vec(),
        ));
        let spec_id = doc.add_object(lopdf::Dictionary::from_iter([
            (b"Type".to_vec(), Object::Name(b"Filespec".to_vec())),
            (
                b"F".to_vec(),
                Object::String(b"evil.txt".to_vec(), lopdf::StringFormat::Literal),
            ),
            (
                b"EF".to_vec(),
                Object::Dictionary(lopdf::Dictionary::from_iter([(
                    b"F".to_vec(),
                    Object::Reference(stream_id),
                )])),
            ),
        ]));
        let root = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        let names_id = doc.add_object(lopdf::Dictionary::from_iter([(
            b"EmbeddedFiles".to_vec(),
            Object::Dictionary(lopdf::Dictionary::from_iter([(
                b"Names".to_vec(),
                Object::Array(vec![
                    Object::String(b"evil.txt".to_vec(), lopdf::StringFormat::Literal),
                    Object::Reference(spec_id),
                ]),
            )])),
        )]));
        doc.get_dictionary_mut(root)
            .unwrap()
            .set("OpenAction", Object::Reference(js_id));
        doc.get_dictionary_mut(root)
            .unwrap()
            .set("Names", Object::Reference(names_id));
        let mut out = Vec::new();
        doc.save_to(&mut std::io::Cursor::new(&mut out)).unwrap();
        out
    }

    #[test]
    fn inspect_finds_the_threats() {
        let engine = PdfEngine::default();
        let threats = engine.inspect_threats(&make_malicious_pdf()).unwrap();
        assert!(!threats.is_clean());
        assert!(!threats.javascript.is_empty(), "JS not found");
        assert!(
            !threats.embedded_files.is_empty(),
            "embedded file not found"
        );
        assert!(
            !threats.launch_actions.is_empty(),
            "launch action not found"
        );
        assert!(!threats.auto_actions.is_empty(), "auto actions not found");
        let clean = engine.inspect_threats(&make_pdf(1, "Doc")).unwrap();
        assert!(clean.is_clean());
    }

    #[test]
    fn sanitize_removes_everything_and_keeps_the_document() {
        let engine = PdfEngine::default();
        let input = make_malicious_pdf();
        let (out, outcome) = engine.sanitize(&input).unwrap();
        assert!(outcome.javascript_removed >= 1);
        assert!(outcome.embedded_files_removed >= 1);
        assert!(outcome.launch_actions_removed >= 1);
        assert!(outcome.auto_actions_removed >= 1);
        // The file still parses, keeps its page and its text.
        assert_eq!(engine.inspect(&out).unwrap().page_count, 1);
        assert!(contains_bytes(&out, b"Doc page 1"));
        // Byte proof: the dangerous markers are gone from the
        // file bytes entirely.
        assert!(!contains_bytes(&out, b"/JavaScript"), "JS marker leaked");
        assert!(!contains_bytes(&out, b"/Launch"), "Launch marker leaked");
        assert!(
            !contains_bytes(&out, b"/EmbeddedFiles"),
            "EmbeddedFiles marker leaked"
        );
        assert!(!contains_bytes(&out, b"app.alert"), "JS code leaked");
        assert!(
            !contains_bytes(&out, b"evil.txt"),
            "embedded file name leaked"
        );
        assert!(!contains_bytes(&out, b"evil.exe"), "launch target leaked");
        // And the structural inspection agrees.
        assert!(engine.inspect_threats(&out).unwrap().is_clean());
    }

    #[test]
    fn sanitize_is_idempotent() {
        let engine = PdfEngine::default();
        let (out, _) = engine.sanitize(&make_malicious_pdf()).unwrap();
        let (out2, outcome2) = engine.sanitize(&out).unwrap();
        assert_eq!(outcome2.javascript_removed, 0);
        assert_eq!(outcome2.embedded_files_removed, 0);
        assert_eq!(outcome2.launch_actions_removed, 0);
        assert_eq!(outcome2.auto_actions_removed, 0);
        assert_eq!(engine.inspect(&out2).unwrap().page_count, 1);
    }

    #[test]
    fn repair_rebuilds_a_broken_xref() {
        let engine = PdfEngine::default();
        let mut input = make_pdf(1, "Doc");
        // Corrupt the startxref offset (same length, wrong value)
        // — the cross-reference table can no longer be found
        // where the trailer says it is.
        let marker = b"startxref";
        let pos = input
            .windows(marker.len())
            .position(|w| w == marker)
            .unwrap();
        let num_start = pos + marker.len();
        let mut i = num_start;
        while i < input.len() && (input[i] == b'\n' || input[i] == b'\r' || input[i] == b' ') {
            i += 1;
        }
        let num_end = i + input[i..].iter().take_while(|b| b.is_ascii_digit()).count();
        assert!(num_end > i, "no startxref number found");
        for b in &mut input[i..num_end] {
            *b = b'0';
        }
        let (out, outcome) = engine.repair(&input).unwrap();
        assert_ne!(outcome.recovery, "as written", "damage was not detected");
        assert_eq!(engine.inspect(&out).unwrap().page_count, 1);
        assert!(contains_bytes(&out, b"Doc page 1"));
    }

    #[test]
    fn repair_of_a_healthy_file_reports_as_written() {
        let engine = PdfEngine::default();
        let (out, outcome) = engine.repair(&make_pdf(1, "Doc")).unwrap();
        assert_eq!(outcome.recovery, "as written");
        assert_eq!(engine.inspect(&out).unwrap().page_count, 1);
    }

    #[test]
    fn garbage_bytes_are_rejected_not_panicked() {
        let engine = PdfEngine::default();
        assert!(engine.inspect_threats(b"not a pdf at all").is_err());
        assert!(engine.sanitize(b"not a pdf at all").is_err());
        assert!(engine.repair(b"not a pdf at all").is_err());
        assert!(engine.repair(b"").is_err());
        // A truncated PDF must not panic either.
        let mut input = make_pdf(1, "Doc");
        input.truncate(input.len() / 2);
        let _ = engine.repair(&input);
    }

    #[test]
    fn zip_bomb_stream_is_refused_by_the_size_limit() {
        // A content stream that decompresses to more than lopdf's
        // 256 MiB limit: 300 MiB of zeros compresses to ~300 KiB,
        // so the file is small but the decompressed form is not.
        // Decompressing it must fail cleanly — never allocate the
        // 300 MiB or hang.
        use flate2::{write::ZlibEncoder, Compression};
        use std::io::Write;
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
        let zeros = vec![0u8; 1024 * 1024];
        for _ in 0..300 {
            encoder.write_all(&zeros).unwrap();
        }
        let compressed = encoder.finish().unwrap();
        let mut doc = Document::load_mem(&make_pdf(1, "Doc")).unwrap();
        let stream_id = doc.add_object(lopdf::Stream::new(
            lopdf::Dictionary::from_iter([(
                b"Filter".to_vec(),
                Object::Name(b"FlateDecode".to_vec()),
            )]),
            compressed,
        ));
        let stream = doc.get_object(stream_id).unwrap().as_stream().unwrap();
        // The bounded decode — the one untrusted input must go
        // through — refuses the stream instead of allocating
        // 300 MiB. (The unbounded `decompressed_content()` is
        // documented as unsafe for untrusted input and is never
        // called on it by this crate's engine paths.)
        let result = stream.decompressed_content_with_limit(lopdf::DEFAULT_MAX_DECOMPRESSED_SIZE);
        assert!(
            result.is_err(),
            "the oversized stream decompressed without a limit error"
        );
    }
}
