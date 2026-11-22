/**
 * Local, in-browser conversion.
 *
 * Everything here runs on the device: files are read with the File
 * API, decoded with `createImageBitmap` / `<img>`, and re-encoded
 * with a canvas. Nothing is uploaded anywhere — there is no server
 * in this app at all.
 *
 * What converts here (honest list — see also `capabilities.ts`):
 *   sources: PNG, JPEG, WebP, GIF (first frame only), BMP, SVG
 *            (rasterised by the WASM engine with resvg — the canvas
 *            worker cannot decode SVG: `createImageBitmap` rejects
 *            every SVG blob, so SVG→PNG/JPEG/WebP is routed to WASM
 *            by `wasmCoversConversion`; without the WASM module the
 *            main-thread `<img>` fallback in `convertOnMainThread`
 *            draws the SVG instead), AVIF (only if this browser
 *            decodes it)
 *   targets: PNG, JPEG, WebP (whatever `canvas.toBlob` supports);
 *            BMP goes through the WASM engine, never the canvas —
 *            `canvas.toBlob` silently returns PNG for `image/bmp`.
 * Everything else the engine supports (TIFF, TGA, ICO, PNM, QOI,
 * AVIF/JXL/HDR/EXR/JPEG 2000 encode, HEIC/HEIF, RAW, PSD) needs the
 * native CLI (`openpixel convert`) or the desktop app — the UI says
 * so next to the format selector instead of pretending otherwise.
 *
 * WASM engine (`./wasm-engine`): when the generated WASM module is
 * present (`npm run build:wasm`), conversions the canvas path cannot
 * do at all are tried with the real Rust engine in the browser
 * first — TIFF / QOI / HEIC / HEIF / JXL / JPEG 2000 / ICO / PNM /
 * TGA / EXR / HDR sources, SVG sources (the worker's
 * `createImageBitmap` rejects every SVG blob), and TIFF / QOI /
 * HEIC / HEIF / JXL / JPEG 2000 / ICO / PNM / TGA / GIF targets.
 * AVIF stays unavailable in WASM (no wasm32 libdav1d). If the module
 * is absent or the engine rejects the conversion, the canvas path
 * runs exactly as before and errors honestly for targets it cannot
 * encode. The canvas path is never replaced for conversions it
 * already handles: it runs in a worker (non-blocking) while WASM
 * runs synchronously.
 *
 * Metadata: a canvas round-trip always strips EXIF/ICC/XMP, and the
 * WASM binding strips it too (it converts with the default
 * strip policy). The metadata-policy selector therefore only offers
 * Strip honestly; choosing Preserve shows a warning that in-browser
 * conversion strips metadata and the CLI is needed to preserve it.
 */
import { canvasMimeType, targetHasNoAlpha } from './capabilities'
import { translate, type Language } from './i18n'
import { detectFileFormat, type DetectedFormat } from './detect'
import {
  convertWithWasm,
  getWasmSupport,
  probeWithWasm,
  wasmCoversConversion,
} from './wasm-engine'
import type { WorkerConvertFailure, WorkerConvertRequest, WorkerConvertSuccess } from '../worker'

export interface ConvertOptions {
  targetFormat: string
  quality: number // 1–100 (JPEG/WebP; ignored for PNG/BMP)
  background: string // hex colour used to flatten alpha for JPEG/BMP
  pngCompression: number // 0–2, UI-only note: canvas PNG has no compression knob
}

export interface ConvertedImage {
  blob: Blob
  width: number
  height: number
  bytes: number
  /** Which in-browser engine did the conversion. */
  engine: 'wasm' | 'canvas'
}

export interface ProbedImage {
  format: DetectedFormat
  width: number
  height: number
}

/**
 * Thrown by {@link probeImage} when the file cannot be decoded in
 * this browser (and the WASM engine is absent or also cannot read
 * it). It carries the format sniffed from the magic bytes, so the
 * UI can still show the real detected format instead of "Unknown":
 * a failed probe is not a failed conversion, and the format was
 * genuinely detected — discarding it made the UI lie twice (wrong
 * format, wrong "Conversion failed" label for something that was
 * never attempted).
 */
export class ProbeError extends Error {
  readonly format: DetectedFormat

  constructor(format: DetectedFormat, lang: Language = 'en') {
    super(translate(lang, 'lib.cv.probe'))
    this.name = 'ProbeError'
    this.format = format
  }
}

/** Read dimensions + detected format without converting. */
export async function probeImage(file: Blob, lang: Language = 'en'): Promise<ProbedImage> {
  const format = await detectFileFormat(file)
  try {
    const bitmap = await decodeBitmap(file, lang)
    const width = bitmap.width
    const height = bitmap.height
    bitmap.close()
    return { format, width, height }
  } catch {
    // The browser cannot decode this file (e.g. TIFF / QOI / HEIC):
    // ask the WASM engine, which knows the real dimensions.
    const wasm = await probeWithWasm(new Uint8Array(await file.arrayBuffer()))
    if (wasm) {
      return {
        format: (wasm.format as DetectedFormat) || format,
        width: wasm.width,
        height: wasm.height,
      }
    }
    // Last resort: an `<img>` can display files `createImageBitmap`
    // rejects — notably every SVG (verified 16 Nov 2026: the worker
    // and `createImageBitmap` refuse SVG blobs while `<img>` renders
    // them). Reading dimensions from the element is what lets the
    // no-WASM build offer SVG conversion at all (the main-thread
    // `<img>` fallback in `convertOnMainThread` does the rasterising).
    // Dimensions are the element's natural size, so a viewBox-only
    // SVG reports the browser's 300×150 default here, where the
    // WASM route uses the viewBox size.
    try {
      const img = await loadImageElement(file, lang)
      return { format, width: img.naturalWidth, height: img.naturalHeight }
    } catch {
      // A failed probe still throws below — the file is genuinely
      // unreadable in this browser, and the native CLI is the answer.
      throw new ProbeError(format, lang)
    }
  }
}

async function decodeBitmap(file: Blob, lang: Language = 'en'): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    // Fallback for formats createImageBitmap rejects (e.g. some BMP/SVG
    // in some browsers): decode through an <img> element instead.
    return await new Promise<ImageBitmap>((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        createImageBitmap(img).then(resolve, reject)
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error(translate(lang, 'lib.cv.probe')))
      }
      img.src = url
    })
  }
}

export async function convertImage(file: Blob, options: ConvertOptions, lang: Language = 'en'): Promise<ConvertedImage> {
  const sourceFormat = await detectFileFormat(file)
  const flattenBackground = targetHasNoAlpha(options.targetFormat) ? options.background : null
  // WASM first — but only for conversions the canvas path cannot do
  // at all (a source the browser cannot decode, or a target the
  // canvas cannot encode). The canvas worker stays the default for
  // everything it handles: it is non-blocking, and the WASM call
  // runs synchronously on this thread. When the module is absent or
  // the engine rejects the conversion, execution falls through to
  // the canvas path below, which errors honestly for targets it
  // cannot encode.
  if (sourceFormat !== 'unknown') {
    const support = await getWasmSupport()
    if (wasmCoversConversion(sourceFormat, options.targetFormat, support)) {
      const wasmResult = await convertWithWasm(
        new Uint8Array(await file.arrayBuffer()),
        options.targetFormat,
        options.quality,
        flattenBackground,
      )
      if (wasmResult) {
        const blob = new Blob([wasmResult.bytes], { type: wasmResult.mimeType })
        return {
          blob,
          width: wasmResult.width,
          height: wasmResult.height,
          bytes: blob.size,
          engine: 'wasm',
        }
      }
    }
  }
  const targetMime = canvasMimeType(options.targetFormat)
  if (!targetMime) {
    throw new Error(
      translate(lang, 'lib.cv.encodeTarget', { fmt: options.targetFormat.toUpperCase() }),
    )
  }
  try {
    return await convertInWorker(file, targetMime, options.quality, flattenBackground, undefined, lang)
  } catch {
    // The worker is an optimisation, not the only decode path: a
    // failure there must not be terminal when the main thread can
    // still decode the file. That is exactly the SVG case —
    // `createImageBitmap` rejects SVG blobs in the worker while an
    // `<img>` on the main thread renders them (verified 16 Nov 2026:
    // every SVG failed in the worker, preview included) — and the
    // same holds for any format the worker rejects but `<img>`
    // accepts. The main-thread attempt throws its own, more
    // actionable error when it also cannot decode the file.
    return await convertOnMainThread(file, targetMime, options.quality, flattenBackground, undefined, lang)
  }
}

class WorkerUnavailableError extends Error {}

async function convertInWorker(
  file: Blob,
  targetMime: string,
  quality: number,
  flattenBackground: string | null,
  targetSize?: { width: number; height: number },
  lang: Language = 'en',
): Promise<ConvertedImage> {
  let worker: Worker
  try {
    worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' })
  } catch {
    throw new WorkerUnavailableError(translate(lang, 'lib.cv.workerCreate'))
  }
  try {
    const buffer = await file.arrayBuffer()
    const request: WorkerConvertRequest = {
      buffer,
      mimeType: file.type || 'application/octet-stream',
      targetMime,
      quality,
      flattenBackground,
      targetWidth: targetSize?.width,
      targetHeight: targetSize?.height,
    }
    const result = await new Promise<WorkerConvertSuccess>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new WorkerUnavailableError(translate(lang, 'lib.cv.workerTimeout')))
      }, 120_000)
      worker.onmessage = (event: MessageEvent<WorkerConvertSuccess | WorkerConvertFailure>) => {
        window.clearTimeout(timeout)
        if ('error' in event.data)
          reject(
            new Error(
              event.data.error === 'Conversion failed in the worker.'
                ? translate(lang, 'lib.cv.workerFailed')
                : event.data.error,
            ),
          )
        else resolve(event.data)
      }
      worker.onerror = () => {
        window.clearTimeout(timeout)
        reject(new WorkerUnavailableError(translate(lang, 'lib.cv.workerLoad')))
      }
      worker.postMessage(request, [buffer])
    })
    const blob = new Blob([result.buffer], { type: targetMime })
    return { blob, width: result.width, height: result.height, bytes: blob.size, engine: 'canvas' }
  } finally {
    worker.terminate()
  }
}

async function convertOnMainThread(
  file: Blob,
  targetMime: string,
  quality: number,
  flattenBackground: string | null,
  targetSize?: { width: number; height: number },
  lang: Language = 'en',
): Promise<ConvertedImage> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error(translate(lang, 'lib.cv.canvasCtx'))
  }
  let width: number
  let height: number
  try {
    const bitmap = await decodeBitmap(file, lang)
    // With a target size the canvas is exactly that size and the
    // bitmap is drawn scaled into it (the resize fallback); without
    // one the canvas keeps the source size (plain conversion).
    width = targetSize?.width ?? bitmap.width
    height = targetSize?.height ?? bitmap.height
    canvas.width = width
    canvas.height = height
    if (flattenBackground) {
      ctx.fillStyle = flattenBackground
      ctx.fillRect(0, 0, width, height)
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
  } catch {
    // `createImageBitmap` rejects some files an `<img>` can still
    // display — notably every SVG (the worker and `createImageBitmap`
    // both refuse SVG blobs, while `<img>` renders them). Draw the
    // element straight to the canvas instead of going through a
    // bitmap at all. This is the no-WASM fallback for SVG: with the
    // WASM module present, SVG never reaches this path (it is routed
    // to resvg first). Dimensions come from the element itself, so a
    // viewBox-only SVG renders at the browser's 300×150 default
    // here, where the WASM route uses the viewBox size.
    const img = await loadImageElement(file, lang)
    width = targetSize?.width ?? img.naturalWidth
    height = targetSize?.height ?? img.naturalHeight
    canvas.width = width
    canvas.height = height
    if (flattenBackground) {
      ctx.fillStyle = flattenBackground
      ctx.fillRect(0, 0, width, height)
    }
    ctx.drawImage(img, 0, 0, width, height)
  }
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, targetMime, quality / 100)
  })
  if (!blob) {
    throw new Error(translate(lang, 'lib.cv.encodeMime', { mime: targetMime }))
  }
  return { blob, width, height, bytes: blob.size, engine: 'canvas' }
}

/**
 * Resize with the canvas path only (the fallback when the WASM
 * engine is absent — see `resize-convert.ts`). The canvas scaler is
 * bilinear, not the engine's Lanczos3, and the caller says so in
 * its result. Only PNG/JPEG/WebP targets work here; anything else
 * throws an honest error. Target-size search is not offered on
 * this path — it needs the engine.
 */
export async function resizeOnCanvas(
  file: Blob,
  options: ConvertOptions,
  width: number,
  height: number,
  lang: Language = 'en',
): Promise<ConvertedImage> {
  const targetMime = canvasMimeType(options.targetFormat)
  if (!targetMime) {
    throw new Error(
      translate(lang, 'lib.cv.resizeNoEncode', { fmt: options.targetFormat.toUpperCase() }),
    )
  }
  const flattenBackground = targetHasNoAlpha(options.targetFormat) ? options.background : null
  const targetSize = { width, height }
  try {
    return await convertInWorker(file, targetMime, options.quality, flattenBackground, targetSize, lang)
  } catch {
    return await convertOnMainThread(
      file,
      targetMime,
      options.quality,
      flattenBackground,
      targetSize,
      lang,
    )
  }
}

/** Load a file into an `<img>` element (main thread only — workers have no DOM). */
function loadImageElement(file: Blob, lang: Language = 'en'): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(translate(lang, 'lib.cv.probe')))
    }
    img.src = url
  })
}
