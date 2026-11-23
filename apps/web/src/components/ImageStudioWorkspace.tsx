/**
 * Image Watermark, Quick Filters & Privacy EXIF Inspector workspace
 * — 100% local in the browser, zero-scroll desktop layout.
 *
 * Lets users:
 *  - Add text watermarks (corners, center, or diagonal tiled pattern)
 *  - Adjust Brightness, Contrast, Saturation, Grayscale, and Blur live
 *  - Inspect real JPEG EXIF/Camera/GPS metadata & export a clean stripped copy
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined'
import TuneIcon from '@mui/icons-material/Tune'
import BrandingWatermarkOutlinedIcon from '@mui/icons-material/BrandingWatermarkOutlined'
import { formatBytes, formatLabel, outputFileName } from '../lib/capabilities'
import { recordActivity } from '../lib/activity'
import {
  DEFAULT_FILTERS,
  DEFAULT_WATERMARK,
  drawStudioCanvas,
  exportStudioImage,
  parseJpegExif,
  type ExifSummary,
  type ImageFilterState,
  type ImageWatermarkState,
  type WatermarkPlacement,
} from '../lib/image-studio'
import { DropZone } from './DropZone'
import { EditorShell } from './EditorShell'
import { ImageOutputActions } from './ImageOutputActions'
import { ToolPageHeader } from './ToolPage'
import { WorkflowSteps } from './WorkflowSteps'
import { useI18n } from '../lib/use-i18n'

interface ImageStudioProps {
  initialFiles?: File[]
  onInitialFilesConsumed?: () => void
}

type StudioTab = 'watermark' | 'filters' | 'exif'
type ExportFmt = 'png' | 'webp' | 'jpeg'

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

export function ImageStudioWorkspace({
  initialFiles,
  onInitialFilesConsumed,
}: ImageStudioProps = {}) {
  const { t } = useI18n()

  const [file, setFile] = useState<File | null>(null)
  const [loadedImg, setLoadedImg] = useState<HTMLImageElement | null>(null)
  const [exif, setExif] = useState<ExifSummary | null>(null)
  const [activeTab, setActiveTab] = useState<StudioTab>('watermark')
  const [filters, setFilters] = useState<ImageFilterState>(DEFAULT_FILTERS)
  const [watermark, setWatermark] = useState<ImageWatermarkState>(DEFAULT_WATERMARK)
  const [targetFormat, setTargetFormat] = useState<ExportFmt>('jpeg')
  const [quality, setQuality] = useState(90)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    blob: Blob
    width: number
    height: number
    bytes: number
    filename: string
  } | null>(null)

  const previewRef = useRef<HTMLCanvasElement>(null)

  const handleFiles = useCallback(
    async (files: File[]) => {
      const next = files[0]
      if (!next) return
      if (!next.type.startsWith('image/')) {
        setError(t('ocr.notImage'))
        return
      }
      setError(null)
      setResult(null)
      const bytes = new Uint8Array(await next.arrayBuffer())
      setExif(parseJpegExif(bytes))

      const url = URL.createObjectURL(next)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        setFile(next)
        setLoadedImg(img)
        setFilters(DEFAULT_FILTERS)
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        setError(t('crop.errLoad'))
      }
      img.src = url
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

  useEffect(() => {
    if (!loadedImg || !previewRef.current) return
    drawStudioCanvas(previewRef.current, loadedImg, filters, watermark)
  }, [loadedImg, filters, watermark])

  const clearFile = () => {
    setFile(null)
    setLoadedImg(null)
    setExif(null)
    setResult(null)
    setError(null)
    setFilters(DEFAULT_FILTERS)
    setWatermark(DEFAULT_WATERMARK)
  }

  const handleExport = async () => {
    if (!loadedImg || !file || busy) return
    setBusy(true)
    setError(null)
    try {
      const exported = await exportStudioImage(loadedImg, filters, watermark, targetFormat, quality)
      const suffix = watermark.text.trim() ? '-watermarked' : '-clean'
      const filename = outputFileName(file.name.replace(/(\.[^.]+)?$/, `${suffix}$1`), targetFormat)
      setResult({ ...exported, filename })
      recordActivity({
        fileName: file.name,
        fileSize: file.size,
        fileType: `image/${targetFormat}`,
        tool: 'watermark',
        result: `${exported.width}×${exported.height} · ${formatBytes(exported.bytes)}`,
        resultKey: 'act.studio',
        resultParams: { w: exported.width, h: exported.height, bytes: formatBytes(exported.bytes) },
        outputBlob: exported.blob,
        outputName: filename,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('crop.errExport'))
    } finally {
      setBusy(false)
    }
  }

  const exifRows = exif
    ? [
        exif.make && { label: t('ex.make'), value: exif.make },
        exif.model && { label: t('ex.model'), value: exif.model },
        exif.dateTime && { label: t('ex.date'), value: exif.dateTime },
        exif.software && { label: t('ex.software'), value: exif.software },
        exif.orientation !== null && { label: t('ex.orientation'), value: String(exif.orientation) },
      ].filter((r): r is { label: string; value: string } => Boolean(r))
    : []

  return (
    <Box
      component="section"
      aria-labelledby="studio-heading"
      sx={{ display: 'flex', flexDirection: 'column', flex: { lg: 1 }, minHeight: { lg: 0 } }}
    >
      <Stack spacing={2} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 } }}>
        <ToolPageHeader
          headingId="studio-heading"
          title={t('st.title')}
          description={t('st.desc')}
          actions={
            <WorkflowSteps
              activeStep={!file ? 0 : result ? 2 : 1}
              steps={[t('step.upload'), t('st.stepEdit'), t('step.download')]}
            />
          }
        />

        {!file && (
          <Box sx={{ flex: { lg: 1 }, display: 'flex', flexDirection: 'column', '& > *': { flex: { lg: 1 } } }}>
            <DropZone
              inputId="studio-file"
              label={t('cv.dropLabel')}
              hint={t('st.dropHint')}
              multiple={false}
              accept="image/*"
              onFiles={(files) => void handleFiles(files)}
            />
          </Box>
        )}

        {file && loadedImg && (
          <EditorShell
            main={
              <>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="overline" color="text.secondary">
                          {t('st.livePreview')}
                        </Typography>
                        {exif?.hasExif && (
                          <Chip
                            size="small"
                            color={exif.hasGps ? 'warning' : 'info'}
                            variant="outlined"
                            icon={<ShieldOutlinedIcon sx={{ fontSize: 15 }} />}
                            label={exif.hasGps ? t('ex.gpsDetected') : t('ex.exifDetected')}
                          />
                        )}
                      </Stack>
                      <Button type="button" variant="outlined" size="small" onClick={clearFile}>
                        {t('common.chooseDifferentFile')}
                      </Button>
                    </Box>

                    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                      <Box
                        component="canvas"
                        ref={previewRef}
                        id="studio-preview-canvas"
                        sx={{
                          display: 'block',
                          maxHeight: { xs: 240, lg: 'clamp(160px, calc(100dvh - 420px), 310px)' },
                          maxWidth: '100%',
                          width: 'auto',
                          height: 'auto',
                          borderRadius: 1,
                          border: 1,
                          borderColor: 'divider',
                        }}
                      />
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      {file.name} — {formatBytes(file.size)} · {loadedImg.naturalWidth} × {loadedImg.naturalHeight} px
                    </Typography>
                  </CardContent>
                </Card>

                {error && <Alert severity="error">{error}</Alert>}

                {result && (
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
                      {t('st.exported', { w: result.width, h: result.height, bytes: formatBytes(result.bytes) })}
                    </Typography>
                    <Stack direction="row" flexWrap="wrap" spacing={1} useFlexGap sx={{ mt: 1.25 }}>
                      <Button
                        type="button"
                        variant="contained"
                        size="small"
                        id="studio-download"
                        startIcon={<DownloadIcon />}
                        onClick={() => downloadBlob(result.blob, result.filename)}
                      >
                        {t('common.download')} {result.filename}
                      </Button>
                      <ImageOutputActions blob={result.blob} filename={result.filename} />
                    </Stack>
                  </Box>
                )}
              </>
            }
            tools={
              <Card>
                <CardContent>
                  <Stack spacing={1.75}>
                    <ToggleButtonGroup
                      exclusive
                      fullWidth
                      size="small"
                      value={activeTab}
                      onChange={(_, v: StudioTab | null) => {
                        if (v) setActiveTab(v)
                      }}
                      aria-label={t('st.title')}
                    >
                      <ToggleButton value="watermark" id="studio-tab-wm">
                        <BrandingWatermarkOutlinedIcon sx={{ fontSize: 15, mr: 0.5 }} />
                        {t('st.tabWatermark')}
                      </ToggleButton>
                      <ToggleButton value="filters" id="studio-tab-filters">
                        <TuneIcon sx={{ fontSize: 15, mr: 0.5 }} />
                        {t('st.tabFilters')}
                      </ToggleButton>
                      <ToggleButton value="exif" id="studio-tab-exif">
                        <ShieldOutlinedIcon sx={{ fontSize: 15, mr: 0.5 }} />
                        {t('st.tabExif')}
                      </ToggleButton>
                    </ToggleButtonGroup>

                    {activeTab === 'watermark' && (
                      <Stack spacing={1.25}>
                        <TextField
                          id="studio-wm-text"
                          size="small"
                          fullWidth
                          label={t('sig.wmText')}
                          placeholder="© OpenPixel Studio"
                          value={watermark.text}
                          onChange={(e) => setWatermark((w) => ({ ...w, text: e.target.value }))}
                        />
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 84px', gap: 1, alignItems: 'center' }}>
                          <Select
                            native
                            size="small"
                            id="studio-wm-place"
                            value={watermark.placement}
                            onChange={(e) =>
                              setWatermark((w) => ({ ...w, placement: e.target.value as WatermarkPlacement }))
                            }
                          >
                            <option value="bottom-right">{t('st.posBR')}</option>
                            <option value="bottom-left">{t('st.posBL')}</option>
                            <option value="top-right">{t('st.posTR')}</option>
                            <option value="top-left">{t('st.posTL')}</option>
                            <option value="center">{t('sig.wmPosCenter')}</option>
                            <option value="tiled">{t('st.posTiled')}</option>
                          </Select>
                          <TextField
                            size="small"
                            type="color"
                            label={t('pdf.editColour')}
                            value={watermark.color}
                            onChange={(e) => setWatermark((w) => ({ ...w, color: e.target.value }))}
                          />
                        </Box>
                        <Box>
                          <Typography variant="caption" fontWeight={600} display="block">
                            {t('st.wmSize', { n: watermark.fontSize })}
                          </Typography>
                          <Slider
                            size="small"
                            min={16}
                            max={96}
                            value={watermark.fontSize}
                            onChange={(_, v) => setWatermark((w) => ({ ...w, fontSize: v as number }))}
                          />
                        </Box>
                        <Box>
                          <Typography variant="caption" fontWeight={600} display="block">
                            {t('st.wmOpacity', { n: Math.round(watermark.opacity * 100) })}
                          </Typography>
                          <Slider
                            size="small"
                            min={0.1}
                            max={1}
                            step={0.05}
                            value={watermark.opacity}
                            onChange={(_, v) => setWatermark((w) => ({ ...w, opacity: v as number }))}
                          />
                        </Box>
                      </Stack>
                    )}

                    {activeTab === 'filters' && (
                      <Stack spacing={1}>
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <Button
                            type="button"
                            size="small"
                            variant="text"
                            startIcon={<RestartAltIcon sx={{ fontSize: 15 }} />}
                            onClick={() => setFilters(DEFAULT_FILTERS)}
                            sx={{ py: 0, minWidth: 0, fontSize: '0.75rem' }}
                          >
                            {t('crop.reset')}
                          </Button>
                        </Box>
                        {(
                          [
                            { key: 'brightness', label: t('st.brightness', { n: filters.brightness }), min: 50, max: 150 },
                            { key: 'contrast', label: t('st.contrast', { n: filters.contrast }), min: 50, max: 150 },
                            { key: 'saturate', label: t('st.saturate', { n: filters.saturate }), min: 0, max: 200 },
                            { key: 'grayscale', label: t('st.grayscale', { n: filters.grayscale }), min: 0, max: 100 },
                            { key: 'blur', label: t('st.blur', { n: filters.blur }), min: 0, max: 10 },
                          ] as const
                        ).map((sl) => (
                          <Box key={sl.key}>
                            <Typography variant="caption" fontWeight={600} display="block">
                              {sl.label}
                            </Typography>
                            <Slider
                              size="small"
                              min={sl.min}
                              max={sl.max}
                              value={filters[sl.key]}
                              onChange={(_, v) => setFilters((f) => ({ ...f, [sl.key]: v as number }))}
                            />
                          </Box>
                        ))}
                      </Stack>
                    )}

                    {activeTab === 'exif' && (
                      <Stack spacing={1.25}>
                        <Typography variant="caption" color="text.secondary">
                          {t('ex.intro')}
                        </Typography>
                        {exif?.hasExif ? (
                          <Box
                            component="dl"
                            sx={{
                              display: 'grid',
                              gridTemplateColumns: 'auto 1fr',
                              columnGap: 2,
                              rowGap: 0.75,
                              m: 0,
                              p: 1.5,
                              borderRadius: 1,
                              bgcolor: 'background.default',
                              border: 1,
                              borderColor: 'divider',
                            }}
                          >
                            {exifRows.map((r) => (
                              <Box key={r.label} sx={{ display: 'contents' }}>
                                <Box component="dt" sx={{ typography: 'caption', color: 'text.secondary' }}>
                                  {r.label}
                                </Box>
                                <Box component="dd" sx={{ m: 0, typography: 'caption', fontWeight: 600 }}>
                                  {r.value}
                                </Box>
                              </Box>
                            ))}
                            <Box component="dt" sx={{ typography: 'caption', color: 'text.secondary' }}>
                              {t('ex.gps')}
                            </Box>
                            <Box
                              component="dd"
                              sx={{
                                m: 0,
                                typography: 'caption',
                                fontWeight: 600,
                                color: exif.hasGps ? 'warning.main' : 'success.main',
                              }}
                            >
                              {exif.hasGps ? t('ex.gpsYes') : t('ex.gpsNo')}
                            </Box>
                          </Box>
                        ) : (
                          <Alert severity="success" sx={{ py: 0.5 }}>
                            {t('ex.clean')}
                          </Alert>
                        )}
                      </Stack>
                    )}

                    <Box
                      sx={{
                        pt: 1.25,
                        borderTop: 1,
                        borderColor: 'divider',
                        display: 'grid',
                        gridTemplateColumns: targetFormat !== 'png' ? '1fr 1fr' : '1fr',
                        gap: 1,
                        alignItems: 'center',
                      }}
                    >
                      <Box>
                        <Typography variant="caption" fontWeight={600} component="label" htmlFor="studio-format">
                          {t('cv.outputFormat')}
                        </Typography>
                        <Select
                          native
                          fullWidth
                          size="small"
                          id="studio-format"
                          value={targetFormat}
                          onChange={(e) => setTargetFormat(e.target.value as ExportFmt)}
                          sx={{ mt: 0.5 }}
                        >
                          <option value="jpeg">{formatLabel('jpeg')}</option>
                          <option value="webp">{formatLabel('webp')}</option>
                          <option value="png">{formatLabel('png')}</option>
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
                          />
                        </Box>
                      )}
                    </Box>

                    <Button
                      type="button"
                      variant="contained"
                      size="large"
                      fullWidth
                      id="studio-export-btn"
                      disabled={busy}
                      onClick={() => void handleExport()}
                    >
                      {busy
                        ? t('crop.applying')
                        : activeTab === 'exif'
                          ? t('ex.stripBtn')
                          : t('st.exportBtn')}
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
