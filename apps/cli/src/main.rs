use clap::{Parser, Subcommand};
use openpixel_core::security::parse_background;
use openpixel_core::{
    detect_format, ConvertOptions, Engine, EngineConfig, ImageFormat, MetadataPolicy, Operation,
    Pipeline, PipelineSpec, ProcessOptions, WatermarkPosition, WatermarkSpec,
};
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(
    name = "openpixel",
    version,
    about = "OpenPixel Engine — local image conversion and processing (Phase 5)"
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
// The Process variant is large by nature (one field per flag); boxing
// its Vec field is not an option because clap's derive has no value
// parser for Box<Vec<String>>. The enum is constructed once per run,
// so the size difference is immaterial.
#[allow(clippy::large_enum_variant)]
enum Commands {
    /// Show format, dimensions, colour type and size for an image
    Info { input: PathBuf },
    /// Show EXIF / ICC / XMP metadata for an image
    Metadata { input: PathBuf },
    /// List the frames of an animated image (GIF / APNG / animated WebP) or the pages of a multi-page TIFF
    Frames { input: PathBuf },
    /// Extract one frame (GIF) or page (TIFF) and write it as an image: openpixel extract-frame input.gif frame2.png --frame 2
    ExtractFrame {
        input: PathBuf,
        output: PathBuf,
        /// Frame / page index, 0-based (default 0)
        #[arg(long, default_value = "0")]
        frame: u32,
        /// JPEG quality 1-100 (default 85). Ignored for lossless formats.
        #[arg(long)]
        quality: Option<u8>,
        /// PNG compression 0=fast, 1=default, 2=best
        #[arg(long)]
        png_compression: Option<u8>,
        /// Background when flattening alpha: white, black, or #RRGGBB
        #[arg(long, default_value = "white")]
        background: String,
        /// Keep metadata: preserve, strip, color-profiles, normalize-orientation, selected:exif,icc,xmp,gps
        #[arg(long)]
        metadata: Option<String>,
        /// Legacy shorthand for --metadata preserve
        #[arg(long)]
        preserve_metadata: bool,
        /// Convert pixels to sRGB using the embedded ICC profile
        #[arg(long)]
        to_srgb: bool,
    },
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
        /// Keep metadata: preserve, strip, color-profiles, normalize-orientation, selected:exif,icc,xmp,gps
        #[arg(long)]
        metadata: Option<String>,
        /// Legacy shorthand for --metadata preserve
        #[arg(long)]
        preserve_metadata: bool,
        /// Convert only this frame (GIF) / page (TIFF), 0-based
        #[arg(long)]
        frame: Option<u32>,
        /// Convert pixels to sRGB using the embedded ICC profile
        #[arg(long)]
        to_srgb: bool,
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
    /// Process one image and write it out: openpixel process input.png output.jpg --resize 800x600 --grayscale --rotate 90
    ///
    /// Individual flags apply in the documented canonical order
    /// (resize/crop -> rotate/flip -> colour/blur/sharpen ->
    /// watermark -> flatten). For exact ordering, use repeatable
    /// --op instead (e.g. --op crop:0,0,100,100 --op flip-h);
    /// --op cannot be combined with individual operation flags.
    /// Negative numbers are allowed, so --brightness -0.2 works.
    #[command(allow_negative_numbers = true)]
    Process {
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
        /// Keep metadata: preserve, strip, color-profiles, normalize-orientation, selected:exif,icc,xmp,gps
        #[arg(long)]
        metadata: Option<String>,
        /// Legacy shorthand for --metadata preserve
        #[arg(long)]
        preserve_metadata: bool,
        /// Convert only this frame (GIF) / page (TIFF), 0-based
        #[arg(long)]
        frame: Option<u32>,
        /// Convert pixels to sRGB using the embedded ICC profile
        #[arg(long)]
        to_srgb: bool,
        /// Exact size, e.g. 800x600 (aspect ratio ignored)
        #[arg(long, value_name = "WxH")]
        resize: Option<String>,
        /// Fit inside a box, e.g. 800x600 (aspect preserved, never upscales)
        #[arg(long, value_name = "WxH")]
        resize_fit: Option<String>,
        /// Fill and centre-crop to exactly WxH, e.g. 800x600
        #[arg(long, value_name = "WxH")]
        resize_fill: Option<String>,
        /// Pad to exactly WxH with --pad-color, e.g. 800x600
        #[arg(long, value_name = "WxH")]
        pad: Option<String>,
        /// Pad colour: white, black, or #RRGGBB
        #[arg(long, default_value = "white")]
        pad_color: String,
        /// Crop rectangle, e.g. 10,20,400,300 (x,y,width,height)
        #[arg(long, value_name = "X,Y,W,H")]
        crop: Option<String>,
        /// Fit inside a max-dimension box, e.g. 256 (never upscales)
        #[arg(long)]
        thumbnail: Option<u32>,
        /// Rotation in degrees: 90/180/270 are exact; any other value
        /// rotates arbitrarily with --rotate-background fill
        #[arg(long)]
        rotate: Option<f32>,
        /// Fill colour for arbitrary rotation: white, black, or #RRGGBB
        #[arg(long, default_value = "white")]
        rotate_background: String,
        /// Mirror left-right
        #[arg(long)]
        flip_h: bool,
        /// Mirror top-bottom
        #[arg(long)]
        flip_v: bool,
        /// Convert to greyscale
        #[arg(long)]
        grayscale: bool,
        /// Brightness -1.0..=1.0 (-1 black, 0 unchanged, 1 white)
        #[arg(long)]
        brightness: Option<f32>,
        /// Contrast -1.0..=1.0 (0 unchanged)
        #[arg(long)]
        contrast: Option<f32>,
        /// Saturation 0.0..=2.0 (0 greyscale, 1 unchanged, 2 double)
        #[arg(long)]
        saturation: Option<f32>,
        /// Gaussian blur sigma, e.g. 2.0
        #[arg(long)]
        blur: Option<f32>,
        /// Unsharp-mask sigma, e.g. 1.0 (with --sharpen-threshold)
        #[arg(long)]
        sharpen: Option<f32>,
        /// Sharpen threshold 0..=255 (default 0)
        #[arg(long, default_value = "0")]
        sharpen_threshold: i32,
        /// Image watermark file (PNG logo); no text watermark in Phase 4
        #[arg(long)]
        watermark: Option<PathBuf>,
        /// Watermark position: top-left, top-right, bottom-left, bottom-right, center
        #[arg(long, default_value = "bottom-right")]
        watermark_position: String,
        /// Watermark opacity 0.0..=1.0 (default 0.5)
        #[arg(long, default_value = "0.5")]
        watermark_opacity: f32,
        /// Watermark margin in px at the corners (default 8)
        #[arg(long, default_value = "8")]
        watermark_margin: u32,
        /// Flatten alpha onto --background as an explicit step
        #[arg(long)]
        flatten: bool,
        /// One operation, in order: resize:800x600, crop:0,0,100,100,
        /// rotate:90, flip-h, flip-v, grayscale, brightness:0.2,
        /// contrast:0.1, saturation:1.5, blur:2.0, sharpen:1.0,
        /// thumbnail:256, pad:800x600, flatten, resize-fit:800x600,
        /// resize-fill:800x600. Repeatable; order is honoured.
        #[arg(long, value_name = "SPEC")]
        op: Vec<String>,
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
                if info.is_animated {
                    println!(
                        "animated:  yes ({} frame{})",
                        info.frame_count.unwrap_or(0),
                        if info.frame_count == Some(1) { "" } else { "s" }
                    );
                }
                if let Some(o) = info.orientation {
                    println!("orientation: {o}");
                }
                println!("exif:      {}", yes(info.has_exif));
                println!("icc:       {}", yes(info.has_icc));
                println!("xmp:       {}", yes(info.has_xmp));
                if let Some(n) = &info.note {
                    println!("note:      {n}");
                }
            }
            Ok(())
        }
        Commands::Metadata { input } => {
            let meta = engine.read_metadata(input)?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&meta).unwrap());
            } else {
                println!("file:      {}", input.display());
                println!("summary:   {}", meta.summary());
                if let Some(o) = meta.orientation {
                    println!("orientation: {o}");
                }
                if let Some(make) = &meta.make {
                    println!(
                        "camera:    {make}{}",
                        meta.model
                            .as_ref()
                            .map(|m| format!(" {m}"))
                            .unwrap_or_default()
                    );
                }
                if let Some(dt) = meta.date_time_original.as_ref().or(meta.date_time.as_ref()) {
                    println!("taken:     {dt}");
                }
                if let Some(gps) = meta.gps {
                    println!(
                        "gps:       {:.5}, {:.5}{}",
                        gps.latitude,
                        gps.longitude,
                        gps.altitude_m
                            .map(|a| format!(" ({a} m)"))
                            .unwrap_or_default()
                    );
                }
                if let (Some(x), Some(y)) = (meta.x_resolution, meta.y_resolution) {
                    println!(
                        "resolution: {x:.1} x {y:.1} (unit {})",
                        meta.resolution_unit.unwrap_or(0)
                    );
                }
                if let Some(icc) = &meta.icc {
                    println!(
                        "icc:       {} ({} bytes{})",
                        icc.description.as_deref().unwrap_or(&icc.color_space),
                        icc.size_bytes,
                        if icc.is_srgb { ", sRGB" } else { "" }
                    );
                }
                println!("xmp:       {}", yes(meta.has_xmp));
                for w in &meta.warnings {
                    println!("warning:   {w}");
                }
            }
            Ok(())
        }
        Commands::Frames { input } => {
            let info = engine.list_frames(input)?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&info).unwrap());
            } else {
                println!("file:      {}", input.display());
                println!("format:    {}", info.format);
                println!(
                    "frames:    {}{}",
                    info.frame_count,
                    if info.format == "tiff" {
                        " (multi-page)".to_string()
                    } else if info.is_animated {
                        " (animated)".to_string()
                    } else {
                        String::new()
                    }
                );
                if let Some(loops) = info.loop_count {
                    println!(
                        "loops:     {}",
                        if loops == 0 {
                            "forever".to_string()
                        } else {
                            loops.to_string()
                        }
                    );
                }
                println!(
                    "{:<6} {:<9} {:<9} {:<9} {:<8}",
                    "index", "size", "offset", "delay", "dispose"
                );
                for f in &info.frames {
                    println!(
                        "{:<6} {:<9} {:<9} {:<9} {:<8}",
                        f.index,
                        format!("{}x{}", f.width, f.height),
                        format!("{},{}", f.offset_x, f.offset_y),
                        f.delay_ms
                            .map(|d| format!("{d} ms"))
                            .unwrap_or_else(|| "-".to_string()),
                        f.disposal
                            .map(|d| d.to_string())
                            .unwrap_or_else(|| "-".to_string())
                    );
                }
                if let Some(n) = &info.note {
                    println!("note:      {n}");
                }
            }
            Ok(())
        }
        Commands::ExtractFrame {
            input,
            output,
            frame,
            quality,
            png_compression,
            background,
            metadata,
            preserve_metadata,
            to_srgb,
        } => {
            let options = ConvertOptions {
                quality: *quality,
                png_compression: *png_compression,
                background: parse_background(background)?,
                preserve_metadata: *preserve_metadata,
                metadata_policy: resolve_metadata_policy(*preserve_metadata, metadata.as_deref())?,
                selected_frame: Some(*frame),
                convert_to_srgb: *to_srgb,
            };
            let result = engine.extract_frame_to_path(input, *frame, output, &options)?;
            print_convert_result(cli, &result, "extracted");
            Ok(())
        }
        Commands::Convert {
            input,
            output,
            quality,
            png_compression,
            background,
            metadata,
            preserve_metadata,
            frame,
            to_srgb,
        } => {
            let options = ConvertOptions {
                quality: *quality,
                png_compression: *png_compression,
                background: parse_background(background)?,
                preserve_metadata: *preserve_metadata,
                metadata_policy: resolve_metadata_policy(*preserve_metadata, metadata.as_deref())?,
                selected_frame: *frame,
                convert_to_srgb: *to_srgb,
            };
            let result = engine.convert_to_path(input, output, &options)?;
            print_convert_result(cli, &result, "converted");
            Ok(())
        }
        Commands::Process {
            input,
            output,
            quality,
            png_compression,
            background,
            metadata,
            preserve_metadata,
            frame,
            to_srgb,
            resize,
            resize_fit,
            resize_fill,
            pad,
            pad_color,
            crop,
            thumbnail,
            rotate,
            rotate_background,
            flip_h,
            flip_v,
            grayscale,
            brightness,
            contrast,
            saturation,
            blur,
            sharpen,
            sharpen_threshold,
            watermark,
            watermark_position,
            watermark_opacity,
            watermark_margin,
            flatten,
            op,
        } => {
            let background = parse_background(background)?;
            let rotate_background = parse_background(rotate_background)?;
            let pad_color = parse_background(pad_color)?;
            let individual_set = resize.is_some()
                || resize_fit.is_some()
                || resize_fill.is_some()
                || pad.is_some()
                || crop.is_some()
                || thumbnail.is_some()
                || rotate.is_some()
                || *flip_h
                || *flip_v
                || *grayscale
                || brightness.is_some()
                || contrast.is_some()
                || saturation.is_some()
                || blur.is_some()
                || sharpen.is_some()
                || watermark.is_some()
                || *flatten;
            if !op.is_empty() && individual_set {
                return Err(openpixel_core::OpenPixelError::InvalidArgument(
                    "cannot combine --op with individual operation flags; use --op alone for exact ordering, or individual flags for the documented canonical order".to_string(),
                ));
            }
            let pipeline = if !op.is_empty() {
                let mut ops = Vec::with_capacity(op.len());
                for spec in op {
                    ops.push(parse_op_spec(spec)?);
                }
                Pipeline::from_operations(ops)
            } else {
                let mut spec = PipelineSpec {
                    resize: resize.as_deref().map(parse_dimensions).transpose()?,
                    resize_fit: resize_fit.as_deref().map(parse_dimensions).transpose()?,
                    resize_fill: resize_fill.as_deref().map(parse_dimensions).transpose()?,
                    crop: crop.as_deref().map(parse_crop).transpose()?,
                    thumbnail: *thumbnail,
                    rotate_degrees: *rotate,
                    rotate_background,
                    flip_horizontal: *flip_h,
                    flip_vertical: *flip_v,
                    grayscale: *grayscale,
                    brightness: *brightness,
                    contrast: *contrast,
                    saturation: *saturation,
                    blur: *blur,
                    sharpen: sharpen.map(|s| (s, *sharpen_threshold)),
                    flatten: if *flatten { Some(background) } else { None },
                    ..Default::default()
                };
                if let Some((w, h)) = pad.as_deref().map(parse_dimensions).transpose()? {
                    spec.pad = Some((w, h, pad_color));
                }
                if let Some(wm_path) = watermark {
                    let position = parse_watermark_position(watermark_position)?;
                    spec.watermark = Some(WatermarkSpec {
                        overlay: engine.decode_file(wm_path)?,
                        position,
                        opacity: *watermark_opacity,
                        margin: *watermark_margin,
                    });
                }
                spec.build()?
            };
            let options = ProcessOptions::new(
                ConvertOptions {
                    quality: *quality,
                    png_compression: *png_compression,
                    background,
                    preserve_metadata: *preserve_metadata,
                    metadata_policy: resolve_metadata_policy(
                        *preserve_metadata,
                        metadata.as_deref(),
                    )?,
                    selected_frame: *frame,
                    convert_to_srgb: *to_srgb,
                },
                pipeline,
            );
            let op_count = options.pipeline.len();
            let result = engine.process_to_path(input, output, &options)?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result).unwrap());
            } else if !cli.quiet {
                println!(
                    "processed {} ({}x{}) -> {} : {} bytes -> {} bytes ({} operation{})",
                    result.source_format,
                    result.width,
                    result.height,
                    result.target_format,
                    result.input_bytes,
                    result.output_bytes,
                    op_count,
                    if op_count == 1 { "" } else { "s" },
                );
                println!("wrote {}", result.output_path);
                print_warnings(cli, &result);
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
                println!("\nFormats with decode=yes convert as a source; formats with encode=yes convert as a target.");
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

/// Resolve the metadata policy from the CLI flags: an explicit
/// `--metadata <policy>` wins; `--preserve-metadata` means
/// `preserve`; otherwise the policy is `None` (engine default =
/// strip). An unknown policy name is a clean error.
fn resolve_metadata_policy(
    preserve: bool,
    policy: Option<&str>,
) -> Result<Option<MetadataPolicy>, openpixel_core::OpenPixelError> {
    match policy {
        Some(name) => MetadataPolicy::from_name(name)
            .map(Some)
            .ok_or_else(|| {
                openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "unknown metadata policy '{name}' — use preserve, strip, color-profiles, normalize-orientation, or selected:exif,icc,xmp,gps"
                ))
            }),
        None => {
            if preserve {
                Ok(Some(MetadataPolicy::Preserve))
            } else {
                Ok(None)
            }
        }
    }
}

fn print_warnings(cli: &Cli, result: &openpixel_core::ConvertResult) {
    if cli.quiet {
        return;
    }
    for w in &result.warnings {
        println!("warning: {w}");
    }
    if let Some(o) = &result.orientation_applied {
        println!("orientation: {o}");
    }
    if !result.metadata_preserved.is_empty() {
        println!(
            "metadata preserved: {}",
            result.metadata_preserved.join(", ")
        );
    }
    if !result.metadata_dropped.is_empty() {
        for d in &result.metadata_dropped {
            println!("metadata dropped: {d}");
        }
    }
}

fn print_convert_result(cli: &Cli, result: &openpixel_core::ConvertResult, verb: &str) {
    if cli.json {
        println!("{}", serde_json::to_string_pretty(&result).unwrap());
    } else if !cli.quiet {
        println!(
            "{verb} {} ({}x{}) -> {} : {} bytes -> {} bytes",
            result.source_format,
            result.width,
            result.height,
            result.target_format,
            result.input_bytes,
            result.output_bytes
        );
        println!("wrote {}", result.output_path);
        print_warnings(cli, result);
    }
}

fn yes(b: bool) -> &'static str {
    if b {
        "yes"
    } else {
        "no"
    }
}

/// Parse "800x600" into (800, 600).
fn parse_dimensions(s: &str) -> Result<(u32, u32), openpixel_core::OpenPixelError> {
    let err = || {
        openpixel_core::OpenPixelError::InvalidArgument(format!(
            "invalid size '{s}' — use WxH, e.g. 800x600"
        ))
    };
    let mut parts = s.split(['x', 'X']);
    let w = parts.next().ok_or_else(err)?;
    let h = parts.next().ok_or_else(err)?;
    if parts.next().is_some() {
        return Err(err());
    }
    let w: u32 = w.parse().map_err(|_| err())?;
    let h: u32 = h.parse().map_err(|_| err())?;
    Ok((w, h))
}

/// Parse "10,20,400,300" into (x, y, width, height).
fn parse_crop(s: &str) -> Result<(u32, u32, u32, u32), openpixel_core::OpenPixelError> {
    let err = || {
        openpixel_core::OpenPixelError::InvalidArgument(format!(
            "invalid crop '{s}' — use X,Y,W,H, e.g. 10,20,400,300"
        ))
    };
    let parts: Vec<&str> = s.split(',').collect();
    if parts.len() != 4 {
        return Err(err());
    }
    let nums: Vec<u32> = parts
        .iter()
        .map(|p| p.trim().parse().map_err(|_| err()))
        .collect::<Result<_, _>>()?;
    Ok((nums[0], nums[1], nums[2], nums[3]))
}

fn parse_watermark_position(s: &str) -> Result<WatermarkPosition, openpixel_core::OpenPixelError> {
    WatermarkPosition::from_name(s).ok_or_else(|| {
        openpixel_core::OpenPixelError::InvalidArgument(format!(
            "invalid watermark position '{s}' — use top-left, top-right, bottom-left, bottom-right, or center"
        ))
    })
}

fn parse_f32(s: &str, what: &str) -> Result<f32, openpixel_core::OpenPixelError> {
    s.parse().map_err(|_| {
        openpixel_core::OpenPixelError::InvalidArgument(format!("invalid {what} '{s}'"))
    })
}

/// Parse one `--op SPEC` string into an operation. The watermark
/// operation is deliberately unavailable here — it needs an image
/// file, so it only exists as the `--watermark` flag.
fn parse_op_spec(s: &str) -> Result<Operation, openpixel_core::OpenPixelError> {
    let invalid = |msg: String| openpixel_core::OpenPixelError::InvalidArgument(msg);
    let (name, arg) = match s.split_once(':') {
        Some((n, a)) => (n, Some(a)),
        None => (s, None),
    };
    let need_arg = |what: &str| -> Result<&str, openpixel_core::OpenPixelError> {
        arg.ok_or_else(|| invalid(format!("--op {name} needs an argument, e.g. {what}")))
    };
    match name {
        "resize" => {
            let (w, h) = parse_dimensions(need_arg("resize:800x600")?)?;
            Ok(Operation::Resize {
                width: w,
                height: h,
            })
        }
        "resize-fit" | "resize_fit" => {
            let (w, h) = parse_dimensions(need_arg("resize-fit:800x600")?)?;
            Ok(Operation::ResizeFit {
                width: w,
                height: h,
            })
        }
        "resize-fill" | "resize_fill" => {
            let (w, h) = parse_dimensions(need_arg("resize-fill:800x600")?)?;
            Ok(Operation::ResizeFill {
                width: w,
                height: h,
            })
        }
        "pad" => {
            let a = need_arg("pad:800x600")?;
            let (dims, color) = match a.split_once(':') {
                Some((d, c)) => (d, parse_background(c)?),
                None => (a, [255, 255, 255]),
            };
            let (w, h) = parse_dimensions(dims)?;
            Ok(Operation::Pad {
                width: w,
                height: h,
                color,
            })
        }
        "crop" => {
            let (x, y, w, h) = parse_crop(need_arg("crop:10,20,400,300")?)?;
            Ok(Operation::Crop {
                x,
                y,
                width: w,
                height: h,
            })
        }
        "thumbnail" => {
            let a = need_arg("thumbnail:256")?;
            let m: u32 = a
                .parse()
                .map_err(|_| invalid(format!("invalid thumbnail '{a}'")))?;
            Ok(Operation::Thumbnail { max_dimension: m })
        }
        "rotate" => {
            let a = need_arg("rotate:90")?;
            let (deg_s, bg) = match a.split_once(':') {
                Some((d, c)) => (d, parse_background(c)?),
                None => (a, [255, 255, 255]),
            };
            let deg = parse_f32(deg_s, "rotate degrees")?;
            Ok(match deg {
                _ if deg == 90.0 => Operation::Rotate90,
                _ if deg == 180.0 => Operation::Rotate180,
                _ if deg == 270.0 => Operation::Rotate270,
                _ => Operation::RotateArbitrary {
                    degrees: deg,
                    background: bg,
                },
            })
        }
        "flip-h" | "flip-horizontal" => Ok(Operation::FlipHorizontal),
        "flip-v" | "flip-vertical" => Ok(Operation::FlipVertical),
        "grayscale" => Ok(Operation::Grayscale),
        "brightness" => Ok(Operation::Brightness {
            value: parse_f32(need_arg("brightness:0.2")?, "brightness")?,
        }),
        "contrast" => Ok(Operation::Contrast {
            value: parse_f32(need_arg("contrast:0.1")?, "contrast")?,
        }),
        "saturation" => Ok(Operation::Saturation {
            value: parse_f32(need_arg("saturation:1.5")?, "saturation")?,
        }),
        "blur" => Ok(Operation::Blur {
            sigma: parse_f32(need_arg("blur:2.0")?, "blur sigma")?,
        }),
        "sharpen" => {
            let a = need_arg("sharpen:1.0")?;
            let (sigma_s, threshold) = match a.split_once(':') {
                Some((s, t)) => (
                    s,
                    t.parse::<i32>().map_err(|_| {
                        invalid(format!("invalid sharpen threshold '{t}'"))
                    })?,
                ),
                None => (a, 0),
            };
            Ok(Operation::Sharpen {
                sigma: parse_f32(sigma_s, "sharpen sigma")?,
                threshold,
            })
        }
        "flatten" => {
            let bg = match arg {
                Some(c) => parse_background(c)?,
                None => [255, 255, 255],
            };
            Ok(Operation::Flatten { background: bg })
        }
        "watermark" => Err(invalid(
            "--op watermark is not supported (it needs an image file); use --watermark <file> instead".to_string(),
        )),
        other => Err(invalid(format!(
            "unknown --op '{other}' — see `openpixel process --help`"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dimensions_and_crop() {
        assert_eq!(parse_dimensions("800x600").unwrap(), (800, 600));
        assert_eq!(parse_dimensions("800X600").unwrap(), (800, 600));
        assert!(parse_dimensions("800").is_err());
        assert!(parse_dimensions("800x600x400").is_err());
        assert!(parse_dimensions("ax600").is_err());
        assert_eq!(parse_crop("10,20,400,300").unwrap(), (10, 20, 400, 300));
        assert!(parse_crop("10,20,400").is_err());
        assert!(parse_crop("10,20,400,300,5").is_err());
    }

    #[test]
    fn parses_op_specs_in_order() {
        let ops: Vec<Operation> = ["resize:800x600", "grayscale", "rotate:90", "flip-h"]
            .iter()
            .map(|s| parse_op_spec(s).unwrap())
            .collect();
        assert!(matches!(ops[0], Operation::Resize { .. }));
        assert!(matches!(ops[1], Operation::Grayscale));
        assert!(matches!(ops[2], Operation::Rotate90));
        assert!(matches!(ops[3], Operation::FlipHorizontal));
        assert!(matches!(
            parse_op_spec("rotate:45").unwrap(),
            Operation::RotateArbitrary { .. }
        ));
        assert!(matches!(
            parse_op_spec("blur:2.0").unwrap(),
            Operation::Blur { .. }
        ));
        assert!(matches!(
            parse_op_spec("sharpen:1.5:10").unwrap(),
            Operation::Sharpen { threshold: 10, .. }
        ));
        assert!(matches!(
            parse_op_spec("flatten:#ff0000").unwrap(),
            Operation::Flatten { .. }
        ));
        assert!(parse_op_spec("watermark:logo.png").is_err());
        assert!(parse_op_spec("frobnicate:1").is_err());
        assert!(parse_op_spec("resize").is_err());
    }

    #[test]
    fn parses_watermark_positions() {
        assert_eq!(
            parse_watermark_position("top-left").unwrap(),
            WatermarkPosition::TopLeft
        );
        assert_eq!(
            parse_watermark_position("CENTER").unwrap(),
            WatermarkPosition::Center
        );
        assert!(parse_watermark_position("middle").is_err());
    }
}

#[cfg(test)]
mod phase5_tests {
    use super::*;

    #[test]
    fn resolves_metadata_policy_flags() {
        assert_eq!(resolve_metadata_policy(false, None).unwrap(), None);
        assert_eq!(
            resolve_metadata_policy(true, None).unwrap(),
            Some(MetadataPolicy::Preserve)
        );
        assert_eq!(
            resolve_metadata_policy(false, Some("strip")).unwrap(),
            Some(MetadataPolicy::Strip)
        );
        assert_eq!(
            resolve_metadata_policy(false, Some("normalize-orientation")).unwrap(),
            Some(MetadataPolicy::NormalizeOrientation)
        );
        assert_eq!(
            resolve_metadata_policy(true, Some("selected:icc")).unwrap(),
            Some(MetadataPolicy::PreserveSelected {
                fields: vec![openpixel_core::MetadataField::Icc]
            })
        );
        // An explicit --metadata wins over --preserve-metadata.
        assert_eq!(
            resolve_metadata_policy(true, Some("strip")).unwrap(),
            Some(MetadataPolicy::Strip)
        );
        assert!(resolve_metadata_policy(false, Some("bogus")).is_err());
    }
}
