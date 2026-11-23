import { useCallback, useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import {
  BROWSER_DECODABLE,
  BROWSER_ENCODABLE,
  formatById,
  formatBytes,
  formatLabel,
} from '../lib/capabilities'
import { formatBatchOutputName } from '../lib/batch-rename'
import { convertImage, probeImage, ProbeError } from '../lib/convert'
import { buildResizeOps, expectedDimensions, isLossyFormat } from '../lib/resize'
import { resizeImage } from '../lib/resize-convert'
import type { Settings } from '../lib/settings'
import { recordActivity } from '../lib/activity'
import { mergeFormatLists, useWasmSupport } from '../lib/wasm-engine'
import { DropZone } from './DropZone'
import { EditorShell } from './EditorShell'
import { ToolPageHeader } from './ToolPage'
import { WorkflowSteps } from './WorkflowSteps'
import { useI18n } from '../lib/use-i18n'

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

function statusTextProps(
  status: ItemStatus,
  t: (key: string, vars?: Record<string, string | number>) => string,
): {
  color: 'success.main' | 'error.main' | 'info.main' | 'text.secondary'
  label: string
} {
  switch (status) {
    case 'done':
      return { color: 'success.main', label: t('st.done') }
    case 'failed':
      return { color: 'error.main', label: t('st.failed') }
    case 'skipped':
      return { color: 'error.main', label: t('st.skipped') }
    case 'converting':
      return { color: 'info.main', label: t('st.converting') }
    case 'probing':
      return { color: 'info.main', label: t('st.reading') }
    case 'queued':
      return { color: 'text.secondary', label: t('st.queued') }
    default:
      return { color: 'text.secondary', label: t('st.ready') }
  }
}

export function BatchWorkspace({ settings, initialFiles, onInitialFilesConsumed }: BatchWorkspaceProps) {
  const { t, lang } = useI18n()
  const [items, setItems] = useState<BatchItem[]>([])
  const [targetFormat, setTargetFormat] = useState(settings.defaultFormat)
  const [quality, setQuality] = useState(settings.defaultQuality)
  const [enableResize, setEnableResize] = useState(false)
  const [maxWidthText, setMaxWidthText] = useState('1920')
  const [maxHeightText, setMaxHeightText] = useState('1080')
  const [enableRename, setEnableRename] = useState(false)
  const [renamePattern, setRenamePattern] = useState('{name}-{n}')
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
        const info = await probeImage(item.file, lang)
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
                    : t('bt.cannotDecode', { format: formatLabel(info.format) }),
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
                error: t('bt.cannotDecode', { format: formatLabel(err.format) }),
              }
            }
            return {
              ...p,
              status: 'failed',
              error: err instanceof Error ? err.message : t('cv.errRead'),
            }
          }),
        )
      }
    }
  }, [decodableFormats, lang, t])

  // Homepage / paste hand-off: consume each distinct `initialFiles`
  // reference once (StrictMode-safe and supports repeated paste).
  const lastInitialRef = useRef<File[] | null>(null)
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0 && lastInitialRef.current !== initialFiles) {
      lastInitialRef.current = initialFiles
      void addFiles(initialFiles)
      onInitialFilesConsumed?.()
    }
  }, [initialFiles, addFiles, onInitialFilesConsumed])

  const outputNameFor = useCallback(
    (originalName: string, index: number): string =>
      formatBatchOutputName(
        originalName,
        targetFormat,
        index,
        enableRename ? { pattern: renamePattern } : {},
      ),
    [enableRename, renamePattern, targetFormat],
  )

  const convertAll = useCallback(async () => {
    if (running) return
    setRunning(true)
    const queue = itemsRef.current.filter((i) => i.status === 'ready' || i.status === 'failed')
    const workers = Math.min(settings.batchWorkers, 4)
    const maxW = Number.parseInt(maxWidthText, 10)
    const maxH = Number.parseInt(maxHeightText, 10)
    const shouldResize = enableResize && Number.isInteger(maxW) && maxW > 0 && Number.isInteger(maxH) && maxH > 0
    let cursor = 0
    const runOne = async () => {
      while (cursor < queue.length) {
        const item = queue[cursor++]
        setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'converting', error: null } : p)))
        try {
          let resultBlob: Blob
          let resultBytes: number
          let resultWidth: number
          let resultHeight: number
          if (shouldResize && item.width > 0 && item.height > 0) {
            const { ops } = buildResizeOps(
              'fit',
              maxW,
              maxH,
              settings.defaultBackground,
              false,
              item.width,
              item.height,
            )
            const exp = expectedDimensions('fit', maxW, maxH, item.width, item.height, false)
            const resized = await resizeImage(
              item.file,
              {
                targetFormat,
                ops,
                width: exp.width,
                height: exp.height,
                quality,
                background: settings.defaultBackground,
                pngCompression: 1,
                targetBytes: null,
              },
              lang,
            )
            resultBlob = resized.blob
            resultBytes = resized.bytes
            resultWidth = resized.width
            resultHeight = resized.height
          } else {
            const converted = await convertImage(
              item.file,
              {
                targetFormat,
                quality,
                background: settings.defaultBackground,
                pngCompression: 1,
              },
              lang,
            )
            resultBlob = converted.blob
            resultBytes = converted.bytes
            resultWidth = converted.width
            resultHeight = converted.height
          }
          recordActivity({
            fileName: item.file.name,
            fileSize: item.file.size,
            fileType: item.file.type || 'image',
            tool: 'batch',
            result: `Converted to ${formatLabel(targetFormat)} · ${resultWidth}×${resultHeight} · ${formatBytes(resultBytes)}`,
            resultKey: 'act.convert',
            resultParams: {
              format: formatLabel(targetFormat),
              w: resultWidth,
              h: resultHeight,
              bytes: formatBytes(resultBytes),
            },
          })
          setItems((prev) =>
            prev.map((p) =>
              p.id === item.id
                ? {
                    ...p,
                    status: 'done',
                    resultBlob,
                    resultBytes,
                    resultWidth,
                    resultHeight,
                  }
                : p,
            ),
          )
        } catch (err) {
          setItems((prev) =>
            prev.map((p) =>
              p.id === item.id
                ? { ...p, status: 'failed', error: err instanceof Error ? err.message : t('bt.errConvert') }
                : p,
            ),
          )
        }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, workers) }, () => runOne()))
    setRunning(false)
  }, [
    running,
    settings.batchWorkers,
    settings.defaultBackground,
    quality,
    enableResize,
    maxWidthText,
    maxHeightText,
    targetFormat,
    lang,
    t,
  ])

  const downloadAllAsZip = useCallback(async () => {
    const done = itemsRef.current.filter((i) => i.status === 'done' && i.resultBlob)
    if (done.length === 0) return
    setZipping(true)
    setZipError(null)
    try {
      const zip = new JSZip()
      const usedNames = new Map<string, number>()
      done.forEach((item, idx) => {
        const candidate = outputNameFor(item.file.name, idx)
        const count = usedNames.get(candidate) ?? 0
        usedNames.set(candidate, count + 1)
        const finalName =
          count === 0
            ? candidate
            : candidate.replace(/(\.[^.]+)?$/, `-${count + 1}$1`)
        zip.file(finalName, item.resultBlob as Blob)
      })
      const blob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(blob, `openpixel-${targetFormat}.zip`)
    } catch (err) {
      setZipError(err instanceof Error ? err.message : t('bt.errZip'))
    } finally {
      setZipping(false)
    }
  }, [outputNameFor, targetFormat, t])

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
    <Box component="section" aria-labelledby="batch-heading" sx={{ display: 'flex', flexDirection: 'column', flex: { lg: 1 }, minHeight: { lg: 0 } }}>
      <Stack spacing={2} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 } }}>
        <ToolPageHeader
          headingId="batch-heading"
          title={t('bt.title')}
          description={t('bt.desc', { n: settings.batchWorkers })}
          actions={
            <WorkflowSteps
              activeStep={items.length === 0 ? 0 : doneCount > 0 ? 2 : 1}
              steps={[t('step.uploadFiles'), t('step.options'), t('step.download')]}
            />
          }
        />

        {items.length === 0 ? (
          <Box sx={{ flex: { lg: 1 }, display: 'flex', flexDirection: 'column', '& > *': { flex: { lg: 1 } } }}>
            <DropZone
              inputId="batch-files"
              label={t('bt.dropLabel')}
              hint={t('bt.dropHint')}
              multiple
              accept="image/*"
              onFiles={addFiles}
            />
          </Box>
        ) : (
          <EditorShell
            main={
              <>
                <DropZone
                  inputId="batch-files"
                  label={t('bt.dropLabel')}
                  hint={t('bt.dropHint')}
                  multiple
                  compact
                  accept="image/*"
                  onFiles={addFiles}
                />
                <Stack
                  component="ul"
                  spacing={1}
                  sx={{
                    listStyle: 'none',
                    m: 0,
                    p: 0,
                    maxHeight: { lg: 'calc(100dvh - 340px)' },
                    overflowY: { lg: 'auto' },
                    pr: { lg: 0.5 },
                  }}
                >
                  {items.map((item, idx) => {
                    const status = statusTextProps(item.status, t)
                    const outName = outputNameFor(item.file.name, idx)
                    return (
                      <Card key={item.id} component="li">
                        <CardContent
                          sx={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: 1.5,
                            p: 1.5,
                            '&:last-child': { pb: 1.5 },
                          }}
                        >
                          <Box
                            component="img"
                            src={item.thumbUrl}
                            alt={`Thumbnail of ${item.file.name}`}
                            sx={{ width: 44, height: 44, borderRadius: 1, objectFit: 'cover' }}
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
                              {item.width > 0 ? ` · ${item.width} × ${item.height} px` : ''} ·{' '}
                              <Box component="span" sx={{ fontFamily: 'monospace' }}>
                                {formatLabel(item.sourceFormat)}
                                {item.status === 'done' ? ` → ${formatLabel(targetFormat)}` : ''}
                              </Box>
                              {item.status === 'done'
                                ? ` · ${item.resultWidth}×${item.resultHeight} · ${formatBytes(item.resultBytes)}`
                                : ''}
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
                                  {t('cv.icoResized', { w: item.resultWidth, h: item.resultHeight })}
                                </Typography>
                              )}
                          </Box>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', color: status.color }}>
                            {status.label}
                          </Typography>
                          {item.status === 'done' && item.resultBlob && (
                            <Button
                              type="button"
                              variant="outlined"
                              size="small"
                              onClick={() => downloadBlob(item.resultBlob as Blob, outName)}
                            >
                              {t('common.download')}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="outlined"
                            size="small"
                            onClick={() => removeItem(item.id)}
                            aria-label={t('bt.removeAria', { name: item.file.name })}
                          >
                            {t('common.remove')}
                          </Button>
                        </CardContent>
                      </Card>
                    )
                  })}
                </Stack>
              </>
            }
            tools={
              <Card>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    {t('common.settings')}
                  </Typography>
                  <Stack spacing={2} sx={{ mt: 1 }}>
                    <Box>
                      <Typography variant="subtitle2" component="label" htmlFor="batch-target-format">
                        {t('bt.outputForAll')}
                      </Typography>
                      <Select
                        native
                        fullWidth
                        id="batch-target-format"
                        value={targetFormat}
                        onChange={(e) => setTargetFormat(e.target.value)}
                        sx={{ mt: 0.5 }}
                      >
                        {encodableFormats.map((f) => (
                          <option key={f.format_id} value={f.format_id}>
                            {formatLabel(f.format_id)}
                          </option>
                        ))}
                      </Select>
                    </Box>

                    {(isLossyFormat(targetFormat) || targetFormat === 'webp') && (
                      <Box>
                        <Typography variant="caption" fontWeight={600} component="label">
                          {t('bt.qualityLabel', { n: quality })}
                        </Typography>
                        <Slider
                          size="small"
                          aria-label={t('cv.qualityAria')}
                          min={1}
                          max={100}
                          value={quality}
                          onChange={(_, v) => setQuality(v as number)}
                        />
                      </Box>
                    )}

                    <Box sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
                      <FormControlLabel
                        control={
                          <Switch
                            id="batch-resize-toggle"
                            size="small"
                            checked={enableResize}
                            onChange={(e) => setEnableResize(e.target.checked)}
                          />
                        }
                        label={<Typography variant="body2">{t('bt.resizeToggle')}</Typography>}
                      />
                      {enableResize && (
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mt: 1 }}>
                          <TextField
                            id="batch-max-width"
                            size="small"
                            type="number"
                            label={t('bt.maxWidth')}
                            value={maxWidthText}
                            onChange={(e) => setMaxWidthText(e.target.value)}
                          />
                          <TextField
                            id="batch-max-height"
                            size="small"
                            type="number"
                            label={t('bt.maxHeight')}
                            value={maxHeightText}
                            onChange={(e) => setMaxHeightText(e.target.value)}
                          />
                        </Box>
                      )}
                    </Box>

                    <Box sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
                      <FormControlLabel
                        control={
                          <Switch
                            id="batch-rename-toggle"
                            size="small"
                            checked={enableRename}
                            onChange={(e) => setEnableRename(e.target.checked)}
                          />
                        }
                        label={<Typography variant="body2">{t('bt.renameToggle')}</Typography>}
                      />
                      {enableRename && (
                        <Stack spacing={0.75} sx={{ mt: 1 }}>
                          <TextField
                            id="batch-rename-pattern"
                            size="small"
                            fullWidth
                            label={t('bt.renamePattern')}
                            value={renamePattern}
                            onChange={(e) => setRenamePattern(e.target.value)}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {t('bt.renameHint')}
                          </Typography>
                          <Typography variant="caption" color="primary.main" sx={{ fontFamily: 'monospace' }}>
                            {t('bt.renamePreview', {
                              out: outputNameFor(items[0]?.file.name ?? 'photo.png', 0),
                            })}
                          </Typography>
                        </Stack>
                      )}
                    </Box>

                    <Typography role="status" aria-live="polite" variant="body2" color="text.secondary">
                      {t('bt.status', {
                        n: items.length,
                        pl: items.length === 1 ? '' : 's',
                        d: doneCount,
                        f: failedCount,
                        sk: skippedCount,
                      })}
                    </Typography>
                    {zipError && (
                      <Typography role="alert" variant="body2" color="error">
                        {t('bt.zipFailed', { msg: zipError })}
                      </Typography>
                    )}
                    <Button type="button" variant="contained" size="large" fullWidth onClick={convertAll} disabled={running || readyCount === 0}>
                      {running ? t('bt.converting') : t('bt.convertN', { n: readyCount, s: readyCount === 1 ? '' : 's' })}
                    </Button>
                    <Button
                      type="button"
                      variant="contained"
                      color="success"
                      fullWidth
                      startIcon={<DownloadIcon />}
                      onClick={downloadAllAsZip}
                      disabled={zipping || doneCount === 0}
                    >
                      {zipping ? t('bt.zipping') : t('bt.downloadAll', { n: doneCount })}
                    </Button>
                    <Button type="button" variant="outlined" fullWidth onClick={clearAll} disabled={running}>
                      {t('bt.clear')}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            }
          />
        )}
      </Stack>
    </Box>
  )
}
