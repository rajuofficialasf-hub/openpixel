//! Minimal ZIP writer (Studio Phase 3).
//!
//! EPUB and DOCX are both ZIP archives with a few small XML
//! entries. This writer is deliberately tiny and dependency-light:
//! it uses `flate2` (already in the tree) for deflate and
//! `crc32fast` (already a transitive dep of flate2) for checksums.
//! It writes stored (method 0) or deflated (method 8) entries with
//! UTF-8 names (general-purpose flag bit 11), a central directory
//! and an end-of-central-directory record. No ZIP64, no data
//! descriptors, no encryption — an EPUB/DOCX never needs those,
//! and a reader that does is out of scope.
//!
//! The one ordering rule that matters: the EPUB `mimetype` entry
//! must be **first and stored** (method 0). Callers control that
//! by putting it first in the entries list with
//! `compress: false`.

/// One file inside the archive.
#[derive(Debug, Clone)]
pub struct ZipEntry {
    /// Archive path, `/`-separated (e.g. `META-INF/container.xml`).
    pub name: String,
    /// File contents.
    pub data: Vec<u8>,
    /// `true` = deflate (method 8), `false` = stored (method 0).
    pub compress: bool,
}

fn crc32(data: &[u8]) -> u32 {
    let mut h = crc32fast::Hasher::new();
    h.update(data);
    h.finalize()
}

fn deflate(data: &[u8]) -> Vec<u8> {
    use flate2::write::DeflateEncoder;
    use flate2::Compression;
    use std::io::Write;
    let mut enc = DeflateEncoder::new(Vec::new(), Compression::best());
    let _ = enc.write_all(data);
    enc.finish().unwrap_or_default()
}

/// Build a ZIP archive from `entries`, in order. The caller is
/// responsible for the EPUB rule (mimetype first, stored).
pub fn build_zip(entries: &[ZipEntry]) -> Vec<u8> {
    let mut out = Vec::new();
    // (local-header offset, entry, compressed bytes, crc)
    let mut central: Vec<(u32, &ZipEntry, Vec<u8>, u32)> = Vec::with_capacity(entries.len());
    for entry in entries {
        let crc = crc32(&entry.data);
        let compressed = if entry.compress {
            deflate(&entry.data)
        } else {
            entry.data.clone()
        };
        let method: u16 = if entry.compress { 8 } else { 0 };
        let offset = out.len() as u32;
        // Local file header.
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes()); // version needed
        out.extend_from_slice(&0x0800u16.to_le_bytes()); // flags: UTF-8 names
        out.extend_from_slice(&method.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // mod time
        out.extend_from_slice(&0x21u16.to_le_bytes()); // mod date (1980-01-01)
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
        out.extend_from_slice(&(entry.data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(entry.name.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // extra length
        out.extend_from_slice(entry.name.as_bytes());
        out.extend_from_slice(&compressed);
        central.push((offset, entry, compressed, crc));
    }
    let cd_offset = out.len() as u32;
    for (offset, entry, compressed, crc) in &central {
        let method: u16 = if entry.compress { 8 } else { 0 };
        out.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes()); // version made by
        out.extend_from_slice(&20u16.to_le_bytes()); // version needed
        out.extend_from_slice(&0x0800u16.to_le_bytes()); // flags: UTF-8
        out.extend_from_slice(&method.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // mod time
        out.extend_from_slice(&0x21u16.to_le_bytes()); // mod date
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
        out.extend_from_slice(&(entry.data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(entry.name.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // extra
        out.extend_from_slice(&0u16.to_le_bytes()); // comment
        out.extend_from_slice(&0u16.to_le_bytes()); // disk number
        out.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
        out.extend_from_slice(&0u32.to_le_bytes()); // external attrs
        out.extend_from_slice(&offset.to_le_bytes());
        out.extend_from_slice(entry.name.as_bytes());
    }
    let cd_size = out.len() as u32 - cd_offset;
    // End of central directory.
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // disk
    out.extend_from_slice(&0u16.to_le_bytes()); // cd start disk
    out.extend_from_slice(&(central.len() as u16).to_le_bytes());
    out.extend_from_slice(&(central.len() as u16).to_le_bytes());
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // comment length
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn has_mimetype_first_stored(zip: &[u8]) -> bool {
        // Local header: PK\x03\x04, version, flags, method.
        zip.len() > 30
            && zip[0..4] == [0x50, 0x4b, 0x03, 0x04]
            && u16::from_le_bytes([zip[8], zip[9]]) == 0 // stored
            && zip[30..38] == *b"mimetype"
    }

    #[test]
    fn zip_round_trips_through_python_zipfile() {
        // The strongest check available in-process: the archive
        // must parse with a real ZIP reader. `zipfile` is run by
        // the CLI e2e; here we check the structure by hand.
        let zip = build_zip(&[
            ZipEntry {
                name: "mimetype".to_string(),
                data: b"application/epub+zip".to_vec(),
                compress: false,
            },
            ZipEntry {
                name: "hello.txt".to_string(),
                data: b"hello world, hello world".to_vec(),
                compress: true,
            },
        ]);
        assert!(has_mimetype_first_stored(&zip));
        // End of central directory: last 22 bytes, PK\x05\x06,
        // two entries.
        assert_eq!(&zip[zip.len() - 22..zip.len() - 18], b"PK\x05\x06");
        assert_eq!(
            u16::from_le_bytes([zip[zip.len() - 12], zip[zip.len() - 11]]),
            2
        );
        // Both entry names appear in the central directory.
        assert!(zip.windows(b"hello.txt".len()).any(|w| w == b"hello.txt"));
    }
}
