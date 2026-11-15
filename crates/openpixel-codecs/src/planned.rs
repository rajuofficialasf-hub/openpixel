use openpixel_formats::{FormatCapability, ImageFormat, MAX_DIMENSION};

/// Formats the registry *knows* but no codec implements yet.
/// These entries are how the UI honestly says "detected only" instead
/// of pretending the format does not exist — or, worse, that it works.
/// Each entry names the native dependency and the phase that will wire it.
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
        F::Avif,
        true,
        true,
        true,
        true,
        false,
        "libavif / ravif (planned, Phase 3)",
        "BSD-2-Clause (libavif)",
        "planned — detection only",
    );
    add(
        F::Heic,
        true,
        false,
        true,
        true,
        false,
        "libheif (planned, Phase 3)",
        "LGPL-3.0 (libheif)",
        "planned — detection only",
    );
    add(
        F::Heif,
        true,
        false,
        true,
        true,
        false,
        "libheif (planned, Phase 3)",
        "LGPL-3.0 (libheif)",
        "planned — detection only",
    );
    add(
        F::Jxl,
        true,
        true,
        true,
        true,
        false,
        "libjxl (planned, Phase 3)",
        "BSD-3-Clause (libjxl)",
        "planned — detection only",
    );
    add(
        F::Jpeg2000,
        true,
        false,
        true,
        true,
        false,
        "OpenJPEG (planned, Phase 3)",
        "BSD-2-Clause (OpenJPEG)",
        "planned — detection only",
    );
    add(
        F::Svg,
        true,
        false,
        false,
        false,
        false,
        "resvg (planned, Phase 3) — rasterisation only, never raster-to-vector",
        "MPL-2.0 (resvg)",
        "planned — not implemented",
    );
    add(
        F::Exr,
        true,
        false,
        false,
        false,
        false,
        "OpenEXR (planned, Phase 3)",
        "BSD-3-Clause (OpenEXR)",
        "planned — not implemented",
    );
    add(
        F::Hdr,
        false,
        false,
        false,
        false,
        false,
        "image-rs hdr (planned, Phase 3)",
        "MIT OR Apache-2.0",
        "planned — detection only",
    );
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
