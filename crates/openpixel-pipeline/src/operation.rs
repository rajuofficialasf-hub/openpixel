use crate::error::{PipelineError, PipelineResult};
use openpixel_codecs::DecodedImage;
use serde::{Deserialize, Serialize};

/// Maximum dimension (px) and pixel count a pipeline result may have.
/// These mirror the engine security limits (`openpixel-core`); the
/// pipeline enforces them itself so a pipeline can never produce an
/// image the engine would reject.
pub const MAX_DIMENSION: u32 = openpixel_formats::MAX_DIMENSION;
pub const MAX_PIXELS: u64 = 100_000_000;

/// Where an image watermark is placed. `margin` (see
/// [`Operation::Watermark`]) insets the corner positions; `Center`
/// ignores the margin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WatermarkPosition {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    Center,
}

impl WatermarkPosition {
    pub fn from_name(name: &str) -> Option<Self> {
        match name.trim().to_ascii_lowercase().as_str() {
            "top-left" | "top_left" | "topleft" => Some(Self::TopLeft),
            "top-right" | "top_right" | "topright" => Some(Self::TopRight),
            "bottom-left" | "bottom_left" | "bottomleft" => Some(Self::BottomLeft),
            "bottom-right" | "bottom_right" | "bottomright" => Some(Self::BottomRight),
            "center" | "centre" => Some(Self::Center),
            _ => None,
        }
    }

    /// Top-left corner of the overlay inside a `base_w` x `base_h`
    /// image, given the overlay size and margin.
    pub fn offset(
        self,
        base_w: u32,
        base_h: u32,
        overlay_w: u32,
        overlay_h: u32,
        margin: u32,
    ) -> (u32, u32) {
        match self {
            Self::TopLeft => (margin, margin),
            Self::TopRight => (base_w.saturating_sub(margin + overlay_w), margin),
            Self::BottomLeft => (margin, base_h.saturating_sub(margin + overlay_h)),
            Self::BottomRight => (
                base_w.saturating_sub(margin + overlay_w),
                base_h.saturating_sub(margin + overlay_h),
            ),
            Self::Center => (
                base_w.saturating_sub(overlay_w) / 2,
                base_h.saturating_sub(overlay_h) / 2,
            ),
        }
    }
}

/// One step of a processing pipeline.
///
/// Value ranges (validated by [`Operation::validate`], enforced again
/// by [`crate::Pipeline::apply`]):
/// * [`Operation::Brightness`] — `-1.0..=1.0` (`-1` = black, `0` =
///   unchanged, `1` = white). Mapped onto image-rs `brighten`
///   (`-255..=255`).
/// * [`Operation::Contrast`] — `-1.0..=1.0` (`-1` = flat grey, `0` =
///   unchanged, `1` = maximum). Mapped onto image-rs
///   `adjust_contrast` (`-100..=100`).
/// * [`Operation::Saturation`] — `0.0..=2.0` (`0` = greyscale, `1` =
///   unchanged, `2` = double saturation).
/// * [`Operation::Blur`] / [`Operation::Sharpen`] — sigma `> 0` and
///   `<= 100`; sharpen threshold `0..=255`.
/// * [`Operation::Watermark`] — opacity `0.0..=1.0`.
///
/// Text watermarks are deliberately NOT an operation: there is no
/// bundled font and no new system dependency in Phase 4. Use the
/// image watermark (overlay a second image, e.g. a PNG logo) instead.
#[derive(Debug, Clone)]
pub enum Operation {
    /// Scale to exactly `width` x `height`, ignoring aspect ratio.
    Resize { width: u32, height: u32 },
    /// Scale down (never up) to fit inside `width` x `height`,
    /// preserving aspect ratio.
    ResizeFit { width: u32, height: u32 },
    /// Scale and centre-crop so the result is exactly `width` x
    /// `height`, preserving aspect ratio.
    ResizeFill { width: u32, height: u32 },
    /// Fit inside `width` x `height` (scaling down only if needed)
    /// then pad with `color` to exactly that size.
    Pad {
        width: u32,
        height: u32,
        color: [u8; 3],
    },
    /// Keep the rectangle starting at (`x`, `y`) of size
    /// `width` x `height`. Must lie inside the image.
    Crop {
        x: u32,
        y: u32,
        width: u32,
        height: u32,
    },
    /// Fit inside a `max_dimension` x `max_dimension` box,
    /// preserving aspect ratio (never upscales).
    Thumbnail { max_dimension: u32 },
    /// Exact 90-degree clockwise rotation.
    Rotate90,
    /// Exact 180-degree rotation.
    Rotate180,
    /// Exact 270-degree clockwise rotation.
    Rotate270,
    /// Rotation by any finite angle (degrees, clockwise), with the
    /// uncovered corners filled with `background`. The output is the
    /// bounding box of the rotated image.
    RotateArbitrary { degrees: f32, background: [u8; 3] },
    /// Mirror left-right.
    FlipHorizontal,
    /// Mirror top-bottom.
    FlipVertical,
    /// Convert to greyscale (Luma8).
    Grayscale,
    /// Shift brightness; see the range note on the enum.
    Brightness { value: f32 },
    /// Adjust contrast; see the range note on the enum.
    Contrast { value: f32 },
    /// Adjust saturation; see the range note on the enum.
    Saturation { value: f32 },
    /// Gaussian blur with the given sigma.
    Blur { sigma: f32 },
    /// Unsharp mask: `sigma` controls the blur radius, `threshold`
    /// (0..=255) the minimum brightness change that gets sharpened.
    Sharpen { sigma: f32, threshold: i32 },
    /// Overlay a second image at `position` with `opacity`
    /// (0.0 = invisible, 1.0 = opaque), inset by `margin` px at the
    /// corners. The overlay must fit inside the base image.
    Watermark {
        overlay: DecodedImage,
        position: WatermarkPosition,
        opacity: f32,
        margin: u32,
    },
    /// Flatten alpha onto `background`, producing an RGB8 image
    /// (the same flattening the engine applies for formats without
    /// alpha, exposed here as an explicit step).
    Flatten { background: [u8; 3] },
    /// Binarise to pure black/white at `threshold` (0..=255):
    /// pixels below the threshold become black, the rest white.
    /// The output is Luma8. OCR preprocessing (Phase 4) computes
    /// the threshold with Otsu's method and passes it in.
    Threshold { threshold: u8 },
    /// 3x3 median filter on greyscale (salt-and-pepper denoise).
    /// The output is Luma8. OCR preprocessing (Phase 4).
    Denoise,
    /// Auto-deskew: estimate the text skew angle (up to
    /// `max_angle` degrees either way) from the horizontal
    /// projection profile and rotate the image back. No rotation
    /// happens when no clear angle is found. OCR preprocessing
    /// (Phase 4).
    Deskew { max_angle: f32 },
}

impl Operation {
    /// Short stable name, e.g. `"resize"` — used in logs and the CLI.
    pub fn name(&self) -> &'static str {
        match self {
            Self::Resize { .. } => "resize",
            Self::ResizeFit { .. } => "resize-fit",
            Self::ResizeFill { .. } => "resize-fill",
            Self::Pad { .. } => "pad",
            Self::Crop { .. } => "crop",
            Self::Thumbnail { .. } => "thumbnail",
            Self::Rotate90 => "rotate-90",
            Self::Rotate180 => "rotate-180",
            Self::Rotate270 => "rotate-270",
            Self::RotateArbitrary { .. } => "rotate",
            Self::FlipHorizontal => "flip-horizontal",
            Self::FlipVertical => "flip-vertical",
            Self::Grayscale => "grayscale",
            Self::Brightness { .. } => "brightness",
            Self::Contrast { .. } => "contrast",
            Self::Saturation { .. } => "saturation",
            Self::Blur { .. } => "blur",
            Self::Sharpen { .. } => "sharpen",
            Self::Watermark { .. } => "watermark",
            Self::Flatten { .. } => "flatten",
            Self::Threshold { .. } => "threshold",
            Self::Denoise => "denoise",
            Self::Deskew { .. } => "deskew",
        }
    }

    /// Validate this operation against an image of `width` x `height`
    /// under the given limits. Dimension-changing operations also
    /// check their *result* against the limits.
    pub fn validate(
        &self,
        width: u32,
        height: u32,
        max_dimension: u32,
        max_pixels: u64,
    ) -> PipelineResult<()> {
        match self {
            Self::Resize {
                width: w,
                height: h,
            }
            | Self::ResizeFit {
                width: w,
                height: h,
            }
            | Self::ResizeFill {
                width: w,
                height: h,
            } => {
                check_box(*w, *h, max_dimension, max_pixels, self.name())?;
                Ok(())
            }
            Self::Pad {
                width: w,
                height: h,
                ..
            } => {
                check_box(*w, *h, max_dimension, max_pixels, self.name())?;
                Ok(())
            }
            Self::Crop {
                x,
                y,
                width: w,
                height: h,
            } => {
                if *w == 0 || *h == 0 {
                    return Err(PipelineError::invalid(
                        "crop width and height must be greater than 0",
                    ));
                }
                if *x >= width || *y >= height {
                    return Err(PipelineError::invalid(format!(
                        "crop origin ({x}, {y}) is outside the {width}x{height} image"
                    )));
                }
                if x.checked_add(*w).is_none_or(|r| r > width)
                    || y.checked_add(*h).is_none_or(|r| r > height)
                {
                    return Err(PipelineError::invalid(format!(
                        "crop rectangle ({x}, {y}, {w}x{h}) extends outside the {width}x{height} image"
                    )));
                }
                Ok(())
            }
            Self::Thumbnail { max_dimension: m } => {
                if *m == 0 {
                    return Err(PipelineError::invalid(
                        "thumbnail max dimension must be greater than 0",
                    ));
                }
                if *m > max_dimension {
                    return Err(PipelineError::limit(format!(
                        "thumbnail max dimension {m} exceeds the {max_dimension}px limit"
                    )));
                }
                Ok(())
            }
            Self::Rotate90 | Self::Rotate180 | Self::Rotate270 => {
                // 90/270 swap sides; both sides already fit, and the
                // pixel count is unchanged.
                Ok(())
            }
            Self::RotateArbitrary { degrees, .. } => {
                if !degrees.is_finite() {
                    return Err(PipelineError::invalid(
                        "rotate angle must be a finite number of degrees",
                    ));
                }
                let (w, h) = rotated_dimensions(width, height, *degrees);
                check_dimensions(w, h, max_dimension, max_pixels, "rotate")?;
                Ok(())
            }
            Self::FlipHorizontal | Self::FlipVertical | Self::Grayscale | Self::Flatten { .. } => {
                Ok(())
            }
            Self::Brightness { value } => {
                if !value.is_finite() || *value < -1.0 || *value > 1.0 {
                    return Err(PipelineError::invalid(format!(
                        "brightness {value} is out of range -1.0..=1.0"
                    )));
                }
                Ok(())
            }
            Self::Contrast { value } => {
                if !value.is_finite() || *value < -1.0 || *value > 1.0 {
                    return Err(PipelineError::invalid(format!(
                        "contrast {value} is out of range -1.0..=1.0"
                    )));
                }
                Ok(())
            }
            Self::Saturation { value } => {
                if !value.is_finite() || *value < 0.0 || *value > 2.0 {
                    return Err(PipelineError::invalid(format!(
                        "saturation {value} is out of range 0.0..=2.0"
                    )));
                }
                Ok(())
            }
            Self::Blur { sigma } => {
                if !sigma.is_finite() || *sigma <= 0.0 || *sigma > 100.0 {
                    return Err(PipelineError::invalid(format!(
                        "blur sigma {sigma} is out of range 0 < sigma <= 100"
                    )));
                }
                Ok(())
            }
            Self::Sharpen { sigma, threshold } => {
                if !sigma.is_finite() || *sigma <= 0.0 || *sigma > 100.0 {
                    return Err(PipelineError::invalid(format!(
                        "sharpen sigma {sigma} is out of range 0 < sigma <= 100"
                    )));
                }
                if *threshold < 0 || *threshold > 255 {
                    return Err(PipelineError::invalid(format!(
                        "sharpen threshold {threshold} is out of range 0..=255"
                    )));
                }
                Ok(())
            }
            Self::Threshold { .. } | Self::Denoise => Ok(()),
            Self::Deskew { max_angle } => {
                if !max_angle.is_finite() || *max_angle < 0.0 || *max_angle > 45.0 {
                    return Err(PipelineError::invalid(format!(
                        "deskew max angle {max_angle} is out of range 0.0..=45.0"
                    )));
                }
                Ok(())
            }
            Self::Watermark {
                overlay,
                opacity,
                margin,
                position,
            } => {
                if !opacity.is_finite() || *opacity < 0.0 || *opacity > 1.0 {
                    return Err(PipelineError::invalid(format!(
                        "watermark opacity {opacity} is out of range 0.0..=1.0"
                    )));
                }
                if overlay.width == 0 || overlay.height == 0 {
                    return Err(PipelineError::invalid(
                        "watermark image has zero width or height",
                    ));
                }
                let fits = match position {
                    WatermarkPosition::Center => overlay.width <= width && overlay.height <= height,
                    _ => {
                        margin
                            .checked_add(overlay.width)
                            .is_some_and(|r| r <= width)
                            && margin
                                .checked_add(overlay.height)
                                .is_some_and(|r| r <= height)
                    }
                };
                if !fits {
                    return Err(PipelineError::invalid(format!(
                        "watermark ({}x{} at {position:?}, margin {margin}) does not fit inside the {width}x{height} image",
                        overlay.width, overlay.height
                    )));
                }
                Ok(())
            }
        }
    }

    /// Dimensions after this operation, given the input dimensions.
    /// Used by [`crate::Pipeline::validate`] to simulate a whole
    /// pipeline without touching pixels. Mirrors the apply-time
    /// rules, including "never upscale" for fit/thumbnail.
    pub fn output_dimensions(&self, width: u32, height: u32) -> (u32, u32) {
        match self {
            Self::Resize {
                width: w,
                height: h,
            }
            | Self::ResizeFill {
                width: w,
                height: h,
            }
            | Self::Pad {
                width: w,
                height: h,
                ..
            } => (*w, *h),
            Self::ResizeFit {
                width: w,
                height: h,
            } => fit_dimensions(width, height, *w, *h),
            Self::Crop {
                width: w,
                height: h,
                ..
            } => (*w, *h),
            Self::Thumbnail { max_dimension: m } => fit_dimensions(width, height, *m, *m),
            Self::Rotate90 | Self::Rotate270 => (height, width),
            Self::RotateArbitrary { degrees, .. } => rotated_dimensions(width, height, *degrees),
            _ => (width, height),
        }
    }
}

/// Dimensions of a `width` x `height` image fitted inside a
/// `box_w` x `box_h` box, preserving aspect ratio, never upscaling.
fn fit_dimensions(width: u32, height: u32, box_w: u32, box_h: u32) -> (u32, u32) {
    if width <= box_w && height <= box_h {
        (width, height)
    } else {
        let scale = (box_w as f64 / width as f64).min(box_h as f64 / height as f64);
        (
            ((width as f64 * scale).round() as u32).max(1),
            ((height as f64 * scale).round() as u32).max(1),
        )
    }
}

/// Bounding box of a `width` x `height` image rotated by `degrees`.
pub fn rotated_dimensions(width: u32, height: u32, degrees: f32) -> (u32, u32) {
    let rad = degrees.to_radians();
    let (c, s) = (rad.cos().abs(), rad.sin().abs());
    let w = (width as f32 * c + height as f32 * s).ceil().max(1.0) as u32;
    let h = (width as f32 * s + height as f32 * c).ceil().max(1.0) as u32;
    (w, h)
}

fn check_box(
    width: u32,
    height: u32,
    max_dimension: u32,
    max_pixels: u64,
    op: &str,
) -> PipelineResult<()> {
    if width == 0 || height == 0 {
        return Err(PipelineError::invalid(format!(
            "{op} dimensions must be greater than 0, got {width}x{height}"
        )));
    }
    check_dimensions(width, height, max_dimension, max_pixels, op)
}

pub fn check_dimensions(
    width: u32,
    height: u32,
    max_dimension: u32,
    max_pixels: u64,
    op: &str,
) -> PipelineResult<()> {
    if width > max_dimension || height > max_dimension {
        return Err(PipelineError::limit(format!(
            "{op} result {width}x{height} exceeds the {max_dimension}px dimension limit"
        )));
    }
    let pixels = width as u64 * height as u64;
    if pixels > max_pixels {
        return Err(PipelineError::limit(format!(
            "{op} result has {pixels} pixels, exceeding the {max_pixels} pixel limit"
        )));
    }
    Ok(())
}
