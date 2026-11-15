use serde::{Deserialize, Serialize};
use std::fmt;

/// Every format the registry knows about. `Unknown` is never advertised
/// as supported — it is what detection returns when no signature matches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    Jpeg,
    Png,
    Bmp,
    Gif,
    Tiff,
    Webp,
    Tga,
    Ico,
    Pnm,
    Qoi,
    /// Known, but NOT implemented in Phase 1. Listed honestly in the
    /// registry with can_decode = false / can_encode = false.
    Avif,
    Heic,
    Heif,
    Jxl,
    Jpeg2000,
    Svg,
    Exr,
    Hdr,
    Apng,
    Raw,
    Psd,
    Unknown,
}

impl ImageFormat {
    pub fn id(&self) -> &'static str {
        match self {
            Self::Jpeg => "jpeg",
            Self::Png => "png",
            Self::Bmp => "bmp",
            Self::Gif => "gif",
            Self::Tiff => "tiff",
            Self::Webp => "webp",
            Self::Tga => "tga",
            Self::Ico => "ico",
            Self::Pnm => "pnm",
            Self::Qoi => "qoi",
            Self::Avif => "avif",
            Self::Heic => "heic",
            Self::Heif => "heif",
            Self::Jxl => "jxl",
            Self::Jpeg2000 => "jpeg2000",
            Self::Svg => "svg",
            Self::Exr => "exr",
            Self::Hdr => "hdr",
            Self::Apng => "apng",
            Self::Raw => "raw",
            Self::Psd => "psd",
            Self::Unknown => "unknown",
        }
    }

    pub fn extensions(&self) -> &'static [&'static str] {
        match self {
            Self::Jpeg => &["jpg", "jpeg"],
            Self::Png => &["png"],
            Self::Bmp => &["bmp"],
            Self::Gif => &["gif"],
            Self::Tiff => &["tif", "tiff"],
            Self::Webp => &["webp"],
            Self::Tga => &["tga"],
            Self::Ico => &["ico"],
            Self::Pnm => &["pnm", "pbm", "pgm", "ppm"],
            Self::Qoi => &["qoi"],
            Self::Avif => &["avif"],
            Self::Heic => &["heic"],
            Self::Heif => &["heif"],
            Self::Jxl => &["jxl"],
            Self::Jpeg2000 => &["jp2", "j2k"],
            Self::Svg => &["svg"],
            Self::Exr => &["exr"],
            Self::Hdr => &["hdr"],
            Self::Apng => &["apng"],
            Self::Raw => &["cr2", "cr3", "nef", "arw", "dng"],
            Self::Psd => &["psd", "psb"],
            Self::Unknown => &[],
        }
    }

    pub fn mime_types(&self) -> &'static [&'static str] {
        match self {
            Self::Jpeg => &["image/jpeg"],
            Self::Png => &["image/png"],
            Self::Bmp => &["image/bmp"],
            Self::Gif => &["image/gif"],
            Self::Tiff => &["image/tiff"],
            Self::Webp => &["image/webp"],
            Self::Tga => &["image/x-tga"],
            Self::Ico => &["image/vnd.microsoft.icon", "image/x-icon"],
            Self::Pnm => &["image/x-portable-anymap"],
            Self::Qoi => &["image/qoi"],
            Self::Avif => &["image/avif"],
            Self::Heic => &["image/heic"],
            Self::Heif => &["image/heif"],
            Self::Jxl => &["image/jxl"],
            Self::Jpeg2000 => &["image/jp2"],
            Self::Svg => &["image/svg+xml"],
            Self::Exr => &["image/x-exr"],
            Self::Hdr => &["image/vnd.radiance"],
            Self::Apng => &["image/apng"],
            Self::Raw => &["image/x-raw"],
            Self::Psd => &["image/vnd.adobe.photoshop"],
            Self::Unknown => &[],
        }
    }

    /// Parse a user-supplied name / extension, e.g. "jpg", "JPEG", ".png".
    ///
    /// NOTE (Phase 2): the mapping from `ImageFormat` to the `image` crate
    /// lives in `openpixel-codecs` (`image_rs::to_image_format`), not here.
    /// This crate stays pure — no codec dependency — so format identity
    /// and detection can be used by every other crate without pulling
    /// in a decoder.
    pub fn from_name(name: &str) -> Option<Self> {
        let n = name.trim().trim_start_matches('.').to_ascii_lowercase();
        match n.as_str() {
            "jpg" | "jpeg" => Some(Self::Jpeg),
            "png" => Some(Self::Png),
            "bmp" => Some(Self::Bmp),
            "gif" => Some(Self::Gif),
            "tif" | "tiff" => Some(Self::Tiff),
            "webp" => Some(Self::Webp),
            "tga" => Some(Self::Tga),
            "ico" => Some(Self::Ico),
            "pnm" | "pbm" | "pgm" | "ppm" => Some(Self::Pnm),
            "qoi" => Some(Self::Qoi),
            "avif" => Some(Self::Avif),
            "heic" => Some(Self::Heic),
            "heif" => Some(Self::Heif),
            "jxl" => Some(Self::Jxl),
            "jp2" | "j2k" | "jpeg2000" => Some(Self::Jpeg2000),
            "svg" => Some(Self::Svg),
            "exr" => Some(Self::Exr),
            "hdr" => Some(Self::Hdr),
            "apng" => Some(Self::Apng),
            "cr2" | "cr3" | "nef" | "arw" | "dng" | "raw" => Some(Self::Raw),
            "psd" | "psb" => Some(Self::Psd),
            _ => None,
        }
    }
}

impl ImageFormat {
    /// Parse a MIME type, e.g. "image/jpeg". Used only as a
    /// low-confidence discovery fallback — never as proof of format.
    pub fn from_mime(mime: &str) -> Option<Self> {
        let m = mime.trim().to_ascii_lowercase();
        match m.as_str() {
            "image/jpeg" => Some(Self::Jpeg),
            "image/png" => Some(Self::Png),
            "image/bmp" => Some(Self::Bmp),
            "image/gif" => Some(Self::Gif),
            "image/tiff" => Some(Self::Tiff),
            "image/webp" => Some(Self::Webp),
            "image/x-tga" => Some(Self::Tga),
            "image/vnd.microsoft.icon" | "image/x-icon" => Some(Self::Ico),
            "image/x-portable-anymap" => Some(Self::Pnm),
            "image/qoi" => Some(Self::Qoi),
            "image/avif" => Some(Self::Avif),
            "image/heic" => Some(Self::Heic),
            "image/heif" => Some(Self::Heif),
            "image/jxl" => Some(Self::Jxl),
            "image/jp2" => Some(Self::Jpeg2000),
            "image/svg+xml" => Some(Self::Svg),
            "image/x-exr" => Some(Self::Exr),
            "image/vnd.radiance" => Some(Self::Hdr),
            "image/apng" => Some(Self::Apng),
            "image/x-raw" => Some(Self::Raw),
            "image/vnd.adobe.photoshop" => Some(Self::Psd),
            _ => None,
        }
    }
}

impl fmt::Display for ImageFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.id())
    }
}

/// Detect the actual format from file signature (magic bytes).
/// The extension is NEVER trusted on its own — this is the first
/// pipeline stage and the security boundary for untrusted input.
pub fn detect_format(bytes: &[u8]) -> ImageFormat {
    if bytes.len() >= 3 && &bytes[0..3] == b"\xFF\xD8\xFF" {
        return ImageFormat::Jpeg;
    }
    if bytes.len() >= 8 && &bytes[0..8] == b"\x89PNG\r\n\x1A\n" {
        return ImageFormat::Png;
    }
    if bytes.len() >= 2 && &bytes[0..2] == b"BM" {
        return ImageFormat::Bmp;
    }
    if bytes.len() >= 6 && (&bytes[0..6] == b"GIF87a" || &bytes[0..6] == b"GIF89a") {
        return ImageFormat::Gif;
    }
    if bytes.len() >= 4 && ((&bytes[0..4] == b"II*\0") || (&bytes[0..4] == b"MM\0*")) {
        return ImageFormat::Tiff;
    }
    // RIFF....WEBP
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return ImageFormat::Webp;
    }
    // AVIF / HEIC / HEIF: ftyp box — brand at offset 8
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        let brand = &bytes[8..12];
        if brand == b"avif" || brand == b"avis" {
            return ImageFormat::Avif;
        }
        if brand == b"heic" || brand == b"heix" || brand == b"hevc" || brand == b"hevx" {
            return ImageFormat::Heic;
        }
        if brand == b"mif1" || brand == b"msf1" || brand == b"heif" {
            return ImageFormat::Heif;
        }
    }
    // JPEG XL: 0xFF 0A or "JXL " box
    if bytes.len() >= 2 && &bytes[0..2] == b"\xFF\x0A" {
        return ImageFormat::Jxl;
    }
    if bytes.len() >= 12 && &bytes[0..12] == b"\0\0\0\x0CJXL \r\n\x87\n" {
        return ImageFormat::Jxl;
    }
    // JPEG 2000: 00 00 00 0C 6A 50 20 20
    if bytes.len() >= 8 && &bytes[0..8] == b"\0\0\0\x0CjP  " {
        return ImageFormat::Jpeg2000;
    }
    // QOI: "qoif"
    if bytes.len() >= 4 && &bytes[0..4] == b"qoif" {
        return ImageFormat::Qoi;
    }
    // ICO: 00 00 01 00
    if bytes.len() >= 4 && &bytes[0..4] == b"\0\0\x01\0" {
        return ImageFormat::Ico;
    }
    // PNM: P1..P6 + whitespace, plus P7 (PAM, which image-rs writes
    // for RGBA images). P7 is the PAM magic, treated as PNM here.
    if bytes.len() >= 2 && bytes[0] == b'P' && (b'1'..=b'7').contains(&bytes[1]) {
        return ImageFormat::Pnm;
    }
    // EXR: 76 2F 31 01
    if bytes.len() >= 4 && &bytes[0..4] == b"v/1\x01" {
        return ImageFormat::Exr;
    }
    // Radiance HDR: "#?RADIANCE" / "#?RGBE"
    if bytes.starts_with(b"#?RADIANCE") || bytes.starts_with(b"#?RGBE") {
        return ImageFormat::Hdr;
    }
    // TGA has no magic bytes. Sniff its 18-byte header strictly:
    // [0]=id length (any), [1]=colour-map type 0/1, [2]=image type
    // 1,2,3,9,10,11, width/height at 12..16 non-zero, depth 8/16/24/32.
    // This is a header validation, not extension trust — a random file
    // is very unlikely to satisfy all of these at once.
    if bytes.len() >= 18
        && bytes[1] <= 1
        && [1u8, 2, 3, 9, 10, 11].contains(&bytes[2])
        && [8u8, 16, 24, 32].contains(&bytes[16])
    {
        let w = u16::from_le_bytes([bytes[12], bytes[13]]);
        let h = u16::from_le_bytes([bytes[14], bytes[15]]);
        if w > 0 && h > 0 {
            return ImageFormat::Tga;
        }
    }
    // SVG is XML text — only a weak sniff; real SVG validation is Phase 3 (resvg).
    // We deliberately do NOT claim SVG here from a bare "<svg" without more
    // context, because HTML/XML can mimic it. SVG detection stays extension-
    // assisted in Phase 1 and is reported as planned, not implemented.
    ImageFormat::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_jpeg_png_bmp_gif_tiff_webp() {
        assert_eq!(detect_format(b"\xFF\xD8\xFF\xE0xxxx"), ImageFormat::Jpeg);
        assert_eq!(detect_format(b"\x89PNG\r\n\x1A\nxxxx"), ImageFormat::Png);
        assert_eq!(detect_format(b"BMxxxx"), ImageFormat::Bmp);
        assert_eq!(detect_format(b"GIF89axxxx"), ImageFormat::Gif);
        assert_eq!(detect_format(b"II*\0xxxx"), ImageFormat::Tiff);
        assert_eq!(detect_format(b"MM\0*xxxx"), ImageFormat::Tiff);
        assert_eq!(
            detect_format(b"RIFF\x00\x00\x00\x00WEBPxxxx"),
            ImageFormat::Webp
        );
    }

    #[test]
    fn detects_avif_heic_qoi_ico_jxl() {
        assert_eq!(detect_format(b"\0\0\0\x18ftypavifxxxx"), ImageFormat::Avif);
        assert_eq!(detect_format(b"\0\0\0\x18ftypheicxxxx"), ImageFormat::Heic);
        assert_eq!(detect_format(b"qoifxxxx"), ImageFormat::Qoi);
        assert_eq!(detect_format(b"\0\0\x01\0xxxx"), ImageFormat::Ico);
        assert_eq!(detect_format(b"\xFF\x0Axxxx"), ImageFormat::Jxl);
    }

    #[test]
    fn detects_tga_by_header() {
        // 18-byte TGA header: type 2 (true-colour), 8x6, 24-bit.
        let hdr: [u8; 18] = [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 0, 6, 0, 24, 0];
        assert_eq!(detect_format(&hdr), ImageFormat::Tga);
    }

    #[test]
    fn unknown_for_random_bytes_and_empty() {
        assert_eq!(detect_format(b"hello world"), ImageFormat::Unknown);
        assert_eq!(detect_format(b""), ImageFormat::Unknown);
    }

    #[test]
    fn from_name_is_case_and_dot_insensitive() {
        assert_eq!(ImageFormat::from_name("JPG"), Some(ImageFormat::Jpeg));
        assert_eq!(ImageFormat::from_name(".png"), Some(ImageFormat::Png));
        assert_eq!(ImageFormat::from_name("webp"), Some(ImageFormat::Webp));
        assert_eq!(ImageFormat::from_name("xyz"), None);
    }
}
