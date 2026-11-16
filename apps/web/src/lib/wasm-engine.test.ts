/**
 * Tests for the WASM engine loader (`wasm-engine.ts`).
 *
 * The real module is a generated asset (`public/wasm/`) that is not
 * present under vitest, so the loader tests assert the honest
 * fallback: loading resolves to `null`, and both conversion helpers
 * resolve to `null` instead of throwing. The decision helper
 * `wasmCoversConversion` is pure and is tested with a fixed support
 * table matching the real engine's wasm build.
 */
import { describe, expect, it } from 'vitest'
import {
  convertWithWasm,
  getWasmSupport,
  loadWasmEngine,
  mergeFormatLists,
  probeWithWasm,
  wasmCoversConversion,
  type WasmSupport,
} from './wasm-engine'

/** The real wasm build's format lists (AVIF absent — see docs/WEB.md). */
const WASM_SUPPORT: WasmSupport = {
  decode: [
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
    'jxl',
    'hdr',
    'exr',
    'jpeg2000',
    'heic',
    'heif',
  ],
  encode: [
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
    'jxl',
    'hdr',
    'exr',
    'jpeg2000',
    'heic',
    'heif',
  ],
}

describe('wasmCoversConversion', () => {
  it('uses WASM for conversions the canvas cannot do', () => {
    // TIFF source: the browser cannot decode it; the engine can.
    expect(wasmCoversConversion('tiff', 'png', WASM_SUPPORT)).toBe(true)
    // QOI target: the canvas cannot encode it; the engine can.
    expect(wasmCoversConversion('png', 'qoi', WASM_SUPPORT)).toBe(true)
    // HEIC -> JXL: neither end is canvas territory.
    expect(wasmCoversConversion('heic', 'jxl', WASM_SUPPORT)).toBe(true)
  })

  it('leaves canvas conversions on the canvas path', () => {
    expect(wasmCoversConversion('png', 'jpeg', WASM_SUPPORT)).toBe(false)
    expect(wasmCoversConversion('jpeg', 'webp', WASM_SUPPORT)).toBe(false)
    expect(wasmCoversConversion('gif', 'png', WASM_SUPPORT)).toBe(false)
  })

  it('routes BMP targets to WASM — the canvas cannot encode BMP', () => {
    // Regression: canvas.toBlob('image/bmp') silently returns PNG,
    // so a "BMP" download was PNG bytes named .bmp. The engine
    // encodes real BMP, so WASM must claim this conversion.
    expect(wasmCoversConversion('png', 'bmp', WASM_SUPPORT)).toBe(true)
  })

  it('routes SVG sources to WASM — createImageBitmap cannot decode SVG blobs', () => {
    // Regression (16 Nov 2026, live site): every SVG — plain
    // rect+text, viewBox-only, Bengali/Arabic text, foreignObject,
    // embedded or external image — failed in the canvas worker with
    // "The source image could not be decoded", while the <img>
    // preview rendered each one. The WASM engine rasterises SVG
    // with resvg, so SVG goes to WASM even for canvas targets.
    expect(wasmCoversConversion('svg', 'jpeg', WASM_SUPPORT)).toBe(true)
    expect(wasmCoversConversion('svg', 'png', WASM_SUPPORT)).toBe(true)
    expect(wasmCoversConversion('svg', 'webp', WASM_SUPPORT)).toBe(true)
    expect(wasmCoversConversion('svg', 'tiff', WASM_SUPPORT)).toBe(true)
  })

  it('never claims AVIF — it is not in the wasm build', () => {
    expect(wasmCoversConversion('png', 'avif', WASM_SUPPORT)).toBe(false)
    expect(wasmCoversConversion('avif', 'png', WASM_SUPPORT)).toBe(false)
  })

  it('never claims SVG as a target — it is decode-only', () => {
    expect(wasmCoversConversion('png', 'svg', WASM_SUPPORT)).toBe(false)
  })

  it('is false without a loaded engine', () => {
    expect(wasmCoversConversion('tiff', 'png', null)).toBe(false)
  })
})

describe('mergeFormatLists', () => {
  it('unions browser and wasm lists, browser first, deduplicated', () => {
    expect(mergeFormatLists(['png', 'jpeg'], ['jpeg', 'tiff', 'qoi'])).toEqual([
      'png',
      'jpeg',
      'tiff',
      'qoi',
    ])
    expect(mergeFormatLists(['png'], undefined)).toEqual(['png'])
    expect(mergeFormatLists(['png'], [])).toEqual(['png'])
  })
})

describe('loader fallback (no generated package under vitest)', () => {
  it('loadWasmEngine resolves to null instead of throwing', async () => {
    await expect(loadWasmEngine()).resolves.toBeNull()
  })

  it('getWasmSupport resolves to null instead of throwing', async () => {
    await expect(getWasmSupport()).resolves.toBeNull()
  })

  it('convertWithWasm resolves to null instead of throwing', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await expect(convertWithWasm(png, 'jpeg', 80, null)).resolves.toBeNull()
  })

  it('probeWithWasm resolves to null instead of throwing', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await expect(probeWithWasm(png)).resolves.toBeNull()
  })
})
