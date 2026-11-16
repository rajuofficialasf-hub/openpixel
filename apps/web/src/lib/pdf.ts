/**
 * PDF tools for the web app (Studio Phase 2) — `src/lib/pdf.ts`.
 *
 * Two engines, honestly separated:
 *
 * - **Page operations** (info, merge, split, rotate, extract,
 *   remove, reorder, duplicate, reverse, booklet, N-up,
 *   images→PDF) run through the real Rust engine compiled to
 *   WASM (`crates/openpixel-wasm`: `pdf_info` / `pdf_process` /
 *   `pdf_merge` / `pdf_from_images`). They are pure lopdf, so
 *   they run in the browser for real. Every wrapper here returns
 *   `null` when the module is absent or the engine rejects the
 *   input — the caller reports that honestly instead of faking
 *   a result.
 * - **Rendering** (preview, PDF→PNG/JPEG) runs through pdf.js
 *   (`pdfjs-dist`), because PDFium needs a native libpdfium
 *   binary and cannot load in the browser — there is no WASM
 *   render export. pdf.js is loaded lazily (dynamic import) so
 *   the ~1 MB library is only fetched when the PDF tab is used.
 *   Its worker is the bundled `pdf.worker.min.mjs`, wired via
 *   `GlobalWorkerOptions.workerSrc` with the standard Vite
 *   `new URL(..., import.meta.url)` pattern; without the worker
 *   pdf.js silently renders nothing, so the preview effect in
 *   `PdfWorkspace` treats a missing canvas paint as a failure
 *   and says so.
 *
 * What the browser CANNOT do (never offered as a working
 * button): insert / replace pages — the WASM binding has no
 * export for them, they are CLI/desktop-only (`openpixel pdf
 * insert` / `openpixel pdf replace`). PDFium-quality rendering
 * is CLI/desktop-only too (`openpixel pdf render`).
 */
import { loadWasmEngine, type PdfInfo } from './wasm-engine'

export type { PdfInfo }

/** Named page sizes the WASM `pdf_from_images` export accepts. */
export const PDF_PAGE_SIZES = ['Original', 'A4', 'Letter', 'A5'] as const
export type PdfPageSize = (typeof PDF_PAGE_SIZES)[number]

/** Render scales offered for preview / PDF→image (×72 dpi). */
export const PDF_RENDER_SCALES = [1, 1.5, 2] as const

/**
 * Parse a page list like "1", "1,3", "1-3,5" into 1-based page
 * numbers, in the given order (repeats kept — `extract` allows
 * them). Returns `null` for anything invalid: empty input, a
 * non-number, a page below 1 or above `pageCount`, or a reversed
 * range. Pure — unit-tested.
 */
export function parsePageList(input: string, pageCount: number): number[] | null {
  const parts = input
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '')
  if (parts.length === 0) return null
  const out: number[] = []
  for (const part of parts) {
    const range = part.split('-').map((p) => p.trim())
    if (range.length === 1) {
      const n = Number(range[0])
      if (!Number.isInteger(n) || n < 1 || n > pageCount) return null
      out.push(n)
    } else if (range.length === 2) {
      const from = Number(range[0])
      const to = Number(range[1])
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 1 ||
        to > pageCount ||
        from > to
      ) {
        return null
      }
      for (let n = from; n <= to; n++) out.push(n)
    } else {
      return null
    }
  }
  return out
}

/**
 * Parse split ranges like "1-3,5-7" (a bare "2" means [2, 2])
 * into 1-based inclusive ranges. Returns `null` for anything
 * invalid: empty input, a page outside 1..pageCount, a reversed
 * range, or a malformed part. Pure — unit-tested.
 */
export function parsePageRanges(input: string, pageCount: number): [number, number][] | null {
  const parts = input
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '')
  if (parts.length === 0) return null
  const out: [number, number][] = []
  for (const part of parts) {
    const range = part.split('-').map((p) => p.trim())
    if (range.length === 1) {
      const n = Number(range[0])
      if (!Number.isInteger(n) || n < 1 || n > pageCount) return null
      out.push([n, n])
    } else if (range.length === 2) {
      const from = Number(range[0])
      const to = Number(range[1])
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 1 ||
        to > pageCount ||
        from > to
      ) {
        return null
      }
      out.push([from, to])
    } else {
      return null
    }
  }
  return out
}

/**
 * Parse a reorder like "3,1,2" — it must be a permutation of
 * 1..pageCount (every page exactly once). Returns `null` for
 * anything else. Pure — unit-tested.
 */
export function parseReorder(input: string, pageCount: number): number[] | null {
  const pages = parsePageList(input, pageCount)
  if (!pages || pages.length !== pageCount) return null
  const seen = new Set(pages)
  if (seen.size !== pageCount) return null
  return pages
}

/** "612 × 792 pt" — integers without a decimal, others to 1 place. */
export function formatPageSize(size: [number, number]): string {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
  return `${fmt(size[0])} × ${fmt(size[1])} pt`
}

/** Output name for a PDF operation: `report.pdf` + "rotated" → `report-rotated.pdf`. */
export function pdfOutputName(baseName: string, suffix: string): string {
  const stem = baseName.replace(/\.pdf$/i, '') || 'document'
  return `${stem}-${suffix}.pdf`
}

/** Copy bytes into a fresh ArrayBuffer-backed array (Blob-safe). */
function freshCopy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes)
}

/**
 * PDF info via the WASM engine. `null` when the module is absent
 * or the engine rejects the bytes (not a PDF, encrypted, no
 * pages) — the caller falls back to pdf.js for the page count.
 */
export async function getPdfInfo(bytes: Uint8Array): Promise<PdfInfo | null> {
  const mod = await loadWasmEngine()
  if (!mod) return null
  try {
    const info = mod.pdf_info(bytes)
    // serde-wasm-bindgen serialises a Rust `None` as `undefined`,
    // not `null` — normalise the optional metadata fields so the
    // UI's null checks (and the PdfInfo type) hold.
    return {
      ...info,
      title: info.title ?? null,
      author: info.author ?? null,
      creator: info.creator ?? null,
      producer: info.producer ?? null,
    }
  } catch {
    return null
  }
}

/**
 * One PDF page operation via the WASM engine. `opsJson` is the
 * JSON object the binding expects, e.g.
 * `{"kind":"rotate","pages":[1,3],"degrees":90}`. Returns one
 * `Uint8Array` per output document (one per range for split),
 * or `null` when the module is absent or the engine rejects the
 * op. The caller re-checks each output with `getPdfInfo`.
 */
export async function pdfProcess(
  bytes: Uint8Array,
  opsJson: string,
): Promise<Uint8Array<ArrayBuffer>[] | null> {
  const mod = await loadWasmEngine()
  if (!mod) return null
  try {
    const out = mod.pdf_process(bytes, opsJson)
    return (out as unknown as Uint8Array[]).map((b) => freshCopy(b))
  } catch {
    return null
  }
}

/** Merge several PDFs into one, in order, via the WASM engine. */
export async function pdfMerge(documents: Uint8Array[]): Promise<Uint8Array<ArrayBuffer> | null> {
  const mod = await loadWasmEngine()
  if (!mod) return null
  try {
    // The binding takes a JS array of Uint8Array; wasm-bindgen
    // reads it as-is, so pass the caller's array straight through.
    return freshCopy(mod.pdf_merge(documents))
  } catch {
    return null
  }
}

/**
 * Build a PDF from images (one page per image, in order) via the
 * WASM engine. `pageSize` is "A4" / "Letter" / "A5", or `null`
 * for one page per image at the image's own size in points.
 */
export async function pdfFromImages(
  images: Uint8Array[],
  pageSize: string | null,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const mod = await loadWasmEngine()
  if (!mod) return null
  try {
    return freshCopy(mod.pdf_from_images(images, pageSize ?? undefined))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// pdf.js rendering — the browser's render path (no PDFium in WASM).
// ---------------------------------------------------------------------------

type PdfJsLib = typeof import('pdfjs-dist')

let pdfJsPromise: Promise<PdfJsLib> | null = null

/**
 * Load pdf.js once and point it at the bundled worker. The
 * worker file is resolved with the standard Vite pattern, so it
 * is emitted as an asset of the production build and served
 * from the same origin. Returns the pdf.js module.
 */
export function loadPdfJs(): Promise<PdfJsLib> {
  if (!pdfJsPromise) {
    pdfJsPromise = (async () => {
      const lib = (await import('pdfjs-dist')) as PdfJsLib
      lib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString()
      return lib
    })()
  }
  return pdfJsPromise
}

/** Page count via pdf.js (used when the WASM engine is absent). */
export async function getPdfPageCountViaPdfJs(bytes: Uint8Array): Promise<number> {
  const lib = await loadPdfJs()
  const task = lib.getDocument({ data: new Uint8Array(bytes) })
  try {
    const doc = await task.promise
    return doc.numPages
  } finally {
    // pdf.js 6: destroy() lives on the loading task, not the
    // document proxy — destroying the task frees the worker-side
    // document once the promise has settled.
    await task.destroy()
  }
}

export interface RenderedPdfPage {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

/**
 * Render one PDF page to a fresh `<canvas>` at `scale` (1 = 72
 * dpi). Throws when pdf.js cannot load or render the page — the
 * caller reports the failure, it never shows an empty canvas as
 * a success.
 */
export async function renderPdfPage(
  bytes: Uint8Array,
  pageNumber: number,
  scale: number,
): Promise<RenderedPdfPage> {
  const lib = await loadPdfJs()
  const task = lib.getDocument({ data: new Uint8Array(bytes) })
  try {
    const doc = await task.promise
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    // pdf.js 6: render takes the canvas element (`canvas`), not
    // the 2D context — `canvasContext` is back-compat only and
    // requires `canvas: null`.
    await page.render({ canvas, viewport }).promise
    return { canvas, width: canvas.width, height: canvas.height }
  } finally {
    await task.destroy()
  }
}

/**
 * Render one PDF page to a PNG or JPEG blob at `scale`.
 * JPEG quality is 0.9 (pdf.js renders to canvas; the canvas
 * encoder does the lossy step). Throws on any render failure.
 */
export async function renderPdfPageBlob(
  bytes: Uint8Array,
  pageNumber: number,
  scale: number,
  format: 'png' | 'jpeg',
): Promise<{ blob: Blob; width: number; height: number }> {
  const { canvas, width, height } = await renderPdfPage(bytes, pageNumber, scale)
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, format === 'png' ? 'image/png' : 'image/jpeg', 0.9)
  })
  if (!blob) throw new Error(`This browser could not encode the rendered page as ${format.toUpperCase()}.`)
  return { blob, width, height }
}
