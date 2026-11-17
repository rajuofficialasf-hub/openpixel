/**
 * Merge PDF — one focused page. The first PDF is the page's file;
 * the second is picked in the settings. Both stay on the device;
 * the second is appended after the first.
 */
import { useRef, useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import { getPdfInfo, pdfMerge, pdfOutputName } from '../../lib/pdf'
import { PdfToolPage } from './shared'
import { usePdfFile, wasmMissing, type PdfToolProps } from './usePdfFile'

export function MergeTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const pdf = usePdfFile('pdf-merge', initialFiles, onInitialFilesConsumed)
  const [secondFile, setSecondFile] = useState<File | null>(null)
  const [secondBytes, setSecondBytes] = useState<Uint8Array<ArrayBuffer> | null>(null)
  const mergeInputRef = useRef<HTMLInputElement>(null)

  const handleMergeFiles = async (files: FileList | null) => {
    const next = files?.[0]
    if (!next) return
    setSecondFile(next)
    setSecondBytes(new Uint8Array(await next.arrayBuffer()))
  }

  const run = async () => {
    if (!pdf.bytes || !pdf.file || !secondBytes || !secondFile) return
    pdf.setBusy('Merged PDF')
    pdf.setError(null)
    pdf.setStatus(null)
    const merged = await pdfMerge([pdf.bytes, secondBytes])
    if (!merged) {
      pdf.setError(wasmMissing('Merged PDF'))
      pdf.setBusy(null)
      return
    }
    const mergedInfo = await getPdfInfo(merged)
    pdf.setResults([
      {
        label: 'Merged PDF',
        blob: new Blob([merged as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(pdf.file.name, 'merged'),
        pages: mergedInfo?.page_count ?? null,
      },
    ])
    pdf.setStatus(`Merged PDF: ${mergedInfo?.page_count ?? '?'} pages`)
    pdf.setBusy(null)
  }

  return (
    <PdfToolPage
      headingId="pdf-merge-heading"
      title="Merge PDF"
      description="Combine two PDFs into one — the second is appended after the first."
      pdf={pdf}
      primary={{
        id: 'pdf-merge-button',
        label: 'Merge PDFs',
        busyLabel: 'Merging…',
        busyKey: 'Merged PDF',
        onClick: () => void run(),
        disabled: !secondBytes,
      }}
    >
      {/* The hidden input is absolutely positioned, so this Stack
          is its positioned ancestor — without one it would stretch
          the document (the old everything-page hit exactly that). */}
      <Stack spacing={2} sx={{ position: 'relative' }}>
        <Typography variant="body2">
          {secondFile
            ? `Second PDF: ${secondFile.name} — it will be appended after ${pdf.file?.name ?? 'the first PDF'}.`
            : 'Choose a second PDF to append after this one.'}
        </Typography>
        <Box
          component="input"
          ref={mergeInputRef}
          id="pdf-merge-file"
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Second PDF to merge"
          onChange={(e) => void handleMergeFiles(e.target.files)}
          sx={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
        />
        <Stack direction="row" spacing={1.5} flexWrap="wrap">
          <Button type="button" variant="outlined" onClick={() => mergeInputRef.current?.click()}>
            Choose second PDF
          </Button>
        </Stack>
      </Stack>
    </PdfToolPage>
  )
}
