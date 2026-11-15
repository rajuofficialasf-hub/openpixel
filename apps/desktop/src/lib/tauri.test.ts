import { describe, expect, it } from 'vitest'
import {
  decodableExtensions,
  defaultOutputPath,
  dirName,
  encodableFormats,
  fileName,
  formatBytes,
  formatLabel,
  primaryExtension,
  type FormatCapability,
} from './tauri'

function cap(id: string, overrides: Partial<FormatCapability> = {}): FormatCapability {
  return {
    format_id: id,
    extensions: [id],
    mime_types: [`image/${id}`],
    can_decode: true,
    can_encode: true,
    supports_alpha: true,
    supports_animation: false,
    supports_metadata: false,
    supports_icc: false,
    supports_multiple_frames: false,
    native_dependency: '',
    license: 'MIT OR Apache-2.0',
    status: 'implemented',
    max_dimension: 16384,
    ...overrides,
  }
}

// A small stand-in for the 21-format registry the backend returns.
const CAPS: FormatCapability[] = [
  cap('jpeg', { extensions: ['jpg', 'jpeg'] }),
  cap('png'),
  cap('webp'),
  cap('svg', { can_encode: false }),
  cap('heic', { can_decode: false, can_encode: false, status: 'planned — detection only' }),
]

describe('format helpers (same rules as the engine registry)', () => {
  it('encodableFormats excludes decode-only and planned formats', () => {
    const ids = encodableFormats(CAPS).map((c) => c.format_id)
    expect(ids).toEqual(['jpeg', 'png', 'webp'])
  })

  it('decodableExtensions collects every decodable extension, sorted and de-duplicated', () => {
    expect(decodableExtensions(CAPS)).toEqual(['jpeg', 'jpg', 'png', 'svg', 'webp'])
  })

  it('primaryExtension returns the first extension', () => {
    expect(primaryExtension(CAPS, 'jpeg')).toBe('jpg')
    expect(primaryExtension(CAPS, 'png')).toBe('png')
    expect(primaryExtension(CAPS, 'missing')).toBe('missing')
  })

  it('formatLabel shows the id and extensions', () => {
    expect(formatLabel(CAPS, 'jpeg')).toBe('JPEG (.jpg, .jpeg)')
    expect(formatLabel(CAPS, 'missing')).toBe('MISSING')
  })

  it('defaultOutputPath keeps folder and stem, swaps the extension', () => {
    expect(defaultOutputPath('/home/raju/photo.png', 'jpeg', CAPS)).toBe('/home/raju/photo.jpg')
    expect(defaultOutputPath('C:\\Users\\raju\\photo.tiff', 'webp', CAPS)).toBe(
      'C:\\Users\\raju\\photo.webp',
    )
    expect(defaultOutputPath('/home/raju/noext', 'png', CAPS)).toBe('/home/raju/noext.png')
    expect(defaultOutputPath('/home/raju/a.b.c.png', 'png', CAPS)).toBe('/home/raju/a.b.c.png')
  })

  it('fileName and dirName split either separator', () => {
    expect(fileName('/a/b/c.png')).toBe('c.png')
    expect(fileName('C:\\a\\b.png')).toBe('b.png')
    expect(dirName('/a/b/c.png')).toBe('/a/b')
    expect(dirName('plain.png')).toBe('')
  })

  it('formatBytes formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KiB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MiB')
  })
})
