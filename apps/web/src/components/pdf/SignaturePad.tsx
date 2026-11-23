/**
 * Interactive signature drawing pad (mouse + touch via Pointer Events).
 * Stores normalized strokes so they export cleanly as crisp transparent
 * vector PDF polylines.
 */
import { useEffect, useRef } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import UndoIcon from '@mui/icons-material/Undo'
import ClearIcon from '@mui/icons-material/Clear'
import type { NormalizedStroke } from '../../lib/signature'
import { useI18n } from '../../lib/use-i18n'

export interface SignaturePadProps {
  strokes: NormalizedStroke[]
  onChange: (next: NormalizedStroke[]) => void
  inkColor: string
  onInkColorChange: (hex: string) => void
  strokeWidth: number
  onStrokeWidthChange: (width: number) => void
}

const INK_COLORS = [
  { hex: '#111827', label: 'Black' },
  { hex: '#1d4ed8', label: 'Blue' },
  { hex: '#b91c1c', label: 'Red' },
]

const PEN_WIDTHS = [
  { value: 1.5, labelKey: 'sig.penThin' },
  { value: 2.4, labelKey: 'sig.penMedium' },
  { value: 3.4, labelKey: 'sig.penBold' },
]

export function SignaturePad({
  strokes,
  onChange,
  inkColor,
  onInkColorChange,
  strokeWidth,
  onStrokeWidthChange,
}: SignaturePadProps) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeStrokeRef = useRef<NormalizedStroke | null>(null)

  const paint = (allStrokes: NormalizedStroke[], liveStroke: NormalizedStroke | null = null) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    // Subtle baseline guide
    ctx.save()
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.28)'
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(16, h - 22)
    ctx.lineTo(w - 16, h - 22)
    ctx.stroke()
    ctx.restore()

    const list = liveStroke ? [...allStrokes, liveStroke] : allStrokes
    ctx.strokeStyle = inkColor
    ctx.lineWidth = strokeWidth * 1.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const stroke of list) {
      if (stroke.length < 2) continue
      ctx.beginPath()
      ctx.moveTo(stroke[0][0] * w, stroke[0][1] * h)
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(stroke[i][0] * w, stroke[i][1] * h)
      }
      ctx.stroke()
    }
  }

  useEffect(() => {
    paint(strokes, activeStrokeRef.current)
  })

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] | null => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    return [nx, ny]
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = pointFromEvent(e)
    if (!pt) return
    e.currentTarget.setPointerCapture(e.pointerId)
    activeStrokeRef.current = [pt]
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const current = activeStrokeRef.current
    if (!current) return
    const pt = pointFromEvent(e)
    if (!pt) return
    const prev = current[current.length - 1]
    const dx = pt[0] - prev[0]
    const dy = pt[1] - prev[1]
    // Skip tiny sub-pixel jitter so PDF polyline stays compact and smooth.
    if (dx * dx + dy * dy < 0.00003) return
    current.push(pt)
    paint(strokes, current)
  }

  const finishStroke = () => {
    const current = activeStrokeRef.current
    activeStrokeRef.current = null
    if (!current || current.length < 2) {
      paint(strokes, null)
      return
    }
    onChange([...strokes, current])
  }

  return (
    <Stack spacing={1}>
      <Box
        sx={{
          position: 'relative',
          borderRadius: 1.5,
          border: 1,
          borderColor: 'divider',
          bgcolor: '#ffffff',
          overflow: 'hidden',
        }}
      >
        <Box
          component="canvas"
          ref={canvasRef}
          id="pdf-signature-canvas"
          width={360}
          height={128}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          sx={{
            display: 'block',
            width: '100%',
            height: 128,
            cursor: 'crosshair',
            touchAction: 'none',
          }}
        />
        {strokes.length === 0 && (
          <Typography
            variant="caption"
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            {t('sig.drawHint')}
          </Typography>
        )}
      </Box>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={0.75} alignItems="center">
          {INK_COLORS.map((c) => (
            <Box
              key={c.hex}
              component="button"
              type="button"
              aria-label={c.label}
              onClick={() => onInkColorChange(c.hex)}
              sx={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                bgcolor: c.hex,
                border: inkColor === c.hex ? '2px solid' : '1px solid',
                borderColor: inkColor === c.hex ? 'primary.main' : 'divider',
                outline: inkColor === c.hex ? '2px solid rgba(49,87,213,0.3)' : 'none',
                cursor: 'pointer',
                p: 0,
              }}
            />
          ))}
          {PEN_WIDTHS.map((p) => (
            <Button
              key={p.value}
              type="button"
              size="small"
              variant={strokeWidth === p.value ? 'contained' : 'outlined'}
              onClick={() => onStrokeWidthChange(p.value)}
              sx={{ minWidth: 0, px: 0.75, py: 0.15, fontSize: '0.7rem' }}
            >
              {t(p.labelKey)}
            </Button>
          ))}
        </Stack>
        <Stack direction="row" spacing={0.5}>
          <Button
            type="button"
            size="small"
            variant="text"
            startIcon={<UndoIcon sx={{ fontSize: 15 }} />}
            disabled={strokes.length === 0}
            onClick={() => onChange(strokes.slice(0, -1))}
            sx={{ minWidth: 0, px: 0.75, fontSize: '0.75rem' }}
          >
            {t('pdf.editUndo')}
          </Button>
          <Button
            type="button"
            size="small"
            variant="text"
            startIcon={<ClearIcon sx={{ fontSize: 15 }} />}
            disabled={strokes.length === 0}
            onClick={() => onChange([])}
            sx={{ minWidth: 0, px: 0.75, fontSize: '0.75rem' }}
          >
            {t('pdf.clearSelection')}
          </Button>
        </Stack>
      </Stack>
    </Stack>
  )
}
