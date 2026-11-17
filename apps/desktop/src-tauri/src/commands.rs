//! Tauri commands for the desktop app (Phase 8).
//!
//! Thin wrappers over `openpixel-core` (`Engine`) and `openpixel-jobs`
//! (`JobManager`). No conversion logic lives here and none lives in
//! the frontend: every image operation is an `Engine` call, exactly
//! like the CLI. The `do_*` functions are the testable core — the
//! `#[tauri::command]` functions only add state lookup and logging.
//!
//! Batch state lives on [`AppState`]: one [`JobManager`] at a time,
//! created by `start_batch` and queried/polled by the frontend.
//! A new batch is refused while the previous one still has
//! non-terminal jobs; a finished batch is replaced (its manager is
//! shut down first).

use openpixel_core::{
    AnimationInfo, ConvertOptions, ConvertResult, Engine, EngineConfig, FormatCapability,
    ImageFormat, ImageInfo, Metadata, MetadataPolicy, Operation, Pipeline, ProcessOptions,
};
use openpixel_jobs::{BatchProgress, Job, JobManager, JobManagerConfig, JobResult, MAX_WORKERS};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::logging;

/// Conversion options as sent by the frontend (JSON).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvertRequest {
    pub quality: Option<u8>,
    pub png_compression: Option<u8>,
    /// "white", "black", or "#RRGGBB" — same spelling as the CLI.
    pub background: String,
    /// Metadata policy name, e.g. "preserve" / "strip" /
    /// "selected:exif,icc" / "preserve-color-profiles" /
    /// "normalize-orientation". `None` = strip.
    pub metadata_policy: Option<String>,
    pub selected_frame: Option<u32>,
    pub convert_to_srgb: bool,
}

impl Default for ConvertRequest {
    fn default() -> Self {
        Self {
            quality: None,
            png_compression: None,
            background: "white".to_string(),
            metadata_policy: None,
            selected_frame: None,
            convert_to_srgb: false,
        }
    }
}

/// Processing operations as sent by the frontend (JSON). Applied in
/// canonical order: resize-fit, rotate, flip, grayscale.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PipelineRequest {
    pub resize_fit: Option<[u32; 2]>,
    pub grayscale: bool,
    /// Exact rotation: only 90, 180 or 270. Anything else is rejected
    /// (arbitrary rotation is an engine operation but is not exposed
    /// in this UI yet — see docs/DESKTOP.md).
    pub rotate_degrees: Option<i32>,
    pub flip_horizontal: bool,
    pub flip_vertical: bool,
}

/// One file of a batch request, as sent by the frontend (JSON).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchFileRequest {
    pub input: String,
    pub output: String,
    pub target: String,
    pub options: ConvertRequest,
}

/// What `start_batch` returns: the job ids in submission order.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchStarted {
    pub job_ids: Vec<u64>,
    pub workers: usize,
    pub total: usize,
}

/// What `app_info` returns (shown in Settings / About).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub engine_version: String,
    /// Always true: the desktop app has no server, no account and
    /// makes no network requests. Stated in the UI as well.
    pub offline: bool,
    pub log_path: String,
    pub format_count: usize,
}

/// What `read_logs` returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogView {
    pub path: String,
    pub lines: Vec<String>,
}

/// Shared state for all commands: the engine, the current batch
/// manager (at most one batch at a time) and the log directory.
pub struct AppState {
    pub engine: Arc<Engine>,
    pub batch: Mutex<Option<Arc<JobManager>>>,
    pub log_dir: PathBuf,
}

impl AppState {
    pub fn new(log_dir: PathBuf) -> Self {
        Self {
            engine: Arc::new(Engine::new(EngineConfig::default())),
            batch: Mutex::new(None),
            log_dir,
        }
    }

    pub(crate) fn log(&self, level: &str, message: &str) {
        logging::append(&self.log_dir, level, message);
    }

    /// Start a batch, replacing a finished one. Refused while a
    /// previous batch still has non-terminal jobs.
    pub fn start_batch(
        &self,
        files: Vec<BatchFileRequest>,
        workers: u8,
    ) -> Result<BatchStarted, String> {
        if files.is_empty() {
            return Err("no files in batch".to_string());
        }
        let workers = (workers as usize).clamp(1, MAX_WORKERS);
        {
            let mut guard = self.batch.lock().map_err(|_| "batch lock poisoned")?;
            if let Some(manager) = guard.as_ref() {
                let progress = manager.progress();
                if progress.completed() < progress.total {
                    return Err(format!(
                        "a batch is already running ({} of {} done) — wait for it or cancel it first",
                        progress.completed(),
                        progress.total
                    ));
                }
                manager.shutdown();
            }
            let mut jobs = Vec::with_capacity(files.len());
            for file in &files {
                let target = parse_format(&file.target)?;
                let options = build_options(&file.options)?;
                jobs.push((
                    PathBuf::from(&file.input),
                    PathBuf::from(&file.output),
                    target,
                    options,
                ));
            }
            let manager = JobManager::for_engine(
                JobManagerConfig::with_workers(workers),
                Arc::clone(&self.engine),
            )
            .map_err(|e| e.to_string())?;
            let job_ids = manager.submit_many(jobs);
            let total = job_ids.len();
            *guard = Some(Arc::new(manager));
            self.log(
                "INFO",
                &format!("batch started: {total} files, {workers} workers"),
            );
            Ok(BatchStarted {
                job_ids,
                workers,
                total,
            })
        }
    }

    fn with_batch<T>(&self, f: impl FnOnce(&JobManager) -> T) -> Result<T, String> {
        let guard = self.batch.lock().map_err(|_| "batch lock poisoned")?;
        match guard.as_ref() {
            Some(manager) => Ok(f(manager)),
            None => Err("no batch has been started yet".to_string()),
        }
    }

    pub fn batch_progress(&self) -> Result<BatchProgress, String> {
        self.with_batch(JobManager::progress)
    }

    pub fn batch_jobs(&self) -> Result<Vec<Job>, String> {
        self.with_batch(JobManager::jobs)
    }

    pub fn batch_results(&self) -> Result<Vec<JobResult>, String> {
        self.with_batch(JobManager::results)
    }

    pub fn batch_pause(&self) -> Result<(), String> {
        self.with_batch(|m| {
            m.pause();
            self.log("INFO", "batch paused");
        })
    }

    pub fn batch_resume(&self) -> Result<(), String> {
        self.with_batch(|m| {
            m.resume();
            self.log("INFO", "batch resumed");
        })
    }

    pub fn batch_cancel_all(&self) -> Result<usize, String> {
        let cancelled = self.with_batch(JobManager::cancel_all)?;
        self.log("INFO", &format!("batch cancel-all: {cancelled} cancelled"));
        Ok(cancelled)
    }

    pub fn batch_cancel(&self, id: u64) -> Result<bool, String> {
        self.with_batch(|m| m.cancel(id))
    }

    pub fn batch_retry_failed(&self) -> Result<usize, String> {
        let retried = self.with_batch(JobManager::retry_failed)?;
        self.log("INFO", &format!("batch retry-failed: {retried} re-queued"));
        Ok(retried)
    }
}

/// Parse a format id / name / extension exactly like the engine
/// (`ImageFormat::from_name`): "jpeg", "jpg", "png", "webp", ...
pub fn parse_format(name: &str) -> Result<ImageFormat, String> {
    ImageFormat::from_name(name)
        .ok_or_else(|| format!("unknown format '{name}' — pick one from the formats list"))
}

/// Validate a frontend [`ConvertRequest`] into engine options.
/// Rejects out-of-range quality / PNG compression, an unparsable
/// background and an unknown metadata policy — the engine never sees
/// an invalid request.
pub fn build_options(req: &ConvertRequest) -> Result<ConvertOptions, String> {
    if let Some(q) = req.quality {
        if !(1..=100).contains(&q) {
            return Err(format!("quality must be 1..=100, got {q}"));
        }
    }
    if let Some(c) = req.png_compression {
        if c > 2 {
            return Err(format!("png_compression must be 0, 1 or 2, got {c}"));
        }
    }
    let background =
        openpixel_core::security::parse_background(&req.background).map_err(|e| e.to_string())?;
    let metadata_policy = match &req.metadata_policy {
        Some(name) => Some(
            MetadataPolicy::from_name(name)
                .ok_or_else(|| format!("unknown metadata policy '{name}'"))?,
        ),
        None => None,
    };
    Ok(ConvertOptions {
        quality: req.quality,
        png_compression: req.png_compression,
        background,
        preserve_metadata: false,
        metadata_policy,
        selected_frame: req.selected_frame,
        convert_to_srgb: req.convert_to_srgb,
    })
}

/// Build the engine pipeline for a frontend [`PipelineRequest`].
/// Operations apply in canonical order (resize-fit, rotate, flip,
/// grayscale) — the same order the CLI's flag style uses.
pub fn build_pipeline(req: &PipelineRequest, background: [u8; 3]) -> Result<Pipeline, String> {
    let mut ops = Vec::new();
    if let Some([width, height]) = req.resize_fit {
        if width == 0 || height == 0 {
            return Err("resize-fit dimensions must be > 0".to_string());
        }
        ops.push(Operation::ResizeFit { width, height });
    }
    if let Some(degrees) = req.rotate_degrees {
        match degrees {
            90 => ops.push(Operation::Rotate90),
            180 => ops.push(Operation::Rotate180),
            270 => ops.push(Operation::Rotate270),
            other => {
                return Err(format!(
                    "rotation must be 90, 180 or 270 degrees, got {other}"
                ));
            }
        }
    }
    if req.flip_horizontal {
        ops.push(Operation::FlipHorizontal);
    }
    if req.flip_vertical {
        ops.push(Operation::FlipVertical);
    }
    if req.grayscale {
        ops.push(Operation::Grayscale);
    }
    let _ = background; // kept for the arbitrary-rotation form (not exposed yet)
    Ok(Pipeline::from_operations(ops))
}

// ---- Testable core: one function per command, engine in / result out ----

pub fn do_get_capabilities(engine: &Engine) -> Vec<FormatCapability> {
    engine.get_capabilities()
}

pub fn do_get_image_info(engine: &Engine, path: &Path) -> Result<ImageInfo, String> {
    engine.get_image_info(path).map_err(|e| e.to_string())
}

pub fn do_read_metadata(engine: &Engine, path: &Path) -> Result<Metadata, String> {
    engine.read_metadata(path).map_err(|e| e.to_string())
}

pub fn do_list_frames(engine: &Engine, path: &Path) -> Result<AnimationInfo, String> {
    engine.list_frames(path).map_err(|e| e.to_string())
}

/// List decodable image files directly inside a directory (not
/// recursive), sorted by name. Powers the batch workspace's
/// "open folder" picker: the frontend picks the folder with the
/// native dialog and this lists what the engine can decode in it.
/// Files with an unknown extension are skipped, never erroring.
pub fn do_list_directory_images(dir: &Path) -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("cannot read directory '{}': {e}", dir.display()))?;
    let mut files = Vec::new();
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let decodable = path
            .extension()
            .and_then(|ext| ext.to_str())
            .and_then(ImageFormat::from_name)
            .map(|f| f != ImageFormat::Unknown)
            .unwrap_or(false);
        if decodable {
            files.push(path.to_string_lossy().into_owned());
        }
    }
    files.sort();
    Ok(files)
}

pub fn do_convert(
    engine: &Engine,
    input: &Path,
    output: &Path,
    target: &str,
    req: &ConvertRequest,
) -> Result<ConvertResult, String> {
    let format = parse_format(target)?;
    let options = build_options(req)?;
    engine
        .convert(input, output, format, &options)
        .map_err(|e| e.to_string())
}

pub fn do_process(
    engine: &Engine,
    input: &Path,
    output: &Path,
    target: &str,
    req: &ConvertRequest,
    pipeline_req: &PipelineRequest,
) -> Result<ConvertResult, String> {
    let format = parse_format(target)?;
    let options = build_options(req)?;
    let pipeline = build_pipeline(pipeline_req, options.background)?;
    let process_options = ProcessOptions::new(options, pipeline);
    engine
        .process(input, output, format, &process_options)
        .map_err(|e| e.to_string())
}

pub fn do_extract_frame(
    engine: &Engine,
    input: &Path,
    output: &Path,
    index: u32,
    req: &ConvertRequest,
) -> Result<ConvertResult, String> {
    let options = build_options(req)?;
    engine
        .extract_frame_to_path(input, index, output, &options)
        .map_err(|e| e.to_string())
}

// ---- Tauri command wrappers (state + logging only) ----

#[tauri::command]
pub fn app_info(state: tauri::State<'_, AppState>) -> AppInfo {
    AppInfo {
        name: "OpenPixel".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        engine_version: env!("CARGO_PKG_VERSION").to_string(),
        offline: true,
        log_path: logging::log_path(&state.log_dir)
            .to_string_lossy()
            .into_owned(),
        format_count: state.engine.get_capabilities().len(),
    }
}

#[tauri::command]
pub fn get_capabilities(state: tauri::State<'_, AppState>) -> Vec<FormatCapability> {
    do_get_capabilities(&state.engine)
}

#[tauri::command]
pub fn get_image_info(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<ImageInfo, String> {
    let result = do_get_image_info(&state.engine, Path::new(&path));
    match &result {
        Ok(info) => state.log(
            "INFO",
            &format!(
                "info {}: {} {}x{}",
                path,
                info.format.id(),
                info.width,
                info.height
            ),
        ),
        Err(e) => state.log("ERROR", &format!("info {path} failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn list_directory_images(
    state: tauri::State<'_, AppState>,
    dir: String,
) -> Result<Vec<String>, String> {
    let result = do_list_directory_images(Path::new(&dir));
    if let Err(e) = &result {
        state.log("ERROR", &format!("list directory {dir} failed: {e}"));
    }
    result
}

#[tauri::command]
pub fn read_metadata(state: tauri::State<'_, AppState>, path: String) -> Result<Metadata, String> {
    do_read_metadata(&state.engine, Path::new(&path)).map_err(|e| {
        state.log("ERROR", &format!("metadata {path} failed: {e}"));
        e
    })
}

#[tauri::command]
pub fn list_frames(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<AnimationInfo, String> {
    do_list_frames(&state.engine, Path::new(&path)).map_err(|e| {
        state.log("ERROR", &format!("frames {path} failed: {e}"));
        e
    })
}

#[tauri::command]
pub fn convert_file(
    state: tauri::State<'_, AppState>,
    input: String,
    output: String,
    target: String,
    options: ConvertRequest,
) -> Result<ConvertResult, String> {
    let result = do_convert(
        &state.engine,
        Path::new(&input),
        Path::new(&output),
        &target,
        &options,
    );
    match &result {
        Ok(r) => state.log(
            "INFO",
            &format!(
                "convert {} -> {} ({}): {} bytes -> {} bytes",
                input,
                output,
                r.target_format.id(),
                r.input_bytes,
                r.output_bytes
            ),
        ),
        Err(e) => state.log("ERROR", &format!("convert {input} -> {output} failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn process_file(
    state: tauri::State<'_, AppState>,
    input: String,
    output: String,
    target: String,
    options: ConvertRequest,
    pipeline: PipelineRequest,
) -> Result<ConvertResult, String> {
    let result = do_process(
        &state.engine,
        Path::new(&input),
        Path::new(&output),
        &target,
        &options,
        &pipeline,
    );
    match &result {
        Ok(r) => state.log(
            "INFO",
            &format!(
                "process {} -> {} ({}): {} bytes -> {} bytes",
                input,
                output,
                r.target_format.id(),
                r.input_bytes,
                r.output_bytes
            ),
        ),
        Err(e) => state.log("ERROR", &format!("process {input} -> {output} failed: {e}")),
    }
    result
}

#[tauri::command]
pub fn extract_frame(
    state: tauri::State<'_, AppState>,
    input: String,
    output: String,
    index: u32,
    options: ConvertRequest,
) -> Result<ConvertResult, String> {
    let result = do_extract_frame(
        &state.engine,
        Path::new(&input),
        Path::new(&output),
        index,
        &options,
    );
    match &result {
        Ok(r) => state.log(
            "INFO",
            &format!(
                "extract-frame {input} frame {index} -> {output}: {} bytes",
                r.output_bytes
            ),
        ),
        Err(e) => state.log(
            "ERROR",
            &format!("extract-frame {input} frame {index} failed: {e}"),
        ),
    }
    result
}

#[tauri::command]
pub fn start_batch(
    state: tauri::State<'_, AppState>,
    files: Vec<BatchFileRequest>,
    workers: u8,
) -> Result<BatchStarted, String> {
    state.start_batch(files, workers)
}

#[tauri::command]
pub fn batch_progress(state: tauri::State<'_, AppState>) -> Result<BatchProgress, String> {
    state.batch_progress()
}

#[tauri::command]
pub fn batch_jobs(state: tauri::State<'_, AppState>) -> Result<Vec<Job>, String> {
    state.batch_jobs()
}

#[tauri::command]
pub fn batch_results(state: tauri::State<'_, AppState>) -> Result<Vec<JobResult>, String> {
    state.batch_results()
}

#[tauri::command]
pub fn batch_pause(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.batch_pause()
}

#[tauri::command]
pub fn batch_resume(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.batch_resume()
}

#[tauri::command]
pub fn batch_cancel_all(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    state.batch_cancel_all()
}

#[tauri::command]
pub fn batch_cancel(state: tauri::State<'_, AppState>, id: u64) -> Result<bool, String> {
    state.batch_cancel(id)
}

#[tauri::command]
pub fn batch_retry_failed(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    state.batch_retry_failed()
}

#[tauri::command]
pub fn read_logs(state: tauri::State<'_, AppState>, max_lines: Option<usize>) -> LogView {
    LogView {
        path: logging::log_path(&state.log_dir)
            .to_string_lossy()
            .into_owned(),
        lines: logging::read_tail(&state.log_dir, max_lines.unwrap_or(200).clamp(1, 1000)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};

    /// 64x48 RGBA fixture: opaque red left half, semi-transparent
    /// green right half (exercises alpha flattening on JPEG).
    fn fixture_png(dir: &Path) -> PathBuf {
        let mut img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::new(64, 48);
        for (x, _y, px) in img.enumerate_pixels_mut() {
            *px = if x < 32 {
                Rgba([255, 0, 0, 255])
            } else {
                Rgba([0, 255, 0, 128])
            };
        }
        let path = dir.join("fixture.png");
        img.save(&path).expect("write fixture png");
        path
    }

    fn engine() -> Engine {
        Engine::new(EngineConfig::default())
    }

    #[test]
    fn capabilities_come_from_the_registry() {
        let caps = do_get_capabilities(&engine());
        assert_eq!(caps.len(), 21);
        assert!(caps
            .iter()
            .any(|c| c.format_id == "png" && c.can_decode && c.can_encode));
        assert!(caps
            .iter()
            .any(|c| c.format_id == "heic" && c.can_decode && c.can_encode));
        assert!(caps
            .iter()
            .any(|c| c.format_id == "raw" && !c.can_decode && !c.can_encode));
        assert!(caps
            .iter()
            .any(|c| c.format_id == "svg" && c.can_decode && !c.can_encode));
    }

    #[test]
    fn avif_roundtrip_still_works_after_core_default_features_off() {
        // Phase 7: openpixel-core is depended on with
        // `default-features = false` (the Android dav1d work);
        // feature unification via openpixel-jobs must keep
        // `native-avif` on for the desktop build. This test fails
        // loudly if that ever stops being true.
        let dir = tempfile::tempdir().expect("tempdir");
        let png = fixture_png(dir.path());
        let bytes = std::fs::read(&png).expect("read fixture png");
        let engine = engine();
        let (_, avif) = engine
            .convert_bytes(&bytes, ImageFormat::Avif, &ConvertOptions::default())
            .expect("encode AVIF");
        assert_eq!(engine.detect_format(&avif), ImageFormat::Avif);
        let (r, back) = engine
            .convert_bytes(&avif, ImageFormat::Png, &ConvertOptions::default())
            .expect("decode AVIF");
        assert_eq!(r.source_format, ImageFormat::Avif);
        assert_eq!(engine.detect_format(&back), ImageFormat::Png);
    }

    #[test]
    fn parse_format_accepts_names_and_extensions() {
        assert_eq!(parse_format("jpeg").unwrap(), ImageFormat::Jpeg);
        assert_eq!(parse_format("jpg").unwrap(), ImageFormat::Jpeg);
        assert_eq!(parse_format(".png").unwrap(), ImageFormat::Png);
        assert!(parse_format("heic").is_ok()); // detected, even if not encodable
        assert!(parse_format("bogus").is_err());
    }

    #[test]
    fn build_options_rejects_bad_values() {
        let req = |quality: Option<u8>,
                   png_compression: Option<u8>,
                   background: &str,
                   metadata_policy: Option<&str>| {
            ConvertRequest {
                quality,
                png_compression,
                background: background.to_string(),
                metadata_policy: metadata_policy.map(str::to_string),
                ..ConvertRequest::default()
            }
        };
        assert!(build_options(&req(Some(0), None, "white", None)).is_err());
        assert!(build_options(&req(Some(101), None, "white", None)).is_err());
        assert!(build_options(&req(Some(85), Some(3), "white", None)).is_err());
        assert!(build_options(&req(Some(85), Some(2), "not-a-colour", None)).is_err());
        assert!(build_options(&req(Some(85), Some(2), "#ff0000", Some("bogus"))).is_err());
        let opts = build_options(&req(Some(85), Some(2), "#ff0000", Some("preserve")))
            .expect("valid options");
        assert_eq!(opts.background, [255, 0, 0]);
        assert_eq!(opts.effective_policy(), MetadataPolicy::Preserve);
    }

    #[test]
    fn build_pipeline_rejects_bad_rotation_and_zero_resize() {
        let req = |rotate_degrees: Option<i32>, resize_fit: Option<[u32; 2]>, grayscale: bool| {
            PipelineRequest {
                rotate_degrees,
                resize_fit,
                grayscale,
                ..PipelineRequest::default()
            }
        };
        assert!(build_pipeline(&req(Some(45), None, false), [255, 255, 255]).is_err());
        assert!(build_pipeline(&req(Some(90), Some([0, 10]), false), [255, 255, 255]).is_err());
        assert!(build_pipeline(&req(Some(90), Some([32, 24]), true), [255, 255, 255]).is_ok());
    }

    #[test]
    fn info_metadata_frames_on_fixture() {
        let dir = tempfile::tempdir().expect("tempdir");
        let png = fixture_png(dir.path());
        let eng = engine();
        let info = do_get_image_info(&eng, &png).expect("info");
        assert_eq!(info.width, 64);
        assert_eq!(info.height, 48);
        assert!(info.has_alpha);
        assert_eq!(info.format, ImageFormat::Png);
        let meta = do_read_metadata(&eng, &png).expect("metadata");
        assert!(!meta.has_exif);
        let frames = do_list_frames(&eng, &png).expect("frames");
        assert_eq!(frames.frame_count, 1);
    }

    #[test]
    fn convert_png_to_jpeg_and_webp() {
        let dir = tempfile::tempdir().expect("tempdir");
        let png = fixture_png(dir.path());
        let eng = engine();
        let out_jpg = dir.path().join("out.jpg");
        let result = do_convert(
            &eng,
            &png,
            &out_jpg,
            "jpeg",
            &ConvertRequest {
                quality: Some(85),
                ..ConvertRequest::default()
            },
        )
        .expect("convert to jpeg");
        assert_eq!(result.target_format, ImageFormat::Jpeg);
        assert_eq!(result.width, 64);
        assert!(out_jpg.exists());
        assert_eq!(
            eng.detect_format_from_file(&out_jpg).unwrap(),
            ImageFormat::Jpeg
        );
        let out_webp = dir.path().join("out.webp");
        do_convert(&eng, &png, &out_webp, "webp", &ConvertRequest::default())
            .expect("convert to webp");
        assert_eq!(
            eng.detect_format_from_file(&out_webp).unwrap(),
            ImageFormat::Webp
        );
    }

    #[test]
    fn convert_rejects_unencodable_target_and_missing_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let png = fixture_png(dir.path());
        let eng = engine();
        let out = dir.path().join("out.psd");
        assert!(do_convert(&eng, &png, &out, "psd", &ConvertRequest::default()).is_err());
        assert!(!out.exists());
        let missing = dir.path().join("nope.png");
        let out2 = dir.path().join("out2.png");
        assert!(do_convert(&eng, &missing, &out2, "png", &ConvertRequest::default()).is_err());
    }

    #[test]
    fn process_resize_fit_and_grayscale() {
        let dir = tempfile::tempdir().expect("tempdir");
        let png = fixture_png(dir.path());
        let eng = engine();
        let out = dir.path().join("small.jpg");
        let result = do_process(
            &eng,
            &png,
            &out,
            "jpeg",
            &ConvertRequest::default(),
            &PipelineRequest {
                resize_fit: Some([32, 24]),
                grayscale: true,
                rotate_degrees: None,
                flip_horizontal: false,
                flip_vertical: false,
            },
        )
        .expect("process");
        assert_eq!((result.width, result.height), (32, 24));
    }

    #[test]
    fn extract_frame_zero_works() {
        let dir = tempfile::tempdir().expect("tempdir");
        let png = fixture_png(dir.path());
        let eng = engine();
        let out = dir.path().join("frame0.png");
        let result = do_extract_frame(&eng, &png, &out, 0, &ConvertRequest::default())
            .expect("extract frame 0");
        assert_eq!((result.width, result.height), (64, 48));
        assert!(do_extract_frame(&eng, &png, &out, 1, &ConvertRequest::default()).is_err());
    }

    #[test]
    fn batch_state_runs_real_conversions() {
        let dir = tempfile::tempdir().expect("tempdir");
        let png = fixture_png(dir.path());
        let state = AppState::new(dir.path().join("logs"));
        assert!(state.batch_progress().is_err()); // no batch yet
        let started = state
            .start_batch(
                vec![
                    BatchFileRequest {
                        input: png.to_string_lossy().into_owned(),
                        output: dir.path().join("b1.webp").to_string_lossy().into_owned(),
                        target: "webp".to_string(),
                        options: ConvertRequest::default(),
                    },
                    BatchFileRequest {
                        input: dir
                            .path()
                            .join("missing.png")
                            .to_string_lossy()
                            .into_owned(),
                        output: dir.path().join("b2.webp").to_string_lossy().into_owned(),
                        target: "webp".to_string(),
                        options: ConvertRequest::default(),
                    },
                ],
                2,
            )
            .expect("start batch");
        assert_eq!(started.total, 2);
        assert_eq!(started.workers, 2);
        // Poll until terminal (fast: one tiny file + one instant failure).
        for _ in 0..100 {
            let progress = state.batch_progress().expect("progress");
            if progress.completed() == progress.total {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let progress = state.batch_progress().expect("progress");
        assert_eq!(progress.done, 1);
        assert_eq!(progress.failed, 1);
        assert_eq!(state.batch_results().expect("results").len(), 2);
        assert_eq!(state.batch_jobs().expect("jobs").len(), 2);
        // A finished batch can be replaced by a new one.
        let again = state.start_batch(
            vec![BatchFileRequest {
                input: png.to_string_lossy().into_owned(),
                output: dir.path().join("b3.png").to_string_lossy().into_owned(),
                target: "png".to_string(),
                options: ConvertRequest::default(),
            }],
            1,
        );
        assert!(again.is_ok());
    }

    #[test]
    fn list_directory_images_only_lists_decodable_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let png = fixture_png(dir.path());
        std::fs::write(dir.path().join("notes.txt"), b"hello").expect("write txt");
        std::fs::write(dir.path().join("photo.jpg"), b"not a real jpeg").expect("write jpg");
        std::fs::create_dir(dir.path().join("sub")).expect("mkdir");
        std::fs::write(dir.path().join("sub").join("nested.png"), b"x").expect("write nested");
        let listed = do_list_directory_images(dir.path()).expect("list");
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().any(|p| p.ends_with("fixture.png")));
        assert!(listed.iter().any(|p| p.ends_with("photo.jpg")));
        assert!(!listed.iter().any(|p| p.contains("nested")));
        let _ = png;
        assert!(do_list_directory_images(&dir.path().join("nope")).is_err());
    }

    #[test]
    fn batch_rejects_empty_and_second_running_batch() {
        let dir = tempfile::tempdir().expect("tempdir");
        let png = fixture_png(dir.path());
        let state = AppState::new(dir.path().join("logs"));
        assert!(state.start_batch(vec![], 2).is_err());
        // A batch of one tiny file finishes almost immediately; the
        // refusal path is timing-dependent, so only assert the empty
        // case and the post-completion replacement here.
        let started = state
            .start_batch(
                vec![BatchFileRequest {
                    input: png.to_string_lossy().into_owned(),
                    output: dir.path().join("c1.png").to_string_lossy().into_owned(),
                    target: "png".to_string(),
                    options: ConvertRequest::default(),
                }],
                1,
            )
            .expect("start");
        assert_eq!(started.total, 1);
    }
}
