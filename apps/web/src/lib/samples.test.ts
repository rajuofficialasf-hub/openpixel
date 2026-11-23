import { describe, expect, it } from 'vitest'
import { buildSamplePdfBytes, createSamplePdfFile } from './samples'

describe('buildSamplePdfBytes', () => {
  it('produces a valid 2-page PDF 1.4 with accurate xref offsets', () => {
    const bytes = buildSamplePdfBytes()
    const text = new TextDecoder().decode(bytes)
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text.includes('/Count 2')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)

    const startxrefMatch = /startxref\n(\d+)\n%%EOF/.exec(text)
    expect(startxrefMatch).not.toBeNull()
    const xrefOffset = Number(startxrefMatch![1])
    expect(new TextDecoder().decode(bytes.slice(xrefOffset, xrefOffset + 4))).toBe('xref')
  })

  it('wraps sample bytes in a named application/pdf File', () => {
    const file = createSamplePdfFile()
    expect(file.name).toBe('openpixel-sample.pdf')
    expect(file.type).toBe('application/pdf')
    expect(file.size).toBeGreaterThan(500)
  })
})
