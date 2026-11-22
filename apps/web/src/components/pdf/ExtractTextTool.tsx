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
import { useI18n } from '../../lib/use-i18n'
import { usePdfFile, type PdfToolProps } from './usePdfFile'

export function ExtractTextTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
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
      pdf.setError(t('pdf.extractTextError'))
      pdf.setBusy(null)
      return
    }
    const text = out.text
    setExtracted(text)
    if (text.trim() === '') {
      pdf.setStatusKey('pdf.extractTextEmpty', { n: out.pages, s: out.pages === 1 ? '' : 's' })
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
    pdf.setStatusKey('pdf.extractTextDone', { chars: text.length, n: out.pages, s: out.pages === 1 ? '' : 's' })
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
      description={t('pdf.extractTextDesc')}
      pdf={pdf}
      extra={extra}
      primary={{
        id: 'pdf-extract-text-button',
        label: t('pdf.extractTextButton'),
        busyLabel: t('pdf.extracting'),
        busyKey: 'Extracted PDF text',
        onClick: () => void run(),
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {t('pdf.extractTextNote')}
      </Typography>
    </PdfToolPage>
  )
}
