/**
 * Pure client-side sample file generators (zero network, 100% local).
 * Lets new users try Convert, Resize, Crop, OCR, and PDF Edit/Tools
 * in one click without hunting for a file on their device.
 */

/**
 * Build a valid, crisp 2-page PDF 1.4 document with exact byte offsets
 * in its xref table — works cleanly in pdf.js, lopdf (WASM), and every
 * PDF viewer.
 */
export function buildSamplePdfBytes(): Uint8Array {
  const page1Stream = [
    'BT',
    '/F2 22 Tf 0.19 0.34 0.84 rg 64 720 Td (OpenPixel Studio — Sample Document) Tj',
    '/F1 12 Tf 0.25 0.30 0.38 rg 0 -30 Td (100% local in-browser PDF & image toolkit. Nothing is uploaded.) Tj',
    '/F2 13 Tf 0.09 0.13 0.20 rg 0 -42 Td (Try these tools on this sample PDF:) Tj',
    '/F1 11 Tf 0.25 0.30 0.38 rg',
    '0 -22 Td (1. Edit PDF: draw your signature or add a watermark across all pages.) Tj',
    '0 -18 Td (2. Organize Pages: click to rotate, reorder by dragging, or split pages.) Tj',
    '0 -18 Td (3. OCR: extract readable text from scanned PDF pages in English or Bengali.) Tj',
    '0 -18 Td (4. Compress & Clean: reduce file size or edit document metadata.) Tj',
    '/F1 10 Tf 0.45 0.50 0.58 rg 0 -480 Td (Sample Page 1 of 2 — Generated locally in your browser) Tj',
    'ET',
    '0.85 0.88 0.94 RG 1 w 64 676 m 548 676 l S',
  ].join('\n')

  const page2Stream = [
    'BT',
    '/F2 18 Tf 0.19 0.34 0.84 rg 64 720 Td (Page 2 — Signature & Notes Area) Tj',
    '/F1 11 Tf 0.25 0.30 0.38 rg 0 -28 Td (Click anywhere below in Edit PDF to place text, highlights, or your signature.) Tj',
    '/F1 11 Tf 0.25 0.30 0.38 rg 0 -360 Td (Authorized Signature:) Tj',
    '/F1 10 Tf 0.45 0.50 0.58 rg 0 -256 Td (Sample Page 2 of 2 — OpenPixel Studio) Tj',
    'ET',
    '0.70 0.75 0.82 RG 1 w 64 318 m 280 318 l S',
  ].join('\n')

  const enc = new TextEncoder()
  const parts: string[] = ['%PDF-1.4\n']
  const offsets: number[] = [0]
  let byteLen = enc.encode(parts[0]).length

  const pushObj = (id: number, body: string) => {
    offsets[id] = byteLen
    const chunk = `${id} 0 obj\n${body}\nendobj\n`
    parts.push(chunk)
    byteLen += enc.encode(chunk).length
  }

  pushObj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  pushObj(2, '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>')
  pushObj(
    3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> >>',
  )
  pushObj(
    4,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> >>',
  )
  pushObj(5, `<< /Length ${enc.encode(page1Stream).length} >>\nstream\n${page1Stream}\nendstream`)
  pushObj(6, `<< /Length ${enc.encode(page2Stream).length} >>\nstream\n${page2Stream}\nendstream`)
  pushObj(7, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  pushObj(8, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')

  const xrefStart = byteLen
  const count = offsets.length
  const xrefLines = [`xref\n0 ${count}\n`, '0000000000 65535 f \n']
  for (let i = 1; i < count; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`)
  }
  xrefLines.push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`)
  parts.push(xrefLines.join(''))

  return enc.encode(parts.join(''))
}

/** Create a ready-to-use 2-page sample PDF File object. */
export function createSamplePdfFile(): File {
  const bytes = buildSamplePdfBytes()
  return new File([bytes as BlobPart], 'openpixel-sample.pdf', { type: 'application/pdf' })
}

/**
 * Render a crisp 1200×800 sample PNG image on an offscreen canvas with
 * gradients, geometric landscape peaks, colour swatches, and readable
 * text — great for testing Convert, Resize, Crop, and OCR.
 */
export async function createSampleImageFile(): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 800
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')

  // Vibrant dawn gradient sky
  const sky = ctx.createLinearGradient(0, 0, 1200, 800)
  sky.addColorStop(0, '#1e3a8a')
  sky.addColorStop(0.5, '#3157D5')
  sky.addColorStop(1, '#0d9488')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, 1200, 800)

  // Soft sun glow
  const sun = ctx.createRadialGradient(930, 210, 20, 930, 210, 220)
  sun.addColorStop(0, 'rgba(255, 251, 235, 0.95)')
  sun.addColorStop(0.4, 'rgba(253, 224, 71, 0.45)')
  sun.addColorStop(1, 'rgba(253, 224, 71, 0)')
  ctx.fillStyle = sun
  ctx.fillRect(700, 0, 500, 440)

  // Layered geometric mountains
  ctx.fillStyle = 'rgba(15, 23, 42, 0.35)'
  ctx.beginPath()
  ctx.moveTo(0, 620)
  ctx.lineTo(260, 390)
  ctx.lineTo(540, 560)
  ctx.lineTo(840, 330)
  ctx.lineTo(1200, 540)
  ctx.lineTo(1200, 800)
  ctx.lineTo(0, 800)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = 'rgba(15, 23, 42, 0.62)'
  ctx.beginPath()
  ctx.moveTo(0, 690)
  ctx.lineTo(360, 490)
  ctx.lineTo(680, 650)
  ctx.lineTo(980, 460)
  ctx.lineTo(1200, 610)
  ctx.lineTo(1200, 800)
  ctx.lineTo(0, 800)
  ctx.closePath()
  ctx.fill()

  // Crisp studio card overlay
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'
  ctx.beginPath()
  ctx.roundRect(72, 72, 620, 250, 24)
  ctx.fill()

  ctx.fillStyle = '#172033'
  ctx.font = 'bold 46px system-ui, -apple-system, sans-serif'
  ctx.fillText('OpenPixel Studio', 112, 152)

  ctx.fillStyle = '#475569'
  ctx.font = '24px system-ui, -apple-system, sans-serif'
  ctx.fillText('Sample Photo · 1200 × 800 px', 112, 198)
  ctx.fillText('Test Convert, Resize, Crop & OCR locally.', 112, 236)

  // Colour calibration swatches
  const swatches = ['#3157D5', '#0d9488', '#16A36A', '#E6A23C', '#DC4C4C', '#172033']
  swatches.forEach((hex, idx) => {
    ctx.fillStyle = hex
    ctx.beginPath()
    ctx.roundRect(112 + idx * 72, 262, 56, 28, 8)
    ctx.fill()
  })

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not generate sample PNG')
  return new File([blob], 'openpixel-sample.png', { type: 'image/png' })
}
