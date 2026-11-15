//! Integration tests — real files on disk, real CLI-equivalent engine calls.
//! Fixtures are generated in the test itself (no binary fixtures checked in
//! yet) so the suite is self-contained and reproducible.

use image::{Rgb, RgbImage, Rgba, RgbaImage};
use openpixel_core::{ConvertOptions, Engine, ImageFormat};
use std::fs;

fn rgb_fixture(path: &std::path::Path) {
    let mut im = RgbImage::new(32, 24);
    for (x, y, px) in im.enumerate_pixels_mut() {
        *px = Rgb([(x * 8) as u8, (y * 10) as u8, 200]);
    }
    im.save(path).unwrap();
}

fn rgba_fixture(path: &std::path::Path) {
    let mut im = RgbaImage::new(32, 24);
    for (x, y, px) in im.enumerate_pixels_mut() {
        *px = Rgba([
            (x * 8) as u8,
            (y * 10) as u8,
            200,
            if x < 16 { 255 } else { 90 },
        ]);
    }
    im.save(path).unwrap();
}

#[test]
fn all_implemented_formats_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("src.png");
    rgba_fixture(&src);
    let engine = Engine::default();
    for target in [
        ImageFormat::Png,
        ImageFormat::Jpeg,
        ImageFormat::Bmp,
        ImageFormat::Gif,
        ImageFormat::Tiff,
        ImageFormat::Webp,
        ImageFormat::Tga,
        ImageFormat::Qoi,
    ] {
        let dst = dir.path().join(format!("out.{}", target.extensions()[0]));
        let r = engine
            .convert(&src, &dst, target, &ConvertOptions::default())
            .unwrap_or_else(|e| panic!("convert to {target} failed: {e}"));
        assert_eq!((r.width, r.height), (32, 24));
        assert!(dst.exists());
        assert!(r.output_bytes > 0);
        // Output re-detection must agree with the requested target.
        let info = engine.get_image_info(&dst).unwrap();
        assert_eq!(info.format, target, "re-detect mismatch for {target}");
    }
}

#[test]
fn extension_is_not_trusted_for_source() {
    // A PNG file deliberately named .jpg must still be detected as PNG.
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("lying.jpg");
    rgb_fixture(&src.with_extension("png"));
    fs::rename(src.with_extension("png"), &src).unwrap();
    let engine = Engine::default();
    let info = engine.get_image_info(&src).unwrap();
    assert_eq!(info.format, ImageFormat::Png);
}

#[test]
fn corrupted_file_is_an_error_not_a_crash() {
    let dir = tempfile::tempdir().unwrap();
    let bad = dir.path().join("bad.png");
    // Valid PNG signature, then garbage — decoder must fail cleanly.
    let mut data = b"\x89PNG\r\n\x1A\n".to_vec();
    data.extend_from_slice(b"garbagegarbagegarbage");
    fs::write(&bad, data).unwrap();
    let engine = Engine::default();
    assert!(engine.get_image_info(&bad).is_err());
    let dst = dir.path().join("out.jpg");
    assert!(engine
        .convert(&bad, &dst, ImageFormat::Jpeg, &ConvertOptions::default())
        .is_err());
}

#[test]
fn jpeg_quality_changes_output_size() {
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("src.png");
    rgb_fixture(&src);
    let engine = Engine::default();
    let low = dir.path().join("low.jpg");
    let high = dir.path().join("high.jpg");
    engine
        .convert(
            &src,
            &low,
            ImageFormat::Jpeg,
            &ConvertOptions {
                quality: Some(20),
                ..Default::default()
            },
        )
        .unwrap();
    engine
        .convert(
            &src,
            &high,
            ImageFormat::Jpeg,
            &ConvertOptions {
                quality: Some(95),
                ..Default::default()
            },
        )
        .unwrap();
    // Quality 95 must not be smaller than quality 20 for this photo-like gradient.
    assert!(fs::metadata(high).unwrap().len() >= fs::metadata(low).unwrap().len());
}
