/**
 * Dual-mode Background Removal workspace — 100% local in the browser ($0 cost):
 *  - Mode 1: AI Auto (free open-source ONNX model via `@imgly/background-removal`,
 *    lazy-loaded on click, cached for offline use).
 *  - Mode 2: Instant Magic Color Remove (0 MB download, pure Canvas flood-fill
 *    or global chroma key with click-to-pick backdrop colour, tolerance & feathering).
 *  - Shared live background replacement (Transparent, White, Passport Blue, Sky, Red, Custom),
 *    interactive Before/After slider, Copy/Share, IndexedDB cache, and Next-Step chaining.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControlLabel,
  LinearProgress,
  Select,
  Slider,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import ColorizeIcon from '@mui/icons-material/Colorize'
import DownloadIcon from '@mui/icons-material/Download'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { formatBytes, formatLabel, outputFileName } from '../lib/capabilities'
import { recordActivity } from '../lib/activity'
import {
  compositeCutout,
  detectBackdropColor,
  hexToRgbTuple,
  removeBackgroundByColor,
  removeBackgroundWithAi,
  rgbToHex,
  type BgProgress,
  type RgbTuple,
} from '../lib/bg-remove'
import { DropZone } from './DropZone'
import { EditorShell } from './EditorShell'
import { ImageCompareSlider } from './ImageCompareSlider'
import { ImageOutputActions } from './ImageOutputActions'
import { ToolPageHeader } from './ToolPage'
import { WorkflowSteps } from './WorkflowSteps'
import { useNavigation } from './layout/navigation'
import { useI18n } from '../lib/use-i18n'

type RemoveMode = 'ai' | 'color'
type ExportFmt = 'png' | 'webp' | 'jpeg'

interface BgRemovalWorkspaceProps {
  initialFiles?: File[]
  onInitialFilesConsumed?: () => void
}

const CHECKERBOARD_BG =
  'repeating-conic-gradient(#d8dee9 0% 25%, #f8fafc 0% 50%) 50% / 14px 14px'

const BG_SWATCHES: { id: string; color: string | null; labelKey: string }[] = [
  { id: 'transparent', color: null, labelKey: 'bg.fillTransparent' },
  { id: 'white', color: '#ffffff', labelKey: 'bg.fillWhite' },
  { id: 'passport', color: '#1d4ed8', labelKey: 'bg.fillPassportBlue' },
  { id: 'sky', color: '#dbeafe', labelKey: 'bg.fillSky' },
  { id: 'red', color: '#dc2626', labelKey: 'bg.fillRed' },
]

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

export function BackgroundRemovalWorkspace({
  initialFiles,
  onInitialFilesConsumed,
}: BgRemovalWorkspaceProps = {}) {
  const { t } = useI18n()
  const { navigate } = useNavigation()

  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [mode, setMode] = useState<RemoveMode>('ai')

  // Instant Magic Color options
  const [targetHex, setTargetHex] = useState('#ffffff')
  const [tolerance, setTolerance] = useState(24)
  const [feather, setFeather] = useState(8)
  const [contiguous, setContiguous] = useState(true)
  const [seed, setSeed] = useState<[number, number] | null>(null)

  // Output / backdrop fill options
  const [bgFill, setBgFill] = useState<string | null>(null)
  const [targetFormat, setTargetFormat] = useState<ExportFmt>('png')
  const [quality, setQuality] = useState(90)
  const [compareMode, setCompareMode] = useState<'split' | 'side'>('split')

  // Cutout (raw transparent PNG from AI or Color engine) + composited final output
  const [cutoutBlob, setCutoutBlob] = useState<Blob | null>(null)
  const [output, setOutput] = useState<{
    blob: Blob
    url: string
    width: number
    height: number
    bytes: number
    filename: string
  } | null>(null)

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<BgProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sourceImgRef = useRef<HTMLImageElement>(null)
  const outputUrlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    }
  }, [sourceUrl])

  useEffect(() => {
    return () => {
      if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current)
    }
  }, [])

  const applyComposite = useCallback(
    async (
      rawCutout: Blob,
      srcFile: File,
      fill: string | null,
      fmt: ExportFmt,
      q: number,
      shouldRecord: boolean,
    ) => {
      const comp = await compositeCutout(rawCutout, fill, fmt, q)
      const filename = outputFileName(srcFile.name.replace(/(\.[^.]+)?$/, '-nobg$1'), fmt)
      const url = URL.createObjectURL(comp.blob)
      if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current)
      outputUrlRef.current = url
      setOutput({ ...comp, url, filename })
      if (shouldRecord) {
        recordActivity({
          fileName: srcFile.name,
          fileSize: srcFile.size,
          fileType: srcFile.type || 'image/png',
          tool: 'bg-remove',
          result: `Background removed · ${comp.width}×${comp.height} · ${formatBytes(comp.bytes)}`,
          resultKey: 'act.bgRemove',
          resultParams: { w: comp.width, h: comp.height, bytes: formatBytes(comp.bytes) },
          outputBlob: comp.blob,
          outputName: filename,
        })
      }
    },
    [],
  )

  const handleFiles = useCallback(
    async (files: File[]) => {
      const next = files[0]
      if (!next) return
      if (!next.type.startsWith('image/')) {
        setError(t('ocr.notImage'))
        return
      }
      setFile(next)
      setCutoutBlob(null)
      setOutput(null)
      setError(null)
      setProgress(null)
      setSeed(null)
      setSourceUrl((old) => {
        if (old) URL.revokeObjectURL(old)
        return URL.createObjectURL(next)
      })
      try {
        const corner = await detectBackdropColor(next)
        setTargetHex(rgbToHex(corner))
      } catch {
        // default #ffffff stays
      }
    },
    [t],
  )

  const lastInitialRef = useRef<File[] | null>(null)
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0 && lastInitialRef.current !== initialFiles) {
      lastInitialRef.current = initialFiles
      void handleFiles(initialFiles)
      onInitialFilesConsumed?.()
    }
  }, [initialFiles, handleFiles, onInitialFilesConsumed])

  const clearFile = () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    if (outputUrlRef.current) {
      URL.revokeObjectURL(outputUrlRef.current)
      outputUrlRef.current = null
    }
    setFile(null)
    setSourceUrl(null)
    setCutoutBlob(null)
    setOutput(null)
    setError(null)
    setProgress(null)
    setSeed(null)
  }

  const handlePickFromPreview = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!file || mode !== 'color') return
    const img = sourceImgRef.current
    if (!img) return
    const rect = img.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    const bitmap = await createImageBitmap(file)
    try {
      const px = Math.min(bitmap.width - 1, Math.floor(relX * bitmap.width))
      const py = Math.min(bitmap.height - 1, Math.floor(relY * bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(bitmap, -px, -py)
      const d = ctx.getImageData(0, 0, 1, 1).data
      const picked: RgbTuple = [d[0], d[1], d[2]]
      setTargetHex(rgbToHex(picked))
      setSeed([px, py])
    } finally {
      bitmap.close()
    }
  }

  const handleRun = async () => {
    if (!file || busy) return
    setBusy(true)
    setError(null)
    setProgress(null)
    try {
      let rawCutout: Blob
      if (mode === 'ai') {
        const aiRes = await removeBackgroundWithAi(file, (p) => setProgress(p))
        rawCutout = aiRes.blob
      } else {
        const rgb = hexToRgbTuple(targetHex) ?? [255, 255, 255]
        const colorRes = await removeBackgroundByColor(file, {
          targetColor: rgb,
          tolerance,
          feather,
          contiguous,
          seed,
        })
        rawCutout = colorRes.blob
      }
      setCutoutBlob(rawCutout)
      await applyComposite(rawCutout, file, bgFill, targetFormat, quality, true)
    } catch (err) {
      setError(
        err instanceof Error
          ? t('bg.errFailed', { msg: err.message })
          : t('bg.errFailedPlain'),
      )
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const handleBackdropChange = (nextFill: string | null) => {
    setBgFill(nextFill)
    if (cutoutBlob && file) {
      void applyComposite(cutoutBlob, file, nextFill, targetFormat, quality, false)
    }
  }

  const handleFormatChange = (nextFmt: ExportFmt) => {
    setTargetFormat(nextFmt)
    if (cutoutBlob && file) {
      void applyComposite(cutoutBlob, file, bgFill, nextFmt, quality, false)
    }
  }

  const handleQualityCommit = (nextQ: number) => {
    if (cutoutBlob && file && targetFormat !== 'png') {
      void applyComposite(cutoutBlob, file, bgFill, targetFormat, nextQ, false)
    }
  }

  return (
    <Box
      component="section"
      aria-labelledby="bg-remove-heading"
      sx={{ display: 'flex', flexDirection: 'column', flex: { lg: 1 }, minHeight: { lg: 0 } }}
    >
      <Stack spacing={2} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 } }}>
        <ToolPageHeader
          headingId="bg-remove-heading"
          title={t('bg.title')}
          description={t('bg.desc')}
          actions={
            <WorkflowSteps
              activeStep={!file ? 0 : output ? 2 : 1}
              steps={[t('step.upload'), t('bg.stepRemove'), t('step.download')]}
            />
          }
        />

        {!file && (
          <Box sx={{ flex: { lg: 1 }, display: 'flex', flexDirection: 'column', '& > *': { flex: { lg: 1 } } }}>
            <DropZone
              inputId="bg-remove-file"
              label={t('cv.dropLabel')}
              hint={t('bg.dropHint')}
              multiple={false}
              accept="image/*"
              onFiles={(files) => void handleFiles(files)}
            />
          </Box>
        )}

        {file && sourceUrl && (
          <EditorShell
            main={
              <>
                <Card>
                  <CardContent>
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 1,
                        flexWrap: 'wrap',
                        mb: 1,
                      }}
                    >
                      <Typography variant="overline" color="text.secondary">
                        {output ? t('rs.beforeAfter') : t('cv.source')}
                      </Typography>
                      <Stack direction="row" spacing={1} alignItems="center">
                        {output && (
                          <ToggleButtonGroup
                            exclusive
                            size="small"
                            value={compareMode}
                            onChange={(_, v: 'split' | 'side' | null) => {
                              if (v) setCompareMode(v)
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
                        <Button type="button" variant="outlined" size="small" onClick={clearFile} disabled={busy}>
                          {t('common.chooseDifferentFile')}
                        </Button>
                      </Stack>
                    </Box>

                    {output ? (
                      compareMode === 'split' ? (
                        <>
                          <ImageCompareSlider
                            beforeUrl={sourceUrl}
                            afterUrl={output.url}
                            beforeLabel={t('rs.original')}
                            afterLabel={t('rs.result')}
                            beforeAlt={`Original ${file.name}`}
                            afterAlt={`Background removed ${file.name}`}
                          />
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}>
                            {t('cmp.dragHint')}
                          </Typography>
                        </>
                      ) : (
                        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { sm: '1fr 1fr' } }}>
                          <Box>
                            <Typography variant="caption" fontWeight={600} display="block" sx={{ mb: 0.5 }}>
                              {t('rs.original')}
                            </Typography>
                            <Box
                              component="img"
                              src={sourceUrl}
                              alt={`Original ${file.name}`}
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
                              {t('rs.result')}
                            </Typography>
                            <Box
                              sx={{
                                borderRadius: 1,
                                background: CHECKERBOARD_BG,
                                display: 'flex',
                                justifyContent: 'center',
                              }}
                            >
                              <Box
                                component="img"
                                src={output.url}
                                alt={`Background removed ${file.name}`}
                                sx={{
                                  display: 'block',
                                  maxHeight: { xs: 200, lg: 'clamp(140px, calc(100dvh - 430px), 260px)' },
                                  maxWidth: '100%',
                                  borderRadius: 1,
                                  objectFit: 'contain',
                                }}
                              />
                            </Box>
                          </Box>
                        </Box>
                      )
                    ) : (
                      <Box sx={{ textAlign: 'center' }}>
                        <Box
                          component="img"
                          ref={sourceImgRef}
                          src={sourceUrl}
                          alt={file.name}
                          id="bg-source-preview"
                          onClick={(e) => void handlePickFromPreview(e)}
                          sx={{
                            display: 'block',
                            mx: 'auto',
                            maxHeight: { xs: 240, lg: 'clamp(160px, calc(100dvh - 400px), 320px)' },
                            maxWidth: '100%',
                            borderRadius: 1,
                            border: 1,
                            borderColor: 'divider',
                            objectFit: 'contain',
                            cursor: mode === 'color' ? 'crosshair' : 'default',
                          }}
                        />
                        {mode === 'color' && (
                          <Typography variant="caption" color="primary.main" sx={{ display: 'block', mt: 0.75 }}>
                            {t('bg.pickColorHint')}
                          </Typography>
                        )}
                      </Box>
                    )}

                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      {file.name} — {formatBytes(file.size)}
                    </Typography>
                  </CardContent>
                </Card>

                {busy && progress && (
                  <Box
                    role="status"
                    sx={{
                      borderRadius: 1,
                      border: 1,
                      borderColor: 'divider',
                      bgcolor: 'background.paper',
                      p: 2,
                    }}
                  >
                    <Typography variant="body2" id="bg-progress">
                      {progress.label} {Math.round(progress.progress * 100)}%
                    </Typography>
                    <LinearProgress
                      variant={progress.progress > 0 ? 'determinate' : 'indeterminate'}
                      value={Math.round(progress.progress * 100)}
                      sx={{ mt: 1 }}
                    />
                  </Box>
                )}

                {error && <Alert severity="error">{error}</Alert>}

                {output && (
                  <Box
                    role="status"
                    sx={{
                      borderRadius: 1,
                      border: 1,
                      borderColor: (th) => alpha(th.palette.success.main, 0.4),
                      bgcolor: (th) => alpha(th.palette.success.main, 0.08),
                      p: 2,
                    }}
                  >
                    <Typography variant="body2" fontWeight={600} color="success.main">
                      {t('bg.done', { w: output.width, h: output.height, bytes: formatBytes(output.bytes) })}
                    </Typography>
                    <Stack direction="row" flexWrap="wrap" spacing={1} useFlexGap sx={{ mt: 1.25 }}>
                      <Button
                        type="button"
                        variant="contained"
                        size="small"
                        id="bg-download-btn"
                        startIcon={<DownloadIcon />}
                        onClick={() => downloadBlob(output.blob, output.filename)}
                      >
                        {t('common.download')} {output.filename}
                      </Button>
                      <ImageOutputActions blob={output.blob} filename={output.filename} />
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
                          { route: 'convert', label: t('chain.toConvert') },
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
                            const outFile = new File([output.blob], output.filename, {
                              type: output.blob.type || `image/${targetFormat}`,
                            })
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
              </>
            }
            tools={
              <Card>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    {t('common.settings')}
                  </Typography>
                  <Stack spacing={1.75} sx={{ mt: 1 }}>
                    <Box>
                      <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" sx={{ mb: 0.75 }}>
                        {t('bg.modeLabel')}
                      </Typography>
                      <ToggleButtonGroup
                        exclusive
                        fullWidth
                        size="small"
                        value={mode}
                        onChange={(_, val: RemoveMode | null) => {
                          if (val) setMode(val)
                        }}
                        aria-label={t('bg.modeLabel')}
                      >
                        <ToggleButton value="ai" id="bg-mode-ai">
                          <AutoFixHighIcon sx={{ fontSize: 16, mr: 0.5 }} />
                          {t('bg.modeAi')}
                        </ToggleButton>
                        <ToggleButton value="color" id="bg-mode-color">
                          <ColorizeIcon sx={{ fontSize: 16, mr: 0.5 }} />
                          {t('bg.modeColor')}
                        </ToggleButton>
                      </ToggleButtonGroup>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
                        {mode === 'ai' ? t('bg.modeAiNote') : t('bg.modeColorNote')}
                      </Typography>
                    </Box>

                    {mode === 'color' && (
                      <Stack spacing={1.25} sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
                        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Box
                              component="input"
                              type="color"
                              id="bg-target-color"
                              aria-label={t('bg.targetColor')}
                              value={targetHex}
                              onChange={(e) => {
                                setTargetHex(e.target.value)
                                setSeed(null)
                              }}
                              sx={{
                                width: 34,
                                height: 34,
                                p: 0.25,
                                borderRadius: 1,
                                border: 1,
                                borderColor: 'divider',
                                cursor: 'pointer',
                                bgcolor: 'transparent',
                              }}
                            />
                            <Box>
                              <Typography variant="caption" fontWeight={600} display="block">
                                {t('bg.targetColor')}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                {targetHex.toUpperCase()}
                              </Typography>
                            </Box>
                          </Stack>
                          <Button
                            type="button"
                            size="small"
                            variant="outlined"
                            onClick={() => {
                              if (!file) return
                              setSeed(null)
                              void detectBackdropColor(file).then((c) => setTargetHex(rgbToHex(c)))
                            }}
                          >
                            {t('bg.autoDetect')}
                          </Button>
                        </Stack>

                        <Box>
                          <Typography variant="caption" fontWeight={600} display="block">
                            {t('bg.tolerance', { n: tolerance })}
                          </Typography>
                          <Slider
                            size="small"
                            id="bg-tolerance"
                            min={4}
                            max={85}
                            value={tolerance}
                            onChange={(_, v) => setTolerance(v as number)}
                          />
                        </Box>

                        <Box>
                          <Typography variant="caption" fontWeight={600} display="block">
                            {t('bg.feather', { n: feather })}
                          </Typography>
                          <Slider
                            size="small"
                            id="bg-feather"
                            min={0}
                            max={25}
                            value={feather}
                            onChange={(_, v) => setFeather(v as number)}
                          />
                        </Box>

                        <FormControlLabel
                          control={
                            <Switch
                              size="small"
                              id="bg-contiguous"
                              checked={contiguous}
                              onChange={(e) => setContiguous(e.target.checked)}
                            />
                          }
                          label={<Typography variant="caption">{t('bg.contiguous')}</Typography>}
                        />
                      </Stack>
                    )}

                    <Box sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
                      <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" sx={{ mb: 0.75 }}>
                        {t('bg.backdropFill')}
                      </Typography>
                      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                        {BG_SWATCHES.map((s) => {
                          const selected = bgFill === s.color
                          return (
                            <Tooltip key={s.id} title={t(s.labelKey)}>
                              <Chip
                                size="small"
                                clickable
                                label={t(s.labelKey)}
                                color={selected ? 'primary' : 'default'}
                                variant={selected ? 'filled' : 'outlined'}
                                onClick={() => handleBackdropChange(s.color)}
                                avatar={
                                  <Box
                                    sx={{
                                      width: 14,
                                      height: 14,
                                      borderRadius: '50%',
                                      border: '1px solid rgba(0,0,0,0.2)',
                                      background: s.color ?? CHECKERBOARD_BG,
                                      ml: '6px !important',
                                    }}
                                  />
                                }
                              />
                            </Tooltip>
                          )
                        })}
                        <Tooltip title={t('bg.fillCustom')}>
                          <Box
                            component="input"
                            type="color"
                            aria-label={t('bg.fillCustom')}
                            value={bgFill ?? '#ffffff'}
                            onChange={(e) => handleBackdropChange(e.target.value)}
                            sx={{
                              width: 28,
                              height: 28,
                              p: 0.25,
                              borderRadius: 1,
                              border: 1,
                              borderColor: 'divider',
                              cursor: 'pointer',
                              bgcolor: 'transparent',
                            }}
                          />
                        </Tooltip>
                      </Stack>
                    </Box>

                    <Box sx={{ display: 'grid', gridTemplateColumns: targetFormat !== 'png' ? '1fr 1fr' : '1fr', gap: 1, alignItems: 'center' }}>
                      <Box>
                        <Typography variant="caption" fontWeight={600} component="label" htmlFor="bg-output-format">
                          {t('cv.outputFormat')}
                        </Typography>
                        <Select
                          native
                          fullWidth
                          size="small"
                          id="bg-output-format"
                          value={targetFormat}
                          onChange={(e) => handleFormatChange(e.target.value as ExportFmt)}
                          sx={{ mt: 0.5 }}
                        >
                          <option value="png">{formatLabel('png')}</option>
                          <option value="webp">{formatLabel('webp')}</option>
                          <option value="jpeg">{formatLabel('jpeg')}</option>
                        </Select>
                      </Box>
                      {targetFormat !== 'png' && (
                        <Box>
                          <Typography variant="caption" fontWeight={600} display="block">
                            {t('cv.quality', { n: quality })}
                          </Typography>
                          <Slider
                            size="small"
                            min={10}
                            max={100}
                            value={quality}
                            onChange={(_, v) => setQuality(v as number)}
                            onChangeCommitted={(_, v) => handleQualityCommit(v as number)}
                          />
                        </Box>
                      )}
                    </Box>

                    <Button
                      type="button"
                      variant="contained"
                      size="large"
                      fullWidth
                      id="bg-run-button"
                      startIcon={mode === 'ai' ? <AutoFixHighIcon /> : <ColorizeIcon />}
                      disabled={busy}
                      onClick={() => void handleRun()}
                    >
                      {busy
                        ? t('bg.running')
                        : mode === 'ai'
                          ? t('bg.runAi')
                          : t('bg.runColor')}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            }
          />
        )}

        {!file && error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Box>
  )
}
