use serde::{Deserialize, Serialize};

/// GPS position decoded from EXIF GPS tags, in decimal degrees.
/// North / East are positive; South / West are negative.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GpsCoordinates {
    pub latitude: f64,
    pub longitude: f64,
    pub altitude_m: Option<f64>,
}

/// What is known about an embedded ICC profile. The raw profile
/// bytes live on [`Metadata::raw_icc`] (serde-skipped); this struct
/// is the reportable summary. No colour conversion is claimed here —
/// conversion is [`crate::convert_to_srgb`], which either runs a real
/// tintbox transform or reports that it cannot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IccProfile {
    /// Size of the embedded profile in bytes.
    pub size_bytes: usize,
    /// ICC colour space signature, e.g. "RGB", "GRAY", "CMYK".
    pub color_space: String,
    /// ICC device class, e.g. "Display", "Input", "Output".
    pub profile_class: String,
    /// `desc` tag text, when the profile carries one.
    pub description: Option<String>,
    /// True when the profile describes sRGB (by its `desc` text).
    /// A profile with no description is never assumed to be sRGB.
    pub is_srgb: bool,
}

/// Everything the engine knows about one file's metadata, read from
/// the file's own bytes. Absent fields are `None` — metadata is
/// never invented. `warnings` records anything odd found while
/// parsing (truncated EXIF, an ICC chunk that never arrived, an
/// out-of-range tag value); a file with warnings still converts.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Metadata {
    /// EXIF orientation tag (1..=8), when present.
    pub orientation: Option<u8>,
    pub make: Option<String>,
    pub model: Option<String>,
    /// EXIF DateTime, raw "YYYY:MM:DD HH:MM:SS" string when present.
    pub date_time: Option<String>,
    /// EXIF DateTimeOriginal (SubIFD), when present.
    pub date_time_original: Option<String>,
    pub software: Option<String>,
    pub artist: Option<String>,
    pub description: Option<String>,
    pub gps: Option<GpsCoordinates>,
    /// Horizontal / vertical resolution and the EXIF resolution unit
    /// (1 = none, 2 = inch, 3 = cm). PNG `pHYs` is reported here too
    /// (unit inch, converted from pixels-per-metre).
    pub x_resolution: Option<f64>,
    pub y_resolution: Option<f64>,
    pub resolution_unit: Option<u8>,
    /// True when an EXIF block was found at all (even if no tag
    /// inside it could be read).
    pub has_exif: bool,
    pub icc: Option<IccProfile>,
    pub has_xmp: bool,
    /// Raw XMP packet text, when present and valid UTF-8.
    pub xmp: Option<String>,
    /// Non-fatal problems found while parsing (see the struct docs).
    pub warnings: Vec<String>,

    /// Raw EXIF segment payload for JPEG preservation: the full APP1
    /// content including the `Exif\0\0` header.
    #[serde(skip)]
    pub raw_exif_app1: Option<Vec<u8>>,
    /// Raw TIFF header + IFDs (the EXIF block itself, without any
    /// container header) — used for the PNG `eXIf` chunk.
    #[serde(skip)]
    pub raw_exif_tiff: Option<Vec<u8>>,
    /// Raw ICC profile bytes, when an ICC profile was found.
    #[serde(skip)]
    pub raw_icc: Option<Vec<u8>>,
    /// Raw XMP packet bytes, when found.
    #[serde(skip)]
    pub raw_xmp: Option<Vec<u8>>,
}

impl Metadata {
    pub fn has_icc(&self) -> bool {
        self.icc.is_some()
    }

    /// Short human-readable summary, e.g. for `openpixel info`.
    pub fn summary(&self) -> String {
        let mut parts: Vec<String> = Vec::new();
        if let Some(o) = self.orientation {
            parts.push(format!("orientation {o}"));
        }
        if let (Some(make), Some(model)) = (&self.make, &self.model) {
            parts.push(format!("{make} {model}"));
        } else if let Some(make) = &self.make {
            parts.push(make.clone());
        }
        if let Some(dt) = self.date_time_original.as_ref().or(self.date_time.as_ref()) {
            parts.push(dt.clone());
        }
        if let Some(gps) = self.gps {
            parts.push(format!("gps {:.5},{:.5}", gps.latitude, gps.longitude));
        }
        if let Some(icc) = &self.icc {
            parts.push(format!(
                "icc {} ({} bytes{})",
                icc.description.as_deref().unwrap_or(&icc.color_space),
                icc.size_bytes,
                if icc.is_srgb { ", sRGB" } else { "" }
            ));
        }
        if self.has_xmp {
            parts.push("xmp".to_string());
        }
        if parts.is_empty() {
            "no metadata".to_string()
        } else {
            parts.join(", ")
        }
    }
}

/// One metadata category that [`MetadataPolicy::PreserveSelected`]
/// may keep. GPS lives inside the EXIF block, so selecting `Gps`
/// preserves the whole EXIF segment (documented in `policy.rs`) —
/// GPS cannot be separated from EXIF at the byte level in Phase 5.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MetadataField {
    Exif,
    Icc,
    Xmp,
    Gps,
}

impl MetadataField {
    pub fn from_name(name: &str) -> Option<Self> {
        match name.trim().to_ascii_lowercase().as_str() {
            "exif" => Some(Self::Exif),
            "icc" => Some(Self::Icc),
            "xmp" => Some(Self::Xmp),
            "gps" => Some(Self::Gps),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Exif => "exif",
            Self::Icc => "icc",
            Self::Xmp => "xmp",
            Self::Gps => "gps",
        }
    }
}

/// What to do with a source file's metadata on conversion.
///
/// * `Strip` — drop everything (the default; also what Phase 1–4 did).
/// * `Preserve` — copy EXIF / ICC / XMP where the target encoder
///   actually supports it; anything the target cannot carry is
///   reported as dropped, never silently claimed.
/// * `PreserveSelected` — copy only the listed categories.
/// * `PreserveColorProfiles` — copy only the ICC profile.
/// * `NormalizeOrientation` — rotate/flip the pixels per the EXIF
///   orientation tag (1–8) and strip the metadata, so the output is
///   upright with no orientation tag left to double-apply. Files
///   with no orientation tag are unchanged.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetadataPolicy {
    #[default]
    Strip,
    Preserve,
    PreserveSelected {
        fields: Vec<MetadataField>,
    },
    PreserveColorProfiles,
    NormalizeOrientation,
}

impl MetadataPolicy {
    pub fn from_name(name: &str) -> Option<Self> {
        let lower = name.trim().to_ascii_lowercase();
        match lower.as_str() {
            "strip" => Some(Self::Strip),
            "preserve" => Some(Self::Preserve),
            "color-profiles"
            | "color_profiles"
            | "preserve-color-profiles"
            | "preserve_color_profiles" => Some(Self::PreserveColorProfiles),
            "normalize-orientation" | "normalize_orientation" => Some(Self::NormalizeOrientation),
            _ => {
                if let Some(rest) = lower.strip_prefix("selected:") {
                    let mut fields = Vec::new();
                    for part in rest.split(',') {
                        fields.push(MetadataField::from_name(part)?);
                    }
                    if fields.is_empty() {
                        return None;
                    }
                    Some(Self::PreserveSelected { fields })
                } else {
                    None
                }
            }
        }
    }

    pub fn name(&self) -> String {
        match self {
            Self::Strip => "strip".to_string(),
            Self::Preserve => "preserve".to_string(),
            Self::PreserveSelected { fields } => format!(
                "selected:{}",
                fields
                    .iter()
                    .map(|f| f.name())
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            Self::PreserveColorProfiles => "color-profiles".to_string(),
            Self::NormalizeOrientation => "normalize-orientation".to_string(),
        }
    }

    /// Whether this policy wants the EXIF block (GPS included).
    pub fn wants_exif(&self) -> bool {
        match self {
            Self::Preserve => true,
            Self::PreserveSelected { fields } => {
                fields.contains(&MetadataField::Exif) || fields.contains(&MetadataField::Gps)
            }
            _ => false,
        }
    }

    pub fn wants_icc(&self) -> bool {
        match self {
            Self::Preserve | Self::PreserveColorProfiles => true,
            Self::PreserveSelected { fields } => fields.contains(&MetadataField::Icc),
            _ => false,
        }
    }

    pub fn wants_xmp(&self) -> bool {
        match self {
            Self::Preserve => true,
            Self::PreserveSelected { fields } => fields.contains(&MetadataField::Xmp),
            _ => false,
        }
    }
}

/// One frame of an animated image (GIF / APNG / animated WebP) or
/// one page of a multi-page TIFF.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FrameInfo {
    pub index: u32,
    pub width: u32,
    pub height: u32,
    /// Top-left offset of this frame inside the canvas (GIF/APNG).
    pub offset_x: u32,
    pub offset_y: u32,
    /// Display duration in milliseconds, when the format carries one.
    pub delay_ms: Option<u32>,
    /// GIF/APNG disposal operation (0 unspecified, 1 keep,
    /// 2 background, 3 previous), when the format carries one.
    pub disposal: Option<u8>,
}

/// Frame enumeration for one file. For GIF the frames are fully
/// decodable (see `extract_gif_frame`); for APNG and animated WebP
/// this is header information only — only the first frame is
/// decodable in Phase 5, and `extractable_frames` says so. TIFF
/// pages are all extractable via `extract_tiff_page`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnimationInfo {
    pub format: String,
    pub is_animated: bool,
    pub frame_count: u32,
    /// GIF loop count: `None` = plays once (or no loop extension),
    /// `Some(0)` = loops forever, `Some(n)` = repeats n times.
    /// APNG `num_plays` follows the same convention.
    pub loop_count: Option<u32>,
    pub frames: Vec<FrameInfo>,
    /// Human-readable note about what Phase 5 can and cannot do
    /// with this animation (extraction limits, first-frame-only).
    pub note: Option<String>,
}

impl AnimationInfo {
    pub fn single(format: &str, width: u32, height: u32) -> Self {
        Self {
            format: format.to_string(),
            is_animated: false,
            frame_count: 1,
            loop_count: None,
            frames: vec![FrameInfo {
                index: 0,
                width,
                height,
                offset_x: 0,
                offset_y: 0,
                delay_ms: None,
                disposal: None,
            }],
            note: None,
        }
    }
}
