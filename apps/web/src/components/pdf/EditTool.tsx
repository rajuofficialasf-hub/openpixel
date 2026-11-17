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
import { PdfResultBoxes, WasmWarning } from './shared'
import { downloadBlob, usePdfFile, wasmMissing, type PdfToolProps } from './usePdfFile'

function metaRow(label: string, value: string | null | undefined): { label: string; value: string } | null {
  return value == null || value === '' ? null : { label, value }
}

export function EditTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
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
          setPreviewError(err instanceof Error ? err.message : 'Could not render this page.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [bytes, previewPage, renderScale])

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
      pdf.setStatus('All edits undone — no changes to download yet.')
      pdf.setBusy(null)
      return
    }
    pdf.setBusy(label)
    pdf.setError(null)
    pdf.setStatus(null)
    const result = await pdfEdit(bytes, ops, [])
    if (!result) {
      pdf.setError(wasmMissing(label))
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
    pdf.setStatus(
      `${label}: ${result.opsApplied} op${result.opsApplied === 1 ? '' : 's'} on ${result.pagesTouched} page${result.pagesTouched === 1 ? '' : 's'}${result.commentsAdded > 0 ? `, ${result.commentsAdded} comment${result.commentsAdded === 1 ? '' : 's'}` : ''}${result.warnings.length > 0 ? ` — ${result.warnings.join('; ')}` : ''}`,
    )
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
      pdf.setError('Check the text overlay — page 1–' + pageCount + ', numbers for X/Y/size, a #RRGGBB colour, and some text.')
      return
    }
    pushAction([{ kind: 'text', page, x, y, text: editText, size, color, font: 'helvetica' }])
  }

  const handlePageNumbers = () => {
    if (pageNumFormat.trim() === '') {
      pdf.setError('Give a page-number format, e.g. "Page {n} of {total}".')
      return
    }
    pushAction([{ kind: 'page_numbers', pages: null, format: pageNumFormat, position: pageNumPosition, size: 10 }])
  }

  const handleHeaderFooter = () => {
    if (headerText.trim() === '' && footerText.trim() === '') {
      pdf.setError('Give a header, a footer, or both.')
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
      pdf.setError('Check the highlight — page 1–' + pageCount + ', numbers for X/Y/width/height, and a #RRGGBB colour.')
      return
    }
    pushAction([{ kind: 'highlight', page, x, y, width: w, height: h, color, opacity: 0.4 }])
  }

  const handleRenderDownload = async () => {
    if (!bytes || !file) return
    pdf.setBusy('Rendered page')
    pdf.setError(null)
    try {
      const { blob, width, height } = await renderPdfPageBlob(bytes, previewPage, renderScale, renderFormat)
      downloadBlob(blob, `${file.name.replace(/\.pdf$/i, '')}-p${previewPage}.${renderFormat === 'png' ? 'png' : 'jpg'}`)
      pdf.setStatus(`Rendered page ${previewPage} as ${renderFormat.toUpperCase()}: ${width} × ${height} px`)
    } catch (err) {
      pdf.setError(err instanceof Error ? err.message : 'Could not render this page.')
    }
    pdf.setBusy(null)
  }

  const meta = info
    ? [
        metaRow('Title', info.title),
        metaRow('Author', info.author),
        metaRow('Creator', info.creator),
        metaRow('Producer', info.producer),
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
            Add text, highlights, page numbers and headers — entirely in your browser.
          </Typography>
        </Box>

        {pdf.wasmReady === false && <WasmWarning />}

        {!file && (
          <Stack spacing={2} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 }, '& > *': { flexShrink: 0 } }}>
            <DropZone
              inputId="pdf-file"
              label="Drop a PDF here"
              hint="One PDF at a time. Info, preview and editing run locally — nothing is uploaded."
              multiple={false}
              accept="application/pdf,.pdf"
              compact
              onFiles={loadFile}
            />
          </Stack>
        )}

        {pdf.loading && (
          <Typography role="status" variant="body2" color="text.secondary">
            Reading PDF…
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
                      Document
                    </Typography>
                    <Box
                      component="dl"
                      sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 1, mt: 2, mx: 0, mb: 0 }}
                    >
                      <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>File</Box>
                      <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {file.name}
                      </Box>
                      <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>Size</Box>
                      <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }}>{formatBytes(file.size)}</Box>
                      <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>Pages</Box>
                      <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }} id="pdf-page-count">
                        {pageCount}
                      </Box>
                      {info && (
                        <>
                          <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>Version</Box>
                          <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }}>PDF {info.version}</Box>
                          <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>Encrypted</Box>
                          <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }}>{info.encrypted ? 'Yes' : 'No'}</Box>
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
                          <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>Page sizes</Box>
                          <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }}>
                            {pageSizesShown.map((s, i) => (
                              <span key={i}>
                                {i > 0 ? '; ' : ''}p{i + 1}: {formatPageSize(s)}
                              </span>
                            ))}
                            {pageSizesExtra > 0 && `; … and ${pageSizesExtra} more`}
                          </Box>
                        </>
                      )}
                    </Box>
                    <Button type="button" variant="outlined" onClick={clearAll} sx={{ mt: 2 }}>
                      Choose a different file
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <Typography variant="overline" color="text.secondary">
                      Preview
                    </Typography>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                      <Stack direction="row" spacing={2} alignItems="flex-end" flexWrap="wrap">
                        <Box>
                          <Typography variant="subtitle2" component="label" htmlFor="pdf-preview-page" sx={{ display: 'block' }}>
                            Page
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
                            Render scale
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
                            Download format
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
                            maxHeight: { xs: 320, lg: 'clamp(200px, calc(100dvh - 470px), 420px)' },
                            maxWidth: '100%',
                            borderRadius: 1,
                            border: 1,
                            borderColor: 'divider',
                          }}
                        />
                      </Box>
                      {previewDims && (
                        <Typography variant="body2" color="text.secondary" id="pdf-preview-dims">
                          Page {previewPage} preview: {previewDims.width} × {previewDims.height} px at {renderScale}× scale
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
                            ? 'Rendering…'
                            : `Download page ${previewPage} as ${renderFormat.toUpperCase()}`}
                        </Button>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        Preview and PDF to image render with pdf.js in this browser — not with PDFium, so very
                        complex pages may look slightly different from the CLI render.
                      </Typography>
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
                    title="Undo last edit (Ctrl+Z)"
                  >
                    Undo
                  </Button>
                  <Button
                    type="button"
                    variant="outlined"
                    id="pdf-edit-redo"
                    onClick={handleRedo}
                    disabled={redoStack.length === 0 || pdf.busy !== null}
                    title="Redo (Ctrl+Shift+Z or Ctrl+Y)"
                  >
                    Redo
                  </Button>
                  <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
                    {undoStack.length === 0
                      ? 'No edits yet.'
                      : `${undoStack.length} edit${undoStack.length === 1 ? '' : 's'} applied — Undo removes the last one.`}
                  </Typography>
                </Stack>
                <Card>
                  <CardContent>
                    <Typography variant="overline" color="text.secondary">
                      Edit — add content
                    </Typography>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                      <Typography variant="body2" color="text.secondary">
                        Overlays are new content layered on top of the page. Existing text is never edited in
                        place — coordinates are PDF points, origin bottom left.
                      </Typography>
                      <Box>
                        <Typography variant="subtitle2">Add text</Typography>
                        <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                          <TextField id="pdf-edit-text" size="small" label="Text" value={editText} onChange={(e) => setEditText(e.target.value)} sx={{ width: 220 }} />
                          <TextField id="pdf-edit-page" size="small" label="Page" type="number" value={editPage} onChange={(e) => setEditPage(e.target.value)} sx={{ width: 90 }} />
                          <TextField id="pdf-edit-x" size="small" label="X (pt)" type="number" value={editX} onChange={(e) => setEditX(e.target.value)} sx={{ width: 90 }} />
                          <TextField id="pdf-edit-y" size="small" label="Y (pt)" type="number" value={editY} onChange={(e) => setEditY(e.target.value)} sx={{ width: 90 }} />
                          <TextField id="pdf-edit-size" size="small" label="Size (pt)" type="number" value={editSize} onChange={(e) => setEditSize(e.target.value)} sx={{ width: 90 }} />
                          <TextField id="pdf-edit-color" size="small" label="Colour" type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} sx={{ width: 70 }} />
                          <Button type="button" variant="contained" id="pdf-edit-text-button" onClick={handleEditText} disabled={pdf.busy !== null || pdf.wasmReady === false}>
                            {editing ? 'Adding…' : 'Add text'}
                          </Button>
                        </Stack>
                      </Box>
                      <Box>
                        <Typography variant="subtitle2">Page numbers &amp; header / footer</Typography>
                        <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                          <TextField id="pdf-edit-pagenum-format" size="small" label="Page-number format" value={pageNumFormat} onChange={(e) => setPageNumFormat(e.target.value)} sx={{ width: 220 }} />
                          <Select
                            native
                            id="pdf-edit-pagenum-position"
                            value={pageNumPosition}
                            onChange={(e) => setPageNumPosition(e.target.value as typeof pageNumPosition)}
                            aria-label="Page-number position"
                          >
                            <option value="bottom_center">Bottom centre</option>
                            <option value="bottom_right">Bottom right</option>
                            <option value="top_center">Top centre</option>
                            <option value="top_right">Top right</option>
                          </Select>
                          <Button type="button" variant="contained" id="pdf-edit-pagenum-button" onClick={handlePageNumbers} disabled={pdf.busy !== null || pdf.wasmReady === false}>
                            {editing ? 'Adding…' : 'Add page numbers'}
                          </Button>
                        </Stack>
                        <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 1.5 }}>
                          <TextField id="pdf-edit-header" size="small" label="Header" value={headerText} onChange={(e) => setHeaderText(e.target.value)} sx={{ width: 220 }} />
                          <TextField id="pdf-edit-footer" size="small" label="Footer" value={footerText} onChange={(e) => setFooterText(e.target.value)} sx={{ width: 220 }} />
                          <Button type="button" variant="contained" id="pdf-edit-header-footer-button" onClick={handleHeaderFooter} disabled={pdf.busy !== null || pdf.wasmReady === false}>
                            {editing ? 'Adding…' : 'Add header / footer'}
                          </Button>
                        </Stack>
                      </Box>
                      <Box>
                        <Typography variant="subtitle2">Highlight an area</Typography>
                        <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                          <TextField id="pdf-highlight-page" size="small" label="Page" type="number" value={highlightPage} onChange={(e) => setHighlightPage(e.target.value)} sx={{ width: 90 }} />
                          <TextField id="pdf-highlight-x" size="small" label="X (pt)" type="number" value={highlightX} onChange={(e) => setHighlightX(e.target.value)} sx={{ width: 90 }} />
                          <TextField id="pdf-highlight-y" size="small" label="Y (pt)" type="number" value={highlightY} onChange={(e) => setHighlightY(e.target.value)} sx={{ width: 90 }} />
                          <TextField id="pdf-highlight-w" size="small" label="Width (pt)" type="number" value={highlightW} onChange={(e) => setHighlightW(e.target.value)} sx={{ width: 100 }} />
                          <TextField id="pdf-highlight-h" size="small" label="Height (pt)" type="number" value={highlightH} onChange={(e) => setHighlightH(e.target.value)} sx={{ width: 100 }} />
                          <TextField id="pdf-highlight-color" size="small" label="Colour" type="color" value={highlightColor} onChange={(e) => setHighlightColor(e.target.value)} sx={{ width: 70 }} />
                          <Button type="button" variant="contained" id="pdf-highlight-button" onClick={handleHighlight} disabled={pdf.busy !== null || pdf.wasmReady === false}>
                            {editing ? 'Highlighting…' : 'Highlight'}
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
