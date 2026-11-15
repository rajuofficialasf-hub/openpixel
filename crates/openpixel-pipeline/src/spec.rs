use crate::error::PipelineResult;
use crate::operation::{Operation, WatermarkPosition};
use crate::pipeline::Pipeline;
use openpixel_codecs::DecodedImage;

/// A watermark described separately from the operation, so the CLI
/// can load the overlay image from a file and then build the op.
#[derive(Debug, Clone)]
pub struct WatermarkSpec {
    pub overlay: DecodedImage,
    pub position: WatermarkPosition,
    pub opacity: f32,
    pub margin: u32,
}

/// The flag-style way to build a pipeline: one optional field per
/// operation, assembled in the documented canonical order. Use this
/// when the caller has named flags (the CLI's individual `--resize`,
/// `--grayscale`, … flags). When the caller wants exact ordering,
/// build a [`Pipeline`] from [`Operation`]s directly instead — the
/// CLI's repeatable `--op` flag does that.
///
/// Canonical order (decode -> resize/crop -> rotate/flip -> colour/
/// blur/sharpen -> watermark -> flatten -> encode):
/// 1. resize, resize-fit, resize-fill, pad, crop, thumbnail
/// 2. rotate (90/180/270 exact, otherwise arbitrary with
///    `rotate_background`), flip horizontal, flip vertical
/// 3. grayscale, brightness, contrast, saturation, blur, sharpen
/// 4. watermark
/// 5. flatten (alpha onto a colour)
#[derive(Debug, Clone, Default)]
pub struct PipelineSpec {
    pub resize: Option<(u32, u32)>,
    pub resize_fit: Option<(u32, u32)>,
    pub resize_fill: Option<(u32, u32)>,
    pub pad: Option<(u32, u32, [u8; 3])>,
    pub crop: Option<(u32, u32, u32, u32)>,
    pub thumbnail: Option<u32>,
    /// Degrees. 90/180/270 become the exact operations; any other
    /// finite value becomes `RotateArbitrary` with `rotate_background`.
    pub rotate_degrees: Option<f32>,
    pub rotate_background: [u8; 3],
    pub flip_horizontal: bool,
    pub flip_vertical: bool,
    pub grayscale: bool,
    pub brightness: Option<f32>,
    pub contrast: Option<f32>,
    pub saturation: Option<f32>,
    pub blur: Option<f32>,
    /// (sigma, threshold)
    pub sharpen: Option<(f32, i32)>,
    pub watermark: Option<WatermarkSpec>,
    pub flatten: Option<[u8; 3]>,
}

impl PipelineSpec {
    /// Build the pipeline in canonical order. Validation happens
    /// when the pipeline is applied (dimensions are only known
    /// then), except that a non-finite rotate angle is rejected here.
    pub fn build(self) -> PipelineResult<Pipeline> {
        let mut ops: Vec<Operation> = Vec::new();
        if let Some((w, h)) = self.resize {
            ops.push(Operation::Resize {
                width: w,
                height: h,
            });
        }
        if let Some((w, h)) = self.resize_fit {
            ops.push(Operation::ResizeFit {
                width: w,
                height: h,
            });
        }
        if let Some((w, h)) = self.resize_fill {
            ops.push(Operation::ResizeFill {
                width: w,
                height: h,
            });
        }
        if let Some((w, h, color)) = self.pad {
            ops.push(Operation::Pad {
                width: w,
                height: h,
                color,
            });
        }
        if let Some((x, y, w, h)) = self.crop {
            ops.push(Operation::Crop {
                x,
                y,
                width: w,
                height: h,
            });
        }
        if let Some(m) = self.thumbnail {
            ops.push(Operation::Thumbnail { max_dimension: m });
        }
        if let Some(deg) = self.rotate_degrees {
            if !deg.is_finite() {
                return Err(crate::error::PipelineError::invalid(
                    "rotate angle must be a finite number of degrees",
                ));
            }
            // Exact multiples of 90 use the lossless exact ops; a
            // 360-degree request is a no-op rotation, not an error.
            let norm = ((deg % 360.0) + 360.0) % 360.0;
            if norm == 0.0 {
                // No rotation.
            } else if norm == 90.0 {
                ops.push(Operation::Rotate90);
            } else if norm == 180.0 {
                ops.push(Operation::Rotate180);
            } else if norm == 270.0 {
                ops.push(Operation::Rotate270);
            } else {
                ops.push(Operation::RotateArbitrary {
                    degrees: deg,
                    background: self.rotate_background,
                });
            }
        }
        if self.flip_horizontal {
            ops.push(Operation::FlipHorizontal);
        }
        if self.flip_vertical {
            ops.push(Operation::FlipVertical);
        }
        if self.grayscale {
            ops.push(Operation::Grayscale);
        }
        if let Some(v) = self.brightness {
            ops.push(Operation::Brightness { value: v });
        }
        if let Some(v) = self.contrast {
            ops.push(Operation::Contrast { value: v });
        }
        if let Some(v) = self.saturation {
            ops.push(Operation::Saturation { value: v });
        }
        if let Some(sigma) = self.blur {
            ops.push(Operation::Blur { sigma });
        }
        if let Some((sigma, threshold)) = self.sharpen {
            ops.push(Operation::Sharpen { sigma, threshold });
        }
        if let Some(wm) = self.watermark {
            ops.push(Operation::Watermark {
                overlay: wm.overlay,
                position: wm.position,
                opacity: wm.opacity,
                margin: wm.margin,
            });
        }
        if let Some(bg) = self.flatten {
            ops.push(Operation::Flatten { background: bg });
        }
        Ok(Pipeline::from_operations(ops))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use openpixel_codecs::PixelFormat;

    fn rgb(w: u32, h: u32) -> DecodedImage {
        DecodedImage {
            width: w,
            height: h,
            pixel_format: PixelFormat::Rgb8,
            data: vec![128; (w * h * 3) as usize],
            is_animated: false,
            frame_count: None,
            note: None,
        }
    }

    #[test]
    fn spec_builds_in_canonical_order() {
        // Flags given in any order still assemble resize -> rotate ->
        // grayscale, per the documented canonical order.
        let spec = PipelineSpec {
            grayscale: true,
            rotate_degrees: Some(90.0),
            resize: Some((4, 4)),
            ..Default::default()
        };
        let pipeline = spec.build().unwrap();
        assert_eq!(pipeline.len(), 3);
        assert!(matches!(pipeline.operations()[0], Operation::Resize { .. }));
        assert!(matches!(pipeline.operations()[1], Operation::Rotate90));
        assert!(matches!(pipeline.operations()[2], Operation::Grayscale));
        let out = pipeline.apply(&rgb(8, 6)).unwrap();
        assert_eq!((out.width, out.height), (4, 4));
    }

    #[test]
    fn spec_rotate_45_is_arbitrary_and_360_is_noop() {
        let spec = PipelineSpec {
            rotate_degrees: Some(45.0),
            rotate_background: [0, 0, 0],
            ..Default::default()
        };
        let pipeline = spec.build().unwrap();
        assert_eq!(pipeline.len(), 1);
        assert!(matches!(
            pipeline.operations()[0],
            Operation::RotateArbitrary { .. }
        ));
        let spec = PipelineSpec {
            rotate_degrees: Some(360.0),
            ..Default::default()
        };
        assert!(spec.build().unwrap().is_empty());
    }

    #[test]
    fn spec_empty_is_empty_pipeline() {
        let pipeline = PipelineSpec::default().build().unwrap();
        assert!(pipeline.is_empty());
        let out = pipeline.apply(&rgb(8, 6)).unwrap();
        assert_eq!((out.width, out.height), (8, 6));
    }
}
