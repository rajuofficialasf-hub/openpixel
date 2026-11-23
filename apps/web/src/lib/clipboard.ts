/**
 * Clipboard image copy & native Web Share helpers for processed images.
 *
 * `navigator.clipboard.write` reliably accepts `image/png` across
 * Chromium, Firefox and Safari (while JPEG/WebP often fail), so any
 * non-PNG blob is transcoded to PNG on an offscreen canvas first.
 */

async function blobToPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(bitmap, 0, 0)
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!png) throw new Error('Could not encode PNG for clipboard')
    return png
  } finally {
    bitmap.close()
  }
}

export function canCopyImageToClipboard(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  )
}

export async function copyImageBlobToClipboard(blob: Blob): Promise<void> {
  if (!canCopyImageToClipboard()) {
    throw new Error('Clipboard image copy is not supported in this browser.')
  }
  const png = await blobToPngBlob(blob)
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

export function canShareFiles(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function'
}

export async function shareImageBlob(blob: Blob, filename: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!canShareFiles()) return 'unsupported'
  const file = new File([blob], filename, { type: blob.type || 'image/png' })
  try {
    if (!navigator.canShare({ files: [file] })) return 'unsupported'
    await navigator.share({ files: [file], title: filename })
    return 'shared'
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
    throw err
  }
}
