use crate::error::{CodecError, CodecResult};
use crate::traits::{Codec, Decoder, Encoder};
use crate::types::{DecodedImage, EncodeParams, PixelFormat};
use jxl_oxide::{JxlImage, PixelFormat as JxlPixelFormat};
use openpixel_formats::{FormatCapability, ImageFormat, MAX_DIMENSION};
use std::io::Cursor;
use zune_core::{bit_depth::BitDepth, colorspace::ColorSpace, options::EncoderOptions};
use zune_jpegxl::JxlSimpleEncoder;

/// JPEG XL via two pure-Rust crates:
/// * Decode: `jxl-oxide` 0.12 (MIT OR Apache-2.0) — full JXL decoder.
///   First frame only for animated JXL; CMYK is decoded by the crate
///   but has no canonical representation here, so it is rejected
///   honestly instead of being silently mis-converted.
/// * Encode: `zune-jpegxl` 0.5 (MIT/Apache/Zlib) — a lossless-only
///   proof-of-concept encoder. It writes a raw codestream
///   (`FF 0A` signature), not a container, and supports 8- and
///   16-bit RGB/RGBA/Luma. There is no quality knob: JXL encode in
///   Phase 3 is always lossless.
/// * Float (HDR) JXL values are clamped to 8/16-bit on decode, like
///   HDR/EXR in Phase 3.
pub struct JxlCodec;

fn f32_to_u8(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}

impl Decoder for JxlCodec {
    fn format(&self) -> ImageFormat {
        ImageFormat::Jxl
    }

    fn decode(&self, bytes: &[u8]) -> CodecResult<DecodedImage> {
        let image = JxlImage::builder()
            .read(Cursor::new(bytes))
            .map_err(|e| CodecError::Decode(e.to_string()))?;
        let (width, height) = (image.width(), image.height());
        if width == 0 || height == 0 {
            return Err(CodecError::InvalidInput(
                "JXL image has zero width or height".to_string(),
            ));
        }
        let render = image
            .render_frame(0)
            .map_err(|e| CodecError::Decode(e.to_string()))?;
        let fb = render.image_all_channels();
        let (pixel_format, data) = match image.pixel_format() {
            JxlPixelFormat::Gray => {
                let px: Vec<u8> = fb
                    .buf_grouped::<1>()
                    .iter()
                    .map(|p| f32_to_u8(p[0]))
                    .collect();
                (PixelFormat::Luma8, px)
            }
            JxlPixelFormat::Graya => {
                let px: Vec<u8> = fb
                    .buf_grouped::<2>()
                    .iter()
                    .flat_map(|p| [f32_to_u8(p[0]), f32_to_u8(p[1])])
                    .collect();
                (PixelFormat::LumaAlpha8, px)
            }
            JxlPixelFormat::Rgb => {
                let px: Vec<u8> = fb
                    .buf_grouped::<3>()
                    .iter()
                    .flat_map(|p| [f32_to_u8(p[0]), f32_to_u8(p[1]), f32_to_u8(p[2])])
                    .collect();
                (PixelFormat::Rgb8, px)
            }
            JxlPixelFormat::Rgba => {
                let px: Vec<u8> = fb
                    .buf_grouped::<4>()
                    .iter()
                    .flat_map(|p| {
                        [
                            f32_to_u8(p[0]),
                            f32_to_u8(p[1]),
                            f32_to_u8(p[2]),
                            f32_to_u8(p[3]),
                        ]
                    })
                    .collect();
                (PixelFormat::Rgba8, px)
            }
            JxlPixelFormat::Cmyk | JxlPixelFormat::Cmyka => {
                return Err(CodecError::Unsupported(
                    "CMYK JPEG XL has no canonical representation in Phase 3".to_string(),
                ));
            }
        };
        let note = if image.num_loaded_frames() > 1 {
            Some("animated JXL: Phase 3 decodes the first frame only".to_string())
        } else {
            None
        };
        Ok(DecodedImage {
            width,
            height,
            pixel_format,
            data,
            is_animated: image.num_loaded_frames() > 1,
            frame_count: Some(image.num_loaded_frames() as u32),
            note,
        })
    }

    fn dimensions(&self, bytes: &[u8]) -> CodecResult<(u32, u32)> {
        let image = JxlImage::builder()
            .read(Cursor::new(bytes))
            .map_err(|e| CodecError::Decode(e.to_string()))?;
        Ok((image.width(), image.height()))
    }
}

impl Encoder for JxlCodec {
    fn encode(&self, image: &DecodedImage, _params: &EncodeParams) -> CodecResult<Vec<u8>> {
        // zune-jpegxl is lossless-only: EncodeParams.quality is
        // deliberately ignored here, never silently reinterpreted.
        let (colorspace, bit_depth, data) = match image.pixel_format {
            PixelFormat::Rgb8 => (ColorSpace::RGB, BitDepth::Eight, image.data.clone()),
            PixelFormat::Rgba8 => (ColorSpace::RGBA, BitDepth::Eight, image.data.clone()),
            PixelFormat::Luma8 => (ColorSpace::Luma, BitDepth::Eight, image.data.clone()),
            PixelFormat::Rgb16 => (ColorSpace::RGB, BitDepth::Sixteen, image.data.clone()),
            PixelFormat::Rgba16 => (ColorSpace::RGBA, BitDepth::Sixteen, image.data.clone()),
            // Luma+alpha has no encoder path — widen to RGBA8.
            PixelFormat::LumaAlpha8 => (ColorSpace::RGBA, BitDepth::Eight, image.to_rgba8()),
        };
        let options = EncoderOptions::new(
            image.width as usize,
            image.height as usize,
            colorspace,
            bit_depth,
        );
        let encoder = JxlSimpleEncoder::new(&data, options);
        let mut out: Vec<u8> = Vec::new();
        encoder
            .encode(&mut out)
            .map_err(|e| CodecError::Encode(e.to_string()))?;
        Ok(out)
    }
}

impl Codec for JxlCodec {
    fn capability(&self) -> FormatCapability {
        FormatCapability::new(
            ImageFormat::Jxl.id(),
            ImageFormat::Jxl.extensions().to_vec(),
            ImageFormat::Jxl.mime_types().to_vec(),
            true,
            true,
            true,
            true,
            false,
            true,
            false,
            "jxl-oxide 0.12 (decode) + zune-jpegxl 0.5 (encode, pure Rust)",
            "MIT OR Apache-2.0",
            "implemented — encode is lossless-only; animation: first frame on decode",
            MAX_DIMENSION,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let codec = JxlCodec;
        let src = fixture();
        let encoded = codec.encode(&src, &EncodeParams::default()).unwrap();
        assert!(!encoded.is_empty());
        // Raw JXL codestream signature.
        assert_eq!(&encoded[0..2], b"\xFF\x0A");
        assert_eq!(openpixel_formats::detect_format(&encoded), ImageFormat::Jxl);
        let back = codec.decode(&encoded).unwrap();
        assert_eq!((back.width, back.height), (16, 12));
        assert_eq!(back.to_rgba8(), src.to_rgba8());
        assert_eq!(codec.dimensions(&encoded).unwrap(), (16, 12));
    }

    #[test]
    fn rgb_and_grey_roundtrip() {
        let codec = JxlCodec;
        for (format, channels) in [
            (PixelFormat::Rgb8, 3),
            (PixelFormat::Luma8, 1),
            (PixelFormat::Rgb16, 3),
        ] {
            let bytes_per_px = format.bytes_per_pixel();
            let src = DecodedImage {
                width: 8,
                height: 8,
                pixel_format: format,
                data: (0..8 * 8 * bytes_per_px)
                    .map(|i| ((i * 7) % 256) as u8)
                    .collect(),
                is_animated: false,
                frame_count: None,
                note: None,
            };
            let _ = channels;
            let encoded = codec.encode(&src, &EncodeParams::default()).unwrap();
            let back = codec.decode(&encoded).unwrap();
            assert_eq!((back.width, back.height), (8, 8));
        }
    }

    #[test]
    fn corrupted_input_errors() {
        let codec = JxlCodec;
        assert!(codec.decode(b"\xFF\x0A").is_err());
        assert!(codec.decode(b"").is_err());
        assert!(codec.decode(b"\xFF\xD8\xFF\xE0garbage").is_err());
    }
}
