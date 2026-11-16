//! OCR result types (Studio Phase 4).
//!
//! Every result carries its words with bounding boxes and
//! confidences, the mean confidence, and the engine that produced
//! it — so a caller can show, filter, or audit OCR output instead
//! of trusting a bare string. Accuracy is never claimed to be
//! 100%: see the benchmark table in docs/OCR.md.

use serde::{Deserialize, Serialize};

/// One recognised word with its position (pixels, top-left origin)
/// and Tesseract's confidence (0.0..=100.0).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OcrWord {
    pub text: String,
    pub confidence: f32,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// The result of recognising one image.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OcrResult {
    /// Full recognised text, lines joined with `\n` (Tesseract's
    /// own line breaks).
    pub text: String,
    /// Words in reading order, with bounding boxes + confidences.
    pub words: Vec<OcrWord>,
    /// Mean word confidence (0.0..=100.0); 0.0 when no words were
    /// recognised.
    pub mean_confidence: f32,
    /// Languages used, e.g. `"eng"` or `"eng+ben"`.
    pub language: String,
    /// Engine that produced this result, e.g. `"tesseract 5.3.4"`.
    pub engine: String,
    /// Source image size in pixels.
    pub width: u32,
    pub height: u32,
    /// Wall time spent recognising, in milliseconds.
    pub duration_ms: u64,
    /// Preprocessing steps that ran before recognition, e.g.
    /// `["grayscale", "otsu-threshold"]`.
    pub preprocessed: Vec<String>,
}

impl OcrResult {
    /// Words grouped into lines: words whose vertical centres are
    /// within half a median word height of each other share a line.
    /// Lines are ordered top-to-bottom, words left-to-right.
    pub fn lines(&self) -> Vec<Vec<&OcrWord>> {
        if self.words.is_empty() {
            return Vec::new();
        }
        let mut heights: Vec<u32> = self.words.iter().map(|w| w.height).collect();
        heights.sort_unstable();
        let median_h = heights[heights.len() / 2].max(1);
        let tolerance = median_h / 2;

        let mut sorted: Vec<&OcrWord> = self.words.iter().collect();
        sorted.sort_by_key(|w| (w.y, w.x));
        let mut lines: Vec<Vec<&OcrWord>> = Vec::new();
        for word in sorted {
            let cy = word.y + word.height / 2;
            let placed = lines.iter_mut().find(|line: &&mut Vec<&OcrWord>| {
                let first = line[0];
                let first_cy = first.y + first.height / 2;
                cy.abs_diff(first_cy) <= tolerance
            });
            match placed {
                Some(line) => line.push(word),
                None => lines.push(vec![word]),
            }
        }
        for line in &mut lines {
            line.sort_by_key(|w| w.x);
        }
        lines.sort_by_key(|line| line[0].y);
        lines
    }

    /// Plain text rebuilt from the word lines (one line per row).
    /// Useful when the engine's own line breaks are not wanted.
    pub fn lines_text(&self) -> String {
        self.lines()
            .iter()
            .map(|line| {
                line.iter()
                    .map(|w| w.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(text: &str, x: u32, y: u32) -> OcrWord {
        OcrWord {
            text: text.to_string(),
            confidence: 90.0,
            x,
            y,
            width: 40,
            height: 20,
        }
    }

    #[test]
    fn lines_group_words_by_row() {
        let r = OcrResult {
            text: String::new(),
            words: vec![
                word("world", 60, 10),
                word("hello", 10, 10),
                word("second", 10, 50),
            ],
            mean_confidence: 90.0,
            language: "eng".to_string(),
            engine: "test".to_string(),
            width: 200,
            height: 100,
            duration_ms: 1,
            preprocessed: vec![],
        };
        let lines = r.lines();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0][0].text, "hello");
        assert_eq!(lines[0][1].text, "world");
        assert_eq!(r.lines_text(), "hello world\nsecond");
    }

    #[test]
    fn empty_result_has_no_lines() {
        let r = OcrResult {
            text: String::new(),
            words: vec![],
            mean_confidence: 0.0,
            language: "eng".to_string(),
            engine: "test".to_string(),
            width: 0,
            height: 0,
            duration_ms: 0,
            preprocessed: vec![],
        };
        assert!(r.lines().is_empty());
        assert_eq!(r.lines_text(), "");
    }
}
