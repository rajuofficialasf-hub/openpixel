/**
 * Interactive Before / After split-comparison slider (Squoosh-style).
 *
 * Drag the divider with mouse, touch, or keyboard arrow keys to compare
 * original vs converted/resized output pixel-by-pixel inside a single
 * fixed-height viewport frame (no scrolling required).
 */
import { useCallback, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import CompareArrowsIcon from '@mui/icons-material/CompareArrows'

export interface ImageCompareSliderProps {
  beforeUrl: string
  afterUrl: string
  beforeLabel: string
  afterLabel: string
  beforeAlt: string
  afterAlt: string
  /** Optional percentage delta label (e.g. "−62%" or "+4%"). */
  deltaLabel?: string
  deltaPositive?: boolean
  maxHeight?: Record<string, string | number> | number | string
}

export function ImageCompareSlider({
  beforeUrl,
  afterUrl,
  beforeLabel,
  afterLabel,
  beforeAlt,
  afterAlt,
  deltaLabel,
  deltaPositive,
  maxHeight = { xs: 230, lg: 'clamp(150px, calc(100dvh - 420px), 290px)' },
}: ImageCompareSliderProps) {
  const [percent, setPercent] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const updateFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    const next = Math.round(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)))
    setPercent(next)
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    updateFromClientX(e.clientX)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    updateFromClientX(e.clientX)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setPercent((p) => Math.max(0, p - 5))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setPercent((p) => Math.min(100, p + 5))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setPercent(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setPercent(100)
    }
  }

  return (
    <Box
      ref={containerRef}
      role="slider"
      tabIndex={0}
      aria-label={`${beforeLabel} / ${afterLabel}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      sx={{
        position: 'relative',
        width: '100%',
        height: maxHeight,
        borderRadius: 1.5,
        overflow: 'hidden',
        border: 1,
        borderColor: 'divider',
        userSelect: 'none',
        touchAction: 'none',
        cursor: 'ew-resize',
        // Subtle checkerboard so transparent PNG/WebP edges remain visible.
        backgroundImage: (t) =>
          t.palette.mode === 'dark'
            ? 'repeating-conic-gradient(#1b2538 0% 25%, #121a2b 0% 50%)'
            : 'repeating-conic-gradient(#eef2f7 0% 25%, #ffffff 0% 50%)',
        backgroundSize: '16px 16px',
      }}
    >
      {/* After (result) image — full frame underneath */}
      <Box
        component="img"
        src={afterUrl}
        alt={afterAlt}
        draggable={false}
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
        }}
      />

      {/* Before (original) image — clipped to left side of slider */}
      <Box
        component="img"
        src={beforeUrl}
        alt={beforeAlt}
        draggable={false}
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          clipPath: `inset(0 ${100 - percent}% 0 0)`,
          pointerEvents: 'none',
        }}
      />

      {/* Vertical divider line + center handle */}
      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${percent}%`,
          width: 2,
          transform: 'translateX(-1px)',
          bgcolor: 'primary.main',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.65)',
          pointerEvents: 'none',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 34,
            height: 34,
            borderRadius: '50%',
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            border: '2px solid',
            borderColor: 'background.paper',
          }}
        >
          <CompareArrowsIcon sx={{ fontSize: 18 }} />
        </Box>
      </Box>

      {/* Corner badges */}
      <Typography
        variant="caption"
        sx={{
          position: 'absolute',
          top: 8,
          left: 8,
          px: 1,
          py: 0.25,
          borderRadius: 1,
          bgcolor: (t) => alpha(t.palette.background.paper, 0.88),
          border: 1,
          borderColor: 'divider',
          fontWeight: 600,
          pointerEvents: 'none',
        }}
      >
        {beforeLabel}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          px: 1,
          py: 0.25,
          borderRadius: 1,
          bgcolor: (t) => alpha(t.palette.background.paper, 0.88),
          border: 1,
          borderColor: deltaPositive ? (t) => alpha(t.palette.success.main, 0.5) : 'divider',
          color: deltaPositive ? 'success.main' : 'text.primary',
          fontWeight: 600,
          pointerEvents: 'none',
        }}
      >
        {afterLabel}
        {deltaLabel ? ` (${deltaLabel})` : ''}
      </Typography>
    </Box>
  )
}
