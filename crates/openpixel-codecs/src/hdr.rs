use crate::error::{CodecError, CodecResult};
use crate::float::{from_float_dynamic, is_float_source, rgb32f_bytes};
use crate::traits::{Codec, Decoder, Encoder};
use crate::types::{DecodedImage, EncodeParams};
use image::codecs::hdr::HdrEncoder;
use image::ImageEncoder;
use openpixel_formats::{FormatCapability, ImageFormat, MAX_DIMENSION};
use std::io::Cursor;

/// Radiance HDR (`.hdr`, `#?RADIANCE`) via image-rs 0.25 (pure Rust).
/// * Decode: the `hdr` decoder returns 32-bit float RGB; Phase 3
///   clamps to 8-bit SDR (see `float.rs`) and says so in `note`.
/// * Encode: `HdrEncoder` accepts `Rgb32F` only, so 8-bit data is
///   scaled to 0.0–1.0 first. HDR has no alpha — alpha is flattened
///   onto the background colour inside the encoder, like JPEG.
pub struct HdrCodec;

impl Decoder for HdrCodec {
    fn format(&self) -> ImageFormat {
        ImageFormat::Hdr
    }

    fn decode(&self, bytes: &[u8]) -> CodecResult<DecodedImage> {
        let dynamic = image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Hdr)
            .decode()
            .map_err(|e| CodecError::Decode(e.to_string()))?;
        if is_float_source(&dynamic) {
            Ok(from_float_dynamic(&dynamic))
        } else {
            Ok(DecodedImage::from_dynamic(&dynamic))
        }
    }

    fn dimensions(&self, bytes: &[u8]) -> CodecResult<(u32, u32)> {
        image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Hdr)
            .into_dimensions()
            .map_err(|e| CodecError::Decode(e.to_string()))
    }
}

impl Encoder for HdrCodec {
    fn encode(&self, image: &DecodedImage, params: &EncodeParams) -> CodecResult<Vec<u8>> {
        let owned;
        let image = if image.has_alpha() {
            owned = image.flatten_alpha(params.background);
            &owned
        } else {
            image
        };
        let bytes = rgb32f_bytes(image);
        let mut out: Vec<u8> = Vec::new();
        let mut cursor = Cursor::new(&mut out);
        let encoder = HdrEncoder::new(&mut cursor);
        encoder
            .write_image(
                &bytes,
                image.width,
                image.height,
                image::ExtendedColorType::Rgb32F,
            )
            .map_err(|e| CodecError::Encode(e.to_string()))?;
        Ok(out)
    }
}

impl Codec for HdrCodec {
    fn capability(&self) -> FormatCapability {
        FormatCapability::new(
            ImageFormat::Hdr.id(),
            ImageFormat::Hdr.extensions().to_vec(),
            ImageFormat::Hdr.mime_types().to_vec(),
            true,
            true,
            false,
            false,
            false,
            false,
            false,
            "image-rs 0.25 hdr (pure Rust)",
            "MIT OR Apache-2.0",
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
            pixel_format: PixelFormat::Rgb8,
            data: (0..8 * 6)
                .flat_map(|i| {
                    let x = i % 8;
                    [(x * 30) as u8, 100, 200]
                })
                .collect(),
            is_animated: false,
            frame_count: None,
            note: None,
        }
    }

    #[test]
    fn roundtrip_preserves_dimensions_and_signature() {
        let codec = HdrCodec;
        let src = fixture();
        let encoded = codec.encode(&src, &EncodeParams::default()).unwrap();
        assert!(encoded.starts_with(b"#?RADIANCE"));
        assert_eq!(openpixel_formats::detect_format(&encoded), ImageFormat::Hdr);
        let back = codec.decode(&encoded).unwrap();
        assert_eq!((back.width, back.height), (8, 6));
        // RGBE is an 8-bit-per-channel mantissa format: values survive
        // approximately, not exactly. Mean absolute error must stay small.
        let (a, b) = (src.to_rgba8(), back.to_rgba8());
        let mae: f64 = a
            .iter()
            .zip(b.iter())
            .map(|(x, y)| (*x as i32 - *y as i32).abs() as f64)
            .sum::<f64>()
            / a.len() as f64;
        assert!(mae < 4.0, "HDR round-trip MAE too high: {mae}");
        assert_eq!(codec.dimensions(&encoded).unwrap(), (8, 6));
    }

    #[test]
    fn alpha_is_flattened_on_encode() {
        let codec = HdrCodec;
        let mut src = fixture();
        src.pixel_format = PixelFormat::Rgba8;
        src.data = (0..8 * 6).flat_map(|_| [200u8, 100, 50, 128]).collect();
        let encoded = codec
            .encode(
                &src,
                &EncodeParams {
                    background: [255, 255, 255],
                    ..Default::default()
                },
            )
            .unwrap();
        let back = codec.decode(&encoded).unwrap();
        // HDR decode always yields Rgba8 in Phase 3 (float -> Rgba8),
        // so check the *colour*: (200,100,50) at alpha 128 over white
        // flattens to about (227,177,152).
        let px = &back.to_rgba8()[0..4];
        for (got, want) in px.iter().zip([227u8, 177, 152, 255]) {
            assert!((*got as i32 - want as i32).abs() <= 4, "pixel {px:?} off");
        }
    }

    #[test]
    fn corrupted_input_errors() {
        let codec = HdrCodec;
        assert!(codec.decode(b"#?RADIANCE\n").is_err());
        assert!(codec.decode(b"").is_err());
        assert!(codec.decode(b"\xFF\xD8\xFF\xE0garbage").is_err());
    }
}
