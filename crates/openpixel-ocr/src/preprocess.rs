//! OCR preprocessing (Studio Phase 4).
//!
//! The pipeline ops live in `openpixel-pipeline` (Threshold,
//! Denoise, Deskew); this module wires them into the three
//! `PreprocessMode`s and provides Otsu's threshold. The benchmark
//! in docs/OCR.md measures each mode — the default (Light) is
//! whatever measures best on clean renders.

use crate::engine::PreprocessMode;
use crate::error::OcrError;
use openpixel_codecs::DecodedImage;
use openpixel_pipeline::{Operation, Pipeline};

/// Otsu's method: the threshold that maximises the between-class
/// variance of the greyscale histogram. Returns 128 for a blank
/// (single-value) image.
pub fn otsu_threshold(luma: &[u8]) -> u8 {
    let mut hist = [0u64; 256];
    for &v in luma {
        hist[v as usize] += 1;
    }
    let total = luma.len() as u64;
    if total == 0 {
        return 128;
    }
    let sum: u64 = hist.iter().enumerate().map(|(i, &c)| i as u64 * c).sum();
    let mut sum_b = 0u64;
    let mut w_b = 0u64;
    // Ties are common (e.g. a two-tone image is split equally well
    // by any threshold between the two tones); return the midpoint
    // of the tied range so the threshold sits between the tones
    // instead of at the first edge.
    let mut best_first = 128u8;
    let mut best_last = 128u8;
    let mut best_var = -1.0f64;
    for (t, &count) in hist.iter().enumerate() {
        w_b += count;
        if w_b == 0 {
            continue;
        }
        let w_f = total - w_b;
        if w_f == 0 {
            break;
        }
        sum_b += t as u64 * count;
        let m_b = sum_b as f64 / w_b as f64;
        let m_f = (sum - sum_b) as f64 / w_f as f64;
        let var = (w_b as f64) * (w_f as f64) * (m_b - m_f) * (m_b - m_f);
        if var > best_var {
            best_var = var;
            best_first = t as u8;
            best_last = t as u8;
        } else if (var - best_var).abs() < f64::EPSILON {
            best_last = t as u8;
        }
    }
    ((best_first as u16 + best_last as u16) / 2) as u8
}

/// Preprocess one image for OCR. Returns the prepared image (always
/// Luma8 after the greyscale step) and the step names that ran, for
/// the result's `preprocessed` field.
pub fn preprocess(
    image: &DecodedImage,
    mode: PreprocessMode,
) -> Result<(DecodedImage, Vec<String>), OcrError> {
    match mode {
        PreprocessMode::None => {
            let out = Pipeline::from_operations(vec![Operation::Grayscale])
                .apply(image)
                .map_err(|e| OcrError::Engine(format!("preprocessing failed: {e}")))?;
            Ok((out, vec!["grayscale".to_string()]))
        }
        PreprocessMode::Light => {
            let out = Pipeline::from_operations(vec![Operation::Grayscale, Operation::Denoise])
                .apply(image)
                .map_err(|e| OcrError::Engine(format!("preprocessing failed: {e}")))?;
            Ok((out, vec!["grayscale".to_string(), "denoise".to_string()]))
        }
        PreprocessMode::Full => {
            // Deskew first (on colour, so the rotation keeps the
            // original pixels), then greyscale, Otsu threshold, denoise.
            let deskewed = Pipeline::from_operations(vec![Operation::Deskew { max_angle: 5.0 }])
                .apply(image)
                .map_err(|e| OcrError::Engine(format!("preprocessing failed: {e}")))?;
            let gray = Pipeline::from_operations(vec![Operation::Grayscale])
                .apply(&deskewed)
                .map_err(|e| OcrError::Engine(format!("preprocessing failed: {e}")))?;
            let luma = gray.to_dynamic().to_luma8().into_raw();
            let threshold = otsu_threshold(&luma);
            let out = Pipeline::from_operations(vec![
                Operation::Threshold { threshold },
                Operation::Denoise,
            ])
            .apply(&gray)
            .map_err(|e| OcrError::Engine(format!("preprocessing failed: {e}")))?;
            Ok((
                out,
                vec![
                    "deskew".to_string(),
                    "grayscale".to_string(),
                    format!("otsu-threshold({threshold})"),
                    "denoise".to_string(),
                ],
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn otsu_splits_a_two_tone_image() {
        // Half the pixels black (0), half white (255).
        let mut luma = vec![0u8; 500];
        luma.extend(vec![255u8; 500]);
        let t = otsu_threshold(&luma);
        assert!(t > 0 && t < 255, "otsu = {t}");
    }

    #[test]
    fn otsu_on_a_blank_image_returns_the_midpoint_default() {
        // A single-value image has no split; the default is 128.
        let t = otsu_threshold(&[200u8; 100]);
        assert_eq!(t, 128);
    }
}
