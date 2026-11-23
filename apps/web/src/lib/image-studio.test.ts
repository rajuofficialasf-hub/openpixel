import { describe, expect, it } from 'vitest'
import { buildCssFilter, DEFAULT_FILTERS, parseJpegExif } from './image-studio'

function buildMinimalExifJpeg(make: string, withGps: boolean): Uint8Array {
  const makeBytes = new TextEncoder().encode(`${make}\0`)
  const entriesCount = withGps ? 2 : 1
  const ifdSize = 2 + entriesCount * 12 + 4
  const makeOffset = 8 + ifdSize
  const tiffLen = makeOffset + makeBytes.length
  const segLen = 2 + 6 + tiffLen // length field + "Exif\0\0" + TIFF
  const buf = new Uint8Array(2 + 2 + segLen + 2)
  const view = new DataView(buf.buffer)
  // SOI
  buf[0] = 0xff
  buf[1] = 0xd8
  // APP1
  buf[2] = 0xff
  buf[3] = 0xe1
  view.setUint16(4, segLen, false)
  buf.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6) // Exif\0\0
  const t = 12
  // Little-endian TIFF header
  buf[t] = 0x49
  buf[t + 1] = 0x49
  view.setUint16(t + 2, 42, true)
  view.setUint32(t + 4, 8, true)
  // IFD0
  const ifd = t + 8
  view.setUint16(ifd, entriesCount, true)
  // Entry 0: Make (0x010f), ASCII (2)
  view.setUint16(ifd + 2, 0x010f, true)
  view.setUint16(ifd + 4, 2, true)
  view.setUint32(ifd + 6, makeBytes.length, true)
  view.setUint32(ifd + 10, makeOffset, true)
  if (withGps) {
    // Entry 1: GPS IFD pointer (0x8825)
    view.setUint16(ifd + 14, 0x8825, true)
    view.setUint16(ifd + 16, 4, true)
    view.setUint32(ifd + 18, 1, true)
    view.setUint32(ifd + 22, 0, true)
  }
  buf.set(makeBytes, t + makeOffset)
  // EOI
  buf[buf.length - 2] = 0xff
  buf[buf.length - 1] = 0xd9
  return buf
}

describe('parseJpegExif', () => {
  it('returns empty summary for non-JPEG bytes', () => {
    expect(parseJpegExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47])).hasExif).toBe(false)
  })

  it('extracts camera Make and GPS presence from JPEG APP1 EXIF', () => {
    const jpeg = buildMinimalExifJpeg('Canon', true)
    const parsed = parseJpegExif(jpeg)
    expect(parsed.hasExif).toBe(true)
    expect(parsed.make).toBe('Canon')
    expect(parsed.hasGps).toBe(true)
  })
})

describe('buildCssFilter', () => {
  it('returns none for default filters and composes active sliders', () => {
    expect(buildCssFilter(DEFAULT_FILTERS)).toBe('none')
    expect(buildCssFilter({ ...DEFAULT_FILTERS, brightness: 115, grayscale: 100 })).toBe(
      'brightness(115%) grayscale(100%)',
    )
  })
})
