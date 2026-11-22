/**
 * Conversion preview — the hero's one bright moment, built in code
 * from the product's own output (unslop: show the product, don't
 * decorate it). One example conversion: a photo going from PNG to
 * WebP, with the size before and after drawn as two bars so the
 * saving reads at a glance. The numbers are a plausible example,
 * labelled as such — not a claim about any real file.
 */
import { Box, Card, CardContent, Typography } from '@mui/material'
import ImageIcon from '@mui/icons-material/Image'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { useI18n } from '../lib/use-i18n'

const MONO = {
  fontFamily: '"IBM Plex Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.8125rem',
  lineHeight: 1.5,
} as const

function SizeBar({ label, size, width, accent }: { label: string; size: string; width: string; accent?: boolean }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography sx={{ ...MONO, color: accent ? 'primary.main' : 'text.primary', fontWeight: 500 }}>
          {size}
        </Typography>
      </Box>
      <Box
        sx={{
          height: 8,
          borderRadius: 1,
          bgcolor: 'action.hover',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            height: '100%',
            width,
            borderRadius: 1,
            bgcolor: accent ? 'primary.main' : (t) => t.palette.text.secondary,
            opacity: accent ? 1 : 0.35,
          }}
        />
      </Box>
    </Box>
  )
}

export function ConversionPreview() {
  const { t } = useI18n()
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, height: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: (th) => `${th.palette.primary.main}14`,
              color: 'primary.main',
              flex: 'none',
            }}
          >
            <ImageIcon />
          </Box>
          <Typography sx={{ ...MONO, color: 'text.primary' }}>photo.png</Typography>
          <ArrowForwardIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          <Typography sx={{ ...MONO, color: 'primary.main', fontWeight: 500 }}>photo.webp</Typography>
        </Box>
        <SizeBar label={t('home.previewOriginal')} size="2.4 MB" width="100%" />
        <SizeBar label={t('home.previewConverted')} size="380 KB" width="16%" accent />
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            borderTop: 1,
            borderColor: 'divider',
            pt: 2,
            mt: 'auto',
          }}
        >
          <Typography sx={{ ...MONO, color: 'primary.main', fontWeight: 500 }}>
            {t('home.previewSaving')}
          </Typography>
          <Typography
            sx={{
              fontFamily: MONO.fontFamily,
              fontSize: '0.75rem',
              lineHeight: 1.5,
              color: 'text.secondary',
            }}
          >
            {t('home.previewExample')}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  )
}
