/**
 * Batch output filename formatter — supports prefix, suffix, or
 * pattern tokens (`{name}`, `{n}`) while keeping safe filenames and
 * the target format extension.
 */
import { outputFileName } from './capabilities'

export interface BatchRenameOptions {
  prefix?: string
  suffix?: string
  /** Optional custom pattern e.g. `photo-{n}` or `{name}-web`. */
  pattern?: string
}

function sanitizeSegment(raw: string): string {
  return raw.replace(/[<>:"/\\|?*]/g, '-').trim()
}

export function formatBatchOutputName(
  originalName: string,
  targetFormat: string,
  index: number,
  opts: BatchRenameOptions = {},
): string {
  const baseOut = outputFileName(originalName, targetFormat)
  const dotIdx = baseOut.lastIndexOf('.')
  const stem = dotIdx > 0 ? baseOut.slice(0, dotIdx) : baseOut
  const ext = dotIdx > 0 ? baseOut.slice(dotIdx) : ''
  const paddedIndex = String(index + 1).padStart(2, '0')

  const pattern = opts.pattern?.trim()
  if (pattern) {
    const rendered = sanitizeSegment(
      pattern.replaceAll('{name}', stem).replaceAll('{n}', paddedIndex),
    )
    if (rendered) return `${rendered}${ext}`
  }

  const prefix = sanitizeSegment(opts.prefix ?? '')
  const suffix = sanitizeSegment(opts.suffix ?? '')
  return `${prefix}${stem}${suffix}${ext}`
}
