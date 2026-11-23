import { describe, expect, it } from 'vitest'
import { buildWatermarkOps, strokesToDrawOps } from './signature'

describe('strokesToDrawOps', () => {
  it('maps normalized strokes into PDF coordinates with Y flipped', () => {
    const ops = strokesToDrawOps(
      [[[0, 0], [1, 1]]],
      { page: 2, x: 100, y: 200, width: 100, height: 100 },
      { r: 0, g: 0, b: 0 },
      2,
    )
    expect(ops).toHaveLength(1)
    expect(ops[0]).toEqual({
      kind: 'draw',
      page: 2,
      color: { r: 0, g: 0, b: 0 },
      width: 2,
      points: [
        [100, 300],
        [200, 200],
      ],
    })
  })

  it('ignores single-point taps and empty stroke lists', () => {
    expect(
      strokesToDrawOps([[[0.5, 0.5]]], { page: 1, x: 0, y: 0, width: 120, height: 50 }, { r: 0, g: 0, b: 0 }, 2),
    ).toEqual([])
  })

  it('preserves aspect ratio when tightening a wide stroke into a square box', () => {
    const ops = strokesToDrawOps(
      [[[0.1, 0.4], [0.9, 0.6]]],
      { page: 1, x: 0, y: 0, width: 160, height: 160 },
      { r: 0.1, g: 0.2, b: 0.8 },
      1.8,
    )
    expect(ops).toHaveLength(1)
    if (ops[0].kind !== 'draw') throw new Error('expected draw op')
    // spanX = 0.8, spanY = 0.2 -> scale = 200 -> usedW = 160, usedH = 40, centered vertically in [60..100]
    expect(ops[0].points[0]).toEqual([0, 100])
    expect(ops[0].points[1]).toEqual([160, 60])
  })
})

describe('buildWatermarkOps', () => {
  it('generates one centered bold text op per page', () => {
    const ops = buildWatermarkOps(
      3,
      [[600, 800], [600, 800], [600, 800]],
      { text: 'CONFIDENTIAL', size: 36, color: { r: 0.7, g: 0.7, b: 0.7 }, position: 'center', pages: null },
    )
    expect(ops).toHaveLength(3)
    expect(ops[0].kind).toBe('text')
    if (ops[0].kind === 'text') {
      expect(ops[0].page).toBe(1)
      expect(ops[0].font).toBe('helvetica_bold')
      expect(ops[0].y).toBe(382)
    }
  })

  it('returns empty for blank watermark text', () => {
    expect(
      buildWatermarkOps(2, undefined, { text: '   ', size: 24, color: { r: 0.5, g: 0.5, b: 0.5 }, position: 'top', pages: null }),
    ).toEqual([])
  })
})
