import { convertFileSrc } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useState } from 'react'
import type { Settings } from '../lib/settings'
import {
  convertFile,
  decodableExtensions,
  defaultOutputPath,
  encodableFormats,
  extractFrame,
  fetchFrames,
  fetchImageInfo,
  fetchMetadata,
  fileName,
  formatBytes,
  formatLabel,
  primaryExtension,
  processFile,
  type AnimationInfo,
  type ConvertResult,
  type FormatCapability,
  type ImageInfo,
  type Metadata,
  type PipelineRequest,
} from '../lib/tauri'
import { DropZone } from './DropZone'

interface ConvertWorkspaceProps {
  capabilities: FormatCapability[]
  settings: Settings
  droppedPaths: string[]
  onDroppedConsumed: () => void
}

function buildOptions(
  quality: number,
  background: string,
  metadataPolicy: string,
  selectedFrame: number | null,
): {
  quality: number | null
  png_compression: number | null
  background: string
  metadata_policy: string | null
  selected_frame: number | null
  convert_to_srgb: boolean
} {
  return {
    quality,
    png_compression: null,
    background,
    metadata_policy: metadataPolicy,
    selected_frame: selectedFrame,
    convert_to_srgb: false,
  }
}

export function ConvertWorkspace({
  capabilities,
  settings,
  droppedPaths,
  onDroppedConsumed,
}: ConvertWorkspaceProps) {
  const [inputPath, setInputPath] = useState<string | null>(null)
  const [info, setInfo] = useState<ImageInfo | null>(null)
  const [metadata, setMetadata] = useState<Metadata | null>(null)
  const [frames, setFrames] = useState<AnimationInfo | null>(null)
  const [target, setTarget] = useState(settings.defaultFormat)
  const [quality, setQuality] = useState(settings.defaultQuality)
  const [background, setBackground] = useState(settings.defaultBackground)
  const [metadataPolicy, setMetadataPolicy] = useState<string>(settings.metadataPolicy)
  const [selectedFrame, setSelectedFrame] = useState(0)
  const [resizeFit, setResizeFit] = useState('')
  const [grayscale, setGrayscale] = useState(false)
  const [rotate, setRotate] = useState('0')
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [result, setResult] = useState<ConvertResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)

  const encodable = encodableFormats(capabilities)
  const targetCap = capabilities.find((c) => c.format_id === target)

  const loadFile = useCallback(
    async (path: string) => {
      setInputPath(path)
      setInfo(null)
      setMetadata(null)
      setFrames(null)
      setResult(null)
      setError(null)
      setPreviewFailed(false)
      setSelectedFrame(0)
      try {
        const [i, m, f] = await Promise.all([
          fetchImageInfo(path),
          fetchMetadata(path).catch(() => null),
          fetchFrames(path).catch(() => null),
        ])
        setInfo(i)
        setMetadata(m)
        setFrames(f)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [],
  )

  const pickFile = useCallback(async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: decodableExtensions(capabilities) }],
    })
    if (typeof picked === 'string') void loadFile(picked)
  }, [capabilities, loadFile])

  // Files dropped onto the window (App.tsx forwards the paths).
  useEffect(() => {
    if (droppedPaths.length > 0) {
      void loadFile(droppedPaths[0])
      onDroppedConsumed()
    }
  }, [droppedPaths, loadFile, onDroppedConsumed])

  const pipeline: PipelineRequest = {
    resize_fit: null,
    grayscale,
    rotate_degrees: rotate === '0' ? null : Number(rotate),
    flip_horizontal: flipH,
    flip_vertical: flipV,
  }
  const resizeParts = resizeFit.split('x').map((p) => Number(p.trim()))
  if (resizeParts.length === 2 && resizeParts[0] > 0 && resizeParts[1] > 0) {
    pipeline.resize_fit = [resizeParts[0], resizeParts[1]]
  }
  const hasPipeline =
    pipeline.resize_fit !== null ||
    pipeline.grayscale ||
    pipeline.rotate_degrees !== null ||
    pipeline.flip_horizontal ||
    pipeline.flip_vertical

  const runConvert = async () => {
    if (!inputPath) return
    setBusy(true)
    setBusyLabel('Converting…')
    setError(null)
    setResult(null)
    try {
      const ext = primaryExtension(capabilities, target)
      const output = await save({
        defaultPath: defaultOutputPath(inputPath, target, capabilities),
        filters: [{ name: target.toUpperCase(), extensions: [ext] }],
      })
      if (output === null) {
        setBusy(false)
        return
      }
      const options = buildOptions(quality, background, metadataPolicy, null)
      const r = hasPipeline
        ? await processFile(inputPath, output, target, options, pipeline)
        : await convertFile(inputPath, output, target, options)
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const runExtractFrame = async () => {
    if (!inputPath || !frames) return
    setBusy(true)
    setBusyLabel(`Extracting frame ${selectedFrame}…`)
    setError(null)
    setResult(null)
    try {
      const output = await save({
        defaultPath: defaultOutputPath(inputPath, 'png', capabilities),
        filters: [{ name: 'PNG', extensions: ['png'] }],
      })
      if (output === null) {
        setBusy(false)
        return
      }
      const options = buildOptions(quality, background, metadataPolicy, null)
      const r = await extractFrame(inputPath, output, selectedFrame, options)
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const qualityApplies = target === 'jpeg' || target === 'webp' || target === 'avif'
  const targetHasNoAlpha = targetCap !== undefined && !targetCap.supports_alpha

  return (
    <div className="space-y-6">
      <DropZone
        onPick={() => void pickFile()}
        label="Convert an image"
        hint="The native engine converts it — PNG, JPEG, WebP, TIFF, AVIF, JXL, SVG and more. Files never leave your device."
      />

      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {inputPath && (
        <div className="grid gap-6 md:grid-cols-2">
          <section aria-label="Source image" className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">SOURCE</h2>
            <p className="mt-1 break-all text-sm font-medium">{fileName(inputPath)}</p>
            <p className="break-all text-xs text-slate-500 dark:text-slate-400">{inputPath}</p>
            {info ? (
              <div className="mt-3">
                <img
                  src={convertFileSrc(inputPath)}
                  alt={`Preview of ${fileName(inputPath)}`}
                  className="max-h-64 w-auto max-w-full rounded-lg border border-slate-200 dark:border-slate-700"
                  onError={() => setPreviewFailed(true)}
                />
                {previewFailed && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    No preview in the app window for this format — the info below comes from the engine.
                  </p>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-slate-500 dark:text-slate-400">Detected format</dt>
                  <dd>{info.format.toUpperCase()}</dd>
                  <dt className="text-slate-500 dark:text-slate-400">Dimensions</dt>
                  <dd>
                    {info.width} × {info.height}
                  </dd>
                  <dt className="text-slate-500 dark:text-slate-400">Colour</dt>
                  <dd>
                    {info.color_type}
                    {info.has_alpha ? ' · alpha' : ''}
                  </dd>
                  <dt className="text-slate-500 dark:text-slate-400">File size</dt>
                  <dd>{formatBytes(info.file_size_bytes)}</dd>
                  {info.is_animated && (
                    <>
                      <dt className="text-slate-500 dark:text-slate-400">Frames</dt>
                      <dd>
                        {info.frame_count ?? frames?.frame_count ?? '?'} {frames?.is_multi_page ? '(multi-page)' : '(animated)'}
                      </dd>
                    </>
                  )}
                  {info.orientation !== null && (
                    <>
                      <dt className="text-slate-500 dark:text-slate-400">EXIF orientation</dt>
                      <dd>{info.orientation}</dd>
                    </>
                  )}
                  <dt className="text-slate-500 dark:text-slate-400">Metadata</dt>
                  <dd>
                    {[
                      info.has_exif ? 'EXIF' : null,
                      info.has_icc ? 'ICC' : null,
                      info.has_xmp ? 'XMP' : null,
                    ]
                      .filter(Boolean)
                      .join(', ') || 'none'}
                  </dd>
                </dl>
                {metadata?.camera_make && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {metadata.camera_make} {metadata.camera_model ?? ''} · {metadata.date_time ?? ''}
                    {metadata.gps ? ` · GPS ${metadata.gps[0].toFixed(5)}, ${metadata.gps[1].toFixed(5)}` : ''}
                  </p>
                )}
                {metadata && metadata.warnings.length > 0 && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    Metadata warnings: {metadata.warnings.join('; ')}
                  </p>
                )}
                {info.note && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{info.note}</p>}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500" role="status">
                Reading image info…
              </p>
            )}
          </section>

          <section aria-label="Conversion settings" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">OUTPUT</h2>
            <div>
              <label htmlFor="target-format" className="block text-sm font-medium">
                Output format
              </label>
              <select
                id="target-format"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
              >
                {encodable.map((c) => (
                  <option key={c.format_id} value={c.format_id}>
                    {formatLabel(capabilities, c.format_id)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {encodable.length} encodable formats, from the engine registry. SVG is decode-only;
                HEIC / HEIF / APNG / RAW / PSD are not convertible in this build.
              </p>
            </div>

            <div>
              <label htmlFor="quality" className="block text-sm font-medium">
                Quality: {quality}
              </label>
              <input
                id="quality"
                type="range"
                min={1}
                max={100}
                value={quality}
                disabled={!qualityApplies}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="w-full"
              />
              {!qualityApplies && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Quality applies to JPEG, WebP and AVIF only; {target.toUpperCase()} ignores it.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="background" className="block text-sm font-medium">
                Background colour (flattens transparency)
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="background"
                  type="color"
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  className="h-10 w-12 rounded border border-slate-300 dark:border-slate-600"
                />
                <span className="text-sm">{background}</span>
              </div>
              {targetHasNoAlpha && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {target.toUpperCase()} has no alpha channel — transparent pixels become {background}.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="metadata-policy" className="block text-sm font-medium">
                Metadata
              </label>
              <select
                id="metadata-policy"
                value={metadataPolicy}
                onChange={(e) => setMetadataPolicy(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
              >
                <option value="strip">Strip (default)</option>
                <option value="preserve">Preserve (EXIF / ICC / XMP)</option>
                <option value="preserve-color-profiles">Preserve colour profiles only</option>
                <option value="normalize-orientation">Normalise orientation</option>
              </select>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Preservation is byte-exact for JPEG and PNG targets only; other targets drop
                metadata and the result says so.
              </p>
            </div>

            <fieldset>
              <legend className="text-sm font-medium">Processing (optional)</legend>
              <div className="mt-2 space-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <span>Resize to fit</span>
                  <input
                    type="text"
                    value={resizeFit}
                    onChange={(e) => setResizeFit(e.target.value)}
                    placeholder="800x600"
                    aria-label="Resize to fit, width x height"
                    className="w-28 rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-700"
                  />
                  <span className="text-xs text-slate-500 dark:text-slate-400">never upscales</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} />
                  Grayscale
                </label>
                <label className="flex items-center gap-2">
                  <span>Rotate</span>
                  <select
                    value={rotate}
                    onChange={(e) => setRotate(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-700"
                  >
                    <option value="0">None</option>
                    <option value="90">90°</option>
                    <option value="180">180°</option>
                    <option value="270">270°</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={flipH} onChange={(e) => setFlipH(e.target.checked)} />
                  Flip horizontal
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={flipV} onChange={(e) => setFlipV(e.target.checked)} />
                  Flip vertical
                </label>
              </div>
              {hasPipeline && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Processing is on — this runs <code>Engine::process</code> instead of plain convert.
                </p>
              )}
            </fieldset>

            {frames && frames.frame_count > 1 && (
              <div>
                <label htmlFor="frame-select" className="block text-sm font-medium">
                  Frame / page to extract ({frames.frame_count}{' '}
                  {frames.is_multi_page ? 'pages' : 'frames'})
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <select
                    id="frame-select"
                    value={selectedFrame}
                    onChange={(e) => setSelectedFrame(Number(e.target.value))}
                    className="rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
                  >
                    {frames.frames.map((f) => (
                      <option key={f.index} value={f.index}>
                        Frame {f.index} — {f.width}×{f.height}
                        {f.delay_ms !== null ? ` · ${f.delay_ms} ms` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void runExtractFrame()}
                    disabled={busy}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700"
                  >
                    Extract frame
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  GIF and multi-page TIFF extract any frame; APNG / animated WebP only report frame
                  info — extracting a later frame fails honestly.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => void runConvert()}
              disabled={busy || !info}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? busyLabel : `Convert to ${target.toUpperCase()}`}
            </button>
            {busy && (
              <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
                {busyLabel} The engine runs on this machine; large files (up to 100 MiB / 100 MP)
                can take a few seconds.
              </p>
            )}
          </section>
        </div>
      )}

      {result && (
        <section
          aria-label="Conversion result"
          role="status"
          className="rounded-xl border border-green-300 bg-green-50 p-4 text-sm dark:border-green-700 dark:bg-green-950"
        >
          <h2 className="font-semibold text-green-800 dark:text-green-200">Converted</h2>
          <p className="mt-1 break-all">
            {result.source_format.toUpperCase()} → {result.target_format.toUpperCase()} ·{' '}
            {result.width}×{result.height} · {formatBytes(result.input_bytes)} →{' '}
            {formatBytes(result.output_bytes)}
          </p>
          <p className="mt-1 break-all text-xs text-slate-600 dark:text-slate-400">{result.output_path}</p>
          {result.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-amber-700 dark:text-amber-400">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {result.metadata_preserved.length > 0 && (
            <p className="mt-1 text-xs">Metadata preserved: {result.metadata_preserved.join(', ')}</p>
          )}
          {result.metadata_dropped.length > 0 && (
            <p className="mt-1 text-xs">Metadata dropped: {result.metadata_dropped.join(', ')}</p>
          )}
          {result.orientation_applied && (
            <p className="mt-1 text-xs">Orientation applied: {result.orientation_applied}</p>
          )}
        </section>
      )}
    </div>
  )
}
