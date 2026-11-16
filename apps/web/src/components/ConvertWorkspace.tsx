import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BROWSER_DECODABLE,
  BROWSER_ENCODABLE,
  formatById,
  formatBytes,
  formatLabel,
  outputFileName,
} from '../lib/capabilities'
import { convertImage, probeImage, type ProbedImage } from '../lib/convert'
import type { Settings } from '../lib/settings'
import { WASM_STATUS } from '../lib/wasm'
import { mergeFormatLists, useWasmSupport } from '../lib/wasm-engine'
import { DropZone } from './DropZone'

type Status = 'idle' | 'probing' | 'ready' | 'converting' | 'done' | 'error'

interface ConvertWorkspaceProps {
  settings: Settings
  onSettingsChange: (settings: Settings) => void
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ConvertWorkspace({ settings, onSettingsChange }: ConvertWorkspaceProps) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [probed, setProbed] = useState<ProbedImage | null>(null)
  const [targetFormat, setTargetFormat] = useState(settings.defaultFormat)
  const [quality, setQuality] = useState(settings.defaultQuality)
  const [background, setBackground] = useState(settings.defaultBackground)
  const [pngCompression, setPngCompression] = useState(1)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [result, setResult] = useState<{ blob: Blob; url: string; width: number; height: number; bytes: number } | null>(null)
  const resultUrlRef = useRef<string | null>(null)
  // The WASM engine's format support, loaded once on mount. `null`
  // while loading and when the module is absent — the UI works
  // identically either way, just with fewer formats offered.
  const wasmSupport = useWasmSupport()
  const decodableFormats = mergeFormatLists(BROWSER_DECODABLE, wasmSupport?.decode)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    }
  }, [previewUrl])

  const handleFiles = useCallback(
    async (files: File[]) => {
      const next = files[0]
      if (!next) return
      if (resultUrlRef.current) {
        URL.revokeObjectURL(resultUrlRef.current)
        resultUrlRef.current = null
      }
      setResult(null)
      setError(null)
      setWarnings([])
      setFile(next)
      setStatus('probing')
      const url = URL.createObjectURL(next)
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old)
        return url
      })
      try {
        const info = await probeImage(next)
        setProbed(info)
        const notes: string[] = []
        if (info.format === 'unknown') {
          notes.push(
            'Format not recognised from the file signature — the browser may still be able to open it, but conversion is not guaranteed.',
          )
        } else if (!decodableFormats.includes(info.format)) {
          notes.push(
            `${formatLabel(info.format)} cannot be decoded in this browser. Use the native CLI (openpixel convert) for this file.`,
          )
        } else if (!BROWSER_DECODABLE.includes(info.format)) {
          notes.push(
            `${formatLabel(info.format)} was decoded by the built-in WASM engine (the real Rust engine, in your browser) — the preview below may not render here, but conversion works.`,
          )
        }
        if (info.format === 'gif') {
          notes.push('Animated GIF: only the first frame is converted (same as the engine’s plain decode).')
        }
        if (info.format === 'avif') {
          notes.push('AVIF decoding depends on this browser — if it fails here, use the native CLI.')
        }
        setWarnings(notes)
        setStatus('ready')
      } catch (err) {
        setProbed(null)
        setError(err instanceof Error ? err.message : 'Could not read this image.')
        setStatus('error')
      }
    },
    [decodableFormats],
  )

  const canConvert =
    file !== null && probed !== null && probed.format !== 'unknown' && decodableFormats.includes(probed.format)

  const handleConvert = useCallback(async () => {
    if (!file || !probed) return
    setStatus('converting')
    setError(null)
    setWarnings((prev) => {
      const next = [...prev]
      if (settings.metadataPolicy === 'preserve') {
        next.push(
          'Metadata policy “Preserve” was requested, but in-browser conversion (canvas or WASM engine) always strips EXIF/ICC/XMP — the output has no metadata. Use the native CLI with --metadata preserve to keep it.',
        )
      }
      if (targetFormat === 'png' && pngCompression !== 1) {
        next.push(
          `PNG compression ${pngCompression} is recorded but the browser’s canvas encoder has no PNG compression knob — the output uses the browser default.`,
        )
      }
      return next
    })
    try {
      const converted = await convertImage(file, {
        targetFormat,
        quality,
        background,
        pngCompression,
      })
      const url = URL.createObjectURL(converted.blob)
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = url
      setResult({ blob: converted.blob, url, width: converted.width, height: converted.height, bytes: converted.bytes })
      if (converted.engine === 'wasm') {
        setWarnings((prev) => [
          ...prev,
          'Converted with the built-in WASM engine (the real Rust engine, running in your browser).',
        ])
      }
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed.')
      setStatus('error')
    }
  }, [file, probed, targetFormat, quality, background, pngCompression, settings.metadataPolicy])

  const clearFile = useCallback(() => {
    setFile(null)
    setProbed(null)
    setResult(null)
    setError(null)
    setWarnings([])
    setStatus('idle')
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }
  }, [previewUrl])

  // Output targets: the canvas targets first, then whatever the
  // WASM engine adds (TIFF, QOI, HEIC, JXL, JPEG 2000, ICO, PNM,
  // TGA, GIF) when its module is present. Without the module the
  // list is exactly the old canvas-only list.
  const targets = mergeFormatLists(BROWSER_ENCODABLE, wasmSupport?.encode)
    .map((id) => formatById(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined && c.can_encode)

  return (
    <section aria-labelledby="convert-heading" className="space-y-4">
      <h2 id="convert-heading" className="text-xl font-semibold text-slate-900 dark:text-slate-100">
        Convert one image
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Files never leave your device — conversion runs locally in your browser. In-browser
        conversion handles <strong>PNG, JPEG, WebP and BMP</strong> output from PNG, JPEG, WebP,
        GIF (first frame), BMP, SVG and AVIF (browser-dependent) sources
        {wasmSupport
          ? ', plus the built-in WASM engine’s TIFF, QOI, HEIC, JXL, JPEG 2000, ICO, PNM, TGA and GIF targets (and sources) — AVIF still needs the native CLI'
          : ', plus the WASM engine’s extra formats when its module is built (see Settings, About)'}
        . Everything else needs the native CLI. {WASM_STATUS.detail}
      </p>

      {!file && (
        <DropZone
          inputId="convert-file"
          label="Drop an image here"
          hint="PNG, JPEG, WebP, GIF, BMP, SVG, AVIF — plus TIFF, QOI, HEIC, JXL and JPEG 2000 when the WASM engine is built. Nothing is uploaded."
          multiple={false}
          accept="image/*"
          onFiles={handleFiles}
        />
      )}

      {file && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
              {previewUrl &&
                (probed === null ||
                probed.format === 'unknown' ||
                BROWSER_DECODABLE.includes(probed.format) ? (
                  <img
                    src={previewUrl}
                    alt={`Preview of ${file.name}`}
                    className="mx-auto max-h-80 max-w-full rounded-lg object-contain"
                  />
                ) : (
                  <p className="rounded-lg bg-slate-100 px-3 py-8 text-center text-sm text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                    No preview for {formatLabel(probed.format)} — this browser cannot display it,
                    but the WASM engine can convert it.
                  </p>
                ))}
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-500 dark:text-slate-400">File</dt>
                <dd className="truncate font-medium text-slate-900 dark:text-slate-100">{file.name}</dd>
                <dt className="text-slate-500 dark:text-slate-400">Size</dt>
                <dd className="text-slate-900 dark:text-slate-100">{formatBytes(file.size)}</dd>
                <dt className="text-slate-500 dark:text-slate-400">Detected format</dt>
                <dd className="text-slate-900 dark:text-slate-100">
                  {probed ? formatLabel(probed.format) : status === 'probing' ? 'Reading…' : 'Unknown'}
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    Detected from magic bytes, not the extension.
                  </span>
                </dd>
                <dt className="text-slate-500 dark:text-slate-400">Dimensions</dt>
                <dd className="text-slate-900 dark:text-slate-100">
                  {probed ? `${probed.width} × ${probed.height} px` : '—'}
                </dd>
              </dl>
              <button
                type="button"
                onClick={clearFile}
                className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Choose a different file
              </button>
            </div>

            {status === 'probing' && (
              <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
                Reading image…
              </p>
            )}
          </div>

          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div>
              <label
                htmlFor="target-format"
                className="block text-sm font-medium text-slate-900 dark:text-slate-100"
              >
                Output format
              </label>
              <select
                id="target-format"
                value={targetFormat}
                onChange={(e) => setTargetFormat(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              >
                {targets.map((t) => (
                  <option key={t.format_id} value={t.format_id}>
                    {formatLabel(t.format_id)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {wasmSupport
                  ? 'Canvas targets plus the WASM engine’s TIFF, QOI, HEIC, JXL, JPEG 2000, ICO, PNM, TGA and GIF. AVIF still needs the native CLI — see the Formats tab.'
                  : 'Only formats this browser can encode. TIFF, AVIF, JXL, QOI and the rest need the native CLI — see the Formats tab.'}
              </p>
            </div>

            {(targetFormat === 'jpeg' || targetFormat === 'webp') && (
              <div>
                <label
                  htmlFor="quality"
                  className="block text-sm font-medium text-slate-900 dark:text-slate-100"
                >
                  Quality: {quality}
                </label>
                <input
                  id="quality"
                  type="range"
                  min={1}
                  max={100}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  className="mt-1 w-full"
                />
              </div>
            )}

            {targetFormat === 'png' && (
              <div>
                <label
                  htmlFor="png-compression"
                  className="block text-sm font-medium text-slate-900 dark:text-slate-100"
                >
                  PNG compression: {pngCompression} (0 = fast, 1 = default, 2 = best)
                </label>
                <input
                  id="png-compression"
                  type="range"
                  min={0}
                  max={2}
                  step={1}
                  value={pngCompression}
                  onChange={(e) => setPngCompression(Number(e.target.value))}
                  className="mt-1 w-full"
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  The browser’s canvas encoder has no PNG compression knob — this setting is
                  recorded and honoured by the CLI, but does not change the in-browser output.
                </p>
              </div>
            )}

            <div>
              <label
                htmlFor="background"
                className="block text-sm font-medium text-slate-900 dark:text-slate-100"
              >
                Background colour (flattens transparency for JPEG/BMP)
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="background"
                  type="color"
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  className="h-10 w-12 cursor-pointer rounded border border-slate-300 dark:border-slate-600"
                  aria-label="Background colour picker"
                />
                <input
                  type="text"
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  aria-label="Background colour hex value"
                  className="w-28 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div>
              <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                Metadata
              </span>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Canvas conversion always strips EXIF/ICC/XMP. “Preserve” is offered so the choice
                is explicit, but in this browser it still strips — use the CLI to preserve.
              </p>
              <div className="mt-2 flex gap-4">
                {(['strip', 'preserve'] as const).map((policy) => (
                  <label key={policy} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="metadata-policy"
                      value={policy}
                      checked={settings.metadataPolicy === policy}
                      onChange={() => onSettingsChange({ ...settings, metadataPolicy: policy })}
                    />
                    {policy === 'strip' ? 'Strip (default)' : 'Preserve (CLI only)'}
                  </label>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={handleConvert}
              disabled={!canConvert || status === 'converting'}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === 'converting' ? 'Converting…' : `Convert to ${formatLabel(targetFormat)}`}
            </button>
            {!canConvert && probed && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                This source format cannot be converted in the browser — use the native CLI.
              </p>
            )}
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <ul className="list-disc pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {status === 'error' && error && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          Conversion failed: {error}
        </div>
      )}

      {status === 'done' && result && file && (
        <div role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 dark:border-green-700 dark:bg-green-950">
          <p className="font-medium text-green-800 dark:text-green-200">
            Converted: {formatBytes(file.size)} → {formatBytes(result.bytes)} ({result.width} ×{' '}
            {result.height} px)
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => downloadBlob(result.blob, outputFileName(file.name, targetFormat))}
              className="rounded-lg bg-green-700 px-4 py-2 font-medium text-white hover:bg-green-800"
            >
              Download {outputFileName(file.name, targetFormat)}
            </button>
            <button
              type="button"
              onClick={() => {
                setResult(null)
                setStatus('ready')
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-white dark:border-slate-600 dark:text-slate-200"
            >
              Convert again with different settings
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
