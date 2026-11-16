use crate::error::{OpenPixelError, Result};
use crate::image::{ConvertOptions, ConvertResult, ImageInfo, ProcessOptions, TargetSizeOutcome};
use crate::security::{check_dimensions, check_file_size, validate_output_path, EngineConfig};
use openpixel_codecs::{CodecRegistry, DecodedImage};
use openpixel_formats::{detect_format, discover, DiscoveryResult, FormatCapability, ImageFormat};
use openpixel_metadata::{
    animation_info, apply_policy, convert_to_srgb, extract_gif_frame, extract_metadata,
    extract_tiff_page, normalize_orientation, orientation_description, AnimationInfo, Metadata,
    MetadataPolicy,
};
use openpixel_pipeline::{Operation, Pipeline};
use std::fs;
use std::path::{Path, PathBuf};

/// The unified engine interface. Applications (web / desktop / CLI / WASM)
/// must go through this — they never call a codec directly.
///
/// Phase 2: the engine owns a [`CodecRegistry`] and asks it for the
/// codec for a format. It holds no format list and no codec code of
/// its own. To add a format, register a codec — the engine, the CLI
/// and the capability listing all follow automatically.
pub struct Engine {
    config: EngineConfig,
    registry: CodecRegistry,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new(EngineConfig::default())
    }
}

impl Engine {
    pub fn new(config: EngineConfig) -> Self {
        Self {
            config,
            registry: CodecRegistry::default(),
        }
    }

    /// Build an engine over a custom registry — how tests inject a
    /// fake codec, and how Phase 3 will inject a native codec.
    pub fn with_registry(config: EngineConfig, registry: CodecRegistry) -> Self {
        Self { config, registry }
    }

    pub fn config(&self) -> &EngineConfig {
        &self.config
    }

    pub fn registry(&self) -> &CodecRegistry {
        &self.registry
    }

    /// Detect the actual format from magic bytes (never the extension).
    pub fn detect_format(&self, bytes: &[u8]) -> ImageFormat {
        detect_format(bytes)
    }

    pub fn detect_format_from_file(&self, path: &Path) -> Result<ImageFormat> {
        let bytes = self.read_input(path)?;
        let format = detect_format(&bytes);
        if format == ImageFormat::Unknown {
            return Err(OpenPixelError::UnknownFormat);
        }
        Ok(format)
    }

    /// Full discovery: signature first, extension/MIME only as a
    /// low-confidence fallback, with mismatch reporting.
    /// `extension` is the file extension without the dot, if any.
    pub fn discover_format(
        &self,
        bytes: &[u8],
        extension: Option<&str>,
        mime: Option<&str>,
    ) -> DiscoveryResult {
        discover(bytes, extension, mime)
    }

    /// Capabilities are built by the registry from the codecs actually
    /// registered — never a hard-coded list.
    pub fn get_capabilities(&self) -> Vec<FormatCapability> {
        self.registry.capabilities()
    }

    pub fn get_capability(&self, format: ImageFormat) -> Option<FormatCapability> {
        self.registry.capability(format)
    }

    fn read_input(&self, path: &Path) -> Result<Vec<u8>> {
        let meta = fs::metadata(path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                OpenPixelError::NotFound(path.to_path_buf())
            } else {
                OpenPixelError::Io {
                    path: path.to_path_buf(),
                    source: e,
                }
            }
        })?;
        check_file_size(meta.len(), &self.config)?;
        let bytes = fs::read(path).map_err(|e| OpenPixelError::Io {
            path: path.to_path_buf(),
            source: e,
        })?;
        // Re-check after the read: the file may have grown between
        // the metadata check and the read (TOCTOU), and a symlink
        // target may report a different size than what was read.
        // Fixed in Phase 9.
        check_file_size(bytes.len() as u64, &self.config)?;
        Ok(bytes)
    }

    /// Read a file, detect its format by signature and decode it to
    /// the canonical `DecodedImage`. The CLI uses this to load a
    /// watermark image; `process` uses it for the source image.
    pub fn decode_file(&self, path: &Path) -> Result<DecodedImage> {
        let (_, img, _) = self.read_and_decode(path)?;
        Ok(img)
    }

    /// Read a file's metadata (EXIF / ICC / XMP) from its own bytes.
    /// Never fails on corrupt metadata — that degrades to warnings
    /// inside the returned `Metadata`.
    pub fn read_metadata(&self, path: &Path) -> Result<Metadata> {
        let bytes = self.read_input(path)?;
        let format = detect_format(&bytes);
        Ok(extract_metadata(&bytes, format))
    }

    /// Frame information for a file: counts, delays, disposal, loop
    /// count. For GIF / TIFF every frame is extractable; for APNG /
    /// animated WebP this is header information only (first frame
    /// decodable — see `extract_frame`).
    pub fn animation_info(&self, path: &Path) -> Result<AnimationInfo> {
        let bytes = self.read_input(path)?;
        let format = detect_format(&bytes);
        if format == ImageFormat::Unknown {
            return Err(OpenPixelError::UnknownFormat);
        }
        Ok(animation_info(&bytes, format))
    }

    /// Alias for [`Engine::animation_info`], named after what the
    /// CLI command does.
    pub fn list_frames(&self, path: &Path) -> Result<AnimationInfo> {
        self.animation_info(path)
    }

    /// Decode one frame (GIF) / page (TIFF) of a file, 0-based.
    /// APNG / animated WebP support only frame 0 in Phase 5 — any
    /// other index is an error, never a silent first-frame fallback.
    pub fn extract_frame(&self, path: &Path, index: u32) -> Result<DecodedImage> {
        let (_, img, _) = self.read_decode_frame(path, Some(index))?;
        Ok(img)
    }

    /// Extract one frame / page and write it as an image file, the
    /// target format inferred from the output extension. Metadata
    /// policy, orientation normalisation and colour conversion from
    /// `options` apply exactly as in `convert`.
    pub fn extract_frame_to_path(
        &self,
        input: &Path,
        index: u32,
        output: &Path,
        options: &ConvertOptions,
    ) -> Result<ConvertResult> {
        let target = target_from_output_path(output)?;
        let (source_format, img, bytes) = self.read_decode_frame(input, Some(index))?;
        let metadata = extract_metadata(&bytes, source_format);
        let anim = animation_info(&bytes, source_format);
        let (img, orientation_applied, warnings, srgb_converted) =
            self.prepare_image(&img, &metadata, &anim, source_format, options, true)?;
        self.encode_and_write(
            EncodeRequest {
                image: &img,
                source_format,
                input_bytes: bytes.len() as u64,
                target,
                options,
                metadata: &metadata,
                warnings,
                orientation_applied,
                converted_to_srgb: srgb_converted,
            },
            output,
        )
    }

    /// Shared decode path: read -> signature detect -> registry
    /// lookup -> decode -> dimension limits. Returns the detected
    /// format, the image, and the source bytes (kept so the caller
    /// can read metadata / frames from the same bytes).
    fn read_and_decode(&self, path: &Path) -> Result<(ImageFormat, DecodedImage, Vec<u8>)> {
        self.read_decode_frame(path, None)
    }

    /// Like [`Engine::read_and_decode`], but decodes frame `frame`
    /// instead of the first frame/page when `frame` is `Some(n)`
    /// with `n > 0`. Frame 0 (or `None`) is the normal first-frame
    /// decode through the registered codec.
    fn read_decode_frame(
        &self,
        path: &Path,
        frame: Option<u32>,
    ) -> Result<(ImageFormat, DecodedImage, Vec<u8>)> {
        let bytes = self.read_input(path)?;
        let (format, img) = self.decode_bytes(&bytes, frame)?;
        Ok((format, img, bytes))
    }

    /// Decode from in-memory bytes — the same pipeline as
    /// [`Engine::read_decode_frame`] without touching the filesystem.
    /// This is the entry point the WASM bindings use (a browser has no
    /// filesystem for the engine to read from), and the file-based
    /// methods above delegate to it. The engine security limits apply
    /// here too: oversize input is rejected before any codec runs.
    pub fn decode_bytes(
        &self,
        bytes: &[u8],
        frame: Option<u32>,
    ) -> Result<(ImageFormat, DecodedImage)> {
        check_file_size(bytes.len() as u64, &self.config)?;
        let format = detect_format(bytes);
        if format == ImageFormat::Unknown {
            return Err(OpenPixelError::UnknownFormat);
        }
        if let Some(n) = frame {
            if n > 0 {
                let img = self.decode_selected_frame(format, bytes, n)?;
                check_dimensions(img.width, img.height, &self.config)?;
                return Ok((format, img));
            }
        }
        let codec = self.registry.get(format).ok_or_else(|| {
            let status = self
                .registry
                .capability(format)
                .map(|c| c.status.to_string())
                .unwrap_or_else(|| "not implemented".to_string());
            OpenPixelError::NotImplemented(format!(
                "{format} is detected but not decodable in this build ({status})",
                format = format.id()
            ))
        })?;
        // Header-only dimensions where the codec supports it, then a
        // full decode for colour type / alpha — Phase 2 trades a decode
        // for correctness; header-only colour info lands in Phase 4.
        let (width, height) = codec.dimensions(bytes)?;
        check_dimensions(width, height, &self.config)?;
        let img = codec.decode(bytes)?;
        check_dimensions(img.width, img.height, &self.config)?;
        Ok((format, img))
    }

    /// Decode a non-first frame / page. GIF and TIFF are fully
    /// supported; APNG / animated WebP are frame-info only in
    /// Phase 5; anything else has no frames to select.
    fn decode_selected_frame(
        &self,
        format: ImageFormat,
        bytes: &[u8],
        index: u32,
    ) -> Result<DecodedImage> {
        match format {
            ImageFormat::Gif => Ok(extract_gif_frame(bytes, index)?),
            ImageFormat::Tiff => Ok(extract_tiff_page(bytes, index)?),
            ImageFormat::Png => Err(OpenPixelError::NotImplemented(format!(
                "APNG frame {index} is not extractable in Phase 5 (frame info only; first frame decodes normally)"
            ))),
            ImageFormat::Webp => Err(OpenPixelError::NotImplemented(format!(
                "animated WebP frame {index} is not extractable in Phase 5 (frame info only; first frame decodes normally)"
            ))),
            _ => Err(OpenPixelError::InvalidArgument(format!(
                "frame {index} cannot be selected: {} has no animation or pages",
                format.id()
            ))),
        }
    }

    pub fn get_image_info(&self, path: &Path) -> Result<ImageInfo> {
        let (format, img, bytes) = self.read_and_decode(path)?;
        self.image_info_from_decoded(format, &img, &bytes)
    }

    /// [`Engine::get_image_info`] for in-memory bytes — the entry
    /// point the WASM bindings use. Same metadata / frame reporting,
    /// no filesystem access.
    pub fn get_image_info_bytes(&self, bytes: &[u8]) -> Result<ImageInfo> {
        let (format, img) = self.decode_bytes(bytes, None)?;
        self.image_info_from_decoded(format, &img, bytes)
    }

    /// Shared body of [`Engine::get_image_info`] and
    /// [`Engine::get_image_info_bytes`].
    fn image_info_from_decoded(
        &self,
        format: ImageFormat,
        img: &DecodedImage,
        bytes: &[u8],
    ) -> Result<ImageInfo> {
        let metadata = extract_metadata(bytes, format);
        // Real frame counts for the animated / multi-page formats;
        // the plain decode's first-frame values for everything else.
        let (is_animated, frame_count, note) = match format {
            ImageFormat::Gif | ImageFormat::Png | ImageFormat::Webp | ImageFormat::Tiff => {
                let anim = animation_info(bytes, format);
                let count = if anim.frame_count > 0 {
                    Some(anim.frame_count)
                } else {
                    img.frame_count
                };
                (anim.is_animated, count, anim.note.or(img.note.clone()))
            }
            _ => (img.is_animated, img.frame_count, img.note.clone()),
        };
        Ok(ImageInfo {
            format,
            width: img.width,
            height: img.height,
            color_type: img.pixel_format.name().to_string(),
            has_alpha: img.has_alpha(),
            file_size_bytes: bytes.len() as u64,
            is_animated,
            frame_count,
            note,
            orientation: metadata.orientation,
            has_exif: metadata.has_exif,
            has_icc: metadata.has_icc(),
            has_xmp: metadata.has_xmp,
        })
    }

    /// Convert one file. Pipeline (Phase 2):
    /// signature detect -> registry lookup (source + target) ->
    /// decode via source codec -> canonical `DecodedImage` ->
    /// encode via target codec (alpha flattening inside the codec) ->
    /// output validation (re-detect what was written).
    ///
    /// Phase 5: before encoding, the source's metadata policy is
    /// applied (orientation normalisation, sRGB conversion), an
    /// animated source flattened to one frame warns, and after
    /// encoding the metadata is spliced into the output where the
    /// target supports it — anything dropped is reported in
    /// `ConvertResult::warnings`, never silently claimed.
    pub fn convert(
        &self,
        input: &Path,
        output: &Path,
        target: ImageFormat,
        options: &ConvertOptions,
    ) -> Result<ConvertResult> {
        let (source_format, img, bytes) = self.read_decode_frame(input, options.selected_frame)?;
        let metadata = extract_metadata(&bytes, source_format);
        let anim = animation_info(&bytes, source_format);
        let (img, orientation_applied, warnings, srgb_converted) =
            self.prepare_image(&img, &metadata, &anim, source_format, options, false)?;
        self.encode_and_write(
            EncodeRequest {
                image: &img,
                source_format,
                input_bytes: bytes.len() as u64,
                target,
                options,
                metadata: &metadata,
                warnings,
                orientation_applied,
                converted_to_srgb: srgb_converted,
            },
            output,
        )
    }

    /// [`Engine::convert`] for in-memory bytes — the entry point the
    /// WASM bindings use. Same pipeline (detect -> decode -> metadata
    /// policy / orientation / sRGB preparation -> encode -> output
    /// validation), but the encoded bytes are returned to the caller
    /// instead of written to a file, and `ConvertResult::output_path`
    /// is empty because there is no file. The engine security limits
    /// (input size, dimensions) apply exactly as for files.
    pub fn convert_bytes(
        &self,
        bytes: &[u8],
        target: ImageFormat,
        options: &ConvertOptions,
    ) -> Result<(ConvertResult, Vec<u8>)> {
        let (source_format, img) = self.decode_bytes(bytes, options.selected_frame)?;
        let metadata = extract_metadata(bytes, source_format);
        let anim = animation_info(bytes, source_format);
        let (img, orientation_applied, warnings, srgb_converted) =
            self.prepare_image(&img, &metadata, &anim, source_format, options, false)?;
        self.encode_to_bytes(EncodeRequest {
            image: &img,
            source_format,
            input_bytes: bytes.len() as u64,
            target,
            options,
            metadata: &metadata,
            warnings,
            orientation_applied,
            converted_to_srgb: srgb_converted,
        })
    }

    /// [`Engine::process`] for in-memory bytes — the entry point
    /// the WASM bindings use for resize. Same pipeline as `process`
    /// (decode -> metadata policy / orientation / sRGB preparation
    /// -> pipeline -> encode -> output validation), but the encoded
    /// bytes are returned to the caller instead of written to a
    /// file, and `ConvertResult::output_path` is empty because
    /// there is no file.
    pub fn process_bytes(
        &self,
        bytes: &[u8],
        target: ImageFormat,
        options: &ProcessOptions,
    ) -> Result<(ConvertResult, Vec<u8>)> {
        let (source_format, img) = self.decode_bytes(bytes, options.convert.selected_frame)?;
        let metadata = extract_metadata(bytes, source_format);
        let anim = animation_info(bytes, source_format);
        let (img, orientation_applied, warnings, srgb_converted) = self.prepare_image(
            &img,
            &metadata,
            &anim,
            source_format,
            &options.convert,
            false,
        )?;
        let processed = options.pipeline.apply(&img)?;
        check_dimensions(processed.width, processed.height, &self.config)?;
        self.encode_to_bytes(EncodeRequest {
            image: &processed,
            source_format,
            input_bytes: bytes.len() as u64,
            target,
            options: &options.convert,
            metadata: &metadata,
            warnings,
            orientation_applied,
            converted_to_srgb: srgb_converted,
        })
    }

    /// Process in-memory bytes, choosing the encode quality so the
    /// output fits inside `target_bytes` — the "compress to X KB"
    /// mode the web Resize tab and `openpixel process
    /// --target-size` share.
    ///
    /// The source is decoded and the pipeline applied **once**;
    /// every quality attempt encodes from that same decoded image,
    /// never from a compressed output, so the search itself costs
    /// no quality. The search is a binary search over quality
    /// 1..=100 (at most 7 encodes) and returns the highest quality
    /// whose output fits. When nothing fits, the smallest result
    /// is returned with `target_met: false` and a warning saying
    /// so — never a silent overshoot, never a fake "met".
    ///
    /// Only formats with a real quality knob can be searched:
    /// JPEG, AVIF, HEIC and HEIF. PNG is lossless, so its only
    /// lever is compression level — best compression is tried and
    /// the result reported honestly when it still does not fit.
    /// WebP is deliberately excluded: image-rs 0.25 encodes WebP
    /// losslessly only, so quality does not change its size and a
    /// search would be theatre. Every other format has no quality
    /// setting at all and returns an honest error instead of a
    /// pretended fit (see CODECS.md, "no quality knob").
    pub fn process_to_size_bytes(
        &self,
        bytes: &[u8],
        target: ImageFormat,
        options: &ProcessOptions,
        target_bytes: u64,
    ) -> Result<(TargetSizeOutcome, Vec<u8>)> {
        if target_bytes == 0 {
            return Err(OpenPixelError::InvalidArgument(
                "target size must be at least 1 byte".to_string(),
            ));
        }
        let lossy = matches!(
            target,
            ImageFormat::Jpeg | ImageFormat::Avif | ImageFormat::Heic | ImageFormat::Heif
        );
        if !lossy && target != ImageFormat::Png {
            return Err(OpenPixelError::InvalidArgument(format!(
                "target size is only supported for lossy formats (JPEG, AVIF, HEIC, HEIF) and PNG (best compression) — {} has no quality setting to search",
                target.id()
            )));
        }
        let (source_format, img) = self.decode_bytes(bytes, options.convert.selected_frame)?;
        let metadata = extract_metadata(bytes, source_format);
        let anim = animation_info(bytes, source_format);
        let (img, orientation_applied, warnings, srgb_converted) = self.prepare_image(
            &img,
            &metadata,
            &anim,
            source_format,
            &options.convert,
            false,
        )?;
        let processed = options.pipeline.apply(&img)?;
        check_dimensions(processed.width, processed.height, &self.config)?;
        // One encode at a given quality / PNG compression, from the
        // same decoded + processed pixels every time.
        let encode_at = |quality: Option<u8>,
                         png_compression: Option<u8>,
                         warnings: Vec<String>|
         -> Result<(ConvertResult, Vec<u8>)> {
            let mut convert = options.convert.clone();
            convert.quality = quality;
            convert.png_compression = png_compression;
            self.encode_to_bytes(EncodeRequest {
                image: &processed,
                source_format,
                input_bytes: bytes.len() as u64,
                target,
                options: &convert,
                metadata: &metadata,
                warnings,
                orientation_applied: orientation_applied.clone(),
                converted_to_srgb: srgb_converted,
            })
        };
        if target == ImageFormat::Png {
            let (mut result, out) = encode_at(None, Some(2), warnings)?;
            let size = out.len() as u64;
            if size <= target_bytes {
                return Ok((
                    TargetSizeOutcome {
                        result,
                        quality_used: None,
                        target_met: true,
                    },
                    out,
                ));
            }
            result.warnings.push(format!(
                "target size {target_bytes} bytes could not be met — PNG is lossless, so quality cannot shrink it; even best compression gives {size} bytes. Convert to JPEG for a smaller file, or resize to smaller dimensions"
            ));
            return Ok((
                TargetSizeOutcome {
                    result,
                    quality_used: None,
                    target_met: false,
                },
                out,
            ));
        }
        let mut lo: u32 = 1;
        let mut hi: u32 = 100;
        let mut best: Option<(u8, ConvertResult, Vec<u8>)> = None;
        let mut smallest: Option<(u8, ConvertResult, Vec<u8>)> = None;
        // Binary search: size grows (near-)monotonically with
        // quality for JPEG/AVIF/HEIC, so 7 attempts pin down the
        // highest fitting quality. Each attempt is independent —
        // all encode from `processed`, never from each other.
        for _ in 0..7 {
            if lo > hi {
                break;
            }
            let mid = ((lo + hi) / 2) as u8;
            let (result, out) = encode_at(Some(mid), None, warnings.clone())?;
            let size = out.len() as u64;
            if size <= target_bytes {
                best = Some((mid, result, out));
                lo = mid as u32 + 1;
            } else {
                let is_smallest = smallest
                    .as_ref()
                    .is_none_or(|(_, _, prev): &(_, _, Vec<u8>)| out.len() < prev.len());
                if is_smallest {
                    smallest = Some((mid, result, out));
                }
                if mid == 0 {
                    break;
                }
                hi = mid as u32 - 1;
            }
        }
        if let Some((quality, result, out)) = best {
            return Ok((
                TargetSizeOutcome {
                    result,
                    quality_used: Some(quality),
                    target_met: true,
                },
                out,
            ));
        }
        let (quality, mut result, out) =
            smallest.expect("at least one encode attempt ran in the search");
        result.warnings.push(format!(
            "target size {target_bytes} bytes could not be met — smallest result is {} bytes at quality {quality}; try a larger target or resize to smaller dimensions",
            out.len()
        ));
        Ok((
            TargetSizeOutcome {
                result,
                quality_used: Some(quality),
                target_met: false,
            },
            out,
        ))
    }

    /// File-based [`Engine::process_to_size_bytes`]: the target
    /// format comes from the output extension (like
    /// `process_to_path`), the best result is written to `output`,
    /// and the outcome reports the quality used and whether the
    /// target was met.
    pub fn process_to_size(
        &self,
        input: &Path,
        output: &Path,
        options: &ProcessOptions,
        target_bytes: u64,
    ) -> Result<TargetSizeOutcome> {
        let bytes = self.read_input(input)?;
        let target = target_from_output_path(output)?;
        let (mut outcome, out) =
            self.process_to_size_bytes(&bytes, target, options, target_bytes)?;
        write_output_file(output, &out)?;
        outcome.result.output_path = output.to_string_lossy().to_string();
        Ok(outcome)
    }

    /// Convert one file with a processing pipeline in between:
    /// decode -> pipeline (in order) -> encode. An empty pipeline
    /// behaves exactly like [`Engine::convert`]. Pipeline errors
    /// (crop out of bounds, resize to 0, oversize result) are typed
    /// errors, raised before anything is written.
    pub fn process(
        &self,
        input: &Path,
        output: &Path,
        target: ImageFormat,
        options: &ProcessOptions,
    ) -> Result<ConvertResult> {
        let (source_format, img, bytes) =
            self.read_decode_frame(input, options.convert.selected_frame)?;
        let metadata = extract_metadata(&bytes, source_format);
        let anim = animation_info(&bytes, source_format);
        let (img, orientation_applied, warnings, srgb_converted) = self.prepare_image(
            &img,
            &metadata,
            &anim,
            source_format,
            &options.convert,
            false,
        )?;
        // Orientation normalisation happens at decode (above), before
        // the user's pipeline — the pipeline then works on upright
        // pixels, so a crop/rotate means what the user sees.
        let processed = options.pipeline.apply(&img)?;
        check_dimensions(processed.width, processed.height, &self.config)?;
        self.encode_and_write(
            EncodeRequest {
                image: &processed,
                source_format,
                input_bytes: bytes.len() as u64,
                target,
                options: &options.convert,
                metadata: &metadata,
                warnings,
                orientation_applied,
                converted_to_srgb: srgb_converted,
            },
            output,
        )
    }

    /// Alias for [`Engine::process`], named after what it does for
    /// callers that think in conversions rather than processing.
    pub fn convert_with_pipeline(
        &self,
        input: &Path,
        output: &Path,
        target: ImageFormat,
        options: &ProcessOptions,
    ) -> Result<ConvertResult> {
        self.process(input, output, target, options)
    }

    /// Infer the target format from the output extension, then
    /// convert. The *source* is still detected by signature, never
    /// by extension.
    pub fn convert_to_path(
        &self,
        input: &Path,
        output: &Path,
        options: &ConvertOptions,
    ) -> Result<ConvertResult> {
        let target = target_from_output_path(output)?;
        self.convert(input, output, target, options)
    }

    /// Like [`Engine::convert_to_path`], but with a pipeline.
    pub fn process_to_path(
        &self,
        input: &Path,
        output: &Path,
        options: &ProcessOptions,
    ) -> Result<ConvertResult> {
        let target = target_from_output_path(output)?;
        self.process(input, output, target, options)
    }

    /// Phase 5 source preparation, shared by `convert`, `process`
    /// and `extract_frame_to_path`: orientation normalisation (when
    /// the policy asks for it), sRGB conversion (when asked for and
    /// an ICC profile is present), and the animated-source warning.
    /// Nothing here fails the conversion: a problem is recorded as
    /// a warning and the original pixels are kept.
    ///
    /// `frame_selected` is true when the caller already picked a
    /// frame explicitly — then no flattening warning is needed.
    /// Returns `(image, orientation_applied, warnings, srgb_converted)`.
    /// `srgb_converted` is true only when the pixels were actually
    /// re-encoded into sRGB — in that case the source ICC profile no
    /// longer describes the pixels and must not be preserved (see
    /// `encode_and_write`).
    fn prepare_image(
        &self,
        img: &DecodedImage,
        metadata: &Metadata,
        animation: &AnimationInfo,
        source_format: ImageFormat,
        options: &ConvertOptions,
        frame_selected: bool,
    ) -> Result<(DecodedImage, Option<String>, Vec<String>, bool)> {
        let mut warnings: Vec<String> = metadata.warnings.clone();
        let mut img = img.clone();
        let mut orientation_applied = None;
        let mut srgb_converted = false;
        let policy = options.effective_policy();
        if policy == MetadataPolicy::NormalizeOrientation {
            if let Some(o) = metadata.orientation {
                if o != 1 {
                    match normalize_orientation(&img, Some(o)) {
                        Ok(normalised) => {
                            img = normalised;
                            orientation_applied = Some(format!(
                                "EXIF orientation {o} ({}) applied",
                                orientation_description(o)
                            ));
                        }
                        Err(e) => warnings.push(format!(
                            "orientation normalisation failed ({e}); keeping stored pixels"
                        )),
                    }
                }
            }
        }
        if options.convert_to_srgb {
            if let Some(icc) = &metadata.raw_icc {
                match convert_to_srgb(&img, icc) {
                    Ok(converted) => {
                        if converted.data != img.data {
                            img = converted;
                            srgb_converted = true;
                        }
                    }
                    Err(e) => warnings.push(format!(
                        "ICC to sRGB conversion failed ({e}); keeping original colours"
                    )),
                }
            } else {
                warnings.push(
                    "convert to sRGB requested but the source has no embedded ICC profile; keeping original colours".to_string(),
                );
            }
        }
        if !frame_selected && options.selected_frame.is_none() {
            // An animated / multi-page source flattened to one static
            // image must warn — never silently drop frames. The
            // count comes from the real frame scan, not the codec's
            // first-frame flags.
            if animation.is_animated && animation.frame_count > 1 {
                if source_format == ImageFormat::Tiff {
                    warnings.push(format!(
                        "source is a multi-page TIFF ({} pages); converting to a static image keeps the first page only — use `openpixel extract-frame` to pick a page",
                        animation.frame_count
                    ));
                } else {
                    warnings.push(format!(
                        "source is animated ({} frames); converting to a static image keeps the first frame only — use `openpixel extract-frame` to pick a frame",
                        animation.frame_count
                    ));
                }
            }
        }
        Ok((img, orientation_applied, warnings, srgb_converted))
    }

    /// Shared tail of `convert` / `process` / `extract_frame_to_path`:
    /// target capability check -> output path validation -> encode
    /// via the target codec -> metadata splicing per the policy
    /// (JPEG/PNG only; anything dropped is warned about) -> output
    /// validation (re-detect what was written) -> write the file.
    /// The encoding itself lives in [`Engine::encode_to_bytes`];
    /// this wrapper only adds the filesystem steps.
    fn encode_and_write(&self, req: EncodeRequest<'_>, output: &Path) -> Result<ConvertResult> {
        let (mut result, out) = self.encode_to_bytes(req)?;
        write_output_file(output, &out)?;
        result.output_path = output.to_string_lossy().to_string();
        Ok(result)
    }

    /// The filesystem-free half of [`Engine::encode_and_write`]:
    /// target capability check -> encode via the target codec ->
    /// metadata splicing per the policy -> output validation
    /// (re-detect what was written). Returns the report plus the
    /// encoded bytes. This is what the WASM bindings call through
    /// [`Engine::convert_bytes`] — a browser has no filesystem for
    /// the engine to write to, so the bytes come back to the caller.
    /// `ConvertResult::output_path` is empty here: there is no file.
    fn encode_to_bytes(&self, req: EncodeRequest<'_>) -> Result<(ConvertResult, Vec<u8>)> {
        let EncodeRequest {
            image: img,
            source_format,
            input_bytes,
            target,
            options,
            metadata: source_metadata,
            mut warnings,
            orientation_applied,
            converted_to_srgb,
        } = req;
        let target_cap = self.registry.capability(target).ok_or_else(|| {
            OpenPixelError::InvalidArgument(format!("unknown target format {target}"))
        })?;
        if !target_cap.can_encode {
            return Err(OpenPixelError::NotImplemented(format!(
                "{} cannot be encoded in this build ({})",
                target.id(),
                target_cap.status
            )));
        }
        let target_codec = self.registry.get(target).ok_or_else(|| {
            OpenPixelError::NotImplemented(format!("no encoder registered for {}", target.id()))
        })?;
        // ICO cap (verified 16 Nov 2026): the format stores width and
        // height in one byte each (0 = 256), so the encoder rejects
        // anything over 256x256 ("image width must be 1..=256"). Resize
        // to fit instead of failing — aspect preserved (Lanczos3) — and
        // say so in the warnings, never silently. This is the one place
        // every entry point funnels through (convert / convert_bytes /
        // process), so CLI, WASM and desktop all get the same behaviour.
        // `ConvertResult` below reports `img`'s dimensions, so the
        // resized size is what callers see.
        let owned_image;
        let img = if target == ImageFormat::Ico && (img.width > 256 || img.height > 256) {
            let (src_w, src_h) = (img.width, img.height);
            let resized = Pipeline::from_operations(vec![Operation::ResizeFit {
                width: 256,
                height: 256,
            }])
            .apply(img)?;
            warnings.push(format!(
                "resized {src_w}x{src_h} to {}x{} for ICO — ICO supports max 256x256",
                resized.width, resized.height
            ));
            owned_image = resized;
            &owned_image
        } else {
            img
        };
        let mut params = options.to_encode_params();
        if params.quality.is_none() {
            params.quality = Some(self.config.default_jpeg_quality);
        }
        let out = target_codec.encode(img, &params)?;
        // Metadata splicing (Phase 5): only JPEG/PNG carry it, and
        // only when the policy asks. Dropped categories are warned.
        // When the pixels were converted to sRGB, the source ICC
        // profile no longer describes them, so it is dropped even
        // under Preserve — preserving it would mislabel the output.
        let policy = options.effective_policy();
        let owned_metadata;
        let source_metadata = if converted_to_srgb && source_metadata.has_icc() {
            warnings.push(
                "embedded ICC profile removed: pixels were converted to sRGB, so the source profile no longer describes them".to_string(),
            );
            owned_metadata = Metadata {
                raw_icc: None,
                icc: None,
                ..source_metadata.clone()
            };
            &owned_metadata
        } else {
            source_metadata
        };
        let (out, report) = apply_policy(target, out, source_metadata, &policy);
        let metadata_preserved: Vec<String> =
            report.preserved.iter().map(|s| s.to_string()).collect();
        let metadata_dropped: Vec<String> = report
            .dropped
            .iter()
            .map(|(item, reason)| format!("{item}: {reason}"))
            .collect();
        for dropped in &metadata_dropped {
            warnings.push(format!("metadata dropped — {dropped}"));
        }
        // Output validation: re-detect what we just wrote.
        // TGA has no magic bytes, so it cannot be re-detected — for TGA
        // only check that something was written.
        if target == ImageFormat::Tga {
            if out.is_empty() {
                return Err(OpenPixelError::Encode("wrote empty TGA output".to_string()));
            }
        } else {
            let written_format = detect_format(&out);
            if written_format != target {
                return Err(OpenPixelError::Encode(format!(
                    "output validation failed: wrote {written_format}, expected {target}"
                )));
            }
        }
        Ok((
            ConvertResult {
                source_format,
                target_format: target,
                width: img.width,
                height: img.height,
                input_bytes,
                output_bytes: out.len() as u64,
                output_path: String::new(),
                warnings,
                metadata_preserved,
                metadata_dropped,
                orientation_applied,
            },
            out,
        ))
    }
}

/// Everything the shared encode tail needs, in one argument
/// (keeps `encode_and_write` under clippy's argument limit).
struct EncodeRequest<'a> {
    image: &'a DecodedImage,
    source_format: ImageFormat,
    input_bytes: u64,
    target: ImageFormat,
    options: &'a ConvertOptions,
    metadata: &'a Metadata,
    warnings: Vec<String>,
    orientation_applied: Option<String>,
    /// True when the pixels were converted to sRGB: the source ICC
    /// profile must then not be preserved (it no longer describes
    /// the pixels).
    converted_to_srgb: bool,
}

/// Validate an output path, create parent directories, write
/// bytes. Shared by `encode_and_write` and `process_to_size`.
fn write_output_file(output: &Path, bytes: &[u8]) -> Result<()> {
    validate_output_path(output)?;
    if let Some(parent) = output.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| OpenPixelError::Io {
                path: parent.to_path_buf(),
                source: e,
            })?;
        }
    }
    fs::write(output, bytes).map_err(|e| OpenPixelError::Io {
        path: output.to_path_buf(),
        source: e,
    })?;
    Ok(())
}

/// Target format from an output path's extension.
fn target_from_output_path(output: &Path) -> Result<ImageFormat> {
    let ext = output.extension().and_then(|e| e.to_str()).ok_or_else(|| {
        OpenPixelError::InvalidArgument(
            "output path needs an extension, e.g. output.png".to_string(),
        )
    })?;
    ImageFormat::from_name(ext).ok_or_else(|| {
        OpenPixelError::InvalidArgument(format!("unknown output extension '.{ext}'"))
    })
}

/// Helper used by tests / CLI to build an output path next to the input.
pub fn default_output_path(input: &Path, target: ImageFormat) -> PathBuf {
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "output".to_string());
    let parent = input.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    parent.join(format!("{stem}.{}", target.extensions()[0]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgb, RgbImage};

    fn test_image_rgba() -> DynamicImage {
        let mut im = image::RgbaImage::new(8, 6);
        for (x, y, px) in im.enumerate_pixels_mut() {
            *px = image::Rgba([
                x as u8 * 30,
                y as u8 * 40,
                128,
                if x < 4 { 255 } else { 128 },
            ]);
        }
        DynamicImage::ImageRgba8(im)
    }

    fn test_image_rgb() -> DynamicImage {
        let mut im = RgbImage::new(8, 6);
        for (x, y, px) in im.enumerate_pixels_mut() {
            *px = Rgb([x as u8 * 30, y as u8 * 40, 128]);
        }
        DynamicImage::ImageRgb8(im)
    }

    #[test]
    fn png_roundtrip_preserves_dimensions_and_alpha() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.png");
        let dst = dir.path().join("b.png");
        test_image_rgba().save(&src).unwrap();
        let engine = Engine::default();
        let r = engine
            .convert(&src, &dst, ImageFormat::Png, &ConvertOptions::default())
            .unwrap();
        assert_eq!((r.width, r.height), (8, 6));
        assert_eq!(r.source_format, ImageFormat::Png);
        let info = engine.get_image_info(&dst).unwrap();
        assert!(info.has_alpha);
    }

    /// In-memory PNG bytes for the byte-API tests (no files involved).
    fn png_bytes() -> Vec<u8> {
        let mut buf = Vec::new();
        test_image_rgba()
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .unwrap();
        buf
    }

    /// PNG bytes of an arbitrary-size RGB gradient — for tests that
    /// need dimensions the 8x6 fixture cannot provide.
    fn png_bytes_sized(width: u32, height: u32) -> Vec<u8> {
        let mut im = image::RgbImage::new(width, height);
        for (x, y, px) in im.enumerate_pixels_mut() {
            *px = Rgb([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8]);
        }
        let mut buf = Vec::new();
        DynamicImage::ImageRgb8(im)
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .unwrap();
        buf
    }

    #[test]
    fn convert_ico_auto_resizes_large_images() {
        // ICO cap (verified 16 Nov 2026): the format stores width and
        // height in one byte each, so the encoder rejects anything over
        // 256x256. The engine resizes to fit instead of failing — the
        // same path the CLI and the WASM build take.
        let engine = Engine::default();
        let png = png_bytes_sized(800, 600);
        let (r, out) = engine
            .convert_bytes(&png, ImageFormat::Ico, &ConvertOptions::default())
            .unwrap();
        assert_eq!((r.width, r.height), (256, 192));
        assert_eq!(engine.detect_format(&out), ImageFormat::Ico);
        assert_eq!(&out[0..4], &[0x00, 0x00, 0x01, 0x00]);
        // The resized ICO must decode back — an RGB source used to
        // produce an ICO image-rs itself rejected ("The PNG is not in
        // RGBA format!"), see the codec's ICO normalisation.
        let (fmt, img) = engine.decode_bytes(&out, None).unwrap();
        assert_eq!(fmt, ImageFormat::Ico);
        assert_eq!((img.width, img.height), (256, 192));
        assert!(
            r.warnings
                .iter()
                .any(|w| w == "resized 800x600 to 256x192 for ICO — ICO supports max 256x256"),
            "warnings: {:?}",
            r.warnings
        );
    }

    #[test]
    fn convert_ico_small_image_is_unchanged() {
        // At or under the cap nothing is resized and no warning is
        // added — the resize only ever triggers above 256x256.
        let engine = Engine::default();
        let png = png_bytes_sized(64, 64);
        let (r, out) = engine
            .convert_bytes(&png, ImageFormat::Ico, &ConvertOptions::default())
            .unwrap();
        assert_eq!((r.width, r.height), (64, 64));
        assert_eq!(engine.detect_format(&out), ImageFormat::Ico);
        assert_eq!(&out[0..4], &[0x00, 0x00, 0x01, 0x00]);
        // RGB source (the sized helper builds an RGB gradient): the
        // ICO must decode back — without the codec's RGBA
        // normalisation this failed with "The PNG is not in RGBA
        // format!".
        let (fmt, img) = engine.decode_bytes(&out, None).unwrap();
        assert_eq!(fmt, ImageFormat::Ico);
        assert_eq!((img.width, img.height), (64, 64));
        assert!(
            !r.warnings.iter().any(|w| w.contains("resized")),
            "warnings: {:?}",
            r.warnings
        );
    }

    #[test]
    fn convert_bytes_png_to_jpeg_and_webp() {
        // WASM entry point (follow-up item 2): the same pipeline as
        // `convert`, but the bytes come back instead of a file.
        let engine = Engine::default();
        let png = png_bytes();
        for target in [ImageFormat::Jpeg, ImageFormat::Webp, ImageFormat::Png] {
            let (r, out) = engine
                .convert_bytes(&png, target, &ConvertOptions::default())
                .unwrap();
            assert_eq!(r.target_format, target);
            assert_eq!((r.width, r.height), (8, 6));
            assert_eq!(r.input_bytes, png.len() as u64);
            assert_eq!(r.output_bytes, out.len() as u64);
            assert!(r.output_path.is_empty(), "byte output has no file path");
            assert_eq!(engine.detect_format(&out), target);
        }
    }

    #[test]
    fn convert_bytes_and_info_bytes_reject_unknown_format() {
        let engine = Engine::default();
        let bad = b"this is not an image at all";
        assert!(matches!(
            engine.convert_bytes(bad, ImageFormat::Png, &ConvertOptions::default()),
            Err(OpenPixelError::UnknownFormat)
        ));
        assert!(matches!(
            engine.get_image_info_bytes(bad),
            Err(OpenPixelError::UnknownFormat)
        ));
    }

    #[test]
    fn get_image_info_bytes_matches_file_info() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.png");
        test_image_rgba().save(&src).unwrap();
        let bytes = std::fs::read(&src).unwrap();
        let engine = Engine::default();
        let from_file = engine.get_image_info(&src).unwrap();
        let from_bytes = engine.get_image_info_bytes(&bytes).unwrap();
        assert_eq!(from_bytes.format, from_file.format);
        assert_eq!((from_bytes.width, from_bytes.height), (8, 6));
        assert_eq!(from_bytes.has_alpha, from_file.has_alpha);
        assert_eq!(from_bytes.file_size_bytes, bytes.len() as u64);
    }

    #[test]
    #[cfg(feature = "native-avif")]
    fn convert_bytes_avif_roundtrip_with_native_feature() {
        let engine = Engine::default();
        let png = png_bytes();
        let (_, avif) = engine
            .convert_bytes(&png, ImageFormat::Avif, &ConvertOptions::default())
            .unwrap();
        assert_eq!(engine.detect_format(&avif), ImageFormat::Avif);
        let (r, back) = engine
            .convert_bytes(&avif, ImageFormat::Png, &ConvertOptions::default())
            .unwrap();
        assert_eq!(r.source_format, ImageFormat::Avif);
        assert_eq!(engine.detect_format(&back), ImageFormat::Png);
    }

    #[test]
    #[cfg(not(feature = "native-avif"))]
    fn convert_bytes_avif_is_unavailable_without_native_feature() {
        // The dav1d-free (wasm32) registry reports AVIF as
        // unavailable instead of failing inside a codec.
        let engine = Engine::default();
        let png = png_bytes();
        assert!(matches!(
            engine.convert_bytes(&png, ImageFormat::Avif, &ConvertOptions::default()),
            Err(OpenPixelError::NotImplemented(_))
        ));
    }

    #[test]
    fn png_to_jpeg_flattens_alpha_and_detects_by_signature() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.png");
        let dst = dir.path().join("b.jpg");
        test_image_rgba().save(&src).unwrap();
        let engine = Engine::default();
        let r = engine
            .convert(&src, &dst, ImageFormat::Jpeg, &ConvertOptions::default())
            .unwrap();
        assert_eq!(r.target_format, ImageFormat::Jpeg);
        let info = engine.get_image_info(&dst).unwrap();
        assert_eq!(info.format, ImageFormat::Jpeg);
        assert!(!info.has_alpha);
    }

    #[test]
    fn jpeg_to_bmp_and_webp_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.jpg");
        test_image_rgb().save(&src).unwrap();
        let engine = Engine::default();
        for target in [
            ImageFormat::Bmp,
            ImageFormat::Webp,
            ImageFormat::Gif,
            ImageFormat::Tiff,
        ] {
            let dst = dir.path().join(format!("out.{}", target.extensions()[0]));
            let r = engine
                .convert(&src, &dst, target, &ConvertOptions::default())
                .unwrap();
            assert_eq!(r.target_format, target);
            assert_eq!(engine.get_image_info(&dst).unwrap().format, target);
        }
    }

    #[test]
    fn rejects_unknown_format_but_heic_now_converts() {
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join("bad.bin");
        fs::write(&bad, b"this is not an image at all").unwrap();
        let engine = Engine::default();
        assert!(matches!(
            engine.get_image_info(&bad),
            Err(OpenPixelError::UnknownFormat)
        ));
        // HEIC was unimplemented before the 16 Nov 2026 follow-up
        // (pure-Rust heifer); converting PNG -> HEIC now succeeds and
        // the output re-detects as HEIC. Same for HEIF (the adapter
        // rewrites the ftyp major brand to `mif1` on encode).
        let src = dir.path().join("a.png");
        test_image_rgb().save(&src).unwrap();
        let dst = dir.path().join("b.heic");
        let r = engine
            .convert(&src, &dst, ImageFormat::Heic, &ConvertOptions::default())
            .unwrap();
        assert_eq!(r.target_format, ImageFormat::Heic);
        assert_eq!(
            engine.get_image_info(&dst).unwrap().format,
            ImageFormat::Heic
        );
        let dst_heif = dir.path().join("c.heif");
        let r = engine
            .convert(
                &src,
                &dst_heif,
                ImageFormat::Heif,
                &ConvertOptions::default(),
            )
            .unwrap();
        assert_eq!(r.target_format, ImageFormat::Heif);
        assert_eq!(
            engine.get_image_info(&dst_heif).unwrap().format,
            ImageFormat::Heif
        );
    }

    #[test]
    fn rejects_missing_file() {
        let engine = Engine::default();
        assert!(matches!(
            engine.get_image_info(Path::new("/no/such/file.png")),
            Err(OpenPixelError::NotFound(_))
        ));
    }

    #[test]
    fn capabilities_come_from_the_registry() {
        let engine = Engine::default();
        let caps = engine.get_capabilities();
        assert_eq!(caps.len(), 21);
        // 17 encodable formats natively; 16 in a dav1d-free build,
        // where AVIF moves to the planned list (see `native-avif`).
        #[cfg(feature = "native-avif")]
        assert_eq!(caps.iter().filter(|c| c.can_encode).count(), 17);
        #[cfg(not(feature = "native-avif"))]
        assert_eq!(caps.iter().filter(|c| c.can_encode).count(), 16);
        // Removing a codec removes it from the capability list too.
        let mut registry = CodecRegistry::default();
        registry.remove(ImageFormat::Webp);
        let engine = Engine::with_registry(EngineConfig::default(), registry);
        assert_eq!(engine.get_capabilities().len(), 20);
        assert!(engine.get_capability(ImageFormat::Webp).is_none());
        let src_dir = tempfile::tempdir().unwrap();
        let src = src_dir.path().join("a.png");
        test_image_rgb().save(&src).unwrap();
        let dst = src_dir.path().join("b.webp");
        assert!(engine
            .convert(&src, &dst, ImageFormat::Webp, &ConvertOptions::default())
            .is_err());
    }

    #[test]
    fn svg_source_converts_to_png_and_avif_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let svg = dir.path().join("a.svg");
        fs::write(
            &svg,
            b"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"6\"><rect width=\"8\" height=\"6\" fill=\"#ff0000\"/></svg>",
        )
        .unwrap();
        let engine = Engine::default();
        // SVG is detected by the strict start-of-file sniff.
        let info = engine.get_image_info(&svg).unwrap();
        assert_eq!(info.format, ImageFormat::Svg);
        assert_eq!((info.width, info.height), (8, 6));
        let png = dir.path().join("b.png");
        let r = engine
            .convert(&svg, &png, ImageFormat::Png, &ConvertOptions::default())
            .unwrap();
        assert_eq!(r.source_format, ImageFormat::Svg);
        assert_eq!(r.target_format, ImageFormat::Png);
    }

    /// AVIF half of the test above, gated on the `native-avif`
    /// feature: a dav1d-free build has no AVIF codec at all, so this
    /// round-trip is expected to fail there (see
    /// `convert_bytes_avif_is_unavailable_without_native_feature`).
    #[test]
    #[cfg(feature = "native-avif")]
    fn avif_roundtrip_through_engine() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::default();
        // PNG -> AVIF -> PNG through the engine, with output validation.
        let src = dir.path().join("c.png");
        test_image_rgb().save(&src).unwrap();
        let avif = dir.path().join("d.avif");
        engine
            .convert(&src, &avif, ImageFormat::Avif, &ConvertOptions::default())
            .unwrap();
        assert_eq!(
            engine.get_image_info(&avif).unwrap().format,
            ImageFormat::Avif
        );
        let back = dir.path().join("e.png");
        engine
            .convert(&avif, &back, ImageFormat::Png, &ConvertOptions::default())
            .unwrap();
        assert_eq!(
            engine.get_image_info(&back).unwrap().format,
            ImageFormat::Png
        );
    }

    #[test]
    fn process_resize_grayscale_rotate_combined() {
        use crate::{Operation, Pipeline, ProcessOptions};
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.png");
        test_image_rgb().save(&src).unwrap();
        let dst = dir.path().join("b.png");
        let engine = Engine::default();
        // 8x6 -> resize 4x3 -> rotate 90 (3x4) -> grayscale.
        let pipeline = Pipeline::from_operations(vec![
            Operation::Resize {
                width: 4,
                height: 3,
            },
            Operation::Rotate90,
            Operation::Grayscale,
        ]);
        let opts = ProcessOptions::new(ConvertOptions::default(), pipeline);
        let r = engine.process(&src, &dst, ImageFormat::Png, &opts).unwrap();
        assert_eq!((r.width, r.height), (3, 4));
        let info = engine.get_image_info(&dst).unwrap();
        assert_eq!((info.width, info.height), (3, 4));
        assert_eq!(info.color_type, "luma8");
        // Every output pixel must be grey.
        let decoded = engine.decode_file(&dst).unwrap();
        let rgba = decoded.to_rgba8();
        for px in rgba.as_chunks::<4>().0 {
            assert_eq!(px[0], px[1]);
            assert_eq!(px[1], px[2]);
        }
    }

    #[test]
    fn process_empty_pipeline_matches_convert_and_alias_works() {
        use crate::{Operation, Pipeline, ProcessOptions};
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.png");
        test_image_rgb().save(&src).unwrap();
        let engine = Engine::default();
        let empty = ProcessOptions::default();
        assert!(empty.pipeline.is_empty());
        let dst = dir.path().join("b.png");
        let r = engine
            .process(&src, &dst, ImageFormat::Png, &empty)
            .unwrap();
        assert_eq!((r.width, r.height), (8, 6));
        // convert_with_pipeline is the same call under the other name.
        let dst2 = dir.path().join("c.jpg");
        let opts = ProcessOptions::new(
            ConvertOptions::default(),
            Pipeline::from_operations(vec![Operation::FlipHorizontal]),
        );
        let r2 = engine
            .convert_with_pipeline(&src, &dst2, ImageFormat::Jpeg, &opts)
            .unwrap();
        assert_eq!(r2.target_format, ImageFormat::Jpeg);
        // process_to_path infers the target from the extension.
        let dst3 = dir.path().join("d.webp");
        let r3 = engine.process_to_path(&src, &dst3, &opts).unwrap();
        assert_eq!(r3.target_format, ImageFormat::Webp);
    }

    #[test]
    fn process_rejects_bad_pipeline_before_writing() {
        use crate::{Operation, Pipeline, ProcessOptions};
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.png");
        test_image_rgb().save(&src).unwrap();
        let dst = dir.path().join("b.png");
        let engine = Engine::default();
        let opts = ProcessOptions::new(
            ConvertOptions::default(),
            Pipeline::from_operations(vec![Operation::Crop {
                x: 0,
                y: 0,
                width: 99,
                height: 99,
            }]),
        );
        assert!(matches!(
            engine.process(&src, &dst, ImageFormat::Png, &opts),
            Err(OpenPixelError::InvalidArgument(_))
        ));
        assert!(!dst.exists(), "failed process must not write output");
        let opts = ProcessOptions::new(
            ConvertOptions::default(),
            Pipeline::from_operations(vec![Operation::Resize {
                width: 0,
                height: 10,
            }]),
        );
        assert!(engine.process(&src, &dst, ImageFormat::Png, &opts).is_err());
    }

    #[test]
    fn process_bytes_resize_fit_exact_aspect_and_never_upscales() {
        use crate::{Operation, Pipeline, ProcessOptions};
        let engine = Engine::default();
        // Exact fit: 800x600 into a 400x300 box stays 400x300.
        let png = png_bytes_sized(800, 600);
        let opts = ProcessOptions::new(
            ConvertOptions::default(),
            Pipeline::from_operations(vec![Operation::ResizeFit {
                width: 400,
                height: 300,
            }]),
        );
        let (r, out) = engine.process_bytes(&png, ImageFormat::Png, &opts).unwrap();
        assert_eq!((r.width, r.height), (400, 300));
        assert_eq!(engine.detect_format(&out), ImageFormat::Png);
        // Aspect preserved: 800x600 (4:3) into a 300x300 box is
        // 300x225, not a distorted 300x300.
        let opts = ProcessOptions::new(
            ConvertOptions::default(),
            Pipeline::from_operations(vec![Operation::ResizeFit {
                width: 300,
                height: 300,
            }]),
        );
        let (r, _) = engine.process_bytes(&png, ImageFormat::Png, &opts).unwrap();
        assert_eq!((r.width, r.height), (300, 225));
        // Never upscales: a 64x64 image asked to fit 800x600 stays
        // 64x64 — upscaling adds no detail, only blur.
        let small = png_bytes_sized(64, 64);
        let opts = ProcessOptions::new(
            ConvertOptions::default(),
            Pipeline::from_operations(vec![Operation::ResizeFit {
                width: 800,
                height: 600,
            }]),
        );
        let (r, _) = engine
            .process_bytes(&small, ImageFormat::Png, &opts)
            .unwrap();
        assert_eq!((r.width, r.height), (64, 64));
    }

    #[test]
    fn process_to_size_jpeg_fits_target_and_reports_quality() {
        use crate::{Operation, Pipeline, ProcessOptions};
        let engine = Engine::default();
        let png = png_bytes_sized(1024, 768);
        let opts = ProcessOptions::new(
            ConvertOptions::default(),
            Pipeline::from_operations(vec![Operation::ResizeFit {
                width: 800,
                height: 600,
            }]),
        );
        let (outcome, out) = engine
            .process_to_size_bytes(&png, ImageFormat::Jpeg, &opts, 200_000)
            .unwrap();
        assert!(
            outcome.target_met,
            "warnings: {:?}",
            outcome.result.warnings
        );
        assert!(outcome.result.output_bytes <= 200_000);
        assert_eq!(out.len() as u64, outcome.result.output_bytes);
        let quality = outcome
            .quality_used
            .expect("lossy search reports a quality");
        assert!((1..=100).contains(&quality), "quality {quality}");
        assert_eq!(engine.detect_format(&out), ImageFormat::Jpeg);
        assert_eq!((outcome.result.width, outcome.result.height), (800, 600));
        // The search finds the HIGHEST fitting quality, not the
        // first one that fits: a generous target must not settle
        // for a low quality.
        assert!(quality >= 80, "quality {quality} for a 200 KB target");
    }

    #[test]
    fn process_to_size_unreachable_returns_smallest_with_warning() {
        use crate::ProcessOptions;
        let engine = Engine::default();
        let png = png_bytes_sized(1024, 768);
        let opts = ProcessOptions::default();
        let (outcome, out) = engine
            .process_to_size_bytes(&png, ImageFormat::Jpeg, &opts, 100)
            .unwrap();
        assert!(!outcome.target_met);
        // Quality 1–3 all bottom out at the same size for this
        // smooth gradient (the encoder cannot go smaller), so the
        // search keeps the first attempt that hit the minimum —
        // the invariant is the SIZE, not which of 1–3 it was.
        let quality = outcome
            .quality_used
            .expect("lossy search reports a quality");
        assert!((1..=3).contains(&quality), "quality {quality}");
        assert!(
            outcome
                .result
                .warnings
                .iter()
                .any(|w| w.contains("could not be met")),
            "warnings: {:?}",
            outcome.result.warnings
        );
        assert_eq!(engine.detect_format(&out), ImageFormat::Jpeg);
        // The smallest result is the quality-1 encode — nothing
        // smaller exists for this image at any quality.
        let mut opts_q1 = ProcessOptions::default();
        opts_q1.convert.quality = Some(1);
        let (_, q1) = engine
            .process_bytes(&png, ImageFormat::Jpeg, &opts_q1)
            .unwrap();
        assert_eq!(out.len(), q1.len());
    }

    #[test]
    fn process_to_size_png_is_honest_about_lossless() {
        use crate::ProcessOptions;
        let engine = Engine::default();
        let png = png_bytes_sized(256, 192);
        // A generous target: best compression fits, quality is
        // meaningless for PNG so none is reported.
        let (outcome, out) = engine
            .process_to_size_bytes(
                &png,
                ImageFormat::Png,
                &ProcessOptions::default(),
                1_000_000,
            )
            .unwrap();
        assert!(outcome.target_met);
        assert_eq!(outcome.quality_used, None);
        assert_eq!(engine.detect_format(&out), ImageFormat::Png);
        // An impossible target: the best-compression result comes
        // back with a warning, not a pretended fit.
        let (outcome, _) = engine
            .process_to_size_bytes(&png, ImageFormat::Png, &ProcessOptions::default(), 10)
            .unwrap();
        assert!(!outcome.target_met);
        assert_eq!(outcome.quality_used, None);
        assert!(
            outcome
                .result
                .warnings
                .iter()
                .any(|w| w.contains("lossless")),
            "warnings: {:?}",
            outcome.result.warnings
        );
    }

    #[test]
    fn process_to_size_lossless_format_is_an_honest_error() {
        use crate::ProcessOptions;
        let engine = Engine::default();
        let png = png_bytes_sized(256, 192);
        // BMP has no quality setting to search.
        let err = engine
            .process_to_size_bytes(&png, ImageFormat::Bmp, &ProcessOptions::default(), 50_000)
            .unwrap_err();
        assert!(
            err.to_string().contains("no quality setting"),
            "error: {err}"
        );
        // WebP too: image-rs 0.25 encodes WebP losslessly only, so
        // quality does not change its size — a search would be
        // theatre, and the engine says so instead of faking it.
        let err = engine
            .process_to_size_bytes(&png, ImageFormat::Webp, &ProcessOptions::default(), 50_000)
            .unwrap_err();
        assert!(
            err.to_string().contains("no quality setting"),
            "error: {err}"
        );
        // A zero target is a caller error, not a search.
        assert!(matches!(
            engine.process_to_size_bytes(&png, ImageFormat::Jpeg, &ProcessOptions::default(), 0),
            Err(OpenPixelError::InvalidArgument(_))
        ));
    }

    #[test]
    fn decode_file_returns_decoded_image() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.png");
        test_image_rgba().save(&src).unwrap();
        let engine = Engine::default();
        let img = engine.decode_file(&src).unwrap();
        assert_eq!((img.width, img.height), (8, 6));
        assert!(img.has_alpha());
    }

    // ---- Phase 5: metadata, animation, colour -----------------

    /// Minimal little-endian TIFF IFD0 builder for tests: entries
    /// are (tag, type, count, payload); payloads over 4 bytes are
    /// stored after the IFD with an offset.
    fn tiff_ifd0(entries: &[(u16, u16, u32, &[u8])]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"II*\x00");
        out.extend_from_slice(&8u32.to_le_bytes());
        out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        let mut cursor = 8 + 2 + entries.len() * 12 + 4;
        let mut trailing = Vec::new();
        for (tag, ty, count, payload) in entries {
            out.extend_from_slice(&tag.to_le_bytes());
            out.extend_from_slice(&ty.to_le_bytes());
            out.extend_from_slice(&count.to_le_bytes());
            if payload.len() <= 4 {
                let mut inline = [0u8; 4];
                inline[..payload.len()].copy_from_slice(payload);
                out.extend_from_slice(&inline);
            } else {
                out.extend_from_slice(&(cursor as u32).to_le_bytes());
                trailing.extend_from_slice(payload);
                cursor += payload.len();
            }
        }
        out.extend_from_slice(&0u32.to_le_bytes());
        out.extend_from_slice(&trailing);
        out
    }

    fn ascii_bytes(s: &str) -> Vec<u8> {
        let mut v = s.as_bytes().to_vec();
        v.push(0);
        v
    }

    /// EXIF TIFF with orientation 6 + make/model.
    fn exif_tiff() -> Vec<u8> {
        let make = ascii_bytes("Canon");
        let model = ascii_bytes("EOS R50");
        tiff_ifd0(&[
            (0x010F, 2, 6, &make),
            (0x0110, 2, 8, &model),
            (0x0112, 3, 1, &[6, 0]),
        ])
    }

    /// 8x6 RGB JPEG with an EXIF APP1 segment spliced after SOI.
    fn jpeg_with_exif() -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut cursor = std::io::Cursor::new(&mut out);
            test_image_rgb()
                .write_to(&mut cursor, image::ImageFormat::Jpeg)
                .unwrap();
        }
        let mut app1 = b"Exif\x00\x00".to_vec();
        app1.extend_from_slice(&exif_tiff());
        let mut segment = vec![0xFF, 0xE1];
        segment.extend_from_slice(&((app1.len() + 2) as u16).to_be_bytes());
        segment.extend_from_slice(&app1);
        out.splice(2..2, segment);
        out
    }

    /// A real non-sRGB (Adobe RGB 1998) ICC profile, built with tintbox.
    fn adobe_icc() -> Vec<u8> {
        use tintbox::color::{CIExyY, CIExyYTriple};
        let white = CIExyY {
            x: 0.3127,
            y: 0.3290,
            yy: 1.0,
        };
        let primaries = CIExyYTriple {
            red: CIExyY {
                x: 0.64,
                y: 0.33,
                yy: 1.0,
            },
            green: CIExyY {
                x: 0.21,
                y: 0.71,
                yy: 1.0,
            },
            blue: CIExyY {
                x: 0.15,
                y: 0.06,
                yy: 1.0,
            },
        };
        let gamma = tintbox::curve::build_gamma(2.2);
        let writable = tintbox::profile::virtuals::build_rgb_profile(
            white,
            primaries,
            &gamma,
            "Adobe RGB (1998) test profile",
        );
        tintbox::profile::save_to_mem(&writable).expect("Adobe profile serialises")
    }

    /// 8x6 RGB JPEG with an Adobe RGB ICC APP2 segment spliced after SOI.
    fn jpeg_with_adobe_icc() -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut cursor = std::io::Cursor::new(&mut out);
            test_image_rgb()
                .write_to(&mut cursor, image::ImageFormat::Jpeg)
                .unwrap();
        }
        let icc = adobe_icc();
        let mut app2 = b"ICC_PROFILE\x00".to_vec();
        app2.extend_from_slice(&[1, 1]); // chunk 1 of 1
        app2.extend_from_slice(&icc);
        let mut segment = vec![0xFF, 0xE2];
        segment.extend_from_slice(&((app2.len() + 2) as u16).to_be_bytes());
        segment.extend_from_slice(&app2);
        out.splice(2..2, segment);
        out
    }

    /// 4x4 GIF with 3 full frames (red, green, blue), delays 10/20/30 cs.
    fn three_frame_gif_bytes() -> Vec<u8> {
        let mut out = Vec::new();
        let mut encoder = gif::Encoder::new(&mut out, 4, 4, &[]).unwrap();
        encoder.set_repeat(gif::Repeat::Infinite).unwrap();
        for (colour, delay) in [
            ([255, 0, 0, 255], 10u16),
            ([0, 255, 0, 255], 20),
            ([0, 0, 255, 255], 30),
        ] {
            let mut pixels = Vec::new();
            for _ in 0..16 {
                pixels.extend_from_slice(&colour);
            }
            let mut frame = gif::Frame::from_rgba(4, 4, &mut pixels);
            frame.delay = delay;
            encoder.write_frame(&frame).unwrap();
        }
        drop(encoder);
        out
    }

    /// Two-page 4x4 greyscale TIFF: page 0 all 10, page 1 all 200.
    fn two_page_tiff_bytes() -> Vec<u8> {
        fn page(strip_offset: u32, next_ifd: u32) -> Vec<u8> {
            let mut out = Vec::new();
            let entries: [(u16, u16, u32, [u8; 4]); 10] = [
                (256, 4, 1, 4u32.to_le_bytes()),
                (257, 4, 1, 4u32.to_le_bytes()),
                (258, 3, 1, [8, 0, 0, 0]),
                (259, 3, 1, [1, 0, 0, 0]),
                (262, 3, 1, [1, 0, 0, 0]),
                (273, 4, 1, strip_offset.to_le_bytes()),
                (277, 3, 1, [1, 0, 0, 0]),
                (278, 4, 1, 4u32.to_le_bytes()),
                (279, 4, 1, 16u32.to_le_bytes()),
                (284, 3, 1, [1, 0, 0, 0]),
            ];
            out.extend_from_slice(&10u16.to_le_bytes());
            for (tag, ty, count, value) in entries {
                out.extend_from_slice(&tag.to_le_bytes());
                out.extend_from_slice(&ty.to_le_bytes());
                out.extend_from_slice(&count.to_le_bytes());
                out.extend_from_slice(&value);
            }
            out.extend_from_slice(&next_ifd.to_le_bytes());
            out
        }
        let mut out = Vec::new();
        out.extend_from_slice(b"II*\x00");
        out.extend_from_slice(&8u32.to_le_bytes());
        // IFD0 at 8 (126 bytes), strip0 at 134, IFD1 at 150, strip1 at 276.
        out.extend_from_slice(&page(134, 150));
        out.extend_from_slice(&[10u8; 16]);
        out.extend_from_slice(&page(276, 0));
        out.extend_from_slice(&[200u8; 16]);
        out
    }

    fn write_bytes(dir: &std::path::Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn preserve_metadata_jpeg_to_jpeg_keeps_exif() {
        let dir = tempfile::tempdir().unwrap();
        let src = write_bytes(dir.path(), "a.jpg", &jpeg_with_exif());
        let dst = dir.path().join("b.jpg");
        let engine = Engine::default();
        let opts = ConvertOptions {
            metadata_policy: Some(MetadataPolicy::Preserve),
            ..Default::default()
        };
        let r = engine
            .convert(&src, &dst, ImageFormat::Jpeg, &opts)
            .unwrap();
        assert_eq!(r.metadata_preserved, vec!["exif"]);
        assert!(r.metadata_dropped.is_empty());
        assert!(r.warnings.is_empty(), "warnings: {:?}", r.warnings);
        let meta = engine.read_metadata(&dst).unwrap();
        assert!(meta.has_exif);
        assert_eq!(meta.orientation, Some(6));
        assert_eq!(meta.make.as_deref(), Some("Canon"));
        assert_eq!(meta.model.as_deref(), Some("EOS R50"));
    }

    #[test]
    fn to_srgb_with_preserve_drops_the_stale_icc_profile() {
        let dir = tempfile::tempdir().unwrap();
        let src = write_bytes(dir.path(), "a.jpg", &jpeg_with_adobe_icc());
        let dst = dir.path().join("b.jpg");
        let engine = Engine::default();
        // Sanity: the source really carries a non-sRGB profile.
        let src_meta = engine.read_metadata(&src).unwrap();
        assert!(src_meta.has_icc());
        assert_eq!(src_meta.icc.as_ref().map(|p| p.is_srgb), Some(false));
        let opts = ConvertOptions {
            metadata_policy: Some(MetadataPolicy::Preserve),
            convert_to_srgb: true,
            ..Default::default()
        };
        let r = engine
            .convert(&src, &dst, ImageFormat::Jpeg, &opts)
            .unwrap();
        // The pixels were converted, so the Adobe profile no longer
        // describes them: it must be dropped, with a warning, even
        // under Preserve -- never silently kept.
        assert!(!r.metadata_preserved.contains(&"icc".to_string()));
        assert!(
            r.warnings.iter().any(|w| w.contains("converted to sRGB")),
            "warnings: {:?}",
            r.warnings
        );
        let meta = engine.read_metadata(&dst).unwrap();
        assert!(!meta.has_icc());
        // And the pixels really did change (Adobe primaries -> sRGB).
        let before = engine.decode_file(&src).unwrap();
        let after = engine.decode_file(&dst).unwrap();
        assert_ne!(before.data, after.data);
    }

    #[test]
    fn strip_is_default_and_drops_exif() {
        let dir = tempfile::tempdir().unwrap();
        let src = write_bytes(dir.path(), "a.jpg", &jpeg_with_exif());
        let dst = dir.path().join("b.jpg");
        let engine = Engine::default();
        let r = engine
            .convert(&src, &dst, ImageFormat::Jpeg, &ConvertOptions::default())
            .unwrap();
        assert!(r.metadata_preserved.is_empty());
        assert!(r.metadata_dropped.is_empty());
        let meta = engine.read_metadata(&dst).unwrap();
        assert!(!meta.has_exif);
        assert_eq!(meta.orientation, None);
    }

    #[test]
    fn legacy_preserve_metadata_bool_maps_to_preserve() {
        let dir = tempfile::tempdir().unwrap();
        let src = write_bytes(dir.path(), "a.jpg", &jpeg_with_exif());
        let dst = dir.path().join("b.jpg");
        let engine = Engine::default();
        let opts = ConvertOptions {
            preserve_metadata: true,
            ..Default::default()
        };
        let r = engine
            .convert(&src, &dst, ImageFormat::Jpeg, &opts)
            .unwrap();
        assert_eq!(r.metadata_preserved, vec!["exif"]);
    }

    #[test]
    fn preserve_jpeg_to_png_keeps_exif() {
        let dir = tempfile::tempdir().unwrap();
        let src = write_bytes(dir.path(), "a.jpg", &jpeg_with_exif());
        let dst = dir.path().join("b.png");
        let engine = Engine::default();
        let opts = ConvertOptions {
            metadata_policy: Some(MetadataPolicy::Preserve),
            ..Default::default()
        };
        let r = engine.convert(&src, &dst, ImageFormat::Png, &opts).unwrap();
        assert_eq!(r.metadata_preserved, vec!["exif"]);
        let meta = engine.read_metadata(&dst).unwrap();
        assert!(meta.has_exif);
        assert_eq!(meta.orientation, Some(6));
    }

    #[test]
    fn preserve_jpeg_to_tiff_drops_with_warning() {
        let dir = tempfile::tempdir().unwrap();
        let src = write_bytes(dir.path(), "a.jpg", &jpeg_with_exif());
        let dst = dir.path().join("b.tiff");
        let engine = Engine::default();
        let opts = ConvertOptions {
            metadata_policy: Some(MetadataPolicy::Preserve),
            ..Default::default()
        };
        let r = engine
            .convert(&src, &dst, ImageFormat::Tiff, &opts)
            .unwrap();
        assert!(r.metadata_preserved.is_empty());
        assert_eq!(r.metadata_dropped.len(), 1);
        assert!(r.metadata_dropped[0].starts_with("exif:"));
        assert!(
            r.warnings.iter().any(|w| w.contains("metadata dropped")),
            "warnings: {:?}",
            r.warnings
        );
        // The conversion itself still succeeds.
        assert_eq!(
            engine.get_image_info(&dst).unwrap().format,
            ImageFormat::Tiff
        );
    }

    #[test]
    fn normalize_orientation_swaps_dimensions_and_strips_tag() {
        let dir = tempfile::tempdir().unwrap();
        let src = write_bytes(dir.path(), "a.jpg", &jpeg_with_exif());
        let dst = dir.path().join("b.jpg");
        let engine = Engine::default();
        let opts = ConvertOptions {
            metadata_policy: Some(MetadataPolicy::NormalizeOrientation),
            ..Default::default()
        };
        let r = engine
            .convert(&src, &dst, ImageFormat::Jpeg, &opts)
            .unwrap();
        assert_eq!((r.width, r.height), (6, 8));
        assert!(r
            .orientation_applied
            .as_deref()
            .unwrap()
            .contains("orientation 6"));
        let meta = engine.read_metadata(&dst).unwrap();
        assert!(
            !meta.has_exif,
            "normalised output carries no EXIF tag to double-apply"
        );
        let info = engine.get_image_info(&dst).unwrap();
        assert_eq!((info.width, info.height), (6, 8));
    }

    #[test]
    fn animated_gif_info_counts_frames_and_convert_warns() {
        let dir = tempfile::tempdir().unwrap();
        let src = write_bytes(dir.path(), "a.gif", &three_frame_gif_bytes());
        let engine = Engine::default();
        let info = engine.get_image_info(&src).unwrap();
        assert!(info.is_animated);
        assert_eq!(info.frame_count, Some(3));
        let dst = dir.path().join("b.png");
        let r = engine
            .convert(&src, &dst, ImageFormat::Png, &ConvertOptions::default())
            .unwrap();
        assert!(
            r.warnings.iter().any(|w| w.contains("animated (3 frames)")),
            "warnings: {:?}",
            r.warnings
        );
        // First frame (red) is what a plain conversion keeps.
        let decoded = engine.decode_file(&dst).unwrap();
        assert_eq!(&decoded.to_rgba8()[0..3], &[255, 0, 0]);
    }

    #[test]
    fn gif_frame_extraction_returns_the_right_frame() {
        let dir = tempfile::tempdir().unwrap();
        let src = write_bytes(dir.path(), "a.gif", &three_frame_gif_bytes());
        let engine = Engine::default();
        let frame = engine.extract_frame(&src, 1).unwrap();
        assert_eq!((frame.width, frame.height), (4, 4));
        assert_eq!(&frame.to_rgba8()[0..3], &[0, 255, 0]);
        let dst = dir.path().join("b.png");
        let r = engine
            .extract_frame_to_path(&src, 2, &dst, &ConvertOptions::default())
            .unwrap();
        assert!(r.warnings.iter().all(|w| !w.contains("animated")));
        let decoded = engine.decode_file(&dst).unwrap();
        assert_eq!(&decoded.to_rgba8()[0..3], &[0, 0, 255]);
        assert!(matches!(
            engine.extract_frame(&src, 3),
            Err(OpenPixelError::InvalidArgument(_))
        ));
    }

    #[test]
    fn convert_with_selected_frame_picks_that_frame() {
        let dir = tempfile::tempdir().unwrap();
        let src = write_bytes(dir.path(), "a.gif", &three_frame_gif_bytes());
        let dst = dir.path().join("b.png");
        let engine = Engine::default();
        let opts = ConvertOptions {
            selected_frame: Some(1),
            ..Default::default()
        };
        let r = engine.convert(&src, &dst, ImageFormat::Png, &opts).unwrap();
        assert!(r.warnings.iter().all(|w| !w.contains("animated")));
        let decoded = engine.decode_file(&dst).unwrap();
        assert_eq!(&decoded.to_rgba8()[0..3], &[0, 255, 0]);
    }

    #[test]
    fn tiff_page_count_and_extraction_through_engine() {
        let dir = tempfile::tempdir().unwrap();
        let src = write_bytes(dir.path(), "a.tiff", &two_page_tiff_bytes());
        let engine = Engine::default();
        let info = engine.get_image_info(&src).unwrap();
        assert!(info.is_animated);
        assert_eq!(info.frame_count, Some(2));
        let page1 = engine.extract_frame(&src, 1).unwrap();
        assert!(page1.data.iter().all(|&v| v == 200));
        let dst = dir.path().join("b.png");
        let r = engine
            .extract_frame_to_path(&src, 1, &dst, &ConvertOptions::default())
            .unwrap();
        assert_eq!((r.width, r.height), (4, 4));
        // Plain conversion warns about the dropped second page.
        let dst2 = dir.path().join("c.png");
        let r = engine
            .convert(&src, &dst2, ImageFormat::Png, &ConvertOptions::default())
            .unwrap();
        assert!(
            r.warnings
                .iter()
                .any(|w| w.contains("multi-page TIFF (2 pages)")),
            "warnings: {:?}",
            r.warnings
        );
    }

    #[test]
    fn corrupt_exif_does_not_break_conversion() {
        let dir = tempfile::tempdir().unwrap();
        let mut bytes = Vec::new();
        {
            let mut cursor = std::io::Cursor::new(&mut bytes);
            test_image_rgb()
                .write_to(&mut cursor, image::ImageFormat::Jpeg)
                .unwrap();
        }
        let mut app1 = b"Exif\x00\x00".to_vec();
        app1.extend_from_slice(b"NOT-A-TIFF-HEADER-AT-ALL");
        let mut segment = vec![0xFF, 0xE1];
        segment.extend_from_slice(&((app1.len() + 2) as u16).to_be_bytes());
        segment.extend_from_slice(&app1);
        bytes.splice(2..2, segment);
        let src = write_bytes(dir.path(), "a.jpg", &bytes);
        let dst = dir.path().join("b.png");
        let engine = Engine::default();
        let r = engine
            .convert(&src, &dst, ImageFormat::Png, &ConvertOptions::default())
            .unwrap();
        assert_eq!((r.width, r.height), (8, 6));
        assert!(dst.exists());
    }

    #[test]
    fn apng_reports_frames_but_later_frames_are_not_extractable() {
        use openpixel_metadata::png_crc32;
        fn chunk(ty: &[u8; 4], data: &[u8]) -> Vec<u8> {
            let mut out = Vec::new();
            out.extend_from_slice(&(data.len() as u32).to_be_bytes());
            out.extend_from_slice(ty);
            out.extend_from_slice(data);
            let mut crc_input = ty.to_vec();
            crc_input.extend_from_slice(data);
            out.extend_from_slice(&png_crc32(&crc_input).to_be_bytes());
            out
        }
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&chunk(b"IHDR", &[0, 0, 0, 4, 0, 0, 0, 4, 8, 2, 0, 0, 0]));
        let mut actl = Vec::new();
        actl.extend_from_slice(&2u32.to_be_bytes());
        actl.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&chunk(b"acTL", &actl));
        let mut fctl = Vec::new();
        fctl.extend_from_slice(&0u32.to_be_bytes());
        fctl.extend_from_slice(&4u32.to_be_bytes());
        fctl.extend_from_slice(&4u32.to_be_bytes());
        fctl.extend_from_slice(&0u32.to_be_bytes());
        fctl.extend_from_slice(&0u32.to_be_bytes());
        fctl.extend_from_slice(&10u16.to_be_bytes());
        fctl.extend_from_slice(&100u16.to_be_bytes());
        fctl.extend_from_slice(&[0, 0]);
        bytes.extend_from_slice(&chunk(b"fcTL", &fctl));
        bytes.extend_from_slice(&chunk(b"IDAT", &[0; 8]));
        bytes.extend_from_slice(&chunk(b"IEND", &[]));
        let dir = tempfile::tempdir().unwrap();
        let src = write_bytes(dir.path(), "a.png", &bytes);
        let engine = Engine::default();
        let info = engine.animation_info(&src).unwrap();
        assert!(info.is_animated);
        assert_eq!(info.frame_count, 2);
        assert_eq!(info.frames[0].delay_ms, Some(100));
        assert!(matches!(
            engine.extract_frame(&src, 1),
            Err(OpenPixelError::NotImplemented(_))
        ));
    }

    #[test]
    fn to_srgb_without_icc_warns_but_converts() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.png");
        test_image_rgb().save(&src).unwrap();
        let dst = dir.path().join("b.png");
        let engine = Engine::default();
        let opts = ConvertOptions {
            convert_to_srgb: true,
            ..Default::default()
        };
        let r = engine.convert(&src, &dst, ImageFormat::Png, &opts).unwrap();
        assert!(
            r.warnings
                .iter()
                .any(|w| w.contains("no embedded ICC profile")),
            "warnings: {:?}",
            r.warnings
        );
        assert_eq!((r.width, r.height), (8, 6));
    }

    #[test]
    fn metadata_policy_parses_from_names() {
        assert_eq!(
            MetadataPolicy::from_name("selected:exif,icc"),
            Some(MetadataPolicy::PreserveSelected {
                fields: vec![
                    openpixel_metadata::MetadataField::Exif,
                    openpixel_metadata::MetadataField::Icc
                ]
            })
        );
    }

    #[test]
    fn discovery_reports_a_lying_extension() {
        let engine = Engine::default();
        let png = b"\x89PNG\r\n\x1A\nxxxx";
        let r = engine.discover_format(png, Some("jpg"), None);
        assert_eq!(r.format, ImageFormat::Png);
        assert!(r.has_mismatch());
    }
}
