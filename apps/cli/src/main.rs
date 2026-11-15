use clap::{Parser, Subcommand};
use openpixel_core::security::parse_background;
use openpixel_core::{detect_format, ConvertOptions, Engine, EngineConfig, ImageFormat};
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(
    name = "openpixel",
    version,
    about = "OpenPixel Engine — local image conversion (Phase 2)"
)]
struct Cli {
    /// Output machine-readable JSON instead of human text
    #[arg(long, global = true)]
    json: bool,
    /// Only errors
    #[arg(long, global = true)]
    quiet: bool,
    /// Extra detail
    #[arg(long, global = true)]
    verbose: bool,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Show format, dimensions, colour type and size for an image
    Info { input: PathBuf },
    /// Convert one image: openpixel convert input.jpg output.png
    Convert {
        input: PathBuf,
        output: PathBuf,
        /// JPEG quality 1-100 (default 85). Ignored for lossless formats.
        #[arg(long)]
        quality: Option<u8>,
        /// PNG compression 0=fast, 1=default, 2=best
        #[arg(long)]
        png_compression: Option<u8>,
        /// Background when flattening alpha: white, black, or #RRGGBB
        #[arg(long, default_value = "white")]
        background: String,
    },
    /// Identify a file's real format: signature vs extension vs MIME
    Discover { input: PathBuf },
    /// List every format the registry knows, with what this build can do
    Formats,
    /// Show capabilities for one format, e.g. `capabilities avif`
    Capabilities { format: String },
    /// Convert every image in a directory (Phase 1: sequential, no parallelism yet)
    Batch {
        input_dir: PathBuf,
        /// Target format, e.g. webp
        #[arg(long)]
        format: String,
        /// JPEG quality 1-100
        #[arg(long)]
        quality: Option<u8>,
        /// Where to write outputs (default: <input_dir>/openpixel-out)
        #[arg(long)]
        out_dir: Option<PathBuf>,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let engine = Engine::new(EngineConfig::default());
    match run(&cli, &engine) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            if !cli.quiet {
                eprintln!("error: {e}");
            }
            ExitCode::FAILURE
        }
    }
}

fn run(cli: &Cli, engine: &Engine) -> Result<(), openpixel_core::OpenPixelError> {
    match &cli.command {
        Commands::Info { input } => {
            let info = engine.get_image_info(input)?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&info).unwrap());
            } else {
                println!("file:      {}", input.display());
                println!(
                    "format:    {}  (detected by signature, not extension)",
                    info.format
                );
                println!("size:      {}x{} px", info.width, info.height);
                println!("colour:    {}", info.color_type);
                println!("alpha:     {}", if info.has_alpha { "yes" } else { "no" });
                println!("file size: {} bytes", info.file_size_bytes);
                if let Some(n) = &info.note {
                    println!("note:      {n}");
                }
            }
            Ok(())
        }
        Commands::Convert {
            input,
            output,
            quality,
            png_compression,
            background,
        } => {
            let options = ConvertOptions {
                quality: *quality,
                png_compression: *png_compression,
                background: parse_background(background)?,
                preserve_metadata: false,
            };
            let result = engine.convert_to_path(input, output, &options)?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result).unwrap());
            } else if !cli.quiet {
                println!(
                    "converted {} ({}x{}) -> {} : {} bytes -> {} bytes",
                    result.source_format,
                    result.width,
                    result.height,
                    result.target_format,
                    result.input_bytes,
                    result.output_bytes
                );
                println!("wrote {}", result.output_path);
            }
            Ok(())
        }
        Commands::Discover { input } => {
            let bytes = fs::read(input).map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    openpixel_core::OpenPixelError::NotFound(input.clone())
                } else {
                    openpixel_core::OpenPixelError::Io {
                        path: input.clone(),
                        source: e,
                    }
                }
            })?;
            let ext = input.extension().and_then(|e| e.to_str());
            let result = engine.discover_format(&bytes, ext, None);
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result).unwrap());
            } else {
                println!("file:       {}", input.display());
                println!("format:     {}", result.format);
                println!("method:     {:?}", result.method);
                println!("confidence: {:?}", result.confidence);
                if result.has_mismatch() {
                    println!(
                        "warning:    extension claims {:?} but the signature says {}",
                        result.extension_claim, result.format
                    );
                }
            }
            Ok(())
        }
        Commands::Formats => {
            let caps = engine.get_capabilities();
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&caps).unwrap());
            } else {
                println!(
                    "{:<10} {:<7} {:<7} {:<6} {:<9} status",
                    "format", "decode", "encode", "alpha", "anim"
                );
                for c in &caps {
                    println!(
                        "{:<10} {:<7} {:<7} {:<6} {:<9} {}",
                        c.format_id,
                        yes(c.can_decode),
                        yes(c.can_encode),
                        yes(c.supports_alpha),
                        yes(c.supports_animation),
                        c.status
                    );
                }
                println!("\nOnly formats with decode=yes and encode=yes convert in Phase 2.");
                println!("Use `openpixel capabilities <format>` for full detail.");
            }
            Ok(())
        }
        Commands::Capabilities { format } => {
            let fmt = ImageFormat::from_name(format).ok_or_else(|| {
                openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "unknown format '{format}'"
                ))
            })?;
            let cap = engine.get_capability(fmt).ok_or_else(|| {
                openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "unknown format '{format}'"
                ))
            })?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&cap).unwrap());
            } else {
                println!("format:     {}", cap.format_id);
                println!("extensions: {}", cap.extensions.join(", "));
                println!("mime:       {}", cap.mime_types.join(", "));
                println!("decode:     {}", yes(cap.can_decode));
                println!("encode:     {}", yes(cap.can_encode));
                println!("alpha:      {}", yes(cap.supports_alpha));
                println!("animation:  {}", yes(cap.supports_animation));
                println!("metadata:   {}", yes(cap.supports_metadata));
                println!("icc:        {}", yes(cap.supports_icc));
                println!("multi-frame: {}", yes(cap.supports_multiple_frames));
                println!("dependency: {}", cap.native_dependency);
                println!("license:    {}", cap.license);
                println!("status:     {}", cap.status);
                println!("max dim:    {} px", cap.max_dimension);
            }
            Ok(())
        }
        Commands::Batch {
            input_dir,
            format,
            quality,
            out_dir,
        } => {
            let target = ImageFormat::from_name(format).ok_or_else(|| {
                openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "unknown format '{format}'"
                ))
            })?;
            let out_dir = out_dir
                .clone()
                .unwrap_or_else(|| input_dir.join("openpixel-out"));
            fs::create_dir_all(&out_dir).map_err(|e| openpixel_core::OpenPixelError::Io {
                path: out_dir.clone(),
                source: e,
            })?;
            let mut done = 0usize;
            let mut failed = 0usize;
            let mut entries: Vec<_> = fs::read_dir(input_dir)
                .map_err(|e| openpixel_core::OpenPixelError::Io {
                    path: input_dir.clone(),
                    source: e,
                })?
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_file())
                .collect();
            entries.sort();
            for input in entries {
                // Skip files we cannot even detect — report, don't crash the batch.
                let bytes = match fs::read(&input) {
                    Ok(b) => b,
                    Err(_) => {
                        failed += 1;
                        continue;
                    }
                };
                if detect_format(&bytes) == ImageFormat::Unknown {
                    if cli.verbose {
                        println!("skip (unknown format): {}", input.display());
                    }
                    continue;
                }
                let stem = input
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "out".into());
                // Same stem from different sources (photo.jpg + photo.png)
                // must not silently overwrite each other.
                let mut output = out_dir.join(format!("{stem}.{}", target.extensions()[0]));
                if output.exists() {
                    let src_ext = input
                        .extension()
                        .map(|e| e.to_string_lossy().to_string())
                        .unwrap_or_else(|| "img".into());
                    output = out_dir.join(format!("{stem}-{src_ext}.{}", target.extensions()[0]));
                }
                let options = ConvertOptions {
                    quality: *quality,
                    background: [255, 255, 255],
                    ..Default::default()
                };
                match engine.convert(&input, &output, target, &options) {
                    Ok(r) => {
                        done += 1;
                        if cli.verbose {
                            println!(
                                "ok: {} -> {} ({} bytes)",
                                input.display(),
                                r.output_path,
                                r.output_bytes
                            );
                        }
                    }
                    Err(e) => {
                        failed += 1;
                        eprintln!("failed: {}: {e}", input.display());
                    }
                }
            }
            if cli.json {
                println!(
                    "{}",
                    serde_json::json!({"converted": done, "failed": failed, "out_dir": out_dir})
                );
            } else if !cli.quiet {
                println!(
                    "batch done: {done} converted, {failed} failed -> {}",
                    out_dir.display()
                );
            }
            Ok(())
        }
    }
}

fn yes(b: bool) -> &'static str {
    if b {
        "yes"
    } else {
        "no"
    }
}
