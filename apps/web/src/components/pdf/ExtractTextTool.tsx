/**
 * Extract PDF Text — one focused page. The text layer is read
 * with pdf.js (the same library the preview uses): shown on the
 * page and downloadable as TXT. Scanned pages have no text layer
 * and come back empty — the page says so honestly and points at
 * OCR instead. EPUB/DOCX export stays CLI-only.
 */
import { useState } from 'react'
import { Box, Typography } from '@mui/material'
import { pdfExtractText } from '../../lib/pdf'
import { PdfToolPage } from './shared'
import { usePdfFile, type PdfToolProps } from './usePdfFile'

export function ExtractTextTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const pdf = usePdfFile('pdf-extract-text', initialFiles, onInitialFilesConsumed)
  const [extracted, setExtracted] = useState<string | null>(null)

  const run = async () => {
    if (!pdf.bytes || !pdf.file) return
    pdf.setBusy('Extracted PDF text')
    pdf.setError(null)
    pdf.setStatus(null)
    setExtracted(null)
    const out = await pdfExtractText(pdf.bytes)
    if (!out) {
      pdf.setError('Could not read this PDF’s text — it may be damaged. Try the native CLI.')
      pdf.setBusy(null)
      return
    }
    const text = out.text
    setExtracted(text)
    if (text.trim() === '') {
      pdf.setStatus(
        `Extracted PDF text: no text found in ${out.pages} page${out.pages === 1 ? '' : 's'} — the pages look scanned (image-only). Use OCR to read them.`,
      )
      pdf.setBusy(null)
      return
    }
    const stem = pdf.file.name.replace(/\.pdf$/i, '') || 'document'
    pdf.setResults([
      {
        label: 'Extracted text',
        blob: new Blob([text], { type: 'text/plain' }),
        filename: `${stem}-text.txt`,
        pages: out.pages,
      },
    ])
    pdf.setStatus(`Extracted PDF text: ${text.length} characters from ${out.pages} page${out.pages === 1 ? '' : 's'}.`)
    pdf.setBusy(null)
  }

  const extra =
    extracted !== null && extracted.trim() !== '' ? (
      <Box
        component="pre"
        sx={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 320,
          overflowY: 'auto',
          m: 0,
          p: 2,
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          typography: 'body2',
        }}
      >
        {extracted}
      </Box>
    ) : null

  return (
    <PdfToolPage
      headingId="pdf-extract-text-heading"
      title="Extract PDF Text"
      description="Read the text out of a PDF — shown here and downloadable as a .txt file."
      pdf={pdf}
      extra={extra}
      primary={{
        id: 'pdf-extract-text-button',
        label: 'Extract text',
        busyLabel: 'Extracting…',
        busyKey: 'Extracted PDF text',
        onClick: () => void run(),
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Only the text layer is read — fonts, images and layout are not preserved. For a scanned PDF with no text
        layer, use OCR instead.
      </Typography>
    </PdfToolPage>
  )
}
