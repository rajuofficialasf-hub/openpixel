/**
 * Tests for the browser-OCR helpers (`ocr.ts`).
 *
 * Only the pure functions are tested here — language/PSM parsing
 * and result shaping. A real recognition needs the tesseract.js
 * worker, the self-hosted core and language data in a real
 * browser, so that is covered by the browser e2e suite
 * (`apps/web/e2e/ocr-e2e.mjs`), not here.
 */
import { describe, expect, it } from 'vitest'
import {
  countWords,
  formatConfidence,
  formatDurationMs,
  ocrOutputName,
  psmValueFor,
  resolveOcrLanguages,
  shapeOcrResult,
  OCR_ENGINE_LABEL,
  OCR_LANGUAGES,
  OCR_PSM_MODES,
} from './ocr'

describe('resolveOcrLanguages', () => {
  it('accepts exactly the picker values', () => {
    expect(resolveOcrLanguages('eng')).toBe('eng')
    expect(resolveOcrLanguages('ben')).toBe('ben')
    expect(resolveOcrLanguages('eng+ben')).toBe('eng+ben')
  })

  it('rejects anything else instead of passing it to the engine', () => {
    expect(resolveOcrLanguages('')).toBeNull()
    expect(resolveOcrLanguages('fra')).toBeNull()
    expect(resolveOcrLanguages('eng+ben+fra')).toBeNull()
    expect(resolveOcrLanguages('ENG')).toBeNull()
  })

  it('offers exactly the three shipped languages', () => {
    expect(OCR_LANGUAGES).toEqual(['eng', 'ben', 'eng+ben'])
  })
})

describe('psmValueFor', () => {
  it('maps the picker to tessedit_pageseg_mode 3/6/7', () => {
    expect(psmValueFor('auto')).toBe('3')
    expect(psmValueFor('single-block')).toBe('6')
    expect(psmValueFor('single-line')).toBe('7')
  })

  it('offers exactly the three modes', () => {
    expect(OCR_PSM_MODES.map((m) => m.id)).toEqual(['auto', 'single-block', 'single-line'])
    expect(OCR_PSM_MODES.map((m) => m.psm)).toEqual(['3', '6', '7'])
  })
})

describe('countWords / formatConfidence / formatDurationMs', () => {
  it('counts words across lines and extra whitespace', () => {
    expect(countWords('The quick brown fox')).toBe(4)
    expect(countWords('one\ntwo  three\n\nfour')).toBe(4)
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
    expect(countWords('আমি ঢাকায় থাকি।')).toBe(3)
  })

  it('formats confidence with one decimal and a percent sign', () => {
    expect(formatConfidence(87.36)).toBe('87.4%')
    expect(formatConfidence(100)).toBe('100.0%')
    expect(formatConfidence(0)).toBe('0.0%')
  })

  it('formats durations in seconds with one decimal', () => {
    expect(formatDurationMs(3200)).toBe('3.2 s')
    expect(formatDurationMs(1500)).toBe('1.5 s')
    expect(formatDurationMs(0)).toBe('0.0 s')
  })
})

describe('ocrOutputName', () => {
  it('replaces the extension with -ocr.txt', () => {
    expect(ocrOutputName('scan.png')).toBe('scan-ocr.txt')
    expect(ocrOutputName('photo.JPEG')).toBe('photo-ocr.txt')
    expect(ocrOutputName('notes')).toBe('notes-ocr.txt')
    expect(ocrOutputName('my.scan.png')).toBe('my.scan-ocr.txt')
  })
})

describe('shapeOcrResult', () => {
  it('shapes a raw page into the result the UI shows', () => {
    const result = shapeOcrResult(
      { text: 'The quick brown fox\n', confidence: 92.5 },
      'eng',
      'auto',
      3200,
    )
    expect(result).toEqual({
      text: 'The quick brown fox',
      confidence: 92.5,
      wordCount: 4,
      durationMs: 3200,
      language: 'eng',
      psm: 'auto',
      engine: OCR_ENGINE_LABEL,
    })
  })

  it('trims trailing whitespace and counts Bengali words', () => {
    const result = shapeOcrResult({ text: 'আমি ঢাকায় থাকি।\n\n', confidence: 88 }, 'ben', 'single-line', 1500)
    expect(result.text).toBe('আমি ঢাকায় থাকি।')
    expect(result.wordCount).toBe(3)
  })

  it('labels the engine as the browser engine, never the native one', () => {
    expect(OCR_ENGINE_LABEL).toBe('tesseract.js (browser)')
    const result = shapeOcrResult({ text: 'x', confidence: 50 }, 'eng+ben', 'auto', 100)
    expect(result.engine).toBe('tesseract.js (browser)')
  })
})
