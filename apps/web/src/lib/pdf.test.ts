/**
 * Tests for the PDF helpers (`pdf.ts`).
 *
 * The page-list / range / reorder parsers are pure and are tested
 * exhaustively here — a bad page number must be rejected before
 * it ever reaches the WASM engine. The WASM wrappers resolve to
 * `null` under vitest (no generated module present), like the
 * image-engine wrappers in `wasm-engine.test.ts`. pdf.js
 * rendering is covered by the browser e2e suite
 * (`apps/web/e2e/pdf-e2e.mjs`), not here — it needs a real
 * canvas and the worker.
 */
import { describe, expect, it } from 'vitest'
import {
  formatPageSize,
  getPdfInfo,
  hexToRgb,
  parsePageList,
  parsePageRanges,
  parseReorder,
  pdfCompress,
  pdfEdit,
  pdfFlatten,
  pdfFromImages,
  pdfInspect,
  pdfMerge,
  pdfOutputName,
  pdfProcess,
  pdfRedact,
  pdfRepair,
  pdfSanitize,
  pdfSetMetadata,
  PDF_COMPRESS_MODES,
} from './pdf'

describe('parsePageList', () => {
  it('parses single pages, lists and ranges', () => {
    expect(parsePageList('1', 5)).toEqual([1])
    expect(parsePageList('1,3', 5)).toEqual([1, 3])
    expect(parsePageList('1-3,5', 5)).toEqual([1, 2, 3, 5])
    expect(parsePageList(' 2 - 4 ', 5)).toEqual([2, 3, 4])
  })

  it('keeps repeats and order (extract allows both)', () => {
    expect(parsePageList('3,1,3', 5)).toEqual([3, 1, 3])
  })

  it('rejects out-of-range, zero, reversed and malformed input', () => {
    expect(parsePageList('', 5)).toBeNull()
    expect(parsePageList('0', 5)).toBeNull()
    expect(parsePageList('6', 5)).toBeNull()
    expect(parsePageList('1-6', 5)).toBeNull()
    expect(parsePageList('3-1', 5)).toBeNull()
    expect(parsePageList('a', 5)).toBeNull()
    expect(parsePageList('1,,2', 5)).toEqual([1, 2])
    expect(parsePageList('1-2-3', 5)).toBeNull()
  })
})

describe('parsePageRanges', () => {
  it('parses ranges and bare pages', () => {
    expect(parsePageRanges('1-3,5-7', 7)).toEqual([
      [1, 3],
      [5, 7],
    ])
    expect(parsePageRanges('2', 7)).toEqual([[2, 2]])
    expect(parsePageRanges('1-2,4', 7)).toEqual([
      [1, 2],
      [4, 4],
    ])
  })

  it('rejects out-of-range and reversed ranges', () => {
    expect(parsePageRanges('', 7)).toBeNull()
    expect(parsePageRanges('0-2', 7)).toBeNull()
    expect(parsePageRanges('5-8', 7)).toBeNull()
    expect(parsePageRanges('4-2', 7)).toBeNull()
    expect(parsePageRanges('x-y', 7)).toBeNull()
  })
})

describe('parseReorder', () => {
  it('accepts a full permutation', () => {
    expect(parseReorder('3,1,2', 3)).toEqual([3, 1, 2])
  })

  it('rejects partial, repeated or out-of-range orders', () => {
    expect(parseReorder('1,2', 3)).toBeNull()
    expect(parseReorder('1,1,2', 3)).toBeNull()
    expect(parseReorder('1,2,4', 3)).toBeNull()
    expect(parseReorder('', 3)).toBeNull()
  })
})

describe('formatPageSize / pdfOutputName', () => {
  it('formats point sizes without trailing decimals', () => {
    expect(formatPageSize([612, 792])).toBe('612 × 792 pt')
    expect(formatPageSize([595.28, 841.89])).toBe('595.3 × 841.9 pt')
  })

  it('builds suffixed output names', () => {
    expect(pdfOutputName('report.pdf', 'rotated')).toBe('report-rotated.pdf')
    expect(pdfOutputName('report.PDF', 'merged')).toBe('report-merged.pdf')
    expect(pdfOutputName('notes', 'split-1')).toBe('notes-split-1.pdf')
  })
})

describe('WASM wrappers fall back to null (no generated package under vitest)', () => {
  const notPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46])

  it('getPdfInfo resolves to null instead of throwing', async () => {
    await expect(getPdfInfo(notPdf)).resolves.toBeNull()
  })

  it('pdfProcess resolves to null instead of throwing', async () => {
    await expect(pdfProcess(notPdf, '{"kind":"reverse"}')).resolves.toBeNull()
  })

  it('pdfMerge resolves to null instead of throwing', async () => {
    await expect(pdfMerge([notPdf, notPdf])).resolves.toBeNull()
  })

  it('pdfFromImages resolves to null instead of throwing', async () => {
    await expect(pdfFromImages([notPdf], null)).resolves.toBeNull()
  })

  it('pdfCompress resolves to null instead of throwing', async () => {
    await expect(pdfCompress(notPdf, 'ebook', false)).resolves.toBeNull()
  })

  it('the Phase 5 wrappers resolve to null instead of throwing', async () => {
    await expect(
      pdfEdit(notPdf, [{ kind: 'text', page: 1, x: 72, y: 700, text: 'Hi', size: 14, color: { r: 0, g: 0, b: 0 }, font: 'helvetica' }], []),
    ).resolves.toBeNull()
    await expect(pdfRedact(notPdf, [{ kind: 'text', page: null, text: 'SECRET' }])).resolves.toBeNull()
    await expect(pdfFlatten(notPdf)).resolves.toBeNull()
    await expect(pdfSetMetadata(notPdf, { title: 'T', author: null, subject: null, keywords: null })).resolves.toBeNull()
    await expect(pdfSanitize(notPdf)).resolves.toBeNull()
    await expect(pdfRepair(notPdf)).resolves.toBeNull()
    await expect(pdfInspect(notPdf)).resolves.toBeNull()
  })

  it('the compress modes are exactly screen/ebook/printer', () => {
    expect(PDF_COMPRESS_MODES).toEqual(['screen', 'ebook', 'printer'])
  })
})

describe('hexToRgb', () => {
  it('parses #RRGGBB into 0..1 channels', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 1, g: 0, b: 0 })
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 })
    expect(hexToRgb('#ffffff')).toEqual({ r: 1, g: 1, b: 1 })
    expect(hexToRgb('ff0000')).toEqual({ r: 1, g: 0, b: 0 })
    expect(hexToRgb('#ffeb3b')).toEqual({ r: 1, g: 235 / 255, b: 59 / 255 })
  })

  it('rejects malformed colours', () => {
    expect(hexToRgb('red')).toBeNull()
    expect(hexToRgb('#12345')).toBeNull()
    expect(hexToRgb('#zzzzzz')).toBeNull()
    expect(hexToRgb('')).toBeNull()
  })
})
