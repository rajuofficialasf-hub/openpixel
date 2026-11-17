import { useCallback, useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import {
  BROWSER_DECODABLE,
  BROWSER_ENCODABLE,
  formatById,
  formatBytes,
  formatLabel,
  outputFileName,
} from '../lib/capabilities'
import { convertImage, probeImage, ProbeError } from '../lib/convert'
import type { Settings } from '../lib/settings'
import { recordActivity } from '../lib/activity'
import { mergeFormatLists, useWasmSupport } from '../lib/wasm-engine'
import { DropZone } from './DropZone'
import { ToolPageHeader } from './ToolPage'

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
  resultWidth: number
  resultHeight: number
}

interface BatchWorkspaceProps {
  settings: Settings
  /** Files handed over from the homepage upload — consumed once on mount. */
  initialFiles?: File[]
  onInitialFilesConsumed?: () => void
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

function statusChipProps(status: ItemStatus): {
  color: 'success' | 'error' | 'info' | 'default'
  label: string
} {
  switch (status) {
    case 'done':
      return { color: 'success', label: 'done' }
    case 'failed':
    case 'skipped':
      return { color: 'error', label: status }
    case 'converting':
      return { color: 'info', label: 'Converting…' }
    case 'probing':
      return { color: 'info', label: 'Reading…' }
    default:
      return { color: 'default', label: status }
  }
}

export function BatchWorkspace({ settings, initialFiles, onInitialFilesConsumed }: BatchWorkspaceProps) {
  const [items, setItems] = useState<BatchItem[]>([])
  const [targetFormat, setTargetFormat] = useState(settings.defaultFormat)
  const [running, setRunning] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [zipError, setZipError] = useState<string | null>(null)
  const itemsRef = useRef<BatchItem[]>([])
  // The WASM engine's format support, loaded once on mount. `null`
  // while loading and when the module is absent — batch works
  // identically either way, just with fewer formats offered.
  const wasmSupport = useWasmSupport()
  const decodableFormats = mergeFormatLists(BROWSER_DECODABLE, wasmSupport?.decode)
  const encodableFormats = mergeFormatLists(BROWSER_ENCODABLE, wasmSupport?.encode)
    .map((id) => formatById(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined && c.can_encode)

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
      resultWidth: 0,
      resultHeight: 0,
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
                  status: decodableFormats.includes(info.format) ? 'ready' : 'skipped',
                  error: decodableFormats.includes(info.format)
                    ? null
                    : `${formatLabel(info.format)} cannot be decoded in this browser — use the native CLI.`,
                }
              : p,
          ),
        )
      } catch (err) {
        setItems((prev) =>
          prev.map((p) => {
            if (p.id !== item.id) return p
            // The format was sniffed even though the file cannot be
            // decoded here: skip it with its real format and reason,
            // like the known-undecodable path above — not "failed",
            // since no conversion was attempted.
            if (err instanceof ProbeError && err.format !== 'unknown') {
              return {
                ...p,
                sourceFormat: err.format,
                status: 'skipped',
                error: `${formatLabel(err.format)} cannot be decoded in this browser — use the native CLI.`,
              }
            }
            return {
              ...p,
              status: 'failed',
              error: err instanceof Error ? err.message : 'Could not read this image.',
            }
          }),
        )
      }
    }
  }, [decodableFormats])

  // Homepage hand-off: files dropped on the home page arrive here
  // already loaded. Consume them once; the ref guard also covers
  // StrictMode's double effect run in development.
  const initialConsumedRef = useRef(false)
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0 && !initialConsumedRef.current) {
      initialConsumedRef.current = true
      void addFiles(initialFiles)
      onInitialFilesConsumed?.()
    }
  }, [initialFiles, addFiles, onInitialFilesConsumed])

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
          recordActivity({
            fileName: item.file.name,
            fileSize: item.file.size,
            fileType: item.file.type || 'image',
            tool: 'batch',
            result: `Converted to ${formatLabel(targetFormat)} · ${converted.width}×${converted.height} · ${formatBytes(converted.bytes)}`,
          })
          setItems((prev) =>
            prev.map((p) =>
              p.id === item.id
                ? {
                    ...p,
                    status: 'done',
                    resultBlob: converted.blob,
                    resultBytes: converted.bytes,
                    resultWidth: converted.width,
                    resultHeight: converted.height,
                  }
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
    <Box component="section" aria-labelledby="batch-heading">
      <Stack spacing={3}>
        <ToolPageHeader
          headingId="batch-heading"
          title="Batch conversion"
          description={
            <>
              Add several images and convert them together — still entirely on your device. Files are processed
              up to {settings.batchWorkers} at a time (see Settings). A file that fails never stops the rest of
              the batch. Files this browser cannot decode are skipped with a reason.
            </>
          }
        />

        <DropZone
          inputId="batch-files"
          label="Drop images here for batch conversion"
          hint="PNG, JPEG, WebP, GIF, BMP, SVG, AVIF (browser-dependent) — plus TIFF, QOI, HEIC, JXL and JPEG 2000 when the WASM engine is built. Nothing is uploaded."
          multiple
          accept="image/*"
          onFiles={addFiles}
        />

        {items.length > 0 && (
          <>
            <Stack direction="row" flexWrap="wrap" alignItems="flex-end" spacing={1.5}>
              <Box>
                <Typography variant="subtitle2" component="label" htmlFor="batch-target-format">
                  Output format for all files
                </Typography>
                <Select
                  native
                  id="batch-target-format"
                  value={targetFormat}
                  onChange={(e) => setTargetFormat(e.target.value)}
                  sx={{ mt: 0.5, minWidth: 160 }}
                >
                  {encodableFormats.map((t) => (
                    <option key={t.format_id} value={t.format_id}>
                      {formatLabel(t.format_id)}
                    </option>
                  ))}
                </Select>
              </Box>
              <Button type="button" variant="contained" onClick={convertAll} disabled={running || readyCount === 0}>
                {running ? 'Converting…' : `Convert ${readyCount} file${readyCount === 1 ? '' : 's'}`}
              </Button>
              <Button
                type="button"
                variant="contained"
                color="success"
                startIcon={<DownloadIcon />}
                onClick={downloadAllAsZip}
                disabled={zipping || doneCount === 0}
              >
                {zipping ? 'Building zip…' : `Download all (${doneCount}) as .zip`}
              </Button>
              <Button type="button" variant="outlined" onClick={clearAll} disabled={running}>
                Clear list
              </Button>
            </Stack>

            <Typography role="status" aria-live="polite" variant="body2" color="text.secondary">
              {items.length} file{items.length === 1 ? '' : 's'} — {doneCount} converted, {failedCount}{' '}
              failed, {skippedCount} skipped (cannot decode in this browser)
            </Typography>
            {zipError && (
              <Typography role="alert" variant="body2" color="error">
                Zip download failed: {zipError} — individual downloads below still work.
              </Typography>
            )}

            <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {items.map((item) => {
                const chip = statusChipProps(item.status)
                return (
                  <Card key={item.id} component="li">
                    <CardContent
                      sx={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 1.5,
                        p: 2,
                        '&:last-child': { pb: 2 },
                      }}
                    >
                      <Box
                        component="img"
                        src={item.thumbUrl}
                        alt={`Thumbnail of ${item.file.name}`}
                        sx={{ width: 56, height: 56, borderRadius: 1, objectFit: 'cover' }}
                      />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          variant="body2"
                          fontWeight={500}
                          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {item.file.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatBytes(item.file.size)}
                          {item.width > 0 ? ` · ${item.width} × ${item.height} px` : ''} · source{' '}
                          {formatLabel(item.sourceFormat)}
                          {item.status === 'done' ? ` → ${formatBytes(item.resultBytes)}` : ''}
                        </Typography>
                        {item.error && (
                          <Typography role="alert" variant="caption" color="error" display="block">
                            {item.error}
                          </Typography>
                        )}
                        {item.status === 'done' &&
                          targetFormat === 'ico' &&
                          item.width > 0 &&
                          (item.resultWidth < item.width || item.resultHeight < item.height) && (
                            <Typography variant="caption" display="block">
                              Resized to {item.resultWidth}×{item.resultHeight} for ICO — ICO supports max
                              256×256.
                            </Typography>
                          )}
                      </Box>
                      <Chip color={chip.color} label={chip.label} size="small" />
                      {item.status === 'done' && item.resultBlob && (
                        <Button
                          type="button"
                          variant="contained"
                          color="success"
                          size="small"
                          onClick={() =>
                            downloadBlob(item.resultBlob as Blob, outputFileName(item.file.name, targetFormat))
                          }
                        >
                          Download
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outlined"
                        size="small"
                        onClick={() => removeItem(item.id)}
                        aria-label={`Remove ${item.file.name} from the batch`}
                      >
                        Remove
                      </Button>
                    </CardContent>
                  </Card>
                )
              })}
            </Stack>
          </>
        )}
      </Stack>
    </Box>
  )
}
