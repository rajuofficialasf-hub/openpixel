//! Adapter round-trips through the registry only — no `image` calls
//! in the test except to build the source fixture bytes.

use openpixel_codecs::{CodecRegistry, EncodeParams};
use openpixel_formats::{detect_format, ImageFormat};
use std::io::Cursor;

fn png_fixture_bytes() -> Vec<u8> {
    let mut im = image::RgbaImage::new(16, 12);
    for (x, y, px) in im.enumerate_pixels_mut() {
        *px = image::Rgba([
            (x * 16) as u8,
            (y * 20) as u8,
            200,
            if x < 8 { 255 } else { 90 },
        ]);
    }
    let mut out = Vec::new();
    image::DynamicImage::ImageRgba8(im)
        .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .unwrap();
    out
}

#[test]
fn every_registered_adapter_roundtrips() {
    let registry = CodecRegistry::default();
    let png = png_fixture_bytes();
    let source = registry
        .get(ImageFormat::Png)
        .unwrap()
        .decode(&png)
        .unwrap();
    assert_eq!((source.width, source.height), (16, 12));
    assert!(source.has_alpha());

    for format in registry.registered_formats() {
        let codec = registry.get(format).unwrap();
        let encoded = codec
            .encode(&source, &EncodeParams::default())
            .unwrap_or_else(|e| panic!("encode {format} failed: {e}"));
        assert!(!encoded.is_empty(), "{format} wrote nothing");
        // Re-detect the output (TGA has no signature — skip that check).
        if format != ImageFormat::Tga {
            assert_eq!(detect_format(&encoded), format, "re-detect {format}");
        }
        // And decode it back.
        let back = codec.decode(&encoded).unwrap();
        assert_eq!((back.width, back.height), (16, 12), "decode back {format}");
    }
}

#[test]
fn jpeg_adapter_flattens_alpha() {
    let registry = CodecRegistry::default();
    let png = png_fixture_bytes();
    let source = registry
        .get(ImageFormat::Png)
        .unwrap()
        .decode(&png)
        .unwrap();
    let jpeg = registry
        .get(ImageFormat::Jpeg)
        .unwrap()
        .encode(&source, &EncodeParams::default())
        .unwrap();
    let back = registry
        .get(ImageFormat::Jpeg)
        .unwrap()
        .decode(&jpeg)
        .unwrap();
    assert!(!back.has_alpha());
}

#[test]
fn dimensions_without_full_decode() {
    let registry = CodecRegistry::default();
    let png = png_fixture_bytes();
    let dims = registry
        .get(ImageFormat::Png)
        .unwrap()
        .dimensions(&png)
        .unwrap();
    assert_eq!(dims, (16, 12));
}
