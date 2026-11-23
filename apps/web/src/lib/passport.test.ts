import { describe, expect, it } from 'vitest'
import { computeCoverCrop, PASSPORT_PRESETS } from './passport'

describe('passport presets & crop math', () => {
  it('includes Teletalk 300x300 (<100KB) and Signature 300x80 (<60KB)', () => {
    const photo = PASSPORT_PRESETS.find((p) => p.id === 'teletalk-photo')
    const sig = PASSPORT_PRESETS.find((p) => p.id === 'teletalk-sig')
    expect(photo).toMatchObject({ width: 300, height: 300, maxKb: 100 })
    expect(sig).toMatchObject({ width: 300, height: 80, maxKb: 60, isSignature: true })
  })

  it('centers square cover crop on a landscape image at zoom 1', () => {
    const rect = computeCoverCrop(1200, 800, 300, 300, 1, 0, 0)
    expect(rect).toEqual({ sx: 200, sy: 0, sw: 800, sh: 800 })
  })

  it('zooms and pans within image bounds without overflowing', () => {
    const rect = computeCoverCrop(1000, 1000, 300, 300, 2, 1, -1)
    expect(rect).toEqual({ sx: 500, sy: 0, sw: 500, sh: 500 })
  })
})
