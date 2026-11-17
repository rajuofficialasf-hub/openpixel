/**
 * Tool card — one card per tool, used by the homepage and the
 * All Tools directory. The card is honest about availability:
 * - `web`: navigates to the working workspace.
 * - `cli-only`: opens a dialog with the exact CLI command (and a
 *   copy button). Nothing pretends to work in the browser.
 * - `coming-soon`: a disabled-looking card with a "Coming soon"
 *   chip — never a working-looking button for a missing feature.
 */
import { useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material'
import ImageIcon from '@mui/icons-material/Image'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import DescriptionIcon from '@mui/icons-material/Description'
import DocumentScannerIcon from '@mui/icons-material/DocumentScanner'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import CompressIcon from '@mui/icons-material/Compress'
import MovieIcon from '@mui/icons-material/Movie'
import TerminalIcon from '@mui/icons-material/Terminal'
import type { ToolCategory, ToolEntry } from '../lib/routes'
import type { RouteId } from '../lib/routes'
import { useNotify } from './layout/notify'

const CATEGORY_ICONS: Record<ToolCategory, React.ReactNode> = {
  image: <ImageIcon />,
  pdf: <PictureAsPdfIcon />,
  document: <DescriptionIcon />,
  ocr: <DocumentScannerIcon />,
  conversion: <AutorenewIcon />,
  compression: <CompressIcon />,
  media: <MovieIcon />,
}

interface ToolCardProps {
  tool: ToolEntry
  onNavigate: (route: RouteId) => void
}

export function ToolCard({ tool, onNavigate }: ToolCardProps) {
  const notify = useNotify()
  const [cliOpen, setCliOpen] = useState(false)

  const statusChip =
    tool.status === 'web' ? (
      <Chip size="small" color="success" label="Available" />
    ) : tool.status === 'cli-only' ? (
      <Chip size="small" color="info" label="CLI & desktop only" />
    ) : (
      <Chip size="small" label="Coming soon" />
    )

  const body = (
    <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: (t) => `${t.palette.primary.main}14`,
            color: 'primary.main',
            flex: 'none',
          }}
        >
          {CATEGORY_ICONS[tool.categories[0]]}
        </Box>
        <Typography variant="subtitle1" component="h3" sx={{ lineHeight: 1.3 }}>
          {tool.name}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
        {tool.description}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {statusChip}
        {tool.status === 'cli-only' && <TerminalIcon fontSize="small" color="action" />}
      </Box>
    </CardContent>
  )

  if (tool.status === 'coming-soon') {
    return (
      <Card sx={{ height: '100%', opacity: 0.75 }} aria-label={`${tool.name} — coming soon`}>
        {body}
      </Card>
    )
  }

  if (tool.status === 'cli-only') {
    return (
      <>
        <Card sx={{ height: '100%' }}>
          <CardActionArea
            onClick={() => setCliOpen(true)}
            aria-label={`${tool.name} — available in the CLI and desktop app, view the command`}
            sx={{ height: '100%' }}
          >
            {body}
          </CardActionArea>
        </Card>
        <Dialog open={cliOpen} onClose={() => setCliOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>{tool.name} — CLI & desktop only</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {tool.description} It does not run in the browser: the desktop app and the CLI use the same
              engine on your machine.
            </Typography>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 2,
                borderRadius: 2,
                bgcolor: 'background.default',
                border: 1,
                borderColor: 'divider',
                fontSize: '0.8125rem',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {tool.cliCommand}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              The CLI is the same openpixel binary the CI builds for Linux, Windows and macOS — see the GitHub
              repository for downloads.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCliOpen(false)}>Close</Button>
            <Button
              variant="contained"
              onClick={() => {
                if (tool.cliCommand) void navigator.clipboard?.writeText(tool.cliCommand)
                notify('Command copied')
              }}
            >
              Copy command
            </Button>
          </DialogActions>
        </Dialog>
      </>
    )
  }

  return (
    <Card sx={{ height: '100%' }}>
      <CardActionArea
        onClick={() => tool.route && onNavigate(tool.route)}
        aria-label={`${tool.name} — open the tool`}
        sx={{ height: '100%' }}
      >
        {body}
      </CardActionArea>
    </Card>
  )
}
