/**
 * Homepage: designed to fit 100% inside a single desktop screen
 * (1280×720 / 1366×768 / 1440×900) with ZERO vertical scroll on PC,
 * while stacking cleanly on phones/tablets.
 *
 * 1. Hero + integrated smart DropZone side-by-side
 * 2. Quick Start — 4 primary workflows in one crisp row
 * 3. Popular Tools — 6 compact cards in a 3×2 grid
 * 4. Compact 1-row "How it works + 100% Local" footer strip
 */
import { useState } from 'react'
import { Alert, Box, Button, Card, CardActionArea, CardContent, Grid, Stack, Typography } from '@mui/material'
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import { POPULAR_TOOLS, toolDescription, type RouteId, type ToolCategory } from '../lib/routes'
import { useI18n } from '../lib/use-i18n'
import { detectFileFormat } from '../lib/detect'
import { createSampleImageFile, createSamplePdfFile } from '../lib/samples'
import { DropZone } from './DropZone'
import { ToolIcon } from './CategoryIcon'

interface HomePageProps {
  onNavigate: (route: RouteId, opts?: { toolsCategory?: ToolCategory; files?: File[] }) => void
}

const QUICK_ACTIONS: { route: RouteId; toolId: string; category: ToolCategory; titleKey: string; descKey: string }[] = [
  { route: 'convert', toolId: 'convert', category: 'image', titleKey: 'nav.convert', descKey: 'home.qaConvertDesc' },
  { route: 'resize', toolId: 'resize', category: 'image', titleKey: 'nav.resize', descKey: 'home.qaResizeDesc' },
  { route: 'pdf', toolId: 'pdf-merge', category: 'pdf', titleKey: 'nav.pdf', descKey: 'home.qaPdfDesc' },
  { route: 'ocr', toolId: 'ocr', category: 'ocr', titleKey: 'nav.ocr', descKey: 'home.qaOcrDesc' },
]

export function HomePage({ onNavigate }: HomePageProps) {
  const { t, lang } = useI18n()
  const [notice, setNotice] = useState<string | null>(null)
  const [routing, setRouting] = useState(false)

  const routeFiles = async (files: File[]) => {
    const first = files[0]
    if (!first) return
    setNotice(null)
    setRouting(true)
    try {
      const head = new Uint8Array(await first.slice(0, 5).arrayBuffer())
      const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46
      if (isPdf) {
        onNavigate('pdf', { files: [first] })
        return
      }
      const detected = await detectFileFormat(first)
      if (detected !== 'unknown') {
        if (files.length > 1) onNavigate('batch', { files })
        else onNavigate('convert', { files: [first] })
        return
      }
      const isZip = head[0] === 0x50 && head[1] === 0x4b
      const isOle = head[0] === 0xd0 && head[1] === 0xcf
      if (isZip || isOle) {
        setNotice(t('home.noticeOffice', { name: first.name }))
        return
      }
      setNotice(t('home.noticeUnknown', { name: first.name }))
    } finally {
      setRouting(false)
    }
  }

  // Show 6 popular tools so they form an exact 3×2 desktop grid with
  // zero orphan row and fit cleanly in a single viewport.
  const featuredTools = POPULAR_TOOLS.slice(0, 6)

  return (
    <Stack
      spacing={{ xs: 3, lg: 2 }}
      sx={{
        flex: { lg: 1 },
        justifyContent: { lg: 'space-between' },
        minHeight: { lg: 0 },
      }}
    >
      {/* 1. Hero + integrated smart DropZone */}
      <Box component="section" aria-labelledby="home-hero-heading">
        <Grid container spacing={2.5} alignItems="center">
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography
              variant="h1"
              component="h1"
              id="home-hero-heading"
              sx={{
                fontSize: { xs: '1.75rem', md: '2.15rem', xl: '2.4rem' },
                lineHeight: 1.12,
                fontWeight: 600,
                letterSpacing: '-0.02em',
              }}
            >
              {t('home.heroTitle')}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 1, fontSize: '0.95rem', lineHeight: 1.5, maxWidth: '34rem' }}
            >
              {t('home.heroSub')}
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ mt: 2, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                onClick={() => document.getElementById('home-file')?.click()}
              >
                {t('home.chooseFile')}
              </Button>
              <Button
                variant="outlined"
                endIcon={<ArrowForwardIcon />}
                onClick={() => onNavigate('tools')}
              >
                {t('home.exploreTools')}
              </Button>
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <DropZone
              onFiles={(files) => void routeFiles(files)}
              label={routing ? t('home.readingFile') : t('home.dropLabel')}
              hint={t('home.dropHint')}
              inputId="home-file"
              radius={1.5}
              compact
            />
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              justifyContent="center"
              flexWrap="wrap"
              useFlexGap
              sx={{ mt: 0.75 }}
            >
              <Typography variant="caption" color="text.secondary">
                {t('sample.tryLabel')}
              </Typography>
              <Button
                type="button"
                size="small"
                variant="text"
                id="sample-image-btn"
                startIcon={<AutoAwesomeIcon sx={{ fontSize: 15 }} />}
                onClick={() => {
                  void createSampleImageFile().then((sample) => onNavigate('convert', { files: [sample] }))
                }}
                sx={{ py: 0.25, px: 1, fontSize: '0.78rem' }}
              >
                {t('sample.tryImage')}
              </Button>
              <Button
                type="button"
                size="small"
                variant="text"
                id="sample-pdf-btn"
                startIcon={<PictureAsPdfIcon sx={{ fontSize: 15 }} />}
                onClick={() => {
                  onNavigate('pdf-edit', { files: [createSamplePdfFile()] })
                }}
                sx={{ py: 0.25, px: 1, fontSize: '0.78rem' }}
              >
                {t('sample.tryPdf')}
              </Button>
            </Stack>
            {notice && (
              <Alert severity="info" role="status" sx={{ mt: 1 }}>
                {notice}
              </Alert>
            )}
          </Grid>
        </Grid>
      </Box>

      {/* 2. Quick start — 4 core destinations in one crisp row */}
      <Box component="section" aria-labelledby="home-quick-heading">
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="subtitle1" component="h2" id="home-quick-heading" fontWeight={600}>
            {t('home.quickActions')}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'inline' } }}>
            {t('home.quickActionsSub')}
          </Typography>
        </Box>
        <Grid container spacing={1.5}>
          {QUICK_ACTIONS.map((qa) => (
            <Grid key={qa.route} size={{ xs: 12, sm: 6, lg: 3 }}>
              <Card
                sx={{
                  height: '100%',
                  transition: (theme) => theme.transitions.create(['border-color', 'transform'], { duration: theme.transitions.duration.short }),
                  '&:hover': { borderColor: 'primary.main', transform: 'translateY(-1px)' },
                }}
              >
                <CardActionArea onClick={() => onNavigate(qa.route)} sx={{ height: '100%' }}>
                  <CardContent sx={{ p: 1.75, '&:last-child': { pb: 1.75 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                      <ToolIcon toolId={qa.toolId} category={qa.category} />
                      <Typography variant="subtitle2" component="h3" fontWeight={600}>
                        {t(qa.titleKey)}
                      </Typography>
                    </Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        mt: 0.75,
                        lineHeight: 1.4,
                      }}
                    >
                      {t(qa.descKey)}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* 3. Popular tools — compact 3×2 grid */}
      <Box component="section" aria-labelledby="home-popular-heading">
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="subtitle1" component="h2" id="home-popular-heading" fontWeight={600}>
            {t('home.popularTitle')}
          </Typography>
          <Button size="small" endIcon={<ArrowForwardIcon />} onClick={() => onNavigate('tools')} sx={{ py: 0 }}>
            {t('home.exploreTools')}
          </Button>
        </Box>
        <Grid container spacing={1.5}>
          {featuredTools.map((tool) => (
            <Grid key={tool.id} size={{ xs: 12, sm: 6, lg: 4 }}>
              <Card
                sx={{
                  height: '100%',
                  transition: (theme) => theme.transitions.create(['border-color', 'transform'], { duration: theme.transitions.duration.short }),
                  '&:hover': { borderColor: 'primary.main', transform: 'translateY(-1px)' },
                }}
              >
                <CardActionArea
                  onClick={() => tool.route && onNavigate(tool.route)}
                  aria-label={t('tool.ariaOpen', { name: tool.name })}
                  sx={{ height: '100%' }}
                >
                  <CardContent
                    sx={{
                      p: 1.5,
                      '&:last-child': { pb: 1.5 },
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                    }}
                  >
                    <ToolIcon toolId={tool.id} category={tool.categories[0]} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                        <Typography variant="subtitle2" component="h3" fontWeight={600} noWrap>
                          {tool.name}
                        </Typography>
                        {tool.formatChip && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', flexShrink: 0 }}
                          >
                            {tool.formatChip}
                          </Typography>
                        )}
                      </Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {toolDescription(lang, tool)}
                      </Typography>
                    </Box>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* 4. Compact 1-row How it works + Privacy bar */}
      <Card component="section" aria-labelledby="home-privacy-heading">
        <CardContent
          sx={{
            py: 1.25,
            px: 2,
            '&:last-child': { pb: 1.25 },
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1.5,
          }}
        >
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="caption" fontWeight={600} color="primary.main">
              {t('home.howTitle')}:
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('step.upload')} → {t('step.options')} → {t('step.download')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <ShieldOutlinedIcon color="success" sx={{ fontSize: 16 }} />
            <Typography variant="caption" color="text.secondary" id="home-privacy-heading">
              {t('home.privacyTitle')} — {t('footer.localNote')}
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Stack>
  )
}
