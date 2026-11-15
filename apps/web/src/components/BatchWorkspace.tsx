import { useCallback, useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  BROWSER_DECODABLE,
  browserEncodableFormats,
  formatBytes,
  formatLabel,
  outputFileName,
} from '../lib/capabilities'
import { convertImage, probeImage } from '../lib/convert'
import type { Settings } from '../lib/settings'
import { DropZone } from './DropZone'

type ItemStatus = 'queued' | 'probing' | 'ready' | 'converting' | 'done' | 'failed' | 'skipped'

interface BatchItem {
  id: string
  file: File
  thumbUrl: string
  sourceFormat: string
  width: number
  height: number
  status: ItemStatus
  error: string | null
  resultBlob: Blob | null
  resultBytes: number
}

interface BatchWorkspaceProps {
  settings: Settings
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

let nextId = 0

export function BatchWorkspace({ settings }: BatchWorkspaceProps) {
  const [items, setItems] = useState<BatchItem[]>([])
  const [targetFormat, setTargetFormat] = useState(settings.defaultFormat)
  const [running, setRunning] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [zipError, setZipError] = useState<string | null>(null)
  const itemsRef = useRef<BatchItem[]>([])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    const urls = items.map((i) => i.thumbUrl)
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [items])

  const addFiles = useCallback(async (files: File[]) => {
    const fresh: BatchItem[] = files.map((file) => ({
      id: `item-${nextId++}`,
      file,
      thumbUrl: URL.createObjectURL(file),
      sourceFormat: 'unknown',
      width: 0,
      height: 0,
      status: 'probing',
      error: null,
      resultBlob: null,
      resultBytes: 0,
    }))
    setItems((prev) => [...prev, ...fresh])
    for (const item of fresh) {
      try {
        const info = await probeImage(item.file)
        setItems((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? {
                  ...p,
                  sourceFormat: info.format,
                  width: info.width,
                  height: info.height,
                  status: BROWSER_DECODABLE.includes(info.format) ? 'ready' : 'skipped',
                  error: BROWSER_DECODABLE.includes(info.format)
                    ? null
                    : `${formatLabel(info.format)} cannot be decoded in this browser — use the native CLI.`,
                }
              : p,
          ),
        )
      } catch (err) {
        setItems((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? { ...p, status: 'failed', error: err instanceof Error ? err.message : 'Could not read this image.' }
              : p,
          ),
        )
      }
    }
  }, [])

  const convertAll = useCallback(async () => {
    if (running) return
    setRunning(true)
    const queue = itemsRef.current.filter((i) => i.status === 'ready' || i.status === 'failed')
    const workers = Math.min(settings.batchWorkers, 4)
    let cursor = 0
    const runOne = async () => {
      while (cursor < queue.length) {
        const item = queue[cursor++]
        setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'converting', error: null } : p)))
        try {
          const converted = await convertImage(item.file, {
            targetFormat,
            quality: settings.defaultQuality,
            background: settings.defaultBackground,
            pngCompression: 1,
          })
          setItems((prev) =>
            prev.map((p) =>
              p.id === item.id
                ? { ...p, status: 'done', resultBlob: converted.blob, resultBytes: converted.bytes }
                : p,
            ),
          )
        } catch (err) {
          setItems((prev) =>
            prev.map((p) =>
              p.id === item.id
                ? { ...p, status: 'failed', error: err instanceof Error ? err.message : 'Conversion failed.' }
                : p,
            ),
          )
        }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, workers) }, () => runOne()))
    setRunning(false)
  }, [running, settings.batchWorkers, settings.defaultBackground, settings.defaultQuality, targetFormat])

  const downloadAllAsZip = useCallback(async () => {
    const done = itemsRef.current.filter((i) => i.status === 'done' && i.resultBlob)
    if (done.length === 0) return
    setZipping(true)
    setZipError(null)
    try {
      const zip = new JSZip()
      for (const item of done) {
        zip.file(outputFileName(item.file.name, targetFormat), item.resultBlob as Blob)
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(blob, `openpixel-${targetFormat}.zip`)
    } catch (err) {
      setZipError(err instanceof Error ? err.message : 'Could not build the zip file.')
    } finally {
      setZipping(false)
    }
  }, [targetFormat])

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const item = prev.find((p) => p.id === id)
      if (item) URL.revokeObjectURL(item.thumbUrl)
      return prev.filter((p) => p.id !== id)
    })
  }, [])

  const clearAll = useCallback(() => {
    for (const item of itemsRef.current) URL.revokeObjectURL(item.thumbUrl)
    setItems([])
  }, [])

  const doneCount = items.filter((i) => i.status === 'done').length
  const failedCount = items.filter((i) => i.status === 'failed').length
  const skippedCount = items.filter((i) => i.status === 'skipped').length
  const readyCount = items.filter((i) => i.status === 'ready' || i.status === 'failed').length

  return (
    <section aria-labelledby="batch-heading" className="space-y-4">
      <h2 id="batch-heading" className="text-xl font-semibold text-slate-900 dark:text-slate-100">
        Batch conversion
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Add several images and convert them together — still entirely on your device. Files are
        processed up to {settings.batchWorkers} at a time (see Settings). A file that fails never
        stops the rest of the batch. Files this browser cannot decode are skipped with a reason.
      </p>

      <DropZone
        inputId="batch-files"
        label="Drop images here for batch conversion"
        hint="PNG, JPEG, WebP, GIF, BMP, SVG, AVIF (browser-dependent). Nothing is uploaded."
        multiple
        accept="image/*"
        onFiles={addFiles}
      />

      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label
                htmlFor="batch-target-format"
                className="block text-sm font-medium text-slate-900 dark:text-slate-100"
              >
                Output format for all files
              </label>
              <select
                id="batch-target-format"
                value={targetFormat}
                onChange={(e) => setTargetFormat(e.target.value)}
                className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              >
                {browserEncodableFormats().map((t) => (
                  <option key={t.format_id} value={t.format_id}>
                    {formatLabel(t.format_id)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={convertAll}
              disabled={running || readyCount === 0}
              className="mt-5 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? 'Converting…' : `Convert ${readyCount} file${readyCount === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              onClick={downloadAllAsZip}
              disabled={zipping || doneCount === 0}
              className="mt-5 rounded-lg bg-green-700 px-4 py-2 font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {zipping ? 'Building zip…' : `Download all (${doneCount}) as .zip`}
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={running}
              className="mt-5 rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Clear list
            </button>
          </div>

          <p role="status" aria-live="polite" className="text-sm text-slate-600 dark:text-slate-400">
            {items.length} file{items.length === 1 ? '' : 's'} — {doneCount} converted, {failedCount}{' '}
            failed, {skippedCount} skipped (browser cannot decode)
          </p>
          {zipError && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              Zip download failed: {zipError} — individual downloads below still work.
            </p>
          )}

          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
              >
                <img
                  src={item.thumbUrl}
                  alt={`Thumbnail of ${item.file.name}`}
                  className="h-14 w-14 rounded object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {item.file.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatBytes(item.file.size)}
                    {item.width > 0 ? ` · ${item.width} × ${item.height} px` : ''} · source{' '}
                    {formatLabel(item.sourceFormat)}
                    {item.status === 'done' ? ` → ${formatBytes(item.resultBytes)}` : ''}
                  </p>
                  {item.error && (
                    <p role="alert" className="text-xs text-red-700 dark:text-red-400">
                      {item.error}
                    </p>
                  )}
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    item.status === 'done'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      : item.status === 'failed' || item.status === 'skipped'
                        ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                        : item.status === 'converting' || item.status === 'probing'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                  }`}
                >
                  {item.status === 'probing'
                    ? 'Reading…'
                    : item.status === 'converting'
                      ? 'Converting…'
                      : item.status}
                </span>
                {item.status === 'done' && item.resultBlob && (
                  <button
                    type="button"
                    onClick={() => downloadBlob(item.resultBlob as Blob, outputFileName(item.file.name, targetFormat))}
                    className="rounded-lg bg-green-700 px-3 py-2 text-sm font-medium text-white hover:bg-green-800"
                  >
                    Download
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  aria-label={`Remove ${item.file.name} from the batch`}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
