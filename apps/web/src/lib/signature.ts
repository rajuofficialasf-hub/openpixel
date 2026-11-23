/**
 * Pure helpers for PDF drawn signatures (vector polylines) and
 * document-wide text watermarks, backed by the WASM `pdf_edit` engine.
 */
import type { PdfOverlayOp } from './pdf'

/** Normalized stroke points in [0..1, 0..1] (origin top-left of the pad). */
export type NormalizedStroke = [number, number][]

export interface SignatureBox {
  page: number
  /** Bottom-left X in PDF points. */
  x: number
  /** Bottom-left Y in PDF points. */
  y: number
  width: number
  height: number
}

/**
 * Convert normalized signature pad strokes into crisp, transparent
 * vector `draw` ops inside the target PDF box.
 *
 * Tightens the strokes to their actual drawn bounding box while
 * preserving aspect ratio, so a signature drawn in part of the pad
 * fills the target box cleanly without distorting handwriting.
 */
export function strokesToDrawOps(
  strokes: NormalizedStroke[],
  box: SignatureBox,
  color: { r: number; g: number; b: number },
  strokeWidth: number,
): PdfOverlayOp[] {
  const valid = strokes.filter((s) => s.length >= 2)
  if (valid.length === 0 || box.width <= 0 || box.height <= 0 || strokeWidth <= 0) return []

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const stroke of valid) {
    for (const [nx, ny] of stroke) {
      if (nx < minX) minX = nx
      if (nx > maxX) maxX = nx
      if (ny < minY) minY = ny
      if (ny > maxY) maxY = ny
    }
  }

  const spanX = Math.max(maxX - minX, 0.02)
  const spanY = Math.max(maxY - minY, 0.02)
  // Fit drawn ink inside the box while preserving its drawn aspect ratio.
  const scale = Math.min(box.width / spanX, box.height / spanY)
  const usedW = spanX * scale
  const usedH = spanY * scale
  const offsetX = box.x + (box.width - usedW) / 2
  const offsetY = box.y + (box.height - usedH) / 2

  return valid.map((stroke) => ({
    kind: 'draw' as const,
    page: box.page,
    color,
    width: strokeWidth,
    points: stroke.map(([nx, ny]): [number, number] => {
      const px = offsetX + (nx - minX) * scale
      // Canvas Y increases downward; PDF Y increases upward.
      const py = offsetY + (maxY - ny) * scale
      return [Math.round(px * 100) / 100, Math.round(py * 100) / 100]
    }),
  }))
}

export type WatermarkPosition = 'center' | 'top' | 'bottom'

export interface WatermarkOptions {
  text: string
  size: number
  color: { r: number; g: number; b: number }
  position: WatermarkPosition
  /** Null applies to every page in the document. */
  pages: number[] | null
}

/**
 * Build centered text watermark ops across the requested pages.
 * Estimates Helvetica-Bold horizontal width (~0.56 × fontSize per char)
 * so the watermark sits centered on each page regardless of page size.
 */
export function buildWatermarkOps(
  pageCount: number,
  pageSizes: [number, number][] | undefined,
  opts: WatermarkOptions,
): PdfOverlayOp[] {
  const cleanText = opts.text.trim()
  if (!cleanText || pageCount < 1 || opts.size <= 0) return []
  const targetPages =
    opts.pages && opts.pages.length > 0
      ? opts.pages.filter((p) => Number.isInteger(p) && p >= 1 && p <= pageCount)
      : Array.from({ length: pageCount }, (_, i) => i + 1)

  const approxTextWidth = cleanText.length * opts.size * 0.56
  return targetPages.map((page) => {
    const [pw, ph] = pageSizes?.[page - 1] ?? [612, 792]
    const x = Math.max(24, Math.round((pw - approxTextWidth) / 2))
    const y =
      opts.position === 'top'
        ? Math.round(ph - Math.max(48, opts.size + 28))
        : opts.position === 'bottom'
          ? 36
          : Math.round((ph - opts.size) / 2)
    return {
      kind: 'text' as const,
      page,
      x,
      y,
      text: cleanText,
      size: opts.size,
      color: opts.color,
      font: 'helvetica_bold' as const,
    }
  })
}
