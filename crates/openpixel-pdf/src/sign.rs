//! Digital signatures (Studio Phase 5): PKCS#7 detached
//! signatures (RFC 5652 / RFC 2315), RSA + SHA-256, pure Rust.
//!
//! A signature is an invisible signature field (`/FT /Sig`,
//! `/SubFilter /adbe.pkcs7.detached`) on the first page. The
//! CMS `SignedData` covers the whole file except the `/Contents`
//! value itself, via the standard `/ByteRange` mechanism: the
//! file is saved with a placeholder `/Contents` hex string and a
//! placeholder `/ByteRange`, the real byte ranges are patched
//! in place (same length, so no offset shifts), the CMS is
//! computed over the signed ranges, and the CMS DER is written
//! into the placeholder. The placeholder is sized exactly in a
//! second pass, so no zero padding is left in the file.
//!
//! What is verified, and what is NOT:
//! - `valid` means the cryptography checks out: the message
//!   digest in the CMS matches the signed byte ranges, the CMS
//!   signature verifies with the signer's certificate, and the
//!   certificate's validity window covers the signing time.
//! - `trusted` is separate: it is true only when a supplied
//!   trust anchor is the signer itself or issues the signer
//!   (one level). A self-signed certificate with no anchor is
//!   `valid` (if the crypto holds) but `trusted: false` — that
//!   is the honest answer for a self-signed test certificate,
//!   not a failure.
//! - No revocation checking (no CRL/OCSP fetch — this is a
//!   local tool and must never phone home), no timestamp
//!   authority, no long-term validation. RSA only: an ECDSA
//!   signer is reported as unsupported, never silently accepted.

#[cfg(feature = "sign")]
use crate::engine::{ordered_pages, save_to_bytes, PdfEngine};
#[cfg(feature = "sign")]
use crate::error::{PdfError, Result};
#[cfg(feature = "sign")]
use cms::builder::{create_signing_time_attribute, SignedDataBuilder, SignerInfoBuilder};
#[cfg(feature = "sign")]
use cms::cert::{CertificateChoices, IssuerAndSerialNumber};
#[cfg(feature = "sign")]
use cms::content_info::ContentInfo;
#[cfg(feature = "sign")]
use cms::signed_data::{EncapsulatedContentInfo, SignedData, SignerIdentifier};
#[cfg(feature = "sign")]
use const_oid::db::{rfc5911, rfc5912};
#[cfg(feature = "sign")]
use const_oid::ObjectIdentifier;
#[cfg(feature = "sign")]
use der::asn1::OctetStringRef;
#[cfg(feature = "sign")]
use der::{Decode, DecodePem, Encode};
#[cfg(feature = "sign")]
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId};
#[cfg(feature = "sign")]
use pkcs1::DecodeRsaPrivateKey;
#[cfg(feature = "sign")]
use pkcs8::DecodePrivateKey;
#[cfg(feature = "sign")]
use rsa::pkcs1v15::{Signature as RsaSignature, SigningKey, VerifyingKey};
#[cfg(feature = "sign")]
use rsa::{RsaPrivateKey, RsaPublicKey};
#[cfg(feature = "sign")]
use serde::{Deserialize, Serialize};
#[cfg(feature = "sign")]
use sha2::{Digest, Sha256};
#[cfg(feature = "sign")]
use signature::Verifier;
#[cfg(feature = "sign")]
use spki::{AlgorithmIdentifierOwned, DecodePublicKey};
#[cfg(feature = "sign")]
use std::time::SystemTime;
#[cfg(feature = "sign")]
use x509_cert::Certificate;

#[cfg(feature = "sign")]
fn oid(s: &str) -> ObjectIdentifier {
    ObjectIdentifier::new(s).expect("hardcoded OID is valid")
}

/// Options for signing. All three are optional metadata written
/// into the signature dictionary.
#[cfg(feature = "sign")]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SignOptions {
    pub reason: Option<String>,
    pub location: Option<String>,
    pub contact_info: Option<String>,
}

/// One signature found in a PDF, and what verification found.
/// `valid` is the cryptography; `trusted` is the chain to a
/// supplied anchor. `checks` lists every check that was run
/// and its outcome, in order.
#[cfg(feature = "sign")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignatureInfo {
    pub signer: Option<String>,
    pub issuer: Option<String>,
    pub serial: Option<String>,
    pub digest_algorithm: String,
    pub signing_time: Option<String>,
    pub not_before: Option<String>,
    pub not_after: Option<String>,
    pub valid: bool,
    pub trusted: bool,
    pub checks: Vec<String>,
    pub warnings: Vec<String>,
}

#[cfg(feature = "sign")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyOutcome {
    pub signatures: Vec<SignatureInfo>,
}

/// A placeholder `/Contents` of this many bytes is written in
/// the first pass; the CMS DER is always far smaller than this
/// for a 2048-bit RSA key.
#[cfg(feature = "sign")]
const PLACEHOLDER_BYTES: usize = 8192;

#[cfg(feature = "sign")]
fn cms_err(e: impl std::fmt::Display) -> PdfError {
    PdfError::Lopdf(format!("CMS error: {e}"))
}

#[cfg(feature = "sign")]
fn parse_private_key(pem: &str) -> Result<RsaPrivateKey> {
    RsaPrivateKey::from_pkcs8_pem(pem)
        .or_else(|_| RsaPrivateKey::from_pkcs1_pem(pem))
        .map_err(|_| {
            PdfError::InvalidPdf(
                "private key could not be parsed — supply an RSA key as PKCS#8 or PKCS#1 PEM"
                    .to_string(),
            )
        })
}

#[cfg(feature = "sign")]
fn parse_cert(bytes: &[u8]) -> Result<Certificate> {
    let cert = if bytes.starts_with(b"-----BEGIN") {
        Certificate::from_pem(bytes)
    } else {
        Certificate::from_der(bytes)
    };
    cert.map_err(|e| PdfError::InvalidPdf(format!("certificate could not be parsed: {e}")))
}

/// Build a detached CMS SignedData over `signed_data` (the
/// document's signed byte ranges), with the signer's certificate
/// included so verification can find it.
#[cfg(feature = "sign")]
fn build_cms(signed_data: &[u8], key: &RsaPrivateKey, cert: &Certificate) -> Result<Vec<u8>> {
    let digest = Sha256::digest(signed_data);
    let signing_key = SigningKey::<Sha256>::new(key.clone());
    let tbs = &cert.tbs_certificate;
    let sid = SignerIdentifier::IssuerAndSerialNumber(IssuerAndSerialNumber {
        issuer: tbs.issuer.clone(),
        serial_number: tbs.serial_number.clone(),
    });
    let digest_alg = AlgorithmIdentifierOwned {
        oid: rfc5912::ID_SHA_256,
        parameters: None,
    };
    let encap = EncapsulatedContentInfo {
        econtent_type: rfc5911::ID_DATA,
        econtent: None,
    };
    let mut signer_builder = SignerInfoBuilder::new(
        &signing_key,
        sid,
        digest_alg.clone(),
        &encap,
        Some(digest.as_slice()),
    )
    .map_err(cms_err)?;
    // The builder's finalize() adds the messageDigest and
    // contentType signed attributes itself (from the external
    // digest and the eContentType) — adding them here too would
    // duplicate them and break the SET OF. Only the signing time
    // is added by hand.
    signer_builder
        .add_signed_attribute(create_signing_time_attribute().map_err(cms_err)?)
        .map_err(cms_err)?;
    let mut sd_builder = SignedDataBuilder::new(&encap);
    sd_builder
        .add_digest_algorithm(digest_alg)
        .map_err(cms_err)?;
    sd_builder
        .add_certificate(CertificateChoices::Certificate(cert.clone()))
        .map_err(cms_err)?;
    sd_builder
        .add_signer_info::<_, RsaSignature>(signer_builder)
        .map_err(cms_err)?;
    let content_info = sd_builder.build().map_err(cms_err)?;
    content_info.to_der().map_err(cms_err)
}

/// Find a byte slice inside a file. Returns every offset.
#[cfg(feature = "sign")]
fn find_all(haystack: &[u8], needle: &[u8]) -> Vec<usize> {
    let mut out = Vec::new();
    let mut start = 0usize;
    while let Some(pos) = haystack[start..]
        .windows(needle.len())
        .position(|w| w == needle)
    {
        out.push(start + pos);
        start += pos + 1;
    }
    out
}

/// Expand the saved `/ByteRange[0 0 0 0]` to the padded form
/// (this changes the file length — it must happen BEFORE any
/// offset is measured). Returns the offset of the `[`.
/// lopdf writes dictionaries without spaces (`/ByteRange[...`),
/// so the marker has no space after the key.
#[cfg(feature = "sign")]
/// Locate the `/ByteRange[...]` array in a saved file and verify
/// it is already the fixed-width form written by
/// `build_placeholder_pdf` (`[0 1000000000 1000000000 1000000000]`).
/// Returns the offset of the `[`. Nothing is changed: the patch
/// must be length-preserving, or the xref lopdf wrote would be
/// invalidated (see the placeholder comment above).
#[cfg(feature = "sign")]
fn locate_byterange(file: &[u8]) -> Result<usize> {
    let marker = b"/ByteRange[";
    let pos = find_all(file, marker)
        .into_iter()
        .next()
        .ok_or_else(|| PdfError::Lopdf("saved PDF has no /ByteRange array".to_string()))?;
    let arr_start = pos + marker.len() - 1;
    let rel_end = file[arr_start..]
        .iter()
        .position(|&b| b == b']')
        .ok_or_else(|| PdfError::Lopdf("saved PDF has an unterminated /ByteRange".to_string()))?;
    let inner = &file[arr_start + 1..arr_start + rel_end];
    let parts: Vec<&[u8]> = inner.split(|&b| b == b' ').collect();
    let ok = parts.len() == 4
        && parts[0] == b"0"
        && parts[1..]
            .iter()
            .all(|p| p.len() == 10 && p.iter().all(|b| b.is_ascii_digit()));
    if !ok {
        return Err(PdfError::Lopdf(
            "saved PDF /ByteRange is not the fixed-width placeholder (expected [0 1000000000 1000000000 1000000000])"
                .to_string(),
        ));
    }
    Ok(arr_start)
}

/// Locate the `/Contents<...>` hex run of the expected length
/// (all zeros — the placeholder). Returns (offset of `<`,
/// offset just past `>`). lopdf writes no space after the key.
#[cfg(feature = "sign")]
fn find_contents_placeholder(file: &[u8], hex_len: usize) -> Result<(usize, usize)> {
    for pos in find_all(file, b"/Contents<") {
        let lt = pos + b"/Contents<".len() - 1;
        let Some(rel_gt) = file[lt..].iter().position(|&b| b == b'>') else {
            continue;
        };
        let gt = lt + rel_gt;
        let run = &file[lt + 1..gt];
        if run.len() == hex_len && run.iter().all(|&b| b == b'0') {
            return Ok((lt, gt + 1));
        }
    }
    Err(PdfError::Lopdf(
        "saved PDF has no /Contents placeholder of the expected size".to_string(),
    ))
}

/// Write a decimal into a fixed-width (10-digit, zero-padded)
/// field. The field must currently hold digits.
#[cfg(feature = "sign")]
fn write_padded(file: &mut [u8], at: usize, value: usize) -> Result<()> {
    let text = format!("{value:010}");
    if text.len() != 10 {
        return Err(PdfError::Lopdf(format!(
            "byte range value {value} does not fit in 10 digits"
        )));
    }
    if !file[at..at + 10].iter().all(|b| b.is_ascii_digit()) {
        return Err(PdfError::Lopdf(
            "byte range placeholder was overwritten before patching".to_string(),
        ));
    }
    file[at..at + 10].copy_from_slice(text.as_bytes());
    Ok(())
}

/// Take a saved file with placeholders and finish the signature:
/// expand + patch the ByteRange, build the CMS over the signed
/// ranges, write the CMS into the Contents placeholder. The CMS
/// must fit the placeholder (the caller sizes it). Returns the
/// finished file and the CMS DER length (the caller needs it to
/// size the exactly-fitting second pass).
#[cfg(feature = "sign")]
fn finalize_signature(
    mut file: Vec<u8>,
    placeholder_hex_len: usize,
    key: &RsaPrivateKey,
    cert: &Certificate,
) -> Result<(Vec<u8>, usize)> {
    let len_before = file.len();
    let arr_start = locate_byterange(&file)?;
    let (lt, gt) = find_contents_placeholder(&file, placeholder_hex_len)?;
    // ByteRange = [0, lt, gt, len - gt]: everything except the
    // Contents hex value itself is signed.
    write_padded(&mut file, arr_start + 3, lt)?;
    write_padded(&mut file, arr_start + 14, gt)?;
    let file_len = file.len();
    write_padded(&mut file, arr_start + 25, file_len - gt)?;
    let mut signed_data = Vec::with_capacity(file.len());
    signed_data.extend_from_slice(&file[..lt]);
    signed_data.extend_from_slice(&file[gt..]);
    let cms = build_cms(&signed_data, key, cert)?;
    let cms_hex: String = cms.iter().map(|b| format!("{b:02x}")).collect();
    if cms_hex.len() > placeholder_hex_len {
        return Err(PdfError::Lopdf(format!(
            "CMS signature ({} bytes) does not fit the {}-byte placeholder",
            cms.len(),
            placeholder_hex_len / 2
        )));
    }
    file[lt + 1..lt + 1 + cms_hex.len()].copy_from_slice(cms_hex.as_bytes());
    // Length-preserving patch: every write above was in place,
    // so the xref lopdf wrote still points at the right offsets.
    // If this ever breaks, the file is corrupt — fail loudly.
    if file.len() != len_before {
        return Err(PdfError::Lopdf(
            "signing changed the file length — the xref would be invalid".to_string(),
        ));
    }
    Ok((file, cms.len()))
}

/// Format a Unix timestamp as UTC "YYYY-MM-DD HH:MM:SS UTC".
#[cfg(feature = "sign")]
fn format_unix(secs: u64) -> String {
    // Howard Hinnant's civil-from-days algorithm — no date
    // crate is pulled in for one string.
    let days = (secs / 86_400) as i64;
    let secs_of_day = secs % 86_400;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{:02}-{:02} {:02}:{:02}:{:02} UTC",
        m,
        d,
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60
    )
}

/// A PDF date string for the signature dictionary ("D:..." in
/// UTC, the format viewers expect in /M).
#[cfg(feature = "sign")]
fn pdf_date_now() -> String {
    let secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let secs_of_day = secs % 86_400;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "D:{y:04}{m:02}{d:02}{:02}{:02}{:02}+00'00'",
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60
    )
}

#[cfg(feature = "sign")]
impl PdfEngine {
    /// Sign a PDF with an RSA private key (PKCS#8 or PKCS#1 PEM)
    /// and its certificate (PEM or DER). The signature is an
    /// invisible field on the first page; the CMS is a detached
    /// PKCS#7 over the whole file except the /Contents value.
    /// Returns the signed PDF bytes. The output still parses and
    /// keeps every page — signing adds a field, it never rewrites
    /// content.
    pub fn sign(
        &self,
        bytes: &[u8],
        key_pem: &str,
        cert_pem: &str,
        options: &SignOptions,
    ) -> Result<Vec<u8>> {
        let key = parse_private_key(key_pem)?;
        let cert = parse_cert(cert_pem.as_bytes())?;
        // Pass 1: a generous placeholder, to measure the CMS DER
        // length (it depends only on the key and the certificate,
        // never on the document bytes).
        let pass1 = self.build_placeholder_pdf(bytes, PLACEHOLDER_BYTES, options)?;
        let (_, cms_len) = finalize_signature(pass1, PLACEHOLDER_BYTES * 2, &key, &cert)?;
        if cms_len == 0 || cms_len > PLACEHOLDER_BYTES {
            return Err(PdfError::Lopdf(format!(
                "could not measure the CMS signature length ({cms_len} bytes)"
            )));
        }
        // Pass 2: an exactly-sized placeholder — no zero padding
        // is left in the file.
        let pass2 = self.build_placeholder_pdf(bytes, cms_len, options)?;
        let (signed, _) = finalize_signature(pass2, cms_len * 2, &key, &cert)?;
        Document::load_mem(&signed)
            .map_err(|e| PdfError::Lopdf(format!("signed PDF does not parse again: {e}")))?;
        Ok(signed)
    }

    /// Save the document with a signature field + signature
    /// dictionary whose /Contents is a zero placeholder of
    /// `contents_bytes` and whose /ByteRange is [0 0 0 0].
    fn build_placeholder_pdf(
        &self,
        bytes: &[u8],
        contents_bytes: usize,
        options: &SignOptions,
    ) -> Result<Vec<u8>> {
        self.validate(bytes)?;
        let mut doc = Document::load_mem(bytes)?;
        let pages = ordered_pages(&doc);
        let first_page = pages
            .first()
            .ok_or_else(|| PdfError::InvalidPdf("cannot sign a PDF with no pages".to_string()))?
            .1;
        let mut sig_dict = dictionary! {
            "Type" => "Sig",
            "Filter" => "Adobe.PPKLite",
            "SubFilter" => "adbe.pkcs7.detached",
            // ByteRange placeholder: the three offsets are written
            // as 10-digit numbers from the start (1000000000 is a
            // stand-in, not a real offset). This matters: lopdf
            // writes the xref with byte offsets, so the final
            // patch MUST NOT change the file length — expanding
            // "[0 0 0 0]" to the padded form after saving would
            // shift every object after the signature dict and
            // invalidate the xref (objects vanish on reload).
            // With fixed-width fields the patch is in place and
            // the xref stays valid.
            "ByteRange" => Object::Array(vec![
                Object::Integer(0),
                Object::Integer(1_000_000_000),
                Object::Integer(1_000_000_000),
                Object::Integer(1_000_000_000),
            ]),
            "Contents" => Object::String(
                vec![0u8; contents_bytes],
                lopdf::StringFormat::Hexadecimal,
            ),
            "M" => Object::String(
                pdf_date_now().into_bytes(),
                lopdf::StringFormat::Literal,
            ),
        };
        if let Some(reason) = &options.reason {
            sig_dict.set(
                "Reason",
                Object::String(reason.as_bytes().to_vec(), lopdf::StringFormat::Literal),
            );
        }
        if let Some(location) = &options.location {
            sig_dict.set(
                "Location",
                Object::String(location.as_bytes().to_vec(), lopdf::StringFormat::Literal),
            );
        }
        if let Some(contact) = &options.contact_info {
            sig_dict.set(
                "ContactInfo",
                Object::String(contact.as_bytes().to_vec(), lopdf::StringFormat::Literal),
            );
        }
        let sig_id = doc.add_object(Object::Dictionary(sig_dict));
        // A field name that does not already exist.
        let mut n = 1u32;
        let field_name = loop {
            let name = format!("Sig{n}");
            if !field_name_exists(&doc, &name) {
                break name;
            }
            n += 1;
        };
        let field_id = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Sig",
            "T" => Object::String(field_name.into_bytes(), lopdf::StringFormat::Literal),
            "V" => Object::Reference(sig_id),
            "Rect" => Object::Array(vec![
                Object::Integer(0), Object::Integer(0),
                Object::Integer(0), Object::Integer(0),
            ]),
            "P" => Object::Reference(first_page),
            "F" => Object::Integer(4),
        });
        // AcroForm: reuse the existing one or create it.
        let root = doc
            .trailer
            .get(b"Root")
            .and_then(|r| r.as_reference())
            .map_err(|e| PdfError::Lopdf(e.to_string()))?;
        let acro_id = match doc
            .get_dictionary(root)
            .and_then(|c| c.get(b"AcroForm"))
            .cloned()
        {
            Ok(Object::Reference(id)) => id,
            Ok(Object::Dictionary(_)) => {
                let id = doc.add_object(dictionary! {
                    "Fields" => Object::Array(vec![]),
                    "SigFlags" => Object::Integer(1),
                });
                doc.get_dictionary_mut(root)?
                    .set("AcroForm", Object::Reference(id));
                id
            }
            _ => {
                let id = doc.add_object(dictionary! {
                    "Fields" => Object::Array(vec![]),
                    "SigFlags" => Object::Integer(1),
                });
                doc.get_dictionary_mut(root)?
                    .set("AcroForm", Object::Reference(id));
                id
            }
        };
        let fields = doc
            .get_dictionary(acro_id)
            .and_then(|d| d.get(b"Fields"))
            .cloned()
            .unwrap_or(Object::Array(vec![]));
        match fields {
            Object::Array(mut items) => {
                items.push(Object::Reference(field_id));
                doc.get_dictionary_mut(acro_id)?
                    .set("Fields", Object::Array(items));
            }
            Object::Reference(id) => {
                let arr = doc
                    .get_object_mut(id)
                    .and_then(|o| o.as_array_mut())
                    .map_err(|e| PdfError::Lopdf(e.to_string()))?;
                arr.push(Object::Reference(field_id));
            }
            _ => {
                doc.get_dictionary_mut(acro_id)?
                    .set("Fields", Object::Array(vec![Object::Reference(field_id)]));
            }
        }
        if let Ok(d) = doc.get_dictionary_mut(acro_id) {
            d.set("SigFlags", Object::Integer(1));
        }
        // The widget goes on the first page's /Annots.
        crate::edit::append_annotation(&mut doc, first_page, field_id)?;
        save_to_bytes(&mut doc)
    }

    /// Verify every signature field in a PDF. `trust_anchors`
    /// are DER (or PEM) certificates to trust: a signer is
    /// `trusted` when it IS an anchor or when an anchor issued
    /// it (one level). With no anchors every signer is
    /// untrusted — that is reported, not hidden.
    pub fn verify_signatures(
        &self,
        bytes: &[u8],
        trust_anchors: &[Vec<u8>],
    ) -> Result<VerifyOutcome> {
        self.validate(bytes)?;
        let doc = Document::load_mem(bytes)?;
        let anchors: Vec<Certificate> = trust_anchors
            .iter()
            .map(|a| parse_cert(a))
            .collect::<Result<Vec<_>>>()?;
        let mut outcome = VerifyOutcome {
            signatures: Vec::new(),
        };
        for sig_dict in collect_sig_dicts(&doc) {
            outcome
                .signatures
                .push(verify_one_signature(bytes, &sig_dict, &anchors));
        }
        Ok(outcome)
    }
}

/// Does a field named `name` already exist in the AcroForm?
#[cfg(feature = "sign")]
fn field_name_exists(doc: &Document, name: &str) -> bool {
    let Some(root) = doc.trailer.get(b"Root").and_then(|r| r.as_reference()).ok() else {
        return false;
    };
    let Ok(acro) = doc
        .get_dictionary(root)
        .and_then(|c| c.get(b"AcroForm"))
        .cloned()
    else {
        return false;
    };
    let fields = match &acro {
        Object::Reference(id) => doc
            .get_dictionary(*id)
            .and_then(|d| d.get(b"Fields"))
            .cloned()
            .ok(),
        Object::Dictionary(d) => d.get(b"Fields").cloned().ok(),
        _ => None,
    };
    let Some(Object::Array(items)) = fields else {
        return false;
    };
    items.iter().any(|item| {
        let Object::Reference(id) = item else {
            return false;
        };
        doc.get_dictionary(*id)
            .and_then(|d| d.get(b"T"))
            .and_then(|t| t.as_str())
            .map(|s| s == name.as_bytes())
            .unwrap_or(false)
    })
}

/// Every signature dictionary in the document (the /V of a
/// /FT /Sig field), found by walking the AcroForm fields.
#[cfg(feature = "sign")]
fn collect_sig_dicts(doc: &Document) -> Vec<Dictionary> {
    let mut out = Vec::new();
    let Some(root) = doc.trailer.get(b"Root").and_then(|r| r.as_reference()).ok() else {
        return out;
    };
    let acro = match doc
        .get_dictionary(root)
        .and_then(|c| c.get(b"AcroForm"))
        .cloned()
    {
        Ok(a) => a,
        Err(_) => return out,
    };
    let fields = match &acro {
        Object::Reference(id) => doc
            .get_dictionary(*id)
            .and_then(|d| d.get(b"Fields"))
            .cloned()
            .ok(),
        Object::Dictionary(d) => d.get(b"Fields").cloned().ok(),
        _ => None,
    };
    let Some(Object::Array(items)) = fields else {
        return out;
    };
    let mut stack: Vec<ObjectId> = items
        .into_iter()
        .filter_map(|o| o.as_reference().ok())
        .collect();
    // Audit B5: a cyclic /Kids graph (a field listing itself as
    // its own child) looped forever here — the old walk had no
    // visited set, unlike `collect_field_ids` in edit.rs.
    let mut seen: std::collections::HashSet<ObjectId> = std::collections::HashSet::new();
    while let Some(id) = stack.pop() {
        if !seen.insert(id) {
            continue;
        }
        let Ok(d) = doc.get_dictionary(id).cloned() else {
            continue;
        };
        // Child fields.
        if let Ok(Object::Array(kids)) = d.get(b"Kids").cloned() {
            for kid in kids {
                if let Ok(kid_id) = kid.as_reference() {
                    stack.push(kid_id);
                }
            }
        }
        let is_sig = d
            .get(b"FT")
            .and_then(|f| f.as_name())
            .map(|n| n == b"Sig")
            .unwrap_or(false);
        if !is_sig {
            continue;
        }
        match d.get(b"V").cloned() {
            Ok(Object::Reference(vid)) => {
                if let Ok(vd) = doc.get_dictionary(vid).cloned() {
                    out.push(vd);
                }
            }
            Ok(Object::Dictionary(vd)) => out.push(vd),
            _ => {}
        }
    }
    out
}

/// Verify one signature dictionary against the file bytes.
/// Never panics on a malformed signature: every failure is a
/// `valid: false` with the reason in `checks`/`warnings`.
#[cfg(feature = "sign")]
fn verify_one_signature(
    file: &[u8],
    sig_dict: &Dictionary,
    anchors: &[Certificate],
) -> SignatureInfo {
    let mut info = SignatureInfo {
        signer: None,
        issuer: None,
        serial: None,
        digest_algorithm: "unknown".to_string(),
        signing_time: None,
        not_before: None,
        not_after: None,
        valid: false,
        trusted: false,
        checks: Vec::new(),
        warnings: Vec::new(),
    };
    // The sub-filter must be the detached PKCS#7 this code writes
    // (and the only kind it verifies).
    let subfilter = sig_dict
        .get(b"SubFilter")
        .and_then(|s| s.as_name())
        .map(|n| String::from_utf8_lossy(n).into_owned())
        .unwrap_or_default();
    if subfilter != "adbe.pkcs7.detached" {
        info.warnings.push(format!(
            "unsupported signature sub-filter {subfilter:?} — only adbe.pkcs7.detached is verified"
        ));
        return info;
    }
    let contents = match sig_dict.get(b"Contents").and_then(|c| c.as_str()) {
        Ok(b) => b.to_vec(),
        Err(_) => {
            info.warnings
                .push("signature has no /Contents value".to_string());
            return info;
        }
    };
    let byterange = match sig_dict.get(b"ByteRange").and_then(|b| b.as_array()) {
        Ok(a) => a.clone(),
        Err(_) => {
            info.warnings
                .push("signature has no /ByteRange".to_string());
            return info;
        }
    };
    let nums: Vec<usize> = byterange
        .iter()
        .filter_map(|o| match o {
            Object::Integer(i) if *i >= 0 => Some(*i as usize),
            _ => None,
        })
        .collect();
    if nums.len() != 4 {
        info.warnings.push(format!(
            "signature /ByteRange has {} entries, not 4",
            nums.len()
        ));
        return info;
    }
    let (off1, len1, off2, len2) = (nums[0], nums[1], nums[2], nums[3]);
    // Audit B4: the ranges must partition the whole file around
    // exactly the /Contents value. The old check only asked that
    // each range end inside the file, so a /ByteRange that
    // excluded most of the file still "verified": the digest
    // covered only the declared ranges, and tampering outside
    // them was never seen. The gap between the ranges is the
    // /Contents value as written in the file — a hex string
    // `<...>` (2 bytes per byte, plus brackets) or a literal
    // string (bytes plus brackets).
    let end1 = off1.checked_add(len1);
    let end2 = off2.checked_add(len2);
    let covers_file = off1 == 0
        && matches!(end1, Some(e1) if e1 <= off2)
        && matches!(end2, Some(e2) if e2 == file.len())
        && end1.map_or(false, |e1| {
            let gap = off2 - e1;
            gap == contents.len() * 2 + 2 || gap == contents.len() + 2
        });
    if !covers_file {
        info.warnings.push(
            "signature /ByteRange does not cover the whole file except the /Contents value — the signature cannot prove the file is unchanged"
                .to_string(),
        );
        return info;
    }
    let mut signed_data = Vec::with_capacity(len1 + len2);
    signed_data.extend_from_slice(&file[off1..off1 + len1]);
    signed_data.extend_from_slice(&file[off2..off2 + len2]);

    // The CMS DER: the /Contents value may carry zero padding
    // after the DER (other writers do this) — slice to the DER
    // length from the first bytes.
    let cms_der = match der_length_prefix(&contents) {
        Some(n) if n <= contents.len() => &contents[..n],
        _ => {
            info.warnings
                .push("signature /Contents is not a DER value".to_string());
            return info;
        }
    };
    let content_info = match ContentInfo::from_der(cms_der) {
        Ok(c) => c,
        Err(e) => {
            info.warnings
                .push(format!("signature /Contents is not a CMS ContentInfo: {e}"));
            return info;
        }
    };
    if content_info.content_type != rfc5911::ID_SIGNED_DATA {
        info.warnings.push(format!(
            "signature is not a CMS SignedData (content type {})",
            content_info.content_type
        ));
        return info;
    }
    let sd_der = match content_info.content.to_der() {
        Ok(d) => d,
        Err(e) => {
            info.warnings
                .push(format!("signed data could not be re-encoded: {e}"));
            return info;
        }
    };
    let signed = match SignedData::from_der(&sd_der) {
        Ok(s) => s,
        Err(e) => {
            info.warnings
                .push(format!("CMS SignedData could not be parsed: {e}"));
            return info;
        }
    };
    if signed.signer_infos.0.is_empty() {
        info.warnings
            .push("CMS SignedData has no signer".to_string());
        return info;
    }
    // One signer is the PDF case; verify the first and report the
    // count when there are more.
    let signer_info = signed.signer_infos.0.iter().next().unwrap();
    if signed.signer_infos.0.len() > 1 {
        info.warnings.push(format!(
            "CMS has {} signers — only the first was verified",
            signed.signer_infos.0.len()
        ));
    }
    if signer_info.digest_alg.oid == rfc5912::ID_SHA_256 {
        info.digest_algorithm = "SHA-256".to_string();
    } else {
        info.warnings.push(format!(
            "unsupported digest algorithm {} — only SHA-256 is verified",
            signer_info.digest_alg.oid
        ));
        return info;
    }
    // The signature algorithm in a CMS SignerInfo is the
    // COMBINED algorithm (sha256WithRSAEncryption), not the raw
    // key algorithm (rsaEncryption) — some signers write either.
    // The digest algorithm was already checked above (SHA-256),
    // so the crypto check below stays sound for all of these.
    let rsa_algs = [
        rfc5912::RSA_ENCRYPTION,
        rfc5912::SHA_256_WITH_RSA_ENCRYPTION,
        rfc5912::SHA_384_WITH_RSA_ENCRYPTION,
        rfc5912::SHA_512_WITH_RSA_ENCRYPTION,
    ];
    if !rsa_algs.contains(&signer_info.signature_algorithm.oid) {
        info.warnings.push(format!(
            "unsupported signature algorithm {} — only RSA is verified",
            signer_info.signature_algorithm.oid
        ));
        return info;
    }
    // The signer's certificate: from the CMS, or from the /Cert
    // array in the signature dictionary.
    let cert_der = find_signer_cert(&signed, signer_info, sig_dict);
    let Some(cert_der) = cert_der else {
        info.warnings.push(
            "the signer's certificate is not in the CMS or the signature dictionary".to_string(),
        );
        return info;
    };
    let cert = match Certificate::from_der(&cert_der) {
        Ok(c) => c,
        Err(e) => {
            info.warnings
                .push(format!("the signer's certificate could not be parsed: {e}"));
            return info;
        }
    };
    let tbs = &cert.tbs_certificate;
    info.signer = Some(tbs.subject.to_string());
    info.issuer = Some(tbs.issuer.to_string());
    info.serial = Some(hex_bytes(tbs.serial_number.as_bytes()));
    let not_before = tbs.validity.not_before.to_unix_duration().as_secs();
    let not_after = tbs.validity.not_after.to_unix_duration().as_secs();
    info.not_before = Some(format_unix(not_before));
    info.not_after = Some(format_unix(not_after));

    let mut ok = true;
    // 1. The message digest in the CMS must match the signed
    //    byte ranges.
    let digest_ok = match (
        &signer_info.signed_attrs,
        find_attr_value(
            signer_info.signed_attrs.as_ref(),
            &oid("1.2.840.113549.1.9.4"),
        ),
    ) {
        (Some(_), Some(value)) => {
            let expected = Sha256::digest(&signed_data);
            let actual = OctetStringRef::from_der(&value)
                .map(|o| o.as_bytes().to_vec())
                .unwrap_or_default();
            expected.as_slice() == actual.as_slice()
        }
        _ => false,
    };
    if digest_ok {
        info.checks
            .push("message digest: matches the signed byte ranges".to_string());
    } else {
        info.checks.push(
            "message digest: DOES NOT match the signed byte ranges (the file changed after signing)"
                .to_string(),
        );
        ok = false;
    }
    // 2. The CMS signature must verify with the certificate,
    //    over the DER of the signed attributes.
    let sig_ok = verify_cms_signature(signer_info, &cert);
    match sig_ok {
        Ok(true) => info
            .checks
            .push("CMS signature: verifies with the signer's certificate".to_string()),
        Ok(false) => {
            info.checks
                .push("CMS signature: DOES NOT verify with the signer's certificate".to_string());
            ok = false;
        }
        Err(e) => {
            info.checks
                .push(format!("CMS signature: could not be checked ({e})"));
            ok = false;
        }
    }
    // 3. The signing time (when present) must be inside the
    //    certificate's validity window.
    let signing_time = find_attr_value(
        signer_info.signed_attrs.as_ref(),
        &oid("1.2.840.113549.1.9.5"),
    )
    .and_then(|v| parse_time_der(&v));
    if let Some(t) = signing_time {
        info.signing_time = Some(format_unix(t));
        if t >= not_before && t <= not_after {
            info.checks
                .push("certificate: the signing time is inside its validity window".to_string());
        } else {
            info.checks
                .push("certificate: the signing time is OUTSIDE its validity window".to_string());
            ok = false;
        }
    } else {
        info.warnings.push(
            "no signing-time attribute — the validity window was checked against now instead"
                .to_string(),
        );
        let now = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if now < not_before || now > not_after {
            info.checks
                .push("certificate: expired or not yet valid".to_string());
            ok = false;
        }
    }
    // 4. Self-consistency: a self-signed certificate's own
    //    signature must verify with its own key.
    let self_signed = tbs.issuer == tbs.subject;
    if self_signed {
        match verify_cert_signature(&cert_der, &cert_der) {
            Ok(true) => info
                .checks
                .push("certificate: self-signed, and its own signature verifies".to_string()),
            _ => {
                info.checks.push(
                    "certificate: self-signed, but its own signature DOES NOT verify".to_string(),
                );
                ok = false;
            }
        }
    }
    info.valid = ok;
    // 5. Trust: the signer is an anchor, or an anchor issued it.
    info.trusted = anchors.iter().any(|anchor| {
        let Ok(anchor_der) = anchor.to_der() else {
            return false;
        };
        if anchor_der == cert_der {
            return true;
        }
        let anchor_tbs = &anchor.tbs_certificate;
        if anchor_tbs.subject != tbs.issuer {
            return false;
        }
        verify_cert_signature(&cert_der, &anchor_der).unwrap_or(false)
    });
    if info.trusted {
        info.checks
            .push("trust: the signer chains to a supplied trust anchor".to_string());
    } else if anchors.is_empty() {
        info.warnings.push(
            "no trust anchor was supplied — the signature is cryptographically valid but untrusted"
                .to_string(),
        );
    } else {
        info.warnings
            .push("the signer does not chain to any supplied trust anchor".to_string());
    }
    info
}

/// The DER length of the value starting at `bytes[0]`
/// (tag + length), or None when the bytes do not start with a
/// well-formed DER header. Used to slice a CMS value out of a
/// possibly zero-padded /Contents.
#[cfg(feature = "sign")]
fn der_length_prefix(bytes: &[u8]) -> Option<usize> {
    if bytes.len() < 2 {
        return None;
    }
    let len_byte = bytes[1];
    let (len, header) = if len_byte & 0x80 == 0 {
        (len_byte as usize, 2)
    } else {
        let n = (len_byte & 0x7f) as usize;
        if n == 0 || n > 4 || bytes.len() < 2 + n {
            return None;
        }
        let mut len = 0usize;
        for b in &bytes[2..2 + n] {
            len = (len << 8) | *b as usize;
        }
        (len, 2 + n)
    };
    Some(header + len)
}

/// Find the signer's certificate DER: first in the CMS
/// certificates (matching issuer + serial), then in the
/// signature dictionary's /Cert array.
#[cfg(feature = "sign")]
fn find_signer_cert(
    signed: &SignedData,
    signer_info: &cms::signed_data::SignerInfo,
    sig_dict: &Dictionary,
) -> Option<Vec<u8>> {
    if let cms::signed_data::SignerIdentifier::IssuerAndSerialNumber(sid) = &signer_info.sid {
        if let Some(certs) = &signed.certificates {
            for choice in certs.0.iter() {
                if let CertificateChoices::Certificate(cert) = choice {
                    let tbs = &cert.tbs_certificate;
                    if tbs.issuer == sid.issuer && tbs.serial_number == sid.serial_number {
                        if let Ok(der) = cert.to_der() {
                            return Some(der);
                        }
                    }
                }
            }
        }
    }
    if let Ok(Object::Array(items)) = sig_dict.get(b"Cert").cloned() {
        for item in items {
            if let Ok(bytes) = item.as_str() {
                return Some(bytes.to_vec());
            }
        }
    }
    None
}

/// Parse an ASN.1 Time value (UTCTime tag 0x17 or GeneralizedTime
/// tag 0x18) to Unix seconds. `der::DateTime` only decodes
/// GeneralizedTime, so the tag decides — a UTCTime signing time
/// (the usual case before 2050) would fail through it.
#[cfg(feature = "sign")]
fn parse_time_der(v: &[u8]) -> Option<u64> {
    if let Ok(t) = der::asn1::UtcTime::from_der(v) {
        return Some(t.to_unix_duration().as_secs());
    }
    der::asn1::GeneralizedTime::from_der(v)
        .ok()
        .map(|t| t.to_unix_duration().as_secs())
}

/// The first value of a signed attribute, as DER bytes.
#[cfg(feature = "sign")]
fn find_attr_value(
    attrs: Option<&cms::signed_data::SignedAttributes>,
    want: &ObjectIdentifier,
) -> Option<Vec<u8>> {
    let attrs = attrs?;
    for attr in attrs.iter() {
        if attr.oid == *want {
            if let Some(value) = attr.values.iter().next() {
                return value.to_der().ok();
            }
        }
    }
    None
}

/// Verify the CMS signature: RSA PKCS#1 v1.5 over the DER of
/// the signed attributes (SET OF, tag 0x31 — exactly what the
/// DER encoding of the attribute set produces).
#[cfg(feature = "sign")]
fn verify_cms_signature(
    signer_info: &cms::signed_data::SignerInfo,
    cert: &Certificate,
) -> std::result::Result<bool, String> {
    let attrs = signer_info
        .signed_attrs
        .as_ref()
        .ok_or_else(|| "no signed attributes".to_string())?;
    let attrs_der = attrs.to_der().map_err(|e| e.to_string())?;
    let public_key = public_key_of(cert)?;
    let verifying_key = VerifyingKey::<Sha256>::new(public_key);
    let signature = RsaSignature::try_from(signer_info.signature.as_bytes())
        .map_err(|e| format!("signature value: {e}"))?;
    Ok(verifying_key.verify(&attrs_der, &signature).is_ok())
}

/// Verify a certificate's own signature with an issuer's public
/// key (both given as DER certificates). Only
/// sha256WithRSAEncryption is supported.
#[cfg(feature = "sign")]
fn verify_cert_signature(cert_der: &[u8], issuer_der: &[u8]) -> std::result::Result<bool, String> {
    let cert = Certificate::from_der(cert_der).map_err(|e| e.to_string())?;
    let issuer = Certificate::from_der(issuer_der).map_err(|e| e.to_string())?;
    if cert.signature_algorithm.oid != rfc5912::SHA_256_WITH_RSA_ENCRYPTION {
        return Err(format!(
            "unsupported certificate signature algorithm {}",
            cert.signature_algorithm.oid
        ));
    }
    let public_key = public_key_of(&issuer)?;
    let verifying_key = VerifyingKey::<Sha256>::new(public_key);
    let tbs_der = cert.tbs_certificate.to_der().map_err(|e| e.to_string())?;
    let signature = RsaSignature::try_from(
        cert.signature
            .as_bytes()
            .ok_or_else(|| "certificate signature has unused bits".to_string())?,
    )
    .map_err(|e| format!("certificate signature value: {e}"))?;
    Ok(verifying_key.verify(&tbs_der, &signature).is_ok())
}

/// The RSA public key of a certificate (its SPKI must be RSA).
#[cfg(feature = "sign")]
fn public_key_of(cert: &Certificate) -> std::result::Result<RsaPublicKey, String> {
    let spki_der = cert
        .tbs_certificate
        .subject_public_key_info
        .to_der()
        .map_err(|e| e.to_string())?;
    RsaPublicKey::from_public_key_der(&spki_der).map_err(|e| e.to_string())
}

#[cfg(feature = "sign")]
fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
#[cfg(feature = "sign")]
mod tests {
    use super::*;
    use crate::engine::tests::{contains_bytes, make_pdf};

    /// A 2048-bit RSA self-signed test certificate (rcgen).
    /// The key PEM is PKCS#8; the cert PEM is a real X.509
    /// certificate with CN "Test Signer".
    ///
    /// RSA key generation is done with the rsa crate: rcgen
    /// cannot generate RSA keys with its default (ring) backend
    /// — only its aws-lc-rs feature can, and that is a heavy C
    /// dependency for a test fixture. rcgen CAN load the key and
    /// build the self-signed certificate around it.
    fn test_cert() -> (String, String) {
        use pkcs8::EncodePrivateKey;
        let mut rng = rand::thread_rng();
        let private = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let key_pem = private
            .to_pkcs8_pem(pkcs8::LineEnding::LF)
            .unwrap()
            .to_string();
        let key_pair = rcgen::KeyPair::from_pem(&key_pem).unwrap();
        let mut params = rcgen::CertificateParams::new(vec!["Test Signer".to_string()]).unwrap();
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "Test Signer");
        let cert = params.self_signed(&key_pair).unwrap();
        (key_pem, cert.pem())
    }

    #[test]
    fn sign_and_verify_round_trip() {
        let engine = PdfEngine::default();
        let (key_pem, cert_pem) = test_cert();
        let input = make_pdf(2, "Doc");
        let signed = engine
            .sign(&input, &key_pem, &cert_pem, &SignOptions::default())
            .unwrap();
        // The signed file still parses, keeps its pages and text.
        assert_eq!(engine.inspect(&signed).unwrap().page_count, 2);
        assert!(contains_bytes(&signed, b"Doc page 1"));
        // Verify with the cert as the trust anchor.
        let cert_der = parse_cert(cert_pem.as_bytes()).unwrap().to_der().unwrap();
        let outcome = engine.verify_signatures(&signed, &[cert_der]).unwrap();
        assert_eq!(outcome.signatures.len(), 1);
        let sig = &outcome.signatures[0];
        assert!(
            sig.valid,
            "checks: {:?} warnings: {:?}",
            sig.checks, sig.warnings
        );
        assert!(
            sig.trusted,
            "checks: {:?} warnings: {:?}",
            sig.checks, sig.warnings
        );
        assert_eq!(sig.digest_algorithm, "SHA-256");
        assert!(sig.signer.as_deref().unwrap_or("").contains("Test Signer"));
        assert!(sig.signing_time.is_some());
        // Without an anchor the same signature is valid but
        // untrusted — the honest answer for a self-signed cert.
        let outcome2 = engine.verify_signatures(&signed, &[]).unwrap();
        assert!(outcome2.signatures[0].valid);
        assert!(!outcome2.signatures[0].trusted);
    }

    #[test]
    fn verify_detects_tampering() {
        let engine = PdfEngine::default();
        let (key_pem, cert_pem) = test_cert();
        let input = make_pdf(1, "Doc");
        let signed = engine
            .sign(&input, &key_pem, &cert_pem, &SignOptions::default())
            .unwrap();
        // Change one byte of the page content (inside the signed
        // ranges, before the /Contents value).
        let mut tampered = signed.clone();
        let pos = tampered
            .windows(b"Doc page 1".len())
            .position(|w| w == b"Doc page 1")
            .unwrap();
        tampered[pos] = b'X';
        let outcome = engine.verify_signatures(&tampered, &[]).unwrap();
        assert_eq!(outcome.signatures.len(), 1);
        assert!(!outcome.signatures[0].valid);
        assert!(outcome.signatures[0]
            .checks
            .iter()
            .any(|c| c.contains("DOES NOT match")));
    }

    #[test]
    fn verify_unsigned_pdf_reports_no_signatures() {
        let engine = PdfEngine::default();
        let outcome = engine.verify_signatures(&make_pdf(1, "Doc"), &[]).unwrap();
        assert!(outcome.signatures.is_empty());
    }

    #[test]
    fn verify_garbage_signature_is_invalid_not_a_panic() {
        let engine = PdfEngine::default();
        let mut doc = Document::load_mem(&make_pdf(1, "Doc")).unwrap();
        let pages = ordered_pages(&doc);
        let sig_id = doc.add_object(dictionary! {
            "Type" => "Sig",
            "Filter" => "Adobe.PPKLite",
            "SubFilter" => "adbe.pkcs7.detached",
            "ByteRange" => Object::Array(vec![
                Object::Integer(0), Object::Integer(10),
                Object::Integer(20), Object::Integer(30),
            ]),
            "Contents" => Object::String(b"not a cms value".to_vec(), lopdf::StringFormat::Hexadecimal),
        });
        let field_id = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Sig",
            "T" => Object::String(b"Sig1".to_vec(), lopdf::StringFormat::Literal),
            "V" => Object::Reference(sig_id),
            "Rect" => Object::Array(vec![
                Object::Integer(0), Object::Integer(0),
                Object::Integer(0), Object::Integer(0),
            ]),
            "P" => Object::Reference(pages[0].1),
        });
        let root = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        let acro_id = doc.add_object(dictionary! {
            "Fields" => Object::Array(vec![Object::Reference(field_id)]),
            "SigFlags" => Object::Integer(1),
        });
        doc.get_dictionary_mut(root)
            .unwrap()
            .set("AcroForm", Object::Reference(acro_id));
        crate::edit::append_annotation(&mut doc, pages[0].1, field_id).unwrap();
        let mut bytes = Vec::new();
        doc.save_to(&mut std::io::Cursor::new(&mut bytes)).unwrap();
        let outcome = engine.verify_signatures(&bytes, &[]).unwrap();
        assert_eq!(outcome.signatures.len(), 1);
        assert!(!outcome.signatures[0].valid);
        assert!(!outcome.signatures[0].warnings.is_empty());
    }

    #[test]
    fn sign_rejects_bad_key_and_bad_cert() {
        let engine = PdfEngine::default();
        let (key_pem, cert_pem) = test_cert();
        let input = make_pdf(1, "Doc");
        assert!(engine
            .sign(&input, "not a key", &cert_pem, &SignOptions::default())
            .is_err());
        assert!(engine
            .sign(&input, &key_pem, "not a cert", &SignOptions::default())
            .is_err());
    }

    #[test]
    fn sign_accepts_pkcs1_key() {
        // The same key re-serialised as PKCS#1 PEM must also
        // parse (the CLI accepts either form).
        let engine = PdfEngine::default();
        let (key_pem, cert_pem) = test_cert();
        let key = parse_private_key(&key_pem).unwrap();
        use pkcs1::EncodeRsaPrivateKey;
        let pkcs1 = key.to_pkcs1_pem(pkcs1::LineEnding::LF).unwrap();
        let input = make_pdf(1, "Doc");
        let signed = engine
            .sign(&input, pkcs1.as_str(), &cert_pem, &SignOptions::default())
            .unwrap();
        let outcome = engine.verify_signatures(&signed, &[]).unwrap();
        assert!(outcome.signatures[0].valid);
    }

    /// Regression (audit B4): bytes appended after signing left
    /// the old verifier reporting valid — the digest covered only
    /// the declared ranges, and the old /ByteRange check only
    /// asked that each range end inside the file. The ranges must
    /// cover the whole file except the /Contents value.
    #[test]
    fn verify_rejects_bytes_appended_after_signing() {
        let engine = PdfEngine::default();
        let (key_pem, cert_pem) = test_cert();
        let input = make_pdf(1, "Doc");
        let signed = engine
            .sign(&input, &key_pem, &cert_pem, &SignOptions::default())
            .unwrap();
        let mut appended = signed.clone();
        appended.extend_from_slice(b"% trailing garbage appended after signing\n");
        let outcome = engine.verify_signatures(&appended, &[]).unwrap();
        assert_eq!(outcome.signatures.len(), 1);
        assert!(
            !outcome.signatures[0].valid,
            "appended bytes were not detected: {:?}",
            outcome.signatures[0]
        );
        assert!(
            outcome.signatures[0]
                .warnings
                .iter()
                .any(|w| w.contains("ByteRange")),
            "warnings: {:?}",
            outcome.signatures[0].warnings
        );
    }

    /// Regression (audit B5): a signature field listing itself
    /// in /Kids looped forever in `collect_sig_dicts` — the walk
    /// had no visited set. The walk must terminate (here the
    /// field has no /V, so no signature is reported at all).
    #[test]
    fn verify_terminates_on_cyclic_acroform_fields() {
        let engine = PdfEngine::default();
        let mut doc = Document::load_mem(&make_pdf(1, "Doc")).unwrap();
        let field_id = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Sig",
            "T" => Object::String(b"Sig1".to_vec(), lopdf::StringFormat::Literal),
        });
        doc.get_dictionary_mut(field_id)
            .unwrap()
            .set("Kids", Object::Array(vec![Object::Reference(field_id)]));
        let root = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        let acro_id = doc.add_object(dictionary! {
            "Fields" => Object::Array(vec![Object::Reference(field_id)]),
            "SigFlags" => Object::Integer(1),
        });
        doc.get_dictionary_mut(root)
            .unwrap()
            .set("AcroForm", Object::Reference(acro_id));
        let mut bytes = Vec::new();
        doc.save_to(&mut std::io::Cursor::new(&mut bytes)).unwrap();
        let outcome = engine.verify_signatures(&bytes, &[]).unwrap();
        assert!(outcome.signatures.is_empty());
    }
}
