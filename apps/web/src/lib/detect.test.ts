import { describe, expect, it } from 'vitest'
import { detectFormat } from './detect'

function bytes(...values: (number | string)[]): Uint8Array {
  const out: number[] = []
  for (const v of values) {
    if (typeof v === 'string') {
      for (let i = 0; i < v.length; i++) out.push(v.charCodeAt(i))
    } else {
      out.push(v)
    }
  }
  return new Uint8Array(out)
}

describe('detectFormat — mirrors the Rust detector (crates/openpixel-formats/src/format.rs)', () => {
  it('detects JPEG/PNG/BMP/GIF/TIFF/WebP', () => {
    expect(detectFormat(bytes(0xff, 0xd8, 0xff, 0xe0, 'xxxx'))).toBe('jpeg')
    expect(detectFormat(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 'xxxx'))).toBe('png')
    expect(detectFormat(bytes('BMxxxx'))).toBe('bmp')
    expect(detectFormat(bytes('GIF89axxxx'))).toBe('gif')
    expect(detectFormat(bytes('GIF87axxxx'))).toBe('gif')
    expect(detectFormat(bytes('II*\0xxxx'))).toBe('tiff')
    expect(detectFormat(bytes('MM\0*xxxx'))).toBe('tiff')
    expect(detectFormat(bytes('RIFF', 0, 0, 0, 0, 'WEBPxxxx'))).toBe('webp')
  })

  it('detects AVIF/HEIC/HEIF by ftyp brand, QOI, ICO, JXL', () => {
    expect(detectFormat(bytes(0, 0, 0, 0x18, 'ftypavifxxxx'))).toBe('avif')
    expect(detectFormat(bytes(0, 0, 0, 0x18, 'ftypavisxxxx'))).toBe('avif')
    expect(detectFormat(bytes(0, 0, 0, 0x18, 'ftypheicxxxx'))).toBe('heic')
    expect(detectFormat(bytes(0, 0, 0, 0x18, 'ftypmif1xxxx'))).toBe('heif')
    expect(detectFormat(bytes('qoifxxxx'))).toBe('qoi')
    expect(detectFormat(bytes(0, 0, 1, 0, 'xxxx'))).toBe('ico')
    expect(detectFormat(bytes(0xff, 0x0a, 'xxxx'))).toBe('jxl')
  })

  it('detects JPEG 2000, PNM, EXR, HDR', () => {
    expect(detectFormat(bytes(0, 0, 0, 0x0c, 'jP  xxxx'))).toBe('jpeg2000')
    expect(detectFormat(bytes('P6\nxxxx'))).toBe('pnm')
    expect(detectFormat(bytes('P7\nxxxx'))).toBe('pnm')
    expect(detectFormat(bytes('v/1', 1, 'xxxx'))).toBe('exr')
    expect(detectFormat(bytes('#?RADIANCE\nxxxx'))).toBe('hdr')
    expect(detectFormat(bytes('#?RGBE\nxxxx'))).toBe('hdr')
  })

  it('detects TGA only for a valid 18-byte header', () => {
    // id-len 0, colour-map 0, type 2 (true-colour), w=4, h=4, depth 24.
    const valid = new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 4, 0, 24, 0])
    expect(detectFormat(valid)).toBe('tga')
    // Same bytes with an impossible depth are not TGA.
    const badDepth = new Uint8Array(valid)
    badDepth[16] = 7
    expect(detectFormat(badDepth)).toBe('unknown')
  })

  it('detects SVG only at the start of the file, never buried in HTML', () => {
    expect(detectFormat(bytes('<svg xmlns="x">'))).toBe('svg')
    expect(detectFormat(bytes(0xef, 0xbb, 0xbf, '<?xml version="1.0"?><svg>'))).toBe('svg')
    expect(detectFormat(bytes('<html><body><svg>'))).toBe('unknown')
    expect(detectFormat(bytes('<svgx>'))).toBe('unknown')
  })

  it('returns unknown for random, empty and truncated input', () => {
    expect(detectFormat(bytes('hello world, not an image'))).toBe('unknown')
    expect(detectFormat(new Uint8Array([]))).toBe('unknown')
    expect(detectFormat(bytes(0xff, 0xd8))).toBe('unknown')
  })

  it('never trusts the extension — a PNG is a PNG whatever it is called', () => {
    // The detector only sees bytes; the caller never passes a filename.
    expect(detectFormat(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png')
  })
})
