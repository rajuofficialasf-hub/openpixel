/**
 * PDF editor left rail (prompt §14): real page thumbnails.
 *
 * Each thumbnail is a genuine pdf.js render of that page at low
 * scale — never a placeholder. Rendering is sequential and
 * progressive (each thumbnail appears as it finishes), capped at
 * 12 pages so a 200-page PDF does not stall the tab; the rest is
 * listed as numbered buttons. A page whose render fails stays a
 * numbered box instead of a fake image. Clicking a thumbnail (or
 * a number) jumps the center preview to that page.
 */
import { useEffect, useState } from 'react'
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import { renderPdfPage } from '../lib/pdf'

const MAX_THUMBNAILS = 12

interface PdfThumbnailsProps {
  bytes: Uint8Array
  pageCount: number
  currentPage: number
  onSelect: (page: number) => void
}

export function PdfThumbnails({ bytes, pageCount, currentPage, onSelect }: PdfThumbnailsProps) {
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map())

  useEffect(() => {
    let cancelled = false
    const shown = Math.min(pageCount, MAX_THUMBNAILS)
    void (async () => {
      const next = new Map<number, string>()
      for (let page = 1; page <= shown; page++) {
        if (cancelled) return
        try {
          const { canvas } = await renderPdfPage(bytes, page, 0.2)
          next.set(page, canvas.toDataURL('image/png'))
          if (!cancelled) setThumbs(new Map(next))
        } catch {
          // Leave the page as a numbered box — never a fake image.
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bytes, pageCount])

  const pages = Array.from({ length: pageCount }, (_, i) => i + 1)
  const shownPages = pages.slice(0, MAX_THUMBNAILS)
  const restPages = pages.slice(MAX_THUMBNAILS)

  return (
    <Card>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          Pages
        </Typography>
        <Stack
          spacing={1}
          sx={{
            mt: 1,
            flexDirection: { xs: 'row', lg: 'column' },
            overflowX: { xs: 'auto', lg: 'visible' },
            pb: { xs: 1, lg: 0 },
          }}
        >
          {shownPages.map((page) => {
            const src = thumbs.get(page)
            const selected = page === currentPage
            return (
              <Button
                key={page}
                onClick={() => onSelect(page)}
                aria-label={`Go to page ${page}`}
                aria-current={selected ? 'true' : undefined}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  alignItems: 'center',
                  p: 1,
                  minWidth: 96,
                  textTransform: 'none',
                  border: 1,
                  borderColor: selected ? 'primary.main' : 'divider',
                  borderRadius: 2,
                  bgcolor: selected ? 'action.selected' : 'transparent',
                }}
              >
                {src ? (
                  <Box
                    component="img"
                    src={src}
                    alt=""
                    sx={{ width: 72, height: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}
                  />
                ) : (
                  <Box
                    sx={{
                      width: 72,
                      height: 96,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 1,
                      color: 'text.secondary',
                      typography: 'body2',
                    }}
                  >
                    p. {page}
                  </Box>
                )}
                <Typography variant="caption" color="text.secondary">
                  Page {page}
                </Typography>
              </Button>
            )
          })}
        </Stack>
        {restPages.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              …and {restPages.length} more page{restPages.length === 1 ? '' : 's'} — use the page selector in
              the preview to jump to them.
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
              {restPages.map((page) => (
                <Button
                  key={page}
                  size="small"
                  variant={page === currentPage ? 'contained' : 'outlined'}
                  onClick={() => onSelect(page)}
                  aria-label={`Go to page ${page}`}
                  sx={{ minWidth: 36, px: 1 }}
                >
                  {page}
                </Button>
              ))}
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
