use crate::format::{detect_format, ImageFormat};
use serde::{Deserialize, Serialize};

/// How a format was identified. The method matters as much as the answer:
/// a signature is evidence, an extension is only a hint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DetectionMethod {
    /// Magic bytes matched. Trust this.
    Signature,
    /// No signature matched; the file extension suggested a format.
    /// Low confidence — the extension may lie.
    Extension,
    /// No signature matched; the MIME type suggested a format.
    Mime,
    /// Nothing matched.
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    High,
    Low,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryResult {
    pub format: ImageFormat,
    pub method: DetectionMethod,
    pub confidence: Confidence,
    /// The format the extension claimed, when it differs from the result.
    /// `Some` here is a warning, not an error: the file may be misnamed.
    pub extension_claim: Option<ImageFormat>,
    /// The format the MIME type claimed, when it differs from the result.
    pub mime_claim: Option<ImageFormat>,
}

impl DiscoveryResult {
    /// True when the extension (or MIME) disagrees with the signature.
    /// Callers should surface this — e.g. "named .jpg but is really PNG".
    pub fn has_mismatch(&self) -> bool {
        self.extension_claim
            .map(|f| f != self.format)
            .unwrap_or(false)
            || self.mime_claim.map(|f| f != self.format).unwrap_or(false)
    }
}

/// Format discovery: signature first, extension / MIME only as a
/// low-confidence fallback. Never let the fallback override a signature.
pub fn discover(bytes: &[u8], extension: Option<&str>, mime: Option<&str>) -> DiscoveryResult {
    let by_signature = detect_format(bytes);
    let extension_claim = extension.and_then(ImageFormat::from_name);
    let mime_claim = mime.and_then(ImageFormat::from_mime);

    if by_signature != ImageFormat::Unknown {
        return DiscoveryResult {
            format: by_signature,
            method: DetectionMethod::Signature,
            confidence: Confidence::High,
            extension_claim: extension_claim.filter(|f| *f != by_signature),
            mime_claim: mime_claim.filter(|f| *f != by_signature),
        };
    }
    if let Some(f) = extension_claim {
        return DiscoveryResult {
            format: f,
            method: DetectionMethod::Extension,
            confidence: Confidence::Low,
            extension_claim: None,
            mime_claim: mime_claim.filter(|m| *m != f),
        };
    }
    if let Some(f) = mime_claim {
        return DiscoveryResult {
            format: f,
            method: DetectionMethod::Mime,
            confidence: Confidence::Low,
            extension_claim: None,
            mime_claim: None,
        };
    }
    DiscoveryResult {
        format: ImageFormat::Unknown,
        method: DetectionMethod::None,
        confidence: Confidence::None,
        extension_claim: None,
        mime_claim: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_beats_lying_extension() {
        let png = b"\x89PNG\r\n\x1A\nxxxx";
        let r = discover(png, Some("jpg"), None);
        assert_eq!(r.format, ImageFormat::Png);
        assert_eq!(r.method, DetectionMethod::Signature);
        assert_eq!(r.confidence, Confidence::High);
        assert!(r.has_mismatch());
        assert_eq!(r.extension_claim, Some(ImageFormat::Jpeg));
    }

    #[test]
    fn extension_is_low_confidence_fallback() {
        // No recognisable signature, but a .png extension.
        let r = discover(b"not an image at all", Some("png"), None);
        assert_eq!(r.format, ImageFormat::Png);
        assert_eq!(r.method, DetectionMethod::Extension);
        assert_eq!(r.confidence, Confidence::Low);
        assert!(!r.has_mismatch());
    }

    #[test]
    fn unknown_when_nothing_matches() {
        let r = discover(b"hello", Some("xyz"), Some("application/octet-stream"));
        assert_eq!(r.format, ImageFormat::Unknown);
        assert_eq!(r.method, DetectionMethod::None);
    }

    #[test]
    fn mime_fallback_when_no_signature_or_extension() {
        let r = discover(b"hello", None, Some("image/jpeg"));
        assert_eq!(r.format, ImageFormat::Jpeg);
        assert_eq!(r.method, DetectionMethod::Mime);
    }
}
