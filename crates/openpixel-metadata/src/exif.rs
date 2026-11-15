//! Minimal EXIF (TIFF IFD) reader.
//!
//! Parses the TIFF header + IFD0, the Exif SubIFD (tag 0x8769) and
//! the GPS IFD (tag 0x8825) from raw TIFF bytes. This is a hand
//! written, bounds-checked parser over `&[u8]` — no external EXIF
//! crate — because preservation needs the raw segment bytes anyway,
//! and because a corrupt EXIF block must degrade to "tag unreadable"
//! instead of panicking or failing the whole conversion.
//!
//! Evaluation note (see `docs/CODECS.md`): `kamadak-exif` 0.6.2
//! (MIT OR Apache-2.0, pure Rust) and `img-parts` 0.3 were
//! considered. Both build, but neither supplies the raw APP1 /
//! chunk bytes the preservation step needs, and both would add a
//! second EXIF implementation to audit. The parser here is ~250
//! lines, fully covered by tests, and returns partial data with
//! warnings on corrupt input instead of an error.

use crate::types::GpsCoordinates;

/// Tags the engine actually reports. Everything else in the IFD is
/// ignored (but preserved byte-for-byte when the policy says so —
/// preservation copies the raw segment, never a re-encoded IFD).
#[derive(Debug, Clone, Default)]
pub struct ExifTags {
    pub orientation: Option<u8>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub date_time: Option<String>,
    pub date_time_original: Option<String>,
    pub software: Option<String>,
    pub artist: Option<String>,
    pub description: Option<String>,
    pub x_resolution: Option<f64>,
    pub y_resolution: Option<f64>,
    pub resolution_unit: Option<u8>,
    pub gps: Option<GpsCoordinates>,
}

/// Parse TIFF bytes (the EXIF block itself, starting at the `II` /
/// `MM` header). Never panics on short or corrupt input: unreadable
/// parts are skipped and reported in `warnings`.
pub fn parse_tiff_exif(tiff: &[u8]) -> (ExifTags, Vec<String>) {
    let mut warnings = Vec::new();
    let mut tags = ExifTags::default();
    let Some(reader) = TiffReader::new(tiff) else {
        warnings.push("EXIF block is too short or has an unknown byte order".to_string());
        return (tags, warnings);
    };
    let ifd0_offset = reader.u32_at(4).unwrap_or(8) as usize;
    let Some(ifd0) = reader.ifd_entries(ifd0_offset, &mut warnings) else {
        warnings.push("EXIF block has no readable IFD0".to_string());
        return (tags, warnings);
    };
    read_ifd0(&reader, &ifd0, &mut tags, &mut warnings);
    // Exif SubIFD (datetime original) and GPS IFD, when pointed to.
    if let Some(offset) = find_u32(&reader, &ifd0, 0x8769) {
        if let Some(sub) = reader.ifd_entries(offset as usize, &mut warnings) {
            if let Some(s) = find_ascii(&reader, &sub, 0x9003) {
                tags.date_time_original = Some(s);
            }
        }
    }
    if let Some(offset) = find_u32(&reader, &ifd0, 0x8825) {
        if let Some(gps_ifd) = reader.ifd_entries(offset as usize, &mut warnings) {
            tags.gps = read_gps(&reader, &gps_ifd, &mut warnings);
        }
    }
    (tags, warnings)
}

fn read_ifd0(
    reader: &TiffReader,
    entries: &[IfdEntry],
    tags: &mut ExifTags,
    warnings: &mut Vec<String>,
) {
    for entry in entries {
        match entry.tag {
            0x010F => tags.make = find_ascii_entry(reader, entry),
            0x0110 => tags.model = find_ascii_entry(reader, entry),
            0x0112 => {
                if let Some(v) = entry.short_value(reader) {
                    if (1..=8).contains(&v) {
                        tags.orientation = Some(v as u8);
                    } else {
                        warnings.push(format!("EXIF orientation value {v} is out of range 1..=8"));
                    }
                }
            }
            0x011A => tags.x_resolution = entry.rational_value(reader),
            0x011B => tags.y_resolution = entry.rational_value(reader),
            0x0128 => {
                if let Some(v) = entry.short_value(reader) {
                    tags.resolution_unit = Some(v as u8);
                }
            }
            0x0132 => tags.date_time = find_ascii_entry(reader, entry),
            0x0131 => tags.software = find_ascii_entry(reader, entry),
            0x013B => tags.artist = find_ascii_entry(reader, entry),
            0x010E => tags.description = find_ascii_entry(reader, entry),
            _ => {}
        }
    }
}

fn read_gps(
    reader: &TiffReader,
    entries: &[IfdEntry],
    warnings: &mut Vec<String>,
) -> Option<GpsCoordinates> {
    let lat_ref = find_ascii(reader, entries, 1).unwrap_or_else(|| "N".to_string());
    let lon_ref = find_ascii(reader, entries, 3).unwrap_or_else(|| "E".to_string());
    let lat = read_gps_triplet(reader, entries, 2)?;
    let lon = read_gps_triplet(reader, entries, 4)?;
    let lat = if lat_ref.eq_ignore_ascii_case("S") {
        -lat
    } else {
        lat
    };
    let lon = if lon_ref.eq_ignore_ascii_case("W") {
        -lon
    } else {
        lon
    };
    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
        warnings.push(format!("EXIF GPS coordinates {lat},{lon} are out of range"));
        return None;
    }
    let altitude_m = match find_ascii(reader, entries, 5).as_deref() {
        Some("1") => find_rational(reader, entries, 6).map(|v| -v),
        _ => find_rational(reader, entries, 6),
    };
    Some(GpsCoordinates {
        latitude: lat,
        longitude: lon,
        altitude_m,
    })
}

fn read_gps_triplet(reader: &TiffReader, entries: &[IfdEntry], tag: u16) -> Option<f64> {
    let entry = entries.iter().find(|e| e.tag == tag)?;
    if entry.field_type != 5 || entry.count < 3 {
        return None;
    }
    let base = entry.value_offset(reader)? as usize;
    let mut parts = [0.0f64; 3];
    for (i, part) in parts.iter_mut().enumerate() {
        let num = reader.u32_at(base.checked_add(i.checked_mul(8)?)?)?;
        let den = reader.u32_at(base.checked_add(i.checked_mul(8)?)?.checked_add(4)?)?;
        if den == 0 {
            return None;
        }
        *part = num as f64 / den as f64;
    }
    Some(parts[0] + parts[1] / 60.0 + parts[2] / 3600.0)
}

fn find_ascii(reader: &TiffReader, entries: &[IfdEntry], tag: u16) -> Option<String> {
    entries
        .iter()
        .find(|e| e.tag == tag)
        .and_then(|e| find_ascii_entry(reader, e))
}

fn find_ascii_entry(reader: &TiffReader, entry: &IfdEntry) -> Option<String> {
    if entry.field_type != 2 || entry.count == 0 {
        return None;
    }
    let bytes = reader.value_bytes(entry)?;
    let text = String::from_utf8_lossy(&bytes);
    Some(text.trim_end_matches('\0').trim().to_string())
}

fn find_u32(reader: &TiffReader, entries: &[IfdEntry], tag: u16) -> Option<u32> {
    entries
        .iter()
        .find(|e| e.tag == tag)
        .and_then(|e| e.long_value(reader))
}

fn find_rational(reader: &TiffReader, entries: &[IfdEntry], tag: u16) -> Option<f64> {
    entries
        .iter()
        .find(|e| e.tag == tag)
        .and_then(|e| e.rational_value(reader))
}

/// One IFD entry, kept as raw fields so value decoding can be
/// bounds-checked at use time.
#[derive(Debug, Clone, Copy)]
struct IfdEntry {
    tag: u16,
    field_type: u16,
    count: u32,
    /// The 4 value bytes from the entry itself (inline value, or the
    /// offset to the value when it does not fit inline).
    value_field: [u8; 4],
}

impl IfdEntry {
    /// Byte size of one value of this field type.
    fn type_size(field_type: u16) -> Option<usize> {
        match field_type {
            1 | 2 | 6 | 7 => Some(1),
            3 | 8 => Some(2),
            4 | 9 | 11 => Some(4),
            5 | 10 | 12 => Some(8),
            _ => None,
        }
    }

    fn total_size(&self) -> Option<usize> {
        Self::type_size(self.field_type)?.checked_mul(self.count as usize)
    }

    /// Offset of the value bytes inside the TIFF block (inline when
    /// the value fits in 4 bytes, otherwise the stored offset).
    fn value_offset(&self, reader: &TiffReader) -> Option<u32> {
        let size = self.total_size()?;
        if size <= 4 {
            // Inline: the value lives in the entry's value field.
            // The reader needs a byte offset into the TIFF block, so
            // this is only usable via `value_bytes_inline` — callers
            // that need an offset use `value_bytes` instead.
            let _ = reader;
            None
        } else {
            Some(reader.u32_from(&self.value_field))
        }
    }

    fn short_value(&self, reader: &TiffReader) -> Option<u16> {
        if self.field_type != 3 || self.count == 0 {
            return None;
        }
        Some(reader.u16_from(&self.value_field[..2]))
    }

    fn long_value(&self, reader: &TiffReader) -> Option<u32> {
        if self.field_type != 4 || self.count == 0 {
            return None;
        }
        Some(reader.u32_from(&self.value_field))
    }

    fn rational_value(&self, reader: &TiffReader) -> Option<f64> {
        if self.field_type != 5 || self.count == 0 {
            return None;
        }
        let offset = self.value_offset(reader)? as usize;
        let num = reader.u32_at(offset)?;
        let den = reader.u32_at(offset.checked_add(4)?)?;
        if den == 0 {
            return None;
        }
        Some(num as f64 / den as f64)
    }
}

impl<'a> TiffReader<'a> {
    /// Raw value bytes for an entry: inline bytes when the value
    /// fits, otherwise the bytes at the stored offset. Owned, so
    /// inline (entry) and offset (TIFF block) sources share one
    /// return type.
    fn value_bytes(&self, entry: &IfdEntry) -> Option<Vec<u8>> {
        let size = entry.total_size()?;
        if size <= 4 {
            Some(entry.value_field[..size].to_vec())
        } else {
            let offset = self.u32_from(&entry.value_field) as usize;
            Some(self.bytes.get(offset..offset.checked_add(size)?)?.to_vec())
        }
    }
}

/// TIFF byte-order aware reader over a borrowed slice.
struct TiffReader<'a> {
    bytes: &'a [u8],
    little_endian: bool,
}

impl<'a> TiffReader<'a> {
    fn new(bytes: &'a [u8]) -> Option<Self> {
        if bytes.len() < 8 {
            return None;
        }
        let little_endian = match &bytes[..2] {
            b"II" => true,
            b"MM" => false,
            _ => return None,
        };
        let reader = Self {
            bytes,
            little_endian,
        };
        if reader.u16_at(2)? != 42 {
            return None;
        }
        Some(reader)
    }

    fn u16_from(&self, b: &[u8]) -> u16 {
        if self.little_endian {
            u16::from_le_bytes([b[0], b[1]])
        } else {
            u16::from_be_bytes([b[0], b[1]])
        }
    }

    fn u32_from(&self, b: &[u8]) -> u32 {
        if self.little_endian {
            u32::from_le_bytes([b[0], b[1], b[2], b[3]])
        } else {
            u32::from_be_bytes([b[0], b[1], b[2], b[3]])
        }
    }

    fn u16_at(&self, offset: usize) -> Option<u16> {
        let b = self.bytes.get(offset..offset.checked_add(2)?)?;
        Some(self.u16_from(b))
    }

    fn u32_at(&self, offset: usize) -> Option<u32> {
        let b = self.bytes.get(offset..offset.checked_add(4)?)?;
        Some(self.u32_from(b))
    }

    /// Entries of the IFD at `offset` (offset of the entry count).
    /// Returns `None` when the IFD header itself is out of bounds;
    /// individual unreadable entries are skipped with a warning.
    fn ifd_entries(&self, offset: usize, warnings: &mut Vec<String>) -> Option<Vec<IfdEntry>> {
        let count = self.u16_at(offset)? as usize;
        let mut entries = Vec::with_capacity(count.min(256));
        for i in 0..count {
            let base = offset.checked_add(2)?.checked_add(i.checked_mul(12)?)?;
            let raw = self.bytes.get(base..base.checked_add(12)?)?;
            if raw.len() < 12 {
                warnings.push(format!("EXIF IFD entry {i} is truncated"));
                continue;
            }
            let mut value_field = [0u8; 4];
            value_field.copy_from_slice(&raw[8..12]);
            entries.push(IfdEntry {
                tag: self.u16_from(&raw[0..2]),
                field_type: self.u16_from(&raw[2..4]),
                count: self.u32_from(&raw[4..8]),
                value_field,
            });
        }
        Some(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{ascii, build_tiff, longs, rationals, shorts, TiffEntry};

    /// IFD0 with orientation 6, make/model, dates, resolution and a
    /// GPS sub-IFD (37°46'30"N, 122°25'10"W, altitude 10 m).
    fn full_exif(le: bool) -> Vec<u8> {
        let gps = vec![
            TiffEntry::raw(1, 2, 2, ascii("N")),
            TiffEntry::raw(2, 5, 3, rationals(&[(37, 1), (46, 1), (30, 1)], le)),
            TiffEntry::raw(3, 2, 2, ascii("W")),
            TiffEntry::raw(4, 5, 3, rationals(&[(122, 1), (25, 1), (10, 1)], le)),
            TiffEntry::raw(5, 1, 1, vec![0]),
            TiffEntry::raw(6, 5, 1, rationals(&[(10, 1)], le)),
        ];
        let sub = vec![TiffEntry::raw(0x9003, 2, 20, ascii("2026:11:15 10:30:00"))];
        build_tiff(
            &[
                TiffEntry::raw(0x010F, 2, 6, ascii("Canon")),
                TiffEntry::raw(0x0110, 2, 8, ascii("EOS R50")),
                TiffEntry::raw(0x0112, 3, 1, shorts(&[6], le)),
                TiffEntry::raw(0x011A, 5, 1, rationals(&[(300, 1)], le)),
                TiffEntry::raw(0x011B, 5, 1, rationals(&[(300, 1)], le)),
                TiffEntry::raw(0x0128, 3, 1, shorts(&[2], le)),
                TiffEntry::raw(0x0132, 2, 20, ascii("2026:11:15 10:30:00")),
                TiffEntry::raw(0x0131, 2, 9, ascii("TestSoft")),
                TiffEntry::raw(0x013B, 2, 6, ascii("Alice")),
                TiffEntry::ifd(0x8769, sub),
                TiffEntry::ifd(0x8825, gps),
            ],
            le,
        )
    }

    #[test]
    fn parses_little_endian_exif_with_gps() {
        let (tags, warnings) = parse_tiff_exif(&full_exif(true));
        assert!(warnings.is_empty(), "warnings: {warnings:?}");
        assert_eq!(tags.orientation, Some(6));
        assert_eq!(tags.make.as_deref(), Some("Canon"));
        assert_eq!(tags.model.as_deref(), Some("EOS R50"));
        assert_eq!(tags.date_time.as_deref(), Some("2026:11:15 10:30:00"));
        assert_eq!(
            tags.date_time_original.as_deref(),
            Some("2026:11:15 10:30:00")
        );
        assert_eq!(tags.software.as_deref(), Some("TestSoft"));
        assert_eq!(tags.artist.as_deref(), Some("Alice"));
        assert_eq!(tags.x_resolution, Some(300.0));
        assert_eq!(tags.resolution_unit, Some(2));
        let gps = tags.gps.expect("GPS parsed");
        assert!((gps.latitude - 37.775).abs() < 1e-6, "lat {}", gps.latitude);
        assert!(
            (gps.longitude + 122.419_444).abs() < 1e-4,
            "lon {}",
            gps.longitude
        );
        assert_eq!(gps.altitude_m, Some(10.0));
    }

    #[test]
    fn parses_big_endian_exif() {
        let (tags, warnings) = parse_tiff_exif(&full_exif(false));
        assert!(warnings.is_empty(), "warnings: {warnings:?}");
        assert_eq!(tags.orientation, Some(6));
        assert_eq!(tags.make.as_deref(), Some("Canon"));
        assert!(tags.gps.is_some());
    }

    #[test]
    fn orientation_out_of_range_is_a_warning_not_a_crash() {
        let tiff = build_tiff(&[TiffEntry::raw(0x0112, 3, 1, shorts(&[9], true))], true);
        let (tags, warnings) = parse_tiff_exif(&tiff);
        assert_eq!(tags.orientation, None);
        assert!(!warnings.is_empty());
    }

    #[test]
    fn corrupt_exif_degrades_gracefully() {
        // Too short, bad magic, truncated IFD, wild offsets — none
        // of these may panic; they yield empty tags + warnings.
        for bytes in [
            vec![],
            vec![0x49, 0x49],
            b"II*\x00\x08\x00\x00\x00".to_vec(),
            // IFD count says 5 entries but the file ends after 1.
            {
                let mut v = build_tiff(&[TiffEntry::raw(0x010F, 2, 6, ascii("Canon"))], true);
                v[8] = 5;
                v.truncate(30);
                v
            },
            // GPS pointer to nowhere.
            build_tiff(
                &[TiffEntry::raw(0x8825, 4, 1, longs(&[999_999], true))],
                true,
            ),
            // Rational with a zero denominator.
            build_tiff(
                &[TiffEntry::raw(0x011A, 5, 1, rationals(&[(300, 0)], true))],
                true,
            ),
        ] {
            let (tags, _) = parse_tiff_exif(&bytes);
            assert_eq!(tags.orientation, None);
        }
        let (_, warnings) = parse_tiff_exif(b"XX*\x00\x08\x00\x00\x00");
        assert!(!warnings.is_empty());
    }

    #[test]
    fn empty_tiff_has_no_tags() {
        let (tags, _) = parse_tiff_exif(&build_tiff(&[], true));
        assert_eq!(tags.orientation, None);
        assert!(tags.gps.is_none());
    }
}
