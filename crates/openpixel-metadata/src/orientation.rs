//! EXIF orientation normalisation.
//!
//! Maps EXIF orientation values 1–8 onto the pipeline operations
//! that make the stored pixels upright. The mapping follows
//! Pillow's `ImageOps.exif_transpose` (the reference most tools
//! agree on): 6 is a 90° clockwise rotation, 8 is 90°
//! counter-clockwise, 5 is a transpose and 7 is a transverse flip.
//! Verified pixel-for-pixel against Pillow in the Phase 5 manual
//! checks (see `docs/TESTING.md`).

use crate::error::{MetadataError, MetadataResult};
use openpixel_codecs::DecodedImage;
use openpixel_pipeline::{Operation, Pipeline};

/// Pipeline operations that correct `orientation`, in order.
/// Orientation 1 (or anything outside 1..=8) needs no operation.
pub fn orientation_operations(orientation: u8) -> Vec<Operation> {
    match orientation {
        1 => vec![],
        2 => vec![Operation::FlipHorizontal],
        3 => vec![Operation::Rotate180],
        4 => vec![Operation::FlipVertical],
        5 => vec![Operation::Rotate90, Operation::FlipHorizontal],
        6 => vec![Operation::Rotate90],
        7 => vec![Operation::FlipHorizontal, Operation::Rotate90],
        8 => vec![Operation::Rotate270],
        _ => vec![],
    }
}

/// Human-readable description of what orientation `o` means, for
/// warnings and CLI output.
pub fn orientation_description(orientation: u8) -> &'static str {
    match orientation {
        1 => "upright (no transform)",
        2 => "mirrored horizontally",
        3 => "rotated 180°",
        4 => "mirrored vertically",
        5 => "transposed (rotate 90° clockwise, then mirror horizontally)",
        6 => "rotated 90° clockwise",
        7 => "transverse (mirror horizontally, then rotate 90° clockwise)",
        8 => "rotated 90° counter-clockwise",
        _ => "unknown orientation value",
    }
}

/// Apply the orientation correction to `image`, returning the
/// corrected image. Orientation 1 (or absent/invalid) returns the
/// image unchanged.
pub fn normalize_orientation(
    image: &DecodedImage,
    orientation: Option<u8>,
) -> MetadataResult<DecodedImage> {
    let Some(o) = orientation else {
        return Ok(image.clone());
    };
    if o == 1 {
        return Ok(image.clone());
    }
    let ops = orientation_operations(o);
    if ops.is_empty() {
        return Err(MetadataError::InvalidInput(format!(
            "EXIF orientation value {o} is out of range 1..=8"
        )));
    }
    Pipeline::from_operations(ops)
        .apply(image)
        .map_err(|e| MetadataError::InvalidInput(format!("orientation normalisation failed: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use openpixel_codecs::{DecodedImage, PixelFormat};

    /// 4x2 RGB image: R = x*60, G = y*100, B = 128.
    fn rgb_image() -> DecodedImage {
        let mut data = Vec::new();
        for y in 0..2 {
            for x in 0..4 {
                data.extend_from_slice(&[x as u8 * 60, y as u8 * 100, 128]);
            }
        }
        DecodedImage {
            width: 4,
            height: 2,
            pixel_format: PixelFormat::Rgb8,
            data,
            is_animated: false,
            frame_count: None,
            note: None,
        }
    }

    fn px(img: &DecodedImage, x: u32, y: u32) -> [u8; 3] {
        let i = ((y * img.width + x) * 3) as usize;
        [img.data[i], img.data[i + 1], img.data[i + 2]]
    }

    #[test]
    fn orientation_1_is_a_noop() {
        assert!(orientation_operations(1).is_empty());
        let out = normalize_orientation(&rgb_image(), Some(1)).unwrap();
        assert_eq!(out.data, rgb_image().data);
        let out = normalize_orientation(&rgb_image(), None).unwrap();
        assert_eq!(out.data, rgb_image().data);
    }

    #[test]
    fn orientation_6_rotates_90_clockwise_and_swaps_dimensions() {
        let out = normalize_orientation(&rgb_image(), Some(6)).unwrap();
        assert_eq!((out.width, out.height), (2, 4));
        // Clockwise: original top-left (0,0) ends at top-right.
        assert_eq!(px(&out, 1, 0), [0, 0, 128]);
        // Original bottom-left (0,1) ends at top-left.
        assert_eq!(px(&out, 0, 0), [0, 100, 128]);
    }

    #[test]
    fn orientation_8_rotates_90_counter_clockwise() {
        let out = normalize_orientation(&rgb_image(), Some(8)).unwrap();
        assert_eq!((out.width, out.height), (2, 4));
        // Counter-clockwise: original top-left ends at bottom-left.
        assert_eq!(px(&out, 0, 3), [0, 0, 128]);
        assert_eq!(px(&out, 0, 0), [180, 0, 128]);
    }

    #[test]
    fn orientation_3_rotates_180() {
        let out = normalize_orientation(&rgb_image(), Some(3)).unwrap();
        assert_eq!((out.width, out.height), (4, 2));
        assert_eq!(px(&out, 0, 0), [180, 100, 128]);
    }

    #[test]
    fn orientation_2_and_4_mirror() {
        let out = normalize_orientation(&rgb_image(), Some(2)).unwrap();
        assert_eq!(px(&out, 0, 0), [180, 0, 128]);
        let out = normalize_orientation(&rgb_image(), Some(4)).unwrap();
        assert_eq!(px(&out, 0, 0), [0, 100, 128]);
    }

    #[test]
    fn orientations_5_and_7_swap_dimensions() {
        for o in [5u8, 7] {
            let out = normalize_orientation(&rgb_image(), Some(o)).unwrap();
            assert_eq!((out.width, out.height), (2, 4), "orientation {o}");
        }
        // 5 (transpose) and 7 (transverse) are different images.
        let a = normalize_orientation(&rgb_image(), Some(5)).unwrap();
        let b = normalize_orientation(&rgb_image(), Some(7)).unwrap();
        assert_ne!(a.data, b.data);
        // Transpose: original (0,0) stays top-left.
        assert_eq!(px(&a, 0, 0), [0, 0, 128]);
        // Transverse: original (0,0) ends bottom-right.
        assert_eq!(px(&b, 1, 3), [0, 0, 128]);
    }

    #[test]
    fn invalid_orientation_is_an_error() {
        assert!(normalize_orientation(&rgb_image(), Some(9)).is_err());
        assert!(normalize_orientation(&rgb_image(), Some(0)).is_err());
    }
}
