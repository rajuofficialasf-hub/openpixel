use crate::error::{CodecError, CodecResult};
use crate::traits::{Codec, Decoder, Encoder};
use crate::types::{DecodedImage, EncodeParams, PixelFormat};
use openpixel_formats::{FormatCapability, ImageFormat, MAX_DIMENSION};

/// Decompression-bomb guard for the HEIC decoder, kept in sync with
/// the engine limit (`openpixel_core::security::MAX_PIXELS`, 100 MP).
/// `heifer`'s own default is 2^28 pixels; we pass the engine limit
/// explicitly so a hostile file is refused before tiles are assembled.
const MAX_PIXELS: u64 = 100_000_000;

/// HEIC / HEIF via `heifer` 0.5.1 — pure Rust, no C library, no
/// `unsafe`, MIT OR Apache-2.0 (see `docs/CODECS.md` for the
/// evaluation: the libheif route was blocked on this machine by a
/// version mismatch, and the pure-Rust route superseded it).
///
/// * Decode: HEVC still pictures, single `hvc1` items and `grid`
///   tiles (what iPhones produce), with the `irot`/`imir`/`clap`
///   transforms applied by the decoder. Colour is converted to sRGB
///   from the embedded ICC profile (e.g. Display P3) or `nclx`
///   information when possible; files whose colour space cannot be
///   converted (e.g. PQ/HLG HDR) fall back to the coded samples and
///   say so in `note`, instead of failing.
/// * 8-bit sources decode to `Rgb8`/`Rgba8`; 10/12-bit sources decode
///   to `Rgb16`/`Rgba16` with samples scaled to the full 16-bit range.
/// * Encode: lossy YCbCr 4:2:0 (BT.601), quality from `EncodeParams`
///   (default 80). Alpha is stored as a monochrome auxiliary image
///   only when some pixel is not fully opaque. There is no pure-Rust
///   lossless HEVC path wired here — quality 100 is still lossy.
/// * Still images only: an image sequence (`.heics`) decodes its
///   primary image; the sequence itself is not enumerated.
pub struct HeicCodec;

/// HEIF is the same container family as HEIC with a generic (`mif1`)
/// major brand instead of `heic`. One adapter serves both; the two
/// structs differ only in the `ImageFormat` they report, because the
/// registry keys codecs by format.
///
/// Brand rewrite on encode: `heifer` always writes the `heic` major
/// brand, but the engine validates encoded output by re-detecting it
/// — `heic`-branded bytes would fail validation for a HEIF target.
/// `HeifCodec::encode` therefore rewrites the 4-byte major brand in
/// the `ftyp` box from `heic` to `mif1` (the generic HEIF brand;
/// `heic` stays listed among the compatible brands, so the file
/// still declares its HEVC items). This is a container-level label
/// change only — no pixel or item bytes are touched — and the result
/// still parses in libheif and in heifer itself (covered by tests).
pub struct HeifCodec;

fn decode_options() -> heifer::Options {
    heifer::Options::new().with_max_pixels(MAX_PIXELS)
}

fn decode_image(bytes: &[u8]) -> CodecResult<DecodedImage> {
    // sRGB first (Display P3 ICC / nclx -> sRGB); fall back to the
    // coded samples only when the colour space is unconvertible.
    // Any other error (corrupt container, bad bitstream) is fatal.
    let (image, srgb_converted) = match heifer::decode_srgb_with_options(bytes, &decode_options()) {
        Ok(img) => (img, true),
        Err(heifer::Error::Unsupported(_)) => (
            heifer::decode_with_options(bytes, &decode_options())
                .map_err(|e| CodecError::Decode(e.to_string()))?,
            false,
        ),
        Err(e) => return Err(CodecError::Decode(e.to_string())),
    };
    if image.width == 0 || image.height == 0 {
        return Err(CodecError::InvalidInput(
            "HEIC image has zero width or height".to_string(),
        ));
    }
    if image.width > MAX_DIMENSION || image.height > MAX_DIMENSION {
        return Err(CodecError::InvalidInput(format!(
            "HEIC dimensions {}x{} exceed max dimension {MAX_DIMENSION}",
            image.width, image.height
        )));
    }
    let bit_depth = image.bit_depth;
    let has_alpha = image.has_alpha;
    let (pixel_format, data) = if bit_depth <= 8 {
        if has_alpha {
            (PixelFormat::Rgba8, image.to_rgba8())
        } else {
            (PixelFormat::Rgb8, image.to_rgb8())
        }
    } else {
        // 10/12-bit samples live in 0..(2^bit_depth - 1); scale them
        // to the full 16-bit range the canonical Rgb16/Rgba16 uses.
        let max = image.max_value() as u32;
        let scaled: Vec<u16> = image
            .data
            .iter()
            .map(|&v| ((v as u32 * 65_535) / max) as u16)
            .collect();
        let bytes: Vec<u8> = scaled.iter().flat_map(|v| v.to_ne_bytes()).collect();
        if has_alpha {
            (PixelFormat::Rgba16, bytes)
        } else {
            (PixelFormat::Rgb16, bytes)
        }
    };
    let mut note = format!("HEIC: still image, {bit_depth}-bit source");
    if !srgb_converted {
        note.push_str("; colour space not converted to sRGB (unsupported transfer/primaries)");
    }
    Ok(DecodedImage {
        width: image.width,
        height: image.height,
        pixel_format,
        data,
        is_animated: false,
        frame_count: None,
        note: Some(note),
    })
}

fn encode_image(image: &DecodedImage, params: &EncodeParams) -> CodecResult<Vec<u8>> {
    let options = heifer::EncodeOptions::new().with_quality(params.jpeg_quality(80));
    let dynamic = image.to_dynamic();
    if image.has_alpha() {
        let rgba = dynamic.to_rgba8();
        heifer::encode_rgba8(image.width, image.height, &rgba, &options)
    } else {
        let rgb = dynamic.to_rgb8();
        heifer::encode_rgb8(image.width, image.height, &rgb, &options)
    }
    .map_err(|e| CodecError::Encode(e.to_string()))
}

fn capability(format: ImageFormat, brand_note: &'static str) -> FormatCapability {
    FormatCapability::new(
        format.id(),
        format.extensions().to_vec(),
        format.mime_types().to_vec(),
        true,
        true,
        true,
        false,
        true,
        true,
        false,
        "heifer 0.5.1 (pure Rust, no C library)",
        "MIT OR Apache-2.0",
        brand_note,
        MAX_DIMENSION,
    )
}

impl Decoder for HeicCodec {
    fn format(&self) -> ImageFormat {
        ImageFormat::Heic
    }

    fn decode(&self, bytes: &[u8]) -> CodecResult<DecodedImage> {
        decode_image(bytes)
    }
}

impl Encoder for HeicCodec {
    fn encode(&self, image: &DecodedImage, params: &EncodeParams) -> CodecResult<Vec<u8>> {
        encode_image(image, params)
    }
}

impl Codec for HeicCodec {
    fn capability(&self) -> FormatCapability {
        capability(
            ImageFormat::Heic,
            "implemented — still images only; lossy 4:2:0 encode, quality 1-100; 8/10/12-bit decode (10/12-bit scaled to 16-bit); sRGB conversion from Display P3 ICC/nclx",
        )
    }
}

impl Decoder for HeifCodec {
    fn format(&self) -> ImageFormat {
        ImageFormat::Heif
    }

    fn decode(&self, bytes: &[u8]) -> CodecResult<DecodedImage> {
        decode_image(bytes)
    }
}

impl Encoder for HeifCodec {
    fn encode(&self, image: &DecodedImage, params: &EncodeParams) -> CodecResult<Vec<u8>> {
        let mut out = encode_image(image, params)?;
        rewrite_major_brand(&mut out, b"heic", b"mif1")?;
        Ok(out)
    }
}

/// Rewrite the major brand of the leading `ftyp` box (`heic` ->
/// `mif1`). Only the 4 brand bytes change; the box size, minor
/// version and compatible-brand list are untouched. Fails cleanly
/// instead of patching anything that does not look exactly like a
/// heifer-written `ftyp` box.
fn rewrite_major_brand(out: &mut [u8], from: &[u8; 4], to: &[u8; 4]) -> CodecResult<()> {
    if out.len() < 16 || &out[4..8] != b"ftyp" || &out[8..12] != from {
        return Err(CodecError::Encode(
            "HEIF encode: unexpected ftyp box, cannot rewrite major brand".to_string(),
        ));
    }
    out[8..12].copy_from_slice(to);
    Ok(())
}

impl Codec for HeifCodec {
    fn capability(&self) -> FormatCapability {
        capability(
            ImageFormat::Heif,
            "implemented — still images only; lossy 4:2:0 encode, quality 1-100; encoder rewrites the `ftyp` major brand `heic` -> `mif1` so output re-detects as HEIF (`heic` stays a compatible brand)",
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

    fn mae(a: &[u8], b: &[u8]) -> f64 {
        a.iter()
            .zip(b.iter())
            .map(|(x, y)| (*x as i32 - *y as i32).abs() as f64)
            .sum::<f64>()
            / a.len() as f64
    }

    /// Apple-encoded fixture + Apple's own reference decode, from
    /// `tests/fixtures/` (see its README for provenance).
    fn decode_fixture(name: &str) -> DecodedImage {
        let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
        let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        HeicCodec
            .decode(&bytes)
            .unwrap_or_else(|e| panic!("{name}: {e}"))
    }

    fn ref_png(name: &str) -> Vec<u8> {
        let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
        let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
            .unwrap()
            .to_rgb8()
            .into_raw()
    }

    /// `DecodedImage` has `to_rgba8()` but no `to_rgb8()` — go through
    /// the `image` crate representation for the RGB comparison.
    fn to_rgb8(img: &DecodedImage) -> Vec<u8> {
        img.to_dynamic().to_rgb8().into_raw()
    }

    #[test]
    fn roundtrip_preserves_dimensions_and_detects() {
        let codec = HeicCodec;
        let src = fixture();
        let encoded = codec.encode(&src, &EncodeParams::default()).unwrap();
        assert!(!encoded.is_empty());
        assert_eq!(encoded[4..8], *b"ftyp");
        assert_eq!(&encoded[8..12], b"heic");
        assert_eq!(
            openpixel_formats::detect_format(&encoded),
            ImageFormat::Heic
        );
        let back = codec.decode(&encoded).unwrap();
        assert_eq!((back.width, back.height), (16, 12));
        assert!(back.has_alpha());
        let (a, b) = (src.to_rgba8(), back.to_rgba8());
        let error = mae(&a, &b);
        assert!(error < 5.0, "HEIC round-trip MAE too high: {error}");
        // Alpha survives: the opaque half stays opaque, the
        // semi-transparent half stays semi-transparent.
        assert_eq!(back.to_rgba8()[3], 255);
        assert!((back.to_rgba8()[8 * 4 + 3] as i32 - 90).abs() < 25);
    }

    #[test]
    fn quality_changes_output_size() {
        let codec = HeicCodec;
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
    fn apple_encoded_fixtures_match_apple_reference() {
        // Real-world encoder (Apple sips) -> our decoder, compared
        // against Apple's own decode of the same file. Lossy 4:2:0
        // means a small drift is expected, never a large one.
        for (heic, reff) in [
            ("flat-64.heic", "flat-64.ref.png"),
            ("checker-64.heic", "checker-64.ref.png"),
            ("rgb-strips-96.heic", "rgb-strips-96.ref.png"),
        ] {
            let img = decode_fixture(heic);
            let reference = ref_png(reff);
            assert_eq!(img.pixel_format, PixelFormat::Rgb8, "{heic} format");
            let error = mae(&to_rgb8(&img), &reference);
            assert!(
                error < 3.0,
                "{heic} MAE vs Apple reference too high: {error}"
            );
        }
    }

    #[test]
    fn apple_grid_fixtures_decode() {
        // iPhone-style grid tiles, including a 2048x1536 photo.
        let img = decode_fixture("checker-1024.heic");
        assert_eq!((img.width, img.height), (1024, 1024));
        let photo = decode_fixture("photo-2048.heic");
        assert_eq!((photo.width, photo.height), (2048, 1536));
        // The checkerboard's top-left cell is white, the cell to its
        // right is black — grid stitching must preserve that.
        let rgb = to_rgb8(&img);
        assert!(rgb[0] > 200, "top-left pixel should be white");
        assert!(rgb[64 * 3] < 55, "pixel at x=64 should be black");
    }

    #[test]
    fn heif_brand_decodes_and_encodes_as_heif() {
        // The generic `mif1` brand routes to Heif, not Heic — the
        // adapter must decode it, and encoding through it must
        // produce bytes that re-detect as HEIF (major brand `mif1`,
        // with `heic` still among the compatible brands).
        let bytes = include_bytes!("../tests/fixtures/flat-64.heic");
        let img = HeifCodec.decode(bytes).unwrap();
        assert_eq!((img.width, img.height), (64, 64));
        assert_eq!(img.pixel_format, PixelFormat::Rgb8);
        let encoded = HeifCodec.encode(&img, &EncodeParams::default()).unwrap();
        assert_eq!(&encoded[4..8], b"ftyp");
        assert_eq!(&encoded[8..12], b"mif1");
        assert_eq!(
            openpixel_formats::detect_format(&encoded),
            ImageFormat::Heif
        );
        // The rewritten file still decodes, and the compatible
        // brands still declare the HEVC items.
        let back = HeifCodec.decode(&encoded).unwrap();
        assert_eq!((back.width, back.height), (64, 64));
        assert!(
            encoded.len() >= 24
                && encoded[16..]
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .any(|brand| brand == b"heic"),
            "compatible brands should still include heic"
        );
    }

    #[test]
    fn corrupted_input_errors() {
        let codec = HeicCodec;
        assert!(codec.decode(b"").is_err());
        assert!(codec.decode(b"\xFF\xD8\xFF\xE0garbage").is_err());
        // Valid HEIC signature, truncated body.
        let encoded = codec.encode(&fixture(), &EncodeParams::default()).unwrap();
        assert!(codec.decode(&encoded[..encoded.len() / 2]).is_err());
        // A PNG is not a HEIC file.
        let png = image::DynamicImage::ImageRgba8(image::RgbaImage::new(4, 4));
        let mut buf = Vec::new();
        png.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .unwrap();
        assert!(codec.decode(&buf).is_err());
    }
}
