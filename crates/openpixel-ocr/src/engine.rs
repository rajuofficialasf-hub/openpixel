//! The OCR engine contract (Studio Phase 4).
//!
//! `OcrEngine` is the single seam every OCR implementation goes
//! through: Tesseract today, another engine later (PaddleOCR is
//! deferred, not promised). Implementations must never fabricate
//! text — an unreadable image returns an error or an empty result
//! with low confidence, never invented words.

use crate::error::OcrError;
use crate::result::OcrResult;
use openpixel_codecs::DecodedImage;
use std::path::PathBuf;

/// How much preprocessing runs before recognition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PreprocessMode {
    /// No preprocessing: the image goes to the engine as-is
    /// (converted to greyscale only).
    None,
    /// Greyscale + denoise (3x3 median). Best for noisy scans and
    /// clean renders alike; the default (see docs/OCR.md — it
    /// measured best overall).
    #[default]
    Light,
    /// Greyscale + Otsu threshold + denoise + deskew. Best for
    /// noisy scans; can hurt clean images (see docs/OCR.md).
    Full,
}

impl std::str::FromStr for PreprocessMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "none" => Ok(Self::None),
            "light" => Ok(Self::Light),
            "full" => Ok(Self::Full),
            other => Err(format!(
                "unknown preprocess mode '{other}' — use none, light or full"
            )),
        }
    }
}

/// Options for one recognition call.
#[derive(Debug, Clone)]
pub struct OcrOptions {
    /// Languages, e.g. `["eng"]` or `["eng", "ben"]`. The engine
    /// joins them with `+` for Tesseract.
    pub languages: Vec<String>,
    /// Tesseract page segmentation mode (0..=13); 3 = fully
    /// automatic page segmentation (the default).
    pub psm: u8,
    /// Source resolution hint in DPI for the engine (Tesseract
    /// assumes 300 when unknown). `None` lets the engine decide.
    pub dpi: Option<u32>,
    /// Preprocessing to run before recognition.
    pub preprocess: PreprocessMode,
}

impl Default for OcrOptions {
    fn default() -> Self {
        Self {
            languages: vec!["eng".to_string()],
            psm: 3,
            dpi: None,
            preprocess: PreprocessMode::Light,
        }
    }
}

impl OcrOptions {
    /// Tesseract language string, e.g. `"eng+ben"`.
    pub fn language_string(&self) -> String {
        self.languages.join("+")
    }

    /// Validate the options before any work starts.
    pub fn validate(&self) -> Result<(), OcrError> {
        if self.languages.is_empty() {
            return Err(OcrError::Engine(
                "at least one OCR language is required".to_string(),
            ));
        }
        if self.psm > 13 {
            return Err(OcrError::Engine(format!(
                "page segmentation mode {} is out of range 0..=13",
                self.psm
            )));
        }
        for lang in &self.languages {
            if lang.is_empty()
                || !lang
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                return Err(OcrError::Engine(format!(
                    "invalid OCR language name: {lang:?}"
                )));
            }
        }
        Ok(())
    }
}

/// The OCR engine contract.
pub trait OcrEngine {
    /// Short engine name, e.g. `"tesseract"`.
    fn name(&self) -> &'static str;

    /// Engine version string, e.g. `"tesseract 5.3.4"`.
    fn version(&self) -> String;

    /// Languages with traineddata available, e.g. `["ben", "eng"]`.
    /// Used to fail fast with `LanguageDataMissing` instead of
    /// letting the engine fail mid-recognition.
    fn available_languages(&self) -> Vec<String>;

    /// Recognise one image. Never fabricates text.
    fn recognize(&self, image: &DecodedImage, options: &OcrOptions) -> Result<OcrResult, OcrError>;

    /// Fail fast if the engine cannot run at all (missing binary
    /// data, missing tessdata directory, …).
    fn health_check(&self) -> Result<(), OcrError>;
}

/// Candidate tessdata directories, in priority order. `TESSDATA_PREFIX`
/// (the standard Tesseract variable) wins when set; then the usual
/// system locations on Linux/macOS.
pub fn default_tessdata_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(prefix) = std::env::var("TESSDATA_PREFIX") {
        if !prefix.is_empty() {
            dirs.push(PathBuf::from(prefix));
        }
    }
    dirs.extend([
        PathBuf::from("/usr/share/tesseract-ocr/5/tessdata"),
        PathBuf::from("/usr/share/tesseract-ocr/4/tessdata"),
        PathBuf::from("/usr/local/share/tessdata"),
        PathBuf::from("/opt/homebrew/share/tessdata"),
        PathBuf::from("/usr/local/opt/tesseract/share/tessdata"),
    ]);
    dirs
}

/// Resolve the tessdata directory: an explicit path wins, otherwise
/// the first candidate directory that exists and holds at least one
/// `.traineddata` file.
pub fn resolve_tessdata_dir(explicit: Option<&std::path::Path>) -> Result<PathBuf, OcrError> {
    if let Some(dir) = explicit {
        if dir.join("eng.traineddata").exists()
            || dir.read_dir().is_ok_and(|mut d| {
                d.any(|e| {
                    e.map(|e| e.file_name().to_string_lossy().ends_with(".traineddata"))
                        .unwrap_or(false)
                })
            })
        {
            return Ok(dir.to_path_buf());
        }
        return Err(OcrError::LanguageDataMissing(
            "eng".to_string(),
            format!(
                "tessdata directory {} has no .traineddata files",
                dir.display()
            ),
        ));
    }
    for dir in default_tessdata_dirs() {
        if dir.join("eng.traineddata").exists() {
            return Ok(dir);
        }
    }
    Err(OcrError::Unavailable(
        "no tessdata directory found (set TESSDATA_PREFIX or install tesseract-ocr-eng); see docs/OCR.md".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_validate_rejects_bad_psm_and_lang() {
        let opts = OcrOptions {
            psm: 14,
            ..Default::default()
        };
        assert!(opts.validate().is_err());
        let opts = OcrOptions {
            languages: vec!["eng; rm -rf".to_string()],
            ..Default::default()
        };
        assert!(opts.validate().is_err());
        let opts = OcrOptions {
            languages: vec![],
            ..Default::default()
        };
        assert!(opts.validate().is_err());
        assert!(OcrOptions::default().validate().is_ok());
        assert_eq!(OcrOptions::default().language_string(), "eng");
        let opts = OcrOptions {
            languages: vec!["eng".to_string(), "ben".to_string()],
            ..Default::default()
        };
        assert_eq!(opts.language_string(), "eng+ben");
    }

    #[test]
    fn preprocess_mode_parses() {
        use std::str::FromStr;
        assert_eq!(PreprocessMode::from_str("full"), Ok(PreprocessMode::Full));
        assert_eq!(PreprocessMode::from_str("NONE"), Ok(PreprocessMode::None));
        assert!(PreprocessMode::from_str("bogus").is_err());
    }
}
