/**
 * Passport, NID & Government Job (Teletalk / BCS / Bank) Photo &
 * Signature Maker — 100% local in the browser, zero-scroll Studio layout.
 *
 * Supports exact pixel + max-KB compliance (300×300 <= 100 KB,
 * 300×80 <= 60 KB, BD Passport, US/Schengen Visa), drag-to-reposition &
 * zoom framing, backdrop fill, and 1-click 4×6" (8 copies) / A4 (20 copies)
 * print sheets with subtle cut guides.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Slider,
  Stack,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import DownloadIcon from '@mui/icons-material/Download'
import PrintIcon from '@mui/icons-material/Print'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import { formatBytes } from '../lib/capabilities'
import { recordActivity } from '../lib/activity'
import {
  buildPrintSheet,
  computeCoverCrop,
  exportPassportPhoto,
  PASSPORT_PRESETS,
  type PassportExportResult,
  type PrintSheetSize,
} from '../lib/passport'
import { DropZone } from './DropZone'
import { EditorShell } from './EditorShell'
import { ImageOutputActions } from './ImageOutputActions'
import { ToolPageHeader } from './ToolPage'
import { WorkflowSteps } from './WorkflowSteps'
import { useNavigation } from './layout/navigation'
import { useI18n } from '../lib/use-i18n'

interface PassportWorkspaceProps {
  initialFiles?: File[]
  onInitialFilesConsumed?: () => void
}

const BG_OPTIONS = [
  { hex: '#ffffff', labelKey: 'bg.fillWhite' },
  { hex: '#1d4ed8', labelKey: 'bg.fillPassportBlue' },
  { hex: '#dbeafe', labelKey: 'bg.fillSky' },
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

export function PassportPhotoWorkspace({
  initialFiles,
  onInitialFilesConsumed,
}: PassportWorkspaceProps = {}) {
  const { t } = useI18n()
  const { navigate } = useNavigation()

  const [file, setFile] = useState<File | null>(null)
  const [loadedImg, setLoadedImg] = useState<HTMLImageElement | null>(null)
  const [presetId, setPresetId] = useState<string>(PASSPORT_PRESETS[0].id)
  const [zoom, setZoom] = useState(1)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [bgColor, setBgColor] = useState('#ffffff')
  const [busy, setBusy] = useState(false)
  const [sheetBusy, setSheetBusy] = useState<PrintSheetSize | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<(PassportExportResult & { filename: string }) | null>(null)

  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; origPanX: number; origPanY: number } | null>(null)

  const preset = PASSPORT_PRESETS.find((p) => p.id === presetId) ?? PASSPORT_PRESETS[0]

  const handleFiles = useCallback(
    (files: File[]) => {
      const next = files[0]
      if (!next) return
      if (!next.type.startsWith('image/')) {
        setError(t('ocr.notImage'))
        return
      }
      setError(null)
      setResult(null)
      const url = URL.createObjectURL(next)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        setFile(next)
        setLoadedImg(img)
        setZoom(1)
        setPanX(0)
        setPanY(0)
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
      handleFiles(initialFiles)
      onInitialFilesConsumed?.()
    }
  }, [initialFiles, handleFiles, onInitialFilesConsumed])

  // Live framing preview canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current
    if (!canvas || !loadedImg) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = preset.width
    canvas.height = preset.height
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const crop = computeCoverCrop(
      loadedImg.naturalWidth,
      loadedImg.naturalHeight,
      preset.width,
      preset.height,
      zoom,
      panX,
      panY,
    )
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(loadedImg, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height)

    // Subtle face/head oval guide for non-signature presets
    if (!preset.isSignature) {
      ctx.save()
      ctx.strokeStyle = 'rgba(49, 87, 213, 0.35)'
      ctx.setLineDash([5, 4])
      ctx.lineWidth = Math.max(1.5, canvas.width / 180)
      ctx.beginPath()
      ctx.ellipse(
        canvas.width / 2,
        canvas.height * 0.43,
        canvas.width * 0.28,
        canvas.height * 0.33,
        0,
        0,
        Math.PI * 2,
      )
      ctx.stroke()
      ctx.restore()
    }
  }, [loadedImg, preset, zoom, panX, panY, bgColor])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, origPanX: panX, origPanY: panY }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    if (!d) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const dx = ((d.startX - e.clientX) / rect.width) * 2
    const dy = ((d.startY - e.clientY) / rect.height) * 2
    setPanX(Math.max(-1, Math.min(1, d.origPanX + dx)))
    setPanY(Math.max(-1, Math.min(1, d.origPanY + dy)))
    setResult(null)
  }

  const onPointerUp = () => {
    dragRef.current = null
  }

  const clearFile = () => {
    setFile(null)
    setLoadedImg(null)
    setResult(null)
    setError(null)
  }

  const handleExport = async () => {
    if (!loadedImg || !file || busy) return
    setBusy(true)
    setError(null)
    try {
      const exported = await exportPassportPhoto(loadedImg, preset, {
        zoom,
        panX,
        panY,
        bgColor,
        maxKb: preset.maxKb,
      })
      const stem = file.name.replace(/\.[^.]+$/, '') || 'photo'
      const filename = `${stem}-${preset.id}.jpg`
      setResult({ ...exported, filename })
      recordActivity({
        fileName: file.name,
        fileSize: file.size,
        fileType: 'image/jpeg',
        tool: 'passport',
        result: `${preset.width}×${preset.height} px · ${formatBytes(exported.bytes)}`,
        resultKey: 'act.passport',
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

  const handlePrintSheet = async (sheet: PrintSheetSize) => {
    if (!loadedImg || !file || sheetBusy) return
    setSheetBusy(sheet)
    setError(null)
    try {
      const baseBlob =
        result?.blob ??
        (
          await exportPassportPhoto(loadedImg, preset, {
            zoom,
            panX,
            panY,
            bgColor,
            maxKb: null,
          })
        ).blob
      const built = await buildPrintSheet(baseBlob, sheet)
      const stem = file.name.replace(/\.[^.]+$/, '') || 'passport'
      downloadBlob(built.blob, `${stem}-${preset.id}-${sheet}-sheet.jpg`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('crop.errExport'))
    } finally {
      setSheetBusy(null)
    }
  }

  return (
    <Box
      component="section"
      aria-labelledby="passport-heading"
      sx={{ display: 'flex', flexDirection: 'column', flex: { lg: 1 }, minHeight: { lg: 0 } }}
    >
      <Stack spacing={2} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 } }}>
        <ToolPageHeader
          headingId="passport-heading"
          title={t('pp.title')}
          description={t('pp.desc')}
          actions={
            <WorkflowSteps
              activeStep={!file ? 0 : result ? 2 : 1}
              steps={[t('step.upload'), t('pp.stepFrame'), t('step.download')]}
            />
          }
        />

        {!file && (
          <Box sx={{ flex: { lg: 1 }, display: 'flex', flexDirection: 'column', '& > *': { flex: { lg: 1 } } }}>
            <DropZone
              inputId="passport-file"
              label={t('cv.dropLabel')}
              hint={t('pp.dropHint')}
              multiple={false}
              accept="image/*"
              onFiles={handleFiles}
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
                      <Typography variant="overline" color="text.secondary">
                        {t('pp.framePreview', { w: preset.width, h: preset.height })}
                        {preset.maxKb ? ` · ≤ ${preset.maxKb} KB` : ''}
                      </Typography>
                      <Stack direction="row" spacing={1}>
                        <Button
                          type="button"
                          variant="outlined"
                          size="small"
                          startIcon={<AutoFixHighIcon sx={{ fontSize: 15 }} />}
                          onClick={() => navigate('bg-remove', { files: [file] })}
                        >
                          {t('pp.removeBgFirst')}
                        </Button>
                        <Button type="button" variant="outlined" size="small" onClick={clearFile}>
                          {t('common.chooseDifferentFile')}
                        </Button>
                      </Stack>
                    </Box>

                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
                      <Box
                        component="canvas"
                        ref={previewCanvasRef}
                        id="passport-preview-canvas"
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                        sx={{
                          display: 'block',
                          maxHeight: { xs: 240, lg: 'clamp(160px, calc(100dvh - 430px), 290px)' },
                          maxWidth: '100%',
                          width: 'auto',
                          height: 'auto',
                          borderRadius: 1,
                          border: 2,
                          borderColor: 'primary.main',
                          boxShadow: '0 4px 16px rgba(15,23,42,0.12)',
                          cursor: 'grab',
                          touchAction: 'none',
                        }}
                      />
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
                      {t('pp.dragHint')}
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
                      {t('pp.done', {
                        w: result.width,
                        h: result.height,
                        bytes: formatBytes(result.bytes),
                        q: result.qualityUsed,
                      })}
                    </Typography>
                    <Stack direction="row" flexWrap="wrap" spacing={1} useFlexGap sx={{ mt: 1.25 }}>
                      <Button
                        type="button"
                        variant="contained"
                        size="small"
                        id="passport-download"
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
                  <Typography variant="overline" color="text.secondary">
                    {t('common.settings')}
                  </Typography>
                  <Stack spacing={1.75} sx={{ mt: 1 }}>
                    <Box>
                      <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" sx={{ mb: 0.75 }}>
                        {t('pp.choosePreset')}
                      </Typography>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        {PASSPORT_PRESETS.map((p) => (
                          <Chip
                            key={p.id}
                            size="small"
                            clickable
                            id={`pp-preset-${p.id}`}
                            label={t(p.labelKey)}
                            color={presetId === p.id ? 'primary' : 'default'}
                            variant={presetId === p.id ? 'filled' : 'outlined'}
                            onClick={() => {
                              setPresetId(p.id)
                              setResult(null)
                            }}
                          />
                        ))}
                      </Stack>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
                        {t(preset.noteKey)}
                      </Typography>
                    </Box>

                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="caption" fontWeight={600}>
                          {t('pp.zoom', { n: `${Math.round(zoom * 100)}%` })}
                        </Typography>
                        <Button
                          type="button"
                          size="small"
                          variant="text"
                          startIcon={<RestartAltIcon sx={{ fontSize: 15 }} />}
                          onClick={() => {
                            setZoom(1)
                            setPanX(0)
                            setPanY(0)
                            setResult(null)
                          }}
                          sx={{ py: 0, minWidth: 0, fontSize: '0.75rem' }}
                        >
                          {t('crop.reset')}
                        </Button>
                      </Box>
                      <Slider
                        size="small"
                        min={1}
                        max={3}
                        step={0.05}
                        value={zoom}
                        onChange={(_, v) => {
                          setZoom(v as number)
                          setResult(null)
                        }}
                      />
                    </Box>

                    <Box>
                      <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" sx={{ mb: 0.75 }}>
                        {t('pp.bgColor')}
                      </Typography>
                      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                        {BG_OPTIONS.map((b) => (
                          <Chip
                            key={b.hex}
                            size="small"
                            clickable
                            label={t(b.labelKey)}
                            color={bgColor === b.hex ? 'primary' : 'default'}
                            variant={bgColor === b.hex ? 'filled' : 'outlined'}
                            onClick={() => {
                              setBgColor(b.hex)
                              setResult(null)
                            }}
                          />
                        ))}
                        <Box
                          component="input"
                          type="color"
                          aria-label={t('bg.fillCustom')}
                          value={bgColor}
                          onChange={(e) => {
                            setBgColor(e.target.value)
                            setResult(null)
                          }}
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
                      </Stack>
                    </Box>

                    <Button
                      type="button"
                      variant="contained"
                      size="large"
                      fullWidth
                      id="passport-export-btn"
                      disabled={busy}
                      onClick={() => void handleExport()}
                    >
                      {busy ? t('crop.applying') : t('pp.exportBtn')}
                    </Button>

                    {!preset.isSignature && (
                      <Box sx={{ pt: 1.25, borderTop: 1, borderColor: 'divider' }}>
                        <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" sx={{ mb: 0.75 }}>
                          {t('pp.printSheetTitle')}
                        </Typography>
                        <Stack direction="row" spacing={1}>
                          <Button
                            type="button"
                            size="small"
                            variant="outlined"
                            fullWidth
                            id="passport-sheet-4x6"
                            startIcon={<PrintIcon sx={{ fontSize: 16 }} />}
                            disabled={sheetBusy !== null}
                            onClick={() => void handlePrintSheet('4x6')}
                          >
                            {t('pp.sheet4x6')}
                          </Button>
                          <Button
                            type="button"
                            size="small"
                            variant="outlined"
                            fullWidth
                            id="passport-sheet-a4"
                            startIcon={<PrintIcon sx={{ fontSize: 16 }} />}
                            disabled={sheetBusy !== null}
                            onClick={() => void handlePrintSheet('a4')}
                          >
                            {t('pp.sheetA4')}
                          </Button>
                        </Stack>
                      </Box>
                    )}
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
