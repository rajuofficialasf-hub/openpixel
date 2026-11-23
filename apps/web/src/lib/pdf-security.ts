/**
 * 100% local in-browser PDF password protection (AES-256 / AES-128)
 * and PDF decryption/unlock using `@cantoo/pdf-lib`.
 *
 * Lazy-imported on demand so zero bytes are added to initial page load.
 * Preserves 100% original vector text, fonts, and layout (never rasterises).
 */

export type PdfSecurityErrorCode =
  | 'empty-password'
  | 'already-encrypted'
  | 'not-encrypted'
  | 'wrong-password'
  | 'invalid-pdf'

export class PdfSecurityError extends Error {
  readonly code: PdfSecurityErrorCode

  constructor(code: PdfSecurityErrorCode, message: string) {
    super(message)
    this.name = 'PdfSecurityError'
    this.code = code
  }
}

export interface ProtectPdfOptions {
  userPassword: string
  ownerPassword?: string
  algorithm?: 'AES-256' | 'AES-128'
  allowPrint: boolean
  allowCopy: boolean
  allowModify: boolean
}

export interface ProtectPdfResult {
  data: Uint8Array<ArrayBuffer>
  pageCount: number
  algorithm: 'AES-256' | 'AES-128'
}

export interface UnlockPdfResult {
  data: Uint8Array<ArrayBuffer>
  pageCount: number
}

function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes)
}

/**
 * Inspect whether raw PDF bytes are encrypted and how many pages they
 * have (without requiring a password).
 */
export async function inspectPdfEncryption(
  bytes: Uint8Array,
): Promise<{ encrypted: boolean; pageCount: number }> {
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    return { encrypted: doc.isEncrypted, pageCount: doc.getPageCount() }
  } catch {
    throw new PdfSecurityError('invalid-pdf', 'Could not read this file as a valid PDF.')
  }
}

/**
 * Encrypt an unencrypted PDF with AES-256 (ISO 32000-2 default) or
 * AES-128 and the chosen reader permissions.
 */
export async function protectPdf(
  bytes: Uint8Array,
  opts: ProtectPdfOptions,
): Promise<ProtectPdfResult> {
  const userPassword = opts.userPassword
  const ownerPassword = opts.ownerPassword?.trim() ? opts.ownerPassword : userPassword
  if (!userPassword && !ownerPassword) {
    throw new PdfSecurityError('empty-password', 'Enter a password to protect this PDF.')
  }

  const { PDFDocument } = await import('@cantoo/pdf-lib')
  let probe
  try {
    probe = await PDFDocument.load(bytes, { ignoreEncryption: true })
  } catch {
    throw new PdfSecurityError('invalid-pdf', 'Could not read this file as a valid PDF.')
  }
  if (probe.isEncrypted) {
    throw new PdfSecurityError(
      'already-encrypted',
      'This PDF is already password-protected — unlock it first.',
    )
  }

  const doc = await PDFDocument.load(bytes)
  const algorithm = opts.algorithm ?? 'AES-256'
  doc.encrypt({
    userPassword,
    ownerPassword,
    algorithm,
    permissions: {
      printing: opts.allowPrint ? 'highResolution' : false,
      copying: opts.allowCopy,
      modifying: opts.allowModify,
      annotating: opts.allowModify,
      fillingForms: opts.allowModify,
      contentAccessibility: true,
      documentAssembly: opts.allowModify,
    },
  })

  const saved = await doc.save({ useObjectStreams: false })
  return {
    data: toArrayBufferBytes(saved),
    pageCount: doc.getPageCount(),
    algorithm,
  }
}

/**
 * Remove password protection from a PDF using the owner/user password,
 * producing a clean unencrypted vector PDF.
 */
export async function unlockPdf(bytes: Uint8Array, password: string): Promise<UnlockPdfResult> {
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  let probe
  try {
    probe = await PDFDocument.load(bytes, { ignoreEncryption: true })
  } catch {
    throw new PdfSecurityError('invalid-pdf', 'Could not read this file as a valid PDF.')
  }
  if (!probe.isEncrypted) {
    throw new PdfSecurityError('not-encrypted', 'This PDF is not password-protected.')
  }

  let doc
  try {
    doc = await PDFDocument.load(bytes, { password })
  } catch {
    throw new PdfSecurityError('wrong-password', 'Incorrect password — could not unlock this PDF.')
  }

  // Re-save without encryption metadata to output an unlocked copy
  const saved = await doc.save({ useObjectStreams: false })
  return {
    data: toArrayBufferBytes(saved),
    pageCount: doc.getPageCount(),
  }
}
