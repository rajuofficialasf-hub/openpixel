import { describe, expect, it } from 'vitest'
import {
  BROWSER_DECODABLE,
  BROWSER_ENCODABLE,
  browserEncodableFormats,
  CAPABILITIES,
  canvasMimeType,
  cliOnlyEncodableFormats,
  encodableFormats,
  formatById,
  formatLabel,
  outputFileName,
  primaryExtension,
  targetHasNoAlpha,
} from './capabilities'

describe('capabilities — generated from the engine, never hand-written', () => {
  it('lists 21 formats, mirroring `openpixel --json formats`', () => {
    expect(CAPABILITIES).toHaveLength(21)
    const ids = CAPABILITIES.map((c) => c.format_id)
    expect(ids).toContain('jpeg')
    expect(ids).toContain('heic')
    expect(ids).toContain('psd')
    // No format may claim to encode while the engine says it cannot.
    for (const cap of CAPABILITIES) {
      expect(typeof cap.can_decode).toBe('boolean')
      expect(typeof cap.can_encode).toBe('boolean')
      expect(cap.extensions.length).toBeGreaterThan(0)
    }
  })

  it('marks the planned formats as not decodable/encodable', () => {
    // HEIC/HEIF left this list in follow-up item 1 (16 Nov 2026):
    // pure-Rust heifer implements them now. What remains planned
    // is APNG, RAW and PSD.
    for (const id of ['apng', 'raw', 'psd']) {
      const cap = formatById(id)
      expect(cap).toBeDefined()
      expect(cap?.can_decode).toBe(false)
      expect(cap?.can_encode).toBe(false)
    }
  })

  it('marks HEIC/HEIF as implemented (follow-up item 1)', () => {
    for (const id of ['heic', 'heif']) {
      expect(formatById(id)?.can_decode).toBe(true)
      expect(formatById(id)?.can_encode).toBe(true)
    }
  })

  it('marks SVG as decode-only (rasterise, never encode)', () => {
    const svg = formatById('svg')
    expect(svg?.can_decode).toBe(true)
    expect(svg?.can_encode).toBe(false)
  })

  it('marks the 18 engine-implemented formats as decodable', () => {
    const implemented = [
      'jpeg',
      'png',
      'bmp',
      'gif',
      'tiff',
      'webp',
      'tga',
      'ico',
      'pnm',
      'qoi',
      'svg',
      'avif',
      'jxl',
      'hdr',
      'exr',
      'jpeg2000',
      // HEIC/HEIF implemented by follow-up item 1 (16 Nov 2026).
      'heic',
      'heif',
    ]
    for (const id of implemented) {
      expect(formatById(id)?.can_decode).toBe(true)
    }
  })
})

describe('browser conversion options — generated from the capability data', () => {
  it('only offers engine-encodable formats as outputs', () => {
    for (const cap of encodableFormats()) {
      expect(cap.can_encode).toBe(true)
    }
    expect(encodableFormats().map((c) => c.format_id)).not.toContain('svg')
    // HEIC *is* engine-encodable since follow-up item 1 — the
    // browser just cannot encode it, which is what
    // `browserEncodableFormats()` (not this list) expresses.
  })

  it('browser-encodable targets are a subset of engine-encodable ones', () => {
    const browser = browserEncodableFormats().map((c) => c.format_id)
    expect([...browser].sort()).toEqual(['bmp', 'jpeg', 'png', 'webp'])
    for (const id of browser) {
      expect(BROWSER_ENCODABLE).toContain(id)
      expect(canvasMimeType(id)).toBeDefined()
    }
  })

  it('CLI-only encodable formats are exactly the ones the browser cannot encode', () => {
    const cliOnly = cliOnlyEncodableFormats().map((c) => c.format_id)
    expect(cliOnly).toContain('tiff')
    expect(cliOnly).toContain('avif')
    expect(cliOnly).toContain('jxl')
    for (const id of cliOnly) {
      expect(canvasMimeType(id)).toBeUndefined()
    }
    // Browser + CLI-only partitions the encodable set with no overlap.
    const browser = new Set(browserEncodableFormats().map((c) => c.format_id))
    expect(cliOnly.some((id) => browser.has(id))).toBe(false)
    expect(browser.size + cliOnly.length).toBe(encodableFormats().length)
  })

  it('browser-decodable sources are all engine-decodable', () => {
    for (const id of BROWSER_DECODABLE) {
      expect(formatById(id)?.can_decode).toBe(true)
    }
  })

  it('JPEG/BMP flatten alpha; PNG/WebP keep it', () => {
    expect(targetHasNoAlpha('jpeg')).toBe(true)
    expect(targetHasNoAlpha('bmp')).toBe(true)
    expect(targetHasNoAlpha('png')).toBe(false)
    expect(targetHasNoAlpha('webp')).toBe(false)
  })

  it('builds output filenames and labels from the capability data', () => {
    expect(primaryExtension('jpeg')).toBe('jpg')
    expect(primaryExtension('tiff')).toBe('tif')
    expect(outputFileName('photo.png', 'webp')).toBe('photo.webp')
    expect(outputFileName('archive.tar.png', 'jpeg')).toBe('archive.tar.jpg')
    expect(formatLabel('jpeg')).toBe('JPEG (.jpg)')
    expect(formatLabel('jpeg2000')).toBe('JPEG 2000 (.jp2)')
  })
})
