/**
 * PDF to Image — one focused page. The preview renders with
 * pdf.js (not PDFium — the browser has no libpdfium), and the
 * download is the same render at the chosen scale and format.
 * The document info card lives here too, so the page count,
 * version and page sizes are still inspectable.
 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Select, Stack, Typography } from '@mui/material'
import { formatBytes } from '../../lib/capabilities'
import {
  formatPageSize,
  renderPdfPage,
  renderPdfPageBlob,
  PDF_RENDER_SCALES,
} from '../../lib/pdf'
import { useI18n } from '../../lib/use-i18n'
import { PdfJsCaption, PdfToolPage } from './shared'
import { downloadBlob, usePdfFile, type PdfToolProps } from './usePdfFile'

function metaRow(label: string, value: string | null | undefined): { label: string; value: string } | null {
  return value == null || value === '' ? null : { label, value }
}

export function PdfToImageTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t, lang } = useI18n()
  const pdf = usePdfFile('pdf-to-image', initialFiles, onInitialFilesConsumed)
  const [previewPage, setPreviewPage] = useState(1)
  const [renderScale, setRenderScale] = useState<number>(2)
  const [renderFormat, setRenderFormat] = useState<'png' | 'jpeg'>('png')
  const [previewDims, setPreviewDims] = useState<{ width: number; height: number } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const { file, bytes, info, pageCount } = pdf

  // Preview: render the selected page with pdf.js into the
  // canvas. A render that throws is a visible error, never a
  // silently blank canvas.
  useEffect(() => {
    if (!bytes) return
    let cancelled = false
    renderPdfPage(bytes, previewPage, renderScale)
      .then(({ canvas, width, height }) => {
        if (cancelled) return
        setPreviewError(null)
        const host = canvasRef.current
        if (host) {
          host.width = canvas.width
          host.height = canvas.height
          host.getContext('2d')?.drawImage(canvas, 0, 0)
        }
        setPreviewDims({ width, height })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPreviewDims(null)
          setPreviewError(err instanceof Error ? err.message : t('pdf.renderError'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [bytes, previewPage, renderScale, t])

  const run = async () => {
    if (!bytes || !file) return
    pdf.setBusy('Rendered page')
    pdf.setError(null)
    try {
      const { blob, width, height } = await renderPdfPageBlob(bytes, previewPage, renderScale, renderFormat, lang)
      downloadBlob(blob, `${file.name.replace(/\.pdf$/i, '')}-p${previewPage}.${renderFormat === 'png' ? 'png' : 'jpg'}`)
      pdf.setStatusKey('pdf.rendered', { n: previewPage, fmt: renderFormat.toUpperCase(), w: width, h: height })
    } catch (err) {
      pdf.setError(err instanceof Error ? err.message : t('pdf.renderError'))
    }
    pdf.setBusy(null)
  }

  const meta = info
    ? [
        metaRow(t('pdf.docTitle'), info.title),
        metaRow(t('pdf.docAuthor'), info.author),
        metaRow(t('pdf.docCreator'), info.creator),
        metaRow(t('pdf.docProducer'), info.producer),
      ].filter((r): r is { label: string; value: string } => r !== null)
    : []
  const pageSizesShown = info?.page_sizes.slice(0, 6) ?? []
  const pageSizesExtra = info ? info.page_sizes.length - pageSizesShown.length : 0

  const infoCard = file && (
    <Card id="pdf-info">
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          {t('pdf.editDoc')}
        </Typography>
        <Box
          component="dl"
          sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 1, mt: 2, mx: 0, mb: 0 }}
        >
          <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>{t('pdf.docFile')}</Box>
          <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {file.name}
          </Box>
          <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>{t('pdf.docSize')}</Box>
          <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }}>{formatBytes(file.size)}</Box>
          <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>{t('pdf.docPages')}</Box>
          <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }} id="pdf-page-count">
            {pageCount}
          </Box>
          {info && (
            <>
              <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>{t('pdf.docVersion')}</Box>
              <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }}>PDF {info.version}</Box>
              <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>{t('pdf.docEncrypted')}</Box>
              <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }}>{info.encrypted ? t('fmt.yes') : t('fmt.no')}</Box>
            </>
          )}
          {meta.map((row) => (
            <Box key={row.label} sx={{ display: 'contents' }}>
              <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>{row.label}</Box>
              <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }}>{row.value}</Box>
            </Box>
          ))}
          {info && (
            <>
              <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>{t('pdf.docPageSizes')}</Box>
              <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }}>
                {pageSizesShown.map((s, i) => (
                  <span key={i}>
                    {i > 0 ? '; ' : ''}p{i + 1}: {formatPageSize(s)}
                  </span>
                ))}
                {pageSizesExtra > 0 && t('pdf.docMore', { n: pageSizesExtra })}
              </Box>
            </>
          )}
        </Box>
        <Button type="button" variant="outlined" onClick={pdf.clearFile} sx={{ mt: 2 }}>
          {t('common.chooseDifferentFile')}
        </Button>
      </CardContent>
    </Card>
  )

  return (
    <PdfToolPage
      headingId="pdf-to-image-heading"
      title="PDF to Image"
      description={t('pdf.toImageDesc')}
      pdf={pdf}
      // The info card below already shows file/size/pages (and owns
      // #pdf-page-count), so the default file summary is suppressed
      // — two elements with that id would break strict selectors.
      summary={<></>}
      beforeSettings={infoCard}
      primary={{
        id: 'pdf-render-download',
        label: t('pdf.downloadPage', { n: previewPage, fmt: renderFormat.toUpperCase() }),
        busyLabel: t('pdf.rendering'),
        busyKey: 'Rendered page',
        onClick: () => void run(),
      }}
    >
      <Stack direction="row" spacing={2} alignItems="flex-end" flexWrap="wrap">
        <Box>
          <Typography variant="subtitle2" component="label" htmlFor="pdf-preview-page" sx={{ display: 'block' }}>
            {t('pdf.pageLabel')}
          </Typography>
          <Select
            native
            id="pdf-preview-page"
            value={previewPage}
            onChange={(e) => setPreviewPage(Number(e.target.value))}
            sx={{ mt: 0.5, minWidth: 100 }}
          >
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {t('pdf.pageN', { n })}
              </option>
            ))}
          </Select>
        </Box>
        <Box>
          <Typography variant="subtitle2" component="label" htmlFor="pdf-render-scale" sx={{ display: 'block' }}>
            {t('pdf.renderScale')}
          </Typography>
          <Select
            native
            id="pdf-render-scale"
            value={renderScale}
            onChange={(e) => setRenderScale(Number(e.target.value))}
            sx={{ mt: 0.5, minWidth: 140 }}
          >
            {PDF_RENDER_SCALES.map((s) => (
              <option key={s} value={s}>
                {s}× ({Math.round(s * 72)} dpi)
              </option>
            ))}
          </Select>
        </Box>
        <Box>
          <Typography variant="subtitle2" component="label" htmlFor="pdf-render-format" sx={{ display: 'block' }}>
            {t('pdf.downloadFormat')}
          </Typography>
          <Select
            native
            id="pdf-render-format"
            value={renderFormat}
            onChange={(e) => setRenderFormat(e.target.value as 'png' | 'jpeg')}
            sx={{ mt: 0.5, minWidth: 120 }}
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
          </Select>
        </Box>
      </Stack>
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <Box
          component="canvas"
          ref={canvasRef}
          id="pdf-preview-canvas"
          sx={{
            display: 'block',
            maxHeight: 420,
            maxWidth: '100%',
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
          }}
        />
      </Box>
      {previewDims && (
        <Typography variant="body2" color="text.secondary" id="pdf-preview-dims">
          {t('pdf.previewDims', { n: previewPage, w: previewDims.width, h: previewDims.height, s: renderScale })}
        </Typography>
      )}
      {previewError && <Alert severity="error">{previewError}</Alert>}
      <PdfJsCaption />
    </PdfToolPage>
  )
}
