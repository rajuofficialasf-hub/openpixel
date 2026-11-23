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
import { toolDescription, type ToolEntry } from '../lib/routes'
import type { RouteId } from '../lib/routes'
import { useI18n } from '../lib/use-i18n'
import { useNotify } from './layout/notify'
import { ToolIcon } from './CategoryIcon'

interface ToolCardProps {
  tool: ToolEntry
  onNavigate: (route: RouteId) => void
  /**
   * Full-width orphan card (last card of a section that would
   * otherwise sit alone on its row): horizontal layout, icon left,
   * text right — like the homepage Media category card. Split by
   * breakpoint, because a card can be full-width at sm (2 columns)
   * but a normal third at lg (3 columns), or the other way round.
   */
  wideSm?: boolean
  wideLg?: boolean
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

export function ToolCard({ tool, onNavigate, wideSm = false, wideLg = false }: ToolCardProps) {
  const { t, lang } = useI18n()
  const notify = useNotify()
  const [cliOpen, setCliOpen] = useState(false)

  const foot =
    tool.status === 'web' ? (
      tool.formatChip ? <Typography sx={MONO_META}>{tool.formatChip}</Typography> : null
    ) : tool.status === 'cli-only' ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={MONO_META}>{t('header.searchCliOnly')}</Typography>
        <TerminalIcon color="action" sx={{ fontSize: 16 }} />
      </Box>
    ) : (
      <Typography sx={MONO_META}>{t('header.searchComingSoon')}</Typography>
    )

  const body = (
    <CardContent
      sx={{
        display: 'flex',
        height: '100%',
        p: 1.75,
        '&:last-child': { pb: 1.75 },
        flexDirection: {
          xs: 'column',
          sm: wideSm || wideLg ? 'row' : 'column',
          lg: wideLg ? 'row' : 'column',
        },
        alignItems: {
          xs: 'stretch',
          sm: wideSm || wideLg ? 'center' : 'stretch',
          lg: wideLg ? 'center' : 'stretch',
        },
        gap: { xs: 0.75, sm: wideSm || wideLg ? 1.5 : 0.75, lg: wideLg ? 1.5 : 0.75 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
        <ToolIcon toolId={tool.id} category={tool.categories[0]} />
        <Typography variant="subtitle2" component="h3" fontWeight={600} sx={{ lineHeight: 1.3 }}>
          {tool.name}
        </Typography>
      </Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          flex: 1,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          lineHeight: 1.45,
        }}
      >
        {toolDescription(lang, tool)}
      </Typography>
      {foot}
    </CardContent>
  )

  if (tool.status === 'coming-soon') {
    return (
      <Card sx={{ height: '100%', opacity: 0.75 }} aria-label={t('tool.ariaComingSoon', { name: tool.name })}>
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
            aria-label={t('tool.ariaCli', { name: tool.name })}
            sx={{ height: '100%' }}
          >
            {body}
          </CardActionArea>
        </Card>
        <Dialog open={cliOpen} onClose={() => setCliOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>
            {tool.name} — {t('header.searchCliOnly')}
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {toolDescription(lang, tool)} {t('tool.descCliExtra')}
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
              {t('tool.cliCaption')}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCliOpen(false)}>{t('tool.close')}</Button>
            <Button
              variant="contained"
              onClick={() => {
                if (tool.cliCommand) void navigator.clipboard?.writeText(tool.cliCommand)
                notify(t('tool.copied'))
              }}
            >
              {t('tool.copyCommand')}
            </Button>
          </DialogActions>
        </Dialog>
      </>
    )
  }

  return (
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
        {body}
      </CardActionArea>
    </Card>
  )
}
