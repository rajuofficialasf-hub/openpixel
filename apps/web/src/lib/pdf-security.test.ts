import { describe, expect, it } from 'vitest'
import { buildSamplePdfBytes } from './samples'
import { inspectPdfEncryption, PdfSecurityError, protectPdf, unlockPdf } from './pdf-security'

describe('pdf-security (AES-256 protect & unlock round-trip)', () => {
  it('encrypts a PDF with AES-256, rejects wrong password, and unlocks with the right password', async () => {
    const raw = buildSamplePdfBytes()
    const before = await inspectPdfEncryption(raw)
    expect(before.encrypted).toBe(false)
    expect(before.pageCount).toBe(2)

    const protectedRes = await protectPdf(raw, {
      userPassword: 'openpixel-2026',
      algorithm: 'AES-256',
      allowPrint: true,
      allowCopy: false,
      allowModify: false,
    })
    expect(protectedRes.pageCount).toBe(2)
    expect(protectedRes.algorithm).toBe('AES-256')

    const mid = await inspectPdfEncryption(protectedRes.data)
    expect(mid.encrypted).toBe(true)

    await expect(unlockPdf(protectedRes.data, 'wrong-pass')).rejects.toThrow(PdfSecurityError)

    const unlocked = await unlockPdf(protectedRes.data, 'openpixel-2026')
    expect(unlocked.pageCount).toBe(2)

    const after = await inspectPdfEncryption(unlocked.data)
    expect(after.encrypted).toBe(false)
    expect(after.pageCount).toBe(2)
  })

  it('rejects unlocking an already-unencrypted PDF cleanly', async () => {
    const raw = buildSamplePdfBytes()
    await expect(unlockPdf(raw, 'anything')).rejects.toMatchObject({ code: 'not-encrypted' })
  })
})
