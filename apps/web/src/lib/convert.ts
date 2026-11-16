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
 *            (rasterised), AVIF (only if this browser decodes it)
 *   targets: PNG, JPEG, WebP, BMP (whatever `canvas.toBlob` supports)
 * Everything else the engine supports (TIFF, TGA, ICO, PNM, QOI,
 * AVIF/JXL/HDR/EXR/JPEG 2000 encode, HEIC/HEIF, RAW, PSD) needs the
 * native CLI (`openpixel convert`) or the desktop app — the UI says
 * so next to the format selector instead of pretending otherwise.
 *
 * WASM engine (`./wasm-engine`): when the generated WASM module is
 * present (`npm run build:wasm`), conversions the canvas path cannot
 * do at all are tried with the real Rust engine in the browser
 * first — TIFF / QOI / HEIC / HEIF / JXL / JPEG 2000 / ICO / PNM /
 * TGA / EXR / HDR sources, and TIFF / QOI / HEIC / HEIF / JXL /
 * JPEG 2000 / ICO / PNM / TGA / GIF targets. AVIF stays unavailable
 * in WASM (no wasm32 libdav1d). If the module is absent or the
 * engine rejects the conversion, the canvas path runs exactly as
 * before and errors honestly for targets it cannot encode. The
 * canvas path is never replaced for conversions it already handles:
 * it runs in a worker (non-blocking) while WASM runs synchronously.
 *
 * Metadata: a canvas round-trip always strips EXIF/ICC/XMP, and the
 * WASM binding strips it too (it converts with the default
 * strip policy). The metadata-policy selector therefore only offers
 * Strip honestly; choosing Preserve shows a warning that in-browser
 * conversion strips metadata and the CLI is needed to preserve it.
 */
import { canvasMimeType, targetHasNoAlpha } from './capabilities'
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

/** Read dimensions + detected format without converting. */
export async function probeImage(file: Blob): Promise<ProbedImage> {
  const format = await detectFileFormat(file)
  try {
    const bitmap = await decodeBitmap(file)
    const width = bitmap.width
    const height = bitmap.height
    bitmap.close()
    return { format, width, height }
  } catch {
    // The browser cannot decode this file (e.g. TIFF / QOI / HEIC):
    // ask the WASM engine, which knows the real dimensions. A
    // failed probe still throws below — the file is genuinely
    // unreadable in this browser, and the native CLI is the answer.
    const wasm = await probeWithWasm(new Uint8Array(await file.arrayBuffer()))
    if (wasm) {
      return {
        format: (wasm.format as DetectedFormat) || format,
        width: wasm.width,
        height: wasm.height,
      }
    }
    throw new Error('This browser cannot decode this image. Try the native CLI instead.')
  }
}

async function decodeBitmap(file: Blob): Promise<ImageBitmap> {
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
        reject(new Error('This browser cannot decode this image. Try the native CLI instead.'))
      }
      img.src = url
    })
  }
}

export async function convertImage(file: Blob, options: ConvertOptions): Promise<ConvertedImage> {
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
      `The browser cannot encode ${options.targetFormat.toUpperCase()} — use the native CLI (` +
        `openpixel convert) for that format. In-browser targets are PNG, JPEG, WebP and BMP` +
        ` (plus the WASM engine's TIFF, QOI, HEIC, JXL, JPEG 2000, ICO, PNM, TGA and GIF when` +
        ` the WASM module is built — see Settings, About).`,
    )
  }
  try {
    return await convertInWorker(file, targetMime, options.quality, flattenBackground)
  } catch (err) {
    // Worker unavailable (or it failed to start) — fall back to the
    // main thread rather than failing the conversion. A decode/encode
    // failure inside the worker is rethrown as-is only when it is a
    // real conversion error; the worker path reports those via its
    // own error message, so a throw here means the worker itself
    // could not run.
    if (err instanceof WorkerUnavailableError) {
      return await convertOnMainThread(file, targetMime, options.quality, flattenBackground)
    }
    throw err
  }
}

class WorkerUnavailableError extends Error {}

async function convertInWorker(
  file: Blob,
  targetMime: string,
  quality: number,
  flattenBackground: string | null,
): Promise<ConvertedImage> {
  let worker: Worker
  try {
    worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' })
  } catch {
    throw new WorkerUnavailableError('Web Worker could not be created.')
  }
  try {
    const buffer = await file.arrayBuffer()
    const request: WorkerConvertRequest = {
      buffer,
      mimeType: file.type || 'application/octet-stream',
      targetMime,
      quality,
      flattenBackground,
    }
    const result = await new Promise<WorkerConvertSuccess>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new WorkerUnavailableError('Conversion worker timed out.'))
      }, 120_000)
      worker.onmessage = (event: MessageEvent<WorkerConvertSuccess | WorkerConvertFailure>) => {
        window.clearTimeout(timeout)
        if ('error' in event.data) reject(new Error(event.data.error))
        else resolve(event.data)
      }
      worker.onerror = () => {
        window.clearTimeout(timeout)
        reject(new WorkerUnavailableError('Conversion worker failed to load.'))
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
): Promise<ConvertedImage> {
  const bitmap = await decodeBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Could not get a 2D canvas context.')
  }
  if (flattenBackground) {
    ctx.fillStyle = flattenBackground
    ctx.fillRect(0, 0, bitmap.width, bitmap.height)
  }
  ctx.drawImage(bitmap, 0, 0)
  const width = bitmap.width
  const height = bitmap.height
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, targetMime, quality / 100)
  })
  if (!blob) {
    throw new Error(`This browser cannot encode ${targetMime}. Try PNG or JPEG instead.`)
  }
  return { blob, width, height, bytes: blob.size, engine: 'canvas' }
}
