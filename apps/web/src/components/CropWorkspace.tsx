/**
 * Interactive Visual Crop, Rotate & Flip workspace — 100% local in
 * the browser, designed to fit cleanly on a single PC screen with
 * zero scrolling.
 *
 * Renders the rotated/flipped image onto an exact-aspect preview canvas
 * and places a draggable crop box (rule-of-thirds grid, 4 corner
 * handles, aspect-ratio locking) directly over it so the visual crop
 * matches the exported pixels 1:1.
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
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import RotateLeftIcon from '@mui/icons-material/RotateLeft'
import RotateRightIcon from '@mui/icons-material/RotateRight'
import FlipIcon from '@mui/icons-material/Flip'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import DownloadIcon from '@mui/icons-material/Download'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { formatBytes, formatLabel, outputFileName } from '../lib/capabilities'
import { recordActivity } from '../lib/activity'
import {
  centeredAspectRect,
  clampNormRect,
  exportCroppedImage,
  MIN_CROP_FRAC,
  normToPixelRect,
  rotatedDimensions,
  rotateStep,
  type NormRect,
  type RotationDeg,
} from '../lib/crop'
import { DropZone } from './DropZone'
import { EditorShell } from './EditorShell'
import { ImageOutputActions } from './ImageOutputActions'
import { ToolPageHeader } from './ToolPage'
import { WorkflowSteps } from './WorkflowSteps'
import { useNavigation } from './layout/navigation'
import { useI18n } from '../lib/use-i18n'

type DragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se'
type ExportFormat = 'png' | 'jpeg' | 'webp'

interface CropWorkspaceProps {
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

export function CropWorkspace({ initialFiles, onInitialFilesConsumed }: CropWorkspaceProps) {
  const { t } = useI18n()
  const { navigate } = useNavigation()

  const [file, setFile] = useState<File | null>(null)
  const [loadedImg, setLoadedImg] = useState<HTMLImageElement | null>(null)
  const [rotation, setRotation] = useState<RotationDeg>(0)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [aspectId, setAspectId] = useState<string>('free')
  const [aspectRatio, setAspectRatio] = useState<number | null>(null)
  const [crop, setCrop] = useState<NormRect>({ x: 0, y: 0, w: 1, h: 1 })
  const [targetFormat, setTargetFormat] = useState<ExportFormat>('png')
  const [quality, setQuality] = useState(88)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ blob: Blob; width: number; height: number; bytes: number; filename: string } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    handle: DragHandle
    startX: number
    startY: number
    startRect: NormRect
    stageW: number
    stageH: number
  } | null>(null)

  const handleFiles = useCallback(
    async (files: File[]) => {
      const next = files[0]
      if (!next) return
      setError(null)
      setResult(null)
      setFile(next)
      setRotation(0)
      setFlipH(false)
      setFlipV(false)
      setAspectId('free')
      setAspectRatio(null)
      setCrop({ x: 0, y: 0, w: 1, h: 1 })
      if (next.type === 'image/jpeg') setTargetFormat('jpeg')
      else if (next.type === 'image/webp') setTargetFormat('webp')
      else setTargetFormat('png')

      const url = URL.createObjectURL(next)
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image()
          el.onload = () => resolve(el)
          el.onerror = () => reject(new Error(t('crop.errLoad')))
          el.src = url
        })
        setLoadedImg(img)
      } catch (err) {
        setLoadedImg(null)
        setError(err instanceof Error ? err.message : t('crop.errLoad'))
      } finally {
        URL.revokeObjectURL(url)
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

  const rotDims = loadedImg
    ? rotatedDimensions(loadedImg.naturalWidth, loadedImg.naturalHeight, rotation)
    : { width: 0, height: 0 }

  // Draw the rotated & flipped preview image onto the stage canvas.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !loadedImg || rotDims.width === 0 || rotDims.height === 0) return
    // Cap preview canvas backing store to 1200px per side for crisp,
    // low-latency rendering while exporting from full-resolution source.
    const scale = Math.min(1, 1200 / Math.max(rotDims.width, rotDims.height))
    const cw = Math.max(1, Math.round(rotDims.width * scale))
    const ch = Math.max(1, Math.round(rotDims.height * scale))
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cw, ch)
    ctx.save()
    ctx.translate(cw / 2, ch / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
    ctx.drawImage(loadedImg, (-loadedImg.naturalWidth * scale) / 2, (-loadedImg.naturalHeight * scale) / 2, loadedImg.naturalWidth * scale, loadedImg.naturalHeight * scale)
    ctx.restore()
  }, [loadedImg, rotation, flipH, flipV, rotDims.width, rotDims.height])

  const startDrag = (handle: DragHandle) => (e: React.PointerEvent) => {
    e.stopPropagation()
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startRect: crop,
      stageW: rect.width,
      stageH: rect.height,
    }
  }

  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = (e.clientX - d.startX) / d.stageW
    const dy = (e.clientY - d.startY) / d.stageH
    const r = d.startRect

    if (d.handle === 'move') {
      setCrop(clampNormRect({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }))
      return
    }

    let left = r.x
    let top = r.y
    let right = r.x + r.w
    let bottom = r.y + r.h

    if (d.handle === 'nw' || d.handle === 'sw') left = Math.max(0, Math.min(right - MIN_CROP_FRAC, r.x + dx))
    if (d.handle === 'ne' || d.handle === 'se') right = Math.min(1, Math.max(left + MIN_CROP_FRAC, r.x + r.w + dx))
    if (d.handle === 'nw' || d.handle === 'ne') top = Math.max(0, Math.min(bottom - MIN_CROP_FRAC, r.y + dy))
    if (d.handle === 'sw' || d.handle === 'se') bottom = Math.min(1, Math.max(top + MIN_CROP_FRAC, r.y + r.h + dy))

    let w = right - left
    let h = bottom - top

    if (aspectRatio && rotDims.width > 0 && rotDims.height > 0) {
      // Keep aspect ratio in true pixel space: (w * rw) / (h * rh) === aspectRatio
      const imgAspect = rotDims.width / rotDims.height
      const targetNormH = (w * imgAspect) / aspectRatio
      if (d.handle === 'nw' || d.handle === 'ne') {
        const candidateTop = bottom - targetNormH
        if (candidateTop >= 0) {
          top = candidateTop
          h = targetNormH
        } else {
          h = bottom
          top = 0
          w = (h * aspectRatio) / imgAspect
          if (d.handle === 'nw') left = right - w
        }
      } else {
        if (top + targetNormH <= 1) {
          h = targetNormH
        } else {
          h = 1 - top
          w = (h * aspectRatio) / imgAspect
          if (d.handle === 'sw') left = right - w
        }
      }
    }

    setCrop(clampNormRect({ x: left, y: top, w, h }))
  }

  const endDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    dragRef.current = null
    const target = e.currentTarget as HTMLElement
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId)
    }
  }

  const applyAspect = (id: string, ratio: number | null) => {
    setAspectId(id)
    setAspectRatio(ratio)
    setCrop(centeredAspectRect(rotDims.width, rotDims.height, ratio))
    setResult(null)
  }

  const handleRotate = (delta: 90 | -90) => {
    const nextRot = rotateStep(rotation, delta)
    setRotation(nextRot)
    if (loadedImg) {
      const nextDims = rotatedDimensions(loadedImg.naturalWidth, loadedImg.naturalHeight, nextRot)
      setCrop(centeredAspectRect(nextDims.width, nextDims.height, aspectRatio))
    }
    setResult(null)
  }

  const resetAll = () => {
    setRotation(0)
    setFlipH(false)
    setFlipV(false)
    setAspectId('free')
    setAspectRatio(null)
    setCrop({ x: 0, y: 0, w: 1, h: 1 })
    setResult(null)
  }

  const clearFile = () => {
    setFile(null)
    setLoadedImg(null)
    setResult(null)
    setError(null)
    resetAll()
  }

  const handleExport = async () => {
    if (!loadedImg || !file) return
    setBusy(true)
    setError(null)
    try {
      const exported = await exportCroppedImage(loadedImg, { rotation, flipH, flipV, crop }, targetFormat, quality)
      const filename = outputFileName(file.name.replace(/(\.[^.]+)?$/, '-cropped$1'), targetFormat)
      setResult({ ...exported, filename })
      recordActivity({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'image/png',
        tool: 'crop',
        result: `Cropped to ${exported.width}×${exported.height} · ${formatBytes(exported.bytes)}`,
        resultKey: 'act.crop',
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

  const pixelRect = normToPixelRect(crop, rotDims.width, rotDims.height)

  const aspectPresets: { id: string; label: string; ratio: number | null }[] = [
    { id: 'free', label: t('crop.aspectFree'), ratio: null },
    { id: '1:1', label: t('crop.aspectSquare'), ratio: 1 },
    { id: '4:3', label: t('crop.aspect43'), ratio: 4 / 3 },
    { id: '16:9', label: t('crop.aspect169'), ratio: 16 / 9 },
    { id: '3:4', label: t('crop.aspectPassport'), ratio: 3 / 4 },
    { id: '9:16', label: t('crop.aspectStory'), ratio: 9 / 16 },
  ]

  const handles: { id: Exclude<DragHandle, 'move'>; style: Record<string, string | number>; cursor: string }[] = [
    { id: 'nw', style: { top: -6, left: -6 }, cursor: 'nwse-resize' },
    { id: 'ne', style: { top: -6, right: -6 }, cursor: 'nesw-resize' },
    { id: 'sw', style: { bottom: -6, left: -6 }, cursor: 'nesw-resize' },
    { id: 'se', style: { bottom: -6, right: -6 }, cursor: 'nwse-resize' },
  ]

  return (
    <Box component="section" aria-labelledby="crop-heading" sx={{ display: 'flex', flexDirection: 'column', flex: { lg: 1 }, minHeight: { lg: 0 } }}>
      <Stack spacing={2} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 } }}>
        <ToolPageHeader
          headingId="crop-heading"
          title={t('crop.title')}
          description={t('crop.desc')}
          actions={
            <WorkflowSteps
              activeStep={!file ? 0 : result ? 2 : 1}
              steps={[t('step.upload'), t('step.options'), t('step.download')]}
            />
          }
        />

        {!file && (
          <Box sx={{ flex: { lg: 1 }, display: 'flex', flexDirection: 'column', '& > *': { flex: { lg: 1 } } }}>
            <DropZone
              inputId="crop-file"
              label={t('cv.dropLabel')}
              hint={t('crop.dropHint')}
              multiple={false}
              accept="image/*"
              onFiles={(files) => void handleFiles(files)}
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
                      <Typography variant="caption" color="text.secondary" fontWeight={600}>
                        {rotDims.width > 0
                          ? t('crop.selectionInfo', {
                              w: pixelRect.width,
                              h: pixelRect.height,
                              rw: rotDims.width,
                              rh: rotDims.height,
                            })
                          : file.name}
                      </Typography>
                      <Button type="button" variant="outlined" size="small" onClick={clearFile}>
                        {t('common.chooseDifferentFile')}
                      </Button>
                    </Box>

                    {loadedImg && (
                      <Box
                        sx={{
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          p: 1,
                          borderRadius: 1.5,
                          border: 1,
                          borderColor: 'divider',
                          backgroundImage: (th) =>
                            th.palette.mode === 'dark'
                              ? 'repeating-conic-gradient(#1b2538 0% 25%, #121a2b 0% 50%)'
                              : 'repeating-conic-gradient(#eef2f7 0% 25%, #ffffff 0% 50%)',
                          backgroundSize: '16px 16px',
                          overflow: 'hidden',
                        }}
                      >
                        <Box
                          ref={stageRef}
                          sx={{
                            position: 'relative',
                            display: 'inline-block',
                            lineHeight: 0,
                            userSelect: 'none',
                            touchAction: 'none',
                          }}
                        >
                          <Box
                            component="canvas"
                            ref={canvasRef}
                            id="crop-preview-canvas"
                            sx={{
                              display: 'block',
                              maxWidth: '100%',
                              maxHeight: { xs: 250, lg: 'clamp(170px, calc(100dvh - 380px), 360px)' },
                              width: 'auto',
                              height: 'auto',
                            }}
                          />
                          {/* Interactive Crop Box */}
                          <Box
                            onPointerDown={startDrag('move')}
                            onPointerMove={onDragMove}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            sx={{
                              position: 'absolute',
                              left: `${crop.x * 100}%`,
                              top: `${crop.y * 100}%`,
                              width: `${crop.w * 100}%`,
                              height: `${crop.h * 100}%`,
                              border: '2px solid',
                              borderColor: 'primary.main',
                              boxShadow: '0 0 0 9999px rgba(11, 16, 32, 0.52)',
                              cursor: 'move',
                              boxSizing: 'border-box',
                            }}
                          >
                            {/* Subtle rule-of-thirds grid */}
                            <Box
                              aria-hidden="true"
                              sx={{
                                position: 'absolute',
                                inset: 0,
                                pointerEvents: 'none',
                                backgroundImage:
                                  'linear-gradient(to right, transparent 33%, rgba(255,255,255,0.35) 33.3%, transparent 33.8%, transparent 66%, rgba(255,255,255,0.35) 66.3%, transparent 66.8%), linear-gradient(to bottom, transparent 33%, rgba(255,255,255,0.35) 33.3%, transparent 33.8%, transparent 66%, rgba(255,255,255,0.35) 66.3%, transparent 66.8%)',
                              }}
                            />
                            {handles.map((h) => (
                              <Box
                                key={h.id}
                                onPointerDown={startDrag(h.id)}
                                onPointerMove={onDragMove}
                                onPointerUp={endDrag}
                                onPointerCancel={endDrag}
                                sx={{
                                  position: 'absolute',
                                  ...h.style,
                                  width: 14,
                                  height: 14,
                                  borderRadius: '50%',
                                  bgcolor: 'primary.main',
                                  border: '2px solid #ffffff',
                                  boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                                  cursor: h.cursor,
                                }}
                              />
                            ))}
                          </Box>
                        </Box>
                      </Box>
                    )}

                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, textAlign: 'center' }}>
                      {t('crop.dragHint')}
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
                      {t('crop.done', { w: result.width, h: result.height, bytes: formatBytes(result.bytes) })}
                    </Typography>
                    <Stack direction="row" flexWrap="wrap" spacing={1} useFlexGap sx={{ mt: 1.25 }}>
                      <Button
                        type="button"
                        variant="contained"
                        size="small"
                        id="crop-download"
                        startIcon={<DownloadIcon />}
                        onClick={() => downloadBlob(result.blob, result.filename)}
                      >
                        {t('common.download')} {result.filename}
                      </Button>
                      <ImageOutputActions blob={result.blob} filename={result.filename} />
                      <Button type="button" variant="outlined" size="small" onClick={() => setResult(null)}>
                        {t('crop.editAgain')}
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
                          { route: 'resize', label: t('chain.toResize') },
                          { route: 'convert', label: t('chain.toConvert') },
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
                            const outFile = new File([result.blob], result.filename, {
                              type: result.blob.type || `image/${targetFormat}`,
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
                  <Stack spacing={2} sx={{ mt: 1 }}>
                    <Box>
                      <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" sx={{ mb: 0.75 }}>
                        {t('crop.aspect')}
                      </Typography>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        {aspectPresets.map((p) => (
                          <Chip
                            key={p.id}
                            size="small"
                            clickable
                            label={p.label}
                            color={aspectId === p.id ? 'primary' : 'default'}
                            variant={aspectId === p.id ? 'filled' : 'outlined'}
                            onClick={() => applyAspect(p.id, p.ratio)}
                          />
                        ))}
                      </Stack>
                    </Box>

                    <Box>
                      <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" sx={{ mb: 0.75 }}>
                        {t('crop.transform')}
                      </Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Button size="small" variant="outlined" startIcon={<RotateLeftIcon />} onClick={() => handleRotate(-90)}>
                          {t('crop.rotateLeft')}
                        </Button>
                        <Button size="small" variant="outlined" startIcon={<RotateRightIcon />} onClick={() => handleRotate(90)}>
                          {t('crop.rotateRight')}
                        </Button>
                        <Button
                          size="small"
                          variant={flipH ? 'contained' : 'outlined'}
                          startIcon={<FlipIcon />}
                          onClick={() => {
                            setFlipH((v) => !v)
                            setResult(null)
                          }}
                        >
                          {t('crop.flipH')}
                        </Button>
                        <Button
                          size="small"
                          variant={flipV ? 'contained' : 'outlined'}
                          startIcon={<FlipIcon sx={{ transform: 'rotate(90deg)' }} />}
                          onClick={() => {
                            setFlipV((v) => !v)
                            setResult(null)
                          }}
                        >
                          {t('crop.flipV')}
                        </Button>
                        <Button size="small" variant="text" startIcon={<RestartAltIcon />} onClick={resetAll}>
                          {t('crop.reset')}
                        </Button>
                      </Stack>
                    </Box>

                    <Box>
                      <Typography variant="caption" fontWeight={600} component="label" htmlFor="crop-target-format">
                        {t('cv.outputFormat')}
                      </Typography>
                      <Select
                        native
                        fullWidth
                        size="small"
                        id="crop-target-format"
                        value={targetFormat}
                        onChange={(e) => setTargetFormat(e.target.value as ExportFormat)}
                        sx={{ mt: 0.5 }}
                      >
                        <option value="png">{formatLabel('png')}</option>
                        <option value="jpeg">{formatLabel('jpeg')}</option>
                        <option value="webp">{formatLabel('webp')}</option>
                      </Select>
                    </Box>

                    {targetFormat !== 'png' && (
                      <Box>
                        <Typography variant="caption" fontWeight={600} component="label">
                          {t('cv.quality', { n: quality })}
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

                    <Button
                      type="button"
                      variant="contained"
                      size="large"
                      fullWidth
                      id="crop-apply-button"
                      disabled={!loadedImg || busy}
                      onClick={() => void handleExport()}
                    >
                      {busy ? t('crop.applying') : t('crop.apply')}
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
