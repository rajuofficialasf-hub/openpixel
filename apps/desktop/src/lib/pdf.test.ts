import { describe, expect, it } from 'vitest'
import { clampPages, parsePageList, parseRanges } from './tauri'

describe('PDF page-list helpers', () => {
  it('parsePageList handles singles, ranges and whitespace', () => {
    expect(parsePageList('')).toBeNull()
    expect(parsePageList('  ')).toBeNull()
    expect(parsePageList('1')).toEqual([1])
    expect(parsePageList('1, 3-5, 8')).toEqual([1, 3, 4, 5, 8])
    expect(parsePageList('2-2')).toEqual([2])
  })

  it('parsePageList rejects bad tokens and reversed ranges', () => {
    expect(() => parsePageList('0')).toThrow()
    expect(() => parsePageList('5-3')).toThrow()
    expect(() => parsePageList('abc')).toThrow()
    expect(() => parsePageList('1,,2')).toThrow()
  })

  it('parseRanges splits into inclusive ranges', () => {
    expect(parseRanges('1-2, 3-5')).toEqual([
      [1, 2],
      [3, 5],
    ])
    expect(parseRanges('4')).toEqual([[4, 4]])
    expect(() => parseRanges('')).toThrow()
    expect(() => parseRanges('3-2')).toThrow()
    expect(() => parseRanges('x-y')).toThrow()
  })

  it('clampPages drops out-of-range pages', () => {
    expect(clampPages([0, 1, 3, 9], 4)).toEqual([1, 3])
    expect(clampPages([], 4)).toEqual([])
  })
})
