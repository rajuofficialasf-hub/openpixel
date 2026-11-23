/**
 * Visual PDF page grid — click page thumbnails to select (Rotate,
 * Extract, Remove, Duplicate) or drag-and-drop / arrow-move pages to
 * reorder (Reorder) without manually typing page numbers.
 *
 * Thumbnails render progressively via pdf.js (capped at 24 pages so
 * large PDFs stay responsive; extra pages render as compact numbered
 * tiles). Everything stays synced with the underlying text field.
 */
import { useEffect, useState } from 'react'
import { Box, Button, IconButton, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import { renderPdfPage } from '../../lib/pdf'
import { useI18n } from '../../lib/use-i18n'

const MAX_THUMBS = 24

function usePageThumbnails(bytes: Uint8Array | null, pageCount: number): Map<number, string> {
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map())

  useEffect(() => {
    if (!bytes || pageCount <= 0) return
    let cancelled = false
    const limit = Math.min(pageCount, MAX_THUMBS)
    void (async () => {
      const next = new Map<number, string>()
      for (let page = 1; page <= limit; page++) {
        if (cancelled) return
        try {
          const { canvas } = await renderPdfPage(bytes, page, 0.24)
          next.set(page, canvas.toDataURL('image/png'))
          if (!cancelled) setThumbs(new Map(next))
        } catch {
          // Leave page as numbered box if pdf.js cannot render it.
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bytes, pageCount])

  return thumbs
}

interface SelectGridProps {
  bytes: Uint8Array | null
  pageCount: number
  selectedPages: number[]
  onChangeSelected: (pages: number[]) => void
  /** Highlight colour for selected pages ('error' for Remove). */
  accent?: 'primary' | 'error'
  /** When true, empty selection means "all pages" (RotateTool). */
  emptyMeansAll?: boolean
  /** Visual preview rotation in degrees (RotateTool). */
  rotatePreviewDeg?: number
}

export function PdfVisualSelectGrid({
  bytes,
  pageCount,
  selectedPages,
  onChangeSelected,
  accent = 'primary',
  emptyMeansAll = false,
  rotatePreviewDeg = 0,
}: SelectGridProps) {
  const { t } = useI18n()
  const thumbs = usePageThumbnails(bytes, pageCount)
  const selectedSet = new Set(selectedPages)

  if (!bytes || pageCount <= 0) return null

  const allPages = Array.from({ length: pageCount }, (_, i) => i + 1)

  const toggle = (page: number) => {
    const next = new Set(selectedSet)
    if (next.has(page)) next.delete(page)
    else next.add(page)
    onChangeSelected(Array.from(next).sort((a, b) => a - b))
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" sx={{ mb: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {selectedPages.length > 0
            ? t('pdf.selectedCount', { sel: selectedPages.length, total: pageCount })
            : emptyMeansAll
              ? t('pdf.allSelectedNote', { total: pageCount })
              : t('pdf.visualPickHint')}
        </Typography>
        <Stack direction="row" spacing={0.75}>
          <Button size="small" variant="text" onClick={() => onChangeSelected(allPages)} sx={{ py: 0, minWidth: 0 }}>
            {t('pdf.selectAll')}
          </Button>
          {selectedPages.length > 0 && (
            <Button size="small" variant="text" color="secondary" onClick={() => onChangeSelected([])} sx={{ py: 0, minWidth: 0 }}>
              {t('pdf.clearSelection')}
            </Button>
          )}
        </Stack>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))',
          gap: 1.25,
          maxHeight: 220,
          overflowY: 'auto',
          p: 1,
          borderRadius: 1.5,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'background.default',
        }}
      >
        {allPages.map((page) => {
          const isSelected = selectedSet.has(page)
          const src = thumbs.get(page)
          const shouldRotate = rotatePreviewDeg !== 0 && (isSelected || (emptyMeansAll && selectedPages.length === 0))
          return (
            <Box
              key={page}
              component="button"
              type="button"
              onClick={() => toggle(page)}
              aria-pressed={isSelected}
              sx={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 0.5,
                p: 0.75,
                borderRadius: 1.5,
                border: 2,
                borderColor: isSelected ? `${accent}.main` : 'divider',
                bgcolor: isSelected
                  ? (th) => alpha(th.palette[accent].main, 0.1)
                  : 'background.paper',
                cursor: 'pointer',
                transition: (th) => th.transitions.create(['border-color', 'background-color']),
                '&:hover': { borderColor: `${accent}.main` },
              }}
            >
              {isSelected && (
                <CheckCircleIcon
                  sx={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    fontSize: 16,
                    color: `${accent}.main`,
                    bgcolor: 'background.paper',
                    borderRadius: '50%',
                  }}
                />
              )}
              <Box
                sx={{
                  width: 64,
                  height: 82,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  borderRadius: 0.75,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                }}
              >
                {src ? (
                  <Box
                    component="img"
                    src={src}
                    alt=""
                    sx={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                      transform: shouldRotate ? `rotate(${rotatePreviewDeg}deg)` : undefined,
                      transition: 'transform 160ms ease',
                    }}
                  />
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    p.{page}
                  </Typography>
                )}
              </Box>
              <Typography variant="caption" fontWeight={isSelected ? 700 : 500} color={isSelected ? `${accent}.main` : 'text.secondary'}>
                {t('pdf.pageN', { n: page })}
              </Typography>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

interface ReorderGridProps {
  bytes: Uint8Array | null
  pageCount: number
  order: number[]
  onChangeOrder: (next: number[]) => void
}

export function PdfVisualReorderGrid({ bytes, pageCount, order, onChangeOrder }: ReorderGridProps) {
  const { t } = useI18n()
  const thumbs = usePageThumbnails(bytes, pageCount)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  if (!bytes || pageCount <= 0) return null

  const defaultOrder = Array.from({ length: pageCount }, (_, i) => i + 1)
  const current = order.length === pageCount ? order : defaultOrder

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= current.length) return
    const next = [...current]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChangeOrder(next)
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" sx={{ mb: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {t('pdf.visualReorderHint')}
        </Typography>
        <Button size="small" variant="text" onClick={() => onChangeOrder(defaultOrder)} sx={{ py: 0, minWidth: 0 }}>
          {t('pdf.resetOrder')}
        </Button>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
          gap: 1.25,
          maxHeight: 230,
          overflowY: 'auto',
          p: 1,
          borderRadius: 1.5,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'background.default',
        }}
      >
        {current.map((page, idx) => {
          const src = thumbs.get(page)
          const isOver = overIdx === idx && dragIdx !== null && dragIdx !== idx
          return (
            <Box
              key={page}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => {
                e.preventDefault()
                if (overIdx !== idx) setOverIdx(idx)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragIdx !== null) move(dragIdx, idx)
                setDragIdx(null)
                setOverIdx(null)
              }}
              onDragEnd={() => {
                setDragIdx(null)
                setOverIdx(null)
              }}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 0.5,
                p: 0.75,
                borderRadius: 1.5,
                border: 2,
                borderColor: isOver ? 'primary.main' : 'divider',
                bgcolor: isOver ? (th) => alpha(th.palette.primary.main, 0.08) : 'background.paper',
                cursor: 'grab',
                opacity: dragIdx === idx ? 0.5 : 1,
                userSelect: 'none',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <Typography variant="caption" color="primary.main" fontWeight={700}>
                  #{idx + 1}
                </Typography>
                <DragIndicatorIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
              </Box>
              <Box
                sx={{
                  width: 64,
                  height: 78,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  borderRadius: 0.75,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                }}
              >
                {src ? (
                  <Box component="img" src={src} alt="" draggable={false} sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    p.{page}
                  </Typography>
                )}
              </Box>
              <Stack direction="row" spacing={0.25} alignItems="center">
                <IconButton
                  size="small"
                  aria-label={t('pdf.moveLeft', { n: page })}
                  disabled={idx === 0}
                  onClick={() => move(idx, idx - 1)}
                  sx={{ p: 0.25 }}
                >
                  <ArrowBackIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <Typography variant="caption" color="text.secondary">
                  p.{page}
                </Typography>
                <IconButton
                  size="small"
                  aria-label={t('pdf.moveRight', { n: page })}
                  disabled={idx === current.length - 1}
                  onClick={() => move(idx, idx + 1)}
                  sx={{ p: 0.25 }}
                >
                  <ArrowForwardIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Stack>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
