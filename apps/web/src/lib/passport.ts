/**
 * Passport, NID & Government Job (Teletalk / BCS / Bank) Photo &
 * Signature Maker — 100% local in the browser.
 *
 * Includes exact dimension & max-KB compliance via binary-search JPEG
 * encoding, plus 300 DPI printable 4×6" and A4 photo sheet layouts.
 */

export interface PassportPreset {
  id: string
  labelKey: string
  width: number
  height: number
  /** Maximum file size in KB when enforced (e.g. 100 KB for Teletalk). */
  maxKb: number | null
  isSignature?: boolean
  noteKey: string
}

export const PASSPORT_PRESETS: PassportPreset[] = [
  {
    id: 'teletalk-photo',
    labelKey: 'pp.presetTeletalkPhoto',
    width: 300,
    height: 300,
    maxKb: 100,
    noteKey: 'pp.noteTeletalkPhoto',
  },
  {
    id: 'teletalk-sig',
    labelKey: 'pp.presetTeletalkSig',
    width: 300,
    height: 80,
    maxKb: 60,
    isSignature: true,
    noteKey: 'pp.noteTeletalkSig',
  },
  {
    id: 'bd-passport',
    labelKey: 'pp.presetBdPassport',
    width: 531,
    height: 650,
    maxKb: null,
    noteKey: 'pp.noteBdPassport',
  },
  {
    id: 'nid',
    labelKey: 'pp.presetNid',
    width: 300,
    height: 360,
    maxKb: 100,
    noteKey: 'pp.noteNid',
  },
  {
    id: 'us-visa',
    labelKey: 'pp.presetUsVisa',
    width: 600,
    height: 600,
    maxKb: 240,
    noteKey: 'pp.noteUsVisa',
  },
  {
    id: 'schengen',
    labelKey: 'pp.presetSchengen',
    width: 413,
    height: 531,
    maxKb: null,
    noteKey: 'pp.noteSchengen',
  },
]

export interface CoverCropRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

/**
 * Compute source crop rect (cover fit + zoom + normalized pan -1..1)
 * so preview canvas and exported file match 1:1.
 */
export function computeCoverCrop(
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
  zoom: number,
  panX: number,
  panY: number,
): CoverCropRect {
  const safeZoom = Math.max(1, Math.min(4, zoom))
  const targetRatio = targetW / Math.max(1, targetH)
  const srcRatio = srcW / Math.max(1, srcH)

  let baseW = srcW
  let baseH = srcH
  if (srcRatio > targetRatio) {
    baseW = srcH * targetRatio
  } else {
    baseH = srcW / targetRatio
  }

  const sw = baseW / safeZoom
  const sh = baseH / safeZoom
  const maxOffsetX = Math.max(0, (srcW - sw) / 2)
  const maxOffsetY = Math.max(0, (srcH - sh) / 2)
  const cx = srcW / 2 + Math.max(-1, Math.min(1, panX)) * maxOffsetX
  const cy = srcH / 2 + Math.max(-1, Math.min(1, panY)) * maxOffsetY

  return {
    sx: Math.max(0, Math.min(srcW - sw, cx - sw / 2)),
    sy: Math.max(0, Math.min(srcH - sh, cy - sh / 2)),
    sw,
    sh,
  }
}

export interface PassportExportResult {
  blob: Blob
  width: number
  height: number
  bytes: number
  qualityUsed: number
  metLimit: boolean
}

/**
 * Render cropped/framed photo at exact preset dimensions and encode as
 * JPEG — using binary search over quality when `maxKb` is enforced so
 * the output stays under the limit (e.g. <= 100 KB or <= 60 KB) at
 * maximum visual sharpness.
 */
export async function exportPassportPhoto(
  img: HTMLImageElement,
  preset: PassportPreset,
  opts: { zoom: number; panX: number; panY: number; bgColor: string; maxKb: number | null },
): Promise<PassportExportResult> {
  const canvas = document.createElement('canvas')
  canvas.width = preset.width
  canvas.height = preset.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')

  ctx.fillStyle = opts.bgColor || '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const crop = computeCoverCrop(
    img.naturalWidth,
    img.naturalHeight,
    preset.width,
    preset.height,
    opts.zoom,
    opts.panX,
    opts.panY,
  )
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height)

  const encode = (q: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', q))

  if (!opts.maxKb || opts.maxKb <= 0) {
    const blob = await encode(0.94)
    if (!blob) throw new Error('Could not encode JPEG')
    return {
      blob,
      width: canvas.width,
      height: canvas.height,
      bytes: blob.size,
      qualityUsed: 94,
      metLimit: true,
    }
  }

  const limitBytes = opts.maxKb * 1024
  const top = await encode(0.95)
  if (!top) throw new Error('Could not encode JPEG')
  if (top.size <= limitBytes) {
    return {
      blob: top,
      width: canvas.width,
      height: canvas.height,
      bytes: top.size,
      qualityUsed: 95,
      metLimit: true,
    }
  }

  let lo = 0.12
  let hi = 0.94
  let bestBlob: Blob = top
  let bestQ = 95
  let foundFitting = false

  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2
    const candidate = await encode(mid)
    if (!candidate) break
    if (candidate.size <= limitBytes) {
      bestBlob = candidate
      bestQ = Math.round(mid * 100)
      foundFitting = true
      lo = mid
    } else {
      if (!foundFitting && candidate.size < bestBlob.size) {
        bestBlob = candidate
        bestQ = Math.round(mid * 100)
      }
      hi = mid
    }
  }

  return {
    blob: bestBlob,
    width: canvas.width,
    height: canvas.height,
    bytes: bestBlob.size,
    qualityUsed: bestQ,
    metLimit: bestBlob.size <= limitBytes,
  }
}

export type PrintSheetSize = '4x6' | 'a4'

/**
 * Tile the exported passport photo onto a 300 DPI printable 4×6" or A4
 * sheet with clean cut lines so users can print multiple copies cheaply
 * at any local photo lab or home printer.
 */
export async function buildPrintSheet(
  photoBlob: Blob,
  sheet: PrintSheetSize,
): Promise<{ blob: Blob; width: number; height: number; copies: number; bytes: number }> {
  const sheetW = sheet === '4x6' ? 1800 : 2480
  const sheetH = sheet === '4x6' ? 1200 : 3508
  const cols = sheet === '4x6' ? 4 : 4
  const rows = sheet === '4x6' ? 2 : 5
  const margin = sheet === '4x6' ? 60 : 100
  const gap = 36

  const bitmap = await createImageBitmap(photoBlob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = sheetW
    canvas.height = sheetH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, sheetW, sheetH)

    const cellW = (sheetW - margin * 2 - gap * (cols - 1)) / cols
    const cellH = (sheetH - margin * 2 - gap * (rows - 1)) / rows
    const scale = Math.min(cellW / bitmap.width, cellH / bitmap.height)
    const drawW = Math.round(bitmap.width * scale)
    const drawH = Math.round(bitmap.height * scale)

    const gridW = cols * drawW + (cols - 1) * gap
    const gridH = rows * drawH + (rows - 1) * gap
    const startX = Math.round((sheetW - gridW) / 2)
    const startY = Math.round((sheetH - gridH) / 2)

    ctx.strokeStyle = '#cbd5e1'
    ctx.lineWidth = 2

    let copies = 0
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = startX + c * (drawW + gap)
        const y = startY + r * (drawH + gap)
        ctx.drawImage(bitmap, x, y, drawW, drawH)
        ctx.strokeRect(x - 1, y - 1, drawW + 2, drawH + 2)
        copies++
      }
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95))
    if (!blob) throw new Error('Could not build print sheet')
    return { blob, width: sheetW, height: sheetH, copies, bytes: blob.size }
  } finally {
    bitmap.close()
  }
}
