import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Select,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import DownloadIcon from '@mui/icons-material/Download'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import {
  BROWSER_DECODABLE,
  BROWSER_ENCODABLE,
  formatById,
  formatBytes,
  formatLabel,
  outputFileName,
} from '../lib/capabilities'
import { convertImage, probeImage, ProbeError, type ProbedImage } from '../lib/convert'
import type { DetectedFormat } from '../lib/detect'
import type { Settings } from '../lib/settings'
import { recordActivity } from '../lib/activity'
import { mergeFormatLists, useWasmSupport } from '../lib/wasm-engine'
import { DropZone } from './DropZone'
import { EditorShell } from './EditorShell'
import { ImageCompareSlider } from './ImageCompareSlider'
import { ToolPageHeader } from './ToolPage'
import { WorkflowSteps } from './WorkflowSteps'
import { useNavigation } from './layout/navigation'
import { useI18n } from '../lib/use-i18n'

type Status = 'idle' | 'probing' | 'ready' | 'converting' | 'done' | 'error'

interface ConvertWorkspaceProps {
  settings: Settings
  onSettingsChange: (settings: Settings) => void
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

export function ConvertWorkspace({ settings, onSettingsChange, initialFiles, onInitialFilesConsumed }: ConvertWorkspaceProps) {
  const { t, lang } = useI18n()
  const { navigate } = useNavigation()
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [probed, setProbed] = useState<ProbedImage | null>(null)
  // Format sniffed from the magic bytes when probing failed (e.g. a
  // TIFF with no WASM engine): shown as the detected format instead
  // of "Unknown". Dimensions stay unknown — never rendered as 0×0.
  const [detectedFormat, setDetectedFormat] = useState<DetectedFormat | null>(null)
  const [targetFormat, setTargetFormat] = useState(settings.defaultFormat)
  const [quality, setQuality] = useState(settings.defaultQuality)
  const [background, setBackground] = useState(settings.defaultBackground)
  const [pngCompression, setPngCompression] = useState(1)
  const [status, setStatus] = useState<Status>('idle')
  const [compareMode, setCompareMode] = useState<'split' | 'side'>('split')
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
      setDetectedFormat(null)
      setFile(next)
      setStatus('probing')
      const url = URL.createObjectURL(next)
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old)
        return url
      })
      try {
        const info = await probeImage(next, lang)
        setProbed(info)
        const notes: string[] = []
        if (info.format === 'unknown') {
          notes.push(t('cv.warnUnknown'))
        } else if (!decodableFormats.includes(info.format)) {
          notes.push(t('cv.warnCannotDecode', { format: formatLabel(info.format) }))
        } else if (!BROWSER_DECODABLE.includes(info.format)) {
          notes.push(t('cv.warnWasmDecoded', { format: formatLabel(info.format) }))
        }
        if (info.format === 'gif') {
          notes.push(t('cv.warnGif'))
        }
        if (info.format === 'avif') {
          notes.push(t('cv.warnAvif'))
        }
        setWarnings(notes)
        setStatus('ready')
      } catch (err) {
        setProbed(null)
        // The format was sniffed even though the file cannot be
        // decoded here — keep it visible instead of "Unknown".
        if (err instanceof ProbeError && err.format !== 'unknown') {
          setDetectedFormat(err.format)
        }
        setError(err instanceof Error ? err.message : t('cv.errRead'))
        setStatus('error')
      }
    },
    [decodableFormats, lang, t],
  )

  // Homepage / paste / chaining hand-off: consume each distinct
  // `initialFiles` reference once (StrictMode-safe and supports repeated paste).
  const lastInitialRef = useRef<File[] | null>(null)
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0 && lastInitialRef.current !== initialFiles) {
      lastInitialRef.current = initialFiles
      void handleFiles(initialFiles)
      onInitialFilesConsumed?.()
    }
  }, [initialFiles, handleFiles, onInitialFilesConsumed])

  const canConvert =
    file !== null && probed !== null && probed.format !== 'unknown' && decodableFormats.includes(probed.format)

  const handleConvert = useCallback(async () => {
    if (!file || !probed) return
    setStatus('converting')
    setError(null)
    setWarnings((prev) => {
      const next = [...prev]
      if (settings.metadataPolicy === 'preserve') {
        next.push(t('cv.warnMetadata'))
      }
      if (targetFormat === 'png' && pngCompression !== 1) {
        next.push(t('cv.warnPng', { n: pngCompression }))
      }
      return next
    })
    try {
      const converted = await convertImage(
        file,
        {
          targetFormat,
          quality,
          background,
          pngCompression,
        },
        lang,
      )
      const url = URL.createObjectURL(converted.blob)
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = url
      setResult({ blob: converted.blob, url, width: converted.width, height: converted.height, bytes: converted.bytes })
      recordActivity({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || probed.format,
        tool: 'convert',
        result: `Converted to ${formatLabel(targetFormat)} · ${converted.width}×${converted.height} · ${formatBytes(converted.bytes)}`,
        resultKey: 'act.convert',
        resultParams: {
          format: formatLabel(targetFormat),
          w: converted.width,
          h: converted.height,
          bytes: formatBytes(converted.bytes),
        },
      })
      if (converted.engine === 'wasm') {
        setWarnings((prev) => [...prev, t('cv.warnWasm')])
      }
      setStatus('done')
    } catch (err) {
      // "Conversion failed:" belongs here — a real conversion was
      // attempted. Probe failures set their own message in
      // handleFiles and must never wear this label.
      setError(
        err instanceof Error ? t('cv.errConvert', { msg: err.message }) : t('cv.errConvertPlain'),
      )
      setStatus('error')
    }
  }, [file, probed, targetFormat, quality, background, pngCompression, settings.metadataPolicy, lang, t])

  const clearFile = useCallback(() => {
    setFile(null)
    setProbed(null)
    setDetectedFormat(null)
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
  // WASM engine adds (BMP, TIFF, QOI, HEIC, JXL, JPEG 2000, ICO,
  // PNM, TGA, GIF) when its module is present. Without the module
  // the list is exactly the old canvas-only list. BMP is a WASM
  // target, not a canvas one: canvas.toBlob silently returns PNG
  // for BMP (see capabilities.ts).
  const targets = mergeFormatLists(BROWSER_ENCODABLE, wasmSupport?.encode)
    .map((id) => formatById(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined && c.can_encode)

  const canSplitCompare =
    status === 'done' &&
    result !== null &&
    previewUrl !== null &&
    probed !== null &&
    BROWSER_DECODABLE.includes(probed.format) &&
    BROWSER_DECODABLE.includes(targetFormat)

  const sizeDeltaPct =
    file && result && file.size > 0 ? Math.round((1 - result.bytes / file.size) * 100) : null

  const quickPresets = [
    { id: 'webp', label: t('preset.cvWebp'), format: 'webp', quality: 82 },
    { id: 'jpeg', label: t('preset.cvJpeg'), format: 'jpeg', quality: 85 },
    { id: 'png', label: t('preset.cvPng'), format: 'png', quality: 85 },
    ...(targets.some((x) => x.format_id === 'ico')
      ? [{ id: 'ico', label: t('preset.cvIco'), format: 'ico', quality: 85 }]
      : []),
  ]

  return (
    <Box component="section" aria-labelledby="convert-heading" sx={{ display: 'flex', flexDirection: 'column', flex: { lg: 1 }, minHeight: { lg: 0 } }}>
      <Stack spacing={2} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 } }}>
        <ToolPageHeader
          headingId="convert-heading"
          title={t('cv.title')}
          description={t(wasmSupport ? 'cv.descWasm' : 'cv.descNoWasm')}
          actions={
            <WorkflowSteps
              activeStep={!file ? 0 : status === 'done' ? 2 : 1}
              steps={[t('step.upload'), t('step.options'), t('step.download')]}
            />
          }
        />

        {!file && (
          <Box sx={{ flex: { lg: 1 }, display: 'flex', flexDirection: 'column', '& > *': { flex: { lg: 1 } } }}>
            <DropZone
              inputId="convert-file"
              label={t('cv.dropLabel')}
              hint={t('cv.dropHint')}
              multiple={false}
              accept="image/*"
              onFiles={handleFiles}
            />
          </Box>
        )}

        {file && (
          <EditorShell
            main={
              <>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                    <Typography variant="overline" color="text.secondary">
                      {canSplitCompare ? t('rs.beforeAfter') : t('cv.source')}
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {canSplitCompare && (
                        <ToggleButtonGroup
                          exclusive
                          size="small"
                          value={compareMode}
                          onChange={(_, val: 'split' | 'side' | null) => {
                            if (val) setCompareMode(val)
                          }}
                          aria-label={t('rs.beforeAfter')}
                        >
                          <ToggleButton value="split" sx={{ py: 0.25, px: 1, fontSize: '0.75rem' }}>
                            {t('cmp.split')}
                          </ToggleButton>
                          <ToggleButton value="side" sx={{ py: 0.25, px: 1, fontSize: '0.75rem' }}>
                            {t('cmp.sideBySide')}
                          </ToggleButton>
                        </ToggleButtonGroup>
                      )}
                      <Button type="button" variant="outlined" size="small" onClick={clearFile}>
                        {t('common.chooseDifferentFile')}
                      </Button>
                    </Stack>
                  </Box>
                  {canSplitCompare && result && previewUrl ? (
                    compareMode === 'split' ? (
                      <>
                        <ImageCompareSlider
                          beforeUrl={previewUrl}
                          afterUrl={result.url}
                          beforeLabel={`${t('rs.original')} · ${formatBytes(file.size)}`}
                          afterLabel={`${formatLabel(targetFormat)} · ${formatBytes(result.bytes)}`}
                          beforeAlt={`Preview of ${file.name}`}
                          afterAlt={`Converted ${file.name}`}
                          deltaLabel={
                            sizeDeltaPct !== null
                              ? sizeDeltaPct > 0
                                ? `−${sizeDeltaPct}%`
                                : sizeDeltaPct < 0
                                  ? `+${-sizeDeltaPct}%`
                                  : '0%'
                              : undefined
                          }
                          deltaPositive={sizeDeltaPct !== null && sizeDeltaPct > 0}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}>
                          {t('cmp.dragHint')}
                        </Typography>
                      </>
                    ) : (
                      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { sm: '1fr 1fr' } }}>
                        <Box>
                          <Typography variant="caption" fontWeight={600} display="block" sx={{ mb: 0.5 }}>
                            {t('rs.original')} · {formatBytes(file.size)}
                          </Typography>
                          <Box
                            component="img"
                            src={previewUrl}
                            alt={`Preview of ${file.name}`}
                            sx={{
                              display: 'block',
                              mx: 'auto',
                              maxHeight: { xs: 200, lg: 'clamp(140px, calc(100dvh - 430px), 260px)' },
                              maxWidth: '100%',
                              borderRadius: 1,
                              objectFit: 'contain',
                            }}
                          />
                        </Box>
                        <Box>
                          <Typography variant="caption" fontWeight={600} display="block" sx={{ mb: 0.5 }}>
                            {formatLabel(targetFormat)} · {formatBytes(result.bytes)}
                          </Typography>
                          <Box
                            component="img"
                            src={result.url}
                            alt={`Converted ${file.name}`}
                            sx={{
                              display: 'block',
                              mx: 'auto',
                              maxHeight: { xs: 200, lg: 'clamp(140px, calc(100dvh - 430px), 260px)' },
                              maxWidth: '100%',
                              borderRadius: 1,
                              objectFit: 'contain',
                            }}
                          />
                        </Box>
                      </Box>
                    )
                  ) : (
                    previewUrl &&
                    (probed === null ||
                    probed.format === 'unknown' ||
                    BROWSER_DECODABLE.includes(probed.format) ? (
                      <Box
                        component="img"
                        src={previewUrl}
                        alt={`Preview of ${file.name}`}
                        sx={{
                          display: 'block',
                          mx: 'auto',
                          maxHeight: { xs: 240, lg: 'clamp(140px, calc(100dvh - 430px), 280px)' },
                          maxWidth: '100%',
                          borderRadius: 1,
                          objectFit: 'contain',
                        }}
                      />
                    ) : (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        align="center"
                        sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 2, py: 3 }}
                      >
                        {t('cv.noPreview', { format: formatLabel(probed.format) })}
                      </Typography>
                    ))
                  )}
                  <Box
                    component="dl"
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: 'auto 1fr', sm: 'auto 1fr auto 1fr' },
                      columnGap: 2,
                      rowGap: 0.75,
                      mt: 1.5,
                      mx: 0,
                      mb: 0,
                    }}
                  >
                    <Box component="dt" sx={{ color: 'text.secondary', typography: 'caption' }}>
                      {t('cv.file')}
                    </Box>
                    <Box
                      component="dd"
                      sx={{
                        m: 0,
                        typography: 'caption',
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {file.name}
                    </Box>
                    <Box component="dt" sx={{ color: 'text.secondary', typography: 'caption' }}>
                      {t('cv.size')}
                    </Box>
                    <Box component="dd" sx={{ m: 0, typography: 'caption', fontWeight: 600 }}>
                      {formatBytes(file.size)}
                    </Box>
                    <Box component="dt" sx={{ color: 'text.secondary', typography: 'caption' }}>
                      {t('cv.detectedFormat')}
                    </Box>
                    <Box component="dd" sx={{ m: 0, typography: 'caption', fontWeight: 600 }}>
                      {probed
                        ? formatLabel(probed.format)
                        : detectedFormat
                          ? formatLabel(detectedFormat)
                          : status === 'probing'
                            ? t('cv.reading')
                            : t('cv.unknown')}
                    </Box>
                    <Box component="dt" sx={{ color: 'text.secondary', typography: 'caption' }}>
                      {t('cv.dimensions')}
                    </Box>
                    <Box component="dd" sx={{ m: 0, typography: 'caption', fontWeight: 600 }}>
                      {probed ? `${probed.width} × ${probed.height} px` : '—'}
                    </Box>
                  </Box>
                </CardContent>
              </Card>

              {status === 'probing' && (
                <Typography role="status" variant="body2" color="text.secondary">
                  {t('cv.readingImage')}
                </Typography>
              )}

              {status === 'error' && error && <Alert severity="error">{error}</Alert>}

              {status === 'done' && result && file && (
                <Box
                  role="status"
                  sx={{
                    borderRadius: 1,
                    border: 1,
                    borderColor: (t) => alpha(t.palette.success.main, 0.4),
                    bgcolor: (t) => alpha(t.palette.success.main, 0.08),
                    p: 2,
                  }}
                >
                  {probed && (
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', display: 'block' }}>
                      {formatLabel(probed.format)} → {formatLabel(targetFormat)}
                    </Typography>
                  )}
                  <Typography variant="body2" fontWeight={600} color="success.main" sx={{ mt: 0.25 }}>
                    {t('cv.converted', {
                      from: formatBytes(file.size),
                      to: formatBytes(result.bytes),
                      w: result.width,
                      h: result.height,
                    })}
                  </Typography>
                  {targetFormat === 'ico' && probed && (result.width < probed.width || result.height < probed.height) && (
                    <Typography variant="caption" sx={{ mt: 0.5, display: 'block' }}>
                      {t('cv.icoResized', { w: result.width, h: result.height })}
                    </Typography>
                  )}
                  <Stack direction="row" flexWrap="wrap" spacing={1} useFlexGap sx={{ mt: 1.25 }}>
                    <Button
                      type="button"
                      variant="contained"
                      size="small"
                      startIcon={<DownloadIcon />}
                      onClick={() => downloadBlob(result.blob, outputFileName(file.name, targetFormat))}
                    >
                      {t('common.download')} {outputFileName(file.name, targetFormat)}
                    </Button>
                    <Button
                      type="button"
                      variant="outlined"
                      size="small"
                      onClick={() => {
                        setResult(null)
                        setStatus('ready')
                      }}
                    >
                      {t('cv.convertAgain')}
                    </Button>
                  </Stack>
                  <Stack
                    direction="row"
                    flexWrap="wrap"
                    spacing={0.5}
                    useFlexGap
                    alignItems="center"
                    sx={{ mt: 1.25, pt: 1.25, borderTop: 1, borderColor: 'divider' }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                      {t('chain.label')}
                    </Typography>
                    {(
                      [
                        { route: 'crop', label: t('chain.toCrop') },
                        { route: 'resize', label: t('chain.toResize') },
                        { route: 'ocr', label: t('chain.toOcr') },
                        { route: 'pdf-images-to-pdf', label: t('chain.toPdf') },
                      ] as const
                    ).map((next) => (
                      <Button
                        key={next.route}
                        type="button"
                        size="small"
                        variant="text"
                        endIcon={<ArrowForwardIcon sx={{ fontSize: 14 }} />}
                        onClick={() => {
                          const outName = outputFileName(file.name, targetFormat)
                          const outFile = new File([result.blob], outName, { type: result.blob.type || `image/${targetFormat}` })
                          navigate(next.route, { files: [outFile] })
                        }}
                        sx={{ py: 0.25 }}
                      >
                        {next.label}
                      </Button>
                    ))}
                  </Stack>
                </Box>
              )}

              {warnings.length > 0 && (
                <Box
                  role="status"
                  sx={{
                    borderRadius: 1,
                    border: 1,
                    borderColor: (t) => alpha(t.palette.warning.main, 0.4),
                    bgcolor: (t) => alpha(t.palette.warning.main, 0.08),
                    p: 1.5,
                  }}
                >
                  <Box component="ul" sx={{ m: 0, pl: 2.5, typography: 'caption' }}>
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </Box>
                </Box>
              )}
              </>
            }
            tools={
              <>
            <Card>
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  {t('cv.output')}
                </Typography>
                <Stack spacing={2} sx={{ mt: 1 }}>
                  <Box>
                    <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" sx={{ mb: 0.75 }}>
                      {t('preset.quickTitle')}
                    </Typography>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      {quickPresets.map((p) => (
                        <Chip
                          key={p.id}
                          size="small"
                          clickable
                          label={p.label}
                          color={targetFormat === p.format ? 'primary' : 'default'}
                          variant={targetFormat === p.format ? 'filled' : 'outlined'}
                          onClick={() => {
                            setTargetFormat(p.format)
                            setQuality(p.quality)
                          }}
                        />
                      ))}
                    </Stack>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" component="label" htmlFor="target-format">
                      {t('cv.outputFormat')}
                    </Typography>
                    <Select
                      native
                      fullWidth
                      id="target-format"
                      value={targetFormat}
                      onChange={(e) => setTargetFormat(e.target.value)}
                      sx={{ mt: 0.5 }}
                    >
                      {targets.map((t) => (
                        <option key={t.format_id} value={t.format_id}>
                          {formatLabel(t.format_id)}
                        </option>
                      ))}
                    </Select>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      {t(wasmSupport ? 'cv.targetsWasm' : 'cv.targetsCanvas')}
                    </Typography>
                  </Box>

                  {(targetFormat === 'jpeg' || targetFormat === 'webp') && (
                    <Box>
                      <Typography variant="subtitle2" component="label">
                        {t('cv.quality', { n: quality })}
                      </Typography>
                      <Slider
                        aria-label={t('cv.qualityAria')}
                        min={1}
                        max={100}
                        value={quality}
                        onChange={(_, value) => setQuality(value as number)}
                      />
                    </Box>
                  )}

                  {(targetFormat === 'jpeg' || targetFormat === 'bmp') && (
                    <Box>
                      <Typography variant="subtitle2" component="label">
                        {t('cv.background')}
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
                  )}

                  <Accordion
                    disableGutters
                    elevation={0}
                    sx={{
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: '8px !important',
                      '&:before': { display: 'none' },
                      bgcolor: 'transparent',
                    }}
                  >
                    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 44, px: 1.5 }}>
                      <Typography variant="subtitle2" color="text.secondary">
                        {t('cv.advancedOptions')}
                      </Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 1.5, pt: 0, pb: 2 }}>
                      <Stack spacing={2}>
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
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                              {t('cv.pngCompressionNote')}
                            </Typography>
                          </Box>
                        )}
                        <Box>
                          <Typography variant="subtitle2">{t('cv.metadata')}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                            {t('cv.metadataNote')}
                          </Typography>
                          <FormControl sx={{ mt: 1 }}>
                            <RadioGroup
                              row
                              name="metadata-policy"
                              value={settings.metadataPolicy}
                              onChange={(_, value) =>
                                onSettingsChange({ ...settings, metadataPolicy: value as Settings['metadataPolicy'] })
                              }
                            >
                              <FormControlLabel value="strip" control={<Radio />} label={t('cv.strip')} />
                              <FormControlLabel value="preserve" control={<Radio />} label={t('cv.preserve')} />
                            </RadioGroup>
                          </FormControl>
                        </Box>
                      </Stack>
                    </AccordionDetails>
                  </Accordion>

                  <Button
                    type="button"
                    variant="contained"
                    size="large"
                    fullWidth
                    onClick={handleConvert}
                    disabled={!canConvert || status === 'converting'}
                  >
                    {status === 'converting' ? t('cv.converting') : t('cv.convertTo', { format: formatLabel(targetFormat) })}
                  </Button>
                  {!canConvert && probed && (
                    <Typography variant="body2" color="warning.main">
                      {t('cv.cannotConvert')}
                    </Typography>
                  )}
                </Stack>
              </CardContent>
            </Card>
              </>
            }
          />
        )}
      </Stack>
    </Box>
  )
}
