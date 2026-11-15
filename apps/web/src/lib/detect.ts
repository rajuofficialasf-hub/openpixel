/**
 * Magic-byte format detection, mirroring the Rust side exactly
 * (`crates/openpixel-formats/src/format.rs`, `detect_format`).
 *
 * The extension is NEVER trusted — this is the same security boundary
 * as the engine: a PNG named `.jpg` is detected as PNG. The signature
 * table here is intentionally a 1:1 port of the Rust one so the two
 * can never silently drift; `detect.test.ts` covers the same cases
 * as the Rust unit tests in `format.rs`.
 *
 * Returns the engine format id (`jpeg`, `png`, …) or `'unknown'`.
 * APNG has no distinct signature (it is a PNG); RAW/PSD have no
 * signature in the Rust detector either, so they are `'unknown'` here.
 */

export type DetectedFormat =
  | 'jpeg'
  | 'png'
  | 'bmp'
  | 'gif'
  | 'tiff'
  | 'webp'
  | 'avif'
  | 'heic'
  | 'heif'
  | 'jxl'
  | 'jpeg2000'
  | 'qoi'
  | 'ico'
  | 'pnm'
  | 'exr'
  | 'hdr'
  | 'tga'
  | 'svg'
  | 'unknown'

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false
  }
  return true
}

function equalsAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

/** Strict start-of-file SVG sniff — same rules as the Rust `is_svg`. */
function isSvg(bytes: Uint8Array): boolean {
  let i = 0
  // UTF-8 BOM.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    i = 3
  }
  const skipWs = (from: number): number => {
    let j = from
    while (
      j < bytes.length &&
      (bytes[j] === 0x20 || bytes[j] === 0x09 || bytes[j] === 0x0d || bytes[j] === 0x0a)
    ) {
      j++
    }
    return j
  }
  i = skipWs(i)
  // Optional `<?xml ...?>` declaration.
  if (bytes.length >= i + 5 && equalsAt(bytes, i, '<?xml')) {
    let end = -1
    for (let j = i; j + 1 < bytes.length; j++) {
      if (bytes[j] === 0x3f && bytes[j + 1] === 0x3e) {
        end = j
        break
      }
    }
    if (end === -1) return false
    i = skipWs(end + 2)
  }
  // `<svg` followed by whitespace, `>` or `/` (so `<svgx` is not SVG).
  return (
    bytes.length >= i + 5 &&
    equalsAt(bytes, i, '<svg') &&
    [0x20, 0x09, 0x0d, 0x0a, 0x3e, 0x2f].includes(bytes[i + 4])
  )
}

export function detectFormat(bytes: Uint8Array): DetectedFormat {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0x42, 0x4d])) return 'bmp' // "BM"
  if (equalsAt(bytes, 0, 'GIF87a') || equalsAt(bytes, 0, 'GIF89a')) return 'gif'
  if (
    startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return 'tiff'
  }
  // RIFF....WEBP
  if (bytes.length >= 12 && equalsAt(bytes, 0, 'RIFF') && equalsAt(bytes, 8, 'WEBP')) {
    return 'webp'
  }
  // AVIF / HEIC / HEIF: ftyp box — brand at offset 8.
  if (bytes.length >= 12 && equalsAt(bytes, 4, 'ftyp')) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (brand === 'avif' || brand === 'avis') return 'avif'
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx') {
      return 'heic'
    }
    if (brand === 'mif1' || brand === 'msf1' || brand === 'heif') return 'heif'
  }
  // JPEG XL: 0xFF 0A or the "JXL " container box.
  if (startsWith(bytes, [0xff, 0x0a])) return 'jxl'
  if (
    startsWith(bytes, [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])
  ) {
    return 'jxl'
  }
  // JPEG 2000: 00 00 00 0C 6A 50 20 20 ("jP  " box).
  if (startsWith(bytes, [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20])) {
    return 'jpeg2000'
  }
  if (startsWith(bytes, [0x71, 0x6f, 0x69, 0x66])) return 'qoi' // "qoif"
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return 'ico'
  // PNM: P1..P7 (P7 is PAM, which image-rs writes for RGBA).
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] >= 0x31 && bytes[1] <= 0x37) {
    return 'pnm'
  }
  if (startsWith(bytes, [0x76, 0x2f, 0x31, 0x01])) return 'exr' // "v/1\x01"
  if (startsWith(bytes, [0x23, 0x3f, 0x52, 0x41, 0x44, 0x49, 0x41, 0x4e, 0x43, 0x45])) {
    return 'hdr' // "#?RADIANCE"
  }
  if (startsWith(bytes, [0x23, 0x3f, 0x52, 0x47, 0x42, 0x45])) return 'hdr' // "#?RGBE"
  // TGA has no magic bytes — strict 18-byte header validation, as in Rust.
  if (
    bytes.length >= 18 &&
    bytes[1] <= 1 &&
    [1, 2, 3, 9, 10, 11].includes(bytes[2]) &&
    [8, 16, 24, 32].includes(bytes[16])
  ) {
    const w = bytes[12] | (bytes[13] << 8)
    const h = bytes[14] | (bytes[15] << 8)
    if (w > 0 && h > 0) return 'tga'
  }
  if (isSvg(bytes)) return 'svg'
  return 'unknown'
}

/** Detect the format of the first bytes of a File/Blob (reads ≤ 64 KiB). */
export async function detectFileFormat(file: Blob): Promise<DetectedFormat> {
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer())
  return detectFormat(head)
}
