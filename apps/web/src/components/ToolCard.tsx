/**
 * Tool card — one card per tool, used by the homepage and the
 * All Tools directory. The card is honest about availability:
 * - `web`: navigates to the working workspace.
 * - `cli-only`: opens a dialog with the exact CLI command (and a
 *   copy button). Nothing pretends to work in the browser.
 * - `coming-soon`: a disabled-looking card with a quiet "Coming soon"
 *   line — never a working-looking button for a missing feature.
 * The card foot carries one quiet mono line: the tool's format
 * pair (e.g. "PNG → WebP") when it has one, the real status
 * ("CLI & desktop only", "Coming soon") when it matters, and
 * nothing at all for a plain web tool.
 */
import { useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material'
import TerminalIcon from '@mui/icons-material/Terminal'
import type { ToolEntry } from '../lib/routes'
import type { RouteId } from '../lib/routes'
import { useNotify } from './layout/notify'
import { CategoryIcon } from './CategoryIcon'

interface ToolCardProps {
  tool: ToolEntry
  onNavigate: (route: RouteId) => void
}

/**
 * Quiet mono meta line for the card foot. One size, one colour —
 * it names the format pair (the signature chip) or the real
 * availability status, and nothing else. Web tools with no natural
 * format pair show nothing: "Available" on every card said nothing.
 */
const MONO_META = {
  fontFamily: '"IBM Plex Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.75rem',
  lineHeight: 1.5,
  color: 'text.secondary',
} as const

export function ToolCard({ tool, onNavigate }: ToolCardProps) {
  const notify = useNotify()
  const [cliOpen, setCliOpen] = useState(false)

  const foot =
    tool.status === 'web' ? (
      tool.formatChip ? <Typography sx={MONO_META}>{tool.formatChip}</Typography> : null
    ) : tool.status === 'cli-only' ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={MONO_META}>CLI & desktop only</Typography>
        <TerminalIcon color="action" sx={{ fontSize: 16 }} />
      </Box>
    ) : (
      <Typography sx={MONO_META}>Coming soon</Typography>
    )

  const body = (
    <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <CategoryIcon category={tool.categories[0]} />
        <Typography variant="subtitle1" component="h3" sx={{ lineHeight: 1.3 }}>
          {tool.name}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
        {tool.description}
      </Typography>
      {foot}
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
