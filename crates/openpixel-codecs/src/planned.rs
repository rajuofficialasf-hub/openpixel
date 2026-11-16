use openpixel_formats::{FormatCapability, ImageFormat, MAX_DIMENSION};

/// Formats the registry *knows* but no codec implements yet.
/// These entries are how the UI honestly says "detected only" instead
/// of pretending the format does not exist — or, worse, that it works.
/// Each entry names the native dependency and the phase that will wire it.
///
/// Phase 3 moved AVIF, SVG, JXL, HDR, EXR and JPEG 2000 from this
/// list into registered codecs (see `docs/CODECS.md`). The HEIC/HEIF
/// follow-up (16 Nov 2026) moved HEIC and HEIF too (pure-Rust heifer).
/// What remains is blocked, not forgotten — the reason is in each
/// entry and in `docs/CODECS.md`.
pub fn planned_capabilities() -> Vec<FormatCapability> {
    use ImageFormat as F;
    let mut v: Vec<FormatCapability> = Vec::new();
    let mut add = |f: ImageFormat,
                   alpha: bool,
                   anim: bool,
                   meta: bool,
                   icc: bool,
                   multi: bool,
                   dep: &'static str,
                   lic: &'static str,
                   status: &'static str| {
        v.push(FormatCapability::new(
            f.id(),
            f.extensions().to_vec(),
            f.mime_types().to_vec(),
            false,
            false,
            alpha,
            anim,
            meta,
            icc,
            multi,
            dep,
            lic,
            status,
            MAX_DIMENSION,
        ));
    };
    add(
        F::Apng,
        true,
        true,
        false,
        false,
        true,
        "image-rs apng (planned, Phase 5)",
        "MIT OR Apache-2.0",
        "planned — not implemented",
    );
    add(
        F::Raw,
        false,
        false,
        true,
        false,
        false,
        "LibRaw (planned, Phase D) — preview/flattened only, TBD",
        "LGPL-2.1 / CDDL (LibRaw)",
        "planned — not implemented",
    );
    add(
        F::Psd,
        true,
        false,
        false,
        false,
        true,
        "planned, Phase D — flattened preview only, TBD",
        "TBD",
        "planned — not implemented",
    );
    v
}
