//! Batch integration tests: the real engine behind `JobManager`
//! (`for_engine`). Fixtures are generated in-code with the `image`
//! crate — no binary fixtures checked in.

use image::{DynamicImage, Rgb, RgbImage};
use openpixel_core::{ConvertOptions, Engine, EngineConfig, ImageFormat};
use openpixel_jobs::{JobManager, JobManagerConfig, JobStatus};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn rgb_fixture(dir: &Path, name: &str, w: u32, h: u32) -> PathBuf {
    let mut im = RgbImage::new(w, h);
    for (x, y, px) in im.enumerate_pixels_mut() {
        *px = Rgb([(x % 256) as u8, (y % 256) as u8, 128]);
    }
    let path = dir.join(name);
    DynamicImage::ImageRgb8(im).save(&path).unwrap();
    path
}

#[test]
fn batch_of_real_images_converts_with_two_workers() {
    let dir = tempfile::tempdir().unwrap();
    let out_dir = dir.path().join("out");
    fs::create_dir(&out_dir).unwrap();
    let engine = Arc::new(Engine::new(EngineConfig::default()));
    let manager =
        JobManager::for_engine(JobManagerConfig::with_workers(2), Arc::clone(&engine)).unwrap();
    let mut expected = Vec::new();
    for i in 0..6 {
        let input = rgb_fixture(dir.path(), &format!("img{i}.png"), 64, 48);
        let output = out_dir.join(format!("img{i}.webp"));
        manager.submit(
            input,
            output.clone(),
            ImageFormat::Webp,
            ConvertOptions::default(),
        );
        expected.push(output);
    }
    manager.wait_all();
    let progress = manager.progress();
    assert_eq!((progress.done, progress.failed), (6, 0));
    for output in expected {
        assert!(output.exists(), "missing output {}", output.display());
        assert_eq!(
            engine.get_image_info(&output).unwrap().format,
            ImageFormat::Webp
        );
    }
}

#[test]
fn one_corrupt_file_fails_and_is_reported_while_the_rest_succeed() {
    let dir = tempfile::tempdir().unwrap();
    let out_dir = dir.path().join("out");
    fs::create_dir(&out_dir).unwrap();
    let engine = Arc::new(Engine::new(EngineConfig::default()));
    let manager =
        JobManager::for_engine(JobManagerConfig::with_workers(2), Arc::clone(&engine)).unwrap();
    // Valid PNG signature followed by garbage: detected as PNG, then
    // the decode fails — a real corrupt file, not an unknown format.
    let corrupt = dir.path().join("corrupt.png");
    let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    bytes.extend_from_slice(b"this is not a png chunk stream at all");
    fs::write(&corrupt, bytes).unwrap();
    manager.submit(
        corrupt.clone(),
        out_dir.join("corrupt.webp"),
        ImageFormat::Webp,
        ConvertOptions::default(),
    );
    for i in 0..4 {
        let input = rgb_fixture(dir.path(), &format!("good{i}.png"), 32, 24);
        manager.submit(
            input,
            out_dir.join(format!("good{i}.webp")),
            ImageFormat::Webp,
            ConvertOptions::default(),
        );
    }
    manager.wait_all();
    let progress = manager.progress();
    assert_eq!((progress.done, progress.failed), (4, 1));
    let failures: Vec<_> = manager
        .results()
        .into_iter()
        .filter(|r| r.status == JobStatus::Failed)
        .collect();
    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0].input, corrupt);
    assert!(!failures[0].error.as_deref().unwrap_or("").is_empty());
    assert!(
        !out_dir.join("corrupt.webp").exists(),
        "failed job must not write output"
    );
    for i in 0..4 {
        assert!(out_dir.join(format!("good{i}.webp")).exists());
    }
}

#[test]
fn job_over_the_engine_limits_fails_with_limit_exceeded_not_a_crash() {
    let dir = tempfile::tempdir().unwrap();
    let out_dir = dir.path().join("out");
    fs::create_dir(&out_dir).unwrap();
    // A deliberately tiny config: a 64x48 image exceeds the 16 px
    // dimension limit, so the worker must fail the job cleanly.
    let config = EngineConfig {
        max_dimension: 16,
        ..EngineConfig::default()
    };
    let engine = Arc::new(Engine::new(config));
    let manager =
        JobManager::for_engine(JobManagerConfig::with_workers(2), Arc::clone(&engine)).unwrap();
    let big = rgb_fixture(dir.path(), "big.png", 64, 48);
    manager.submit(
        big,
        out_dir.join("big.webp"),
        ImageFormat::Webp,
        ConvertOptions::default(),
    );
    let small = rgb_fixture(dir.path(), "small.png", 8, 8);
    manager.submit(
        small,
        out_dir.join("small.webp"),
        ImageFormat::Webp,
        ConvertOptions::default(),
    );
    manager.wait_all();
    let progress = manager.progress();
    assert_eq!((progress.done, progress.failed), (1, 1));
    let failures: Vec<_> = manager
        .results()
        .into_iter()
        .filter(|r| r.status == JobStatus::Failed)
        .collect();
    assert_eq!(failures.len(), 1);
    assert!(
        failures[0]
            .error
            .as_deref()
            .unwrap_or("")
            .contains("LimitExceeded")
            || failures[0]
                .error
                .as_deref()
                .unwrap_or("")
                .contains("exceeds max dimension"),
        "error was: {:?}",
        failures[0].error
    );
    assert!(out_dir.join("small.webp").exists());
}
