/**
 * PDF / OCR / document tools (Studio Phase 7).
 *
 * One focused page per tool, same pattern as the web app's
 * `/pdf/*` pages: the user first picks the tool, then that tool's
 * page shows upload, settings, ONE primary action, result + save.
 * Every tool talks to the Rust backend through `lib/tauri.ts` —
 * no conversion logic lives in the frontend.
 *
 * Honest limits shown in the UI, not hidden:
 * - Text extraction and PDF → image need libpdfium, which this
 *   build does not ship (Phase 8). Those tools show the warning
 *   and the backend returns the same error if run anyway.
 * - `pdf ocr` (searchable PDF) takes image pages only — a PDF
 *   input needs PDFium rendering first.
 * - The 3-panel visual editor from the web app is NOT built here:
 *   the Edit tool adds text overlays, page numbers and
 *   header/footer by coordinates (see the note on that page).
 */
import { open, save } from '@tauri-apps/plugin-dialog'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import CloseIcon from '@mui/icons-material/Close'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  defaultOutputPath,
  docConvert,
  fetchDesktopCapabilities,
  fetchDocFormats,
  fetchPdfInfo,
  fetchPdfThreats,
  fileName,
  formatBytes,
  parsePageList,
  parseRanges,
  pdfCompress,
  pdfEdit,
  pdfExtractText,
  pdfFlatten,
  pdfFromImages,
  pdfMerge,
  pdfOcrSearchable,
  pdfPageOp,
  pdfRedact,
  pdfRepair,
  pdfSanitize,
  pdfSetMetadata,
  pdfSplit,
  pdfToImages,
  ocrRecognize,
  type DesktopCapabilities,
  type DocumentConversion,
  type OcrResult,
  type PdfInfo,
  type PdfPageOpRequest,
} from '../../lib/tauri'

const PDF_FILTER = [{ name: 'PDF', extensions: ['pdf'] }]
const IMAGE_FILTER = [
  {
    name: 'Images',
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'tiff', 'bmp', 'gif', 'avif', 'jxl', 'qoi', 'tga', 'ico', 'pnm'],
  },
]
const DOC_FILTER = [
  {
    name: 'Documents',
    extensions: ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp', 'rtf', 'txt', 'csv', 'html'],
  },
]

const PDFIUM_WARNING =
  'Rendering and text extraction need libpdfium, which this build does not ship yet (Phase 8). Running this tool will fail with that explanation — it never returns a fake result.'

export const PDFIUM_NOTE = PDFIUM_WARNING

interface ToolDef {
  id: string
  group: 'PDF' | 'OCR' | 'Documents'
  title: string
  description: string
  needsPdfium?: boolean
}

const TOOLS: ToolDef[] = [
  { id: 'merge', group: 'PDF', title: 'Merge PDF', description: 'Combine several PDFs into one, in order.' },
  { id: 'split', group: 'PDF', title: 'Split PDF', description: 'Cut one PDF into parts by page ranges.' },
  { id: 'rotate', group: 'PDF', title: 'Rotate pages', description: 'Rotate all or selected pages by 90°, 180° or 270°.' },
  { id: 'extract', group: 'PDF', title: 'Extract pages', description: 'Keep only the pages you list, in the order you list them.' },
  { id: 'remove', group: 'PDF', title: 'Remove pages', description: 'Drop the pages you list, keep the rest.' },
  { id: 'reorder', group: 'PDF', title: 'Reorder pages', description: 'Rearrange all pages with a new order.' },
  { id: 'duplicate', group: 'PDF', title: 'Duplicate pages', description: 'Copy listed pages right after their originals.' },
  { id: 'reverse', group: 'PDF', title: 'Reverse order', description: 'Flip the whole page order.' },
  { id: 'booklet', group: 'PDF', title: 'Booklet imposition', description: 'Reorder pages for duplex booklet printing (pads to a multiple of 4).' },
  { id: 'nup', group: 'PDF', title: 'N-up layout', description: 'Put several source pages on each output sheet.' },
  { id: 'compress', group: 'PDF', title: 'Compress PDF', description: 'Downsample embedded images and optimise structure. Never returns a larger file as “compressed”.' },
  { id: 'edit', group: 'PDF', title: 'Edit PDF (add content)', description: 'Add a text overlay, page numbers, or a header/footer. Existing text is never edited in place.' },
  { id: 'redact', group: 'PDF', title: 'Redact', description: 'Really remove text (and cover the area) — the redacted text is gone from the file bytes.' },
  { id: 'metadata', group: 'PDF', title: 'Edit metadata', description: 'Set title, author, subject and keywords.' },
  { id: 'sanitize', group: 'PDF', title: 'Sanitize / inspect', description: 'Check for JavaScript, embedded files and auto-actions — and strip them.' },
  { id: 'flatten', group: 'PDF', title: 'Flatten', description: 'Render annotations into page content and remove them.' },
  { id: 'repair', group: 'PDF', title: 'Repair PDF', description: 'Recover a PDF with a damaged cross-reference table.' },
  { id: 'extract-text', group: 'PDF', title: 'Extract text', description: 'Read the text layer, page by page, to TXT / HTML / EPUB / DOCX.', needsPdfium: true },
  { id: 'images-to-pdf', group: 'PDF', title: 'Images to PDF', description: 'Build a PDF from images, one page per image.' },
  { id: 'pdf-to-image', group: 'PDF', title: 'PDF to images', description: 'Render pages to PNG or JPEG images.', needsPdfium: true },
  { id: 'ocr', group: 'OCR', title: 'OCR an image', description: 'Recognise text in an image with Tesseract (English + Bengali).' },
  { id: 'searchable-pdf', group: 'OCR', title: 'Searchable PDF', description: 'Turn scanned image pages into a PDF with an invisible OCR text layer.' },
  { id: 'doc-convert', group: 'Documents', title: 'Convert document', description: 'Office ↔ PDF and Office ↔ Office via LibreOffice on this machine.' },
]

// ---- shared primitives ----

function ToolShell(props: {
  tool: ToolDef
  onBack: () => void
  warning?: string | null
  children: ReactNode
  actionLabel: string
  onRun: () => void | Promise<void>
  busy: boolean
  error: string | null
  result: ReactNode
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button type="button" variant="text" startIcon={<ArrowBackIcon />} onClick={props.onBack}>
          All PDF tools
        </Button>
      </Box>
      <Box>
        <Typography variant="h5" component="h2">
          {props.tool.title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {props.tool.description}
        </Typography>
      </Box>
      {props.warning && <Alert severity="warning">{props.warning}</Alert>}
      <Card>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {props.children}
          <Box>
            <Button
              type="button"
              variant="contained"
              size="large"
              disabled={props.busy}
              onClick={() => void props.onRun()}
            >
              {props.busy ? (
                <>
                  <CircularProgress size={18} sx={{ mr: 1 }} /> Working…
                </>
              ) : (
                props.actionLabel
              )}
            </Button>
          </Box>
        </CardContent>
      </Card>
      {props.error && <Alert severity="error">{props.error}</Alert>}
      {props.result}
    </Box>
  )
}

function ResultCard(props: { title: string; children: ReactNode }) {
  return (
    <Alert severity="success" role="status">
      <Typography variant="subtitle2">{props.title}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>{props.children}</Box>
    </Alert>
  )
}

function OutputLine(props: { path: string; extra?: string }) {
  return (
    <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
      {props.path}
      {props.extra ? ` · ${props.extra}` : ''}
    </Typography>
  )
}

function PdfInfoLine({ info }: { info: PdfInfo | null }) {
  if (!info) return null
  return (
    <Typography variant="body2" color="text.secondary">
      {info.page_count} page{info.page_count === 1 ? '' : 's'} · PDF {info.version}
      {info.title ? ` · “${info.title}”` : ''}
      {info.encrypted ? ' · encrypted (page operations will refuse it)' : ''}
    </Typography>
  )
}

/** Pick files with the native dialog and list them with remove buttons. */
function FileList(props: {
  label: string
  paths: string[]
  onPick: () => void
  onRemove: (index: number) => void
  onMove?: (index: number, direction: -1 | 1) => void
  pickLabel?: string
}) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Button type="button" variant="outlined" onClick={props.onPick}>
          {props.pickLabel ?? `Choose ${props.label}`}
        </Button>
        <Typography variant="body2" color="text.secondary">
          {props.paths.length === 0
            ? `No ${props.label} chosen yet.`
            : `${props.paths.length} chosen.`}
        </Typography>
      </Box>
      {props.paths.length > 0 && (
        <Paper variant="outlined" sx={{ mt: 1, p: 1 }}>
          {props.paths.map((p, i) => (
            <Box key={p} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.25 }}>
              <Typography variant="body2" sx={{ flexGrow: 1, wordBreak: 'break-all' }}>
                {fileName(p)}
              </Typography>
              {props.onMove && (
                <>
                  <IconButton size="small" aria-label={`Move ${fileName(p)} up`} disabled={i === 0} onClick={() => props.onMove?.(i, -1)}>
                    <ArrowUpwardIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" aria-label={`Move ${fileName(p)} down`} disabled={i === props.paths.length - 1} onClick={() => props.onMove?.(i, 1)}>
                    <ArrowDownwardIcon fontSize="small" />
                  </IconButton>
                </>
              )}
              <IconButton size="small" aria-label={`Remove ${fileName(p)}`} onClick={() => props.onRemove(i)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Paper>
      )}
    </Box>
  )
}

async function pickFiles(
  filters: { name: string; extensions: string[] }[],
  multiple: boolean,
): Promise<string[]> {
  const picked = await open({ multiple, filters })
  if (typeof picked === 'string') return [picked]
  if (Array.isArray(picked)) return picked
  return []
}

async function pickSave(defaultPath: string, ext: string, name: string): Promise<string | null> {
  const out = await save({
    defaultPath,
    filters: [{ name, extensions: [ext] }],
  })
  return typeof out === 'string' ? out : null
}

function pdfDefaultOutput(input: string, suffix: string): string {
  const dot = input.lastIndexOf('.')
  const stem = dot > 0 ? input.slice(0, dot) : input
  return `${stem}-${suffix}.pdf`
}

function usePdfInfo(path: string | null): PdfInfo | null {
  const [info, setInfo] = useState<PdfInfo | null>(null)
  useEffect(() => {
    setInfo(null)
    if (!path) return
    let live = true
    void fetchPdfInfo(path)
      .then((i) => {
        if (live) setInfo(i)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [path])
  return info
}

/** Append dropped PDF/image paths to a tool's file list. */
function useDroppedPaths(
  droppedPaths: string[],
  accept: (path: string) => boolean,
  add: (paths: string[]) => void,
  onDroppedConsumed: () => void,
) {
  useEffect(() => {
    if (droppedPaths.length === 0) return
    const fresh = droppedPaths.filter(accept)
    if (fresh.length > 0) add(fresh)
    onDroppedConsumed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedPaths])
}

const isPdf = (p: string) => p.toLowerCase().endsWith('.pdf')
const isImage = (p: string) => /\.(png|jpe?g|webp|tiff?|bmp|gif|avif|jxl|qoi|tga|ico|pnm|svg)$/i.test(p)

// ---- per-tool pages ----

interface ToolProps {
  tool: ToolDef
  onBack: () => void
  caps: DesktopCapabilities | null
  droppedPaths: string[]
  onDroppedConsumed: () => void
}

function useSinglePdf(droppedPaths: string[], onDroppedConsumed: () => void) {
  const [paths, setPaths] = useState<string[]>([])
  const add = useCallback(
    (fresh: string[]) => setPaths((prev) => [...prev, ...fresh.filter((p) => !prev.includes(p))].slice(0, 1)),
    [],
  )
  useDroppedPaths(droppedPaths, isPdf, add, onDroppedConsumed)
  const pick = useCallback(async () => {
    const picked = await pickFiles(PDF_FILTER, false)
    if (picked.length > 0) setPaths(picked)
  }, [])
  const info = usePdfInfo(paths[0] ?? null)
  return { paths, setPaths, pick, info }
}

function useMultiPdf(droppedPaths: string[], onDroppedConsumed: () => void) {
  const [paths, setPaths] = useState<string[]>([])
  const add = useCallback((fresh: string[]) => {
    setPaths((prev) => {
      const seen = new Set(prev)
      return [...prev, ...fresh.filter((p) => !seen.has(p))]
    })
  }, [])
  useDroppedPaths(droppedPaths, isPdf, add, onDroppedConsumed)
  const pick = useCallback(async () => {
    add(await pickFiles(PDF_FILTER, true))
  }, [add])
  const remove = useCallback((index: number) => {
    setPaths((prev) => prev.filter((_, i) => i !== index))
  }, [])
  const move = useCallback((index: number, direction: -1 | 1) => {
    setPaths((prev) => {
      const next = [...prev]
      const j = index + direction
      if (j < 0 || j >= next.length) return prev
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
  }, [])
  return { paths, setPaths, pick, remove, move }
}

function useRunner<T>() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<T | null>(null)
  const run = useCallback(async (fn: () => Promise<T>) => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await fn())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, error, result, setResult, run }
}

function MergeTool({ tool, onBack, droppedPaths, onDroppedConsumed }: ToolProps) {
  const { paths, pick, remove, move } = useMultiPdf(droppedPaths, onDroppedConsumed)
  const r = useRunner<{ output: string; page_count: number; input_bytes: number; output_bytes: number }>()
  const runMerge = async () => {
    if (paths.length < 2) {
      throw new Error('Merge needs at least two PDFs — pick more files.')
    }
    const output = await pickSave(pdfDefaultOutput(paths[0], 'merged'), 'pdf', 'PDF')
    if (!output) return
    await r.run(() => pdfMerge(paths, output))
  }
  return (
    <ToolShell tool={tool} onBack={onBack} actionLabel="Merge PDFs" onRun={runMerge} busy={r.busy} error={r.error}
      result={r.result && (
        <ResultCard title={`Merged — ${r.result.page_count} pages`}>
          <OutputLine path={r.result.output} extra={`${formatBytes(r.result.input_bytes)} → ${formatBytes(r.result.output_bytes)}`} />
        </ResultCard>
      )}>
      <FileList label="PDFs" paths={paths} onPick={() => void pick()} onRemove={remove} onMove={move} pickLabel="Choose PDFs…" />
      <Typography variant="caption" color="text.secondary">
        Files merge in the listed order — use the arrows to reorder. Page labels, bookmarks and
        document info are not carried over (engine limit, see docs/PDF.md).
      </Typography>
    </ToolShell>
  )
}

function SplitTool({ tool, onBack, droppedPaths, onDroppedConsumed }: ToolProps) {
  const { paths, setPaths, pick, info } = useSinglePdf(droppedPaths, onDroppedConsumed)
  const [ranges, setRanges] = useState('1-2, 3-5')
  const r = useRunner<{ outputs: string[]; page_counts: number[] }>()
  const runSplit = async () => {
    if (paths.length === 0) throw new Error('Pick a PDF first.')
    const parsed = parseRanges(ranges)
    const dir = await open({ multiple: false, directory: true })
    if (typeof dir !== 'string') return
    await r.run(() => pdfSplit(paths[0], parsed, dir))
  }
  return (
    <ToolShell tool={tool} onBack={onBack} actionLabel="Split PDF" onRun={runSplit} busy={r.busy} error={r.error}
      result={r.result && (
        <ResultCard title={`${r.result.outputs.length} parts written`}>
          {r.result.outputs.map((o, i) => (
            <OutputLine key={o} path={o} extra={`${r.result?.page_counts[i] ?? 0} pages`} />
          ))}
        </ResultCard>
      )}>
      <FileList label="PDF" paths={paths} onPick={() => void pick()} onRemove={() => setPaths([])} pickLabel="Choose PDF…" />
      <PdfInfoLine info={info} />
      <TextField label="Page ranges" value={ranges} onChange={(e) => setRanges(e.target.value)}
        helperText="Inclusive ranges, e.g. 1-2, 3-5. A single page is just its number." fullWidth />
    </ToolShell>
  )
}

const PAGE_OP_SETTINGS: Record<string, { pagesLabel: string; pagesHint: string }> = {
  rotate: { pagesLabel: 'Pages to rotate (empty = all)', pagesHint: 'e.g. 1, 3-5 — leave empty to rotate every page.' },
  extract: { pagesLabel: 'Pages to keep', pagesHint: 'e.g. 2, 4-6 — kept in the order listed.' },
  remove: { pagesLabel: 'Pages to remove', pagesHint: 'e.g. 1, 5 — the rest are kept in order.' },
  reorder: { pagesLabel: 'New order', pagesHint: 'A permutation of all pages, e.g. 3, 1, 2.' },
  duplicate: { pagesLabel: 'Pages to duplicate', pagesHint: 'e.g. 1, 3 — each copy goes right after its original.' },
  reverse: { pagesLabel: '', pagesHint: '' },
  booklet: { pagesLabel: '', pagesHint: '' },
  nup: { pagesLabel: '', pagesHint: '' },
}

function PageOpTool({ tool, onBack, droppedPaths, onDroppedConsumed }: ToolProps) {
  const { paths, setPaths, pick, info } = useSinglePdf(droppedPaths, onDroppedConsumed)
  const [pagesSpec, setPagesSpec] = useState('')
  const [degrees, setDegrees] = useState('90')
  const [cols, setCols] = useState('2')
  const [rows, setRows] = useState('2')
  const r = useRunner<{ output: string; page_count: number; input_bytes: number; output_bytes: number }>()
  const settings = PAGE_OP_SETTINGS[tool.id] ?? { pagesLabel: 'Pages', pagesHint: '' }
  const runOp = async () => {
    if (paths.length === 0) throw new Error('Pick a PDF first.')
    const request: PdfPageOpRequest = {
      op: tool.id,
      pages: null,
      degrees: null,
      order: null,
      cols: null,
      rows: null,
    }
    if (tool.id === 'rotate') {
      request.degrees = Number(degrees)
      request.pages = parsePageList(pagesSpec)
    } else if (tool.id === 'extract' || tool.id === 'remove' || tool.id === 'duplicate') {
      const pages = parsePageList(pagesSpec)
      if (!pages) throw new Error('This tool needs a page list.')
      request.pages = pages
    } else if (tool.id === 'reorder') {
      const order = parsePageList(pagesSpec)
      if (!order) throw new Error('Reorder needs the new page order.')
      request.order = order
    } else if (tool.id === 'nup') {
      request.cols = Number(cols)
      request.rows = Number(rows)
    }
    const output = await pickSave(pdfDefaultOutput(paths[0], tool.id), 'pdf', 'PDF')
    if (!output) return
    await r.run(() => pdfPageOp(paths[0], output, request))
  }
  return (
    <ToolShell tool={tool} onBack={onBack} actionLabel={tool.title} onRun={runOp} busy={r.busy} error={r.error}
      result={r.result && (
        <ResultCard title={`Done — ${r.result.page_count} pages`}>
          <OutputLine path={r.result.output} extra={`${formatBytes(r.result.input_bytes)} → ${formatBytes(r.result.output_bytes)}`} />
        </ResultCard>
      )}>
      <FileList label="PDF" paths={paths} onPick={() => void pick()} onRemove={() => setPaths([])} pickLabel="Choose PDF…" />
      <PdfInfoLine info={info} />
      {tool.id === 'rotate' && (
        <FormControl fullWidth>
          <InputLabel id="rotate-degrees-label">Rotation</InputLabel>
          <Select labelId="rotate-degrees-label" id="rotate-degrees" label="Rotation" value={degrees} onChange={(e) => setDegrees(e.target.value)}>
            <MenuItem value="90">90° clockwise</MenuItem>
            <MenuItem value="180">180°</MenuItem>
            <MenuItem value="270">270° clockwise</MenuItem>
          </Select>
        </FormControl>
      )}
      {tool.id === 'nup' && (
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField label="Columns" type="number" value={cols} onChange={(e) => setCols(e.target.value)} inputProps={{ min: 1, max: 4 }} sx={{ width: 120 }} />
          <TextField label="Rows" type="number" value={rows} onChange={(e) => setRows(e.target.value)} inputProps={{ min: 1, max: 4 }} sx={{ width: 120 }} />
        </Box>
      )}
      {settings.pagesLabel !== '' && (
        <TextField label={settings.pagesLabel} value={pagesSpec} onChange={(e) => setPagesSpec(e.target.value)} helperText={settings.pagesHint} fullWidth />
      )}
      {(tool.id === 'reverse' || tool.id === 'booklet') && (
        <Typography variant="body2" color="text.secondary">
          No settings — this runs on the whole document.
        </Typography>
      )}
    </ToolShell>
  )
}

function CompressTool({ tool, onBack, droppedPaths, onDroppedConsumed }: ToolProps) {
  const { paths, setPaths, pick, info } = useSinglePdf(droppedPaths, onDroppedConsumed)
  const [mode, setMode] = useState('ebook')
  const [strip, setStrip] = useState(false)
  const r = useRunner<{ output: string; outcome: { input_bytes: number; output_bytes: number; saved_bytes: number; saved_percent: number; images_recompressed: number; images_skipped: number; note: string | null } }>()
  const runCompress = async () => {
    if (paths.length === 0) throw new Error('Pick a PDF first.')
    const output = await pickSave(pdfDefaultOutput(paths[0], 'compressed'), 'pdf', 'PDF')
    if (!output) return
    await r.run(() => pdfCompress(paths[0], output, mode, strip))
  }
  return (
    <ToolShell tool={tool} onBack={onBack} actionLabel="Compress PDF" onRun={runCompress} busy={r.busy} error={r.error}
      result={r.result && (
        <ResultCard title={`Compressed — saved ${formatBytes(Math.max(0, r.result.outcome.saved_bytes))} (${r.result.outcome.saved_percent.toFixed(1)}%)`}>
          <OutputLine path={r.result.output} extra={`${formatBytes(r.result.outcome.input_bytes)} → ${formatBytes(r.result.outcome.output_bytes)}`} />
          <Typography variant="body2">
            {r.result.outcome.images_recompressed} images re-encoded · {r.result.outcome.images_skipped} skipped
          </Typography>
          {r.result.outcome.note && <Typography variant="body2">{r.result.outcome.note}</Typography>}
        </ResultCard>
      )}>
      <FileList label="PDF" paths={paths} onPick={() => void pick()} onRemove={() => setPaths([])} pickLabel="Choose PDF…" />
      <PdfInfoLine info={info} />
      <FormControl fullWidth>
        <InputLabel id="compress-mode-label">Quality</InputLabel>
        <Select labelId="compress-mode-label" id="compress-mode" label="Quality" value={mode} onChange={(e) => setMode(e.target.value)}>
          <MenuItem value="screen">Screen — 72 DPI, smallest</MenuItem>
          <MenuItem value="ebook">Ebook — 150 DPI, balanced (default)</MenuItem>
          <MenuItem value="printer">Printer — 300 DPI, least loss</MenuItem>
        </Select>
      </FormControl>
      <FormControlLabel control={<Checkbox checked={strip} onChange={(e) => setStrip(e.target.checked)} />} label="Strip document metadata (title / author)" />
      <Typography variant="caption" color="text.secondary">
        Re-encoding a JPEG as a JPEG loses a little quality each time — that is the price of the
        size. When the compressed file would be larger, the original is kept and the result says so.
      </Typography>
    </ToolShell>
  )
}

function EditTool({ tool, onBack, droppedPaths, onDroppedConsumed }: ToolProps) {
  const { paths, setPaths, pick, info } = useSinglePdf(droppedPaths, onDroppedConsumed)
  const [text, setText] = useState('DRAFT')
  const [page, setPage] = useState('1')
  const [pos, setPos] = useState('72, 720')
  const [size, setSize] = useState('14')
  const [pageNumbers, setPageNumbers] = useState(true)
  const [numberPosition, setNumberPosition] = useState('bottom-center')
  const [header, setHeader] = useState('')
  const [footer, setFooter] = useState('')
  const r = useRunner<{ output: string; outcome: { ops_applied: number; pages_touched: number; warnings: string[] } }>()
  const runEdit = async () => {
    if (paths.length === 0) throw new Error('Pick a PDF first.')
    const [x, y] = pos.split(',').map((s) => Number(s.trim()))
    if (text.trim() === '' && !pageNumbers && header.trim() === '' && footer.trim() === '') {
      throw new Error('Add at least one overlay: text, page numbers, or a header/footer.')
    }
    const output = await pickSave(pdfDefaultOutput(paths[0], 'edited'), 'pdf', 'PDF')
    if (!output) return
    await r.run(() =>
      pdfEdit(paths[0], output, {
        text: text.trim() === '' ? null : text,
        text_page: Number(page) || 1,
        text_x: Number.isFinite(x) ? x : 72,
        text_y: Number.isFinite(y) ? y : 720,
        text_size: Number(size) || 14,
        page_numbers: pageNumbers,
        page_number_position: numberPosition,
        header: header.trim() === '' ? null : header,
        footer: footer.trim() === '' ? null : footer,
      }),
    )
  }
  return (
    <ToolShell tool={tool} onBack={onBack} actionLabel="Apply edits" onRun={runEdit} busy={r.busy} error={r.error}
      warning="The 3-panel visual editor (thumbnails + preview + tools) is not built on desktop yet — this tool adds overlays by page and coordinates instead. Overlays never edit existing text in place; non-ASCII overlay text becomes “?” (WinAnsi, same as the CLI)."
      result={r.result && (
        <ResultCard title={`${r.result.outcome.ops_applied} overlay ops applied on ${r.result.outcome.pages_touched} pages`}>
          <OutputLine path={r.result.output} />
          {r.result.outcome.warnings.map((w) => (
            <Typography key={w} variant="body2">{w}</Typography>
          ))}
        </ResultCard>
      )}>
      <FileList label="PDF" paths={paths} onPick={() => void pick()} onRemove={() => setPaths([])} pickLabel="Choose PDF…" />
      <PdfInfoLine info={info} />
      <TextField label="Overlay text" value={text} onChange={(e) => setText(e.target.value)} helperText="One line of text added to the page below. Leave empty to skip." fullWidth />
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField label="Page" type="number" value={page} onChange={(e) => setPage(e.target.value)} sx={{ width: 110 }} />
        <TextField label="Position x, y (points)" value={pos} onChange={(e) => setPos(e.target.value)} helperText="Origin is the bottom-left of the page." sx={{ width: 200 }} />
        <TextField label="Size (pt)" type="number" value={size} onChange={(e) => setSize(e.target.value)} sx={{ width: 110 }} />
      </Box>
      <FormControlLabel control={<Checkbox checked={pageNumbers} onChange={(e) => setPageNumbers(e.target.checked)} />} label="Add page numbers (“Page N of M” on every page)" />
      {pageNumbers && (
        <FormControl fullWidth>
          <InputLabel id="page-number-position-label">Page-number position</InputLabel>
          <Select labelId="page-number-position-label" id="page-number-position" label="Page-number position" value={numberPosition} onChange={(e) => setNumberPosition(e.target.value)}>
            <MenuItem value="bottom-center">Bottom centre</MenuItem>
            <MenuItem value="bottom-right">Bottom right</MenuItem>
            <MenuItem value="top-center">Top centre</MenuItem>
            <MenuItem value="top-right">Top right</MenuItem>
          </Select>
        </FormControl>
      )}
      <TextField label="Header (optional)" value={header} onChange={(e) => setHeader(e.target.value)} fullWidth />
      <TextField label="Footer (optional)" value={footer} onChange={(e) => setFooter(e.target.value)} fullWidth />
    </ToolShell>
  )
}

function RedactTool({ tool, onBack, droppedPaths, onDroppedConsumed }: ToolProps) {
  const { paths, setPaths, pick, info } = useSinglePdf(droppedPaths, onDroppedConsumed)
  const [texts, setTexts] = useState('')
  const r = useRunner<{ output: string; outcome: { characters_removed: number; runs_removed: number; annotations_removed: number; redacted_texts: string[]; warnings: string[] } }>()
  const runRedact = async () => {
    if (paths.length === 0) throw new Error('Pick a PDF first.')
    const list = texts.split('\n').map((s) => s.trim()).filter(Boolean)
    if (list.length === 0) throw new Error('Enter at least one text to redact (one per line).')
    const output = await pickSave(pdfDefaultOutput(paths[0], 'redacted'), 'pdf', 'PDF')
    if (!output) return
    await r.run(() => pdfRedact(paths[0], output, { texts: list, rects: [] }))
  }
  return (
    <ToolShell tool={tool} onBack={onBack} actionLabel="Redact" onRun={runRedact} busy={r.busy} error={r.error}
      result={r.result && (
        <ResultCard title={`Redacted — ${r.result.outcome.characters_removed} characters removed in ${r.result.outcome.runs_removed} runs`}>
          <OutputLine path={r.result.output} />
          <Typography variant="body2">Removed: {r.result.outcome.redacted_texts.join(', ') || '—'}</Typography>
          {r.result.outcome.warnings.map((w) => (
            <Typography key={w} variant="body2">{w}</Typography>
          ))}
        </ResultCard>
      )}>
      <FileList label="PDF" paths={paths} onPick={() => void pick()} onRemove={() => setPaths([])} pickLabel="Choose PDF…" />
      <PdfInfoLine info={info} />
      <TextField label="Texts to redact (one per line)" value={texts} onChange={(e) => setTexts(e.target.value)}
        helperText="Case-sensitive, searched inside one text run at a time. The text is deleted from the content stream, not just covered — the result proves it by checking the output bytes."
        multiline rows={4} fullWidth />
    </ToolShell>
  )
}

function MetadataTool({ tool, onBack, droppedPaths, onDroppedConsumed }: ToolProps) {
  const { paths, setPaths, pick, info } = useSinglePdf(droppedPaths, onDroppedConsumed)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [subject, setSubject] = useState('')
  const [keywords, setKeywords] = useState('')
  const r = useRunner<{ output: string; page_count: number; input_bytes: number; output_bytes: number }>()
  useEffect(() => {
    if (info) {
      setTitle(info.title ?? '')
      setAuthor(info.author ?? '')
      setSubject(info.subject ?? '')
      setKeywords(info.keywords ?? '')
    }
  }, [info])
  const runMetadata = async () => {
    if (paths.length === 0) throw new Error('Pick a PDF first.')
    const output = await pickSave(pdfDefaultOutput(paths[0], 'metadata'), 'pdf', 'PDF')
    if (!output) return
    await r.run(() =>
      pdfSetMetadata(paths[0], output, {
        title: title === '' ? null : title,
        author: author === '' ? null : author,
        subject: subject === '' ? null : subject,
        keywords: keywords === '' ? null : keywords,
        creator: null,
        producer: null,
      }),
    )
  }
  return (
    <ToolShell tool={tool} onBack={onBack} actionLabel="Save metadata" onRun={runMetadata} busy={r.busy} error={r.error}
      result={r.result && (
        <ResultCard title="Metadata updated">
          <OutputLine path={r.result.output} />
        </ResultCard>
      )}>
      <FileList label="PDF" paths={paths} onPick={() => void pick()} onRemove={() => setPaths([])} pickLabel="Choose PDF…" />
      <PdfInfoLine info={info} />
      <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth />
      <TextField label="Author" value={author} onChange={(e) => setAuthor(e.target.value)} fullWidth />
      <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} fullWidth />
      <TextField label="Keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} fullWidth />
      <Typography variant="caption" color="text.secondary">
        Fields are pre-filled from the document. Clearing a field leaves it unchanged — use the
        CLI to clear a field entirely.
      </Typography>
    </ToolShell>
  )
}

function SanitizeTool({ tool, onBack, droppedPaths, onDroppedConsumed }: ToolProps) {
  const { paths, setPaths, pick, info } = useSinglePdf(droppedPaths, onDroppedConsumed)
  const [threats, setThreats] = useState<{ javascript: string[]; embedded_files: string[]; launch_actions: string[]; auto_actions: string[]; warnings: string[] } | null>(null)
  const r = useRunner<{ output: string; outcome: { javascript_removed: number; embedded_files_removed: number; launch_actions_removed: number; auto_actions_removed: number; warnings: string[] } }>()
  useEffect(() => {
    setThreats(null)
    if (!paths[0]) return
    void fetchPdfThreats(paths[0]).then(setThreats).catch(() => undefined)
  }, [paths])
  const runSanitize = async () => {
    if (paths.length === 0) throw new Error('Pick a PDF first.')
    const output = await pickSave(pdfDefaultOutput(paths[0], 'sanitized'), 'pdf', 'PDF')
    if (!output) return
    await r.run(() => pdfSanitize(paths[0], output))
  }
  const threatCount = threats
    ? threats.javascript.length + threats.embedded_files.length + threats.launch_actions.length + threats.auto_actions.length
    : 0
  return (
    <ToolShell tool={tool} onBack={onBack} actionLabel="Sanitize PDF" onRun={runSanitize} busy={r.busy} error={r.error}
      result={r.result && (
        <ResultCard title="Sanitized">
          <OutputLine path={r.result.output} />
          <Typography variant="body2">
            Removed: {r.result.outcome.javascript_removed} scripts · {r.result.outcome.embedded_files_removed} embedded files ·{' '}
            {r.result.outcome.launch_actions_removed} launch actions · {r.result.outcome.auto_actions_removed} auto-actions
          </Typography>
        </ResultCard>
      )}>
      <FileList label="PDF" paths={paths} onPick={() => void pick()} onRemove={() => setPaths([])} pickLabel="Choose PDF…" />
      <PdfInfoLine info={info} />
      {threats && (
        <Alert severity={threatCount === 0 ? 'success' : 'warning'}>
          {threatCount === 0
            ? 'This PDF looks clean — no JavaScript, embedded files, launch or auto-actions found.'
            : `Found ${threatCount} item(s): ${threats.javascript.length} scripts, ${threats.embedded_files.length} embedded files, ${threats.launch_actions.length} launch actions, ${threats.auto_actions.length} auto-actions. Sanitizing removes them; the document itself is kept.`}
        </Alert>
      )}
    </ToolShell>
  )
}

function SimplePdfTool({ tool, onBack, droppedPaths, onDroppedConsumed }: ToolProps) {
  const { paths, setPaths, pick, info } = useSinglePdf(droppedPaths, onDroppedConsumed)
  const r = useRunner<{ output: string; outcome?: { recovery?: string; warnings?: string[]; annotations_flattened?: number; annotations_dropped?: number } }>()
  const runSimple = async () => {
    if (paths.length === 0) throw new Error('Pick a PDF first.')
    const output = await pickSave(pdfDefaultOutput(paths[0], tool.id), 'pdf', 'PDF')
    if (!output) return
    if (tool.id === 'flatten') await r.run(() => pdfFlatten(paths[0], output))
    else await r.run(() => pdfRepair(paths[0], output))
  }
  return (
    <ToolShell tool={tool} onBack={onBack} actionLabel={tool.title} onRun={runSimple} busy={r.busy} error={r.error}
      result={r.result && (
        <ResultCard title="Done">
          <OutputLine path={r.result.output} />
          {r.result.outcome?.recovery && <Typography variant="body2">Recovery: {r.result.outcome.recovery}</Typography>}
          {r.result.outcome?.annotations_flattened !== undefined && (
            <Typography variant="body2">
              {r.result.outcome.annotations_flattened} annotations flattened · {r.result.outcome.annotations_dropped} dropped
            </Typography>
          )}
          {r.result.outcome?.warnings?.map((w) => (
            <Typography key={w} variant="body2">{w}</Typography>
          ))}
        </ResultCard>
      )}>
      <FileList label="PDF" paths={paths} onPick={() => void pick()} onRemove={() => setPaths([])} pickLabel="Choose PDF…" />
      <PdfInfoLine info={info} />
      <Typography variant="body2" color="text.secondary">
        {tool.id === 'flatten'
          ? 'Annotation appearance streams are rendered into page content, then the annotations are removed. Annotations without an appearance have nothing visible to keep and are counted as dropped.'
          : 'Reads the cross-reference table however it can — as written, offset-corrected, or reconstructed — and reports how the file was recovered.'}
      </Typography>
    </ToolShell>
  )
}

function ExtractTextTool({ tool, onBack, caps, droppedPaths, onDroppedConsumed }: ToolProps) {
  const { paths, setPaths, pick, info } = useSinglePdf(droppedPaths, onDroppedConsumed)
  const [format, setFormat] = useState('txt')
  const [pagesSpec, setPagesSpec] = useState('')
  const r = useRunner<{ pages: { page: number; text: string }[]; text: string; output: string | null }>()
  const runExtract = async () => {
    if (paths.length === 0) throw new Error('Pick a PDF first.')
    const pages = parsePageList(pagesSpec)
    await r.run(() => pdfExtractText(paths[0], pages, format, null))
  }
  const saveExtracted = async () => {
    if (!r.result || paths.length === 0) return
    const ext = format === 'txt' ? 'txt' : format
    const out = await pickSave(defaultOutputPath(paths[0], format, []), ext, format.toUpperCase())
    if (!out) return
    await r.run(() => pdfExtractText(paths[0], parsePageList(pagesSpec), format, out))
  }
  return (
    <ToolShell tool={tool} onBack={onBack} actionLabel="Extract text" onRun={runExtract} busy={r.busy} error={r.error}
      warning={caps && !caps.pdfium_present ? PDFIUM_WARNING : null}
      result={r.result && (
        <Card>
          <CardContent>
            <Typography variant="subtitle2" gutterBottom>
              Extracted text — {r.result.pages.length} page{r.result.pages.length === 1 ? '' : 's'}
            </Typography>
            <Paper variant="outlined" sx={{ maxHeight: 320, overflow: 'auto', p: 2, whiteSpace: 'pre-wrap' }}>
              <Typography variant="body2" component="pre" sx={{ margin: 0, fontFamily: 'inherit' }}>
                {r.result.text.slice(0, 8000) || '(no text on these pages — the pages may be scanned images; use OCR instead)'}
              </Typography>
            </Paper>
            <Box sx={{ mt: 2 }}>
              <Button type="button" variant="outlined" onClick={() => void saveExtracted()}>
                Save as .{format}…
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}>
      <FileList label="PDF" paths={paths} onPick={() => void pick()} onRemove={() => setPaths([])} pickLabel="Choose PDF…" />
      <PdfInfoLine info={info} />
      <FormControl fullWidth>
        <InputLabel id="extract-format-label">Output format</InputLabel>
        <Select labelId="extract-format-label" id="extract-format" label="Output format" value={format} onChange={(e) => setFormat(e.target.value)}>
          <MenuItem value="txt">Plain text (.txt)</MenuItem>
          <MenuItem value="html">HTML (.html)</MenuItem>
          <MenuItem value="epub">EPUB (.epub)</MenuItem>
          <MenuItem value="docx">Word (.docx, text only)</MenuItem>
        </Select>
      </FormControl>
      <TextField label="Pages (empty = all)" value={pagesSpec} onChange={(e) => setPagesSpec(e.target.value)} helperText="e.g. 1, 3-5" fullWidth />
      <Typography variant="caption" color="text.secondary">
        Text only — fonts, colours, images and exact layout are not preserved. A scanned page has
        no text layer at all; its section will be empty.
      </Typography>
    </ToolShell>
  )
}

function ImagesToPdfTool({ tool, onBack, droppedPaths, onDroppedConsumed }: ToolProps) {
  const [paths, setPaths] = useState<string[]>([])
  const [pageSize, setPageSize] = useState('none')
  const r = useRunner<{ output: string; page_count: number; input_bytes: number; output_bytes: number }>()
  useDroppedPaths(droppedPaths, isImage, (fresh) => {
    setPaths((prev) => [...prev, ...fresh.filter((p) => !prev.includes(p))])
  }, onDroppedConsumed)
  const pick = async () => {
    const picked = await pickFiles(IMAGE_FILTER, true)
    setPaths((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))])
  }
  const runBuild = async () => {
    if (paths.length === 0) throw new Error('Pick at least one image.')
    const output = await pickSave(pdfDefaultOutput(paths[0], 'images'), 'pdf', 'PDF')
    if (!output) return
    await r.run(() => pdfFromImages(paths, output, pageSize === 'none' ? null : pageSize))
  }
  return (
    <ToolShell tool={tool} onBack={onBack} actionLabel="Build PDF" onRun={runBuild} busy={r.busy} error={r.error}
      result={r.result && (
        <ResultCard title={`${r.result.page_count} pages`}>
          <OutputLine path={r.result.output} extra={formatBytes(r.result.output_bytes)} />
        </ResultCard>
      )}>
      <FileList label="images" paths={paths} onPick={() => void pick()} onRemove={(i) => setPaths((prev) => prev.filter((_, j) => j !== i))} pickLabel="Choose images…" />
      <FormControl fullWidth>
        <InputLabel id="page-size-label">Page size</InputLabel>
        <Select labelId="page-size-label" id="page-size" label="Page size" value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
          <MenuItem value="none">Each image's own size</MenuItem>
          <MenuItem value="a4">A4</MenuItem>
          <MenuItem value="a5">A5</MenuItem>
          <MenuItem value="letter">Letter</MenuItem>
        </Select>
      </FormControl>
      <Typography variant="caption" color="text.secondary">
        One page per image, in order. Transparency is flattened onto white.
      </Typography>
    </ToolShell>
  )
}

function PdfToImageTool({ tool, onBack, caps, droppedPaths, onDroppedConsumed }: ToolProps) {
  const { paths, setPaths, pick, info } = useSinglePdf(droppedPaths, onDroppedConsumed)
  const [scale, setScale] = useState('2')
  const [format, setFormat] = useState('png')
  const r = useRunner<{ outputs: string[] }>()
  const runRender = async () => {
    if (paths.length === 0) throw new Error('Pick a PDF first.')
    const dir = await open({ multiple: false, directory: true })
    if (typeof dir !== 'string') return
    await r.run(() => pdfToImages(paths[0], dir, null, Number(scale) || 2, format))
  }
  return (
    <ToolShell tool={tool} onBack={onBack} actionLabel="Render pages" onRun={runRender} busy={r.busy} error={r.error}
      warning={caps && !caps.pdfium_present ? PDFIUM_WARNING : null}
      result={r.result && (
        <ResultCard title={`${r.result.outputs.length} images written`}>
          {r.result.outputs.map((o) => (
            <OutputLine key={o} path={o} />
          ))}
        </ResultCard>
      )}>
      <FileList label="PDF" paths={paths} onPick={() => void pick()} onRemove={() => setPaths([])} pickLabel="Choose PDF…" />
      <PdfInfoLine info={info} />
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField label="Scale (1.0 = 72 DPI)" type="number" value={scale} onChange={(e) => setScale(e.target.value)} inputProps={{ min: 0.25, max: 6, step: 0.25 }} sx={{ width: 200 }} />
        <FormControl sx={{ minWidth: 140 }}>
          <InputLabel id="render-format-label">Format</InputLabel>
          <Select labelId="render-format-label" id="render-format" label="Format" value={format} onChange={(e) => setFormat(e.target.value)}>
            <MenuItem value="png">PNG</MenuItem>
            <MenuItem value="jpeg">JPEG</MenuItem>
          </Select>
        </FormControl>
      </Box>
    </ToolShell>
  )
}

function OcrTool({ tool, onBack, caps, droppedPaths, onDroppedConsumed }: ToolProps) {
  const [paths, setPaths] = useState<string[]>([])
  const [langs, setLangs] = useState<string[]>(['eng'])
  const [preprocess, setPreprocess] = useState('light')
  const r = useRunner<OcrResult>()
  useDroppedPaths(droppedPaths, isImage, (fresh) => {
    setPaths((prev) => [...prev, ...fresh.filter((p) => !prev.includes(p))].slice(0, 1))
  }, onDroppedConsumed)
  const pick = async () => {
    const picked = await pickFiles(IMAGE_FILTER, false)
    if (picked.length > 0) setPaths(picked)
  }
  const toggleLang = (lang: string) => {
    setLangs((prev) => (prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]))
  }
  const runOcr = async () => {
    if (paths.length === 0) throw new Error('Pick an image first.')
    if (langs.length === 0) throw new Error('Pick at least one language.')
    await r.run(() => ocrRecognize(paths[0], { languages: langs, psm: 3, preprocess }))
  }
  return (
    <ToolShell tool={tool} onBack={onBack} actionLabel="Recognise text" onRun={runOcr} busy={r.busy} error={r.error}
      warning={caps && !caps.tesseract_present ? 'Tesseract was not found on this device — install tesseract-ocr plus eng/ben language data (see docs/OCR.md).' : null}
      result={r.result && (
        <Card>
          <CardContent>
            <Typography variant="subtitle2" gutterBottom>
              Recognised text — mean confidence {r.result.mean_confidence.toFixed(0)}% ·{' '}
              {r.result.words.length} words · {r.result.duration_ms} ms · {r.result.engine}
            </Typography>
            <Paper variant="outlined" sx={{ maxHeight: 320, overflow: 'auto', p: 2, whiteSpace: 'pre-wrap' }}>
              <Typography variant="body2" component="pre" sx={{ margin: 0, fontFamily: 'inherit' }}>
                {r.result.text || '(no text recognised)'}
              </Typography>
            </Paper>
            <Typography variant="caption" color="text.secondary">
              Accuracy is never 100% — check the text before using it. Copy it from here; saving
              OCR text to a file is not wired yet.
            </Typography>
          </CardContent>
        </Card>
      )}>
      <FileList label="image" paths={paths} onPick={() => void pick()} onRemove={() => setPaths([])} pickLabel="Choose image…" />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Chip label="English" color={langs.includes('eng') ? 'primary' : 'default'} onClick={() => toggleLang('eng')} />
        <Chip label="Bengali" color={langs.includes('ben') ? 'primary' : 'default'} onClick={() => toggleLang('ben')} />
      </Box>
      <FormControl fullWidth>
        <InputLabel id="ocr-preprocess-label">Preprocessing</InputLabel>
        <Select labelId="ocr-preprocess-label" id="ocr-preprocess" label="Preprocessing" value={preprocess} onChange={(e) => setPreprocess(e.target.value)}>
          <MenuItem value="none">None</MenuItem>
          <MenuItem value="light">Light — greyscale + denoise (default)</MenuItem>
          <MenuItem value="full">Full — threshold + denoise + deskew</MenuItem>
        </Select>
      </FormControl>
      {caps?.tesseract_present && (
        <Typography variant="caption" color="text.secondary">
          {caps.tesseract_version} · languages installed: {caps.tesseract_languages.join(', ') || 'none detected'}
        </Typography>
      )}
    </ToolShell>
  )
}

function SearchablePdfTool({ tool, onBack, caps, droppedPaths, onDroppedConsumed }: ToolProps) {
  const [paths, setPaths] = useState<string[]>([])
  const [langs, setLangs] = useState<string[]>(['eng'])
  const [title, setTitle] = useState('Scanned document')
  const r = useRunner<{ output: string; page_count: number; results: OcrResult[] }>()
  useDroppedPaths(droppedPaths, isImage, (fresh) => {
    setPaths((prev) => [...prev, ...fresh.filter((p) => !prev.includes(p))])
  }, onDroppedConsumed)
  const pick = async () => {
    const picked = await pickFiles(IMAGE_FILTER, true)
    setPaths((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))])
  }
  const runSearchable = async () => {
    if (paths.length === 0) throw new Error('Pick at least one scanned page image.')
    const output = await pickSave(pdfDefaultOutput(paths[0], 'searchable'), 'pdf', 'PDF')
    if (!output) return
    await r.run(() => pdfOcrSearchable(paths, output, { languages: langs, psm: 3, preprocess: 'light' }, title))
  }
  return (
    <ToolShell tool={tool} onBack={onBack} actionLabel="Build searchable PDF" onRun={runSearchable} busy={r.busy} error={r.error}
      warning={
        caps && !caps.tesseract_present
          ? 'Tesseract was not found on this device — install tesseract-ocr plus eng/ben language data (see docs/OCR.md).'
          : 'Image pages only — a PDF input needs PDFium rendering first, which this build does not ship.'
      }
      result={r.result && (
        <ResultCard title={`Searchable PDF — ${r.result.page_count} pages`}>
          <OutputLine path={r.result.output} />
          {r.result.results.map((page, i) => (
            <Typography key={i} variant="body2">
              Page {i + 1}: {page.words.length} words, mean confidence {page.mean_confidence.toFixed(0)}%
            </Typography>
          ))}
        </ResultCard>
      )}>
      <FileList label="page images" paths={paths} onPick={() => void pick()} onRemove={(i) => setPaths((prev) => prev.filter((_, j) => j !== i))} pickLabel="Choose page images…" />
      <TextField label="Document title" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Chip label="English" color={langs.includes('eng') ? 'primary' : 'default'} onClick={() => setLangs((prev) => (prev.includes('eng') ? prev.filter((l) => l !== 'eng') : [...prev, 'eng']))} />
        <Chip label="Bengali" color={langs.includes('ben') ? 'primary' : 'default'} onClick={() => setLangs((prev) => (prev.includes('ben') ? prev.filter((l) => l !== 'ben') : [...prev, 'ben']))} />
      </Box>
      <Typography variant="caption" color="text.secondary">
        The original image plus an invisible text layer — Bengali text stays findable. The reported
        confidence describes the text layer itself.
      </Typography>
    </ToolShell>
  )
}

function sourceIdFromPath(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
}

function DocConvertTool({ tool, onBack, caps, droppedPaths, onDroppedConsumed }: ToolProps) {
  const [paths, setPaths] = useState<string[]>([])
  const [formats, setFormats] = useState<DocumentConversion[]>([])
  const [target, setTarget] = useState('pdf')
  const r = useRunner<{ source: string; target: string; engine: string; input_bytes: number; output_bytes: number; fidelity: string }>()
  useEffect(() => {
    void fetchDocFormats().then(setFormats).catch(() => undefined)
  }, [])
  useDroppedPaths(
    droppedPaths,
    () => true,
    (fresh) => setPaths((prev) => [...prev, ...fresh.filter((p) => !prev.includes(p))].slice(0, 1)),
    onDroppedConsumed,
  )
  const pick = async () => {
    const picked = await pickFiles(DOC_FILTER, false)
    if (picked.length > 0) setPaths(picked)
  }
  const source = paths[0] ? sourceIdFromPath(paths[0]) : ''
  const targets = formats.filter((f) => f.source === source)
  useEffect(() => {
    if (targets.length > 0 && !targets.some((f) => f.target === target)) {
      setTarget(targets[0].target)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])
  const runConvert = async () => {
    if (paths.length === 0) throw new Error('Pick a document first.')
    if (targets.length === 0) throw new Error(`No conversions known for .${source} files.`)
    const output = await pickSave(defaultOutputPath(paths[0], target, []), target, target.toUpperCase())
    if (!output) return
    await r.run(() => docConvert(paths[0], output, target, source || null))
  }
  return (
    <ToolShell tool={tool} onBack={onBack} actionLabel={`Convert to ${target.toUpperCase()}`} onRun={runConvert} busy={r.busy} error={r.error}
      warning={caps && !caps.libreoffice_present ? 'LibreOffice was not found on this device — install it to convert Office documents. PDF → text exports also need libpdfium (not shipped yet).' : null}
      result={r.result && (
        <ResultCard title={`${r.result.source} → ${r.result.target} (${r.result.engine})`}>
          <Typography variant="body2">
            {formatBytes(r.result.input_bytes)} → {formatBytes(r.result.output_bytes)}
          </Typography>
          <Typography variant="body2">{r.result.fidelity}</Typography>
        </ResultCard>
      )}>
      <FileList label="document" paths={paths} onPick={() => void pick()} onRemove={() => setPaths([])} pickLabel="Choose document…" />
      {paths[0] && (
        <>
          <Typography variant="body2" color="text.secondary">
            Detected source: .{source || '?'}
            {caps?.libreoffice_version ? ` · ${caps.libreoffice_version}` : ''}
          </Typography>
          {targets.length === 0 ? (
            <Alert severity="info">
              No conversions are known for .{source} files. Pairs LibreOffice refuses (e.g. PDF →
              DOCX with layout) are deliberately absent — the engine refuses them instead of
              pretending.
            </Alert>
          ) : (
            <FormControl fullWidth>
              <InputLabel id="doc-target-label">Target format</InputLabel>
              <Select labelId="doc-target-label" id="doc-target" label="Target format" value={target} onChange={(e) => setTarget(e.target.value)}>
                {targets.map((f) => (
                  <MenuItem key={f.target} value={f.target}>
                    {f.target.toUpperCase()} — {f.fidelity}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </>
      )}
    </ToolShell>
  )
}

// ---- workspace: picker + routing ----

interface PdfWorkspaceProps {
  droppedPaths: string[]
  onDroppedConsumed: () => void
}

export function PdfWorkspace({ droppedPaths, onDroppedConsumed }: PdfWorkspaceProps) {
  const [active, setActive] = useState<string | null>(null)
  const [caps, setCaps] = useState<DesktopCapabilities | null>(null)
  const [capsError, setCapsError] = useState<string | null>(null)

  useEffect(() => {
    void fetchDesktopCapabilities()
      .then(setCaps)
      .catch((e: unknown) => setCapsError(e instanceof Error ? e.message : String(e)))
  }, [])

  const tool = TOOLS.find((t) => t.id === active) ?? null
  const props: ToolProps = {
    tool: tool ?? TOOLS[0],
    onBack: () => setActive(null),
    caps,
    droppedPaths,
    onDroppedConsumed,
  }

  if (tool) {
    switch (tool.id) {
      case 'merge':
        return <MergeTool {...props} />
      case 'split':
        return <SplitTool {...props} />
      case 'compress':
        return <CompressTool {...props} />
      case 'edit':
        return <EditTool {...props} />
      case 'redact':
        return <RedactTool {...props} />
      case 'metadata':
        return <MetadataTool {...props} />
      case 'sanitize':
        return <SanitizeTool {...props} />
      case 'flatten':
      case 'repair':
        return <SimplePdfTool {...props} />
      case 'extract-text':
        return <ExtractTextTool {...props} />
      case 'images-to-pdf':
        return <ImagesToPdfTool {...props} />
      case 'pdf-to-image':
        return <PdfToImageTool {...props} />
      case 'ocr':
        return <OcrTool {...props} />
      case 'searchable-pdf':
        return <SearchablePdfTool {...props} />
      case 'doc-convert':
        return <DocConvertTool {...props} />
      default:
        return <PageOpTool {...props} />
    }
  }

  const groups: ('PDF' | 'OCR' | 'Documents')[] = ['PDF', 'OCR', 'Documents']
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography variant="h5" component="h2">
          PDF tools
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Pick a tool — each one opens its own focused page (upload, settings, one action, result).
          Everything runs on this machine with the native engine; no server, no upload, no account.
        </Typography>
      </Box>
      {capsError && <Alert severity="error">Could not read this device's capabilities: {capsError}</Alert>}
      {caps && (
        <Alert severity="info">
          This device:{' '}
          {caps.pdfium_present ? 'PDFium rendering available' : 'no PDFium — text extraction and PDF → image will fail honestly'}{' '}
          · {caps.tesseract_present ? `${caps.tesseract_version ?? 'Tesseract'} available` : 'no Tesseract — OCR unavailable'}{' '}
          · {caps.libreoffice_present ? `${caps.libreoffice_version ?? 'LibreOffice'} available` : 'no LibreOffice — document conversion unavailable'}
        </Alert>
      )}
      {groups.map((group) => (
        <Box key={group}>
          <Typography variant="overline" color="text.secondary">
            {group === 'PDF' ? 'PDF' : group === 'OCR' ? 'OCR (Tesseract)' : 'Documents (LibreOffice)'}
          </Typography>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            {TOOLS.filter((t) => t.group === group).map((t) => (
              <Grid key={t.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <Card
                  sx={{ height: '100%', cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}
                  onClick={() => setActive(t.id)}
                >
                  <CardContent>
                    <Typography variant="subtitle1">{t.title}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t.description}
                    </Typography>
                    {t.needsPdfium && caps && !caps.pdfium_present && (
                      <Chip label="Needs libpdfium — not on this device" size="small" color="warning" sx={{ mt: 1 }} />
                    )}
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      ))}
    </Box>
  )
}
