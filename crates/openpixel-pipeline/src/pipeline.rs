use crate::error::PipelineResult;
use crate::operation::{
    check_dimensions, rotated_dimensions, Operation, WatermarkPosition, MAX_DIMENSION, MAX_PIXELS,
};
use image::imageops::FilterType;
use openpixel_codecs::{DecodedImage, PixelFormat};

/// An ordered list of [`Operation`]s, applied in order to a
/// [`DecodedImage`].
///
/// The pipeline is pure: it does no file I/O and knows nothing about
/// formats or codecs. The engine decodes, runs the pipeline, then
/// encodes. An empty pipeline is valid and returns its input
/// unchanged.
///
/// Implementation note: operations that image-rs provides
/// (`imageops` via `DynamicImage`) use it; operations it does not
/// provide (saturation, pad, image watermark, arbitrary rotation)
/// are hand-rolled pixel loops in RGBA8 space. Hand-rolled steps
/// widen greyscale / 16-bit sources to 8-bit RGB(A) — the same
/// 8-bit reduction `DecodedImage::to_rgba8` already documents — and
/// keep the alpha channel exactly when the source had one.
#[derive(Debug, Clone)]
pub struct Pipeline {
    operations: Vec<Operation>,
    max_dimension: u32,
    max_pixels: u64,
}

impl Default for Pipeline {
    /// An empty pipeline with the engine security limits — never
    /// zero limits (a derived `Default` would set both to 0 and
    /// reject every image).
    fn default() -> Self {
        Self::new()
    }
}

impl Pipeline {
    pub fn new() -> Self {
        Self {
            operations: Vec::new(),
            max_dimension: MAX_DIMENSION,
            max_pixels: MAX_PIXELS,
        }
    }

    pub fn from_operations(operations: Vec<Operation>) -> Self {
        Self {
            operations,
            ..Self::new()
        }
    }

    /// Override the dimension/pixel limits (tests use this to check
    /// the limit path without building a 16 384 px image).
    pub fn with_limits(mut self, max_dimension: u32, max_pixels: u64) -> Self {
        self.max_dimension = max_dimension;
        self.max_pixels = max_pixels;
        self
    }

    pub fn push(&mut self, operation: Operation) {
        self.operations.push(operation);
    }

    pub fn operations(&self) -> &[Operation] {
        &self.operations
    }

    pub fn len(&self) -> usize {
        self.operations.len()
    }

    pub fn is_empty(&self) -> bool {
        self.operations.is_empty()
    }

    /// Check the whole pipeline against an image of `width` x
    /// `height` without touching pixels: each operation is validated
    /// against the dimensions the previous one would produce, so a
    /// crop that is valid on the input but out of bounds after a
    /// resize is still caught here, before any work is done.
    pub fn validate(&self, mut width: u32, mut height: u32) -> PipelineResult<()> {
        check_dimensions(width, height, self.max_dimension, self.max_pixels, "input")?;
        for op in &self.operations {
            op.validate(width, height, self.max_dimension, self.max_pixels)?;
            (width, height) = op.output_dimensions(width, height);
        }
        Ok(())
    }

    /// Apply every operation in order. On the first failing operation
    /// the error is returned and no partial image is produced.
    pub fn apply(&self, image: &DecodedImage) -> PipelineResult<DecodedImage> {
        self.validate(image.width, image.height)?;
        let mut current = image.clone();
        for op in &self.operations {
            current = apply_operation(op, &current)?;
            check_dimensions(
                current.width,
                current.height,
                self.max_dimension,
                self.max_pixels,
                op.name(),
            )?;
        }
        Ok(current)
    }
}

fn apply_operation(op: &Operation, image: &DecodedImage) -> PipelineResult<DecodedImage> {
    match op {
        Operation::Resize { width, height } => {
            let out = image
                .to_dynamic()
                .resize_exact(*width, *height, FilterType::Lanczos3);
            Ok(from_dynamic_keep_meta(&out, image))
        }
        Operation::ResizeFit { width, height } => {
            // Fit inside the box, preserving aspect ratio, never
            // upscaling a smaller image.
            if image.width <= *width && image.height <= *height {
                Ok(image.clone())
            } else {
                let out = image
                    .to_dynamic()
                    .resize(*width, *height, FilterType::Lanczos3);
                Ok(from_dynamic_keep_meta(&out, image))
            }
        }
        Operation::ResizeFill { width, height } => {
            let out = image
                .to_dynamic()
                .resize_to_fill(*width, *height, FilterType::Lanczos3);
            Ok(from_dynamic_keep_meta(&out, image))
        }
        Operation::Pad {
            width,
            height,
            color,
        } => Ok(pad(image, *width, *height, *color)),
        Operation::Crop {
            x,
            y,
            width,
            height,
        } => {
            let out = image.to_dynamic().crop_imm(*x, *y, *width, *height);
            Ok(from_dynamic_keep_meta(&out, image))
        }
        Operation::Thumbnail { max_dimension } => {
            // image-rs `thumbnail` upscales a smaller image; the
            // documented contract here is fit-inside, never upscale.
            if image.width <= *max_dimension && image.height <= *max_dimension {
                Ok(image.clone())
            } else {
                let out = image.to_dynamic().thumbnail(*max_dimension, *max_dimension);
                Ok(from_dynamic_keep_meta(&out, image))
            }
        }
        Operation::Rotate90 => Ok(from_dynamic_keep_meta(
            &image.to_dynamic().rotate90(),
            image,
        )),
        Operation::Rotate180 => Ok(from_dynamic_keep_meta(
            &image.to_dynamic().rotate180(),
            image,
        )),
        Operation::Rotate270 => Ok(from_dynamic_keep_meta(
            &image.to_dynamic().rotate270(),
            image,
        )),
        Operation::RotateArbitrary {
            degrees,
            background,
        } => Ok(rotate_arbitrary(image, *degrees, *background)),
        Operation::FlipHorizontal => Ok(from_dynamic_keep_meta(&image.to_dynamic().fliph(), image)),
        Operation::FlipVertical => Ok(from_dynamic_keep_meta(&image.to_dynamic().flipv(), image)),
        Operation::Grayscale => Ok(from_dynamic_keep_meta(
            &image.to_dynamic().grayscale(),
            image,
        )),
        Operation::Brightness { value } => {
            let delta = (value * 255.0).round() as i32;
            Ok(from_dynamic_keep_meta(
                &image.to_dynamic().brighten(delta),
                image,
            ))
        }
        Operation::Contrast { value } => {
            let out = image.to_dynamic().adjust_contrast(value * 100.0);
            Ok(from_dynamic_keep_meta(&out, image))
        }
        Operation::Saturation { value } => Ok(saturate(image, *value)),
        Operation::Blur { sigma } => Ok(from_dynamic_keep_meta(
            &image.to_dynamic().blur(*sigma),
            image,
        )),
        Operation::Sharpen { sigma, threshold } => Ok(from_dynamic_keep_meta(
            &image.to_dynamic().unsharpen(*sigma, *threshold),
            image,
        )),
        Operation::Watermark {
            overlay,
            position,
            opacity,
            margin,
        } => Ok(watermark(image, overlay, *position, *opacity, *margin)),
        Operation::Flatten { background } => Ok(image.flatten_alpha(*background)),
        Operation::Threshold { threshold } => Ok(threshold_image(image, *threshold)),
        Operation::Denoise => Ok(denoise_image(image)),
        Operation::Deskew { max_angle } => Ok(deskew_image(image, *max_angle)),
    }
}

/// `DecodedImage::from_dynamic` drops the source's animation/note
/// metadata; a pipeline step must not silently do that.
fn from_dynamic_keep_meta(img: &image::DynamicImage, src: &DecodedImage) -> DecodedImage {
    let mut out = DecodedImage::from_dynamic(img);
    out.is_animated = src.is_animated;
    out.frame_count = src.frame_count;
    out.note = src.note.clone();
    out
}

/// Rebuild an RGBA8 result as RGB8 when the source had no alpha, so
/// hand-rolled steps do not invent an alpha channel.
fn finish_rgba(rgba: Vec<u8>, width: u32, height: u32, src: &DecodedImage) -> DecodedImage {
    if src.has_alpha() {
        DecodedImage {
            width,
            height,
            pixel_format: PixelFormat::Rgba8,
            data: rgba,
            is_animated: src.is_animated,
            frame_count: src.frame_count,
            note: src.note.clone(),
        }
    } else {
        let rgb: Vec<u8> = rgba
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|p| [p[0], p[1], p[2]])
            .collect();
        DecodedImage {
            width,
            height,
            pixel_format: PixelFormat::Rgb8,
            data: rgb,
            is_animated: src.is_animated,
            frame_count: src.frame_count,
            note: src.note.clone(),
        }
    }
}

/// Standard source-over compositing of one RGBA pixel over another.
/// Returns the composited pixel.
fn composite_over(src: [u8; 4], dst: [u8; 4]) -> [u8; 4] {
    let sa = src[3] as f32 / 255.0;
    let da = dst[3] as f32 / 255.0;
    let out_a = sa + da * (1.0 - sa);
    if out_a <= 0.0 {
        return [0, 0, 0, 0];
    }
    let mut out = [0u8; 4];
    for i in 0..3 {
        let v = (src[i] as f32 * sa + dst[i] as f32 * da * (1.0 - sa)) / out_a;
        out[i] = v.round().clamp(0.0, 255.0) as u8;
    }
    out[3] = (out_a * 255.0).round().clamp(0.0, 255.0) as u8;
    out
}

fn pad(image: &DecodedImage, width: u32, height: u32, color: [u8; 3]) -> DecodedImage {
    // Scale down first if the image does not fit; never upscale here.
    let fitted = if image.width > width || image.height > height {
        image
            .to_dynamic()
            .resize(width, height, FilterType::Lanczos3)
    } else {
        image.to_dynamic()
    };
    let fitted = from_dynamic_keep_meta(&fitted, image);
    let rgba = fitted.to_rgba8();
    let mut canvas = vec![0u8; (width * height * 4) as usize];
    for px in canvas.as_chunks_mut::<4>().0 {
        *px = [color[0], color[1], color[2], 255];
    }
    let ox = (width - fitted.width) / 2;
    let oy = (height - fitted.height) / 2;
    for y in 0..fitted.height {
        for x in 0..fitted.width {
            let src_i = ((y * fitted.width + x) * 4) as usize;
            let dst_i = (((oy + y) * width + (ox + x)) * 4) as usize;
            let src_px = [
                rgba[src_i],
                rgba[src_i + 1],
                rgba[src_i + 2],
                rgba[src_i + 3],
            ];
            let dst_px = [
                canvas[dst_i],
                canvas[dst_i + 1],
                canvas[dst_i + 2],
                canvas[dst_i + 3],
            ];
            canvas[dst_i..dst_i + 4].copy_from_slice(&composite_over(src_px, dst_px));
        }
    }
    finish_rgba(canvas, width, height, image)
}

fn saturate(image: &DecodedImage, value: f32) -> DecodedImage {
    let rgba = image.to_rgba8();
    let mut out = Vec::with_capacity(rgba.len());
    for px in rgba.as_chunks::<4>().0 {
        let (r, g, b, a) = (px[0] as f32, px[1] as f32, px[2] as f32, px[3]);
        // Rec. 601 luma; scaling the distance from luma is the
        // standard saturation adjustment.
        let luma = 0.299 * r + 0.587 * g + 0.114 * b;
        let adj = |c: f32| (luma + (c - luma) * value).round().clamp(0.0, 255.0) as u8;
        out.extend_from_slice(&[adj(r), adj(g), adj(b), a]);
    }
    finish_rgba(out, image.width, image.height, image)
}

fn watermark(
    image: &DecodedImage,
    overlay: &DecodedImage,
    position: WatermarkPosition,
    opacity: f32,
    margin: u32,
) -> DecodedImage {
    let (ox, oy) = position.offset(
        image.width,
        image.height,
        overlay.width,
        overlay.height,
        margin,
    );
    let mut base = image.to_rgba8();
    let over = overlay.to_rgba8();
    for y in 0..overlay.height {
        for x in 0..overlay.width {
            let src_i = ((y * overlay.width + x) * 4) as usize;
            let dst_i = (((oy + y) * image.width + (ox + x)) * 4) as usize;
            let mut src_px = [
                over[src_i],
                over[src_i + 1],
                over[src_i + 2],
                over[src_i + 3],
            ];
            // Fold the requested opacity into the overlay alpha.
            src_px[3] = (src_px[3] as f32 * opacity).round().clamp(0.0, 255.0) as u8;
            let dst_px = [
                base[dst_i],
                base[dst_i + 1],
                base[dst_i + 2],
                base[dst_i + 3],
            ];
            base[dst_i..dst_i + 4].copy_from_slice(&composite_over(src_px, dst_px));
        }
    }
    finish_rgba(base, image.width, image.height, image)
}

fn rotate_arbitrary(image: &DecodedImage, degrees: f32, background: [u8; 3]) -> DecodedImage {
    let (out_w, out_h) = rotated_dimensions(image.width, image.height, degrees);
    let rgba = image.to_rgba8();
    let rad = degrees.to_radians();
    let (cos, sin) = (rad.cos(), rad.sin());
    let (cx_in, cy_in) = (image.width as f32 / 2.0, image.height as f32 / 2.0);
    let (cx_out, cy_out) = (out_w as f32 / 2.0, out_h as f32 / 2.0);
    let mut out = vec![0u8; (out_w * out_h * 4) as usize];
    for y in 0..out_h {
        for x in 0..out_w {
            // Inverse-rotate the output pixel back into source space
            // (nearest neighbour; a 90/180/270 angle should use the
            // exact Rotate90/180/270 operations instead).
            let dx = x as f32 + 0.5 - cx_out;
            let dy = y as f32 + 0.5 - cy_out;
            let sx = cos * dx + sin * dy + cx_in;
            let sy = -sin * dx + cos * dy + cy_in;
            let i = ((y * out_w + x) * 4) as usize;
            if sx >= 0.0 && sy >= 0.0 && sx < image.width as f32 && sy < image.height as f32 {
                let si = ((sy.floor() as u32 * image.width + sx.floor() as u32) * 4) as usize;
                out[i..i + 4].copy_from_slice(&rgba[si..si + 4]);
            } else {
                out[i..i + 4].copy_from_slice(&[background[0], background[1], background[2], 255]);
            }
        }
    }
    finish_rgba(out, out_w, out_h, image)
}

/// Greyscale bytes of an image (luma, 0 = black, 255 = white).
fn to_luma(image: &DecodedImage) -> Vec<u8> {
    image.to_dynamic().to_luma8().into_raw()
}

/// Rebuild a Luma8 image, keeping the source's animation metadata.
fn luma_image(data: Vec<u8>, width: u32, height: u32, src: &DecodedImage) -> DecodedImage {
    DecodedImage {
        width,
        height,
        pixel_format: PixelFormat::Luma8,
        data,
        is_animated: src.is_animated,
        frame_count: src.frame_count,
        note: src.note.clone(),
    }
}

/// Binarise to pure black/white at `threshold`.
fn threshold_image(image: &DecodedImage, threshold: u8) -> DecodedImage {
    let luma = to_luma(image);
    let out: Vec<u8> = luma
        .iter()
        .map(|&v| if v < threshold { 0 } else { 255 })
        .collect();
    luma_image(out, image.width, image.height, image)
}

/// 3x3 median filter on greyscale (salt-and-pepper denoise).
/// Border pixels use the pixels that exist (a smaller window).
fn denoise_image(image: &DecodedImage) -> DecodedImage {
    let luma = to_luma(image);
    let (w, h) = (image.width as usize, image.height as usize);
    let mut out = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut window = [0u8; 9];
            let mut n = 0;
            for dy in -1i32..=1 {
                for dx in -1i32..=1 {
                    let nx = x as i32 + dx;
                    let ny = y as i32 + dy;
                    if nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h {
                        window[n] = luma[ny as usize * w + nx as usize];
                        n += 1;
                    }
                }
            }
            window[..n].sort_unstable();
            out[y * w + x] = window[n / 2];
        }
    }
    luma_image(out, image.width, image.height, image)
}

/// Auto-deskew: estimate the text skew angle and rotate the image
/// back. When no clear angle is found (angle < 0.15°, or no ink at
/// all) the input is returned unchanged — deskew never degrades a
/// straight image.
fn deskew_image(image: &DecodedImage, max_angle: f32) -> DecodedImage {
    let luma = to_luma(image);
    let angle = estimate_skew(&luma, image.width, image.height, max_angle);
    if angle.abs() < 0.15 {
        return image.clone();
    }
    rotate_arbitrary(image, angle, [255, 255, 255])
}

/// Estimate the correction angle (degrees) that straightens the text
/// in a greyscale image, by the horizontal projection profile:
/// downscale to at most 800 px wide, then for each candidate angle
/// rotate the ink points and score the row histogram by the sum of
/// squared row weights — straight text concentrates ink in few
/// rows, so the best angle maximises the score. Returns 0.0 when
/// there is no ink or `max_angle` is 0.
fn estimate_skew(luma: &[u8], width: u32, height: u32, max_angle: f32) -> f32 {
    if max_angle <= 0.0 || width == 0 || height == 0 {
        return 0.0;
    }
    // Downscale factor so the working width is at most 800 px.
    let scale = (800.0 / width as f64).min(1.0);
    let sw = ((width as f64 * scale).round() as usize).max(1);
    let sh = ((height as f64 * scale).round() as usize).max(1);
    // Collect ink points (darkness-weighted) on the downscaled grid.
    let mut points: Vec<(f64, f64, f64)> = Vec::new();
    for y in 0..sh {
        let sy = ((y as f64 / scale) as usize).min(height as usize - 1);
        for x in 0..sw {
            let sx = ((x as f64 / scale) as usize).min(width as usize - 1);
            let v = luma[sy * width as usize + sx];
            if v < 200 {
                points.push((x as f64, y as f64, (200 - v) as f64 / 200.0));
            }
        }
    }
    if points.is_empty() {
        return 0.0;
    }
    let (cx, cy) = (sw as f64 / 2.0, sh as f64 / 2.0);
    let mut best_angle = 0.0f64;
    let mut best_score = f64::NEG_INFINITY;
    let steps = ((max_angle as f64 / 0.25).round() as i32).max(1);
    // Try angles in order of increasing magnitude (0, ±0.25, ±0.5,
    // …) so that a tie — common on perfectly straight pages, where
    // ±0.25° rounds back to the same rows — resolves to the
    // smallest correction, never a spurious rotation.
    let mut candidates: Vec<f64> = vec![0.0];
    for i in 1..=steps {
        candidates.push(i as f64 * 0.25);
        candidates.push(-(i as f64 * 0.25));
    }
    for angle in candidates {
        let rad = angle.to_radians();
        let (sin, cos) = (rad.sin(), rad.cos());
        // Row of each ink point after rotating by `angle` (the same
        // forward map `rotate_arbitrary` uses, so the winning angle
        // is directly the correction to apply).
        let mut rows: std::collections::HashMap<i32, f64> = std::collections::HashMap::new();
        for &(x, y, w) in &points {
            let dx = x - cx;
            let dy = y - cy;
            let r = (dx * sin + dy * cos).round() as i32;
            *rows.entry(r).or_insert(0.0) += w;
        }
        let score: f64 = rows.values().map(|v| v * v).sum();
        if score > best_score {
            best_score = score;
            best_angle = angle;
        }
    }
    best_angle as f32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::PipelineError;
    use openpixel_codecs::PixelFormat;

    /// 8x6 RGB image: R = x*30, G = y*40, B = 128 — every pixel
    /// distinct, so flips/crops/rotations are checkable by value.
    fn rgb_image() -> DecodedImage {
        let mut data = Vec::new();
        for y in 0..6 {
            for x in 0..8 {
                data.extend_from_slice(&[x as u8 * 30, y as u8 * 40, 128]);
            }
        }
        DecodedImage {
            width: 8,
            height: 6,
            pixel_format: PixelFormat::Rgb8,
            data,
            is_animated: false,
            frame_count: None,
            note: None,
        }
    }

    fn rgba_image() -> DecodedImage {
        let mut data = Vec::new();
        for y in 0..6 {
            for x in 0..8 {
                data.extend_from_slice(&[x as u8 * 30, y as u8 * 40, 128, 255]);
            }
        }
        DecodedImage {
            width: 8,
            height: 6,
            pixel_format: PixelFormat::Rgba8,
            data,
            is_animated: false,
            frame_count: None,
            note: None,
        }
    }

    fn rgb_px(img: &DecodedImage, x: u32, y: u32) -> [u8; 3] {
        let i = ((y * img.width + x) * 3) as usize;
        [img.data[i], img.data[i + 1], img.data[i + 2]]
    }

    fn rgba_px(img: &DecodedImage, x: u32, y: u32) -> [u8; 4] {
        let rgba = img.to_rgba8();
        let i = ((y * img.width + x) * 4) as usize;
        [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
    }

    #[test]
    fn empty_pipeline_is_a_noop() {
        let img = rgb_image();
        let out = Pipeline::new().apply(&img).unwrap();
        assert_eq!((out.width, out.height), (8, 6));
        assert_eq!(out.data, img.data);
    }

    #[test]
    fn resize_exact_dimensions() {
        let out = Pipeline::from_operations(vec![Operation::Resize {
            width: 4,
            height: 3,
        }])
        .apply(&rgb_image())
        .unwrap();
        assert_eq!((out.width, out.height), (4, 3));
    }

    #[test]
    fn resize_fit_preserves_aspect() {
        // 8x6 into a 4x4 box -> 4x3, not 4x4.
        let out = Pipeline::from_operations(vec![Operation::ResizeFit {
            width: 4,
            height: 4,
        }])
        .apply(&rgb_image())
        .unwrap();
        assert_eq!((out.width, out.height), (4, 3));
        // Never upscales: 8x6 already fits in a 64x64 box.
        let out = Pipeline::from_operations(vec![Operation::ResizeFit {
            width: 64,
            height: 64,
        }])
        .apply(&rgb_image())
        .unwrap();
        assert_eq!((out.width, out.height), (8, 6));
        assert_eq!(out.data, rgb_image().data);
    }

    #[test]
    fn resize_fill_is_exact() {
        let out = Pipeline::from_operations(vec![Operation::ResizeFill {
            width: 4,
            height: 4,
        }])
        .apply(&rgb_image())
        .unwrap();
        assert_eq!((out.width, out.height), (4, 4));
    }

    #[test]
    fn pad_centres_and_fills_background() {
        let out = Pipeline::from_operations(vec![Operation::Pad {
            width: 12,
            height: 10,
            color: [255, 0, 0],
        }])
        .apply(&rgb_image())
        .unwrap();
        assert_eq!((out.width, out.height), (12, 10));
        assert_eq!(rgb_px(&out, 0, 0), [255, 0, 0]);
        // Centred: (12-8)/2 = 2, (10-6)/2 = 2, so original (0,0)
        // lands at (2,2).
        assert_eq!(rgb_px(&out, 2, 2), [0, 0, 128]);
        assert_eq!(rgb_px(&out, 9, 7), [210, 200, 128]);
    }

    #[test]
    fn crop_dimensions_and_content() {
        let out = Pipeline::from_operations(vec![Operation::Crop {
            x: 2,
            y: 1,
            width: 3,
            height: 2,
        }])
        .apply(&rgb_image())
        .unwrap();
        assert_eq!((out.width, out.height), (3, 2));
        // Cropped (0,0) is the original (2,1): R=60, G=40.
        assert_eq!(rgb_px(&out, 0, 0), [60, 40, 128]);
        assert_eq!(rgb_px(&out, 2, 1), [120, 80, 128]);
    }

    #[test]
    fn thumbnail_fits_inside_max_dimension() {
        let out = Pipeline::from_operations(vec![Operation::Thumbnail { max_dimension: 4 }])
            .apply(&rgb_image())
            .unwrap();
        assert_eq!((out.width, out.height), (4, 3));
        // Already smaller than the box: no upscale.
        let out = Pipeline::from_operations(vec![Operation::Thumbnail { max_dimension: 64 }])
            .apply(&rgb_image())
            .unwrap();
        assert_eq!((out.width, out.height), (8, 6));
    }

    #[test]
    fn rotate90_swaps_dimensions_and_moves_pixels() {
        let out = Pipeline::from_operations(vec![Operation::Rotate90])
            .apply(&rgb_image())
            .unwrap();
        assert_eq!((out.width, out.height), (6, 8));
        // Clockwise: original top-left (0,0) ends at top-right.
        assert_eq!(rgb_px(&out, 5, 0), [0, 0, 128]);
        // Original bottom-left (0,5) ends at top-left.
        assert_eq!(rgb_px(&out, 0, 0), [0, 200, 128]);
    }

    #[test]
    fn rotate180_keeps_dimensions_and_moves_pixels() {
        let out = Pipeline::from_operations(vec![Operation::Rotate180])
            .apply(&rgb_image())
            .unwrap();
        assert_eq!((out.width, out.height), (8, 6));
        assert_eq!(rgb_px(&out, 0, 0), [210, 200, 128]);
        assert_eq!(rgb_px(&out, 7, 5), [0, 0, 128]);
    }

    #[test]
    fn rotate270_swaps_dimensions() {
        let out = Pipeline::from_operations(vec![Operation::Rotate270])
            .apply(&rgb_image())
            .unwrap();
        assert_eq!((out.width, out.height), (6, 8));
        // Counter-clockwise (270 CW): original top-left ends bottom-left.
        assert_eq!(rgb_px(&out, 0, 7), [0, 0, 128]);
    }

    #[test]
    fn rotate_arbitrary_45_produces_bounding_box_with_background() {
        let out = Pipeline::from_operations(vec![Operation::RotateArbitrary {
            degrees: 45.0,
            background: [255, 0, 0],
        }])
        .apply(&rgb_image())
        .unwrap();
        // ceil(8*cos45 + 6*sin45) = ceil(9.899) = 10 both ways.
        assert_eq!((out.width, out.height), (10, 10));
        assert_eq!(rgb_px(&out, 0, 0), [255, 0, 0]);
    }

    #[test]
    fn flip_horizontal_mirrors_pixels() {
        let out = Pipeline::from_operations(vec![Operation::FlipHorizontal])
            .apply(&rgb_image())
            .unwrap();
        assert_eq!((out.width, out.height), (8, 6));
        assert_eq!(rgb_px(&out, 0, 0), [210, 0, 128]);
        assert_eq!(rgb_px(&out, 7, 0), [0, 0, 128]);
        assert_eq!(rgb_px(&out, 0, 5), [210, 200, 128]);
    }

    #[test]
    fn flip_vertical_mirrors_pixels() {
        let out = Pipeline::from_operations(vec![Operation::FlipVertical])
            .apply(&rgb_image())
            .unwrap();
        assert_eq!((out.width, out.height), (8, 6));
        assert_eq!(rgb_px(&out, 0, 0), [0, 200, 128]);
        assert_eq!(rgb_px(&out, 0, 5), [0, 0, 128]);
    }

    #[test]
    fn grayscale_makes_r_equal_g_equal_b() {
        let out = Pipeline::from_operations(vec![Operation::Grayscale])
            .apply(&rgb_image())
            .unwrap();
        assert_eq!((out.width, out.height), (8, 6));
        assert_eq!(out.pixel_format, PixelFormat::Luma8);
        let rgba = out.to_rgba8();
        for px in rgba.as_chunks::<4>().0 {
            assert_eq!(px[0], px[1]);
            assert_eq!(px[1], px[2]);
        }
    }

    #[test]
    fn brightness_up_is_brighter_and_down_is_darker() {
        let base: u32 = rgb_image().data.iter().map(|v| *v as u32).sum();
        let up = Pipeline::from_operations(vec![Operation::Brightness { value: 0.5 }])
            .apply(&rgb_image())
            .unwrap();
        let down = Pipeline::from_operations(vec![Operation::Brightness { value: -0.5 }])
            .apply(&rgb_image())
            .unwrap();
        let sum_up: u32 = up.data.iter().map(|v| *v as u32).sum();
        let sum_down: u32 = down.data.iter().map(|v| *v as u32).sum();
        assert!(sum_up > base, "brightness +0.5 should raise the sum");
        assert!(sum_down < base, "brightness -0.5 should lower the sum");
    }

    #[test]
    fn contrast_and_saturation_change_pixels() {
        let base = rgb_image();
        let out = Pipeline::from_operations(vec![Operation::Contrast { value: 0.8 }])
            .apply(&base)
            .unwrap();
        assert_ne!(out.data, base.data);
        // Saturation 0 is greyscale.
        let out = Pipeline::from_operations(vec![Operation::Saturation { value: 0.0 }])
            .apply(&base)
            .unwrap();
        let rgba = out.to_rgba8();
        for px in rgba.as_chunks::<4>().0 {
            assert_eq!(px[0], px[1]);
            assert_eq!(px[1], px[2]);
        }
        // Saturation 1 is (near-)identity.
        let out = Pipeline::from_operations(vec![Operation::Saturation { value: 1.0 }])
            .apply(&base)
            .unwrap();
        assert_eq!(out.data, base.data);
    }

    #[test]
    fn blur_and_sharpen_keep_dimensions() {
        for op in [
            Operation::Blur { sigma: 1.5 },
            Operation::Sharpen {
                sigma: 1.0,
                threshold: 0,
            },
        ] {
            let out = Pipeline::from_operations(vec![op])
                .apply(&rgb_image())
                .unwrap();
            assert_eq!((out.width, out.height), (8, 6));
        }
        // Blur actually smooths: the sharp x-gradient gets flatter.
        let base = rgb_image();
        let blurred = Pipeline::from_operations(vec![Operation::Blur { sigma: 2.0 }])
            .apply(&base)
            .unwrap();
        assert_ne!(blurred.data, base.data);
        assert!(
            rgb_px(&blurred, 0, 0)[0] > 0,
            "blur spreads bright neighbours left"
        );
    }

    #[test]
    fn watermark_opaque_logo_replaces_corner_pixels() {
        let logo = DecodedImage {
            width: 2,
            height: 2,
            pixel_format: PixelFormat::Rgb8,
            data: vec![255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0],
            is_animated: false,
            frame_count: None,
            note: None,
        };
        let out = Pipeline::from_operations(vec![Operation::Watermark {
            overlay: logo,
            position: WatermarkPosition::BottomRight,
            opacity: 1.0,
            margin: 0,
        }])
        .apply(&rgb_image())
        .unwrap();
        assert_eq!((out.width, out.height), (8, 6));
        assert_eq!(rgb_px(&out, 7, 5), [255, 0, 0]);
        assert_eq!(rgb_px(&out, 6, 4), [255, 0, 0]);
        // Untouched corner stays original.
        assert_eq!(rgb_px(&out, 0, 0), [0, 0, 128]);
    }

    #[test]
    fn watermark_half_opacity_blends() {
        let logo = DecodedImage {
            width: 1,
            height: 1,
            pixel_format: PixelFormat::Rgb8,
            data: vec![255, 255, 255],
            is_animated: false,
            frame_count: None,
            note: None,
        };
        let out = Pipeline::from_operations(vec![Operation::Watermark {
            overlay: logo,
            position: WatermarkPosition::TopLeft,
            opacity: 0.5,
            margin: 0,
        }])
        .apply(&rgb_image())
        .unwrap();
        // Base (0,0,128) under 50% white -> ~(128,128,192).
        let px = rgb_px(&out, 0, 0);
        assert_eq!(px, [128, 128, 192]);
    }

    #[test]
    fn flatten_alpha_onto_background() {
        let mut img = rgba_image();
        // Make (0,0) fully transparent, (1,0) half transparent.
        img.data[3] = 0;
        img.data[7] = 128;
        let out = Pipeline::from_operations(vec![Operation::Flatten {
            background: [255, 0, 0],
        }])
        .apply(&img)
        .unwrap();
        assert_eq!(out.pixel_format, PixelFormat::Rgb8);
        assert_eq!(rgb_px(&out, 0, 0), [255, 0, 0]);
        // (1,0): R=30 at alpha 128/255 over red 255.
        assert_eq!(rgb_px(&out, 1, 0)[0], 142);
    }

    #[test]
    fn operations_apply_in_order() {
        // Crop first, then flip: the flipped result must be the flip
        // of the cropped region, not of the whole image.
        let out = Pipeline::from_operations(vec![
            Operation::Crop {
                x: 0,
                y: 0,
                width: 4,
                height: 6,
            },
            Operation::FlipHorizontal,
        ])
        .apply(&rgb_image())
        .unwrap();
        assert_eq!((out.width, out.height), (4, 6));
        assert_eq!(rgb_px(&out, 0, 0), [90, 0, 128]);
        // Reversed order gives a different image.
        let out2 = Pipeline::from_operations(vec![
            Operation::FlipHorizontal,
            Operation::Crop {
                x: 0,
                y: 0,
                width: 4,
                height: 6,
            },
        ])
        .apply(&rgb_image())
        .unwrap();
        assert_eq!(rgb_px(&out2, 0, 0), [210, 0, 128]);
        assert_ne!(out.data, out2.data);
    }

    #[test]
    fn metadata_survives_pipeline() {
        let mut img = rgb_image();
        img.note = Some("source had 2 frames".to_string());
        img.is_animated = true;
        img.frame_count = Some(2);
        let out = Pipeline::from_operations(vec![Operation::Rotate90])
            .apply(&img)
            .unwrap();
        assert_eq!(out.note.as_deref(), Some("source had 2 frames"));
        assert!(out.is_animated);
        assert_eq!(out.frame_count, Some(2));
    }

    #[test]
    fn resize_to_zero_is_an_error() {
        let err = Pipeline::from_operations(vec![Operation::Resize {
            width: 0,
            height: 10,
        }])
        .apply(&rgb_image())
        .unwrap_err();
        assert!(matches!(err, PipelineError::InvalidArgument(_)));
    }

    #[test]
    fn crop_out_of_bounds_is_an_error() {
        for crop in [
            Operation::Crop {
                x: 6,
                y: 0,
                width: 4,
                height: 2,
            },
            Operation::Crop {
                x: 0,
                y: 0,
                width: 8,
                height: 7,
            },
            Operation::Crop {
                x: 8,
                y: 0,
                width: 1,
                height: 1,
            },
        ] {
            let err = Pipeline::from_operations(vec![crop])
                .apply(&rgb_image())
                .unwrap_err();
            assert!(matches!(err, PipelineError::InvalidArgument(_)));
        }
    }

    #[test]
    fn oversize_result_is_a_limit_error() {
        // A small custom limit, so the test needs no huge image.
        let pipeline = Pipeline::from_operations(vec![Operation::Resize {
            width: 100,
            height: 100,
        }])
        .with_limits(64, 1_000_000);
        let err = pipeline.apply(&rgb_image()).unwrap_err();
        assert!(matches!(err, PipelineError::LimitExceeded(_)));
        // Crop after a resize that already shrinks is still checked
        // against the *intermediate* dimensions.
        let err = Pipeline::from_operations(vec![
            Operation::Resize {
                width: 4,
                height: 3,
            },
            Operation::Crop {
                x: 0,
                y: 0,
                width: 8,
                height: 6,
            },
        ])
        .validate(8, 6)
        .unwrap_err();
        assert!(matches!(err, PipelineError::InvalidArgument(_)));
    }

    #[test]
    fn out_of_range_values_are_errors() {
        let bad = [
            Operation::Brightness { value: 1.5 },
            Operation::Brightness { value: -1.5 },
            Operation::Contrast { value: 2.0 },
            Operation::Saturation { value: 2.5 },
            Operation::Saturation { value: -0.1 },
            Operation::Blur { sigma: 0.0 },
            Operation::Blur { sigma: -1.0 },
            Operation::Sharpen {
                sigma: 1.0,
                threshold: 300,
            },
            Operation::Thumbnail { max_dimension: 0 },
        ];
        for op in bad {
            let err = Pipeline::from_operations(vec![op])
                .apply(&rgb_image())
                .unwrap_err();
            assert!(
                matches!(
                    err,
                    PipelineError::InvalidArgument(_) | PipelineError::LimitExceeded(_)
                ),
                "expected an error"
            );
        }
        // Watermark that does not fit, and opacity out of range.
        let big_logo = DecodedImage {
            width: 20,
            height: 20,
            pixel_format: PixelFormat::Rgb8,
            data: vec![0; 20 * 20 * 3],
            is_animated: false,
            frame_count: None,
            note: None,
        };
        assert!(Pipeline::from_operations(vec![Operation::Watermark {
            overlay: big_logo,
            position: WatermarkPosition::TopLeft,
            opacity: 1.0,
            margin: 0,
        }])
        .apply(&rgb_image())
        .is_err());
        let _ = rgba_px(&rgba_image(), 0, 0); // keeps the helper used
                                              // Deskew max angle out of range.
        assert!(
            Pipeline::from_operations(vec![Operation::Deskew { max_angle: 46.0 }])
                .apply(&rgb_image())
                .is_err()
        );
        assert!(
            Pipeline::from_operations(vec![Operation::Deskew { max_angle: -1.0 }])
                .apply(&rgb_image())
                .is_err()
        );
    }

    /// White image with a few grey pixels: threshold at 128 makes
    /// pure black/white only.
    fn grey_image() -> DecodedImage {
        DecodedImage {
            width: 4,
            height: 2,
            pixel_format: PixelFormat::Luma8,
            data: vec![0, 60, 127, 128, 200, 255, 30, 250],
            is_animated: false,
            frame_count: None,
            note: None,
        }
    }

    #[test]
    fn threshold_binarises_at_the_cutoff() {
        let out = Pipeline::from_operations(vec![Operation::Threshold { threshold: 128 }])
            .apply(&grey_image())
            .unwrap();
        assert_eq!(out.pixel_format, PixelFormat::Luma8);
        assert_eq!(out.data, vec![0, 0, 0, 255, 255, 255, 0, 255]);
    }

    #[test]
    fn denoise_removes_a_lone_speck_and_keeps_a_line() {
        // 5x5 white field with one black speck in the middle and a
        // black horizontal band (2 px tall) at the bottom. A 1 px
        // line is indistinguishable from noise to a 3x3 median, so
        // the band must be 2 px to survive — that is the filter
        // working as designed, not a bug.
        let mut data = vec![255u8; 25];
        data[12] = 0;
        for y in 3..5 {
            for x in 0..5 {
                data[y * 5 + x] = 0;
            }
        }
        let img = DecodedImage {
            width: 5,
            height: 5,
            pixel_format: PixelFormat::Luma8,
            data,
            is_animated: false,
            frame_count: None,
            note: None,
        };
        let out = Pipeline::from_operations(vec![Operation::Denoise])
            .apply(&img)
            .unwrap();
        assert_eq!(out.data[12], 255, "lone speck removed");
        for y in 3..5 {
            for x in 0..5 {
                assert_eq!(out.data[y * 5 + x], 0, "band kept");
            }
        }
    }

    /// White page with three horizontal black bars (text-like lines).
    fn lined_page() -> DecodedImage {
        let (w, h) = (200, 120);
        let mut data = vec![255u8; (w * h) as usize];
        for y in [20, 55, 90] {
            for yy in y..y + 6 {
                for x in 20..180 {
                    data[(yy * w + x) as usize] = 0;
                }
            }
        }
        DecodedImage {
            width: w,
            height: h,
            pixel_format: PixelFormat::Luma8,
            data,
            is_animated: false,
            frame_count: None,
            note: None,
        }
    }

    /// Sum of squared row ink — the same score deskew maximises.
    fn row_score(img: &DecodedImage) -> f64 {
        let luma = to_luma(img);
        let w = img.width as usize;
        let mut rows = vec![0f64; img.height as usize];
        for (i, &v) in luma.iter().enumerate() {
            if v < 200 {
                rows[i / w] += (200 - v) as f64 / 200.0;
            }
        }
        rows.iter().map(|v| v * v).sum()
    }

    #[test]
    fn deskew_straightens_a_3_degree_skew() {
        let straight = lined_page();
        let skewed = Pipeline::from_operations(vec![Operation::RotateArbitrary {
            degrees: 3.0,
            background: [255, 255, 255],
        }])
        .apply(&straight)
        .unwrap();
        assert!(
            row_score(&skewed) < row_score(&straight) * 0.9,
            "skew must spread the ink across rows"
        );
        let fixed = Pipeline::from_operations(vec![Operation::Deskew { max_angle: 5.0 }])
            .apply(&skewed)
            .unwrap();
        assert!(
            row_score(&fixed) > row_score(&straight) * 0.9,
            "deskew must restore the row concentration"
        );
    }

    #[test]
    fn deskew_does_not_degrade_a_straight_page() {
        let straight = lined_page();
        let out = Pipeline::from_operations(vec![Operation::Deskew { max_angle: 5.0 }])
            .apply(&straight)
            .unwrap();
        // Either untouched, or rotated by a sub-degree angle that
        // keeps the row concentration essentially intact.
        assert!(
            row_score(&out) >= row_score(&straight) * 0.99,
            "deskew must not degrade a straight page"
        );
        assert!((out.width as i32 - straight.width as i32).abs() <= 2);
        assert!((out.height as i32 - straight.height as i32).abs() <= 2);
    }

    #[test]
    fn deskew_leaves_a_blank_page_untouched() {
        let blank = DecodedImage {
            width: 50,
            height: 50,
            pixel_format: PixelFormat::Luma8,
            data: vec![255; 2500],
            is_animated: false,
            frame_count: None,
            note: None,
        };
        let out = Pipeline::from_operations(vec![Operation::Deskew { max_angle: 5.0 }])
            .apply(&blank)
            .unwrap();
        assert_eq!(out.data, blank.data);
    }
}
