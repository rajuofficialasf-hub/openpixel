import { describe, expect, it } from 'vitest'
import { probeImage, ProbeError } from './convert'

function blobOf(...values: number[]): Blob {
  return new Blob([new Uint8Array(values)])
}

// In the node test environment there is no createImageBitmap / Image
// and no WASM module, so every probe fails at decode — exactly the
// no-WASM browser situation the ProbeError fix is about.
describe('probeImage — a failed probe keeps the sniffed format', () => {
  it('a TIFF blob rejects with a ProbeError carrying format "tiff"', async () => {
    const file = blobOf(0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0) // "II*\0" — TIFF
    await expect(probeImage(file)).rejects.toMatchObject({ format: 'tiff' })
    try {
      await probeImage(file)
      expect.unreachable('probeImage should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ProbeError)
      expect((err as ProbeError).format).toBe('tiff')
      expect((err as Error).message).toMatch(/native CLI/)
    }
  })

  it('a PNG blob rejects with a ProbeError carrying format "png"', async () => {
    const file = blobOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    await expect(probeImage(file)).rejects.toMatchObject({ format: 'png' })
  })

  it('unrecognised bytes reject with a ProbeError carrying format "unknown"', async () => {
    const file = blobOf(1, 2, 3, 4, 5, 6, 7, 8)
    await expect(probeImage(file)).rejects.toMatchObject({ format: 'unknown' })
  })

  it('ProbeError is an Error with the honest cannot-decode message', () => {
    const err = new ProbeError('tiff')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ProbeError')
    expect(err.message).toBe('This browser cannot decode this image. Try the native CLI instead.')
    // No "Conversion failed" anywhere — nothing was attempted.
    expect(err.message).not.toMatch(/Conversion failed/)
  })
})
