/**
 * Resize & compress — pure logic (no DOM, no WASM, no React).
 *
 * Unit-tested in `resize.test.ts`. The workspace component
 * (`ResizeWorkspace.tsx`) and the engine paths in
 * `resize-convert.ts` build on these helpers, so the size math,
 * the target-size parsing and the never-upscale clamping are all
 * testable without a browser.
 *
 * Quality rules (grounded in the engine, see docs/CODECS.md):
 * - The resize itself always uses the engine's Lanczos3 pipeline
 *   (via WASM in the browser) — the canvas fallback is bilinear
 *   and is only used when the WASM module is absent.
 * - Only JPEG, AVIF, HEIC and HEIF have a quality knob the engine
 *   honours. WebP is encoded losslessly only by image-rs 0.25, so
 *   quality does not change its size — a target-size search for
 *   WebP would be theatre, and the engine refuses it honestly.
 *   PNG is lossless too; its only lever is the compression level.
 */

export type ResizeMode = 'fit' | 'fill' | 'pad' | 'exact'

export interface ResizeOp {
  kind: 'resize_fit' | 'resize_fill' | 'pad' | 'resize'
  width: number
  height: number
  color?: string
}

export interface ResizePreset {
  id: string
  label: string
  width: number
  height: number
}

export const RESIZE_PRESETS: ResizePreset[] = [
  { id: 'fhd', label: 'Full HD 1920×1080', width: 1920, height: 1080 },
  { id: 'hd', label: 'HD 1280×720', width: 1280, height: 720 },
  { id: '800', label: '800×600', width: 800, height: 600 },
  { id: '512', label: '512×512', width: 512, height: 512 },
  { id: '256', label: '256×256', width: 256, height: 256 },
  { id: 'passport', label: 'Passport 300×400', width: 300, height: 400 },
  { id: 'custom', label: 'Custom', width: 0, height: 0 },
]

/** The engine's per-side dimension limit (see openpixel-core). */
export const MAX_RESIZE_DIMENSION = 16384

/** Formats whose encode quality the engine honours. */
export function isLossyFormat(formatId: string): boolean {
  return ['jpeg', 'avif', 'heic', 'heif'].includes(formatId)
}

/**
 * Formats a target-size search can run on: the lossy ones, plus
 * PNG (best compression). WebP is deliberately excluded — the
 * engine encodes it losslessly only.
 */
export function targetSizeSupported(formatId: string): boolean {
  return isLossyFormat(formatId) || formatId === 'png'
}

/**
 * Parse a target file size: "200 KB", "200KB", "1.5 MB", "51200"
 * (bytes), "200 B". Units are binary (KB = 1024, MB = 1024²,
 * GB = 1024³) — the same units `formatBytes` reports, so a size
 * the UI shows round-trips back. Decimals are allowed with a
 * unit ("1.5MB"); a bare number must be a whole number of bytes.
 * Returns `null` for anything invalid (empty, zero, negative,
 * fractional bytes, garbage).
 */
export function parseTargetSize(input: string): number | null {
  const s = input.trim()
  if (!s) return null
  const m = /^(\d+(?:\.\d+)?)\s*(gb|mb|kb|b)?$/i.exec(s)
  if (!m) return null
  const value = Number(m[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = (m[2] ?? '').toLowerCase()
  const multiplier =
    unit === 'gb' ? 1024 ** 3 : unit === 'mb' ? 1024 ** 2 : unit === 'kb' ? 1024 : 1
  if (!unit && !Number.isInteger(value)) return null
  const bytes = Math.round(value * multiplier)
  return bytes > 0 ? bytes : null
}

/** Height that keeps the source aspect ratio for a new width. */
export function lockedHeight(width: number, srcWidth: number, srcHeight: number): number {
  if (srcWidth <= 0 || srcHeight <= 0 || width <= 0) return 1
  return Math.max(1, Math.round((width * srcHeight) / srcWidth))
}

/** Width that keeps the source aspect ratio for a new height. */
export function lockedWidth(height: number, srcWidth: number, srcHeight: number): number {
  if (srcWidth <= 0 || srcHeight <= 0 || height <= 0) return 1
  return Math.max(1, Math.round((height * srcWidth) / srcHeight))
}

/** Clamp requested dimensions to the source (never upscale). */
export function clampToSource(
  width: number,
  height: number,
  srcWidth: number,
  srcHeight: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.min(width, srcWidth)),
    height: Math.max(1, Math.min(height, srcHeight)),
  }
}

/**
 * Whether the requested resize would upscale the image (grow it
 * beyond the source in either dimension). Pad never upscales the
 * image content — it pads — so it is always false there.
 */
export function requestsUpscale(
  mode: ResizeMode,
  width: number,
  height: number,
  srcWidth: number,
  srcHeight: number,
): boolean {
  if (mode === 'pad') return false
  if (mode === 'fit') {
    return Math.min(width / srcWidth, height / srcHeight) > 1
  }
  return width > srcWidth || height > srcHeight
}

/**
 * Dimensions the resize will produce, before running it — shown in
 * the UI so never-upscale clamping is visible up front, not a
 * surprise in the result.
 */
export function expectedDimensions(
  mode: ResizeMode,
  width: number,
  height: number,
  srcWidth: number,
  srcHeight: number,
  allowUpscale: boolean,
): { width: number; height: number } {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  switch (mode) {
    case 'fit': {
      const scale = Math.min(w / srcWidth, h / srcHeight)
      const s = allowUpscale ? scale : Math.min(scale, 1)
      return {
        width: Math.max(1, Math.round(srcWidth * s)),
        height: Math.max(1, Math.round(srcHeight * s)),
      }
    }
    case 'fill':
    case 'exact':
      return allowUpscale ? { width: w, height: h } : clampToSource(w, h, srcWidth, srcHeight)
    case 'pad':
      return { width: w, height: h }
  }
}

/**
 * Build the engine ops for a resize. With `allowUpscale` off, the
 * request is clamped to the source size first — except Fit, which
 * needs no clamping (ResizeFit never upscales by itself), and Pad,
 * which never upscales the image content (it pads). Fit *with*
 * upscaling allowed cannot use ResizeFit at all, so the fitted
 * dimensions are computed here and sent as an exact Resize.
 * Returns the ops plus whether clamping changed the request (the
 * UI shows that as a note).
 */
export function buildResizeOps(
  mode: ResizeMode,
  width: number,
  height: number,
  background: string,
  allowUpscale: boolean,
  srcWidth: number,
  srcHeight: number,
): { ops: ResizeOp[]; clamped: boolean } {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  switch (mode) {
    case 'fit':
      if (allowUpscale) {
        const dims = expectedDimensions(mode, w, h, srcWidth, srcHeight, true)
        return { ops: [{ kind: 'resize', width: dims.width, height: dims.height }], clamped: false }
      }
      return { ops: [{ kind: 'resize_fit', width: w, height: h }], clamped: false }
    case 'fill': {
      if (allowUpscale) return { ops: [{ kind: 'resize_fill', width: w, height: h }], clamped: false }
      const c = clampToSource(w, h, srcWidth, srcHeight)
      return {
        ops: [{ kind: 'resize_fill', width: c.width, height: c.height }],
        clamped: c.width !== w || c.height !== h,
      }
    }
    case 'pad':
      return { ops: [{ kind: 'pad', width: w, height: h, color: background }], clamped: false }
    case 'exact': {
      if (allowUpscale) return { ops: [{ kind: 'resize', width: w, height: h }], clamped: false }
      const c = clampToSource(w, h, srcWidth, srcHeight)
      return {
        ops: [{ kind: 'resize', width: c.width, height: c.height }],
        clamped: c.width !== w || c.height !== h,
      }
    }
  }
}
