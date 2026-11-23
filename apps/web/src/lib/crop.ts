/**
 * Pure crop, rotate & flip math + browser canvas export helper.
 *
 * Crop rectangles are stored in normalized [0..1] coordinates relative
 * to the *already-rotated* image dimensions so the interactive overlay
 * matches the exported pixels 1:1.
 */

export type RotationDeg = 0 | 90 | 180 | 270

export interface NormRect {
  /** Left edge in [0..1]. */
  x: number
  /** Top edge in [0..1]. */
  y: number
  /** Width in (0..1]. */
  w: number
  /** Height in (0..1]. */
  h: number
}

export interface CropTransform {
  rotation: RotationDeg
  flipH: boolean
  flipV: boolean
  crop: NormRect
}

export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

export const MIN_CROP_FRAC = 0.05

/** Dimensions of an image after 0 / 90 / 180 / 270 degree rotation. */
export function rotatedDimensions(
  naturalWidth: number,
  naturalHeight: number,
  rotation: RotationDeg,
): { width: number; height: number } {
  if (rotation === 90 || rotation === 270) {
    return { width: naturalHeight, height: naturalWidth }
  }
  return { width: naturalWidth, height: naturalHeight }
}

/** Clamp a normalized rectangle strictly inside [0..1] with minimum size. */
export function clampNormRect(rect: NormRect): NormRect {
  const w = Math.max(MIN_CROP_FRAC, Math.min(1, rect.w))
  const h = Math.max(MIN_CROP_FRAC, Math.min(1, rect.h))
  const x = Math.max(0, Math.min(1 - w, rect.x))
  const y = Math.max(0, Math.min(1 - h, rect.y))
  return { x, y, w, h }
}

/**
 * Compute the largest centred normalized crop box inside an image of
 * `imgWidth × imgHeight` matching `aspectRatio` (width / height).
 */
export function centeredAspectRect(
  imgWidth: number,
  imgHeight: number,
  aspectRatio: number | null,
): NormRect {
  if (!aspectRatio || imgWidth <= 0 || imgHeight <= 0) {
    return { x: 0, y: 0, w: 1, h: 1 }
  }
  const imgAspect = imgWidth / imgHeight
  if (imgAspect > aspectRatio) {
    // Image is wider than target aspect: full height, centred width.
    const w = aspectRatio / imgAspect
    return clampNormRect({ x: (1 - w) / 2, y: 0, w, h: 1 })
  }
  // Image is taller than target aspect: full width, centred height.
  const h = imgAspect / aspectRatio
  return clampNormRect({ x: 0, y: (1 - h) / 2, w: 1, h })
}

/** Convert a normalized crop box into exact integer output pixels. */
export function normToPixelRect(rect: NormRect, imgWidth: number, imgHeight: number): PixelRect {
  const clamped = clampNormRect(rect)
  const x = Math.round(clamped.x * imgWidth)
  const y = Math.round(clamped.y * imgHeight)
  const width = Math.max(1, Math.min(imgWidth - x, Math.round(clamped.w * imgWidth)))
  const height = Math.max(1, Math.min(imgHeight - y, Math.round(clamped.h * imgHeight)))
  return { x, y, width, height }
}

export function rotateStep(current: RotationDeg, delta: 90 | -90): RotationDeg {
  return (((current + delta) % 360) + 360) % 360 as RotationDeg
}

export interface CropExportResult {
  blob: Blob
  width: number
  height: number
  bytes: number
}

/**
 * Render an image with rotation + horizontal/vertical flip + crop
 * onto an offscreen canvas and encode it to PNG / JPEG / WebP.
 */
export async function exportCroppedImage(
  image: HTMLImageElement,
  transform: CropTransform,
  targetFormat: 'png' | 'jpeg' | 'webp',
  quality: number,
): Promise<CropExportResult> {
  const nw = image.naturalWidth
  const nh = image.naturalHeight
  const { width: rw, height: rh } = rotatedDimensions(nw, nh, transform.rotation)

  // Step 1: draw rotated & flipped full image onto intermediate canvas.
  const stage = document.createElement('canvas')
  stage.width = rw
  stage.height = rh
  const sctx = stage.getContext('2d')
  if (!sctx) throw new Error('Could not acquire 2D canvas context.')

  sctx.save()
  sctx.translate(rw / 2, rh / 2)
  sctx.rotate((transform.rotation * Math.PI) / 180)
  sctx.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1)
  sctx.drawImage(image, -nw / 2, -nh / 2)
  sctx.restore()

  // Step 2: extract exact cropped region into output canvas.
  const px = normToPixelRect(transform.crop, rw, rh)
  const out = document.createElement('canvas')
  out.width = px.width
  out.height = px.height
  const octx = out.getContext('2d')
  if (!octx) throw new Error('Could not acquire 2D canvas context.')

  if (targetFormat === 'jpeg') {
    octx.fillStyle = '#ffffff'
    octx.fillRect(0, 0, px.width, px.height)
  }
  octx.drawImage(stage, px.x, px.y, px.width, px.height, 0, 0, px.width, px.height)

  const mime = targetFormat === 'jpeg' ? 'image/jpeg' : targetFormat === 'webp' ? 'image/webp' : 'image/png'
  const q = targetFormat === 'png' ? undefined : Math.max(0.01, Math.min(1, quality / 100))

  const blob = await new Promise<Blob>((resolve, reject) => {
    out.toBlob((b) => {
      if (b) resolve(b)
      else reject(new Error(`Could not encode ${targetFormat.toUpperCase()} output.`))
    }, mime, q)
  })

  return { blob, width: px.width, height: px.height, bytes: blob.size }
}
