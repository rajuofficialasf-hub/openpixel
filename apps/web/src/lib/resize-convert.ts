/**
 * Resize & compress orchestration for the Resize tab.
 *
 * Path selection (honest about quality):
 * - Target-size mode needs the WASM engine — the search is the
 *   engine's binary search over quality, and there is no canvas
 *   equivalent. Without the module the call throws and the UI
 *   says so.
 * - Plain resize prefers WASM even for canvas targets (PNG/JPEG/
 *   WebP): the engine resamples with Lanczos3, the canvas scaler
 *   is bilinear. The canvas path is only the fallback when the
 *   module is absent, and the result says which engine ran.
 * - When the WASM engine rejects a resize it should handle (an
 *   undecodable source, e.g. AVIF in a WASM build), the canvas
 *   path is tried next — the browser may decode what the engine
 *   cannot — and fails honestly if it cannot either.
 *
 * Metadata: in-browser resize always strips EXIF/ICC/XMP (the
 * WASM binding converts with the default strip policy, and a
 * canvas round-trip strips too). The UI says so; the CLI keeps
 * `--metadata preserve` for this.
 */
import { formatById, targetHasNoAlpha } from './capabilities'
import { resizeOnCanvas } from './convert'
import type { ResizeOp } from './resize'
import { processToSizeWithWasm, processWithWasm } from './wasm-engine'

export interface ResizeRequest {
  targetFormat: string
  ops: ResizeOp[]
  /** Expected output dimensions (for the canvas fallback). */
  width: number
  height: number
  quality: number
  background: string
  pngCompression: number
  /** When set, the engine searches quality to fit this many bytes. */
  targetBytes: number | null
}

export interface ResizedImage {
  blob: Blob
  width: number
  height: number
  bytes: number
  /** Which in-browser engine did the resize. */
  engine: 'wasm' | 'canvas'
  /** Quality the target-size search settled on; null when not a search. */
  qualityUsed: number | null
  /** Whether the target size was met; null when not a search. */
  targetMet: boolean | null
  warnings: string[]
}

function mimeTypeFor(targetFormat: string): string {
  return formatById(targetFormat)?.mime_types[0] ?? 'application/octet-stream'
}

export async function resizeImage(file: Blob, req: ResizeRequest): Promise<ResizedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const opsJson = JSON.stringify(req.ops)
  const background = targetHasNoAlpha(req.targetFormat) ? req.background : null
  if (req.targetBytes !== null) {
    const sized = await processToSizeWithWasm(bytes, req.targetFormat, {
      opsJson,
      quality: req.quality,
      background,
      pngCompression: req.pngCompression,
      targetBytes: req.targetBytes,
    })
    if (!sized) {
      throw new Error(
        'Target size needs the built-in WASM engine — it is not available in this browser build, ' +
          'or this target format cannot be searched (WebP is encoded losslessly only; use JPEG, ' +
          'or leave target size empty).',
      )
    }
    const blob = new Blob([sized.bytes], { type: mimeTypeFor(req.targetFormat) })
    return {
      blob,
      width: sized.width,
      height: sized.height,
      bytes: blob.size,
      engine: 'wasm',
      qualityUsed: sized.quality,
      targetMet: sized.target_met,
      warnings: sized.warnings,
    }
  }
  const wasm = await processWithWasm(bytes, req.targetFormat, {
    opsJson,
    quality: req.quality,
    background,
    pngCompression: req.pngCompression,
  })
  if (wasm) {
    const blob = new Blob([wasm.bytes], { type: mimeTypeFor(req.targetFormat) })
    return {
      blob,
      width: wasm.width,
      height: wasm.height,
      bytes: blob.size,
      engine: 'wasm',
      qualityUsed: null,
      targetMet: null,
      warnings: wasm.warnings,
    }
  }
  const canvas = await resizeOnCanvas(
    file,
    {
      targetFormat: req.targetFormat,
      quality: req.quality,
      background: req.background,
      pngCompression: req.pngCompression,
    },
    req.width,
    req.height,
  )
  return {
    blob: canvas.blob,
    width: canvas.width,
    height: canvas.height,
    bytes: canvas.bytes,
    engine: 'canvas',
    qualityUsed: null,
    targetMet: null,
    warnings: [
      'Resized with the browser canvas (bilinear) — the WASM engine was not available, so this is not the Lanczos3 path.',
    ],
  }
}
