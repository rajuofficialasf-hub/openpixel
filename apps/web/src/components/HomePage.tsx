/**
 * Homepage (prompt §9): hero, main upload area, popular tools,
 * categories, how it works, benefits, privacy.
 *
 * The upload area is real: a dropped file is sniffed (PDF magic
 * bytes, then the image signature detector) and routed to the
 * workspace that can handle it — with the file handed over, not
 * just a navigation. Office documents and unknown files get an
 * honest notice instead of a dead end.
 *
 * Hero (unslop): an asymmetric split — the headline on the left,
 * a coded conversion preview on the right. The primary action is
 * the real work (choosing a file), not a scroll to the dropzone.
 */
import { useState } from 'react'
import { Box, Button, Card, CardContent, Grid, Stack, Typography } from '@mui/material'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import MouseIcon from '@mui/icons-material/Mouse'
import DownloadIcon from '@mui/icons-material/Download'
import ShieldIcon from '@mui/icons-material/Shield'
import SpeedIcon from '@mui/icons-material/Speed'
import DevicesIcon from '@mui/icons-material/Devices'
import FolderZipIcon from '@mui/icons-material/FolderZip'
import FormatShapesIcon from '@mui/icons-material/FormatShapes'
import NoAccountsIcon from '@mui/icons-material/NoAccounts'
import { CATEGORIES, POPULAR_TOOLS, type RouteId, type ToolCategory } from '../lib/routes'
import { translate } from '../lib/i18n'
import { useI18n } from '../lib/use-i18n'
import { detectFileFormat } from '../lib/detect'
import { DropZone } from './DropZone'
import { ToolCard } from './ToolCard'
import { ConversionPreview } from './ConversionPreview'
import { CategoryIcon } from './CategoryIcon'

interface HomePageProps {
  onNavigate: (route: RouteId, opts?: { toolsCategory?: ToolCategory; files?: File[] }) => void
}

const HOW_IT_WORKS = [
  { icon: <UploadFileIcon color="primary" />, key: 'how1' },
  { icon: <MouseIcon color="primary" />, key: 'how2' },
  { icon: <DownloadIcon color="primary" />, key: 'how3' },
]

const BENEFITS = [
  { icon: <FormatShapesIcon color="primary" />, key: 'benefit1' },
  { icon: <SpeedIcon color="primary" />, key: 'benefit2' },
  { icon: <ShieldIcon color="primary" />, key: 'benefit3' },
  { icon: <FolderZipIcon color="primary" />, key: 'benefit4' },
  { icon: <DevicesIcon color="primary" />, key: 'benefit5' },
  { icon: <NoAccountsIcon color="primary" />, key: 'benefit6' },
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

  return (
    <Stack spacing={4}>
      {/* 1. Hero — split: headline left, conversion preview right. */}
      <Box component="section" aria-labelledby="home-hero-heading" sx={{ py: { xs: 4, md: 6 } }}>
        <Grid container spacing={6} alignItems="center">
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography
              variant="h1"
              component="h1"
              id="home-hero-heading"
              sx={{
                fontSize: { xs: '2.25rem', md: '3.5rem' },
                lineHeight: { xs: 1.1, md: 1.05 },
                fontWeight: 500,
                letterSpacing: '-0.02em',
              }}
            >
              {t('home.heroTitle')}
            </Typography>
            <Typography
              variant="body1"
              color="text.secondary"
              sx={{ mt: 2, fontSize: '1.125rem', lineHeight: 1.6, maxWidth: '36rem' }}
            >
              {t('home.heroSub')}
            </Typography>
            <Stack direction="row" spacing={2} sx={{ mt: 3, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                size="large"
                onClick={() => document.getElementById('home-file')?.click()}
              >
                {t('home.chooseFile')}
              </Button>
              <Button variant="outlined" size="large" onClick={() => onNavigate('tools')}>
                {t('home.exploreTools')}
              </Button>
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <ConversionPreview />
          </Grid>
        </Grid>
      </Box>

      {/* 2. Main upload area */}
      <Box component="section" aria-labelledby="home-upload-heading">
        <Typography variant="h5" component="h2" id="home-upload-heading" sx={{ mb: 2 }}>
          {t('home.startWithFile')}
        </Typography>
        <DropZone
          onFiles={(files) => void routeFiles(files)}
          label={routing ? t('home.readingFile') : t('home.dropLabel')}
          hint={t('home.dropHint')}
          inputId="home-file"
          radius={1.5}
        />
        {notice && (
          <Typography role="status" variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {notice}
          </Typography>
        )}
      </Box>

      {/* 3. {t('home.popularTitle')} */}
      <Box component="section" aria-labelledby="home-popular-heading">
        <Typography variant="h5" component="h2" id="home-popular-heading" sx={{ mb: 1 }}>
          {t('home.popularTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('home.popularSub')}
        </Typography>
        <Grid container spacing={2}>
          {POPULAR_TOOLS.map((tool) => (
            <Grid key={tool.id} size={{ xs: 12, sm: 4, lg: 4 }}>
              <ToolCard tool={tool} onNavigate={(route) => onNavigate(route)} />
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* 4. Categories — the last card spans the full row, so no
          single card is orphaned on its own row. */}
      <Box component="section" aria-labelledby="home-categories-heading">
        <Typography variant="h5" component="h2" id="home-categories-heading" sx={{ mb: 1 }}>
          {t('home.categoriesTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('home.categoriesSub')}
        </Typography>
        <Grid container spacing={2}>
          {CATEGORIES.map((cat, i) => {
            const wide = i === CATEGORIES.length - 1
            return (
              <Grid key={cat.id} size={wide ? { xs: 12, sm: 12, lg: 12 } : { xs: 12, sm: 6, lg: 4 }}>
                <Card sx={{ height: '100%' }}>
                  <Button
                    onClick={() => onNavigate('tools', { toolsCategory: cat.id })}
                    sx={{
                      display: 'block',
                      width: '100%',
                      height: '100%',
                      textAlign: 'left',
                      textTransform: 'none',
                      color: 'text.primary',
                      p: 0,
                    }}
                  >
                    <CardContent
                      sx={
                        wide
                          ? { display: 'flex', alignItems: 'center', gap: 2 }
                          : { display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'flex-start' }
                      }
                    >
                      <CategoryIcon category={cat.id} />
                      <Box>
                        <Typography variant="subtitle1">{translate(lang, `cat.${cat.id}`)}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {translate(lang, `cat.${cat.id}.blurb`)}
                        </Typography>
                      </Box>
                    </CardContent>
                  </Button>
                </Card>
              </Grid>
            )
          })}
        </Grid>
      </Box>

      {/* 5. {t('home.howTitle')} */}
      <Box component="section" aria-labelledby="home-how-heading">
        <Typography variant="h5" component="h2" id="home-how-heading" sx={{ mb: 2 }}>
          {t('home.howTitle')}
        </Typography>
        <Grid container spacing={2}>
          {HOW_IT_WORKS.map((step, i) => (
            <Grid key={step.key} size={{ xs: 12, md: 4 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    {step.icon}
                    <Typography variant="overline" color="text.secondary">
                      {t('home.howStep', { n: i + 1 })}
                    </Typography>
                  </Box>
                  <Typography variant="subtitle1">{t(`home.${step.key}Title`)}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(`home.${step.key}Text`)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* 6. Benefits — two wider columns, a different rhythm from
          the three-column grids above. */}
      <Box component="section" aria-labelledby="home-benefits-heading">
        <Typography variant="h5" component="h2" id="home-benefits-heading" sx={{ mb: 2 }}>
          {t('home.whyTitle')}
        </Typography>
        <Grid container spacing={2}>
          {BENEFITS.map((b) => (
            <Grid key={b.key} size={{ xs: 12, sm: 6, lg: 6 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box sx={{ mb: 1 }}>{b.icon}</Box>
                  <Typography variant="subtitle1">{t(`home.${b.key}Title`)}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(`home.${b.key}Text`)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* Privacy */}
      <Box component="section" aria-labelledby="home-privacy-heading">
        <Card>
          <CardContent>
            <Typography variant="h6" component="h2" id="home-privacy-heading">
              {t('home.privacyTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t('home.privacyText')}
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Stack>
  )
}
