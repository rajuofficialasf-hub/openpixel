use crate::error::{CodecError, CodecResult};
use crate::traits::{Codec, Decoder, Encoder};
use crate::types::{DecodedImage, EncodeParams};
use image::codecs::avif::AvifEncoder;
use image::ImageEncoder;
use openpixel_formats::{FormatCapability, ImageFormat, MAX_DIMENSION};
use std::io::Cursor;

/// AVIF via image-rs 0.25 (pure Rust encode, system dav1d decode).
/// * Encode: `ravif` (rav1e) — 8-bit only, still images. Speed 4 is
///   ravif's own default (`AvifEncoder::new`); quality comes from
///   `EncodeParams` (default 80).
/// * Decode: `dav1d` 1.4.1 via the `avif-native` feature — this is a
///   **system C library** (`libdav1d-dev` at build time, `libdav1d7`
///   at runtime; see `scripts/setup/ubuntu-24.04.sh`). Without it the
///   crate does not build. It is the only Phase 3 codec with a C
///   dependency, and it is dynamically linked (BSD-2-Clause).
/// * Still images only: an animated AVIF decodes to its first frame,
///   and the result says so in `note`.
pub struct AvifCodec;

impl Decoder for AvifCodec {
    fn format(&self) -> ImageFormat {
        ImageFormat::Avif
    }

    fn decode(&self, bytes: &[u8]) -> CodecResult<DecodedImage> {
        let dynamic = image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Avif)
            .decode()
            .map_err(|e| CodecError::Decode(e.to_string()))?;
        let mut img = DecodedImage::from_dynamic(&dynamic);
        img.note =
            Some("AVIF: still image; animated AVIF decodes the first frame only".to_string());
        Ok(img)
    }

    fn dimensions(&self, bytes: &[u8]) -> CodecResult<(u32, u32)> {
        image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Avif)
            .into_dimensions()
            .map_err(|e| CodecError::Decode(e.to_string()))
    }
}

impl Encoder for AvifCodec {
    fn encode(&self, image: &DecodedImage, params: &EncodeParams) -> CodecResult<Vec<u8>> {
        // ravif encodes 8-bit RGB/RGBA only — normalise through the
        // canonical conversions (16-bit input drops to 8-bit here).
        let dynamic = image.to_dynamic();
        let mut out: Vec<u8> = Vec::new();
        let mut cursor = Cursor::new(&mut out);
        if image.has_alpha() {
            let rgba = dynamic.to_rgba8();
            let encoder =
                AvifEncoder::new_with_speed_quality(&mut cursor, 4, params.jpeg_quality(80));
            encoder
                .write_image(
                    &rgba,
                    rgba.width(),
                    rgba.height(),
                    image::ExtendedColorType::Rgba8,
                )
                .map_err(|e| CodecError::Encode(e.to_string()))?;
        } else {
            let rgb = dynamic.to_rgb8();
            let encoder =
                AvifEncoder::new_with_speed_quality(&mut cursor, 4, params.jpeg_quality(80));
            encoder
                .write_image(
                    &rgb,
                    rgb.width(),
                    rgb.height(),
                    image::ExtendedColorType::Rgb8,
                )
                .map_err(|e| CodecError::Encode(e.to_string()))?;
        }
        Ok(out)
    }
}

impl Codec for AvifCodec {
    fn capability(&self) -> FormatCapability {
        FormatCapability::new(
            ImageFormat::Avif.id(),
            ImageFormat::Avif.extensions().to_vec(),
            ImageFormat::Avif.mime_types().to_vec(),
            true,
            true,
            true,
            false,
            false,
            false,
            false,
            "ravif 0.13 (encode) + system dav1d 1.4.1 (decode)",
            "BSD-3-Clause (ravif) + BSD-2-Clause (rav1e, dav1d) + MPL-2.0 (mp4parse)",
            "implemented — still images only; 8-bit encode, speed 4",
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
    fn roundtrip_preserves_dimensions_and_detects() {
        let codec = AvifCodec;
        let src = fixture();
        let encoded = codec.encode(&src, &EncodeParams::default()).unwrap();
        assert!(!encoded.is_empty());
        // AVIF container signature: ftypavif.
        assert_eq!(
            openpixel_formats::detect_format(&encoded),
            ImageFormat::Avif
        );
        let back = codec.decode(&encoded).unwrap();
        assert_eq!((back.width, back.height), (16, 12));
        // Lossy AVIF: check the picture is recognisably the same, not
        // pixel-identical — mean absolute error must stay small.
        let (a, b) = (src.to_rgba8(), back.to_rgba8());
        let mae: f64 = a
            .iter()
            .zip(b.iter())
            .map(|(x, y)| (*x as i32 - *y as i32).abs() as f64)
            .sum::<f64>()
            / a.len() as f64;
        assert!(mae < 12.0, "AVIF round-trip MAE too high: {mae}");
        assert_eq!(codec.dimensions(&encoded).unwrap(), (16, 12));
    }

    #[test]
    fn quality_changes_output_size() {
        let codec = AvifCodec;
        let src = fixture();
        let low = codec
            .encode(
                &src,
                &EncodeParams {
                    quality: Some(20),
                    ..Default::default()
                },
            )
            .unwrap();
        let high = codec
            .encode(
                &src,
                &EncodeParams {
                    quality: Some(95),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(
            high.len() > low.len(),
            "q95 {} should exceed q20 {}",
            high.len(),
            low.len()
        );
    }

    #[test]
    fn corrupted_input_errors() {
        let codec = AvifCodec;
        // Valid AVIF signature, truncated body.
        assert!(codec.decode(b"\0\0\0\x18ftypavif").is_err());
        assert!(codec.decode(b"").is_err());
        assert!(codec.decode(b"\xFF\xD8\xFF\xE0garbage").is_err());
    }
}
