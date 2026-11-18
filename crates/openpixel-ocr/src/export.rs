//! OCR result exports to Word (.docx) and Excel (.xlsx).
//!
//! Same hand-rolled pattern as the PDF text exports
//! (`crates/openpixel-pdf/src/text.rs` + `zip.rs`): a minimal
//! ZIP writer (flate2 + crc32fast, both already workspace deps)
//! plus small XML templates. No new dependency, no LibreOffice,
//! no full docx/xlsx crate — the outputs are text-only and
//! deliberately minimal:
//!
//! - DOCX: one paragraph per recognised line (from
//!   `OcrResult::lines()`), with a title paragraph first.
//! - XLSX: one row per recognised word — text, confidence (%),
//!   x, y, width, height — plus a header row. Words are written
//!   as inline strings, so no shared-strings table is needed.
//!
//! Both were verified to open with python-docx / openpyxl and
//! with LibreOffice in the CLI e2e (see docs/OCR.md).

use crate::result::OcrResult;

/// One file inside the archive.
struct ZipEntry {
    name: &'static str,
    data: Vec<u8>,
    compress: bool,
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

/// Minimal ZIP writer — same shape as `openpixel_pdf::zip::build_zip`.
/// Stored (method 0) or deflated (method 8) entries, UTF-8 names,
/// central directory + end-of-central-directory record. No ZIP64.
fn build_zip(entries: &[ZipEntry]) -> Vec<u8> {
    let mut out = Vec::new();
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
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes());
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
        out.extend_from_slice(&20u16.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes());
        out.extend_from_slice(&0x0800u16.to_le_bytes());
        out.extend_from_slice(&method.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0x21u16.to_le_bytes());
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
        out.extend_from_slice(&(entry.data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(entry.name.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        out.extend_from_slice(&offset.to_le_bytes());
        out.extend_from_slice(entry.name.as_bytes());
    }
    let cd_size = out.len() as u32 - cd_offset;
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&(central.len() as u16).to_le_bytes());
    out.extend_from_slice(&(central.len() as u16).to_le_bytes());
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

fn escape_xml(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            // Audit B13: XML 1.0 forbids control characters
            // except tab/LF/CR — recognised text can carry them,
            // and one would make the whole DOCX/XLSX unparseable.
            // They are dropped, not escaped (there is no escape
            // for them in XML 1.0).
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            _ => out.push(c),
        }
    }
    out
}

const DOCX_CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>
"#;

const DOCX_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>
"#;

const DOCX_APP: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>OpenPixel Studio</Application></Properties>
"#;

/// OCR result as a minimal .docx: a title paragraph, then one
/// paragraph per recognised line. Text only — no fonts, styles,
/// tables or images. An empty result still yields a valid
/// document (title only).
pub fn ocr_to_docx(result: &OcrResult) -> Vec<u8> {
    let core = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>OCR result</dc:title><dc:creator>OpenPixel Studio</dc:creator></cp:coreProperties>
"#
    .to_string();
    let mut document = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
"#,
    );
    document.push_str(
        "<w:p><w:pPr><w:pStyle w:val=\"Title\"/></w:pPr><w:r><w:t>OCR result</w:t></w:r></w:p>\n",
    );
    for line in result.lines() {
        let text: Vec<&str> = line.iter().map(|w| w.text.as_str()).collect();
        document.push_str(&format!(
            "<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>\n",
            escape_xml(&text.join(" "))
        ));
    }
    document.push_str("</w:body></w:document>\n");
    build_zip(&[
        ZipEntry {
            name: "[Content_Types].xml",
            data: DOCX_CONTENT_TYPES.as_bytes().to_vec(),
            compress: true,
        },
        ZipEntry {
            name: "_rels/.rels",
            data: DOCX_RELS.as_bytes().to_vec(),
            compress: true,
        },
        ZipEntry {
            name: "docProps/core.xml",
            data: core.into_bytes(),
            compress: true,
        },
        ZipEntry {
            name: "docProps/app.xml",
            data: DOCX_APP.as_bytes().to_vec(),
            compress: true,
        },
        ZipEntry {
            name: "word/document.xml",
            data: document.into_bytes(),
            compress: true,
        },
    ])
}

const XLSX_CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>
"#;

const XLSX_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>
"#;

const XLSX_WORKBOOK: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="OCR words" sheetId="1" r:id="rId1"/></sheets></workbook>
"#;

const XLSX_WORKBOOK_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>
"#;

fn xlsx_cell_ref(col: usize, row: usize) -> String {
    // Columns A..F only — the sheet has six columns.
    let letter = (b'A' + col as u8) as char;
    format!("{letter}{row}")
}

/// OCR result as a minimal .xlsx: one row per recognised word —
/// text, confidence (%), x, y, width, height — plus a header row.
/// Words are inline strings, so no shared-strings table is needed.
/// An empty result still yields a valid sheet (header only).
pub fn ocr_to_xlsx(result: &OcrResult) -> Vec<u8> {
    let mut sheet = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
"#,
    );
    let headers = ["Word", "Confidence (%)", "X", "Y", "Width", "Height"];
    sheet.push_str("<row r=\"1\">");
    for (i, h) in headers.iter().enumerate() {
        sheet.push_str(&format!(
            "<c r=\"{}\" t=\"inlineStr\"><is><t>{}</t></is></c>",
            xlsx_cell_ref(i, 1),
            escape_xml(h)
        ));
    }
    sheet.push_str("</row>\n");
    for (i, w) in result.words.iter().enumerate() {
        let row = i + 2;
        sheet.push_str(&format!("<row r=\"{row}\">"));
        sheet.push_str(&format!(
            "<c r=\"{}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
            xlsx_cell_ref(0, row),
            escape_xml(&w.text)
        ));
        for (col, value) in [
            (1, format!("{:.1}", w.confidence)),
            (2, w.x.to_string()),
            (3, w.y.to_string()),
            (4, w.width.to_string()),
            (5, w.height.to_string()),
        ] {
            sheet.push_str(&format!(
                "<c r=\"{}\"><v>{value}</v></c>",
                xlsx_cell_ref(col, row)
            ));
        }
        sheet.push_str("</row>\n");
    }
    sheet.push_str("</sheetData></worksheet>\n");
    build_zip(&[
        ZipEntry {
            name: "[Content_Types].xml",
            data: XLSX_CONTENT_TYPES.as_bytes().to_vec(),
            compress: true,
        },
        ZipEntry {
            name: "_rels/.rels",
            data: XLSX_RELS.as_bytes().to_vec(),
            compress: true,
        },
        ZipEntry {
            name: "xl/workbook.xml",
            data: XLSX_WORKBOOK.as_bytes().to_vec(),
            compress: true,
        },
        ZipEntry {
            name: "xl/_rels/workbook.xml.rels",
            data: XLSX_WORKBOOK_RELS.as_bytes().to_vec(),
            compress: true,
        },
        ZipEntry {
            name: "xl/worksheets/sheet1.xml",
            data: sheet.into_bytes(),
            compress: true,
        },
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::result::OcrWord;

    fn sample() -> OcrResult {
        OcrResult {
            text: "hello world\nsecond".to_string(),
            words: vec![
                OcrWord {
                    text: "hello".to_string(),
                    confidence: 95.5,
                    x: 10,
                    y: 10,
                    width: 40,
                    height: 20,
                },
                OcrWord {
                    text: "world".to_string(),
                    confidence: 88.0,
                    x: 60,
                    y: 10,
                    width: 40,
                    height: 20,
                },
                OcrWord {
                    text: "second".to_string(),
                    confidence: 70.25,
                    x: 10,
                    y: 50,
                    width: 50,
                    height: 20,
                },
            ],
            mean_confidence: 84.6,
            language: "eng".to_string(),
            engine: "test".to_string(),
            width: 200,
            height: 100,
            duration_ms: 1,
            preprocessed: vec![],
        }
    }

    /// Regression (audit B13): a control character in a
    /// recognised word must not corrupt the whole DOCX/XLSX —
    /// it is dropped by `escape_xml`, and the export stays valid.
    #[test]
    fn exports_drop_control_characters_from_words() {
        let mut result = sample();
        result.words[0].text = "he\x00llo".to_string();
        result.words[1].text = "wor\x07ld".to_string();
        let docx = ocr_to_docx(&result);
        let document = unzip_entry(&docx, "word/document.xml").unwrap();
        assert!(document.contains("hello"), "word lost: {document}");
        assert!(document.contains("world"), "word lost: {document}");
        assert!(!document.contains('\x00'), "NUL leaked into document.xml");
        let xlsx = ocr_to_xlsx(&result);
        let sheet = unzip_entry(&xlsx, "xl/worksheets/sheet1.xml").unwrap();
        assert!(sheet.contains("hello"), "word lost: {sheet}");
        assert!(!sheet.contains('\x07'), "BEL leaked into sheet1.xml");
    }

    /// Read one entry out of a ZIP made by `build_zip`, by
    /// walking the local headers (same approach as the PDF
    /// text-export tests).
    fn unzip_entry(zip: &[u8], want: &str) -> Option<String> {
        let mut pos = 0;
        while pos + 30 <= zip.len() && zip[pos..pos + 4] == [0x50, 0x4b, 0x03, 0x04] {
            let method = u16::from_le_bytes([zip[pos + 8], zip[pos + 9]]);
            let name_len = u16::from_le_bytes([zip[pos + 26], zip[pos + 27]]) as usize;
            let extra_len = u16::from_le_bytes([zip[pos + 28], zip[pos + 29]]) as usize;
            let comp_size =
                u32::from_le_bytes([zip[pos + 18], zip[pos + 19], zip[pos + 20], zip[pos + 21]])
                    as usize;
            let name_start = pos + 30;
            let name_end = name_start + name_len;
            let data_start = name_end + extra_len;
            let data_end = data_start + comp_size;
            if data_end > zip.len() {
                return None;
            }
            if let Ok(name) = std::str::from_utf8(&zip[name_start..name_end]) {
                if name == want {
                    let raw = &zip[data_start..data_end];
                    if method == 8 {
                        use std::io::Read;
                        let mut dec = flate2::read::DeflateDecoder::new(raw);
                        let mut out = Vec::new();
                        dec.read_to_end(&mut out).ok()?;
                        return String::from_utf8(out).ok();
                    }
                    return String::from_utf8(raw.to_vec()).ok();
                }
            }
            pos = data_end;
        }
        None
    }

    #[test]
    fn docx_holds_ocr_lines() {
        let docx = ocr_to_docx(&sample());
        assert_eq!(&docx[0..2], b"PK");
        let xml =
            unzip_entry(&docx, "word/document.xml").expect("document.xml must be in the DOCX");
        assert!(xml.contains("hello world"), "line 1: {xml}");
        assert!(xml.contains("second"), "line 2: {xml}");
        assert!(xml.contains("OCR result"), "title: {xml}");
    }

    #[test]
    fn xlsx_holds_one_row_per_word() {
        let xlsx = ocr_to_xlsx(&sample());
        assert_eq!(&xlsx[0..2], b"PK");
        let xml =
            unzip_entry(&xlsx, "xl/worksheets/sheet1.xml").expect("sheet1.xml must be in the XLSX");
        assert!(xml.contains("Word"), "header: {xml}");
        assert!(xml.contains("Confidence (%)"), "header: {xml}");
        assert!(xml.contains("hello"), "word 1: {xml}");
        assert!(xml.contains("95.5"), "confidence: {xml}");
        assert!(xml.contains("<v>10</v>"), "x=10: {xml}");
        assert!(xml.contains("<v>50</v>"), "y=50: {xml}");
        assert_eq!(xml.matches("<row ").count(), 4, "header + 3 words: {xml}");
    }

    #[test]
    fn empty_result_still_valid() {
        let empty = OcrResult {
            text: String::new(),
            words: vec![],
            mean_confidence: 0.0,
            language: "eng".to_string(),
            engine: "test".to_string(),
            width: 0,
            height: 0,
            duration_ms: 0,
            preprocessed: vec![],
        };
        let docx = ocr_to_docx(&empty);
        let xml = unzip_entry(&docx, "word/document.xml").expect("document.xml");
        assert!(xml.contains("OCR result"));
        let xlsx = ocr_to_xlsx(&empty);
        let sheet = unzip_entry(&xlsx, "xl/worksheets/sheet1.xml").expect("sheet1.xml");
        assert_eq!(sheet.matches("<row ").count(), 1, "header only: {sheet}");
    }

    #[test]
    fn xml_is_escaped() {
        let mut r = sample();
        r.words[0].text = "a<b>&\"c".to_string();
        let docx = ocr_to_docx(&r);
        let xml = unzip_entry(&docx, "word/document.xml").expect("document.xml");
        assert!(xml.contains("a&lt;b&gt;&amp;&quot;c"), "escaped: {xml}");
        assert!(!xml.contains("a<b>"), "raw markup must not leak: {xml}");
    }
}
