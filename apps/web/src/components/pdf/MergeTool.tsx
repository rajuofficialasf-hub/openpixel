/**
 * Merge PDF — one focused page. The first PDF is the page's file;
 * the second is picked in the settings. Both stay on the device;
 * the second is appended after the first.
 */
import { useRef, useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import { getPdfInfo, pdfMerge, pdfOutputName } from '../../lib/pdf'
import { PdfToolPage } from './shared'
import { useI18n } from '../../lib/use-i18n'
import { usePdfFile, type PdfToolProps } from './usePdfFile'

export function MergeTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
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
      pdf.setError(pdf.wasmMissing('Merged PDF'))
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
    pdf.setStatusKey('pdf.opStatusPages', { label: 'Merged PDF', n: mergedInfo?.page_count ?? '?' })
    pdf.setBusy(null)
  }

  return (
    <PdfToolPage
      headingId="pdf-merge-heading"
      title="Merge PDF"
      description={t('pdf.mergeDesc')}      pdf={pdf}
      primary={{
        id: 'pdf-merge-button',
        label: t('pdf.mergeButton'),
        busyLabel: t('pdf.merging'),
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
            ? t('pdf.mergeSecondWith', { second: secondFile.name, first: pdf.file?.name ?? t('pdf.mergeFirstFallback') })
            : t('pdf.mergeSecond')}
        </Typography>
        <Box
          component="input"
          ref={mergeInputRef}
          id="pdf-merge-file"
          type="file"
          accept="application/pdf,.pdf"
          aria-label={t('pdf.mergeSecondAria')}
          onChange={(e) => void handleMergeFiles(e.target.files)}
          sx={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
        />
        <Stack direction="row" spacing={1.5} flexWrap="wrap">
          <Button type="button" variant="outlined" onClick={() => mergeInputRef.current?.click()}>
            {t('pdf.mergeChooseSecond')}
          </Button>
        </Stack>
      </Stack>
    </PdfToolPage>
  )
}
