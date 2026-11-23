/**
 * Edit PDF — the one tool page that keeps the 3-panel editor
 * (thumbnails rail / center preview / right tools) and the
 * viewport-fit behaviour: on desktop the page never scrolls,
 * each column scrolls internally. Overlays are NEW content
 * layered on top of the page — existing text is never edited
 * in place. Coordinates are PDF points, origin bottom left.
 */
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import { formatBytes } from '../../lib/capabilities'
import {
  formatPageSize,
  hexToRgb,
  pdfEdit,
  pdfOutputName,
  renderPdfPage,
  renderPdfPageBlob,
  PDF_RENDER_SCALES,
  type PdfOverlayOp,
} from '../../lib/pdf'
import { PdfThumbnails } from '../PdfThumbnails'
import { DropZone } from '../DropZone'
import { PdfJsCaption, PdfResultBoxes, WasmWarning } from './shared'
import { useI18n } from '../../lib/use-i18n'
import { downloadBlob, usePdfFile, type PdfToolProps } from './usePdfFile'

function metaRow(label: string, value: string | null | undefined): { label: string; value: string } | null {
  return value == null || value === '' ? null : { label, value }
}

export function EditTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t, lang } = useI18n()
  const pdf = usePdfFile('pdf-edit', initialFiles, onInitialFilesConsumed)
  const { file, bytes, info, pageCount } = pdf

  const [previewPage, setPreviewPage] = useState(1)
  const [renderScale, setRenderScale] = useState<number>(2)
  const [renderFormat, setRenderFormat] = useState<'png' | 'jpeg'>('png')
  const [previewDims, setPreviewDims] = useState<{ width: number; height: number } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [editText, setEditText] = useState('')
  const [editPage, setEditPage] = useState('1')
  const [editX, setEditX] = useState('72')
  const [editY, setEditY] = useState('700')
  const [editSize, setEditSize] = useState('14')
  const [editColor, setEditColor] = useState('#000000')
  const [pageNumFormat, setPageNumFormat] = useState('Page {n} of {total}')
  const [pageNumPosition, setPageNumPosition] = useState<'bottom_center' | 'bottom_right' | 'top_center' | 'top_right'>('bottom_center')
  const [headerText, setHeaderText] = useState('')
  const [footerText, setFooterText] = useState('')
  const [highlightPage, setHighlightPage] = useState('1')
  const [highlightX, setHighlightX] = useState('72')
  const [highlightY, setHighlightY] = useState('600')
  const [highlightW, setHighlightW] = useState('200')
  const [highlightH, setHighlightH] = useState('20')
  const [highlightColor, setHighlightColor] = useState('#ffeb3b')
  const [pin, setPin] = useState<{ page: number; relX: number; relY: number; pdfX: number; pdfY: number } | null>(null)

  // Edit history (Phase 7): every action pushes one entry (its
  // ops) onto the undo stack; the current output is always
  // rebuilt by re-applying the remaining ops to the ORIGINAL
  // bytes — never to a previous result, so undo is exact and
  // actions accumulate instead of replacing each other (before
  // this, each action produced a result holding only itself).
  // Undo pops the last entry onto the redo stack; redo pushes
  // it back. An empty stack clears the result (pdf_edit rejects
  // an empty ops list, so it is never called with one).
  const [undoStack, setUndoStack] = useState<PdfOverlayOp[][]>([])
  const [redoStack, setRedoStack] = useState<PdfOverlayOp[][]>([])

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

  const editPageNumber = (): number | null => {
    const n = Number(editPage)
    return Number.isInteger(n) && n >= 1 && n <= pageCount ? n : null
  }

  const editNumber = (value: string): number | null => {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  const applyOps = async (ops: PdfOverlayOp[], label: string) => {
    if (!bytes || !file) return
    if (ops.length === 0) {
      pdf.setResults([])
      pdf.setStatus(t('pdf.editUndone'))
      pdf.setBusy(null)
      return
    }
    pdf.setBusy(label)
    pdf.setError(null)
    pdf.setStatus(null)
    const result = await pdfEdit(bytes, ops, [])
    if (!result) {
      pdf.setError(pdf.wasmMissing(label))
      pdf.setBusy(null)
      return
    }
    pdf.setResults([
      {
        label,
        blob: new Blob([result.data as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(file.name, 'edited'),
        pages: pageCount,
      },
    ])
    let done = t('pdf.editDoneBase', {
      label,
      ops: result.opsApplied,
      opsS: result.opsApplied === 1 ? '' : 's',
      pages: result.pagesTouched,
      pagesS: result.pagesTouched === 1 ? '' : 's',
    })
    if (result.commentsAdded > 0) {
      done += t('pdf.editDoneComments', { n: result.commentsAdded, s: result.commentsAdded === 1 ? '' : 's' })
    }
    if (result.warnings.length > 0) {
      done += t('pdf.editDoneWarnings', { w: result.warnings.join('; ') })
    }
    pdf.setStatus(done)
    pdf.setBusy(null)
  }

  /** Push one action onto the history and rebuild the output. */
  const pushAction = (ops: PdfOverlayOp[]) => {
    const next = [...undoStack, ops]
    setUndoStack(next)
    setRedoStack([])
    void applyOps(next.flat(), 'Edited PDF')
  }

  const handleUndo = () => {
    if (undoStack.length === 0 || pdf.busy !== null) return
    const entry = undoStack[undoStack.length - 1]
    const next = undoStack.slice(0, -1)
    setUndoStack(next)
    setRedoStack([...redoStack, entry])
    void applyOps(next.flat(), 'Edited PDF')
  }

  const handleRedo = () => {
    if (redoStack.length === 0 || pdf.busy !== null) return
    const entry = redoStack[redoStack.length - 1]
    setRedoStack(redoStack.slice(0, -1))
    const next = [...undoStack, entry]
    setUndoStack(next)
    void applyOps(next.flat(), 'Edited PDF')
  }

  // A new file starts with empty history — an old edit must
  // never be re-applied to a different document.
  // A new file starts with empty history — an old edit must
  // never be re-applied to a different document. Reset in the
  // load/clear handlers (not an effect) so no cascading render.
  const loadFile = (files: File[]) => {
    setUndoStack([])
    setRedoStack([])
    void pdf.handleFiles(files)
  }
  const clearAll = () => {
    setUndoStack([])
    setRedoStack([])
    pdf.clearFile()
  }

  // Ctrl+Z undo / Ctrl+Shift+Z or Ctrl+Y redo. Never hijack
  // typing: inside a text field the browser's own undo wins.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        handleRedo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const handleEditText = () => {
    const page = editPageNumber()
    const x = editNumber(editX)
    const y = editNumber(editY)
    const size = editNumber(editSize)
    const color = hexToRgb(editColor)
    if (!page || x === null || y === null || size === null || size <= 0 || !color || editText.trim() === '') {
      pdf.setError(t('pdf.editTextError', { n: pageCount }))
      return
    }
    pushAction([{ kind: 'text', page, x, y, text: editText, size, color, font: 'helvetica' }])
  }

  const handlePageNumbers = () => {
    if (pageNumFormat.trim() === '') {
      pdf.setError(t('pdf.editPageNumError'))
      return
    }
    pushAction([{ kind: 'page_numbers', pages: null, format: pageNumFormat, position: pageNumPosition, size: 10 }])
  }

  const handleHeaderFooter = () => {
    if (headerText.trim() === '' && footerText.trim() === '') {
      pdf.setError(t('pdf.editHeaderError'))
      return
    }
    pushAction([{ kind: 'header_footer', pages: null, header: headerText.trim() || null, footer: footerText.trim() || null, size: 10 }])
  }

  const handleHighlight = () => {
    const page = Number(highlightPage)
    const x = editNumber(highlightX)
    const y = editNumber(highlightY)
    const w = editNumber(highlightW)
    const h = editNumber(highlightH)
    const color = hexToRgb(highlightColor)
    if (!Number.isInteger(page) || page < 1 || page > pageCount || x === null || y === null || w === null || h === null || w <= 0 || h <= 0 || !color) {
      pdf.setError(t('pdf.editHighlightError', { n: pageCount }))
      return
    }
    pushAction([{ kind: 'highlight', page, x, y, width: w, height: h, color, opacity: 0.4 }])
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    const [pageW, pageH] = info?.page_sizes?.[previewPage - 1] ?? [612, 792]
    const pdfX = Math.round(relX * pageW)
    const pdfY = Math.round((1 - relY) * pageH)
    setEditPage(String(previewPage))
    setEditX(String(pdfX))
    setEditY(String(pdfY))
    setHighlightPage(String(previewPage))
    setHighlightX(String(pdfX))
    setHighlightY(String(pdfY))
    setPin({ page: previewPage, relX, relY, pdfX, pdfY })
  }

  const handleRenderDownload = async () => {
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
  const editing = pdf.busy === 'Edited PDF'

  return (
    <Box
      component="section"
      aria-labelledby="pdf-edit-heading"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: { lg: 1 },
        minHeight: { lg: 0 },
        overflow: { lg: 'hidden' },
      }}
    >
      <Stack spacing={2} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 } }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap', flex: 'none' }}>
          <Typography variant="h5" component="h2" id="pdf-edit-heading">
            Edit PDF
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('pdf.editDesc')}
          </Typography>
        </Box>

        {pdf.wasmReady === false && <WasmWarning />}

        {!file && (
          <Stack spacing={2} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 }, '& > *': { flexShrink: 0 } }}>
            <DropZone
              inputId="pdf-file"
              label={t('pdf.dropLabel')}
              hint={t('pdf.editDropHint')}
              multiple={false}
              accept="application/pdf,.pdf"
              compact
              alignContent="top"
              onFiles={loadFile}
            />
          </Stack>
        )}

        {pdf.loading && (
          <Typography role="status" variant="body2" color="text.secondary">
            {t('common.readingPdf')}
          </Typography>
        )}

        {file && bytes && (
          <Grid container spacing={2} alignItems="stretch" sx={{ flex: { lg: 1 }, minHeight: { lg: 0 } }}>
            <Grid size={{ xs: 12, lg: 2 }} sx={{ display: 'flex', flexDirection: 'column', height: { lg: '100%' }, minHeight: { lg: 0 } }}>
              <Stack spacing={2} id="pdf-thumbs-panel" sx={{ flex: { lg: 1 }, minHeight: { lg: 0 }, overflowY: { lg: 'auto' }, pr: { lg: 0.5 }, '& > *': { flexShrink: 0 } }}>
                <PdfThumbnails
                  key={`${file.name}-${file.size}`}
                  bytes={bytes}
                  pageCount={pageCount}
                  currentPage={previewPage}
                  onSelect={setPreviewPage}
                />
              </Stack>
            </Grid>
            <Grid size={{ xs: 12, lg: 6 }} sx={{ display: 'flex', flexDirection: 'column', height: { lg: '100%' }, minHeight: { lg: 0 } }}>
              <Stack spacing={2} id="pdf-center-panel" sx={{ flex: { lg: 1 }, minHeight: { lg: 0 }, overflowY: { lg: 'auto' }, pr: { lg: 0.5 }, '& > *': { flexShrink: 0 } }}>
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
                    <Button type="button" variant="outlined" onClick={clearAll} sx={{ mt: 2 }}>
                      {t('common.chooseDifferentFile')}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <Typography variant="overline" color="text.secondary">
                      {t('pdf.editPreview')}
                    </Typography>
                    <Stack spacing={2} sx={{ mt: 1 }}>
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
                                Page {n}
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
                      <Typography variant="caption" color={pin && pin.page === previewPage ? 'primary.main' : 'text.secondary'} fontWeight={pin && pin.page === previewPage ? 600 : 400}>
                        {pin && pin.page === previewPage
                          ? t('pdf.pinPlaced', { page: pin.page, x: pin.pdfX, y: pin.pdfY })
                          : t('pdf.clickToPlaceHint')}
                      </Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                        <Box sx={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
                          <Box
                            component="canvas"
                            ref={canvasRef}
                            id="pdf-preview-canvas"
                            onClick={handleCanvasClick}
                            sx={{
                              display: 'block',
                              maxHeight: { xs: 320, lg: 'clamp(200px, calc(100dvh - 470px), 420px)' },
                              maxWidth: '100%',
                              borderRadius: 1,
                              border: 1,
                              borderColor: 'divider',
                              cursor: 'crosshair',
                            }}
                          />
                          {pin && pin.page === previewPage && (
                            <Box
                              aria-hidden="true"
                              sx={{
                                position: 'absolute',
                                left: `${pin.relX * 100}%`,
                                top: `${pin.relY * 100}%`,
                                transform: 'translate(-50%, -50%)',
                                width: 14,
                                height: 14,
                                borderRadius: '50%',
                                bgcolor: 'primary.main',
                                border: '2px solid #ffffff',
                                boxShadow: '0 1px 6px rgba(0,0,0,0.45)',
                                pointerEvents: 'none',
                              }}
                            />
                          )}
                        </Box>
                      </Box>
                      {previewDims && (
                        <Typography variant="body2" color="text.secondary" id="pdf-preview-dims">
                          {t('pdf.previewDims', { n: previewPage, w: previewDims.width, h: previewDims.height, s: renderScale })}
                        </Typography>
                      )}
                      {previewError && <Alert severity="error">{previewError}</Alert>}
                      <Stack direction="row" spacing={1.5} flexWrap="wrap">
                        <Button
                          type="button"
                          variant="contained"
                          id="pdf-render-download"
                          startIcon={<DownloadIcon />}
                          onClick={() => void handleRenderDownload()}
                          disabled={pdf.busy !== null}
                        >
                          {pdf.busy === 'Rendered page'
                            ? t('pdf.rendering')
                            : t('pdf.downloadPage', { n: previewPage, fmt: renderFormat.toUpperCase() })}
                        </Button>
                      </Stack>
                      <PdfJsCaption />
                    </Stack>
                  </CardContent>
                </Card>
                <PdfResultBoxes pdf={pdf} />
              </Stack>
            </Grid>
            <Grid size={{ xs: 12, lg: 4 }} sx={{ display: 'flex', flexDirection: 'column', height: { lg: '100%' }, minHeight: { lg: 0 } }}>
              <Stack spacing={2} id="pdf-ops-panel" sx={{ flex: { lg: 1 }, minHeight: { lg: 0 }, overflowY: { lg: 'auto' }, pr: { lg: 0.5 }, '& > *': { flexShrink: 0 } }}>
                <Stack direction="row" spacing={1.5} flexWrap="wrap">
                  <Button
                    type="button"
                    variant="outlined"
                    id="pdf-edit-undo"
                    onClick={handleUndo}
                    disabled={undoStack.length === 0 || pdf.busy !== null}
                    title={t('pdf.editUndoTitle')}
                  >
                    {t('pdf.editUndo')}
                  </Button>
                  <Button
                    type="button"
                    variant="outlined"
                    id="pdf-edit-redo"
                    onClick={handleRedo}
                    disabled={redoStack.length === 0 || pdf.busy !== null}
                    title={t('pdf.editRedoTitle')}
                  >
                    {t('pdf.editRedo')}
                  </Button>
                  <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
                    {undoStack.length === 0
                      ? t('pdf.editNoEdits')
                      : t('pdf.editCount', { n: undoStack.length, s: undoStack.length === 1 ? '' : 's' })}
                  </Typography>
                </Stack>
                <Card>
                  <CardContent>
                    <Typography variant="overline" color="text.secondary">
                      {t('pdf.editAddContent')}
                    </Typography>
                    <Stack spacing={3} sx={{ mt: 1 }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('pdf.editOverlayNote')}
                      </Typography>
                      <Box>
                        <Typography variant="subtitle2" sx={{ mb: 1.25 }}>{t('pdf.editAddText')}</Typography>
                        <Stack spacing={1.5}>
                          <TextField id="pdf-edit-text" size="small" fullWidth label={t('pdf.editText')} value={editText} onChange={(e) => setEditText(e.target.value)} />
                          <Box>
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
                              {t('pdf.editPosPreset')}
                            </Typography>
                            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                              {[
                                { label: t('pdf.editPosTopLeft'), x: '72', y: '740' },
                                { label: t('pdf.editPosTopRightPreset'), x: '420', y: '740' },
                                { label: t('pdf.editPosCenter'), x: '240', y: '400' },
                                { label: t('pdf.editPosBottomLeft'), x: '72', y: '54' },
                                { label: t('pdf.editPosBottomRightPreset'), x: '420', y: '54' },
                              ].map((preset) => (
                                <Button
                                  key={preset.label}
                                  type="button"
                                  size="small"
                                  variant="outlined"
                                  onClick={() => {
                                    setEditX(preset.x)
                                    setEditY(preset.y)
                                  }}
                                  sx={{ py: 0.25, px: 1, fontSize: '0.75rem' }}
                                >
                                  {preset.label}
                                </Button>
                              ))}
                            </Stack>
                          </Box>
                          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
                            <TextField id="pdf-edit-page" size="small" label={t('pdf.redactPage')} type="number" value={editPage} onChange={(e) => setEditPage(e.target.value)} />
                            <TextField id="pdf-edit-size" size="small" label={t('pdf.editSizePt')} type="number" value={editSize} onChange={(e) => setEditSize(e.target.value)} />
                            <TextField id="pdf-edit-x" size="small" label="X (pt)" type="number" value={editX} onChange={(e) => setEditX(e.target.value)} />
                            <TextField id="pdf-edit-y" size="small" label="Y (pt)" type="number" value={editY} onChange={(e) => setEditY(e.target.value)} />
                          </Box>
                          <Stack direction="row" spacing={1.5} alignItems="center">
                            <TextField id="pdf-edit-color" size="small" label={t('pdf.editColour')} type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} sx={{ width: 88 }} />
                            <Button type="button" variant="contained" id="pdf-edit-text-button" onClick={handleEditText} disabled={pdf.busy !== null || pdf.wasmReady === false} sx={{ flex: 1 }}>
                              {editing ? t('pdf.editAdding') : t('pdf.editAddText')}
                            </Button>
                          </Stack>
                        </Stack>
                      </Box>
                      <Box sx={{ pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
                        <Typography variant="subtitle2" sx={{ mb: 1.25 }}>{t('pdf.editPageNumHeader')}</Typography>
                        <Stack spacing={1.5}>
                          <TextField id="pdf-edit-pagenum-format" size="small" fullWidth label={t('pdf.editPageNumFormat')} value={pageNumFormat} onChange={(e) => setPageNumFormat(e.target.value)} />
                          <Select
                            native
                            fullWidth
                            id="pdf-edit-pagenum-position"
                            value={pageNumPosition}
                            onChange={(e) => setPageNumPosition(e.target.value as typeof pageNumPosition)}
                            aria-label={t('pdf.editPosAria')}
                          >
                            <option value="bottom_center">{t('pdf.editPosBottomCentre')}</option>
                            <option value="bottom_right">{t('pdf.editPosBottomRight')}</option>
                            <option value="top_center">{t('pdf.editPosTopCentre')}</option>
                            <option value="top_right">{t('pdf.editPosTopRight')}</option>
                          </Select>
                          <Button type="button" variant="outlined" fullWidth id="pdf-edit-pagenum-button" onClick={handlePageNumbers} disabled={pdf.busy !== null || pdf.wasmReady === false}>
                            {editing ? t('pdf.editAdding') : t('pdf.editAddPageNumbers')}
                          </Button>
                          <TextField id="pdf-edit-header" size="small" fullWidth label={t('pdf.editHeader')} value={headerText} onChange={(e) => setHeaderText(e.target.value)} />
                          <TextField id="pdf-edit-footer" size="small" fullWidth label={t('pdf.editFooter')} value={footerText} onChange={(e) => setFooterText(e.target.value)} />
                          <Button type="button" variant="outlined" fullWidth id="pdf-edit-header-footer-button" onClick={handleHeaderFooter} disabled={pdf.busy !== null || pdf.wasmReady === false}>
                            {editing ? t('pdf.editAdding') : t('pdf.editAddHeaderFooter')}
                          </Button>
                        </Stack>
                      </Box>
                      <Box sx={{ pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
                        <Typography variant="subtitle2" sx={{ mb: 1.25 }}>{t('pdf.editHighlight')}</Typography>
                        <Stack spacing={1.5}>
                          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
                            <TextField id="pdf-highlight-page" size="small" label={t('pdf.redactPage')} type="number" value={highlightPage} onChange={(e) => setHighlightPage(e.target.value)} />
                            <TextField id="pdf-highlight-color" size="small" label={t('pdf.editColour')} type="color" value={highlightColor} onChange={(e) => setHighlightColor(e.target.value)} />
                            <TextField id="pdf-highlight-x" size="small" label="X (pt)" type="number" value={highlightX} onChange={(e) => setHighlightX(e.target.value)} />
                            <TextField id="pdf-highlight-y" size="small" label="Y (pt)" type="number" value={highlightY} onChange={(e) => setHighlightY(e.target.value)} />
                            <TextField id="pdf-highlight-w" size="small" label="Width (pt)" type="number" value={highlightW} onChange={(e) => setHighlightW(e.target.value)} />
                            <TextField id="pdf-highlight-h" size="small" label="Height (pt)" type="number" value={highlightH} onChange={(e) => setHighlightH(e.target.value)} />
                          </Box>
                          <Button type="button" variant="outlined" fullWidth id="pdf-highlight-button" onClick={handleHighlight} disabled={pdf.busy !== null || pdf.wasmReady === false}>
                            {editing ? t('pdf.editHighlighting') : t('pdf.editHighlightBtn')}
                          </Button>
                        </Stack>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>
              </Stack>
            </Grid>
          </Grid>
        )}
      </Stack>
    </Box>
  )
}
