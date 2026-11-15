use crate::error::{CodecError, CodecResult};
use crate::traits::{Codec, Decoder, Encoder};
use crate::types::{DecodedImage, EncodeParams, PixelFormat};
use openpixel_formats::{FormatCapability, ImageFormat, MAX_DIMENSION};

/// Same pixel cap as the engine security layer (`openpixel-core`
/// `MAX_PIXELS`, 100 MP). Kept in sync by hand — the codecs crate
/// cannot depend on core (core depends on codecs).
const MAX_PIXELS: u64 = 100_000_000;

/// SVG rasterisation via resvg 0.48 / usvg 0.48 (pure Rust, MIT OR Apache-2.0).
/// Decode-only: SVG is a vector format, and this engine never does
/// raster-to-vector, so `encode` always returns `Unsupported`.
///
/// Security posture, by construction:
/// * Scripts are never executed — usvg parses SVG as static data.
/// * No external resources, no network: `Options::resources_dir` stays
///   `None`, so `<image href="…">`, `@import` and external fonts are
///   never fetched (usvg leaves them out instead of loading them).
/// * No file access: parsing is from the in-memory bytes only.
/// * Output size is capped: an SVG claiming a huge canvas is scaled
///   down to fit `MAX_DIMENSION` / `MAX_PIXELS` before any pixmap is
///   allocated, so a malicious `width="100000"` cannot OOM the process.
pub struct SvgCodec;

impl SvgCodec {
    /// Parse the SVG and return the raster dimensions after the
    /// security scale-down, without rendering any pixels.
    fn raster_size(bytes: &[u8]) -> CodecResult<(u32, u32)> {
        let tree = parse_svg(bytes)?;
        let size = tree.size();
        let (w, h) = (size.width(), size.height());
        if !(w > 0.0 && h > 0.0) || !w.is_finite() || !h.is_finite() {
            return Err(CodecError::InvalidInput(
                "SVG has no usable width/height (needs width+height or a viewBox)".to_string(),
            ));
        }
        Ok(fit_within_limits(w, h))
    }
}

/// Parse with locked-down options: no external resources, system fonts
/// only (local font files — needed so `<text>` renders at all).
fn parse_svg(bytes: &[u8]) -> CodecResult<usvg::Tree> {
    let mut options = usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    usvg::Tree::from_data(bytes, &options).map_err(|e| CodecError::Decode(e.to_string()))
}

/// Scale (w, h) down proportionally so both limits hold. Never scales up.
fn fit_within_limits(w: f32, h: f32) -> (u32, u32) {
    let mut scale: f32 = 1.0;
    let max_side = w.max(h);
    if max_side > MAX_DIMENSION as f32 {
        scale = scale.min(MAX_DIMENSION as f32 / max_side);
    }
    let pixels = w as f64 * h as f64 * scale as f64 * scale as f64;
    if pixels > MAX_PIXELS as f64 {
        scale = scale.min((MAX_PIXELS as f64 / (w as f64 * h as f64)).sqrt() as f32);
    }
    let (out_w, out_h) = ((w * scale).round() as u32, (h * scale).round() as u32);
    (out_w.max(1), out_h.max(1))
}

impl Decoder for SvgCodec {
    fn format(&self) -> ImageFormat {
        ImageFormat::Svg
    }

    fn decode(&self, bytes: &[u8]) -> CodecResult<DecodedImage> {
        let tree = parse_svg(bytes)?;
        let size = tree.size();
        if !(size.width() > 0.0 && size.height() > 0.0)
            || !size.width().is_finite()
            || !size.height().is_finite()
        {
            return Err(CodecError::InvalidInput(
                "SVG has no usable width/height (needs width+height or a viewBox)".to_string(),
            ));
        }
        let (width, height) = fit_within_limits(size.width(), size.height());
        let scale = width as f32 / size.width();
        let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)
            .ok_or_else(|| CodecError::Decode("SVG raster size is too large".to_string()))?;
        resvg::render(
            &tree,
            resvg::tiny_skia::Transform::from_scale(scale, scale),
            &mut pixmap.as_mut(),
        );
        // tiny-skia stores premultiplied RGBA; the canonical
        // representation is straight-alpha RGBA8, so un-premultiply.
        let mut data = Vec::with_capacity(pixmap.data().len());
        for px in pixmap.data().as_chunks::<4>().0 {
            let (r, g, b, a) = (px[0], px[1], px[2], px[3]);
            if a == 0 {
                data.extend_from_slice(&[0, 0, 0, 0]);
            } else if a == 255 {
                data.extend_from_slice(&[r, g, b, 255]);
            } else {
                let inv = 255.0 / a as f32;
                data.extend_from_slice(&[
                    ((r as f32 * inv).round() as u32).min(255) as u8,
                    ((g as f32 * inv).round() as u32).min(255) as u8,
                    ((b as f32 * inv).round() as u32).min(255) as u8,
                    a,
                ]);
            }
        }
        Ok(DecodedImage {
            width,
            height,
            pixel_format: PixelFormat::Rgba8,
            data,
            is_animated: false,
            frame_count: None,
            note: Some(
                "SVG rasterised at intrinsic size (scaled down only if it exceeded the 16384 px / 100 MP limits)"
                    .to_string(),
            ),
        })
    }

    fn dimensions(&self, bytes: &[u8]) -> CodecResult<(u32, u32)> {
        Self::raster_size(bytes)
    }
}

impl Encoder for SvgCodec {
    fn encode(&self, _image: &DecodedImage, _params: &EncodeParams) -> CodecResult<Vec<u8>> {
        Err(CodecError::Unsupported(
            "SVG is decode-only: raster-to-vector conversion is never supported".to_string(),
        ))
    }
}

impl Codec for SvgCodec {
    fn capability(&self) -> FormatCapability {
        FormatCapability::new(
            ImageFormat::Svg.id(),
            ImageFormat::Svg.extensions().to_vec(),
            ImageFormat::Svg.mime_types().to_vec(),
            true,
            false,
            true,
            false,
            false,
            false,
            false,
            "resvg 0.48.1 / usvg 0.48.1 (pure Rust)",
            "MIT OR Apache-2.0 (resvg/usvg)",
            "implemented — decode (rasterise) only; scripts, external resources and network disabled",
            MAX_DIMENSION,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIMPLE_SVG: &[u8] = br##"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="6"><rect x="0" y="0" width="10" height="6" fill="#ff0000"/></svg>"##;

    #[test]
    fn rasterises_red_rect_with_right_dimensions_and_pixels() {
        let codec = SvgCodec;
        let img = codec.decode(SIMPLE_SVG).unwrap();
        assert_eq!((img.width, img.height), (10, 6));
        assert_eq!(img.pixel_format, PixelFormat::Rgba8);
        // Fully opaque red everywhere (un-premultiplied).
        assert_eq!(&img.data[0..4], &[255, 0, 0, 255]);
        assert_eq!(&img.data[img.data.len() - 4..], &[255, 0, 0, 255]);
        assert_eq!(codec.dimensions(SIMPLE_SVG).unwrap(), (10, 6));
    }

    #[test]
    fn transparent_background_stays_transparent() {
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><circle cx="2" cy="2" r="1" fill="#00ff00"/></svg>"##;
        let img = SvgCodec.decode(svg).unwrap();
        // Corner pixel: nothing drawn -> fully transparent.
        assert_eq!(&img.data[0..4], &[0, 0, 0, 0]);
    }

    #[test]
    fn huge_canvas_is_scaled_down_not_rejected() {
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"><rect width="100000" height="100000" fill="#0000ff"/></svg>"##;
        let (w, h) = SvgCodec.dimensions(svg).unwrap();
        // 16384x16384 would be 268M pixels, over the 100 MP cap — so
        // the pixel cap dominates and the canvas lands at 10000x10000
        // (exactly 100 MP), not at MAX_DIMENSION.
        assert!(w <= MAX_DIMENSION && h <= MAX_DIMENSION);
        assert_eq!((w, h), (10_000, 10_000));
        assert!(w as u64 * h as u64 <= 100_000_000);
        let img = SvgCodec.decode(svg).unwrap();
        assert_eq!((img.width, img.height), (10_000, 10_000));
    }

    #[test]
    fn corrupted_svg_errors_without_panicking() {
        assert!(SvgCodec.decode(b"<svg><rect").is_err());
        assert!(SvgCodec.decode(b"not svg at all").is_err());
        assert!(SvgCodec.decode(b"").is_err());
        assert!(SvgCodec.decode(b"<svg width=\"0\" height=\"0\"/>").is_err());
    }

    #[test]
    fn encode_is_unsupported_by_design() {
        let img = SvgCodec.decode(SIMPLE_SVG).unwrap();
        assert!(matches!(
            SvgCodec.encode(&img, &EncodeParams::default()),
            Err(CodecError::Unsupported(_))
        ));
    }
}
