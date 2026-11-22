import { useCallback, useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  Alert,
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
import { alpha } from '@mui/material/styles'
import DownloadIcon from '@mui/icons-material/Download'
import {
  BROWSER_DECODABLE,
  BROWSER_ENCODABLE,
  formatById,
  formatBytes,
  formatLabel,
  outputFileName,
} from '../lib/capabilities'
import { probeImage, ProbeError } from '../lib/convert'
import {
  buildResizeOps,
  expectedDimensions,
  isLossyFormat,
  lockedHeight,
  lockedWidth,
  parseTargetSize,
  requestsUpscale,
  RESIZE_PRESETS,
  targetSizeSupported,
  type ResizeMode,
} from '../lib/resize'
import { resizeImage } from '../lib/resize-convert'
import type { ResizeSettings, Settings } from '../lib/settings'
import { recordActivity } from '../lib/activity'
import { mergeFormatLists, useWasmSupport } from '../lib/wasm-engine'
import { DropZone } from './DropZone'
import { ToolPageHeader } from './ToolPage'
import { useI18n } from '../lib/use-i18n'

type ItemStatus = 'queued' | 'probing' | 'ready' | 'resizing' | 'done' | 'failed' | 'skipped'

interface ResizeResult {
  blob: Blob
  url: string
  width: number
  height: number
  bytes: number
  engine: 'wasm' | 'canvas'
  qualityUsed: number | null
  targetMet: boolean | null
  warnings: string[]
}

interface ResizeItem {
  id: string
  file: File
  thumbUrl: string
  sourceFormat: string
  width: number
  height: number
  status: ItemStatus
  error: string | null
  result: ResizeResult | null
}

interface ResizeWorkspaceProps {
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

let nextId = 0

/** Quiet mono status text for a list row — the status carries
    its meaning in words and a muted semantic colour, not a pill. */
type TFn = (key: string, vars?: Record<string, string | number>) => string

function statusTextProps(status: ItemStatus, t: TFn): {
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
    case 'resizing':
      return { color: 'info.main', label: t('st.resizing') }
    case 'probing':
      return { color: 'info.main', label: t('st.reading') }
    case 'queued':
      return { color: 'text.secondary', label: t('st.queued') }
    default:
      return { color: 'text.secondary', label: t('st.ready') }
  }
}

function modeLabels(t: TFn): { id: ResizeMode; label: string; hint: string }[] {
  return [
    { id: 'fit', label: t('rs.modeFit'), hint: t('rs.modeFitHint') },
    { id: 'fill', label: t('rs.modeFill'), hint: t('rs.modeFillHint') },
    { id: 'pad', label: t('rs.modePad'), hint: t('rs.modePadHint') },
    { id: 'exact', label: t('rs.modeExact'), hint: t('rs.modeExactHint') },
  ]
}

export function ResizeWorkspace({ settings, onSettingsChange }: ResizeWorkspaceProps) {
  const { t, lang } = useI18n()
  const [items, setItems] = useState<ResizeItem[]>([])
  const [mode, setMode] = useState<ResizeMode>(settings.resize.mode)
  const [presetId, setPresetId] = useState(settings.resize.preset)
  const initialPreset = RESIZE_PRESETS.find((p) => p.id === settings.resize.preset) ?? RESIZE_PRESETS[0]
  const [widthText, setWidthText] = useState(String(initialPreset.width || 800))
  const [heightText, setHeightText] = useState(String(initialPreset.height || 600))
  const [lockAspect, setLockAspect] = useState(true)
  const [targetFormat, setTargetFormat] = useState(settings.resize.format)
  const [quality, setQuality] = useState(settings.resize.quality)
  const [targetSizeText, setTargetSizeText] = useState('')
  const [background, setBackground] = useState(settings.defaultBackground)
  const [pngCompression, setPngCompression] = useState(1)
  const [allowUpscale, setAllowUpscale] = useState(false)
  const [running, setRunning] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [zipError, setZipError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const itemsRef = useRef<ResizeItem[]>([])
  const wasmSupport = useWasmSupport()
  const decodableFormats = mergeFormatLists(BROWSER_DECODABLE, wasmSupport?.decode)

  const width = Number.parseInt(widthText, 10)
  const height = Number.parseInt(heightText, 10)
  const widthValid = Number.isInteger(width) && width >= 1 && width <= 16384
  const heightValid = Number.isInteger(height) && height >= 1 && height <= 16384
  const targetBytes = targetSizeText.trim() === '' ? null : parseTargetSize(targetSizeText)
  const targetSizeInvalid = targetSizeText.trim() !== '' && targetBytes === null
  const targetSizeUnsupported = targetBytes !== null && !targetSizeSupported(targetFormat)
  const firstReady = items.find((i) => i.status === 'ready' || i.status === 'done' || i.status === 'resizing')
  const expected =
    firstReady && widthValid && heightValid
      ? expectedDimensions(mode, width, height, firstReady.width, firstReady.height, allowUpscale)
      : null
  const canResize =
    items.some((i) => i.status === 'ready' || i.status === 'failed') &&
    widthValid &&
    heightValid &&
    !targetSizeInvalid &&
    !targetSizeUnsupported &&
    !running

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  // Revoke object URLs only when they actually disappear (a file
  // is removed or a result is replaced) — never while a mounted
  // <img> still references them. Revoking on every `items` change
  // (the naive cleanup) breaks pending image loads with
  // net::ERR_FILE_NOT_FOUND, because thumb URLs are stable across
  // status updates.
  const liveUrlsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const current = new Set<string>()
    for (const item of items) {
      current.add(item.thumbUrl)
      if (item.result) current.add(item.result.url)
    }
    for (const url of liveUrlsRef.current) {
      if (!current.has(url)) URL.revokeObjectURL(url)
    }
    liveUrlsRef.current = current
  }, [items])

  useEffect(() => {
    const urls = liveUrlsRef.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [])

  const persistResize = useCallback(
    (patch: Partial<ResizeSettings>) => {
      onSettingsChange({ ...settings, resize: { ...settings.resize, ...patch } })
    },
    [onSettingsChange, settings],
  )

  const handleFiles = useCallback(
    async (files: File[]) => {
      setError(null)
      const fresh: ResizeItem[] = files.map((file) => ({
        id: `resize-item-${nextId++}`,
        file,
        thumbUrl: URL.createObjectURL(file),
        sourceFormat: 'unknown',
        width: 0,
        height: 0,
        status: 'probing',
        error: null,
        result: null,
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
    },
    [decodableFormats, lang, t],
  )

  const clearFiles = useCallback(() => {
    setItems([])
    setError(null)
    setZipError(null)
  }, [])

  const handleWidthChange = (value: string) => {
    setWidthText(value)
    setPresetId('custom')
    const w = Number.parseInt(value, 10)
    if (lockAspect && firstReady && Number.isInteger(w) && w >= 1) {
      setHeightText(String(lockedHeight(w, firstReady.width, firstReady.height)))
    }
  }

  const handleHeightChange = (value: string) => {
    setHeightText(value)
    setPresetId('custom')
    const h = Number.parseInt(value, 10)
    if (lockAspect && firstReady && Number.isInteger(h) && h >= 1) {
      setWidthText(String(lockedWidth(h, firstReady.width, firstReady.height)))
    }
  }

  const handlePresetChange = (id: string) => {
    setPresetId(id)
    persistResize({ preset: id })
    const preset = RESIZE_PRESETS.find((p) => p.id === id)
    if (preset && preset.id !== 'custom') {
      setWidthText(String(preset.width))
      setHeightText(String(preset.height))
    }
  }

  // Plain function, not a useCallback: it is only an onClick
  // handler, and manual memoization here trips the React Compiler
  // lint (the `expected` object is fresh every render).
  const resizeAll = async () => {
    if (!canResize) return
    setRunning(true)
    setError(null)
    const queue = itemsRef.current.filter((i) => i.status === 'ready' || i.status === 'failed')
    for (const item of queue) {
      setItems((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, status: 'resizing', error: null } : p)),
      )
      try {
        const { ops, clamped } = buildResizeOps(
          mode,
          width,
          height,
          background,
          allowUpscale,
          item.width,
          item.height,
        )
        const resized = await resizeImage(
          item.file,
          {
            targetFormat,
            ops,
            width: expected?.width ?? width,
            height: expected?.height ?? height,
            quality,
            background,
            pngCompression,
            targetBytes,
          },
          lang,
        )
        const url = URL.createObjectURL(resized.blob)
        recordActivity({
          fileName: item.file.name,
          fileSize: item.file.size,
          fileType: item.file.type || 'image',
          tool: 'resize',
          result: `Resized to ${resized.width}×${resized.height} · ${formatBytes(item.file.size)} → ${formatBytes(resized.bytes)}`,
          resultKey: 'act.resize',
          resultParams: {
            w: resized.width,
            h: resized.height,
            from: formatBytes(item.file.size),
            to: formatBytes(resized.bytes),
          },
        })
        setItems((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? {
                  ...p,
                  status: 'done',
                  result: {
                    blob: resized.blob,
                    url,
                    width: resized.width,
                    height: resized.height,
                    bytes: resized.bytes,
                    engine: resized.engine,
                    qualityUsed: resized.qualityUsed,
                    targetMet: resized.targetMet,
                    warnings: [...resized.warnings, ...(clamped ? [t('rs.warnClamped')] : [])],
                  },
                }
              : p,
          ),
        )
      } catch (err) {
        setItems((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? { ...p, status: 'failed', error: err instanceof Error ? err.message : t('rs.errResize') }
              : p,
          ),
        )
      }
    }
    setRunning(false)
  }

  const downloadAllAsZip = useCallback(async () => {
    const done = itemsRef.current.filter((i) => i.status === 'done' && i.result)
    if (done.length === 0) return
    setZipping(true)
    setZipError(null)
    try {
      const zip = new JSZip()
      for (const item of done) {
        zip.file(outputFileName(item.file.name, targetFormat), item.result!.blob)
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(blob, 'resized-images.zip')
    } catch (err) {
      setZipError(err instanceof Error ? err.message : t('bt.errZip'))
    } finally {
      setZipping(false)
    }
  }, [targetFormat, t])

  // Output targets: the canvas targets first, then whatever the
  // WASM engine adds — the same 16 browser targets as Convert.
  // AVIF is not offered: the WASM engine cannot encode it (no
  // wasm32 libdav1d) and neither can the canvas.
  const targets = mergeFormatLists(BROWSER_ENCODABLE, wasmSupport?.encode)
    .map((id) => formatById(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined && c.can_encode)

  const warnings: string[] = []
  if (firstReady) {
    if (firstReady.sourceFormat === 'jpeg' && (targetFormat === 'jpeg' || targetFormat === 'webp')) {
      warnings.push(t('rs.warnLossy'))
    }
    if (allowUpscale && requestsUpscale(mode, width, height, firstReady.width, firstReady.height)) {
      warnings.push(t('rs.warnUpscale'))
    }
    if (mode === 'exact') {
      warnings.push(t('rs.warnExact'))
    }
  }
  if (targetSizeUnsupported) {
    warnings.push(t('rs.warnTargetWebp'))
  }
  if (targetFormat === 'webp') {
    warnings.push(t('rs.warnWebpLossless'))
  }

  const single = items.length === 1 ? items[0] : null
  const doneCount = items.filter((i) => i.status === 'done').length

  return (
    <Box component="section" aria-labelledby="resize-heading">
      <Stack spacing={3}>
        <ToolPageHeader
          headingId="resize-heading"
          title={t('rs.title')}
          description={t('rs.desc')}
        />

        {items.length === 0 && (
          <DropZone
            inputId="resize-file"
            label={t('bt.dropLabel')}
            hint={t('rs.dropHint')}
            multiple
            accept="image/*"
            onFiles={handleFiles}
          />
        )}

        {items.length > 0 && (
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Settings
              </Typography>
              <Stack spacing={2.5} sx={{ mt: 1 }}>
                <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
                  <Box>
                    <Typography variant="subtitle2" component="label" htmlFor="resize-mode">
                      {t('rs.modeLabel')}
                    </Typography>
                    <Select
                      native
                      fullWidth
                      id="resize-mode"
                      value={mode}
                      onChange={(e) => {
                        const next = e.target.value as ResizeMode
                        setMode(next)
                        persistResize({ mode: next })
                      }}
                      sx={{ mt: 0.5 }}
                    >
                      {modeLabels(t).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      {modeLabels(t).find((m) => m.id === mode)?.hint}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="subtitle2" component="label" htmlFor="resize-preset">
                      {t('rs.presetLabel')}
                    </Typography>
                    <Select
                      native
                      fullWidth
                      id="resize-preset"
                      value={presetId}
                      onChange={(e) => handlePresetChange(e.target.value)}
                      sx={{ mt: 0.5 }}
                    >
                      {RESIZE_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id === 'custom' ? t('rs.presetCustom') : p.label}
                        </option>
                      ))}
                    </Select>
                  </Box>
                </Box>

                <Box>
                  <Stack direction="row" spacing={2} alignItems="flex-end" flexWrap="wrap">
                    <TextField
                      label={t('rs.width')}
                      type="number"
                      id="resize-width"
                      value={widthText}
                      onChange={(e) => handleWidthChange(e.target.value)}
                      inputProps={{ min: 1, max: 16384, 'aria-label': t('rs.widthAria') }}
                      error={!widthValid}
                      helperText={!widthValid ? t('rs.widthError') : undefined}
                      sx={{ width: 160 }}
                    />
                    <TextField
                      label={t('rs.height')}
                      type="number"
                      id="resize-height"
                      value={heightText}
                      onChange={(e) => handleHeightChange(e.target.value)}
                      inputProps={{ min: 1, max: 16384, 'aria-label': t('rs.heightAria') }}
                      error={!heightValid}
                      helperText={!heightValid ? t('rs.heightError') : undefined}
                      sx={{ width: 160 }}
                    />
                    <FormControlLabel
                      control={
                        <Switch
                          id="resize-lock-aspect"
                          checked={lockAspect}
                          onChange={(e) => setLockAspect(e.target.checked)}
                        />
                      }
                      label={t('rs.lockAspect')}
                    />
                    <FormControlLabel
                      control={
                        <Switch
                          id="resize-allow-upscale"
                          checked={allowUpscale}
                          onChange={(e) => setAllowUpscale(e.target.checked)}
                        />
                      }
                      label={t('rs.allowUpscale')}
                    />
                  </Stack>
                  {expected && firstReady && (
                    <Typography variant="body2" sx={{ mt: 1 }} id="resize-expected">
                      {t('rs.expected', { w: expected.width, h: expected.height })}
                      {t('rs.expectedFrom', { w: firstReady.width, h: firstReady.height })}
                    </Typography>
                  )}
                </Box>

                <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
                  <Box>
                    <Typography variant="subtitle2" component="label" htmlFor="resize-target-format">
                      {t('rs.outputFormat')}
                    </Typography>
                    <Select
                      native
                      fullWidth
                      id="resize-target-format"
                      value={targetFormat}
                      onChange={(e) => {
                        setTargetFormat(e.target.value)
                        persistResize({ format: e.target.value })
                      }}
                      sx={{ mt: 0.5 }}
                    >
                      {targets.map((t) => (
                        <option key={t.format_id} value={t.format_id}>
                          {formatLabel(t.format_id)}
                        </option>
                      ))}
                    </Select>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      {t('rs.targetsNote')}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="subtitle2" component="label" htmlFor="resize-target-size">
                      {t('rs.targetSize')}
                    </Typography>
                    <TextField
                      fullWidth
                      id="resize-target-size"
                      placeholder={t('rs.targetSizePlaceholder')}
                      value={targetSizeText}
                      onChange={(e) => setTargetSizeText(e.target.value)}
                      error={targetSizeInvalid}
                      helperText={
                        targetSizeInvalid ? t('rs.targetSizeInvalid') : t('rs.targetSizeHelp')
                      }
                      sx={{ mt: 0.5 }}
                    />
                  </Box>
                </Box>

                {isLossyFormat(targetFormat) && (
                  <Box>
                    <Typography variant="subtitle2" component="label">
                      {t('rs.quality', { n: quality })}
                    </Typography>
                    <Slider
                      aria-label={t('rs.qualityAria')}
                      min={1}
                      max={100}
                      value={quality}
                      disabled={targetBytes !== null}
                      onChange={(_, value) => {
                        setQuality(value as number)
                        persistResize({ quality: value as number })
                      }}
                    />
                    {targetBytes !== null && (
                      <Typography variant="caption" color="text.secondary">
                        {t('rs.qualityDisabled')}
                      </Typography>
                    )}
                  </Box>
                )}

                {targetFormat === 'png' && (
                  <Box>
                    <Typography variant="subtitle2" component="label">
                      {t('cv.pngCompression', { n: pngCompression })}
                    </Typography>
                    <Slider
                      aria-label={t('cv.pngCompressionAria')}
                      min={0}
                      max={2}
                      step={1}
                      value={pngCompression}
                      onChange={(_, value) => setPngCompression(value as number)}
                    />
                  </Box>
                )}

                <Box>
                  <Typography variant="subtitle2" component="label">
                    {t('rs.background')}
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                    <TextField
                      type="color"
                      size="small"
                      value={background}
                      onChange={(e) => setBackground(e.target.value)}
                      inputProps={{ 'aria-label': t('cv.bgPicker') }}
                      sx={{ width: 56, '& input': { p: 0.5, height: 40, cursor: 'pointer' } }}
                    />
                    <TextField
                      size="small"
                      value={background}
                      onChange={(e) => setBackground(e.target.value)}
                      inputProps={{ 'aria-label': t('cv.bgHex') }}
                      sx={{ width: 120, '& input': { fontFamily: 'monospace' } }}
                    />
                  </Stack>
                </Box>

                <Stack direction="row" spacing={1.5} flexWrap="wrap">
                  <Button
                    type="button"
                    variant="contained"
                    size="large"
                    id="resize-button"
                    onClick={resizeAll}
                    disabled={!canResize}
                  >
                    {running
                      ? t('rs.resizing')
                      : items.length > 1
                        ? t('rs.resizeAll', { n: items.length })
                        : t('rs.resize')}
                  </Button>
                  <Button type="button" variant="outlined" onClick={clearFiles}>
                    {t('rs.chooseDifferent')}
                  </Button>
                  {doneCount > 1 && (
                    <Button
                      type="button"
                      variant="outlined"
                      id="resize-download-all"
                      startIcon={<DownloadIcon />}
                      onClick={downloadAllAsZip}
                      disabled={zipping}
                    >
                      {zipping ? t('rs.zipping') : t('rs.downloadAll')}
                    </Button>
                  )}
                </Stack>
                {zipError && <Alert severity="error">{zipError}</Alert>}
              </Stack>
            </CardContent>
          </Card>
        )}

        {warnings.length > 0 && (
          <Box
            role="status"
            sx={{
              borderRadius: 1,
              border: 1,
              borderColor: (t) => alpha(t.palette.warning.main, 0.4),
              bgcolor: (t) => alpha(t.palette.warning.main, 0.08),
              p: 3,
            }}
          >
            <Box component="ul" sx={{ m: 0, pl: 2.5, typography: 'body2' }}>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </Box>
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}

        {single && (
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                {t('rs.beforeAfter')}
              </Typography>
              <Stack spacing={2} sx={{ mt: 1 }}>
                <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
                  <Box>
                    <Typography variant="subtitle2">{t('rs.original')}</Typography>
                    {single.sourceFormat !== 'unknown' && BROWSER_DECODABLE.includes(single.sourceFormat) ? (
                      <Box
                        component="img"
                        src={single.thumbUrl}
                        alt={`Original ${single.file.name}`}
                        sx={{ display: 'block', maxHeight: 320, maxWidth: '100%', borderRadius: 1, objectFit: 'contain', mt: 1 }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        {t('rs.noPreview', { format: formatLabel(single.sourceFormat) })}
                      </Typography>
                    )}
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      {single.file.name} — {formatBytes(single.file.size)}
                      {single.width > 0 && ` — ${single.width} × ${single.height} px`}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2">{t('rs.result')}</Typography>
                    {single.result ? (
                      <>
                        <Box
                          component="img"
                          src={single.result.url}
                          alt={`Resized ${single.file.name}`}
                          sx={{ display: 'block', maxHeight: 320, maxWidth: '100%', borderRadius: 1, objectFit: 'contain', mt: 1 }}
                        />
                        <Typography variant="body2" sx={{ mt: 1 }} role="status">
                          <Box component="span" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                            {formatLabel(single.sourceFormat)} → {formatLabel(targetFormat)}
                          </Box>{' '}
                          · {formatBytes(single.file.size)} → {formatBytes(single.result.bytes)} (
                          {single.result.width} × {single.result.height} px) —{' '}
                          {(() => {
                            // The honest change: a re-encode can make
                            // the file BIGGER (a JPEG original at a
                            // lower quality, resized at quality 85) —
                            // saying "0% smaller" then would be a lie.
                            const pct =
                              single.file.size > 0
                                ? Math.round((1 - single.result!.bytes / single.file.size) * 100)
                                : 0
                            return pct > 0
                              ? t('rs.smaller', { n: pct })
                              : pct < 0
                                ? t('rs.larger', { n: -pct })
                                : t('rs.sameSize')
                          })()}
                        </Typography>
                        {single.result.qualityUsed !== null && (
                          <Typography variant="body2" color="text.secondary">
                            {t('rs.qualityUsed', { n: single.result.qualityUsed })}
                            {single.result.targetMet === true && t('rs.targetMet')}
                            {single.result.targetMet === false && t('rs.targetNotMet')}
                          </Typography>
                        )}
                        <Typography variant="body2" color="text.secondary">
                          {t(single.result.engine === 'wasm' ? 'rs.engineWasm' : 'rs.engineCanvas')}
                        </Typography>
                        {single.result.warnings.length > 0 && (
                          <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5, typography: 'body2' }}>
                            {single.result.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </Box>
                        )}
                      </>
                    ) : (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        {single.status === 'resizing' ? t('rs.resizing') : t('rs.pressResize')}
                      </Typography>
                    )}
                  </Box>
                </Box>
                {single.result && (
                  <Stack direction="row" flexWrap="wrap" spacing={1.5}>
                    <Button
                      type="button"
                      variant="contained"
                      id="resize-download"
                      startIcon={<DownloadIcon />}
                      onClick={() => downloadBlob(single.result!.blob, outputFileName(single.file.name, targetFormat))}
                    >
                      {t('common.download')} {outputFileName(single.file.name, targetFormat)}
                    </Button>
                    <Button
                      type="button"
                      variant="outlined"
                      onClick={() =>
                        setItems((prev) => prev.map((p) => (p.id === single.id ? { ...p, status: 'ready', result: null } : p)))
                      }
                    >
                      {t('rs.resizeAgain')}
                    </Button>
                  </Stack>
                )}
                {single.status === 'failed' && single.error && <Alert severity="error">{single.error}</Alert>}
                {single.status === 'skipped' && single.error && (
                  <Alert severity="warning">{single.error}</Alert>
                )}
              </Stack>
            </CardContent>
          </Card>
        )}

        {items.length > 1 && (
          <Card>
            <CardContent>
              <Stack spacing={1.5}>
                {items.map((item) => {
                  const status = statusTextProps(item.status, t)
                  return (
                    <Box
                      key={item.id}
                      sx={{
                        display: 'flex',
                        gap: 2,
                        alignItems: 'center',
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1,
                        p: 2,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Box
                        component="img"
                        src={item.thumbUrl}
                        alt=""
                        sx={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 1 }}
                      />
                      <Box sx={{ flex: 1, minWidth: 180 }}>
                        <Typography variant="body2" fontWeight={500} noWrap>
                          {item.file.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {item.width > 0
                            ? `${item.width} × ${item.height} px — ${formatBytes(item.file.size)}`
                            : formatBytes(item.file.size)}
                          {item.result &&
                            ` → ${item.result.width} × ${item.result.height} px — ${formatBytes(item.result.bytes)}`}
                        </Typography>
                        {item.error && (
                          <Typography variant="body2" color="error.main">
                            {item.error}
                          </Typography>
                        )}
                        {item.result?.targetMet === false && (
                          <Typography variant="body2" color="warning.main">
                            {t('rs.targetNotMetRow')}
                          </Typography>
                        )}
                      </Box>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', color: status.color }}>
                        {status.label}
                      </Typography>
                      {item.result && (
                        <Button
                          type="button"
                          size="small"
                          variant="outlined"
                          startIcon={<DownloadIcon />}
                          onClick={() => downloadBlob(item.result!.blob, outputFileName(item.file.name, targetFormat))}
                        >
                          {t('common.download')}
                        </Button>
                      )}
                    </Box>
                  )
                })}
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>
    </Box>
  )
}
