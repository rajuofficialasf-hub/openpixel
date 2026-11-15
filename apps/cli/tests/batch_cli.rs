//! CLI-level batch / bench tests: the real `openpixel` binary on
//! generated fixtures. The binary path comes from Cargo
//! (`CARGO_BIN_EXE_openpixel`); fixtures are generated in-code.

use image::{DynamicImage, Rgb, RgbImage};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn rgb_fixture(dir: &Path, name: &str, w: u32, h: u32) -> PathBuf {
    let mut im = RgbImage::new(w, h);
    for (x, y, px) in im.enumerate_pixels_mut() {
        *px = Rgb([(x % 256) as u8, (y % 256) as u8, 128]);
    }
    let path = dir.join(name);
    DynamicImage::ImageRgb8(im).save(&path).unwrap();
    path
}

fn batch_dir(with_corrupt: bool) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("in");
    fs::create_dir(&input).unwrap();
    for i in 0..9 {
        rgb_fixture(&input, &format!("img{i}.png"), 64, 48);
    }
    // Same stem, different source (photo.jpg + photo.png) must not
    // overwrite each other — the Phase 1 stem-collision rule.
    rgb_fixture(&input, "photo.jpg", 64, 48);
    rgb_fixture(&input, "photo.png", 64, 48);
    if with_corrupt {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend_from_slice(b"not a png chunk stream");
        fs::write(input.join("corrupt.png"), bytes).unwrap();
    }
    (dir, input)
}

fn run_batch(input: &Path, extra: &[&str]) -> (String, String, bool) {
    let out = Command::new(env!("CARGO_BIN_EXE_openpixel"))
        .arg("batch")
        .arg(input)
        .arg("--format")
        .arg("webp")
        .arg("--quality")
        .arg("80")
        .args(extra)
        .output()
        .unwrap();
    (
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
        out.status.success(),
    )
}

#[test]
fn batch_parallel_converts_all_good_files_and_reports_the_corrupt_one() {
    let (dir, input) = batch_dir(true);
    let out_dir = dir.path().join("out");
    let (stdout, stderr, ok) = run_batch(
        &input,
        &["--workers", "2", "--out-dir", out_dir.to_str().unwrap()],
    );
    assert!(
        ok,
        "batch must exit 0 even with a failed file: {stdout} {stderr}"
    );
    assert!(
        stdout.contains("11 converted, 1 failed"),
        "stdout: {stdout}"
    );
    assert!(stderr.contains("failed: "), "stderr: {stderr}");
    assert!(stderr.contains("corrupt.png"), "stderr: {stderr}");
    // 11 good files: 9 img + photo.jpg + photo.png, no overwrites.
    let outputs: Vec<_> = fs::read_dir(&out_dir).unwrap().collect();
    assert_eq!(outputs.len(), 11, "out dir: {out_dir:?}");
    assert!(out_dir.join("photo.webp").exists());
    assert!(out_dir.join("photo-png.webp").exists());
    for entry in outputs {
        let path = entry.unwrap().path();
        assert_eq!(path.extension().unwrap(), "webp");
        // Every output re-detects as WebP.
        let info_out = Command::new(env!("CARGO_BIN_EXE_openpixel"))
            .arg("info")
            .arg(&path)
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&info_out.stdout);
        assert!(
            text.contains("format:    webp"),
            "info of {}: {text}",
            path.display()
        );
    }
}

#[test]
fn batch_sequential_flag_matches_parallel_output() {
    let (dir, input) = batch_dir(false);
    let out_seq = dir.path().join("out-seq");
    let (stdout, _, ok) = run_batch(
        &input,
        &["--sequential", "--out-dir", out_seq.to_str().unwrap()],
    );
    assert!(ok, "{stdout}");
    assert!(
        stdout.contains("11 converted, 0 failed"),
        "stdout: {stdout}"
    );
    assert!(stdout.contains("1 worker"), "stdout: {stdout}");
    let out_par = dir.path().join("out-par");
    let (stdout, _, ok) = run_batch(
        &input,
        &["--workers", "4", "--out-dir", out_par.to_str().unwrap()],
    );
    assert!(ok, "{stdout}");
    assert!(
        stdout.contains("11 converted, 0 failed"),
        "stdout: {stdout}"
    );
    assert!(stdout.contains("4 workers"), "stdout: {stdout}");
    // Same set of output files either way.
    let mut seq: Vec<_> = fs::read_dir(&out_seq)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    let mut par: Vec<_> = fs::read_dir(&out_par)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    seq.sort();
    par.sort();
    assert_eq!(seq, par);
}

#[test]
fn batch_rejects_zero_workers() {
    let (_dir, input) = batch_dir(false);
    let out = Command::new(env!("CARGO_BIN_EXE_openpixel"))
        .arg("batch")
        .arg(&input)
        .arg("--format")
        .arg("webp")
        .arg("--workers")
        .arg("0")
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("--workers must be 1..=8"),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn bench_runs_and_prints_a_table() {
    // --quick: the debug test binary encodes AVIF far slower than
    // release (a full run took ~224 s in debug); quick fixtures
    // keep the smoke test to seconds.
    let out = Command::new(env!("CARGO_BIN_EXE_openpixel"))
        .arg("bench")
        .arg("--iterations")
        .arg("1")
        .arg("--quick")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    for row in [
        "jpeg_decode",
        "png_encode",
        "webp_encode",
        "avif_encode",
        "tiff_large",
        "batch_4",
    ] {
        assert!(
            stdout.contains(row),
            "bench output missing {row}:\n{stdout}"
        );
    }
    assert!(
        stdout.contains("rss:"),
        "bench output missing rss line:\n{stdout}"
    );
}
