//! PDF security (Studio Phase 3): password protection, unlock
//! and text watermarks — all with lopdf, no new dependency.
//!
//! **Encryption, stated plainly:** protection uses the standard
//! security handler, revision 3, **RC4 with a 128-bit key**
//! (`EncryptionVersion::V2`, key_length 128). That is the
//! strongest handler lopdf 0.47 can *create* — AES-256 (V5)
//! needs a precomputed file encryption key that lopdf does not
//! expose for document creation, and V4 needs caller-supplied
//! crypt filters. RC4-128 is readable by every PDF viewer, but
//! RC4 is a legacy cipher: this protects against casual opening,
//! not against a determined attacker. That limitation is in
//! `docs/PDF.md`, not hidden behind the word "encrypted".
//!
//! **Watermarks** overlay text on every page (a new content
//! stream + a standard Helvetica font + an ExtGState for the
//! opacity). They are visible, not structural: a watermark does
//! not stop anyone copying the underlying text, and it is not a
//! redaction (real redaction is Phase 5).

use crate::engine::PdfEngine;
use crate::error::{PdfError, Result};
use lopdf::encryption::{EncryptionState, EncryptionVersion, Permissions};
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};

/// Which operations a protected PDF allows. All three default to
/// allowed; the CLI clears the ones the user disables.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfPermissions {
    pub print: bool,
    pub copy: bool,
    pub modify: bool,
}

impl Default for PdfPermissions {
    fn default() -> Self {
        Self {
            print: true,
            copy: true,
            modify: true,
        }
    }
}

impl PdfPermissions {
    fn to_lopdf(self) -> Permissions {
        let mut p = Permissions::empty();
        if self.print {
            p |= Permissions::PRINTABLE | Permissions::PRINTABLE_IN_HIGH_QUALITY;
        }
        if self.copy {
            p |= Permissions::COPYABLE | Permissions::COPYABLE_FOR_ACCESSIBILITY;
        }
        if self.modify {
            p |= Permissions::MODIFIABLE | Permissions::ANNOTABLE | Permissions::ASSEMBLABLE;
        }
        p
    }
}

/// Options for [`PdfEngine::watermark`].
#[derive(Debug, Clone)]
pub struct WatermarkOptions {
    /// Font size in points.
    pub font_size: f64,
    /// Text opacity 0.0..=1.0.
    pub opacity: f32,
    /// Rotation in degrees, counter-clockwise.
    pub angle_degrees: f64,
    /// Grey level 0.0 (black) ..= 1.0 (white).
    pub grey: f64,
}

impl Default for WatermarkOptions {
    fn default() -> Self {
        Self {
            font_size: 48.0,
            opacity: 0.25,
            angle_degrees: 45.0,
            grey: 0.5,
        }
    }
}

impl PdfEngine {
    /// Password-protect a PDF (RC4 128-bit, revision 3 — see the
    /// module docs for why not AES-256). `user_password` opens
    /// the document; `owner_password` (empty = same as user)
    /// unlocks full permissions. Both empty is an error.
    /// The output is encrypted: `validate` and every content
    /// operation refuse it until it is unlocked with
    /// [`PdfEngine::unlock`]. `inspect` still reports it
    /// (encrypted: yes, with algorithm/permissions) — see
    /// [`PdfEngine::inspect`].
    pub fn protect(
        &self,
        bytes: &[u8],
        user_password: &str,
        owner_password: &str,
        permissions: PdfPermissions,
    ) -> Result<Vec<u8>> {
        if user_password.is_empty() && owner_password.is_empty() {
            return Err(PdfError::InvalidPdf(
                "protect needs at least one password".to_string(),
            ));
        }
        self.validate(bytes)?;
        let mut doc = Document::load_mem(bytes)?;
        if doc.is_encrypted() {
            return Err(PdfError::InvalidPdf(
                "PDF is already encrypted — unlock it first".to_string(),
            ));
        }
        // The R4 key derivation (Algorithm 5) mixes in the first
        // trailer /ID element; documents without one (lopdf-built
        // fixtures, some producers) cannot be encrypted at all.
        // Give the document an ID first — two 16-byte hex strings
        // derived from the clock and the object count. An ID is
        // an identifier, not a secret.
        ensure_file_id(&mut doc);
        let owner = if owner_password.is_empty() {
            user_password
        } else {
            owner_password
        };
        let state = EncryptionState::try_from(EncryptionVersion::V2 {
            document: &doc,
            owner_password: owner,
            user_password,
            key_length: 128,
            permissions: permissions.to_lopdf(),
        })
        .map_err(|e| PdfError::Lopdf(format!("could not build encryption state: {e}")))?;
        doc.encrypt(&state)?;
        let mut out = Vec::new();
        doc.save_to(&mut std::io::Cursor::new(&mut out))?;
        // Prove the output is really encrypted before returning it.
        let check = Document::load_mem(&out)?;
        if !check.is_encrypted() {
            return Err(PdfError::Lopdf(
                "protect produced a file that does not report as encrypted".to_string(),
            ));
        }
        Ok(out)
    }

    /// Remove password protection (password supplied by the
    /// owner — this is the legal path only). Wrong password and
    /// unencrypted input are both clean errors.
    pub fn unlock(&self, bytes: &[u8], password: &str) -> Result<Vec<u8>> {
        // First a password-less load, only to tell whether the
        // file is encrypted at all: a password load strips the
        // /Encrypt marker from the trailer, so it cannot be used
        // for that check. (For an encrypted file this load only
        // holds the /Encrypt dictionary — cheap.)
        let probe = Document::load_mem(bytes)
            .map_err(|e| PdfError::InvalidPdf(format!("lopdf could not parse the PDF: {e}")))?;
        if !probe.is_encrypted() {
            return Err(PdfError::InvalidPdf(
                "PDF is not encrypted — nothing to unlock".to_string(),
            ));
        }
        drop(probe);
        // Load WITH the password: that is the only way lopdf
        // decrypts objects on load. A password-less load of an
        // encrypted file leaves `objects` holding only the
        // /Encrypt dictionary, and `Document::decrypt` after that
        // would save an (almost) empty file. The objects are
        // already decrypted by the load, so the only remaining
        // step is to drop the /Encrypt trailer entry and its
        // dictionary object if they survived — re-decrypting
        // would corrupt them, because RC4 is symmetric.
        let mut doc =
            Document::load_mem_with_options(bytes, lopdf::LoadOptions::with_password(password))
                .map_err(|e| match e {
                    lopdf::Error::InvalidPassword => {
                        PdfError::InvalidPdf("unlock failed — wrong password".to_string())
                    }
                    other => {
                        PdfError::InvalidPdf(format!("lopdf could not parse the PDF: {other}"))
                    }
                })?;
        let enc_ref = doc
            .trailer
            .get(b"Encrypt")
            .ok()
            .and_then(|o| o.as_reference().ok());
        doc.trailer.remove(b"Encrypt");
        if let Some(id) = enc_ref {
            doc.objects.remove(&id);
        }
        let mut out = Vec::new();
        doc.save_to(&mut std::io::Cursor::new(&mut out))?;
        let check = Document::load_mem(&out)?;
        if check.is_encrypted() || check.get_pages().is_empty() {
            return Err(PdfError::InvalidPdf(
                "unlock produced an unreadable document".to_string(),
            ));
        }
        Ok(out)
    }

    /// Overlay `text` diagonally on every page. The text is
    /// drawn with the standard Helvetica font (no embedding) in
    /// the requested grey at the requested opacity. Non-ASCII
    /// characters are replaced with `?` — Helvetica/WinAnsi
    /// cannot render them, and a silent mojibake would be worse.
    pub fn watermark(
        &self,
        bytes: &[u8],
        text: &str,
        options: WatermarkOptions,
    ) -> Result<Vec<u8>> {
        if text.trim().is_empty() {
            return Err(PdfError::InvalidPdf(
                "watermark text must not be empty".to_string(),
            ));
        }
        if !(0.0..=1.0).contains(&options.opacity) {
            return Err(PdfError::InvalidPdf(format!(
                "watermark opacity must be 0.0..=1.0, not {}",
                options.opacity
            )));
        }
        if options.font_size <= 0.0 || options.font_size > 200.0 {
            return Err(PdfError::InvalidPdf(format!(
                "watermark font size must be 0..=200 pt, not {}",
                options.font_size
            )));
        }
        self.validate(bytes)?;
        let mut doc = Document::load_mem(bytes)?;
        let safe: String = text
            .chars()
            .map(|c| if c.is_ascii() { c } else { '?' })
            .collect();
        let escaped = safe
            .replace('\\', "\\\\")
            .replace('(', "\\(")
            .replace(')', "\\)");
        // One font + one graphics state, shared by every page.
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
            "Encoding" => "WinAnsiEncoding",
        });
        let gs_id = doc.add_object(dictionary! {
            "Type" => "ExtGState",
            "ca" => Object::Real(options.opacity),
            "CA" => Object::Real(options.opacity),
        });
        let page_count = doc.get_pages().len() as u32;
        for n in 1..=page_count {
            let page_id = doc.get_pages()[&n];
            let (w, h) = crate::engine::page_box(&doc, page_id);
            let angle = options.angle_degrees.to_radians();
            let (cos, sin) = (angle.cos(), angle.sin());
            // Centre the text roughly: Helvetica averages ~0.5em
            // per character, so the string is about that wide.
            let text_w = options.font_size * 0.5 * safe.chars().count() as f64;
            let cx = w / 2.0 - (text_w / 2.0) * cos;
            let cy = h / 2.0 - (text_w / 2.0) * sin;
            let content = format!(
                "q /GS0 gs BT /F0 {} Tf {} g {} {} {} {} {} {} Tm ({}) Tj ET Q",
                options.font_size, options.grey, cos, sin, -sin, cos, cx, cy, escaped
            );
            let content_id = doc.add_object(Stream::new(Dictionary::new(), content.into_bytes()));
            // Append the stream to the page's /Contents.
            let contents = doc
                .get_dictionary(page_id)
                .and_then(|d| d.get(b"Contents"))
                .cloned();
            match contents {
                Ok(Object::Reference(id)) => {
                    doc.get_dictionary_mut(page_id)?.set(
                        "Contents",
                        Object::Array(vec![Object::Reference(id), Object::Reference(content_id)]),
                    );
                }
                Ok(Object::Array(mut items)) => {
                    items.push(Object::Reference(content_id));
                    doc.get_dictionary_mut(page_id)?
                        .set("Contents", Object::Array(items));
                }
                _ => {
                    doc.get_dictionary_mut(page_id)?
                        .set("Contents", Object::Reference(content_id));
                }
            }
            // Add the font + graphics state to the page's
            // Resources (mutating the shared dict in place when
            // the page inherits one — the entries are the same
            // for every page, so sharing is correct).
            add_resource(&mut doc, page_id, b"Font", "F0", font_id)?;
            add_resource(&mut doc, page_id, b"ExtGState", "GS0", gs_id)?;
        }
        let mut out = Vec::new();
        doc.save_to(&mut std::io::Cursor::new(&mut out))?;
        Ok(out)
    }
}

/// Give a document a trailer `/ID` when it has none (two 16-byte
/// hex strings). The R4 encryption key derivation needs the first
/// element; without it `EncryptionState::try_from` fails.
fn ensure_file_id(doc: &mut Document) {
    if doc.trailer.get(b"ID").is_ok() {
        return;
    }
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
        ^ (doc.objects.len() as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    let mut x = seed | 1;
    // xorshift64 — good enough for an identifier, not a secret.
    let mut next = move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    };
    let hex = |n: u64| format!("{n:016x}");
    let id1 = hex(next());
    let id2 = hex(next());
    doc.trailer.set(
        "ID",
        Object::Array(vec![
            Object::String(id1.into_bytes(), lopdf::StringFormat::Hexadecimal),
            Object::String(id2.into_bytes(), lopdf::StringFormat::Hexadecimal),
        ]),
    );
}

/// Add `name → id` to the page's Resources `category` dict
/// (`Font` or `ExtGState`), creating the dicts when missing.
/// Works on the page's own Resources or the inherited one. The
/// reads and the writes are separate phases: lopdf borrows the
/// whole document for a mutable dictionary, so nothing may be
/// borrowed while another dictionary is being written.
fn add_resource(
    doc: &mut Document,
    page_id: ObjectId,
    category: &[u8],
    name: &str,
    id: ObjectId,
) -> Result<()> {
    // Phase 1 (reads only): resolve the Resources object id,
    // materialising it as its own object when the page carries an
    // inline dict or inherits one.
    let resources_id = match doc
        .get_dictionary(page_id)
        .and_then(|d| d.get(b"Resources"))
    {
        Ok(Object::Reference(rid)) => *rid,
        _ => {
            let inherited = crate::engine::inherited_attribute(doc, page_id, b"Resources");
            let dict = match inherited {
                Some(Object::Dictionary(d)) => d,
                Some(Object::Reference(rid)) => {
                    doc.get_dictionary(rid).cloned().unwrap_or_default()
                }
                _ => Dictionary::new(),
            };
            let new_id = doc.add_object(Object::Dictionary(dict));
            doc.get_dictionary_mut(page_id)?
                .set("Resources", Object::Reference(new_id));
            new_id
        }
    };
    // Phase 2 (reads only): the current category dict, cloned.
    let (cat_id, mut category_dict) = match doc
        .get_dictionary(resources_id)
        .and_then(|r| r.get(category))
    {
        Ok(Object::Reference(cid)) => (
            Some(*cid),
            doc.get_dictionary(*cid).cloned().unwrap_or_default(),
        ),
        Ok(Object::Dictionary(d)) => (None, d.clone()),
        _ => (None, Dictionary::new()),
    };
    category_dict.set(name, Object::Reference(id));
    // Phase 3 (writes only): store the category dict back.
    match cat_id {
        Some(cid) => {
            doc.set_object(cid, Object::Dictionary(category_dict));
        }
        None => {
            let cid = doc.add_object(Object::Dictionary(category_dict));
            doc.get_dictionary_mut(resources_id)?
                .set(category, Object::Reference(cid));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::tests::{contains_bytes, make_pdf};

    #[test]
    fn protect_unlock_round_trip() {
        let engine = PdfEngine::default();
        let pdf = make_pdf(2, "S");
        let protected = engine
            .protect(&pdf, "userpw", "ownerpw", PdfPermissions::default())
            .unwrap();
        // Encrypted output: validate refuses, but inspect reports
        // the encryption status (page count unknown without the
        // password — see `inspect`'s docs).
        let info = engine.inspect(&protected).unwrap();
        assert!(info.encrypted);
        assert_eq!(info.page_count, 0);
        assert_eq!(
            info.encryption.as_ref().map(|e| e.algorithm.as_str()),
            Some("RC4-128")
        );
        assert!(matches!(
            engine.validate(&protected).unwrap_err(),
            PdfError::Encrypted
        ));
        // Wrong password fails cleanly.
        assert!(engine.unlock(&protected, "wrongpw").is_err());
        // Right password restores the document.
        let unlocked = engine.unlock(&protected, "userpw").unwrap();
        assert_eq!(engine.page_count(&unlocked).unwrap(), 2);
        assert!(contains_bytes(&unlocked, b"S page 1"));
        // Owner password also unlocks.
        let unlocked2 = engine.unlock(&protected, "ownerpw").unwrap();
        assert_eq!(engine.page_count(&unlocked2).unwrap(), 2);
        // Errors: no passwords, already encrypted, not encrypted.
        assert!(engine
            .protect(&pdf, "", "", PdfPermissions::default())
            .is_err());
        assert!(engine
            .protect(&protected, "a", "b", PdfPermissions::default())
            .is_err());
        assert!(engine.unlock(&pdf, "whatever").is_err());
    }

    #[test]
    fn permissions_bits_land_in_the_encrypt_dict() {
        let engine = PdfEngine::default();
        let pdf = make_pdf(1, "P");
        let perms = PdfPermissions {
            print: false,
            copy: false,
            modify: true,
        };
        let protected = engine.protect(&pdf, "pw", "", perms).unwrap();
        let doc = Document::load_mem(&protected).unwrap();
        let encrypt_id = doc
            .trailer
            .get(b"Encrypt")
            .and_then(|o| o.as_reference())
            .unwrap();
        let p = doc
            .get_dictionary(encrypt_id)
            .and_then(|d| d.get(b"P"))
            .and_then(|o| o.as_i64())
            .unwrap();
        // Bit 3 (print) and bit 5 (copy) must be clear; bit 4
        // (modify) must be set. lopdf's Permissions::correct_bits
        // sets the reserved bits, so only these three are checked.
        assert_eq!(p & (1 << 2), 0, "print bit must be clear, P={p}");
        assert_eq!(p & (1 << 4), 0, "copy bit must be clear, P={p}");
        assert_ne!(p & (1 << 3), 0, "modify bit must be set, P={p}");
    }

    #[test]
    fn watermark_adds_visible_text_to_every_page() {
        let engine = PdfEngine::default();
        let pdf = make_pdf(3, "W");
        let out = engine
            .watermark(&pdf, "DRAFT", WatermarkOptions::default())
            .unwrap();
        assert_eq!(engine.page_count(&out).unwrap(), 3);
        // The watermark text is in the content streams.
        assert!(contains_bytes(&out, b"DRAFT"));
        assert!(contains_bytes(&out, b"/F0"));
        assert!(contains_bytes(&out, b"/GS0"));
        // Original text survives alongside it.
        assert!(contains_bytes(&out, b"W page 2"));
        assert!(engine
            .watermark(&pdf, "   ", WatermarkOptions::default())
            .is_err());
        assert!(engine
            .watermark(
                &pdf,
                "x",
                WatermarkOptions {
                    opacity: 1.5,
                    ..Default::default()
                }
            )
            .is_err());
    }

    /// The watermark really renders (a content stream that draws
    /// nothing would pass the byte checks above but render blank).
    #[test]
    #[cfg(feature = "pdfium")]
    fn watermark_renders_dark_pixels() {
        let engine = PdfEngine::default();
        let pdf = make_pdf(1, "W");
        let before = engine.render_to_images(&pdf, None, 1.0).unwrap();
        let out = engine
            .watermark(&pdf, "DRAFT", WatermarkOptions::default())
            .unwrap();
        let after = engine.render_to_images(&out, None, 1.0).unwrap();
        // The watermark is grey 0.5 at 25% opacity over white, so
        // its pixels are light grey (~luma 223), not dark — count
        // every non-white pixel instead of only dark ones.
        let non_white = |img: &openpixel_core::DecodedImage| {
            img.to_dynamic()
                .to_luma8()
                .pixels()
                .filter(|p| p.0[0] < 250)
                .count()
        };
        assert!(
            non_white(&after[0].image) > non_white(&before[0].image),
            "watermarked page must have more non-white pixels"
        );
    }
}
