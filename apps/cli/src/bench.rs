//! `openpixel bench` — the Phase 6 benchmark suite.
//!
//! Self-contained: fixtures are generated in a temp dir with the
//! `image` crate (a gradient, so every codec sees the same pixels),
//! measured with the release engine, and deleted afterwards. No
//! network, no external tools. Peak memory is the process peak RSS
//! (`VmHWM` from `/proc/self/status`, Linux) — `/usr/bin/time` is
//! not installed on this VM, so the suite measures RSS itself.
//!
//! What each row actually measures (honest labels — the engine has
//! no encode-only entry point, so every "encode" row is a full
//! convert that includes the decode):
//!
//! * `jpeg_decode` — `Engine::decode_file` on a 1024x768 JPEG.
//! * `png_encode` — convert 1024x768 PNG -> PNG (decode + encode).
//! * `webp_encode` — convert 1024x768 PNG -> WebP, quality 80.
//! * `avif_encode` — convert 1024x768 PNG -> AVIF, quality 80.
//! * `tiff_large` — convert a 2048x1536 TIFF -> PNG.
//! * `batch_12` — 12 files (6 PNG + 6 JPEG, 512x384) -> WebP
//!   through `JobManager` with 4 workers; total time and mean
//!   time per file.
//!
//! Every row runs `iterations` times (default 3) and reports the
//! mean / min / max. Run it from the release binary
//! (`scripts/test/bench.sh` does that); debug timings are not
//! comparable and the report says which build it was.

use image::{DynamicImage, Rgb, RgbImage};
use openpixel_core::{ConvertOptions, Engine, EngineConfig, ImageFormat};
use openpixel_jobs::{current_rss_bytes, peak_rss_bytes, JobManager, JobManagerConfig};
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// One measured operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchRow {
    pub name: String,
    pub detail: String,
    pub mean_ms: f64,
    pub min_ms: f64,
    pub max_ms: f64,
    pub iterations: usize,
}

/// The whole suite's report, printed as a table (or `--json`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchReport {
    pub build: String,
    pub quick: bool,
    pub cpu_model: Option<String>,
    pub mem_total_mb: Option<u64>,
    pub iterations: usize,
    pub rows: Vec<BenchRow>,
    pub rss_start_mb: Option<f64>,
    pub rss_end_mb: Option<f64>,
    pub peak_rss_mb: Option<f64>,
}

fn cpu_model() -> Option<String> {
    let info = fs::read_to_string("/proc/cpuinfo").ok()?;
    info.lines()
        .find_map(|l| l.strip_prefix("model name"))
        .and_then(|l| l.split(':').nth(1))
        .map(|s| s.trim().to_string())
}

fn mem_total_mb() -> Option<u64> {
    let info = fs::read_to_string("/proc/meminfo").ok()?;
    info.lines()
        .find_map(|l| l.strip_prefix("MemTotal:"))
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|n| n.parse::<u64>().ok())
        .map(|kib| kib / 1024)
}

fn mb(bytes: Option<u64>) -> Option<f64> {
    bytes.map(|b| b as f64 / 1_048_576.0)
}

fn gradient(w: u32, h: u32) -> RgbImage {
    let mut im = RgbImage::new(w, h);
    for (x, y, px) in im.enumerate_pixels_mut() {
        *px = Rgb([
            ((x * 255 / w.max(1)) & 0xFF) as u8,
            ((y * 255 / h.max(1)) & 0xFF) as u8,
            (((x + y) * 255 / (w + h).max(1)) & 0xFF) as u8,
        ]);
    }
    im
}

fn time_it<F>(iterations: usize, mut op: F) -> (f64, f64, f64)
where
    F: FnMut(),
{
    let mut times: Vec<Duration> = Vec::with_capacity(iterations);
    for _ in 0..iterations.max(1) {
        let start = Instant::now();
        op();
        times.push(start.elapsed());
    }
    let ms: Vec<f64> = times.iter().map(|d| d.as_secs_f64() * 1000.0).collect();
    let mean = ms.iter().sum::<f64>() / ms.len() as f64;
    let min = ms.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = ms.iter().cloned().fold(0.0f64, f64::max);
    (mean, min, max)
}

/// Run the suite. Fixtures live in a temp dir that is removed
/// afterwards (best effort). With `quick`, fixtures shrink
/// (256x192 base, 512x384 large TIFF, 4-file batch) so the suite
/// finishes in seconds even from a debug build — the smoke-test
/// mode used by the CLI integration test. Quick timings are not
/// comparable to full-run timings and the report says so.
pub fn run_bench(
    iterations: usize,
    quick: bool,
) -> Result<BenchReport, openpixel_core::OpenPixelError> {
    let iterations = iterations.max(1);
    let engine = Engine::new(EngineConfig::default());
    let work_dir = std::env::temp_dir().join(format!("openpixel-bench-{}", std::process::id()));
    let _ = fs::remove_dir_all(&work_dir);
    fs::create_dir_all(&work_dir).map_err(|e| openpixel_core::OpenPixelError::Io {
        path: work_dir.clone(),
        source: e,
    })?;
    let rss_start = current_rss_bytes();

    let measure = || -> Result<Vec<BenchRow>, openpixel_core::OpenPixelError> {
        let mut rows: Vec<BenchRow> = Vec::new();
        // Fixtures: one gradient in PNG/JPEG, one large TIFF, and
        // small files for the batch row. Quick mode shrinks every
        // fixture so the suite finishes in seconds from a debug
        // build; its timings are not comparable to a full run.
        let (bw, bh) = if quick { (256, 192) } else { (1024, 768) };
        let (lw, lh) = if quick { (512, 384) } else { (2048, 1536) };
        let base = gradient(bw, bh);
        let png = work_dir.join("bench.png");
        let jpeg = work_dir.join("bench.jpg");
        let tiff = work_dir.join("bench-large.tiff");
        DynamicImage::ImageRgb8(base.clone()).save(&png).unwrap();
        DynamicImage::ImageRgb8(base).save(&jpeg).unwrap();
        DynamicImage::ImageRgb8(gradient(lw, lh))
            .save(&tiff)
            .unwrap();

        let (mean, min, max) = time_it(iterations, || {
            engine.decode_file(&jpeg).unwrap();
        });
        rows.push(BenchRow {
            name: "jpeg_decode".to_string(),
            detail: format!("decode_file, {bw}x{bh} JPEG"),
            mean_ms: mean,
            min_ms: min,
            max_ms: max,
            iterations,
        });

        let (mean, min, max) = time_it(iterations, || {
            let out = work_dir.join("out.png");
            engine
                .convert(&png, &out, ImageFormat::Png, &ConvertOptions::default())
                .unwrap();
        });
        rows.push(BenchRow {
            name: "png_encode".to_string(),
            detail: format!("convert PNG->PNG (incl. decode), {bw}x{bh}"),
            mean_ms: mean,
            min_ms: min,
            max_ms: max,
            iterations,
        });

        let (mean, min, max) = time_it(iterations, || {
            let out = work_dir.join("out.webp");
            let opts = ConvertOptions {
                quality: Some(80),
                ..Default::default()
            };
            engine
                .convert(&png, &out, ImageFormat::Webp, &opts)
                .unwrap();
        });
        rows.push(BenchRow {
            name: "webp_encode".to_string(),
            detail: format!("convert PNG->WebP q80 (incl. decode), {bw}x{bh}"),
            mean_ms: mean,
            min_ms: min,
            max_ms: max,
            iterations,
        });

        let (mean, min, max) = time_it(iterations, || {
            let out = work_dir.join("out.avif");
            let opts = ConvertOptions {
                quality: Some(80),
                ..Default::default()
            };
            engine
                .convert(&png, &out, ImageFormat::Avif, &opts)
                .unwrap();
        });
        rows.push(BenchRow {
            name: "avif_encode".to_string(),
            detail: format!("convert PNG->AVIF q80 (incl. decode), {bw}x{bh}"),
            mean_ms: mean,
            min_ms: min,
            max_ms: max,
            iterations,
        });

        let (mean, min, max) = time_it(iterations, || {
            let out = work_dir.join("out-large.png");
            engine
                .convert(&tiff, &out, ImageFormat::Png, &ConvertOptions::default())
                .unwrap();
        });
        rows.push(BenchRow {
            name: "tiff_large".to_string(),
            detail: format!("convert TIFF->PNG (incl. decode), {lw}x{lh}"),
            mean_ms: mean,
            min_ms: min,
            max_ms: max,
            iterations,
        });

        // Batch row: files through the job manager, 4 workers.
        let pairs = if quick { 2 } else { 6 };
        let batch_files = pairs * 2;
        let (sw, sh) = if quick { (128, 96) } else { (512, 384) };
        let batch_dir = work_dir.join("batch");
        fs::create_dir(&batch_dir).unwrap();
        let small = gradient(sw, sh);
        for i in 0..pairs {
            DynamicImage::ImageRgb8(small.clone())
                .save(batch_dir.join(format!("b{i}.png")))
                .unwrap();
            DynamicImage::ImageRgb8(small.clone())
                .save(batch_dir.join(format!("b{i}.jpg")))
                .unwrap();
        }
        let batch_out = work_dir.join("batch-out");
        fs::create_dir(&batch_out).unwrap();
        let (mean, min, max) = time_it(iterations, || {
            let manager = JobManager::for_engine(
                JobManagerConfig::with_workers(4),
                Arc::new(Engine::new(EngineConfig::default())),
            )
            .unwrap();
            for i in 0..pairs {
                for ext in ["png", "jpg"] {
                    manager.submit(
                        batch_dir.join(format!("b{i}.{ext}")),
                        batch_out.join(format!("b{i}-{ext}.webp")),
                        ImageFormat::Webp,
                        ConvertOptions {
                            quality: Some(80),
                            ..Default::default()
                        },
                    );
                }
            }
            manager.wait_all();
            assert_eq!(
                manager.progress().done,
                batch_files,
                "batch bench: all {batch_files} must convert"
            );
        });
        rows.push(BenchRow {
            name: format!("batch_{batch_files}"),
            detail: format!(
                "{batch_files} files ({pairs} PNG + {pairs} JPEG, {sw}x{sh}) -> WebP, 4 workers; total ms"
            ),
            mean_ms: mean,
            min_ms: min,
            max_ms: max,
            iterations,
        });
        rows.push(BenchRow {
            name: format!("batch_{batch_files}_per_file"),
            detail: format!("mean ms per file, same batch (total / {batch_files})"),
            mean_ms: mean / batch_files as f64,
            min_ms: min / batch_files as f64,
            max_ms: max / batch_files as f64,
            iterations,
        });

        Ok(rows)
    };
    let result = measure();
    let _ = fs::remove_dir_all(&work_dir);
    let rows = result?;
    Ok(BenchReport {
        build: if cfg!(debug_assertions) {
            "debug".to_string()
        } else {
            "release".to_string()
        },
        quick,
        cpu_model: cpu_model(),
        mem_total_mb: mem_total_mb(),
        iterations,
        rows,
        rss_start_mb: mb(rss_start),
        rss_end_mb: mb(current_rss_bytes()),
        peak_rss_mb: mb(peak_rss_bytes()),
    })
}

/// Print the report as a human-readable table.
pub fn print_report(report: &BenchReport) {
    println!(
        "benchmark: openpixel ({} build, {} iterations)",
        report.build, report.iterations
    );
    if let Some(cpu) = &report.cpu_model {
        println!("cpu:       {cpu}");
    }
    if let Some(mem) = report.mem_total_mb {
        println!("memory:    {mem} MiB total");
    }
    println!(
        "{:<20} {:>10} {:>10} {:>10}  what was measured",
        "operation", "mean ms", "min ms", "max ms"
    );
    for row in &report.rows {
        println!(
            "{:<20} {:>10.1} {:>10.1} {:>10.1}  {}",
            row.name, row.mean_ms, row.min_ms, row.max_ms, row.detail
        );
    }
    match (report.rss_start_mb, report.rss_end_mb, report.peak_rss_mb) {
        (Some(start), Some(end), Some(peak)) => {
            println!("rss:       start {start:.1} MiB, end {end:.1} MiB, peak {peak:.1} MiB (VmHWM, /proc/self/status)");
        }
        _ => println!("rss:       not available on this platform"),
    }
    if report.build == "debug" {
        println!("note:      debug build — timings are not comparable to release; run scripts/test/bench.sh for release numbers.");
    }
    if report.quick {
        println!(
            "note:      quick mode — small fixtures; timings are not comparable to a full run."
        );
    }
}
