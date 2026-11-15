//! openpixel-metadata — EXIF / ICC / XMP reading, metadata policies,
//! orientation normalisation, animation frames and ICC colour
//! conversion (Phase 5).
//!
//! ```rust
//! use openpixel_formats::ImageFormat;
//! use openpixel_metadata::extract_metadata;
//!
//! // A JPEG with no APP segments has no metadata — never an error.
//! let meta = extract_metadata(&[0xFF, 0xD8, 0xFF, 0xD9], ImageFormat::Jpeg);
//! assert!(!meta.has_exif);
//! ```
//!
//! What this crate does and does not do (see `docs/CODECS.md`):
//! * Reads EXIF (orientation, make/model, dates, GPS, resolution),
//!   ICC profile presence/description, and XMP packets from
//!   JPEG / PNG / TIFF / WebP, with a hand-written bounds-checked
//!   parser — corrupt metadata degrades to warnings, never a crash.
//! * Preserves metadata byte-for-byte into JPEG (APP1/APP2) and PNG
//!   (`eXIf` / `iCCP` / `iTXt`) outputs only; every other target
//!   honestly reports the drop (see `policy::apply_policy`).
//! * GIF frame enumeration + extraction (with disposal
//!   compositing), APNG / animated WebP frame info, TIFF page count
//!   + extraction.
//! * ICC → sRGB conversion via tintbox (pure-Rust LittleCMS).
//!   Colour conversion is only claimed when it actually runs.

pub mod error;
pub mod exif;
pub mod extract;
pub mod frames;
pub mod icc;
pub mod orientation;
pub mod policy;
pub mod types;

pub use error::{MetadataError, MetadataResult};
pub use extract::extract_metadata;
pub use frames::{
    animation_info, apng_info, extract_gif_frame, extract_tiff_page, gif_animation,
    tiff_page_count, webp_animation_info,
};
pub use icc::{convert_to_srgb, parse_icc};
pub use orientation::{normalize_orientation, orientation_description, orientation_operations};
pub use policy::{apply_policy, png_crc32, PreservationReport};
pub use types::{
    AnimationInfo, FrameInfo, GpsCoordinates, IccProfile, Metadata, MetadataField, MetadataPolicy,
};

/// Test-only builders for TIFF / JPEG / PNG / WebP fixtures.
/// No binary fixtures are checked in; every test builds its bytes.
#[cfg(test)]
pub(crate) mod test_helpers {
    /// One IFD entry for the TIFF builder.
    #[derive(Debug, Clone)]
    pub struct TiffEntry {
        pub tag: u16,
        pub field_type: u16,
        pub count: u32,
        pub payload: TiffPayload,
    }

    #[derive(Debug, Clone)]
    pub enum TiffPayload {
        /// Raw value bytes (inlined when <= 4 bytes, else offset).
        Raw(Vec<u8>),
        /// Bytes stored out-of-line with the entry holding their
        /// offset (e.g. a TIFF `StripOffsets` value).
        OffsetTo(Vec<u8>),
        /// A nested IFD block (Exif SubIFD, GPS IFD) serialised at
        /// the payload offset.
        Ifd(Vec<TiffEntry>),
    }

    impl TiffEntry {
        pub fn raw(tag: u16, field_type: u16, count: u32, payload: Vec<u8>) -> Self {
            Self {
                tag,
                field_type,
                count,
                payload: TiffPayload::Raw(payload),
            }
        }
        pub fn ifd(tag: u16, entries: Vec<TiffEntry>) -> Self {
            Self {
                tag,
                field_type: 4,
                count: 1,
                payload: TiffPayload::Ifd(entries),
            }
        }
    }

    fn ifd_block_size(entries: &[TiffEntry]) -> usize {
        let mut size = 2 + entries.len() * 12 + 4;
        for e in entries {
            let raw_len = match &e.payload {
                TiffPayload::Raw(b) | TiffPayload::OffsetTo(b) => b.len(),
                TiffPayload::Ifd(sub) => ifd_block_size(sub),
            };
            // OffsetTo payloads are always stored out-of-line.
            let out_of_line = matches!(e.payload, TiffPayload::OffsetTo(_)) || raw_len > 4;
            if out_of_line {
                size += raw_len;
            }
        }
        size
    }

    /// Serialise one IFD block at absolute offset `base` (the offset
    /// of the entry count). Value offsets are absolute TIFF offsets.
    fn build_ifd(entries: &[TiffEntry], le: bool, base: usize) -> Vec<u8> {
        let mut out = Vec::new();
        let u16b = |v: u16| {
            if le {
                v.to_le_bytes()
            } else {
                v.to_be_bytes()
            }
        };
        let u32b = |v: u32| {
            if le {
                v.to_le_bytes()
            } else {
                v.to_be_bytes()
            }
        };
        out.extend_from_slice(&u16b(entries.len() as u16));
        // Payload area starts after count + entries + next-pointer.
        let mut data_cursor = base + 2 + entries.len() * 12 + 4;
        let mut trailing: Vec<u8> = Vec::new();
        for e in entries {
            out.extend_from_slice(&u16b(e.tag));
            out.extend_from_slice(&u16b(e.field_type));
            out.extend_from_slice(&u32b(e.count));
            let raw_len = match &e.payload {
                TiffPayload::Raw(b) | TiffPayload::OffsetTo(b) => b.len(),
                TiffPayload::Ifd(sub) => ifd_block_size(sub),
            };
            let out_of_line = matches!(e.payload, TiffPayload::OffsetTo(_)) || raw_len > 4;
            if !out_of_line {
                let mut inline = [0u8; 4];
                if let TiffPayload::Raw(b) = &e.payload {
                    inline[..b.len()].copy_from_slice(b);
                }
                out.extend_from_slice(&inline);
            } else {
                out.extend_from_slice(&u32b(data_cursor as u32));
                let payload_bytes = match &e.payload {
                    TiffPayload::Raw(b) | TiffPayload::OffsetTo(b) => b.clone(),
                    TiffPayload::Ifd(sub) => build_ifd(sub, le, data_cursor),
                };
                trailing.extend_from_slice(&payload_bytes);
                data_cursor += raw_len;
            }
        }
        out.extend_from_slice(&u32b(0)); // no next IFD
        out.extend_from_slice(&trailing);
        out
    }

    /// A complete TIFF file: header + IFD0 at offset 8.
    pub fn build_tiff(entries: &[TiffEntry], le: bool) -> Vec<u8> {
        let mut out = Vec::new();
        if le {
            out.extend_from_slice(b"II*\x00");
            out.extend_from_slice(&8u32.to_le_bytes());
        } else {
            out.extend_from_slice(b"MM\x00*");
            out.extend_from_slice(&8u32.to_be_bytes());
        }
        out.extend_from_slice(&build_ifd(entries, le, 8));
        out
    }

    /// A multi-page TIFF: each page is one IFD; IFDs chain via the
    /// next-pointer. Returns the file bytes.
    pub fn build_tiff_pages(pages: &[Vec<TiffEntry>], le: bool) -> Vec<u8> {
        // Lay out pages sequentially: page i's IFD starts at its
        // offset; each page's next-pointer is the next page's offset.
        let mut offsets: Vec<usize> = Vec::new();
        let mut cursor = 8usize;
        for page in pages {
            offsets.push(cursor);
            cursor += ifd_block_size(page);
        }
        let mut out = Vec::new();
        if le {
            out.extend_from_slice(b"II*\x00");
            out.extend_from_slice(&8u32.to_le_bytes());
        } else {
            out.extend_from_slice(b"MM\x00*");
            out.extend_from_slice(&8u32.to_be_bytes());
        }
        for (i, page) in pages.iter().enumerate() {
            let mut block = build_ifd(page, le, offsets[i]);
            // Patch the next-pointer (last 4 bytes of the IFD header
            // part: count + entries) to the next page's offset.
            let next = if i + 1 < pages.len() {
                offsets[i + 1] as u32
            } else {
                0
            };
            let patch_at = 2 + page.len() * 12;
            let bytes = if le {
                next.to_le_bytes()
            } else {
                next.to_be_bytes()
            };
            block[patch_at..patch_at + 4].copy_from_slice(&bytes);
            out.extend_from_slice(&block);
        }
        out
    }

    pub fn ascii(s: &str) -> Vec<u8> {
        let mut v = s.as_bytes().to_vec();
        v.push(0);
        v
    }

    pub fn shorts(vals: &[u16], le: bool) -> Vec<u8> {
        vals.iter()
            .flat_map(|v| if le { v.to_le_bytes() } else { v.to_be_bytes() })
            .collect()
    }

    pub fn longs(vals: &[u32], le: bool) -> Vec<u8> {
        vals.iter()
            .flat_map(|v| if le { v.to_le_bytes() } else { v.to_be_bytes() })
            .collect()
    }

    pub fn rationals(vals: &[(u32, u32)], le: bool) -> Vec<u8> {
        vals.iter()
            .flat_map(|(n, d)| {
                let mut v = longs(&[*n], le);
                v.extend_from_slice(&longs(&[*d], le));
                v
            })
            .collect()
    }

    /// Minimal JPEG: SOI + the given APP segments + EOI.
    pub fn jpeg_with_segments(segments: &[(u8, Vec<u8>)]) -> Vec<u8> {
        let mut out = vec![0xFF, 0xD8];
        for (marker, payload) in segments {
            out.extend_from_slice(&[0xFF, *marker]);
            out.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
            out.extend_from_slice(payload);
        }
        out.extend_from_slice(&[0xFF, 0xD9]);
        out
    }

    /// Minimal PNG: signature + chunks + IEND.
    pub fn png_with_chunks(chunks: &[(&[u8; 4], Vec<u8>)]) -> Vec<u8> {
        let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
        for (ty, data) in chunks {
            out.extend_from_slice(&(data.len() as u32).to_be_bytes());
            out.extend_from_slice(*ty);
            out.extend_from_slice(data);
            let mut crc_input = ty.to_vec();
            crc_input.extend_from_slice(data);
            out.extend_from_slice(&crate::policy::png_crc32(&crc_input).to_be_bytes());
        }
        out.extend_from_slice(&0u32.to_be_bytes());
        out.extend_from_slice(b"IEND");
        out.extend_from_slice(&crate::policy::png_crc32(b"IEND").to_be_bytes());
        out
    }

    /// Minimal WebP: RIFF + WEBP + chunks (even-size padded).
    pub fn webp_with_chunks(chunks: &[(&[u8; 4], Vec<u8>)]) -> Vec<u8> {
        let mut body = b"WEBP".to_vec();
        for (fourcc, data) in chunks {
            body.extend_from_slice(*fourcc);
            body.extend_from_slice(&(data.len() as u32).to_le_bytes());
            body.extend_from_slice(data);
            if data.len() % 2 == 1 {
                body.push(0);
            }
        }
        let mut out = b"RIFF".to_vec();
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend_from_slice(&body);
        out
    }

    /// A real sRGB ICC profile, built with tintbox.
    pub fn srgb_icc() -> Vec<u8> {
        let writable = tintbox::profile::virtuals::build_srgb_profile();
        tintbox::profile::save_to_mem(&writable).expect("sRGB profile serialises")
    }

    /// A real non-sRGB profile (Adobe RGB 1998 primaries, D65,
    /// gamma 2.2), built with tintbox — for colour tests.
    pub fn adobe_icc() -> Vec<u8> {
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
}
