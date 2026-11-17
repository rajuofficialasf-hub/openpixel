/**
 * Compress PDF — one focused page. Screen / ebook / printer
 * modes, optional metadata strip, best-of rule (the engine keeps
 * the original when a mode cannot shrink the file, and says so).
 */
import { useState } from 'react'
import { Box, Checkbox, FormControlLabel, Select, Typography } from '@mui/material'
import { formatBytes } from '../../lib/capabilities'
import { pdfCompress, pdfOutputName, type PdfCompressMode, PDF_COMPRESS_MODES } from '../../lib/pdf'
import { PdfToolPage } from './shared'
import { usePdfFile, wasmMissing, type PdfToolProps } from './usePdfFile'

export function CompressTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const pdf = usePdfFile('pdf-compress', initialFiles, onInitialFilesConsumed)
  const [mode, setMode] = useState<PdfCompressMode>('ebook')
  const [strip, setStrip] = useState(false)

  const run = async () => {
    if (!pdf.bytes || !pdf.file) return
    pdf.setBusy('Compressed PDF')
    pdf.setError(null)
    pdf.setStatus(null)
    const result = await pdfCompress(pdf.bytes, mode, strip)
    if (!result) {
      pdf.setError(wasmMissing('Compressed PDF'))
      pdf.setBusy(null)
      return
    }
    pdf.setResults([
      {
        label: 'Compressed PDF',
        blob: new Blob([result.data as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(pdf.file.name, 'compressed'),
        pages: pdf.pageCount,
      },
    ])
    pdf.setStatus(
      result.note
        ? `Compressed PDF: ${formatBytes(result.inputBytes)} → ${formatBytes(result.outputBytes)} — ${result.note}`
        : `Compressed PDF: ${formatBytes(result.inputBytes)} → ${formatBytes(result.outputBytes)} (${result.savedPercent.toFixed(1)}% smaller, ${result.imagesRecompressed} image${result.imagesRecompressed === 1 ? '' : 's'} recompressed)`,
    )
    pdf.setBusy(null)
  }

  return (
    <PdfToolPage
      headingId="pdf-compress-heading"
      title="Compress PDF"
      description="Shrink a PDF — images are downsampled to the mode's DPI and re-encoded, and the file structure is optimised."
      pdf={pdf}
      primary={{ id: 'pdf-compress-button', label: 'Compress', busyLabel: 'Compressing…', busyKey: 'Compressed PDF', onClick: () => void run() }}
    >
      <Box>
        <Typography variant="subtitle2" component="label" htmlFor="pdf-compress-mode" sx={{ display: 'block' }}>
          Mode
        </Typography>
        <Select
          native
          id="pdf-compress-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as PdfCompressMode)}
          sx={{ mt: 0.5, minWidth: 180 }}
        >
          {PDF_COMPRESS_MODES.map((m) => (
            <option key={m} value={m}>
              {m === 'screen' ? 'Screen — 72 DPI' : m === 'ebook' ? 'Ebook — 150 DPI' : 'Printer — 300 DPI'}
            </option>
          ))}
        </Select>
      </Box>
      <FormControlLabel
        control={
          <Checkbox id="pdf-compress-strip" checked={strip} onChange={(e) => setStrip(e.target.checked)} />
        }
        label="Strip document metadata (title, author…)"
      />
      <Typography variant="caption" color="text.secondary">
        If a mode cannot shrink this PDF, the original is kept and the result says so.
      </Typography>
    </PdfToolPage>
  )
}
