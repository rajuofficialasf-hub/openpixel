/**
 * Conversion worker — runs off the main thread so the UI stays
 * responsive while pixels are decoded/encoded.
 *
 * Protocol (postMessage):
 *   in:  { buffer: ArrayBuffer, mimeType: string, targetMime: string,
 *          quality: number, flattenBackground: string | null }
 *   out: { buffer: ArrayBuffer, width: number, height: number }
 *        or { error: string }
 *
 * Decoding is `createImageBitmap` (browser-native: PNG/JPEG/WebP/GIF
 * first frame/BMP/SVG/AVIF where the browser supports it). Encoding
 * is `OffscreenCanvas.convertToBlob` (PNG/JPEG/WebP only — BMP is
 * not encodable by canvas: `toBlob` silently returns PNG for it,
 * so BMP targets are routed to the WASM engine instead).
 * Metadata is always stripped by a canvas round-trip — the UI says so.
 */

export interface WorkerConvertRequest {
  buffer: ArrayBuffer
  mimeType: string
  targetMime: string
  quality: number
  flattenBackground: string | null
  /** Resize output: when set, the bitmap is drawn scaled into a
   * canvas of exactly this size (the Resize tab's canvas fallback
   * — bilinear scaling, unlike the WASM engine's Lanczos3). */
  targetWidth?: number
  targetHeight?: number
}

export interface WorkerConvertSuccess {
  buffer: ArrayBuffer
  width: number
  height: number
}

export interface WorkerConvertFailure {
  error: string
}

type WorkerMessage = WorkerConvertRequest

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { buffer, mimeType, targetMime, quality, flattenBackground, targetWidth, targetHeight } =
    event.data
  try {
    const blob = new Blob([buffer], { type: mimeType })
    const bitmap = await createImageBitmap(blob)
    const width = targetWidth ?? bitmap.width
    const height = targetHeight ?? bitmap.height
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get a 2D canvas context in the worker.')
    if (flattenBackground) {
      ctx.fillStyle = flattenBackground
      ctx.fillRect(0, 0, width, height)
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const out = await canvas.convertToBlob({ type: targetMime, quality: quality / 100 })
    if (!out) {
      throw new Error(`This browser cannot encode ${targetMime}. Try PNG or JPEG instead.`)
    }
    const outBuffer = await out.arrayBuffer()
    const response: WorkerConvertSuccess = {
      buffer: outBuffer,
      width: canvas.width,
      height: canvas.height,
    }
    self.postMessage(response, { transfer: [outBuffer] })
  } catch (err) {
    const response: WorkerConvertFailure = {
      error: err instanceof Error ? err.message : 'Conversion failed in the worker.',
    }
    self.postMessage(response)
  }
}
