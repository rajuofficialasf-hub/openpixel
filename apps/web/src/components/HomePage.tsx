/**
 * Homepage (prompt §9): hero, main upload area, popular tools,
 * categories, how it works, benefits, privacy.
 *
 * The upload area is real: a dropped file is sniffed (PDF magic
 * bytes, then the image signature detector) and routed to the
 * workspace that can handle it — with the file handed over, not
 * just a navigation. Office documents and unknown files get an
 * honest notice instead of a dead end.
 */
import { useRef, useState } from 'react'
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
import { detectFileFormat } from '../lib/detect'
import { DropZone } from './DropZone'
import { ToolCard } from './ToolCard'

interface HomePageProps {
  onNavigate: (route: RouteId, opts?: { toolsCategory?: ToolCategory; files?: File[] }) => void
}

const HOW_IT_WORKS = [
  {
    icon: <UploadFileIcon color="primary" />,
    title: 'Upload your file',
    text: 'Drag it in or browse — images, PDFs and more. Nothing is uploaded to a server.',
  },
  {
    icon: <MouseIcon color="primary" />,
    title: 'Select your operation',
    text: 'Convert, resize, compress, merge, OCR — the tool opens with your file already loaded.',
  },
  {
    icon: <DownloadIcon color="primary" />,
    title: 'Download your file',
    text: 'The result downloads straight from your browser, with a clear summary of what changed.',
  },
]

const BENEFITS = [
  {
    icon: <FormatShapesIcon color="primary" />,
    title: 'Many formats',
    text: '20+ image formats, full PDF tooling, Office documents and OCR in one place.',
  },
  {
    icon: <SpeedIcon color="primary" />,
    title: 'Simple workflows',
    text: 'Every tool follows the same pattern — upload, set options, download. No learning curve per tool.',
  },
  {
    icon: <ShieldIcon color="primary" />,
    title: 'Secure by design',
    text: 'Processing happens in your browser. Files never leave your device.',
  },
  {
    icon: <FolderZipIcon color="primary" />,
    title: 'Batch operations',
    text: 'Convert or resize whole folders at once, with a zip of the results.',
  },
  {
    icon: <DevicesIcon color="primary" />,
    title: 'Same engine everywhere',
    text: 'The web app, the CLI and the desktop app run the same OpenPixel Engine.',
  },
  {
    icon: <NoAccountsIcon color="primary" />,
    title: 'No account',
    text: 'No sign-up, no subscription, no tracking. Open the site and start working.',
  },
]

export function HomePage({ onNavigate }: HomePageProps) {
  const [notice, setNotice] = useState<string | null>(null)
  const [routing, setRouting] = useState(false)
  const uploadRef = useRef<HTMLDivElement>(null)

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
        setNotice(
          `"${first.name}" looks like an Office document — those convert in the CLI / desktop app (openpixel doc convert). The browser cannot run LibreOffice.`,
        )
        return
      }
      setNotice(
        `"${first.name}" is not a file this browser can process. Try an image (PNG, JPEG, WebP, …) or a PDF — or use the CLI for other formats.`,
      )
    } finally {
      setRouting(false)
    }
  }

  return (
    <Stack spacing={4}>
      {/* 1. Hero */}
      <Box component="section" aria-labelledby="home-hero-heading" sx={{ textAlign: 'center', py: { xs: 2, md: 4 } }}>
        <Typography variant="h1" component="h1" id="home-hero-heading" sx={{ maxWidth: 760, mx: 'auto' }}>
          Everything You Need to Work With Files
        </Typography>
        <Typography
          variant="body1"
          color="text.secondary"
          sx={{ maxWidth: 640, mx: 'auto', mt: 2, fontSize: '1.0625rem' }}
        >
          Convert, edit, compress, organize, and optimize your files in one powerful workspace.
        </Typography>
        <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 3, flexWrap: 'wrap' }}>
          <Button variant="contained" size="large" onClick={() => onNavigate('tools')}>
            Explore All Tools
          </Button>
          <Button
            variant="outlined"
            size="large"
            onClick={() => uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          >
            Get Started
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          100% local — files never leave your browser. No account, no upload.
        </Typography>
      </Box>

      {/* 2. Main upload area */}
      <Box component="section" aria-labelledby="home-upload-heading" ref={uploadRef}>
        <Typography variant="h5" component="h2" id="home-upload-heading" sx={{ mb: 2 }}>
          Start with a file
        </Typography>
        <DropZone
          onFiles={(files) => void routeFiles(files)}
          label={routing ? 'Reading your file…' : 'Drop your files here'}
          hint="Images go to Convert, PDFs go to PDF Tools, several images go to Batch. Multiple files supported."
          inputId="home-file"
        />
        {notice && (
          <Typography role="status" variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {notice}
          </Typography>
        )}
      </Box>

      {/* 3. Popular tools */}
      <Box component="section" aria-labelledby="home-popular-heading">
        <Typography variant="h5" component="h2" id="home-popular-heading" sx={{ mb: 1 }}>
          Popular tools
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The tools people reach for first — every one of them works in your browser.
        </Typography>
        <Grid container spacing={2}>
          {POPULAR_TOOLS.map((tool) => (
            <Grid key={tool.id} size={{ xs: 12, sm: 6, lg: 3 }}>
              <ToolCard tool={tool} onNavigate={(route) => onNavigate(route)} />
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* 4. Categories */}
      <Box component="section" aria-labelledby="home-categories-heading">
        <Typography variant="h5" component="h2" id="home-categories-heading" sx={{ mb: 1 }}>
          Explore categories
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Browse by what you are working with.
        </Typography>
        <Grid container spacing={2}>
          {CATEGORIES.map((cat) => (
            <Grid key={cat.id} size={{ xs: 12, sm: 6, lg: 4 }}>
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
                  <CardContent>
                    <Typography variant="subtitle1">{cat.label}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {cat.blurb}
                    </Typography>
                  </CardContent>
                </Button>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* 5. How it works */}
      <Box component="section" aria-labelledby="home-how-heading">
        <Typography variant="h5" component="h2" id="home-how-heading" sx={{ mb: 2 }}>
          How it works
        </Typography>
        <Grid container spacing={2}>
          {HOW_IT_WORKS.map((step, i) => (
            <Grid key={step.title} size={{ xs: 12, md: 4 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    {step.icon}
                    <Typography variant="overline" color="text.secondary">
                      Step {i + 1}
                    </Typography>
                  </Box>
                  <Typography variant="subtitle1">{step.title}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {step.text}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* 6. Benefits */}
      <Box component="section" aria-labelledby="home-benefits-heading">
        <Typography variant="h5" component="h2" id="home-benefits-heading" sx={{ mb: 2 }}>
          Why OpenPixel Studio
        </Typography>
        <Grid container spacing={2}>
          {BENEFITS.map((b) => (
            <Grid key={b.title} size={{ xs: 12, sm: 6, lg: 4 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box sx={{ mb: 1 }}>{b.icon}</Box>
                  <Typography variant="subtitle1">{b.title}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {b.text}
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
              Your files stay yours
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Every tool on this site runs in your browser — conversion, PDF work and OCR included. Files are
              read with the File API on your device and never sent to a server, because there is no server. The
              only thing stored on this device is a short list of file names you processed (My Files), which you
              can clear at any time in Settings. The CLI and desktop app use the same engine on your own
              machine.
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Stack>
  )
}
