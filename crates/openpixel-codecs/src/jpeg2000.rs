use crate::error::{CodecError, CodecResult};
use crate::traits::{Codec, Decoder, Encoder};
use crate::types::{DecodedImage, EncodeParams};
use jpeg2k::{EncodeParameters, Image};
use openpixel_formats::{FormatCapability, ImageFormat, MAX_DIMENSION};

/// JPEG 2000 via `jpeg2k` 0.11, a thin wrapper over `openjp2` 0.7 — a
/// pure-Rust port of OpenJPEG (BSD-2-Clause). No C library is needed
/// for this format at all: the `openjpeg-sys` backend was removed in
/// jpeg2k 0.11, so there is nothing to install in `scripts/setup/`.
///
/// * Decode: `Image::from_bytes` (JP2 container or raw J2K
///   codestream), converted to the canonical image through the
///   `image`-crate integration. First tile/image only; multi-tile
///   images decode to their full extent as one image.
/// * Encode: lossless only (`EncodeParameters::new` is lossless,
///   single layer, one tile) as a JP2 container, so the output
///   carries the `jP  ` signature and re-detects as JPEG 2000.
///   `EncodeParams.quality` is deliberately ignored — the encoder
///   has no lossy quality knob in this configuration.
pub struct Jpeg2000Codec;

impl Decoder for Jpeg2000Codec {
    fn format(&self) -> ImageFormat {
        ImageFormat::Jpeg2000
    }

    fn decode(&self, bytes: &[u8]) -> CodecResult<DecodedImage> {
        let image = Image::from_bytes(bytes).map_err(|e| CodecError::Decode(e.to_string()))?;
        if image.width() == 0 || image.height() == 0 {
            return Err(CodecError::InvalidInput(
                "JPEG 2000 image has zero width or height".to_string(),
            ));
        }
        let dynamic: image::DynamicImage = (&image)
            .try_into()
            .map_err(|e: jpeg2k::Error| CodecError::Decode(e.to_string()))?;
        Ok(DecodedImage::from_dynamic(&dynamic))
    }
}

impl Encoder for Jpeg2000Codec {
    fn encode(&self, image: &DecodedImage, _params: &EncodeParams) -> CodecResult<Vec<u8>> {
        let dynamic = image.to_dynamic();
        let jp2 = Image::from_dynamic_image(&dynamic);
        // OpenJPEG's default is 6 resolutions, which needs each side
        // to be at least 2^5 = 32 px — small images fail
        // `start_compress` with that. Scale the resolution count to
        // the image: n = floor(log2(min_side)) + 1, clamped to 1..=6.
        let min_side = image.width.min(image.height).max(1);
        let resolutions = ((min_side as f32).log2().floor() as u32 + 1).clamp(1, 6);
        jp2.encode_jp2(EncodeParameters::new().num_resolutions(resolutions))
            .map_err(|e| CodecError::Encode(e.to_string()))
    }
}

impl Codec for Jpeg2000Codec {
    fn capability(&self) -> FormatCapability {
        FormatCapability::new(
            ImageFormat::Jpeg2000.id(),
            ImageFormat::Jpeg2000.extensions().to_vec(),
            ImageFormat::Jpeg2000.mime_types().to_vec(),
            true,
            true,
            true,
            false,
            false,
            true,
            false,
            "jpeg2k 0.11 / openjp2 0.7 (pure-Rust OpenJPEG port)",
            "BSD-2-Clause (OpenJPEG)",
            "implemented — encode is lossless-only",
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
            width: 16,
            height: 12,
            pixel_format: PixelFormat::Rgba8,
            data: (0..16 * 12)
                .flat_map(|i| {
                    let x = i % 16;
                    [
                        ((x * 16) % 256) as u8,
                        120,
                        200,
                        if x < 8 { 255 } else { 90 },
                    ]
                })
                .collect(),
            is_animated: false,
            frame_count: None,
            note: None,
        }
    }

    #[test]
    fn roundtrip_is_lossless_and_detects() {
        let codec = Jpeg2000Codec;
        let src = fixture();
        let encoded = codec.encode(&src, &EncodeParams::default()).unwrap();
        assert!(!encoded.is_empty());
        // JP2 container signature: 00 00 00 0C 6A 50 20 20 ("jP  ").
        assert_eq!(&encoded[0..8], b"\0\0\0\x0CjP  ");
        assert_eq!(
            openpixel_formats::detect_format(&encoded),
            ImageFormat::Jpeg2000
        );
        let back = codec.decode(&encoded).unwrap();
        assert_eq!((back.width, back.height), (16, 12));
        assert_eq!(back.to_rgba8(), src.to_rgba8());
        assert_eq!(codec.dimensions(&encoded).unwrap(), (16, 12));
    }

    #[test]
    fn rgb_roundtrip() {
        let codec = Jpeg2000Codec;
        let src = DecodedImage {
            width: 8,
            height: 8,
            pixel_format: PixelFormat::Rgb8,
            data: (0..8 * 8 * 3).map(|i| ((i * 5) % 256) as u8).collect(),
            is_animated: false,
            frame_count: None,
            note: None,
        };
        let encoded = codec.encode(&src, &EncodeParams::default()).unwrap();
        let back = codec.decode(&encoded).unwrap();
        assert_eq!(back.to_rgba8(), src.to_rgba8());
    }

    #[test]
    fn corrupted_input_errors() {
        let codec = Jpeg2000Codec;
        assert!(codec.decode(b"\0\0\0\x0CjP  ").is_err());
        assert!(codec.decode(b"").is_err());
        assert!(codec.decode(b"\xFF\xD8\xFF\xE0garbage").is_err());
    }
}
