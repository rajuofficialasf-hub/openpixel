import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  Grid,
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
  hexToRgb,
  parsePageList,
  parsePageRanges,
  parseReorder,
  pdfCompress,
  pdfEdit,
  pdfFlatten,
  pdfFromImages,
  pdfInspect,
  pdfMerge,
  pdfOutputName,
  pdfProcess,
  pdfRedact,
  pdfRepair,
  pdfSanitize,
  pdfSetMetadata,
  renderPdfPage,
  renderPdfPageBlob,
  PDF_COMPRESS_MODES,
  PDF_PAGE_SIZES,
  PDF_RENDER_SCALES,
  type PdfCompressMode,
  type PdfInfo,
  type PdfOverlayOp,
  type PdfPageSize,
  type PdfRedaction,
  type PdfThreats,
} from '../lib/pdf'
import { loadWasmEngine } from '../lib/wasm-engine'
import { recordActivity } from '../lib/activity'
import { DropZone } from './DropZone'
import { PdfThumbnails } from './PdfThumbnails'

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

export function PdfWorkspace({
  initialFiles,
  onInitialFilesConsumed,
}: {
  /** A PDF handed over from the homepage upload — consumed once on mount. */
  initialFiles?: File[]
  onInitialFilesConsumed?: () => void
}) {
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

  const [compressMode, setCompressMode] = useState<PdfCompressMode>('ebook')
  const [compressStrip, setCompressStrip] = useState(false)

  // Edit (Studio Phase 5) — overlays, redaction, metadata, clean-up.
  // Coordinates are PDF points, origin bottom left (the same units
  // the info panel shows for page sizes).
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
  const [redactText, setRedactText] = useState('')
  const [redactPage, setRedactPage] = useState('1')
  const [redactX, setRedactX] = useState('72')
  const [redactY, setRedactY] = useState('600')
  const [redactW, setRedactW] = useState('200')
  const [redactH, setRedactH] = useState('20')
  const [metaTitle, setMetaTitle] = useState('')
  const [metaAuthor, setMetaAuthor] = useState('')
  const [metaSubject, setMetaSubject] = useState('')
  const [metaKeywords, setMetaKeywords] = useState('')
  const [threats, setThreats] = useState<PdfThreats | null>(null)

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

  const handleFiles = useCallback(async (files: File[]) => {
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
    // An encrypted PDF reports `encrypted: true` instead of
    // erroring — refuse it here: the browser cannot open it
    // (every WASM op and pdf.js refuse encrypted inputs), so the
    // native CLI is the only route. Name the algorithm when the
    // engine read it.
    const pdfInfo = await getPdfInfo(data)
    if (pdfInfo?.encrypted) {
      setFile(null)
      setBytes(null)
      setError(
        pdfInfo.encryption
          ? `This PDF is encrypted (${pdfInfo.encryption.algorithm}). Encrypted PDFs cannot be opened in the browser; use the native CLI.`
          : 'This PDF is encrypted. Encrypted PDFs cannot be opened in the browser; use the native CLI.',
      )
      setLoading(false)
      return
    }
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
  }, [])

  // Homepage hand-off: a PDF dropped on the home page arrives here
  // already loaded. Consume it once; the ref guard also covers
  // StrictMode's double effect run in development.
  const initialConsumedRef = useRef(false)
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0 && !initialConsumedRef.current) {
      initialConsumedRef.current = true
      void handleFiles(initialFiles)
      onInitialFilesConsumed?.()
    }
  }, [initialFiles, handleFiles, onInitialFilesConsumed])

  // Workspace history: record one entry per produced result set.
  // The identity check matters — preview rendering sets `status`
  // without producing results, and must not re-record the previous
  // operation.
  const recordedResultsRef = useRef<PdfResult[] | null>(null)
  useEffect(() => {
    if (results.length > 0 && recordedResultsRef.current !== results && status && file) {
      recordedResultsRef.current = results
      recordActivity({
        fileName: file.name,
        fileSize: file.size,
        fileType: 'application/pdf',
        tool: 'pdf',
        result: status,
      })
    }
  }, [results, status, file])

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

  const handleCompress = async () => {
    if (!bytes || !file) return
    setBusy('Compressed PDF')
    setError(null)
    setStatus(null)
    const result = await pdfCompress(bytes, compressMode, compressStrip)
    if (!result) {
      setError(
        'Compression needs the WASM engine, which is not loaded — rebuild the web app with npm run build:wasm. No file was produced.',
      )
      setBusy(null)
      return
    }
    setResults([
      {
        label: 'Compressed PDF',
        blob: new Blob([result.data as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(file.name, 'compressed'),
        pages: pageCount,
      },
    ])
    setStatus(
      result.note
        ? `Compressed PDF: ${formatBytes(result.inputBytes)} → ${formatBytes(result.outputBytes)} — ${result.note}`
        : `Compressed PDF: ${formatBytes(result.inputBytes)} → ${formatBytes(result.outputBytes)} (${result.savedPercent.toFixed(1)}% smaller, ${result.imagesRecompressed} image${result.imagesRecompressed === 1 ? '' : 's'} recompressed)`,
    )
    setBusy(null)
  }

  // --- Edit (Studio Phase 5) -------------------------------------------
  // Every handler maps to one real WASM engine call and reports the
  // real outcome. Coordinates are PDF points, origin bottom left.
  const wasmMissing = (label: string) =>
    `${label} needs the WASM engine, which is not loaded — rebuild the web app with npm run build:wasm. No file was produced.`

  const editPageNumber = (): number | null => {
    const n = Number(editPage)
    return Number.isInteger(n) && n >= 1 && n <= pageCount ? n : null
  }

  const editNumber = (value: string): number | null => {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  const runEdit = async (label: string, ops: PdfOverlayOp[], suffix: string) => {
    if (!bytes || !file) return
    setBusy(label)
    setError(null)
    setStatus(null)
    const result = await pdfEdit(bytes, ops, [])
    if (!result) {
      setError(wasmMissing(label))
      setBusy(null)
      return
    }
    setResults([
      {
        label,
        blob: new Blob([result.data as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(file.name, suffix),
        pages: pageCount,
      },
    ])
    setStatus(
      `${label}: ${result.opsApplied} op${result.opsApplied === 1 ? '' : 's'} on ${result.pagesTouched} page${result.pagesTouched === 1 ? '' : 's'}${result.commentsAdded > 0 ? `, ${result.commentsAdded} comment${result.commentsAdded === 1 ? '' : 's'}` : ''}${result.warnings.length > 0 ? ` — ${result.warnings.join('; ')}` : ''}`,
    )
    setBusy(null)
  }

  const handleEditText = () => {
    const page = editPageNumber()
    const x = editNumber(editX)
    const y = editNumber(editY)
    const size = editNumber(editSize)
    const color = hexToRgb(editColor)
    if (!page || x === null || y === null || size === null || size <= 0 || !color || editText.trim() === '') {
      setError('Check the text overlay — page 1–' + pageCount + ', numbers for X/Y/size, a #RRGGBB colour, and some text.')
      return
    }
    void runEdit('Edited PDF', [{ kind: 'text', page, x, y, text: editText, size, color, font: 'helvetica' }], 'edited')
  }

  const handlePageNumbers = () => {
    if (pageNumFormat.trim() === '') {
      setError('Give a page-number format, e.g. "Page {n} of {total}".')
      return
    }
    void runEdit(
      'Edited PDF',
      [{ kind: 'page_numbers', pages: null, format: pageNumFormat, position: pageNumPosition, size: 10 }],
      'edited',
    )
  }

  const handleHeaderFooter = () => {
    if (headerText.trim() === '' && footerText.trim() === '') {
      setError('Give a header, a footer, or both.')
      return
    }
    void runEdit(
      'Edited PDF',
      [{ kind: 'header_footer', pages: null, header: headerText.trim() || null, footer: footerText.trim() || null, size: 10 }],
      'edited',
    )
  }

  const handleHighlight = () => {
    const page = Number(highlightPage)
    const x = editNumber(highlightX)
    const y = editNumber(highlightY)
    const w = editNumber(highlightW)
    const h = editNumber(highlightH)
    const color = hexToRgb(highlightColor)
    if (!Number.isInteger(page) || page < 1 || page > pageCount || x === null || y === null || w === null || h === null || w <= 0 || h <= 0 || !color) {
      setError('Check the highlight — page 1–' + pageCount + ', numbers for X/Y/width/height, and a #RRGGBB colour.')
      return
    }
    void runEdit(
      'Edited PDF',
      [{ kind: 'highlight', page, x, y, width: w, height: h, color, opacity: 0.4 }],
      'edited',
    )
  }

  const runRedact = async (label: string, redactions: PdfRedaction[], suffix: string) => {
    if (!bytes || !file) return
    setBusy(label)
    setError(null)
    setStatus(null)
    const result = await pdfRedact(bytes, redactions)
    if (!result) {
      setError(wasmMissing(label))
      setBusy(null)
      return
    }
    setResults([
      {
        label,
        blob: new Blob([result.data as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(file.name, suffix),
        pages: pageCount,
      },
    ])
    setStatus(
      result.runsRemoved === 0
        ? `${label}: nothing matched — the text was not found, so the file is unchanged.`
        : `${label}: ${result.runsRemoved} run${result.runsRemoved === 1 ? '' : 's'}, ${result.charactersRemoved} character${result.charactersRemoved === 1 ? '' : 's'} removed on ${result.pagesTouched} page${result.pagesTouched === 1 ? '' : 's'} — the text is gone from the file, not covered up.`,
    )
    setBusy(null)
  }

  const handleRedactText = () => {
    if (redactText.trim() === '') {
      setError('Type the text to redact.')
      return
    }
    void runRedact('Redacted PDF', [{ kind: 'text', page: null, text: redactText }], 'redacted')
  }

  const handleRedactRect = () => {
    const page = Number(redactPage)
    const x = editNumber(redactX)
    const y = editNumber(redactY)
    const w = editNumber(redactW)
    const h = editNumber(redactH)
    if (!Number.isInteger(page) || page < 1 || page > pageCount || x === null || y === null || w === null || h === null || w <= 0 || h <= 0) {
      setError('Check the redaction area — page 1–' + pageCount + ' and numbers for X/Y/width/height.')
      return
    }
    void runRedact('Redacted PDF', [{ kind: 'rect', page, x, y, width: w, height: h }], 'redacted')
  }

  const handleSetMetadata = async () => {
    if (!bytes || !file) return
    if (metaTitle === '' && metaAuthor === '' && metaSubject === '' && metaKeywords === '') {
      setError('Type at least one metadata field — leave a field blank to keep it, or clear it from the CLI with an empty string.')
      return
    }
    setBusy('Metadata PDF')
    setError(null)
    setStatus(null)
    const out = await pdfSetMetadata(bytes, {
      title: metaTitle === '' ? null : metaTitle,
      author: metaAuthor === '' ? null : metaAuthor,
      subject: metaSubject === '' ? null : metaSubject,
      keywords: metaKeywords === '' ? null : metaKeywords,
    })
    if (!out) {
      setError(wasmMissing('Set metadata'))
      setBusy(null)
      return
    }
    setResults([
      {
        label: 'Metadata PDF',
        blob: new Blob([out as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(file.name, 'metadata'),
        pages: pageCount,
      },
    ])
    setStatus('Metadata PDF: title/author/subject/keywords updated (blank fields were left unchanged).')
    setBusy(null)
  }

  const handleInspectThreats = async () => {
    if (!bytes || !file) return
    setBusy('Threat check')
    setError(null)
    setStatus(null)
    const found = await pdfInspect(bytes)
    if (!found) {
      setError(wasmMissing('Threat check'))
      setBusy(null)
      return
    }
    setThreats(found)
    const total = found.javascript.length + found.embedded_files.length + found.launch_actions.length + found.auto_actions.length
    setStatus(
      total === 0
        ? 'Threat check: clean — no JavaScript, embedded files, launch actions or auto-actions found.'
        : `Threat check: ${total} threat${total === 1 ? '' : 's'} found — ${found.javascript.length} JavaScript, ${found.embedded_files.length} embedded file${found.embedded_files.length === 1 ? '' : 's'}, ${found.launch_actions.length} launch action${found.launch_actions.length === 1 ? '' : 's'}, ${found.auto_actions.length} auto-action${found.auto_actions.length === 1 ? '' : 's'}. Use "Remove threats" to strip them.`,
    )
    setBusy(null)
  }

  const handleSanitize = async () => {
    if (!bytes || !file) return
    setBusy('Cleaned PDF')
    setError(null)
    setStatus(null)
    const result = await pdfSanitize(bytes)
    if (!result) {
      setError(wasmMissing('Clean up'))
      setBusy(null)
      return
    }
    setResults([
      {
        label: 'Cleaned PDF',
        blob: new Blob([result.data as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(file.name, 'cleaned'),
        pages: pageCount,
      },
    ])
    const total = result.javascriptRemoved + result.embeddedFilesRemoved + result.launchActionsRemoved + result.autoActionsRemoved
    setStatus(
      total === 0
        ? 'Cleaned PDF: nothing dangerous was found — the file is unchanged.'
        : `Cleaned PDF: ${result.javascriptRemoved} JavaScript, ${result.embeddedFilesRemoved} embedded file${result.embeddedFilesRemoved === 1 ? '' : 's'}, ${result.launchActionsRemoved} launch action${result.launchActionsRemoved === 1 ? '' : 's'}, ${result.autoActionsRemoved} auto-action${result.autoActionsRemoved === 1 ? '' : 's'} removed. The document is kept; the dangerous parts are gone, not hidden.`,
    )
    setBusy(null)
  }

  const handleFlatten = async () => {
    if (!bytes || !file) return
    setBusy('Flattened PDF')
    setError(null)
    setStatus(null)
    const result = await pdfFlatten(bytes)
    if (!result) {
      setError(wasmMissing('Flatten'))
      setBusy(null)
      return
    }
    setResults([
      {
        label: 'Flattened PDF',
        blob: new Blob([result.data as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(file.name, 'flattened'),
        pages: pageCount,
      },
    ])
    setStatus(
      `Flattened PDF: ${result.annotationsFlattened} annotation${result.annotationsFlattened === 1 ? '' : 's'} flattened, ${result.annotationsDropped} dropped, ${result.formFieldsRemoved} form field${result.formFieldsRemoved === 1 ? '' : 's'} removed.`,
    )
    setBusy(null)
  }

  const handleRepair = async () => {
    if (!bytes || !file) return
    setBusy('Repaired PDF')
    setError(null)
    setStatus(null)
    const result = await pdfRepair(bytes)
    if (!result) {
      setError(wasmMissing('Repair'))
      setBusy(null)
      return
    }
    setResults([
      {
        label: 'Repaired PDF',
        blob: new Blob([result.data as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(file.name, 'repaired'),
        pages: pageCount,
      },
    ])
    setStatus(`Repaired PDF: cross-reference table read "${result.recovery}".`)
    setBusy(null)
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

  // Shared blocks: the center column (file loaded) and the empty
  // state both show Images-to-PDF and the CLI-only note, so they
  // live here instead of being duplicated.
  const imagesToPdfCard = (
    <Card>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          Images to PDF
        </Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {imageFiles.length === 0 ? (
            <DropZone
              compact
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
  )

  const cliOnlyNote = (
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
        Office documents (Word, Excel, PowerPoint) convert only in the CLI or desktop
        app (<Typography component="code" variant="body2">openpixel doc convert</Typography>)
        — LibreOffice cannot run in a browser.
      </Typography>
    </Box>
  )

  const resultBoxes = (
    <>
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
    </>
  )

  return (
    <Box
      component="section"
      aria-labelledby="pdf-heading"
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
          <Typography variant="h5" component="h2" id="pdf-heading">
            PDF tools
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Page operations, compression and editing — entirely in your browser.
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
          <Stack spacing={2} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 }, '& > *': { flexShrink: 0 } }}>
            <DropZone
              inputId="pdf-file"
              label="Drop a PDF here"
              hint="One PDF at a time. Info, preview and page operations run locally — nothing is uploaded."
              multiple={false}
              accept="application/pdf,.pdf"
              compact
              onFiles={(files) => void handleFiles(files)}
            />
            {imagesToPdfCard}
            {cliOnlyNote}
          </Stack>
        )}

        {loading && (
          <Typography role="status" variant="body2" color="text.secondary">
            Reading PDF…
          </Typography>
        )}

        {file && bytes && (
          <Grid
            container
            spacing={2}
            alignItems="stretch"
            sx={{ flex: { lg: 1 }, minHeight: { lg: 0 } }}
          >
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
              {imagesToPdfCard}
              {cliOnlyNote}
              {resultBoxes}
              </Stack>
            </Grid>
            <Grid size={{ xs: 12, lg: 4 }} sx={{ display: 'flex', flexDirection: 'column', height: { lg: '100%' }, minHeight: { lg: 0 } }}>
              <Stack spacing={2} id="pdf-ops-panel" sx={{ flex: { lg: 1 }, minHeight: { lg: 0 }, overflowY: { lg: 'auto' }, pr: { lg: 0.5 }, '& > *': { flexShrink: 0 } }}>
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
                  Compress
                </Typography>
                <Stack spacing={2} sx={{ mt: 1 }}>
                  <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap">
                    <Box>
                      <Typography variant="subtitle2" component="label" htmlFor="pdf-compress-mode" sx={{ display: 'block' }}>
                        Mode
                      </Typography>
                      <Select
                        native
                        id="pdf-compress-mode"
                        value={compressMode}
                        onChange={(e) => setCompressMode(e.target.value as PdfCompressMode)}
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
                        <Checkbox
                          id="pdf-compress-strip"
                          checked={compressStrip}
                          onChange={(e) => setCompressStrip(e.target.checked)}
                        />
                      }
                      label="Strip document metadata (title, author…)"
                    />
                    <Button
                      type="button"
                      variant="contained"
                      id="pdf-compress-button"
                      onClick={() => void handleCompress()}
                      disabled={busy !== null || wasmReady === false}
                    >
                      {busy === 'Compressed PDF' ? 'Compressing…' : 'Compress'}
                    </Button>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Images are downsampled to the mode's DPI and re-encoded; the file structure
                    is optimised too. If a mode cannot shrink this PDF, the original is kept
                    and the result says so.
                  </Typography>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  Edit — add content
                </Typography>
                <Stack spacing={2} sx={{ mt: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Overlays are new content layered on top of the page. Existing text is never
                    edited in place — coordinates are PDF points, origin bottom left.
                  </Typography>
                  <Box>
                    <Typography variant="subtitle2">Add text</Typography>
                    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <TextField
                        id="pdf-edit-text"
                        size="small"
                        label="Text"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        sx={{ width: 220 }}
                      />
                      <TextField
                        id="pdf-edit-page"
                        size="small"
                        label="Page"
                        type="number"
                        value={editPage}
                        onChange={(e) => setEditPage(e.target.value)}
                        sx={{ width: 90 }}
                      />
                      <TextField
                        id="pdf-edit-x"
                        size="small"
                        label="X (pt)"
                        type="number"
                        value={editX}
                        onChange={(e) => setEditX(e.target.value)}
                        sx={{ width: 90 }}
                      />
                      <TextField
                        id="pdf-edit-y"
                        size="small"
                        label="Y (pt)"
                        type="number"
                        value={editY}
                        onChange={(e) => setEditY(e.target.value)}
                        sx={{ width: 90 }}
                      />
                      <TextField
                        id="pdf-edit-size"
                        size="small"
                        label="Size (pt)"
                        type="number"
                        value={editSize}
                        onChange={(e) => setEditSize(e.target.value)}
                        sx={{ width: 90 }}
                      />
                      <TextField
                        id="pdf-edit-color"
                        size="small"
                        label="Colour"
                        type="color"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        sx={{ width: 70 }}
                      />
                      <Button
                        type="button"
                        variant="contained"
                        id="pdf-edit-text-button"
                        onClick={handleEditText}
                        disabled={busy !== null || wasmReady === false}
                      >
                        {busy === 'Edited PDF' ? 'Adding…' : 'Add text'}
                      </Button>
                    </Stack>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2">Page numbers &amp; header / footer</Typography>
                    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <TextField
                        id="pdf-edit-pagenum-format"
                        size="small"
                        label="Page-number format"
                        value={pageNumFormat}
                        onChange={(e) => setPageNumFormat(e.target.value)}
                        sx={{ width: 220 }}
                      />
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
                      <Button
                        type="button"
                        variant="contained"
                        id="pdf-edit-pagenum-button"
                        onClick={handlePageNumbers}
                        disabled={busy !== null || wasmReady === false}
                      >
                        {busy === 'Edited PDF' ? 'Adding…' : 'Add page numbers'}
                      </Button>
                    </Stack>
                    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 1.5 }}>
                      <TextField
                        id="pdf-edit-header"
                        size="small"
                        label="Header"
                        value={headerText}
                        onChange={(e) => setHeaderText(e.target.value)}
                        sx={{ width: 220 }}
                      />
                      <TextField
                        id="pdf-edit-footer"
                        size="small"
                        label="Footer"
                        value={footerText}
                        onChange={(e) => setFooterText(e.target.value)}
                        sx={{ width: 220 }}
                      />
                      <Button
                        type="button"
                        variant="contained"
                        id="pdf-edit-header-footer-button"
                        onClick={handleHeaderFooter}
                        disabled={busy !== null || wasmReady === false}
                      >
                        {busy === 'Edited PDF' ? 'Adding…' : 'Add header / footer'}
                      </Button>
                    </Stack>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2">Highlight an area</Typography>
                    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <TextField
                        id="pdf-highlight-page"
                        size="small"
                        label="Page"
                        type="number"
                        value={highlightPage}
                        onChange={(e) => setHighlightPage(e.target.value)}
                        sx={{ width: 90 }}
                      />
                      <TextField
                        id="pdf-highlight-x"
                        size="small"
                        label="X (pt)"
                        type="number"
                        value={highlightX}
                        onChange={(e) => setHighlightX(e.target.value)}
                        sx={{ width: 90 }}
                      />
                      <TextField
                        id="pdf-highlight-y"
                        size="small"
                        label="Y (pt)"
                        type="number"
                        value={highlightY}
                        onChange={(e) => setHighlightY(e.target.value)}
                        sx={{ width: 90 }}
                      />
                      <TextField
                        id="pdf-highlight-w"
                        size="small"
                        label="Width (pt)"
                        type="number"
                        value={highlightW}
                        onChange={(e) => setHighlightW(e.target.value)}
                        sx={{ width: 100 }}
                      />
                      <TextField
                        id="pdf-highlight-h"
                        size="small"
                        label="Height (pt)"
                        type="number"
                        value={highlightH}
                        onChange={(e) => setHighlightH(e.target.value)}
                        sx={{ width: 100 }}
                      />
                      <TextField
                        id="pdf-highlight-color"
                        size="small"
                        label="Colour"
                        type="color"
                        value={highlightColor}
                        onChange={(e) => setHighlightColor(e.target.value)}
                        sx={{ width: 70 }}
                      />
                      <Button
                        type="button"
                        variant="contained"
                        id="pdf-highlight-button"
                        onClick={handleHighlight}
                        disabled={busy !== null || wasmReady === false}
                      >
                        {busy === 'Edited PDF' ? 'Highlighting…' : 'Highlight'}
                      </Button>
                    </Stack>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  Redact — really remove text
                </Typography>
                <Stack spacing={2} sx={{ mt: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Redaction deletes the text from the file — it is not a black box over it.
                    The removed text cannot be recovered from the output.
                  </Typography>
                  <Box>
                    <Typography variant="subtitle2">Redact text</Typography>
                    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <TextField
                        id="pdf-redact-text"
                        size="small"
                        label="Text to remove"
                        value={redactText}
                        onChange={(e) => setRedactText(e.target.value)}
                        sx={{ width: 280 }}
                      />
                      <Button
                        type="button"
                        variant="contained"
                        id="pdf-redact-text-button"
                        onClick={handleRedactText}
                        disabled={busy !== null || wasmReady === false}
                      >
                        {busy === 'Redacted PDF' ? 'Redacting…' : 'Redact text'}
                      </Button>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      Every occurrence on every page, case-sensitive.
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2">Redact an area</Typography>
                    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <TextField
                        id="pdf-redact-page"
                        size="small"
                        label="Page"
                        type="number"
                        value={redactPage}
                        onChange={(e) => setRedactPage(e.target.value)}
                        sx={{ width: 90 }}
                      />
                      <TextField
                        id="pdf-redact-x"
                        size="small"
                        label="X (pt)"
                        type="number"
                        value={redactX}
                        onChange={(e) => setRedactX(e.target.value)}
                        sx={{ width: 90 }}
                      />
                      <TextField
                        id="pdf-redact-y"
                        size="small"
                        label="Y (pt)"
                        type="number"
                        value={redactY}
                        onChange={(e) => setRedactY(e.target.value)}
                        sx={{ width: 90 }}
                      />
                      <TextField
                        id="pdf-redact-w"
                        size="small"
                        label="Width (pt)"
                        type="number"
                        value={redactW}
                        onChange={(e) => setRedactW(e.target.value)}
                        sx={{ width: 100 }}
                      />
                      <TextField
                        id="pdf-redact-h"
                        size="small"
                        label="Height (pt)"
                        type="number"
                        value={redactH}
                        onChange={(e) => setRedactH(e.target.value)}
                        sx={{ width: 100 }}
                      />
                      <Button
                        type="button"
                        variant="contained"
                        id="pdf-redact-rect-button"
                        onClick={handleRedactRect}
                        disabled={busy !== null || wasmReady === false}
                      >
                        {busy === 'Redacted PDF' ? 'Redacting…' : 'Redact area'}
                      </Button>
                    </Stack>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  Metadata &amp; clean-up
                </Typography>
                <Stack spacing={2} sx={{ mt: 1 }}>
                  <Box>
                    <Typography variant="subtitle2">Document metadata</Typography>
                    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <TextField
                        id="pdf-meta-title"
                        size="small"
                        label="Title"
                        value={metaTitle}
                        onChange={(e) => setMetaTitle(e.target.value)}
                        sx={{ width: 200 }}
                      />
                      <TextField
                        id="pdf-meta-author"
                        size="small"
                        label="Author"
                        value={metaAuthor}
                        onChange={(e) => setMetaAuthor(e.target.value)}
                        sx={{ width: 160 }}
                      />
                      <TextField
                        id="pdf-meta-subject"
                        size="small"
                        label="Subject"
                        value={metaSubject}
                        onChange={(e) => setMetaSubject(e.target.value)}
                        sx={{ width: 160 }}
                      />
                      <TextField
                        id="pdf-meta-keywords"
                        size="small"
                        label="Keywords"
                        value={metaKeywords}
                        onChange={(e) => setMetaKeywords(e.target.value)}
                        sx={{ width: 160 }}
                      />
                      <Button
                        type="button"
                        variant="contained"
                        id="pdf-meta-button"
                        onClick={() => void handleSetMetadata()}
                        disabled={busy !== null || wasmReady === false}
                      >
                        {busy === 'Metadata PDF' ? 'Saving…' : 'Set metadata'}
                      </Button>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      Blank fields are left unchanged. To clear a field, use the native CLI
                      (`openpixel pdf set-metadata --title ""`).
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2">Check &amp; clean up</Typography>
                    <Stack direction="row" spacing={1.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <Button
                        type="button"
                        variant="outlined"
                        id="pdf-inspect-button"
                        onClick={() => void handleInspectThreats()}
                        disabled={busy !== null || wasmReady === false}
                      >
                        {busy === 'Threat check' ? 'Checking…' : 'Check for threats'}
                      </Button>
                      <Button
                        type="button"
                        variant="contained"
                        id="pdf-sanitize-button"
                        onClick={() => void handleSanitize()}
                        disabled={busy !== null || wasmReady === false}
                      >
                        {busy === 'Cleaned PDF' ? 'Cleaning…' : 'Remove threats'}
                      </Button>
                      <Button
                        type="button"
                        variant="outlined"
                        id="pdf-flatten-button"
                        onClick={() => void handleFlatten()}
                        disabled={busy !== null || wasmReady === false}
                      >
                        {busy === 'Flattened PDF' ? 'Flattening…' : 'Flatten annotations'}
                      </Button>
                      <Button
                        type="button"
                        variant="outlined"
                        id="pdf-repair-button"
                        onClick={() => void handleRepair()}
                        disabled={busy !== null || wasmReady === false}
                      >
                        {busy === 'Repaired PDF' ? 'Repairing…' : 'Repair file'}
                      </Button>
                    </Stack>
                    {threats && (
                      <Typography variant="body2" sx={{ mt: 1 }} role="status">
                        {threats.javascript.length + threats.embedded_files.length + threats.launch_actions.length + threats.auto_actions.length === 0
                          ? 'Threat check: clean — no JavaScript, embedded files, launch actions or auto-actions.'
                          : `Threats found: ${threats.javascript.length} JavaScript, ${threats.embedded_files.length} embedded file(s), ${threats.launch_actions.length} launch action(s), ${threats.auto_actions.length} auto-action(s).`}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      Digital signatures need a private key, so signing stays in the native CLI
                      (`openpixel pdf sign`) and the desktop app — the browser never receives
                      your key.
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
                <Stack spacing={2} sx={{ mt: 1, position: 'relative' }}>
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
              </Stack>
            </Grid>
          </Grid>
        )}

      </Stack>
    </Box>
  )
}
