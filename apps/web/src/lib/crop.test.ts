import { describe, expect, it } from 'vitest'
import {
  centeredAspectRect,
  clampNormRect,
  normToPixelRect,
  rotatedDimensions,
  rotateStep,
} from './crop'

describe('crop & rotate math', () => {
  it('swaps dimensions on 90 and 270 degree rotations', () => {
    expect(rotatedDimensions(1200, 800, 0)).toEqual({ width: 1200, height: 800 })
    expect(rotatedDimensions(1200, 800, 90)).toEqual({ width: 800, height: 1200 })
    expect(rotatedDimensions(1200, 800, 180)).toEqual({ width: 1200, height: 800 })
    expect(rotatedDimensions(1200, 800, 270)).toEqual({ width: 800, height: 1200 })
  })

  it('steps rotation cleanly around 360 degrees', () => {
    expect(rotateStep(0, 90)).toBe(90)
    expect(rotateStep(270, 90)).toBe(0)
    expect(rotateStep(0, -90)).toBe(270)
    expect(rotateStep(90, -90)).toBe(0)
  })

  it('clamps normalized rectangles strictly within [0..1]', () => {
    expect(clampNormRect({ x: -0.2, y: 0.9, w: 0.5, h: 0.5 })).toEqual({
      x: 0,
      y: 0.5,
      w: 0.5,
      h: 0.5,
    })
    expect(clampNormRect({ x: 0.5, y: 0.5, w: 0.001, h: 2 })).toEqual({
      x: 0.5,
      y: 0,
      w: 0.05,
      h: 1,
    })
  })

  it('computes centred aspect-ratio boxes accurately', () => {
    // 1600×800 (2:1) cropped to 1:1 → width 0.5 centred at x=0.25, full height
    const sq = centeredAspectRect(1600, 800, 1)
    expect(sq.x).toBeCloseTo(0.25)
    expect(sq.y).toBeCloseTo(0)
    expect(sq.w).toBeCloseTo(0.5)
    expect(sq.h).toBeCloseTo(1)

    // 800×1600 (1:2) cropped to 1:1 → height 0.5 centred at y=0.25, full width
    const sqTall = centeredAspectRect(800, 1600, 1)
    expect(sqTall.x).toBeCloseTo(0)
    expect(sqTall.y).toBeCloseTo(0.25)
    expect(sqTall.w).toBeCloseTo(1)
    expect(sqTall.h).toBeCloseTo(0.5)

    // Free aspect returns full frame
    expect(centeredAspectRect(1000, 500, null)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('maps normalized crop rectangles to exact pixel bounds', () => {
    expect(normToPixelRect({ x: 0.25, y: 0.1, w: 0.5, h: 0.5 }, 1000, 800)).toEqual({
      x: 250,
      y: 80,
      width: 500,
      height: 400,
    })
  })
})
