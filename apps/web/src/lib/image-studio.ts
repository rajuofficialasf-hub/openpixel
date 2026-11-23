/**
 * Image Studio helpers:
 * 1. Pure zero-dependency JPEG EXIF/GPS metadata parser (`parseJpegExif`)
 *    so users can inspect camera/phone/date/GPS tags locally before
 *    stripping them with one click.
 * 2. Live CSS/Canvas Filters (brightness, contrast, saturation, grayscale,
 *    blur) + Text Watermark renderer (corners, center, or diagonal tiled).
 */

export interface ExifSummary {
  hasExif: boolean
  make: string | null
  model: string | null
  dateTime: string | null
  software: string | null
  orientation: number | null
  hasGps: boolean
}

function readAscii(view: DataView, offset: number, count: number): string | null {
  if (offset < 0 || count <= 0 || offset + count > view.byteLength) return null
  let out = ''
  for (let i = 0; i < count; i++) {
    const c = view.getUint8(offset + i)
    if (c === 0) break
    out += String.fromCharCode(c)
  }
  const trimmed = out.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Parse basic EXIF IFD0 tags (Make, Model, Software, DateTime,
 * Orientation, GPS IFD pointer) from raw JPEG bytes. Safe against
 * truncated or non-JPEG inputs (never throws).
 */
export function parseJpegExif(bytes: Uint8Array): ExifSummary {
  const empty: ExifSummary = {
    hasExif: false,
    make: null,
    model: null,
    dateTime: null,
    software: null,
    orientation: null,
    hasGps: false,
  }
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return empty

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 2
  while (pos + 4 <= view.byteLength) {
    if (view.getUint8(pos) !== 0xff) break
    const marker = view.getUint8(pos + 1)
    if (marker === 0xda || marker === 0xd9) break
    const segLen = view.getUint16(pos + 2, false)
    if (segLen < 2 || pos + 2 + segLen > view.byteLength) break

    // APP1 marker + "Exif\0\0"
    if (
      marker === 0xe1 &&
      segLen >= 16 &&
      view.getUint8(pos + 4) === 0x45 &&
      view.getUint8(pos + 5) === 0x78 &&
      view.getUint8(pos + 6) === 0x69 &&
      view.getUint8(pos + 7) === 0x66 &&
      view.getUint8(pos + 8) === 0x00 &&
      view.getUint8(pos + 9) === 0x00
    ) {
      const tiffStart = pos + 10
      const byteOrder = view.getUint16(tiffStart, false)
      const little = byteOrder === 0x4949
      if (!little && byteOrder !== 0x4d4d) return empty
      if (view.getUint16(tiffStart + 2, little) !== 42) return empty
      const ifd0Rel = view.getUint32(tiffStart + 4, little)
      const ifd0 = tiffStart + ifd0Rel
      if (ifd0 + 2 > view.byteLength) return empty

      const result: ExifSummary = { ...empty, hasExif: true }
      const numEntries = view.getUint16(ifd0, little)
      for (let i = 0; i < numEntries; i++) {
        const entryOff = ifd0 + 2 + i * 12
        if (entryOff + 12 > view.byteLength) break
        const tag = view.getUint16(entryOff, little)
        const type = view.getUint16(entryOff + 2, little)
        const count = view.getUint32(entryOff + 4, little)
        const valOff = entryOff + 8

        const getStr = (): string | null => {
          if (type !== 2) return null
          const ptr = count <= 4 ? valOff : tiffStart + view.getUint32(valOff, little)
          return readAscii(view, ptr, count)
        }

        if (tag === 0x010f) result.make = getStr()
        else if (tag === 0x0110) result.model = getStr()
        else if (tag === 0x0131) result.software = getStr()
        else if (tag === 0x0132) result.dateTime = getStr()
        else if (tag === 0x0112 && type === 3) result.orientation = view.getUint16(valOff, little)
        else if (tag === 0x8825) result.hasGps = true
      }
      return result
    }
    pos += 2 + segLen
  }
  return empty
}

export interface ImageFilterState {
  brightness: number // 50..150 (100 default)
  contrast: number // 50..150 (100 default)
  saturate: number // 0..200 (100 default)
  grayscale: number // 0..100 (0 default)
  blur: number // 0..10 px (0 default)
}

export const DEFAULT_FILTERS: ImageFilterState = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  grayscale: 0,
  blur: 0,
}

export type WatermarkPlacement = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center' | 'tiled'

export interface ImageWatermarkState {
  text: string
  color: string
  opacity: number // 0.1..1
  fontSize: number // 14..96 (% scaled relative to width)
  placement: WatermarkPlacement
}

export const DEFAULT_WATERMARK: ImageWatermarkState = {
  text: '',
  color: '#ffffff',
  opacity: 0.55,
  fontSize: 36,
  placement: 'bottom-right',
}

export function buildCssFilter(f: ImageFilterState): string {
  const parts: string[] = []
  if (f.brightness !== 100) parts.push(`brightness(${f.brightness}%)`)
  if (f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`)
  if (f.saturate !== 100) parts.push(`saturate(${f.saturate}%)`)
  if (f.grayscale > 0) parts.push(`grayscale(${f.grayscale}%)`)
  if (f.blur > 0) parts.push(`blur(${f.blur}px)`)
  return parts.length > 0 ? parts.join(' ') : 'none'
}

/** Draw filtered image + optional text watermark onto a 2D canvas. */
export function drawStudioCanvas(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  filters: ImageFilterState,
  watermark: ImageWatermarkState,
): void {
  const w = img.naturalWidth
  const h = img.naturalHeight
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.save()
  ctx.filter = buildCssFilter(filters)
  ctx.drawImage(img, 0, 0, w, h)
  ctx.restore()

  const text = watermark.text.trim()
  if (!text) return

  const scale = Math.max(0.5, w / 900)
  const pxSize = Math.round(watermark.fontSize * scale)
  const pad = Math.round(24 * scale)

  ctx.save()
  ctx.font = `600 ${pxSize}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.fillStyle = watermark.color
  ctx.globalAlpha = Math.max(0.05, Math.min(1, watermark.opacity))
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = Math.round(4 * scale)

  if (watermark.placement === 'tiled') {
    const metrics = ctx.measureText(text)
    const stepX = Math.max(metrics.width + pad * 3, Math.round(220 * scale))
    const stepY = Math.max(pxSize * 3.2, Math.round(140 * scale))
    ctx.translate(w / 2, h / 2)
    ctx.rotate(-Math.PI / 6)
    const span = Math.hypot(w, h)
    for (let y = -span; y <= span; y += stepY) {
      for (let x = -span; x <= span; x += stepX) {
        ctx.fillText(text, x, y)
      }
    }
  } else {
    ctx.textBaseline = 'middle'
    if (watermark.placement === 'center') {
      ctx.textAlign = 'center'
      ctx.fillText(text, w / 2, h / 2)
    } else if (watermark.placement === 'top-left') {
      ctx.textAlign = 'left'
      ctx.fillText(text, pad, pad + pxSize / 2)
    } else if (watermark.placement === 'top-right') {
      ctx.textAlign = 'right'
      ctx.fillText(text, w - pad, pad + pxSize / 2)
    } else if (watermark.placement === 'bottom-left') {
      ctx.textAlign = 'left'
      ctx.fillText(text, pad, h - pad - pxSize / 2)
    } else {
      ctx.textAlign = 'right'
      ctx.fillText(text, w - pad, h - pad - pxSize / 2)
    }
  }
  ctx.restore()
}

export async function exportStudioImage(
  img: HTMLImageElement,
  filters: ImageFilterState,
  watermark: ImageWatermarkState,
  format: 'png' | 'webp' | 'jpeg',
  quality: number,
): Promise<{ blob: Blob; width: number; height: number; bytes: number }> {
  const canvas = document.createElement('canvas')
  drawStudioCanvas(canvas, img, filters, watermark)
  const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg'
  const q = format === 'png' ? undefined : Math.max(0.05, Math.min(1, quality / 100))
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, q))
  if (!blob) throw new Error('Could not export image')
  return { blob, width: canvas.width, height: canvas.height, bytes: blob.size }
}
