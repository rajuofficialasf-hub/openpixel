use crate::error::{CodecError, CodecResult};
use crate::float::{from_float_dynamic, is_float_source, rgb32f_bytes, rgba32f_bytes};
use crate::traits::{Codec, Decoder, Encoder};
use crate::types::{DecodedImage, EncodeParams};
use image::codecs::openexr::OpenExrEncoder;
use image::ImageEncoder;
use openpixel_formats::{FormatCapability, ImageFormat, MAX_DIMENSION};
use std::io::Cursor;

/// OpenEXR (`.exr`) via image-rs 0.25 + the `exr` crate 1.74 (pure Rust).
/// * Decode: the EXR decoder returns 32-bit float RGB(A); Phase 3
///   clamps to 8-bit SDR (see `float.rs`) and says so in `note`.
///   Multi-part / multi-layer EXR is not handled — the first part is
///   decoded, like multi-page TIFF in Phase 2.
/// * Encode: `OpenExrEncoder` accepts `Rgb32F`/`Rgba32F` only, so
///   8-bit data is scaled to 0.0–1.0 first. Alpha is preserved
///   (Rgba32F) when the source has it.
pub struct ExrCodec;

impl Decoder for ExrCodec {
    fn format(&self) -> ImageFormat {
        ImageFormat::Exr
    }

    fn decode(&self, bytes: &[u8]) -> CodecResult<DecodedImage> {
        let dynamic =
            image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::OpenExr)
                .decode()
                .map_err(|e| CodecError::Decode(e.to_string()))?;
        if is_float_source(&dynamic) {
            Ok(from_float_dynamic(&dynamic))
        } else {
            Ok(DecodedImage::from_dynamic(&dynamic))
        }
    }

    fn dimensions(&self, bytes: &[u8]) -> CodecResult<(u32, u32)> {
        image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::OpenExr)
            .into_dimensions()
            .map_err(|e| CodecError::Decode(e.to_string()))
    }
}

impl Encoder for ExrCodec {
    fn encode(&self, image: &DecodedImage, _params: &EncodeParams) -> CodecResult<Vec<u8>> {
        let mut out: Vec<u8> = Vec::new();
        let mut cursor = Cursor::new(&mut out);
        let encoder = OpenExrEncoder::new(&mut cursor);
        if image.has_alpha() {
            let bytes = rgba32f_bytes(image);
            encoder
                .write_image(
                    &bytes,
                    image.width,
                    image.height,
                    image::ExtendedColorType::Rgba32F,
                )
                .map_err(|e| CodecError::Encode(e.to_string()))?;
        } else {
            let bytes = rgb32f_bytes(image);
            encoder
                .write_image(
                    &bytes,
                    image.width,
                    image.height,
                    image::ExtendedColorType::Rgb32F,
                )
                .map_err(|e| CodecError::Encode(e.to_string()))?;
        }
        Ok(out)
    }
}

impl Codec for ExrCodec {
    fn capability(&self) -> FormatCapability {
        FormatCapability::new(
            ImageFormat::Exr.id(),
            ImageFormat::Exr.extensions().to_vec(),
            ImageFormat::Exr.mime_types().to_vec(),
            true,
            true,
            true,
            false,
            false,
            false,
            false,
            "image-rs 0.25 + exr 1.74 (pure Rust)",
            "BSD-3-Clause (exr crate)",
            "implemented — float values clamped to 8-bit SDR in Phase 3",
            MAX_DIMENSION,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::PixelFormat;

    fn fixture() -> DecodedImage {
        DecodedImage {
            width: 8,
            height: 6,
            pixel_format: PixelFormat::Rgba8,
            data: (0..8 * 6)
                .flat_map(|i| {
                    let x = i % 8;
                    [(x * 30) as u8, 100, 200, if x < 4 { 255 } else { 128 }]
                })
                .collect(),
            is_animated: false,
            frame_count: None,
            note: None,
        }
    }

    #[test]
    fn roundtrip_preserves_dimensions_alpha_and_signature() {
        let codec = ExrCodec;
        let src = fixture();
        let encoded = codec.encode(&src, &EncodeParams::default()).unwrap();
        assert_eq!(&encoded[0..4], b"v/1\x01");
        assert_eq!(openpixel_formats::detect_format(&encoded), ImageFormat::Exr);
        let back = codec.decode(&encoded).unwrap();
        assert_eq!((back.width, back.height), (8, 6));
        assert!(back.has_alpha());
        // EXR stores f32 exactly for 8-bit-scaled values, so the
        // round-trip should be near-exact (alpha 128/255 survives as
        // a float and rounds back).
        let (a, b) = (src.to_rgba8(), back.to_rgba8());
        let mae: f64 = a
            .iter()
            .zip(b.iter())
            .map(|(x, y)| (*x as i32 - *y as i32).abs() as f64)
            .sum::<f64>()
            / a.len() as f64;
        assert!(mae < 2.0, "EXR round-trip MAE too high: {mae}");
        assert_eq!(codec.dimensions(&encoded).unwrap(), (8, 6));
    }

    #[test]
    fn corrupted_input_errors() {
        let codec = ExrCodec;
        assert!(codec.decode(b"v/1\x01").is_err());
        assert!(codec.decode(b"").is_err());
        assert!(codec.decode(b"\xFF\xD8\xFF\xE0garbage").is_err());
    }
}
