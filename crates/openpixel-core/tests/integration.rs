//! Integration tests — real files on disk, real CLI-equivalent engine calls.
//! Fixtures are generated in the test itself (no binary fixtures checked in
//! yet) so the suite is self-contained and reproducible.

use image::{Rgb, RgbImage, Rgba, RgbaImage};
use openpixel_core::{
    ConvertOptions, Engine, ImageFormat, Operation, Pipeline, PipelineSpec, ProcessOptions,
    WatermarkPosition, WatermarkSpec,
};
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
fn process_combined_pipeline_end_to_end() {
    // Resize + grayscale + rotate through the engine, verified on
    // the re-decoded output file — not just on dimensions.
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("src.png");
    rgba_fixture(&src);
    let dst = dir.path().join("out.jpg");
    let engine = Engine::default();
    let pipeline = Pipeline::from_operations(vec![
        Operation::Resize {
            width: 16,
            height: 12,
        },
        Operation::Grayscale,
        Operation::Rotate90,
    ]);
    let opts = ProcessOptions::new(ConvertOptions::default(), pipeline);
    let r = engine
        .process(&src, &dst, ImageFormat::Jpeg, &opts)
        .unwrap();
    // 32x24 -> 16x12 -> rotate 90 -> 12x16.
    assert_eq!((r.width, r.height), (12, 16));
    let info = engine.get_image_info(&dst).unwrap();
    assert_eq!(info.format, ImageFormat::Jpeg);
    assert_eq!((info.width, info.height), (12, 16));
    assert_eq!(info.color_type, "rgb8"); // JPEG has no luma8; grey RGB
    let decoded = engine.decode_file(&dst).unwrap();
    let rgba = decoded.to_rgba8();
    for px in rgba.as_chunks::<4>().0 {
        // JPEG is lossy: allow a small tolerance around grey.
        assert!((px[0] as i32 - px[1] as i32).abs() <= 2);
        assert!((px[1] as i32 - px[2] as i32).abs() <= 2);
    }
}

#[test]
fn process_with_watermark_and_spec_order() {
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("src.png");
    rgb_fixture(&src);
    let logo_path = dir.path().join("logo.png");
    let mut logo = RgbImage::new(4, 4);
    for px in logo.pixels_mut() {
        *px = Rgb([255, 0, 0]);
    }
    logo.save(&logo_path).unwrap();
    let engine = Engine::default();
    let overlay = engine.decode_file(&logo_path).unwrap();
    // PipelineSpec assembles in canonical order even though the
    // fields are set "out of order" here.
    let spec = PipelineSpec {
        grayscale: true,
        resize: Some((16, 12)),
        watermark: Some(WatermarkSpec {
            overlay,
            position: WatermarkPosition::BottomRight,
            opacity: 1.0,
            margin: 0,
        }),
        ..Default::default()
    };
    let opts = ProcessOptions::new(ConvertOptions::default(), spec.build().unwrap());
    let dst = dir.path().join("out.png");
    let r = engine.process_to_path(&src, &dst, &opts).unwrap();
    assert_eq!((r.width, r.height), (16, 12));
    let decoded = engine.decode_file(&dst).unwrap();
    let rgba = decoded.to_rgba8();
    // Bottom-right corner is the red logo (over the greyscale base).
    let i = ((11 * 16 + 15) * 4) as usize;
    assert_eq!(&rgba[i..i + 3], &[255, 0, 0]);
    // Top-left is greyscale.
    assert_eq!(rgba[0], rgba[1]);
    assert_eq!(rgba[1], rgba[2]);
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
