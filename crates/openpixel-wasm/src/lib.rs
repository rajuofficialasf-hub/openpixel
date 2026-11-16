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

use openpixel_core::{ConvertOptions, ConvertResult, Engine, ImageInfo};
#[cfg(test)]
use openpixel_formats::FormatCapability;
use openpixel_formats::ImageFormat as Fmt;
use serde::Serialize;
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
}
