import { describe, expect, it } from 'vitest'
import {
  hexToRgbTuple,
  removeBackgroundByColorPixels,
  rgbToHex,
  sampleCornerColor,
} from './bg-remove'

function makePixels(w: number, h: number, fill: [number, number, number, number]): Uint8ClampedArray {
  const arr = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    arr[i * 4] = fill[0]
    arr[i * 4 + 1] = fill[1]
    arr[i * 4 + 2] = fill[2]
    arr[i * 4 + 3] = fill[3]
  }
  return arr
}

function setPx(arr: Uint8ClampedArray, w: number, x: number, y: number, rgba: [number, number, number, number]) {
  const off = (y * w + x) * 4
  arr[off] = rgba[0]
  arr[off + 1] = rgba[1]
  arr[off + 2] = rgba[2]
  arr[off + 3] = rgba[3]
}

describe('bg-remove color helpers', () => {
  it('round-trips RGB and hex', () => {
    expect(rgbToHex([49, 87, 213])).toBe('#3157d5')
    expect(hexToRgbTuple('#3157d5')).toEqual([49, 87, 213])
    expect(hexToRgbTuple('invalid')).toBeNull()
  })

  it('samples corner backdrop color accurately', () => {
    const px = makePixels(4, 4, [240, 245, 255, 255])
    setPx(px, 4, 2, 2, [10, 20, 30, 255])
    expect(sampleCornerColor(px, 4, 4)).toEqual([240, 245, 255])
  })

  it('contiguous flood-fill removes outer white backdrop while protecting enclosed white center', () => {
    // 5x5 image: white background, 3x3 black square in middle (1..3), white pixel at center (2,2)
    const px = makePixels(5, 5, [255, 255, 255, 255])
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        setPx(px, 5, x, y, [0, 0, 0, 255])
      }
    }
    setPx(px, 5, 2, 2, [255, 255, 255, 255])

    const contiguous = removeBackgroundByColorPixels(px, 5, 5, {
      targetColor: [255, 255, 255],
      tolerance: 15,
      feather: 0,
      contiguous: true,
    })
    // Outer corner removed
    expect(contiguous[3]).toBe(0)
    // Black border kept
    expect(contiguous[(1 * 5 + 1) * 4 + 3]).toBe(255)
    // Enclosed white center PROTECTED!
    expect(contiguous[(2 * 5 + 2) * 4 + 3]).toBe(255)

    // Global mode removes BOTH outer backdrop AND enclosed white center
    const globalOut = removeBackgroundByColorPixels(px, 5, 5, {
      targetColor: [255, 255, 255],
      tolerance: 15,
      feather: 0,
      contiguous: false,
    })
    expect(globalOut[3]).toBe(0)
    expect(globalOut[(2 * 5 + 2) * 4 + 3]).toBe(0)
  })
})
