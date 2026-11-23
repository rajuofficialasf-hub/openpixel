/**
 * Image to PDF — one focused page. One PDF page per image, in
 * order, at the image's own size or a named page size.
 */
import { useEffect, useRef, useState } from 'react'
import { Box, Button, Select, Typography } from '@mui/material'
import { getPdfInfo, pdfFromImages, PDF_PAGE_SIZES, type PdfPageSize } from '../../lib/pdf'
import { recordActivity } from '../../lib/activity'
import { DropZone } from '../DropZone'
import { PdfToolPage } from './shared'
import { useI18n } from '../../lib/use-i18n'
import { usePdfFile, type PdfToolProps } from './usePdfFile'

export function ImagesToPdfTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  // The hook owns the shared result/status/busy state; the images
  // themselves live here. Accept image files handed over via Smart
  // Next-Step Chaining or Ctrl+V clipboard paste.
  const { t } = useI18n()
  const pdf = usePdfFile('pdf-images-to-pdf')
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePageSize, setImagePageSize] = useState<PdfPageSize>('Original')

  const lastInitialRef = useRef<File[] | null>(null)
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0 && lastInitialRef.current !== initialFiles) {
      lastInitialRef.current = initialFiles
      const imagesOnly = initialFiles.filter((f) => f.type.startsWith('image/') || !f.name.toLowerCase().endsWith('.pdf'))
      if (imagesOnly.length > 0) {
        queueMicrotask(() => setImageFiles((prev) => [...prev, ...imagesOnly]))
      }
      onInitialFilesConsumed?.()
    }
  }, [initialFiles, onInitialFilesConsumed])

  const run = async () => {
    if (imageFiles.length === 0) return
    pdf.setBusy('Image to PDF')
    pdf.setError(null)
    pdf.setStatus(null)
    const images: Uint8Array[] = []
    for (const f of imageFiles) images.push(new Uint8Array(await f.arrayBuffer()))
    const built = await pdfFromImages(images, imagePageSize === 'Original' ? null : imagePageSize)
    if (!built) {
      pdf.setError(pdf.wasmMissing('Image to PDF'))
      pdf.setBusy(null)
      return
    }
    const builtInfo = await getPdfInfo(built)
    const pages = builtInfo?.page_count ?? imageFiles.length
    pdf.setResults([
      {
        label: 'Image to PDF',
        blob: new Blob([built as BlobPart], { type: 'application/pdf' }),
        filename: 'images.pdf',
        pages,
      },
    ])
    pdf.setStatusKey('pdf.imgToPdfDone', { n: pages })
    recordActivity({
      fileName: 'images.pdf',
      fileSize: built.length,
      fileType: 'application/pdf',
      tool: 'pdf-images-to-pdf',
      result: `Image to PDF: ${pages} pages`,
      resultKey: 'pdf.imgToPdfDone',
      resultParams: { n: pages },
    })
    pdf.setBusy(null)
  }

  const upload = (
    <DropZone
      compact
      inputId="pdf-images-file"
      label={t('pdf.imgToPdfDropLabel')}
      hint={t('pdf.imgToPdfDropHint')}      multiple
      accept="image/*"
      onFiles={(files) => setImageFiles(files)}
    />
  )

  const summary = (
    <Box>
      <Typography
        variant="body2"
        sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {t('pdf.imgToPdfCount', {
          n: imageFiles.length,
          s: imageFiles.length === 1 ? '' : 's',
          names: imageFiles.slice(0, 3).map((f) => f.name).join(', '),
        })}
        {imageFiles.length > 3 ? t('pdf.imgToPdfMore', { n: imageFiles.length - 3 }) : ''}
      </Typography>
      <Button type="button" variant="outlined" size="small" onClick={() => setImageFiles([])} sx={{ mt: 1 }}>
        {t('pdf.imgToPdfChoose')}
      </Button>
    </Box>
  )

  return (
    <PdfToolPage
      headingId="pdf-images-to-pdf-heading"
      title="Image to PDF"
      description={t('pdf.imgToPdfDesc')}
      pdf={pdf}
      ready={imageFiles.length > 0}
      upload={upload}
      summary={summary}
      primary={{
        id: 'pdf-from-images-button',
        label: t('pdf.imgToPdfButton'),
        busyLabel: t('pdf.imgToPdfBuilding'),
        busyKey: 'Image to PDF',
        onClick: () => void run(),
        disabled: imageFiles.length === 0,
      }}
    >
      <Box>
        <Typography variant="subtitle2" component="label" htmlFor="pdf-images-page-size" sx={{ display: 'block' }}>
          {t('pdf.imgToPdfPageSize')}
        </Typography>
        <Select
          native
          id="pdf-images-page-size"
          value={imagePageSize}
          onChange={(e) => setImagePageSize(e.target.value as PdfPageSize)}
          sx={{ mt: 0.5, minWidth: 140 }}
        >
          {PDF_PAGE_SIZES.map((s) => (
            <option key={s} value={s}>{s === 'Original' ? t('pdf.imgToPdfOriginal') : s}</option>
          ))}
        </Select>
      </Box>
    </PdfToolPage>
  )
}
