/**
 * Reusable tool-processing page header: compact single-row title +
 * inline right-aligned workflow steps/actions, with a short subtitle
 * beneath so workspaces fit comfortably on one PC screen without
 * scrolling.
 */
import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'

interface ToolPageHeaderProps {
  /** Stable id — the page's <section> uses it in aria-labelledby. */
  headingId: string
  title: string
  /** Keep concise (1–2 sentences). */
  description: ReactNode
  /** Optional right-aligned content (e.g. WorkflowSteps or a view toggle). */
  actions?: ReactNode
}

export function ToolPageHeader({ headingId, title, description, actions }: ToolPageHeaderProps) {
  return (
    <Box sx={{ flex: '0 1 auto', minWidth: 0, maxWidth: '100%' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="h5" component="h2" id={headingId} sx={{ lineHeight: 1.2 }}>
          {title}
        </Typography>
        {actions}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 820 }}>
        {description}
      </Typography>
    </Box>
  )
}
