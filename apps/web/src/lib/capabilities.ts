/**
 * Format capabilities for the web app.
 *
 * Source of truth: `src/data/capabilities.json`, which is GENERATED
 * from the Rust engine — never hand-edited. Regenerate with:
 *
 *   npm run generate:capabilities
 *
 * (see `scripts/generate-capabilities.mjs` — it runs
 * `openpixel --json formats` from the release build and writes the
 * file; it fails loudly if the CLI binary is missing or the output
 * does not parse, so a stale or hand-written list cannot slip in
 * silently). The checked-in file was generated on 16 Nov 2026 from
 * the Phase 6 release binary (21 formats).
 *
 * The web app can only do a subset of what the engine can do, so this
 * module layers the honest browser limits on top of the engine data:
 * `BROWSER_DECODABLE` / `BROWSER_ENCODABLE` name exactly what the
 * canvas path in `convert.ts` handles. Anything else is labelled
 * "needs the native CLI / desktop app" in the UI, never offered as
 * a working conversion.
 */
import rawCapabilities from '../data/capabilities.json'

export interface FormatCapability {
  format_id: string
  extensions: string[]
  mime_types: string[]
  can_decode: boolean
  can_encode: boolean
  supports_alpha: boolean
  supports_animation: boolean
  supports_metadata: boolean
  supports_icc: boolean
  supports_multiple_frames: boolean
  native_dependency: string
  license: string
  status: string
  max_dimension: number
}

export const CAPABILITIES: FormatCapability[] = rawCapabilities as FormatCapability[]

/** Formats the browser can decode via createImageBitmap / <img>. */
export const BROWSER_DECODABLE: readonly string[] = [
  'png',
  'jpeg',
  'webp',
  'gif', // first frame only — same as the engine's plain decode
  'bmp',
  'svg', // rasterised by the browser, like resvg on the engine side
  'avif', // best effort: Chrome/Edge/Firefox decode it; Safari 16+ does; older browsers fail honestly
]

/**
 * Formats the browser can encode via canvas.toBlob / OffscreenCanvas.
 *
 * BMP is deliberately NOT here: `canvas.toBlob(blob, 'image/bmp')`
 * does not encode BMP in any browser — the spec says an unsupported
 * type silently falls back to PNG, so a "BMP" download used to be a
 * PNG file named `.bmp`. BMP is still decodable in the browser (see
 * `BROWSER_DECODABLE`) and encodable through the WASM engine, which
 * is why `wasmCoversConversion` routes BMP targets to WASM.
 */
export const BROWSER_ENCODABLE: readonly string[] = ['png', 'jpeg', 'webp']

/** Canvas MIME type for an encodable target (undefined = not encodable). */
export function canvasMimeType(formatId: string): string | undefined {
  switch (formatId) {
    case 'png':
      return 'image/png'
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    // No 'bmp' case: canvas.toBlob cannot encode BMP (it silently
    // returns PNG instead) — see BROWSER_ENCODABLE above.
    default:
      return undefined
  }
}

/** Whether the target has no alpha channel, so transparency is flattened. */
export function targetHasNoAlpha(formatId: string): boolean {
  const cap = formatById(formatId)
  return cap !== undefined && !cap.supports_alpha
}

export function formatById(formatId: string): FormatCapability | undefined {
  return CAPABILITIES.find((c) => c.format_id === formatId)
}

export function encodableFormats(): FormatCapability[] {
  return CAPABILITIES.filter((c) => c.can_encode)
}

/** Engine-encodable formats that the browser can also encode (the output selector). */
export function browserEncodableFormats(): FormatCapability[] {
  return encodableFormats().filter((c) => BROWSER_ENCODABLE.includes(c.format_id))
}

/** Engine-encodable formats the browser can NOT encode — CLI/desktop only. */
export function cliOnlyEncodableFormats(): FormatCapability[] {
  return encodableFormats().filter((c) => !BROWSER_ENCODABLE.includes(c.format_id))
}

export function decodableFormats(): FormatCapability[] {
  return CAPABILITIES.filter((c) => c.can_decode)
}

/** Primary extension for a format id (first listed extension). */
export function primaryExtension(formatId: string): string {
  return formatById(formatId)?.extensions[0] ?? formatId
}

/** Human label, e.g. "JPEG (.jpg)". */
export function formatLabel(formatId: string): string {
  const cap = formatById(formatId)
  if (!cap) return formatId.toUpperCase()
  const ext = cap.extensions[0]
  const name =
    formatId === 'jpeg2000' ? 'JPEG 2000' : formatId === 'pnm' ? 'PNM' : formatId.toUpperCase()
  return `${name} (.${ext})`
}

/** Output filename for a source name converted to `targetFormat`. */
export function outputFileName(sourceName: string, targetFormat: string): string {
  const stem = sourceName.replace(/\.[^.]*$/, '') || 'converted'
  return `${stem}.${primaryExtension(targetFormat)}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}
