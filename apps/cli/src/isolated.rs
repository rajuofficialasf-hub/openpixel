//! Process isolation for the CLI (Phase 8).
//!
//! `convert`, `process` and `batch` run each conversion in a **child
//! process** — a re-exec of this binary as the hidden
//! `__isolated-work` subcommand — supervised by
//! `openpixel_security::run_command_isolated` under the engine's
//! `processing_timeout` / `max_rss_bytes`. A job that overruns its
//! timeout or its RSS cap is **killed**, not detached, and reported
//! as a failure naming the limit; the batch carries on.
//!
//! # Worker protocol
//!
//! The parent sends one JSON [`IsolatedWorkSpec`] on the child's
//! stdin. The child runs the conversion in-process (it never
//! re-execs — the worker arm calls the engine directly), writes
//! the output **atomically** (temp file + rename, so a kill
//! mid-write never leaves a partial output), then prints the
//! [`ConvertResult`] / [`TargetSizeOutcome`] as JSON on stdout
//! and exits 0. On any failure it prints the error to stderr and
//! exits 1, and removes its temp file.
//!
//! The temp file is `<output>.openpixel-tmp` (same directory, so
//! the rename is atomic). The parent removes it after a kill —
//! see [`ChildJobSpec::temp_file`] / [`remove_temp_output`] —
//! because a SIGKILLed child cannot clean up after itself.
//!
//! # What is NOT isolated
//!
//! Only `convert`, `process` (including `--target-size`) and
//! `batch` use this module. `info`, `metadata`, `frames`,
//! `extract-frame`, `ocr`, `pdf` and `doc` run in-process as
//! before (they are fast metadata reads or delegate to their own
//! engines); `bench` runs in-process by design (it measures the
//! engine, not the supervisor). See `docs/SECURITY.md`.
//!
//! # Operator knobs (environment only, no flags)
//!
//! * `OPENPIXEL_PROCESSING_TIMEOUT_SECS` — per-conversion timeout
//!   in seconds (default 300, from `EngineConfig`).
//! * `OPENPIXEL_MAX_RSS_MB` — per-conversion RSS cap in MiB
//!   (default 2048, from `EngineConfig`).
//! * `OPENPIXEL_NO_ISOLATION=1` — run conversions in-process
//!   (debug / escape hatch only; the old detach-on-timeout
//!   behaviour returns with it — do not use it to "fix" a
//!   timeout, raise the timeout instead).
//!
//! An unreadable value warns on stderr and falls back to the
//! default; it never fails startup.

use openpixel_core::{ConvertOptions, Engine, EngineConfig, ImageFormat, ProcessOptions};
use openpixel_security::{IsolationError, IsolationLimits};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

/// Suffix for the worker's temp output (see the module docs).
pub const TEMP_OUTPUT_SUFFIX: &str = ".openpixel-tmp";

/// Which conversion the worker performs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkKind {
    /// `engine.convert_bytes`, no pipeline.
    Convert,
    /// `engine.process_bytes` with `ops` (+ `watermark`).
    Process,
    /// `engine.process_to_size_bytes` with `ops` (+ `watermark`)
    /// and `target_bytes`.
    ProcessToSize,
}

/// One conversion, as JSON on the worker's stdin. `ops` are
/// `--op` spec strings (see `parse_op_spec`): the parent renders
/// individual `--resize` / `--grayscale` / … flags into the same
/// strings in canonical order, so the worker rebuilds the exact
/// pipeline the parent validated. A watermark cannot be an op
/// spec (it needs an image file), so it travels separately and
/// the worker decodes it and inserts it in canonical position
/// (after colour ops, before flatten).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IsolatedWorkSpec {
    pub kind: WorkKind,
    pub input: PathBuf,
    pub output: PathBuf,
    /// Target format id, e.g. `"webp"` (`ImageFormat::id`).
    pub target: String,
    pub options: ConvertOptions,
    pub ops: Vec<String>,
    pub watermark: Option<WatermarkSpecJson>,
    pub target_bytes: Option<u64>,
}

/// A `--watermark` flag, as JSON: the worker decodes `path`
/// itself, so no image bytes cross the process boundary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatermarkSpecJson {
    pub path: PathBuf,
    /// Position name, e.g. `"bottom-right"`.
    pub position: String,
    pub opacity: f32,
    pub margin: u32,
}

impl IsolatedWorkSpec {
    /// A plain conversion (no pipeline, no target size).
    pub fn convert(
        input: PathBuf,
        output: PathBuf,
        target: ImageFormat,
        options: ConvertOptions,
    ) -> Self {
        Self {
            kind: WorkKind::Convert,
            input,
            output,
            target: target.id().to_string(),
            options,
            ops: Vec::new(),
            watermark: None,
            target_bytes: None,
        }
    }
}

/// Temp output path for `output` (same directory, fixed suffix).
pub fn temp_output_path(output: &Path) -> PathBuf {
    let mut name = output
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "output".to_string());
    name.push_str(TEMP_OUTPUT_SUFFIX);
    output.with_file_name(name)
}

/// Best-effort removal of a worker's temp output. A killed child
/// cannot remove its own, so the parent calls this after a kill.
pub fn remove_temp_output(output: &Path) {
    let _ = fs::remove_file(temp_output_path(output));
}

/// Build the engine config the CLI runs with: the defaults, plus
/// the `OPENPIXEL_PROCESSING_TIMEOUT_SECS` /
/// `OPENPIXEL_MAX_RSS_MB` overrides (see the module docs).
pub fn engine_config_from_env(quiet: bool) -> EngineConfig {
    let mut config = EngineConfig::default();
    if let Some(secs) = read_env_u64("OPENPIXEL_PROCESSING_TIMEOUT_SECS", quiet) {
        if secs == 0 {
            warn_env(
                quiet,
                "OPENPIXEL_PROCESSING_TIMEOUT_SECS=0 is not a timeout — using the default",
            );
        } else {
            config.processing_timeout = Duration::from_secs(secs);
        }
    }
    if let Some(mb) = read_env_u64("OPENPIXEL_MAX_RSS_MB", quiet) {
        if mb == 0 {
            warn_env(
                quiet,
                "OPENPIXEL_MAX_RSS_MB=0 is not a cap — using the default",
            );
        } else {
            config.max_rss_bytes = mb.saturating_mul(1024 * 1024);
        }
    }
    config
}

/// False when `OPENPIXEL_NO_ISOLATION=1` (or `=true`): the CLI
/// runs conversions in-process, with the old detach-on-timeout
/// behaviour. Debug / escape hatch only — see the module docs.
pub fn isolation_enabled() -> bool {
    match std::env::var("OPENPIXEL_NO_ISOLATION") {
        Ok(v) => {
            let v = v.trim().to_ascii_lowercase();
            !(v == "1" || v == "true" || v == "yes")
        }
        Err(_) => true,
    }
}

/// Limits for one supervised conversion, from the engine config.
pub fn limits_for(config: &EngineConfig) -> IsolationLimits {
    IsolationLimits::from_engine_config(config.processing_timeout, config.max_rss_bytes)
}

fn read_env_u64(name: &str, quiet: bool) -> Option<u64> {
    match std::env::var(name) {
        Ok(v) => match v.trim().parse::<u64>() {
            Ok(n) => Some(n),
            Err(_) => {
                warn_env(
                    quiet,
                    &format!("{name}={v} is not a number — using the default"),
                );
                None
            }
        },
        Err(_) => None,
    }
}

fn warn_env(quiet: bool, message: &str) {
    if !quiet {
        eprintln!("warning: {message}");
    }
}

/// The command that runs one job in a child process: this binary,
/// re-executed as the hidden `__isolated-work` subcommand.
pub fn isolated_work_command() -> std::io::Result<Command> {
    let exe = std::env::current_exe()?;
    let mut cmd = Command::new(exe);
    cmd.arg("__isolated-work");
    Ok(cmd)
}

/// Run one conversion in a supervised child process and parse its
/// stdout JSON as `T` (`ConvertResult` or `TargetSizeOutcome`).
/// On a timeout / RSS kill the error names the limit (via
/// `OpenPixelError::LimitExceeded`); on a child failure the
/// child's stderr is the error. A killed child's temp output is
/// removed. The CLI's JSON / text output shapes are unchanged —
/// the caller prints `T` exactly as it printed the in-process
/// result.
pub fn run_isolated<T>(
    spec: &IsolatedWorkSpec,
    limits: &IsolationLimits,
) -> Result<T, openpixel_core::OpenPixelError>
where
    T: serde::de::DeserializeOwned,
{
    use openpixel_core::OpenPixelError;
    let stdin = serde_json::to_vec(spec).map_err(|e| {
        OpenPixelError::Internal(format!("could not serialize isolated work spec: {e}"))
    })?;
    let cmd = isolated_work_command().map_err(|e| {
        OpenPixelError::Internal(format!(
            "could not re-execute openpixel for isolated work: {e}"
        ))
    })?;
    let out =
        openpixel_security::run_command_isolated(cmd, &stdin, limits).map_err(|e| match &e {
            IsolationError::TimedOut { .. } | IsolationError::RssCapExceeded { .. } => {
                remove_temp_output(&spec.output);
                OpenPixelError::LimitExceeded(e.to_string())
            }
            IsolationError::ChildFailed { .. } => {
                remove_temp_output(&spec.output);
                OpenPixelError::Internal(e.to_string())
            }
            _ => OpenPixelError::Internal(e.to_string()),
        })?;
    serde_json::from_slice::<T>(&out.stdout).map_err(|e| {
        OpenPixelError::Internal(format!(
            "isolated worker returned unparsable output: {e}; stderr: {}",
            String::from_utf8_lossy(&out.stderr)
        ))
    })
}

/// Target format for `output`, from its extension — the same
/// rule `Engine::convert_to_path` uses (`ImageFormat::from_name`
/// on the extension). The worker re-validates it.
pub fn target_format_for_output(
    output: &Path,
) -> Result<ImageFormat, openpixel_core::OpenPixelError> {
    let ext = output.extension().and_then(|e| e.to_str()).ok_or_else(|| {
        openpixel_core::OpenPixelError::InvalidArgument(
            "output path needs an extension, e.g. output.png".to_string(),
        )
    })?;
    ImageFormat::from_name(ext).ok_or_else(|| {
        openpixel_core::OpenPixelError::InvalidArgument(format!(
            "unknown output extension '.{ext}'"
        ))
    })
}

/// Target format id for `output`, from its extension.
pub fn target_name_for_output(output: &Path) -> Result<String, openpixel_core::OpenPixelError> {
    target_format_for_output(output).map(|f| f.id().to_string())
}

/// The worker itself: read one [`IsolatedWorkSpec`] from stdin,
/// run it through `engine`, write the output atomically, print
/// the result JSON on stdout, exit 0. Any failure: an error on
/// stderr, exit 1 (via the returned `Err`, which `main` maps to
/// `ExitCode::FAILURE` — the worker arm calls this directly and
/// returns its error the same way).
pub fn run_worker(engine: &Engine) -> Result<serde_json::Value, openpixel_core::OpenPixelError> {
    use openpixel_core::OpenPixelError;
    let mut stdin = Vec::new();
    std::io::stdin()
        .read_to_end(&mut stdin)
        .map_err(|e| OpenPixelError::Io {
            path: PathBuf::from("<stdin>"),
            source: e,
        })?;
    let spec: IsolatedWorkSpec = serde_json::from_slice(&stdin).map_err(|e| {
        OpenPixelError::InvalidArgument(format!("invalid isolated work spec on stdin: {e}"))
    })?;
    let target = ImageFormat::from_name(&spec.target).ok_or_else(|| {
        OpenPixelError::InvalidArgument(format!("unknown target format '{}'", spec.target))
    })?;
    let bytes = fs::read(&spec.input).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            OpenPixelError::NotFound(spec.input.clone())
        } else {
            OpenPixelError::Io {
                path: spec.input.clone(),
                source: e,
            }
        }
    })?;
    let (result_json, out_bytes) = match spec.kind {
        WorkKind::Convert => {
            let (mut result, out) = engine.convert_bytes(&bytes, target, &spec.options)?;
            result.output_path = spec.output.to_string_lossy().to_string();
            (to_json_value(result)?, out)
        }
        WorkKind::Process => {
            let options = build_process_options(engine, &spec)?;
            let (mut result, out) = engine.process_bytes(&bytes, target, &options)?;
            result.output_path = spec.output.to_string_lossy().to_string();
            (to_json_value(result)?, out)
        }
        WorkKind::ProcessToSize => {
            let target_bytes = spec.target_bytes.ok_or_else(|| {
                OpenPixelError::InvalidArgument(
                    "process_to_size work needs target_bytes".to_string(),
                )
            })?;
            let options = build_process_options(engine, &spec)?;
            let (mut outcome, out) =
                engine.process_to_size_bytes(&bytes, target, &options, target_bytes)?;
            outcome.result.output_path = spec.output.to_string_lossy().to_string();
            (to_json_value(outcome)?, out)
        }
    };
    // Atomic write: temp file in the same directory, then rename.
    // A kill between the write and the rename leaves only the temp
    // file (the parent removes it); the final path is never partial.
    write_output_atomically(&spec.output, &out_bytes)?;
    Ok(result_json)
}

/// Serialize a result for stdout. `serde_json::Error` has no
/// `From` into `OpenPixelError`, so it is mapped explicitly.
fn to_json_value<T: Serialize>(
    value: T,
) -> Result<serde_json::Value, openpixel_core::OpenPixelError> {
    serde_json::to_value(value).map_err(|e| {
        openpixel_core::OpenPixelError::Internal(format!("could not serialize result: {e}"))
    })
}

/// Rebuild the worker's pipeline from the spec's op strings, in
/// order, inserting the watermark (if any) in canonical position:
/// after every other op, before flatten. The parent already
/// validated these strings by building its own pipeline from
/// them, so a parse failure here is an internal error, not a
/// user error.
fn build_process_options(
    engine: &Engine,
    spec: &IsolatedWorkSpec,
) -> Result<ProcessOptions, openpixel_core::OpenPixelError> {
    use openpixel_core::OpenPixelError;
    let mut ops = Vec::with_capacity(spec.ops.len());
    for s in &spec.ops {
        ops.push(crate::parse_op_spec(s)?);
    }
    if let Some(wm) = &spec.watermark {
        let overlay = engine.decode_file(&wm.path)?;
        let position =
            openpixel_core::WatermarkPosition::from_name(&wm.position).ok_or_else(|| {
                OpenPixelError::InvalidArgument(format!(
                    "invalid watermark position '{}'",
                    wm.position
                ))
            })?;
        let op = openpixel_core::Operation::Watermark {
            overlay,
            position,
            opacity: wm.opacity,
            margin: wm.margin,
        };
        // Canonical order (PipelineSpec::build): watermark comes
        // after colour/blur/sharpen and before flatten.
        let flatten_at = ops
            .iter()
            .position(|o| matches!(o, openpixel_core::Operation::Flatten { .. }));
        match flatten_at {
            Some(i) => ops.insert(i, op),
            None => ops.push(op),
        }
    }
    Ok(ProcessOptions::new(
        spec.options.clone(),
        openpixel_core::Pipeline::from_operations(ops),
    ))
}

/// Write `bytes` to `output` via a temp file + rename, creating
/// parent directories as needed. On failure the temp file is
/// removed; the final path is never left partial.
fn write_output_atomically(
    output: &Path,
    bytes: &[u8],
) -> Result<(), openpixel_core::OpenPixelError> {
    use openpixel_core::OpenPixelError;
    openpixel_core::security::validate_output_path(output)?;
    if let Some(parent) = output.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| OpenPixelError::Io {
                path: parent.to_path_buf(),
                source: e,
            })?;
        }
    }
    let tmp = temp_output_path(output);
    if let Err(e) = fs::write(&tmp, bytes) {
        let _ = fs::remove_file(&tmp);
        return Err(OpenPixelError::Io {
            path: output.to_path_buf(),
            source: e,
        });
    }
    if let Err(e) = fs::rename(&tmp, output) {
        let _ = fs::remove_file(&tmp);
        return Err(OpenPixelError::Io {
            path: output.to_path_buf(),
            source: e,
        });
    }
    Ok(())
}

/// Render individual `--process` flags as `--op` spec strings in
/// canonical order (see `PipelineSpec::build`), so the worker can
/// rebuild the parent's pipeline exactly. `rotate` is normalised
/// the way `PipelineSpec::build` normalises it (360° is a no-op,
/// -90° is 270°); `flatten` carries the background colour.
/// Colours arrive as parsed RGB (the parent already parsed the
/// `--background` / `--pad-color` / `--rotate-background` strings)
/// and render as `#rrggbb`, which `parse_op_spec` reads back.
/// `watermark` is returned separately — it cannot be an op spec.
///
/// Twenty parameters, one per `--process` flag: bundling them
/// into a struct would only rename the call site, and the
/// function takes exactly the flag list it renders.
#[allow(clippy::too_many_arguments)]
pub fn individual_flags_to_op_specs(
    resize: Option<&str>,
    resize_fit: Option<&str>,
    resize_fill: Option<&str>,
    pad: Option<&str>,
    pad_color: [u8; 3],
    crop: Option<&str>,
    thumbnail: Option<u32>,
    rotate: Option<f32>,
    rotate_background: [u8; 3],
    flip_h: bool,
    flip_v: bool,
    grayscale: bool,
    brightness: Option<f32>,
    contrast: Option<f32>,
    saturation: Option<f32>,
    blur: Option<f32>,
    sharpen: Option<f32>,
    sharpen_threshold: i32,
    flatten: bool,
    background: [u8; 3],
) -> Vec<String> {
    let mut ops: Vec<String> = Vec::new();
    if let Some(v) = resize {
        ops.push(format!("resize:{v}"));
    }
    if let Some(v) = resize_fit {
        ops.push(format!("resize-fit:{v}"));
    }
    if let Some(v) = resize_fill {
        ops.push(format!("resize-fill:{v}"));
    }
    if let Some(v) = pad {
        ops.push(format!("pad:{v}:{}", rgb_hex(pad_color)));
    }
    if let Some(v) = crop {
        ops.push(format!("crop:{v}"));
    }
    if let Some(v) = thumbnail {
        ops.push(format!("thumbnail:{v}"));
    }
    if let Some(deg) = rotate {
        let norm = ((deg % 360.0) + 360.0) % 360.0;
        if norm != 0.0 {
            if norm == 90.0 || norm == 180.0 || norm == 270.0 {
                ops.push(format!("rotate:{norm}"));
            } else {
                ops.push(format!("rotate:{deg}:{}", rgb_hex(rotate_background)));
            }
        }
    }
    if flip_h {
        ops.push("flip-h".to_string());
    }
    if flip_v {
        ops.push("flip-v".to_string());
    }
    if grayscale {
        ops.push("grayscale".to_string());
    }
    if let Some(v) = brightness {
        ops.push(format!("brightness:{v}"));
    }
    if let Some(v) = contrast {
        ops.push(format!("contrast:{v}"));
    }
    if let Some(v) = saturation {
        ops.push(format!("saturation:{v}"));
    }
    if let Some(v) = blur {
        ops.push(format!("blur:{v}"));
    }
    if let Some(v) = sharpen {
        ops.push(format!("sharpen:{v}:{sharpen_threshold}"));
    }
    if flatten {
        ops.push(format!("flatten:{}", rgb_hex(background)));
    }
    ops
}

/// `#rrggbb` for a parsed colour — the form `parse_op_spec`
/// (via `parse_background`) reads back.
fn rgb_hex(color: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", color[0], color[1], color[2])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_json_round_trips() {
        let spec = IsolatedWorkSpec {
            kind: WorkKind::ProcessToSize,
            input: PathBuf::from("in.png"),
            output: PathBuf::from("out.jpg"),
            target: "jpeg".to_string(),
            options: ConvertOptions {
                quality: Some(80),
                ..ConvertOptions::default()
            },
            ops: vec!["resize:800x600".to_string(), "grayscale".to_string()],
            watermark: Some(WatermarkSpecJson {
                path: PathBuf::from("logo.png"),
                position: "bottom-right".to_string(),
                opacity: 0.5,
                margin: 8,
            }),
            target_bytes: Some(50_000),
        };
        let json = serde_json::to_string(&spec).unwrap();
        let back: IsolatedWorkSpec = serde_json::from_str(&json).unwrap();
        assert_eq!(back.kind, WorkKind::ProcessToSize);
        assert_eq!(back.target, "jpeg");
        assert_eq!(back.ops.len(), 2);
        assert_eq!(back.target_bytes, Some(50_000));
        assert_eq!(back.watermark.as_ref().unwrap().opacity, 0.5);
    }

    #[test]
    fn individual_flags_render_in_canonical_order() {
        let ops = individual_flags_to_op_specs(
            Some("800x600"), // resize
            None,
            None,
            None,
            [255, 255, 255],
            None,
            None,
            Some(90.0),
            [255, 255, 255],
            true,  // flip_h
            false, // flip_v
            true,  // grayscale
            None,
            None,
            None,
            None,
            None,
            0,
            false,
            [255, 255, 255],
        );
        assert_eq!(
            ops,
            vec!["resize:800x600", "rotate:90", "flip-h", "grayscale"]
        );
    }

    #[test]
    fn rotate_360_is_a_noop_and_negative_normalises() {
        let ops = individual_flags_to_op_specs(
            None,
            None,
            None,
            None,
            [255, 255, 255],
            None,
            None,
            Some(360.0),
            [255, 255, 255],
            false,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            0,
            false,
            [255, 255, 255],
        );
        assert!(ops.is_empty(), "360° rotation is a no-op: {ops:?}");
        let ops = individual_flags_to_op_specs(
            None,
            None,
            None,
            None,
            [255, 255, 255],
            None,
            None,
            Some(-90.0),
            [255, 255, 255],
            false,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            0,
            false,
            [255, 255, 255],
        );
        assert_eq!(ops, vec!["rotate:270"]);
        let ops = individual_flags_to_op_specs(
            None,
            None,
            None,
            None,
            [255, 255, 255],
            None,
            None,
            Some(45.0),
            [255, 0, 0],
            false,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            0,
            false,
            [255, 255, 255],
        );
        assert_eq!(ops, vec!["rotate:45:#ff0000"]);
    }

    #[test]
    fn temp_path_is_beside_the_output() {
        assert_eq!(
            temp_output_path(Path::new("/tmp/out/photo.jpg")),
            PathBuf::from("/tmp/out/photo.jpg.openpixel-tmp")
        );
    }

    #[test]
    fn target_name_comes_from_the_extension() {
        assert_eq!(
            target_name_for_output(Path::new("out.webp")).unwrap(),
            "webp"
        );
        assert_eq!(
            target_name_for_output(Path::new("out.JPG")).unwrap(),
            "jpeg"
        );
        assert!(target_name_for_output(Path::new("noext")).is_err());
        assert!(target_name_for_output(Path::new("out.xyz")).is_err());
    }
}
