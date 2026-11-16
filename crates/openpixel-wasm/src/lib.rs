//! openpixel-wasm — the OpenPixel engine compiled to WebAssembly.
//!
//! Follow-up item 2 (16 Nov 2026): the full engine builds for
//! `wasm32-unknown-unknown` only as a **dav1d-free** build. The AVIF
//! codec needs the native libdav1d C library, which has no wasm32
//! build, so this crate depends on `openpixel-core` with
//! `default-features = false` (feature `native-avif` off). The wasm
//! registry therefore reports AVIF as unavailable — the bindings
//! surface that honestly instead of claiming AVIF works. Every other
//! engine format converts in WASM: JPEG, PNG, BMP, GIF, TIFF, WebP,
//! TGA, ICO, PNM, QOI, SVG (decode-only), JXL, HDR, EXR, JPEG 2000,
//! HEIC/HEIF (pure-Rust heifer).
//!
//! The API is byte-in / byte-out: the browser hands the WASM module
//! the file bytes it already read with the File API, and gets bytes
//! back. No filesystem, no network, no upload — the engine never
//! leaves the device. Each call builds a fresh [`Engine`]; the
//! registry is small and the call is stateless, so there is no
//! shared mutable state to keep across the JS boundary.
//!
//! Errors are plain strings on the JS side (`Err(JsValue)` carrying
//! the engine error's message) — the caller shows the message and
//! falls back to the canvas path, it never has to parse Rust types.

use openpixel_core::{
    ConvertOptions, ConvertResult, Engine, ImageInfo, Operation, Pipeline, ProcessOptions,
    TargetSizeOutcome,
};
#[cfg(test)]
use openpixel_formats::FormatCapability;
use openpixel_formats::ImageFormat as Fmt;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Build the engine for one call. Stateless by design: no globals,
/// no cached state across the JS boundary.
fn engine() -> Engine {
    Engine::default()
}

fn js_err(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}

/// Detect the format of `bytes` from magic bytes only (never the
/// extension). Returns the format id (`"png"`, `"jpeg"`, …) or
/// `"unknown"`.
#[wasm_bindgen]
pub fn detect(bytes: &[u8]) -> String {
    engine().detect_format(bytes).id().to_string()
}

/// Full discovery: signature first, extension/MIME only as a
/// low-confidence fallback, with mismatch reporting. Returns the
/// `DiscoveryResult` as a JS object.
#[wasm_bindgen]
pub fn discover(bytes: &[u8], extension: Option<String>, mime: Option<String>) -> JsValue {
    let result = engine().discover_format(bytes, extension.as_deref(), mime.as_deref());
    serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
}

/// Information about an image (format, dimensions, colour type,
/// animation, metadata presence) without converting it. Errors on
/// unknown formats and on formats this build cannot decode.
#[wasm_bindgen]
pub fn info(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let info = info_inner(bytes).map_err(js_err)?;
    serde_wasm_bindgen::to_value(&info).map_err(js_err)
}

/// Capabilities of the registry *in this build* — the same list the
/// native CLI reports, except AVIF is listed as unavailable (its
/// decoder needs native libdav1d). The web UI reads this instead of
/// hard-coding a format list.
#[wasm_bindgen]
pub fn capabilities() -> JsValue {
    let caps = engine().get_capabilities();
    serde_wasm_bindgen::to_value(&caps).unwrap_or(JsValue::NULL)
}

/// Formats this build can decode / encode, as format ids. The web UI
/// uses this to offer only targets the WASM engine can actually
/// produce, and to fall back to the canvas path for the rest.
#[wasm_bindgen]
pub fn supported_formats() -> JsValue {
    let caps = engine().get_capabilities();
    #[derive(Serialize)]
    struct Supported {
        decode: Vec<&'static str>,
        encode: Vec<&'static str>,
    }
    let supported = Supported {
        decode: caps
            .iter()
            .filter(|c| c.can_decode)
            .map(|c| c.format_id)
            .collect(),
        encode: caps
            .iter()
            .filter(|c| c.can_encode)
            .map(|c| c.format_id)
            .collect(),
    };
    serde_wasm_bindgen::to_value(&supported).unwrap_or(JsValue::NULL)
}

/// Convert `bytes` to `target` (a format id or extension, e.g.
/// `"jpeg"`, `"jpg"`, `"png"`, `"webp"`, `"tiff"`, `"qoi"`,
/// `"heic"`). `quality` is 1–100 and applies to JPEG/WebP targets
/// only; pass `undefined` for the engine default (80). `background`
/// is the `#RRGGBB` colour alpha is flattened to for targets
/// without alpha (pass `undefined` for white, the engine default).
/// Returns the converted bytes; the caller re-checks them with
/// [`detect`] / [`info`]. Metadata is always stripped by this
/// binding — the browser path has no metadata preservation story
/// yet; the CLI does.
///
/// Errors when the source is unknown, undecodable in this build
/// (e.g. AVIF), or the target is not encodable in this build (e.g.
/// SVG is decode-only).
#[wasm_bindgen]
pub fn convert(
    bytes: &[u8],
    target: &str,
    quality: Option<u8>,
    background: Option<String>,
) -> Result<Vec<u8>, JsValue> {
    let (_, out) = convert_inner(bytes, target, quality, background.as_deref()).map_err(js_err)?;
    Ok(out)
}

/// Process `bytes` with a resize pipeline, then encode to `target`
/// — the Resize tab's entry point. `ops_json` is a JSON array of
/// resize operations, e.g. `[{"kind":"resize_fit","width":800,"height":600}]`
/// (kinds: `resize_fit`, `resize_fill`, `pad`, `resize`; `pad` takes
/// an optional `color` as `#RRGGBB`). Ops arrive as a JSON string —
/// not a `JsValue` — so the parsing is plain Rust and unit-testable
/// without a JS runtime. `quality` is 1–100 (JPEG,
/// HEIC, HEIF; pass `undefined` for the engine default 80);
/// `background` is the `#RRGGBB` colour alpha is flattened to for
/// targets without alpha (white when omitted); `png_compression`
/// is 0 = fast, 1 = default, 2 = best for PNG targets (ignored
/// for other formats; `undefined` is the engine default 1).
///
/// Returns a JS object `{ bytes, width, height, warnings }` — the
/// resized bytes plus the result dimensions and any engine warnings
/// (e.g. the ICO auto-resize note). Errors when the ops are invalid,
/// the source is undecodable in this build, or the target is not
/// encodable here.
#[wasm_bindgen]
pub fn process(
    bytes: &[u8],
    ops_json: &str,
    target: &str,
    quality: Option<u8>,
    background: Option<String>,
    png_compression: Option<u8>,
) -> Result<JsValue, JsValue> {
    let (result, out) = process_inner(
        bytes,
        ops_json,
        target,
        quality,
        background.as_deref(),
        png_compression,
    )
    .map_err(js_err)?;
    result_object(out, result.width, result.height, &result.warnings).map(JsValue::from)
}

/// Like [`process`], but the encode quality is searched so the
/// output fits inside `target_bytes` — "compress to X KB". Returns
/// `{ bytes, width, height, quality, target_met, warnings }`:
/// `quality` is the quality the search settled on (`null` for PNG,
/// where compression level is the knob), and `target_met` says
/// whether the target was actually reached. When it was not, the
/// bytes are still the smallest result found and the warnings say
/// the target was missed — never a silent overshoot.
///
/// Only JPEG, HEIC and HEIF can be searched in this build (AVIF is
/// unavailable in WASM — its decoder needs native libdav1d — and
/// WebP is encoded losslessly only by image-rs, so quality does not
/// change its size). PNG tries best compression. Any other target
/// is an honest error.
#[wasm_bindgen]
pub fn process_to_size(
    bytes: &[u8],
    ops_json: &str,
    target: &str,
    target_bytes: u64,
    background: Option<String>,
) -> Result<JsValue, JsValue> {
    let (outcome, out) =
        process_to_size_inner(bytes, ops_json, target, target_bytes, background.as_deref())
            .map_err(js_err)?;
    let obj = result_object(
        out,
        outcome.result.width,
        outcome.result.height,
        &outcome.result.warnings,
    )?;
    set_field(
        &obj,
        "quality",
        outcome.quality_used.map_or(JsValue::NULL, JsValue::from),
    )?;
    set_field(&obj, "target_met", JsValue::from(outcome.target_met))?;
    Ok(obj.into())
}

/// The engine version this module was built from.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// The byte-level conversion, shared by the `#[wasm_bindgen]`
/// wrapper above and the native unit tests below.
fn convert_inner(
    bytes: &[u8],
    target: &str,
    quality: Option<u8>,
    background: Option<&str>,
) -> Result<(ConvertResult, Vec<u8>), openpixel_core::OpenPixelError> {
    let format = Fmt::from_name(target).ok_or_else(|| {
        openpixel_core::OpenPixelError::InvalidArgument(format!("unknown target format '{target}'"))
    })?;
    let options = ConvertOptions {
        quality,
        background: parse_background_hex(background)?,
        ..ConvertOptions::default()
    };
    engine().convert_bytes(bytes, format, &options)
}

/// One resize step from the JS side. Only the resize operations
/// are exposed to the browser — the pipeline's other operations
/// (crop, rotate, watermark, …) stay CLI/desktop-only in v1, so
/// the web UI cannot ask for something the WASM binding does not
/// understand. `color` is only read for `pad`.
#[derive(Deserialize)]
struct ResizeOpJson {
    kind: String,
    width: u32,
    height: u32,
    #[serde(default)]
    color: Option<String>,
}

/// Parse the JS ops JSON string into engine operations. Unknown
/// kinds and malformed JSON are caller errors, never silent no-ops.
fn parse_resize_ops(json: &str) -> Result<Vec<Operation>, openpixel_core::OpenPixelError> {
    let ops: Vec<ResizeOpJson> = serde_json::from_str(json).map_err(|e| {
        openpixel_core::OpenPixelError::InvalidArgument(format!("invalid resize ops: {e}"))
    })?;
    let mut out = Vec::with_capacity(ops.len());
    for op in ops {
        let operation = match op.kind.as_str() {
            "resize_fit" => Operation::ResizeFit {
                width: op.width,
                height: op.height,
            },
            "resize_fill" => Operation::ResizeFill {
                width: op.width,
                height: op.height,
            },
            "pad" => Operation::Pad {
                width: op.width,
                height: op.height,
                color: parse_background_hex(op.color.as_deref())?,
            },
            "resize" => Operation::Resize {
                width: op.width,
                height: op.height,
            },
            other => {
                return Err(openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "unknown resize op '{other}' — use resize_fit, resize_fill, pad or resize"
                )))
            }
        };
        out.push(operation);
    }
    Ok(out)
}

/// The byte-level resize, shared by the `#[wasm_bindgen]` wrapper
/// above and the native unit tests below.
fn process_inner(
    bytes: &[u8],
    ops_json: &str,
    target: &str,
    quality: Option<u8>,
    background: Option<&str>,
    png_compression: Option<u8>,
) -> Result<(ConvertResult, Vec<u8>), openpixel_core::OpenPixelError> {
    let format = Fmt::from_name(target).ok_or_else(|| {
        openpixel_core::OpenPixelError::InvalidArgument(format!("unknown target format '{target}'"))
    })?;
    let operations = parse_resize_ops(ops_json)?;
    let options = ProcessOptions::new(
        ConvertOptions {
            quality,
            png_compression,
            background: parse_background_hex(background)?,
            ..ConvertOptions::default()
        },
        Pipeline::from_operations(operations),
    );
    engine().process_bytes(bytes, format, &options)
}

/// The byte-level target-size search, shared by the
/// `#[wasm_bindgen]` wrapper above and the native unit tests below.
fn process_to_size_inner(
    bytes: &[u8],
    ops_json: &str,
    target: &str,
    target_bytes: u64,
    background: Option<&str>,
) -> Result<(TargetSizeOutcome, Vec<u8>), openpixel_core::OpenPixelError> {
    let format = Fmt::from_name(target).ok_or_else(|| {
        openpixel_core::OpenPixelError::InvalidArgument(format!("unknown target format '{target}'"))
    })?;
    let operations = parse_resize_ops(ops_json)?;
    let options = ProcessOptions::new(
        ConvertOptions {
            background: parse_background_hex(background)?,
            ..ConvertOptions::default()
        },
        Pipeline::from_operations(operations),
    );
    engine().process_to_size_bytes(bytes, format, &options, target_bytes)
}

/// Build the `{ bytes, width, height, warnings }` object the
/// `process` exports return. Bytes go out as a real `Uint8Array`
/// (not a JSON number array) via js-sys.
fn result_object(
    bytes: Vec<u8>,
    width: u32,
    height: u32,
    warnings: &[String],
) -> Result<js_sys::Object, JsValue> {
    let obj = js_sys::Object::new();
    let uint = js_sys::Uint8Array::new_with_length(bytes.len() as u32);
    uint.copy_from(bytes.as_slice());
    set_field(&obj, "bytes", uint.into())?;
    set_field(&obj, "width", JsValue::from(width))?;
    set_field(&obj, "height", JsValue::from(height))?;
    set_field(
        &obj,
        "warnings",
        serde_wasm_bindgen::to_value(warnings).map_err(js_err)?,
    )?;
    Ok(obj)
}

fn set_field(obj: &js_sys::Object, key: &str, value: JsValue) -> Result<(), JsValue> {
    js_sys::Reflect::set(obj, &JsValue::from_str(key), &value)
        .map(|_| ())
        .map_err(|_| JsValue::from_str("failed to build result object"))
}

/// Parse a `#RRGGBB` background colour (the web UI's flatten
/// colour). `None` is the engine default (white). Anything else is
/// a caller error, never a silent fallback to white.
fn parse_background_hex(
    background: Option<&str>,
) -> Result<[u8; 3], openpixel_core::OpenPixelError> {
    let Some(hex) = background else {
        return Ok([255, 255, 255]);
    };
    let hex = hex.strip_prefix('#').unwrap_or(hex);
    if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(openpixel_core::OpenPixelError::InvalidArgument(format!(
            "invalid background '{background:?}' — use #RRGGBB"
        )));
    }
    let channel = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(255);
    Ok([channel(0), channel(2), channel(4)])
}

fn info_inner(bytes: &[u8]) -> Result<ImageInfo, openpixel_core::OpenPixelError> {
    engine().get_image_info_bytes(bytes)
}

#[cfg(test)]
fn capabilities_inner() -> Vec<FormatCapability> {
    engine().get_capabilities()
}

#[cfg(test)]
mod tests {
    use super::*;
    use openpixel_core::ImageFormat;

    /// Real 64x64 RGB PNG from the codecs crate's fixtures — the same
    /// bytes the native engine tests use as reference output.
    const FIXTURE_PNG: &[u8] =
        include_bytes!("../../openpixel-codecs/tests/fixtures/checker-64.ref.png");

    #[test]
    fn detect_identifies_the_fixture() {
        assert_eq!(detect(FIXTURE_PNG), "png");
        assert_eq!(detect(b"this is not an image"), "unknown");
    }

    #[test]
    fn info_reports_fixture_dimensions() {
        let info = info_inner(FIXTURE_PNG).unwrap();
        assert_eq!(info.format, ImageFormat::Png);
        assert_eq!((info.width, info.height), (64, 64));
        assert!(!info.has_alpha);
    }

    #[test]
    fn convert_png_to_jpeg_webp_and_png() {
        for target in ["jpeg", "jpg", "webp", "png", "bmp", "tiff", "qoi", "gif"] {
            let (result, out) = convert_inner(FIXTURE_PNG, target, None, None).unwrap();
            assert_eq!(
                result.target_format,
                ImageFormat::from_name(target).unwrap()
            );
            assert_eq!((result.width, result.height), (64, 64));
            assert_eq!(result.output_bytes, out.len() as u64);
            // Output validation: the bytes re-detect as the target.
            assert_eq!(detect(&out), ImageFormat::from_name(target).unwrap().id());
        }
    }

    #[test]
    fn convert_png_to_jxl_heic_and_jpeg2000() {
        // The wasm-safe native codecs (pure Rust) all convert here.
        for target in ["jxl", "heic", "heif", "jp2"] {
            let (_, out) = convert_inner(FIXTURE_PNG, target, None, None).unwrap();
            assert_eq!(detect(&out), ImageFormat::from_name(target).unwrap().id());
        }
    }

    #[test]
    fn convert_rejects_unknown_source_and_target() {
        assert!(convert_inner(b"not an image", "png", None, None).is_err());
        assert!(convert_inner(FIXTURE_PNG, "not-a-format", None, None).is_err());
        // SVG is decode-only in every build: it cannot be a target.
        assert!(convert_inner(FIXTURE_PNG, "svg", None, None).is_err());
    }

    #[test]
    fn capabilities_list_is_complete_and_honest_about_avif() {
        let caps = capabilities_inner();
        assert_eq!(caps.len(), 21);
        let avif = caps.iter().find(|c| c.format_id == "avif").unwrap();
        // Branch on the capability the registry actually reports, not
        // on a cargo feature: under `cargo test --workspace` feature
        // unification switches AVIF on, so AVIF genuinely converts
        // there; in the dav1d-free build (what wasm-pack builds) it
        // is listed but unavailable, with the reason in `status`.
        if avif.can_decode && avif.can_encode {
            let (_, out) = convert_inner(FIXTURE_PNG, "avif", None, None).unwrap();
            assert_eq!(detect(&out), "avif");
        } else {
            assert!(!avif.can_decode && !avif.can_encode);
            assert!(avif.status.contains("libdav1d"));
            assert!(convert_inner(FIXTURE_PNG, "avif", None, None).is_err());
        }
    }

    #[test]
    fn background_hex_parses_and_rejects_garbage() {
        assert_eq!(parse_background_hex(None).unwrap(), [255, 255, 255]);
        assert_eq!(parse_background_hex(Some("#000000")).unwrap(), [0, 0, 0]);
        assert_eq!(parse_background_hex(Some("ff0000")).unwrap(), [255, 0, 0]);
        assert!(parse_background_hex(Some("red")).is_err());
        assert!(parse_background_hex(Some("#12345")).is_err());
        assert!(parse_background_hex(Some("#zzzzzz")).is_err());
        // A background colour converts fine end to end.
        let (_, out) = convert_inner(FIXTURE_PNG, "jpeg", Some(80), Some("#000000")).unwrap();
        assert_eq!(detect(&out), "jpeg");
    }

    #[test]
    fn process_resize_fit_fill_and_never_upscales() {
        // The binding passes the ops JSON through to the engine:
        // 64x64 -> fit 32x32 is exact, fill 32x16 is exact, and
        // fit 128x128 never upscales (ResizeFit semantics).
        let ops = |kind: &str, w: u32, h: u32| {
            serde_json::json!([{ "kind": kind, "width": w, "height": h }]).to_string()
        };
        let (r, out) = process_inner(
            FIXTURE_PNG,
            &ops("resize_fit", 32, 32),
            "png",
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!((r.width, r.height), (32, 32));
        assert_eq!(detect(&out), "png");
        let (r, out) = process_inner(
            FIXTURE_PNG,
            &ops("resize_fill", 32, 16),
            "png",
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!((r.width, r.height), (32, 16));
        assert_eq!(detect(&out), "png");
        let (r, _) = process_inner(
            FIXTURE_PNG,
            &ops("resize_fit", 128, 128),
            "png",
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!((r.width, r.height), (64, 64));
    }

    #[test]
    fn process_to_size_jpeg_fits_and_reports_quality() {
        let ops =
            serde_json::json!([{ "kind": "resize_fit", "width": 32, "height": 32 }]).to_string();
        let (outcome, out) =
            process_to_size_inner(FIXTURE_PNG, &ops, "jpeg", 20_000, None).unwrap();
        assert!(
            outcome.target_met,
            "warnings: {:?}",
            outcome.result.warnings
        );
        assert!(outcome.result.output_bytes <= 20_000);
        let quality = outcome
            .quality_used
            .expect("lossy search reports a quality");
        assert!((1..=100).contains(&quality));
        assert_eq!(detect(&out), "jpeg");
        assert_eq!((outcome.result.width, outcome.result.height), (32, 32));
    }

    #[test]
    fn process_to_size_unreachable_and_webp_are_honest() {
        let ops = serde_json::json!([]).to_string();
        // 10 bytes is unreachable for any JPEG of this image.
        let (outcome, out) = process_to_size_inner(FIXTURE_PNG, &ops, "jpeg", 10, None).unwrap();
        assert!(!outcome.target_met);
        assert!(outcome.quality_used.is_some());
        assert!(
            outcome
                .result
                .warnings
                .iter()
                .any(|w| w.contains("could not be met")),
            "warnings: {:?}",
            outcome.result.warnings
        );
        assert_eq!(detect(&out), "jpeg");
        // WebP has no quality knob in this engine (lossless-only
        // encode), so a target-size search is an error, not a
        // pretended fit.
        let ops = serde_json::json!([]).to_string();
        assert!(process_to_size_inner(FIXTURE_PNG, &ops, "webp", 5_000, None).is_err());
        // Unknown op kinds and targets are caller errors.
        let bad_ops =
            serde_json::json!([{ "kind": "rotate", "width": 32, "height": 32 }]).to_string();
        assert!(process_inner(FIXTURE_PNG, &bad_ops, "png", None, None, None).is_err());
        let ops = serde_json::json!([]).to_string();
        assert!(process_inner(FIXTURE_PNG, &ops, "not-a-format", None, None, None).is_err());
    }

    #[test]
    fn discover_reports_mismatch() {
        let result = engine().discover_format(FIXTURE_PNG, Some("jpg"), None);
        // PNG bytes with a .jpg extension: signature wins, and the
        // mismatch is reported rather than silently trusted.
        assert_eq!(result.format, ImageFormat::Png);
        assert!(result.has_mismatch());
    }
}

/// Tests that run **inside the real WASM runtime** under
/// `wasm-pack test --node`. They exercise the exported
/// `#[wasm_bindgen]` functions (not just the inner helpers) with the
/// same fixture, so a passing run proves bytes go in and converted
/// bytes come out of the compiled `.wasm` module.
#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    const FIXTURE_PNG: &[u8] =
        include_bytes!("../../openpixel-codecs/tests/fixtures/checker-64.ref.png");

    #[wasm_bindgen_test]
    fn wasm_detect_info_convert_roundtrip() {
        assert_eq!(detect(FIXTURE_PNG), "png");
        let info_value = info(FIXTURE_PNG).unwrap();
        let info_json = serde_json::to_string(
            &serde_wasm_bindgen::from_value::<serde_json::Value>(info_value).unwrap(),
        )
        .unwrap();
        assert!(info_json.contains("\"png\""), "info JSON: {info_json}");
        assert!(info_json.contains("\"width\":64"), "info JSON: {info_json}");

        // PNG -> JPEG in WASM, then re-detect the output as JPEG.
        let jpeg = convert(FIXTURE_PNG, "jpeg", Some(80), Some("#000000".to_string())).unwrap();
        assert!(!jpeg.is_empty());
        assert_eq!(detect(&jpeg), "jpeg");
        // JPEG magic bytes, checked directly on the returned bytes.
        assert_eq!(&jpeg[0..3], &[0xFF, 0xD8, 0xFF]);

        // PNG -> WebP in WASM, re-detected as WebP.
        let webp = convert(FIXTURE_PNG, "webp", None, None).unwrap();
        assert_eq!(detect(&webp), "webp");

        // AVIF is honestly unavailable in the wasm build.
        assert!(convert(FIXTURE_PNG, "avif", None, None).is_err());
    }

    #[wasm_bindgen_test]
    fn wasm_capabilities_list_avif_unavailable() {
        let caps_value = capabilities();
        let caps = serde_wasm_bindgen::from_value::<Vec<serde_json::Value>>(caps_value).unwrap();
        assert_eq!(caps.len(), 21);
        let avif = caps
            .iter()
            .find(|c| c["format_id"] == "avif")
            .expect("AVIF must still be listed");
        assert_eq!(avif["can_decode"], false);
        assert_eq!(avif["can_encode"], false);
    }

    #[wasm_bindgen_test]
    fn wasm_process_and_process_to_size_roundtrip() {
        // Resize through the real exported functions, not the inner
        // helpers: 64x64 -> fit 32x32 PNG, then JPEG at <= 5 KB.
        let ops =
            serde_json::json!([{ "kind": "resize_fit", "width": 32, "height": 32 }]).to_string();
        let result = process(FIXTURE_PNG, &ops, "png", None, None, None).unwrap();
        let bytes: js_sys::Uint8Array = js_sys::Reflect::get(&result, &JsValue::from_str("bytes"))
            .unwrap()
            .into();
        assert_eq!(detect(&bytes.to_vec()), "png");
        let width: u32 = js_sys::Reflect::get(&result, &JsValue::from_str("width"))
            .unwrap()
            .as_f64()
            .unwrap() as u32;
        assert_eq!(width, 32);

        let ops =
            serde_json::json!([{ "kind": "resize_fit", "width": 32, "height": 32 }]).to_string();
        let result = process_to_size(FIXTURE_PNG, &ops, "jpeg", 5_000, None).unwrap();
        let bytes: js_sys::Uint8Array = js_sys::Reflect::get(&result, &JsValue::from_str("bytes"))
            .unwrap()
            .into();
        let out = bytes.to_vec();
        assert!(out.len() <= 5_000, "output is {} bytes", out.len());
        assert_eq!(detect(&out), "jpeg");
        let target_met: bool = js_sys::Reflect::get(&result, &JsValue::from_str("target_met"))
            .unwrap()
            .as_bool()
            .unwrap();
        assert!(target_met);
        // WebP target size is an honest error in the real module too.
        let ops = serde_json::json!([]).to_string();
        assert!(process_to_size(FIXTURE_PNG, &ops, "webp", 5_000, None).is_err());
    }
}
