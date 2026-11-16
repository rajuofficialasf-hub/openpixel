import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import DownloadIcon from '@mui/icons-material/Download'
import { formatBytes } from '../lib/capabilities'
import {
  formatPageSize,
  getPdfInfo,
  getPdfPageCountViaPdfJs,
  parsePageList,
  parsePageRanges,
  parseReorder,
  pdfFromImages,
  pdfMerge,
  pdfOutputName,
  pdfProcess,
  renderPdfPage,
  renderPdfPageBlob,
  PDF_PAGE_SIZES,
  PDF_RENDER_SCALES,
  type PdfInfo,
  type PdfPageSize,
} from '../lib/pdf'
import { loadWasmEngine } from '../lib/wasm-engine'
import { DropZone } from './DropZone'

interface PdfResult {
  label: string
  blob: Blob
  filename: string
  pages: number | null
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function metaRow(label: string, value: string | null | undefined): { label: string; value: string } | null {
  return value == null || value === '' ? null : { label, value }
}

export function PdfWorkspace() {
  const [file, setFile] = useState<File | null>(null)
  const [bytes, setBytes] = useState<Uint8Array<ArrayBuffer> | null>(null)
  const [info, setInfo] = useState<PdfInfo | null>(null)
  const [pdfjsPages, setPdfjsPages] = useState<number | null>(null)
  const [wasmReady, setWasmReady] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [results, setResults] = useState<PdfResult[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const [previewPage, setPreviewPage] = useState(1)
  const [renderScale, setRenderScale] = useState<number>(2)
  const [renderFormat, setRenderFormat] = useState<'png' | 'jpeg'>('png')
  const [previewDims, setPreviewDims] = useState<{ width: number; height: number } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [rotatePages, setRotatePages] = useState('')
  const [rotateDegrees, setRotateDegrees] = useState(90)
  const [extractPages, setExtractPages] = useState('')
  const [removePages, setRemovePages] = useState('')
  const [reorderOrder, setReorderOrder] = useState('')
  const [duplicatePages, setDuplicatePages] = useState('')
  const [nupCols, setNupCols] = useState(2)
  const [nupRows, setNupRows] = useState(2)
  const [splitRanges, setSplitRanges] = useState('')

  const [secondFile, setSecondFile] = useState<File | null>(null)
  const [secondBytes, setSecondBytes] = useState<Uint8Array<ArrayBuffer> | null>(null)
  const mergeInputRef = useRef<HTMLInputElement>(null)

  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePageSize, setImagePageSize] = useState<PdfPageSize>('Original')

  const pageCount = info?.page_count ?? pdfjsPages ?? 0

  useEffect(() => {
    let live = true
    loadWasmEngine().then((mod) => {
      if (live) setWasmReady(mod !== null)
    })
    return () => {
      live = false
    }
  }, [])

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

  const handleFiles = async (files: File[]) => {
    const next = files[0]
    if (!next) return
    setLoading(true)
    setError(null)
    setStatus(null)
    setResults([])
    setInfo(null)
    setPdfjsPages(null)
    setPreviewPage(1)
    setPreviewDims(null)
    setSecondFile(null)
    setSecondBytes(null)
    const data = new Uint8Array(await next.arrayBuffer())
    setFile(next)
    setBytes(data)
    // Info comes from the WASM engine when it is loaded; the page
    // count falls back to pdf.js, so the tab still shows it
    // without the module (previews and PDF→image work either way).
    const pdfInfo = await getPdfInfo(data)
    if (pdfInfo) {
      setInfo(pdfInfo)
    } else {
      try {
        setPdfjsPages(await getPdfPageCountViaPdfJs(data))
      } catch {
        setFile(null)
        setBytes(null)
        setError(
          'Could not read this PDF — it may be encrypted or damaged. Encrypted PDFs cannot be opened in the browser; use the native CLI.',
        )
      }
    }
    setLoading(false)
  }

  const clearFile = () => {
    setFile(null)
    setBytes(null)
    setInfo(null)
    setPdfjsPages(null)
    setResults([])
    setStatus(null)
    setError(null)
    setPreviewDims(null)
    setSecondFile(null)
    setSecondBytes(null)
  }

  const runOp = async (label: string, opsJson: string, suffix: string) => {
    if (!bytes || !file) return
    setBusy(label)
    setError(null)
    setStatus(null)
    const outputs = await pdfProcess(bytes, opsJson)
    if (!outputs) {
      setError(
        `${label} needs the WASM engine, which is not loaded — rebuild the web app with npm run build:wasm. No file was produced.`,
      )
      setBusy(null)
      return
    }
    const next: PdfResult[] = []
    for (let i = 0; i < outputs.length; i++) {
      const out = outputs[i]
      const outInfo = await getPdfInfo(out)
      next.push({
        label: outputs.length > 1 ? `${label} — part ${i + 1}` : label,
        blob: new Blob([out as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(file.name, outputs.length > 1 ? `${suffix}-${i + 1}` : suffix),
        pages: outInfo?.page_count ?? null,
      })
    }
    setResults(next)
    setStatus(
      outputs.length > 1
        ? `${label}: split into ${outputs.length} documents (${next.map((r) => `${r.pages ?? '?'} pages`).join(', ')})`
        : `${label}: ${next[0].pages ?? '?'} pages`,
    )
    setBusy(null)
  }

  const opError = (what: string) =>
    `Check the pages for ${what} — use pages 1–${pageCount}, e.g. "1,3" or "1-3".`

  const handleRotate = () => {
    const pages = rotatePages.trim() === '' ? null : parsePageList(rotatePages, pageCount)
    if (pages === null && rotatePages.trim() !== '') {
      setError(opError('rotate'))
      return
    }
    void runOp(
      'Rotated PDF',
      JSON.stringify({ kind: 'rotate', pages: pages ?? undefined, degrees: rotateDegrees }),
      'rotated',
    )
  }

  const handleExtract = () => {
    const pages = parsePageList(extractPages, pageCount)
    if (!pages) {
      setError(opError('extract'))
      return
    }
    void runOp('Extracted PDF', JSON.stringify({ kind: 'extract', pages }), 'extracted')
  }

  const handleRemove = () => {
    const pages = parsePageList(removePages, pageCount)
    if (!pages) {
      setError(opError('remove'))
      return
    }
    void runOp('Removed pages', JSON.stringify({ kind: 'remove', pages }), 'removed')
  }

  const handleReorder = () => {
    const order = parseReorder(reorderOrder, pageCount)
    if (!order) {
      setError(
        `Reorder must list every page exactly once, e.g. "3,1,2" for a ${pageCount}-page PDF.`,
      )
      return
    }
    void runOp('Reordered PDF', JSON.stringify({ kind: 'reorder', order }), 'reordered')
  }

  const handleDuplicate = () => {
    const pages = parsePageList(duplicatePages, pageCount)
    if (!pages) {
      setError(opError('duplicate'))
      return
    }
    void runOp('Duplicated pages', JSON.stringify({ kind: 'duplicate', pages }), 'duplicated')
  }

  const handleSplit = () => {
    const ranges = parsePageRanges(splitRanges, pageCount)
    if (!ranges) {
      setError('Check the split ranges — use e.g. "1-3,5-7" with pages 1–' + pageCount + '.')
      return
    }
    void runOp('Split PDF', JSON.stringify({ kind: 'split', ranges }), 'split')
  }

  const handleMerge = async () => {
    if (!bytes || !file || !secondBytes || !secondFile) return
    setBusy('Merged PDF')
    setError(null)
    setStatus(null)
    const merged = await pdfMerge([bytes, secondBytes])
    if (!merged) {
      setError(
        'Merge needs the WASM engine, which is not loaded — rebuild the web app with npm run build:wasm. No file was produced.',
      )
      setBusy(null)
      return
    }
    const mergedInfo = await getPdfInfo(merged)
    setResults([
      {
        label: 'Merged PDF',
        blob: new Blob([merged as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(file.name, 'merged'),
        pages: mergedInfo?.page_count ?? null,
      },
    ])
    setStatus(`Merged PDF: ${mergedInfo?.page_count ?? '?'} pages`)
    setBusy(null)
  }

  const handleMergeFiles = async (files: FileList | null) => {
    const next = files?.[0]
    if (!next) return
    setSecondFile(next)
    setSecondBytes(new Uint8Array(await next.arrayBuffer()))
  }

  const handleFromImages = async () => {
    if (imageFiles.length === 0) return
    setBusy('Images to PDF')
    setError(null)
    setStatus(null)
    const images: Uint8Array[] = []
    for (const f of imageFiles) images.push(new Uint8Array(await f.arrayBuffer()))
    const built = await pdfFromImages(images, imagePageSize === 'Original' ? null : imagePageSize)
    if (!built) {
      setError(
        'Images to PDF needs the WASM engine, which is not loaded — rebuild the web app with npm run build:wasm. No file was produced.',
      )
      setBusy(null)
      return
    }
    const builtInfo = await getPdfInfo(built)
    setResults([
      {
        label: 'Images to PDF',
        blob: new Blob([built as BlobPart], { type: 'application/pdf' }),
        filename: 'images.pdf',
        pages: builtInfo?.page_count ?? null,
      },
    ])
    setStatus(`Images to PDF: ${builtInfo?.page_count ?? imageFiles.length} pages`)
    setBusy(null)
  }

  const handleRenderDownload = async () => {
    if (!bytes || !file) return
    setBusy('Rendered page')
    setError(null)
    try {
      const { blob, width, height } = await renderPdfPageBlob(bytes, previewPage, renderScale, renderFormat)
      downloadBlob(blob, `${file.name.replace(/\.pdf$/i, '')}-p${previewPage}.${renderFormat === 'png' ? 'png' : 'jpg'}`)
      setStatus(`Rendered page ${previewPage} as ${renderFormat.toUpperCase()}: ${width} × ${height} px`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not render this page.')
    }
    setBusy(null)
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

  return (
    <Box component="section" aria-labelledby="pdf-heading">
      <Stack spacing={3}>
        <Box>
          <Typography variant="h5" component="h2" id="pdf-heading">
            PDF tools
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 720 }}>
            Work with PDFs entirely in your browser — page operations run through the real
            engine in WebAssembly and previews render with pdf.js. Files never leave your
            device.
          </Typography>
        </Box>

        {wasmReady === false && (
          <Box
            role="status"
            sx={{
              borderRadius: 3,
              border: 1,
              borderColor: (t) => alpha(t.palette.warning.main, 0.4),
              bgcolor: (t) => alpha(t.palette.warning.main, 0.08),
              p: 2.5,
            }}
          >
            <Typography variant="body2">
              The WASM engine is not loaded, so PDF page operations are unavailable here —
              previews and PDF to image still work. Rebuild the web app with{' '}
              <Typography component="code" variant="body2">npm run build:wasm</Typography>.
            </Typography>
          </Box>
        )}

        {!file && (
          <DropZone
            inputId="pdf-file"
            label="Drop a PDF here"
            hint="One PDF at a time. Info, preview and page operations run locally — nothing is uploaded."
            multiple={false}
            accept="application/pdf,.pdf"
            onFiles={(files) => void handleFiles(files)}
          />
        )}

        {loading && (
          <Typography role="status" variant="body2" color="text.secondary">
            Reading PDF…
          </Typography>
        )}

        {file && bytes && (
          <>
            <Card id="pdf-info">
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  Document
                </Typography>
                <Box
                  component="dl"
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr',
                    columnGap: 2,
                    rowGap: 1,
                    mt: 2,
                    mx: 0,
                    mb: 0,
                  }}
                >
                  <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>File</Box>
                  <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.name}
                  </Box>
                  <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>Size</Box>
                  <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }}>{formatBytes(file.size)}</Box>
                  <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>Pages</Box>
                  <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }} id="pdf-page-count">
                    Pages: {pageCount}
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
                <Button type="button" variant="outlined" onClick={clearFile} sx={{ mt: 2 }}>
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
                        maxHeight: 320,
                        maxWidth: '100%',
                        borderRadius: 1,
                        border: 1,
                        borderColor: 'divider',
                      }}
                    />
                  </Box>
                  {previewDims && (
                    <Typography variant="body2" color="text.secondary" id="pdf-preview-dims">
                      Page {previewPage} preview: {previewDims.width} × {previewDims.height} px
                      at {renderScale}× scale
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
                      disabled={busy !== null}
                    >
                      {busy === 'Rendered page'
                        ? 'Rendering…'
                        : `Download page ${previewPage} as ${renderFormat.toUpperCase()}`}
                    </Button>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Preview and PDF to image render with pdf.js in this browser — not with
                    PDFium, so very complex pages may look slightly different from the CLI
                    render.
                  </Typography>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  Page operations
                </Typography>
                <Stack spacing={2.5} sx={{ mt: 1 }}>
                  <Box>
                    <Typography variant="subtitle2" component="label" htmlFor="pdf-rotate-pages">
                      Rotate pages
                    </Typography>
                    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <TextField
                        id="pdf-rotate-pages"
                        size="small"
                        placeholder="e.g. 1,3 or 1-3 (empty = all pages)"
                        value={rotatePages}
                        onChange={(e) => setRotatePages(e.target.value)}
                        sx={{ width: 280 }}
                      />
                      <Select
                        native
                        id="pdf-rotate-degrees"
                        value={rotateDegrees}
                        onChange={(e) => setRotateDegrees(Number(e.target.value))}
                        aria-label="Rotation in degrees"
                      >
                        <option value={90}>90°</option>
                        <option value={180}>180°</option>
                        <option value={270}>270°</option>
                      </Select>
                      <Button type="button" variant="contained" id="pdf-rotate-button" onClick={handleRotate} disabled={busy !== null || wasmReady === false}>
                        {busy === 'Rotated PDF' ? 'Rotating…' : 'Rotate'}
                      </Button>
                    </Stack>
                  </Box>

                  <Box>
                    <Typography variant="subtitle2" component="label" htmlFor="pdf-extract-pages">
                      Extract pages
                    </Typography>
                    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <TextField
                        id="pdf-extract-pages"
                        size="small"
                        placeholder="e.g. 1,3"
                        value={extractPages}
                        onChange={(e) => setExtractPages(e.target.value)}
                        sx={{ width: 280 }}
                      />
                      <Button type="button" variant="contained" id="pdf-extract-button" onClick={handleExtract} disabled={busy !== null || wasmReady === false}>
                        {busy === 'Extracted PDF' ? 'Extracting…' : 'Extract'}
                      </Button>
                    </Stack>
                  </Box>

                  <Box>
                    <Typography variant="subtitle2" component="label" htmlFor="pdf-remove-pages">
                      Remove pages
                    </Typography>
                    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <TextField
                        id="pdf-remove-pages"
                        size="small"
                        placeholder="e.g. 2"
                        value={removePages}
                        onChange={(e) => setRemovePages(e.target.value)}
                        sx={{ width: 280 }}
                      />
                      <Button type="button" variant="contained" id="pdf-remove-button" onClick={handleRemove} disabled={busy !== null || wasmReady === false}>
                        {busy === 'Removed pages' ? 'Removing…' : 'Remove'}
                      </Button>
                    </Stack>
                  </Box>

                  <Box>
                    <Typography variant="subtitle2" component="label" htmlFor="pdf-reorder-order">
                      Reorder pages
                    </Typography>
                    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <TextField
                        id="pdf-reorder-order"
                        size="small"
                        placeholder={`e.g. ${pageCount >= 3 ? '3,1,2' : '1'} (every page exactly once)`}
                        value={reorderOrder}
                        onChange={(e) => setReorderOrder(e.target.value)}
                        sx={{ width: 280 }}
                      />
                      <Button type="button" variant="contained" id="pdf-reorder-button" onClick={handleReorder} disabled={busy !== null || wasmReady === false}>
                        {busy === 'Reordered PDF' ? 'Reordering…' : 'Reorder'}
                      </Button>
                    </Stack>
                  </Box>

                  <Box>
                    <Typography variant="subtitle2" component="label" htmlFor="pdf-duplicate-pages">
                      Duplicate pages
                    </Typography>
                    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <TextField
                        id="pdf-duplicate-pages"
                        size="small"
                        placeholder="e.g. 1"
                        value={duplicatePages}
                        onChange={(e) => setDuplicatePages(e.target.value)}
                        sx={{ width: 280 }}
                      />
                      <Button type="button" variant="contained" id="pdf-duplicate-button" onClick={handleDuplicate} disabled={busy !== null || wasmReady === false}>
                        {busy === 'Duplicated pages' ? 'Duplicating…' : 'Duplicate'}
                      </Button>
                    </Stack>
                  </Box>

                  <Stack direction="row" spacing={1.5} flexWrap="wrap">
                    <Button type="button" variant="outlined" id="pdf-reverse-button" onClick={() => void runOp('Reversed PDF', '{"kind":"reverse"}', 'reversed')} disabled={busy !== null || wasmReady === false}>
                      {busy === 'Reversed PDF' ? 'Reversing…' : 'Reverse order'}
                    </Button>
                    <Button type="button" variant="outlined" id="pdf-booklet-button" onClick={() => void runOp('Booklet PDF', '{"kind":"booklet"}', 'booklet')} disabled={busy !== null || wasmReady === false}>
                      {busy === 'Booklet PDF' ? 'Making booklet…' : 'Booklet layout'}
                    </Button>
                  </Stack>

                  <Box>
                    <Typography variant="subtitle2">N-up layout</Typography>
                    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <Select native id="pdf-nup-cols" value={nupCols} onChange={(e) => setNupCols(Number(e.target.value))} aria-label="N-up columns">
                        {[1, 2, 3, 4].map((n) => (
                          <option key={n} value={n}>{n} columns</option>
                        ))}
                      </Select>
                      <Select native id="pdf-nup-rows" value={nupRows} onChange={(e) => setNupRows(Number(e.target.value))} aria-label="N-up rows">
                        {[1, 2, 3, 4].map((n) => (
                          <option key={n} value={n}>{n} rows</option>
                        ))}
                      </Select>
                      <Button
                        type="button"
                        variant="contained"
                        id="pdf-nup-button"
                        onClick={() => void runOp('N-up PDF', JSON.stringify({ kind: 'nup', cols: nupCols, rows: nupRows }), 'nup')}
                        disabled={busy !== null || wasmReady === false}
                      >
                        {busy === 'N-up PDF' ? 'Laying out…' : 'Make N-up'}
                      </Button>
                    </Stack>
                  </Box>

                  <Box>
                    <Typography variant="subtitle2" component="label" htmlFor="pdf-split-ranges">
                      Split into documents
                    </Typography>
                    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <TextField
                        id="pdf-split-ranges"
                        size="small"
                        placeholder="e.g. 1-3,5-7"
                        value={splitRanges}
                        onChange={(e) => setSplitRanges(e.target.value)}
                        sx={{ width: 280 }}
                      />
                      <Button type="button" variant="contained" id="pdf-split-button" onClick={handleSplit} disabled={busy !== null || wasmReady === false}>
                        {busy === 'Split PDF' ? 'Splitting…' : 'Split'}
                      </Button>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      One output document per range — each gets its own download below.
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  Merge
                </Typography>
                <Stack spacing={2} sx={{ mt: 1 }}>
                  <Typography variant="body2">
                    {secondFile
                      ? `Second PDF: ${secondFile.name} — it will be appended after ${file.name}.`
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
                    <Button
                      type="button"
                      variant="contained"
                      id="pdf-merge-button"
                      onClick={() => void handleMerge()}
                      disabled={!secondBytes || busy !== null || wasmReady === false}
                    >
                      {busy === 'Merged PDF' ? 'Merging…' : 'Merge PDFs'}
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </>
        )}

        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              Images to PDF
            </Typography>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {imageFiles.length === 0 ? (
                <DropZone
                  inputId="pdf-images-file"
                  label="Drop images here"
                  hint="PNG, JPEG, WebP and the other formats this browser decodes — one PDF page per image, in order. Nothing is uploaded."
                  multiple
                  accept="image/*"
                  onFiles={(files) => setImageFiles(files)}
                />
              ) : (
                <>
                  <Typography variant="body2">
                    {imageFiles.length} image{imageFiles.length === 1 ? '' : 's'}: {imageFiles.map((f) => f.name).join(', ')}
                  </Typography>
                  <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap">
                    <Box>
                      <Typography variant="subtitle2" component="label" htmlFor="pdf-images-page-size" sx={{ display: 'block' }}>
                        Page size
                      </Typography>
                      <Select
                        native
                        id="pdf-images-page-size"
                        value={imagePageSize}
                        onChange={(e) => setImagePageSize(e.target.value as PdfPageSize)}
                        sx={{ mt: 0.5, minWidth: 140 }}
                      >
                        {PDF_PAGE_SIZES.map((s) => (
                          <option key={s} value={s}>{s === 'Original' ? 'Original image size' : s}</option>
                        ))}
                      </Select>
                    </Box>
                    <Button
                      type="button"
                      variant="contained"
                      id="pdf-from-images-button"
                      onClick={() => void handleFromImages()}
                      disabled={busy !== null || wasmReady === false}
                    >
                      {busy === 'Images to PDF' ? 'Building…' : 'Build PDF from images'}
                    </Button>
                    <Button type="button" variant="outlined" onClick={() => setImageFiles([])}>
                      Choose different images
                    </Button>
                  </Stack>
                </>
              )}
            </Stack>
          </CardContent>
        </Card>

        <Box
          role="status"
          sx={{
            borderRadius: 3,
            border: 1,
            borderColor: (t) => alpha(t.palette.info.main, 0.4),
            bgcolor: (t) => alpha(t.palette.info.main, 0.08),
            p: 2.5,
          }}
        >
          <Typography variant="body2">
            Insert and replace pages need the native CLI or desktop app — they are not
            available in the browser. Rendering with PDFium is CLI/desktop-only too
            (<Typography component="code" variant="body2">openpixel pdf render</Typography>).
          </Typography>
        </Box>

        {status && results.length > 0 && (
          <Box
            role="status"
            sx={{
              borderRadius: 3,
              border: 1,
              borderColor: (t) => alpha(t.palette.success.main, 0.4),
              bgcolor: (t) => alpha(t.palette.success.main, 0.08),
              p: 2.5,
            }}
          >
            <Typography variant="body1" fontWeight={600} color="success.main" id="pdf-result-status">
              {status}
            </Typography>
            <Stack direction="row" flexWrap="wrap" spacing={1.5} sx={{ mt: 1.5 }}>
              {results.map((r, i) => (
                <Button
                  key={r.filename}
                  type="button"
                  variant="contained"
                  color="success"
                  id={`pdf-download-${i}`}
                  startIcon={<DownloadIcon />}
                  onClick={() => downloadBlob(r.blob, r.filename)}
                >
                  Download {r.filename}
                </Button>
              ))}
            </Stack>
          </Box>
        )}

        {status && results.length === 0 && (
          <Box
            role="status"
            sx={{
              borderRadius: 3,
              border: 1,
              borderColor: (t) => alpha(t.palette.success.main, 0.4),
              bgcolor: (t) => alpha(t.palette.success.main, 0.08),
              p: 2.5,
            }}
          >
            <Typography variant="body1" fontWeight={600} color="success.main" id="pdf-result-status">
              {status}
            </Typography>
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Box>
  )
}
