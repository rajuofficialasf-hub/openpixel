/**
 * Tests for the resize pure logic (`resize.ts`): target-size
 * parsing, aspect-lock math, expected dimensions and the
 * never-upscale clamping. No DOM, no WASM — the engine behaviour
 * itself (Lanczos3, ResizeFit never upscaling, the quality search)
 * is covered by the Rust tests in openpixel-core / openpixel-wasm.
 */
import { describe, expect, it } from 'vitest'
import {
  buildResizeOps,
  clampToSource,
  expectedDimensions,
  isLossyFormat,
  lockedHeight,
  lockedWidth,
  parseTargetSize,
  requestsUpscale,
  targetSizeSupported,
} from './resize'

describe('parseTargetSize', () => {
  it('parses KB/MB/GB and plain bytes', () => {
    expect(parseTargetSize('200 KB')).toBe(200 * 1024)
    expect(parseTargetSize('200KB')).toBe(200 * 1024)
    expect(parseTargetSize('1.5MB')).toBe(Math.round(1.5 * 1024 * 1024))
    expect(parseTargetSize('2GB')).toBe(2 * 1024 ** 3)
    expect(parseTargetSize('51200')).toBe(51200)
    expect(parseTargetSize('200 B')).toBe(200)
    expect(parseTargetSize('  50 kb  ')).toBe(50 * 1024)
  })

  it('rejects invalid input', () => {
    expect(parseTargetSize('')).toBeNull()
    expect(parseTargetSize('   ')).toBeNull()
    expect(parseTargetSize('0 KB')).toBeNull()
    expect(parseTargetSize('-5 KB')).toBeNull()
    expect(parseTargetSize('banana')).toBeNull()
    expect(parseTargetSize('200 XB')).toBeNull()
    expect(parseTargetSize('1.5')).toBeNull() // fractional bytes
    expect(parseTargetSize('200 KB extra')).toBeNull()
  })
})

describe('aspect-lock math', () => {
  it('keeps a 4:3 ratio', () => {
    expect(lockedHeight(800, 1024, 768)).toBe(600)
    expect(lockedWidth(600, 1024, 768)).toBe(800)
    expect(lockedHeight(512, 1024, 768)).toBe(384)
  })

  it('rounds and never returns 0', () => {
    expect(lockedHeight(1, 1024, 768)).toBe(1)
    expect(lockedWidth(1, 1024, 768)).toBe(1)
    expect(lockedHeight(100, 300, 200)).toBe(67) // 66.67 rounds to 67
  })
})

describe('expectedDimensions', () => {
  it('fit preserves aspect and never upscales by default', () => {
    expect(expectedDimensions('fit', 800, 600, 1024, 768, false)).toEqual({ width: 800, height: 600 })
    expect(expectedDimensions('fit', 300, 300, 800, 600, false)).toEqual({ width: 300, height: 225 })
    expect(expectedDimensions('fit', 2000, 2000, 256, 192, false)).toEqual({ width: 256, height: 192 })
    expect(expectedDimensions('fit', 2000, 2000, 256, 192, true)).toEqual({ width: 2000, height: 1500 })
  })

  it('fill and exact are clamped unless upscaling is allowed', () => {
    expect(expectedDimensions('fill', 800, 600, 256, 192, false)).toEqual({ width: 256, height: 192 })
    expect(expectedDimensions('fill', 800, 600, 256, 192, true)).toEqual({ width: 800, height: 600 })
    expect(expectedDimensions('exact', 800, 600, 256, 192, false)).toEqual({ width: 256, height: 192 })
  })

  it('pad always returns the box', () => {
    expect(expectedDimensions('pad', 800, 600, 256, 192, false)).toEqual({ width: 800, height: 600 })
    expect(expectedDimensions('pad', 100, 100, 256, 192, false)).toEqual({ width: 100, height: 100 })
  })
})

describe('buildResizeOps', () => {
  it('fit without upscaling uses resize_fit', () => {
    const { ops, clamped } = buildResizeOps('fit', 800, 600, '#ffffff', false, 1024, 768)
    expect(ops).toEqual([{ kind: 'resize_fit', width: 800, height: 600 }])
    expect(clamped).toBe(false)
  })

  it('fit with upscaling computes fitted dims as an exact resize', () => {
    const { ops } = buildResizeOps('fit', 2000, 2000, '#ffffff', true, 256, 192)
    expect(ops).toEqual([{ kind: 'resize', width: 2000, height: 1500 }])
  })

  it('fill and exact clamp to the source and report it', () => {
    const fill = buildResizeOps('fill', 800, 600, '#ffffff', false, 256, 192)
    expect(fill.ops).toEqual([{ kind: 'resize_fill', width: 256, height: 192 }])
    expect(fill.clamped).toBe(true)
    const exact = buildResizeOps('exact', 800, 600, '#ffffff', false, 1024, 768)
    expect(exact.ops).toEqual([{ kind: 'resize', width: 800, height: 600 }])
    expect(exact.clamped).toBe(false)
  })

  it('pad carries the background colour', () => {
    const { ops } = buildResizeOps('pad', 800, 600, '#000000', false, 256, 192)
    expect(ops).toEqual([{ kind: 'pad', width: 800, height: 600, color: '#000000' }])
  })
})

describe('clampToSource and requestsUpscale', () => {
  it('clamps each side independently', () => {
    expect(clampToSource(800, 100, 256, 192)).toEqual({ width: 256, height: 100 })
  })

  it('pad never requests an upscale', () => {
    expect(requestsUpscale('pad', 2000, 2000, 256, 192)).toBe(false)
    expect(requestsUpscale('fit', 2000, 2000, 256, 192)).toBe(true)
    expect(requestsUpscale('fit', 100, 100, 256, 192)).toBe(false)
    expect(requestsUpscale('exact', 256, 192, 256, 192)).toBe(false)
  })
})

describe('format quality rules', () => {
  it('lossy formats honour quality; WebP and PNG do not', () => {
    expect(isLossyFormat('jpeg')).toBe(true)
    expect(isLossyFormat('heic')).toBe(true)
    expect(isLossyFormat('heif')).toBe(true)
    expect(isLossyFormat('webp')).toBe(false)
    expect(isLossyFormat('png')).toBe(false)
    // Target-size search: lossy + PNG (best compression); not WebP.
    expect(targetSizeSupported('jpeg')).toBe(true)
    expect(targetSizeSupported('png')).toBe(true)
    expect(targetSizeSupported('webp')).toBe(false)
    expect(targetSizeSupported('bmp')).toBe(false)
  })
})
