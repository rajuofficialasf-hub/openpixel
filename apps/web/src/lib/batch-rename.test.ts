import { describe, expect, it } from 'vitest'
import { formatBatchOutputName } from './batch-rename'

describe('formatBatchOutputName', () => {
  it('keeps default outputFileName when no rename options are set', () => {
    expect(formatBatchOutputName('vacation.png', 'webp', 0)).toBe('vacation.webp')
  })

  it('applies prefix and suffix around the stem', () => {
    expect(
      formatBatchOutputName('photo.jpg', 'webp', 0, { prefix: 'web-', suffix: '-small' }),
    ).toBe('web-photo-small.webp')
  })

  it('expands {name} and zero-padded {n} in custom patterns', () => {
    expect(
      formatBatchOutputName('IMG_1234.png', 'jpeg', 0, { pattern: 'product-{n}' }),
    ).toBe('product-01.jpg')
    expect(
      formatBatchOutputName('IMG_1234.png', 'png', 11, { pattern: '{name}_{n}' }),
    ).toBe('IMG_1234_12.png')
  })

  it('sanitizes unsafe path characters', () => {
    expect(
      formatBatchOutputName('pic.png', 'webp', 0, { prefix: 'a/b:' }),
    ).toBe('a-b-pic.webp')
  })
})
