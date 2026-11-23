/**
 * Dual-mode Background Removal — 100% local in the browser ($0 cost):
 *
 * 1. **Instant Color / Magic Remove** (0 MB download, runs immediately):
 *    Pure pixel flood-fill (Magic Wand from corners or clicked pixel)
 *    or global chroma/color keying with soft edge feathering. Ideal
 *    for logos, signatures, passport photos, and solid backdrops.
 *
 * 2. **AI Auto** ($0, open-source ONNX model via `@imgly/background-removal`):
 *    Lazy-imported strictly when the user clicks AI Auto — zero bytes
 *    shipped in the main bundle. Downloads the model once into browser
 *    cache (~30-40 MB), then works offline on portraits, products, and
 *    complex scenes.
 */

export type RgbTuple = [number, number, number]

export interface ColorKeyOptions {
  /** Target RGB colour to remove (0..255 each). */
  targetColor: RgbTuple
  /** Tolerance 0..100 (higher removes more similar shades). */
  tolerance: number
  /** Edge feathering 0..40 (soft alpha transition along borders). */
  feather: number
  /**
   * True = Magic Wand flood-fill starting from `seed` (or all 4 image
   * corners when `seed` is null), protecting matching colours inside
   * the subject (e.g. white eyes/shirts).
   * False = remove matching colour globally (great for logos with
   * enclosed holes like O / A / B).
   */
  contiguous: boolean
  /** Optional clicked pixel coordinate [x, y] in image pixel space. */
  seed?: [number, number] | null
}

export interface BgProgress {
  phase: 'download' | 'process'
  label: string
  /** 0..1 */
  progress: number
}

export function rgbToHex([r, g, b]: RgbTuple): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

export function hexToRgbTuple(hex: string): RgbTuple | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** Sample the average RGB of the four image corners as a smart default backdrop colour. */
export function sampleCornerColor(pixels: Uint8ClampedArray, width: number, height: number): RgbTuple {
  if (width <= 0 || height <= 0) return [255, 255, 255]
  const coords: [number, number][] = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ]
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  for (const [x, y] of coords) {
    const idx = (y * width + x) * 4
    if (pixels[idx + 3] > 0) {
      r += pixels[idx]
      g += pixels[idx + 1]
      b += pixels[idx + 2]
      count++
    }
  }
  if (count === 0) return [255, 255, 255]
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)]
}

/**
 * Pure pixel-level colour removal with optional contiguous flood-fill
 * and soft edge feathering. Returns a fresh RGBA `Uint8ClampedArray`.
 */
export function removeBackgroundByColorPixels(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  opts: ColorKeyOptions,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src)
  const total = width * height
  if (total <= 0) return out

  const [tr, tg, tb] = opts.targetColor
  // Max Euclidean RGB distance is sqrt(255^2 * 3) ≈ 441.67
  const maxDist = Math.max(0, Math.min(100, opts.tolerance)) * 3.2
  const featherSpan = Math.max(0, Math.min(40, opts.feather)) * 2.5
  const outerDist = maxDist + featherSpan
  const innerDist = Math.max(0, maxDist - featherSpan * 0.35)

  const distAt = (pIdx: number): number => {
    const off = pIdx * 4
    const dr = src[off] - tr
    const dg = src[off + 1] - tg
    const db = src[off + 2] - tb
    return Math.sqrt(dr * dr + dg * dg + db * db)
  }

  const applyAlpha = (pIdx: number, d: number) => {
    const off = pIdx * 4
    if (d <= innerDist) {
      out[off + 3] = 0
    } else if (d < outerDist && outerDist > innerDist) {
      const factor = (d - innerDist) / (outerDist - innerDist)
      out[off + 3] = Math.round(src[off + 3] * factor)
    }
  }

  if (!opts.contiguous) {
    for (let i = 0; i < total; i++) {
      const d = distAt(i)
      if (d < outerDist) applyAlpha(i, d)
    }
    return out
  }

  // Contiguous BFS flood-fill from seed pixel (or 4 edges/corners)
  const visited = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0

  const tryPush = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return
    const pIdx = y * width + x
    if (visited[pIdx]) return
    const d = distAt(pIdx)
    if (d <= outerDist) {
      visited[pIdx] = 1
      applyAlpha(pIdx, d)
      // Continue expanding through background pixels within maxDist (plus soft fringe)
      if (d <= maxDist + featherSpan * 0.5) {
        queue[tail++] = pIdx
      }
    }
  }

  if (opts.seed) {
    const sx = Math.max(0, Math.min(width - 1, Math.round(opts.seed[0])))
    const sy = Math.max(0, Math.min(height - 1, Math.round(opts.seed[1])))
    tryPush(sx, sy)
  } else {
    // Seed along border pixels that match the backdrop colour
    for (let x = 0; x < width; x++) {
      tryPush(x, 0)
      tryPush(x, height - 1)
    }
    for (let y = 1; y < height - 1; y++) {
      tryPush(0, y)
      tryPush(width - 1, y)
    }
  }

  while (head < tail) {
    const cur = queue[head++]
    const cx = cur % width
    const cy = (cur - cx) / width
    if (cx > 0) tryPush(cx - 1, cy)
    if (cx + 1 < width) tryPush(cx + 1, cy)
    if (cy > 0) tryPush(cx, cy - 1)
    if (cy + 1 < height) tryPush(cx, cy + 1)
  }

  return out
}

/** Run Instant Color / Magic Remove on an image Blob, returning a transparent PNG Blob. */
export async function removeBackgroundByColor(
  image: Blob,
  opts: ColorKeyOptions,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(image)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(bitmap, 0, 0)
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const nextPixels = removeBackgroundByColorPixels(imgData.data, canvas.width, canvas.height, opts)
    const outData = new ImageData(new Uint8ClampedArray(nextPixels), canvas.width, canvas.height)
    ctx.putImageData(outData, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Could not encode PNG output')
    return { blob, width: canvas.width, height: canvas.height }
  } finally {
    bitmap.close()
  }
}

/** Read the corner backdrop colour of an image Blob on an offscreen canvas. */
export async function detectBackdropColor(image: Blob): Promise<RgbTuple> {
  const bitmap = await createImageBitmap(image)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return [255, 255, 255]
    ctx.drawImage(bitmap, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    return sampleCornerColor(data, canvas.width, canvas.height)
  } finally {
    bitmap.close()
  }
}

/**
 * Run 100% free, local in-browser AI background removal via
 * `@imgly/background-removal` (lazy-loaded on first click).
 */
export async function removeBackgroundWithAi(
  image: Blob,
  onProgress?: (p: BgProgress) => void,
): Promise<{ blob: Blob; width: number; height: number }> {
  onProgress?.({ phase: 'download', label: 'Loading local AI engine…', progress: 0.05 })
  const { removeBackground } = await import('@imgly/background-removal')
  const blob = await removeBackground(image, {
    model: 'isnet_fp16',
    output: { format: 'image/png', quality: 1 },
    progress: (key: string, current: number, total: number) => {
      const ratio = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0
      const isFetch = key.startsWith('fetch:')
      onProgress?.({
        phase: isFetch ? 'download' : 'process',
        label: isFetch ? 'Downloading AI model (cached for offline use)…' : 'Removing background locally…',
        progress: ratio,
      })
    },
  })
  const bitmap = await createImageBitmap(blob)
  const width = bitmap.width
  const height = bitmap.height
  bitmap.close()
  return { blob, width, height }
}

/**
 * Composite a transparent cutout PNG onto an optional solid background
 * colour (e.g. White, Passport Blue, Red, or Transparent) and export
 * in PNG, WebP, or JPEG.
 */
export async function compositeCutout(
  cutoutPng: Blob,
  bgColor: string | null,
  format: 'png' | 'webp' | 'jpeg',
  quality: number,
): Promise<{ blob: Blob; width: number; height: number; bytes: number }> {
  const bitmap = await createImageBitmap(cutoutPng)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    const fill = bgColor ?? (format === 'jpeg' ? '#ffffff' : null)
    if (fill) {
      ctx.fillStyle = fill
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(bitmap, 0, 0)
    const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg'
    const q = format === 'png' ? undefined : Math.max(0.01, Math.min(1, quality / 100))
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, q))
    if (!blob) throw new Error('Could not encode final image')
    return { blob, width: canvas.width, height: canvas.height, bytes: blob.size }
  } finally {
    bitmap.close()
  }
}
