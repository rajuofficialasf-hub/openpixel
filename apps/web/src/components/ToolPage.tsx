/**
 * Reusable tool-processing page header (prompt §11).
 *
 * Every tool page follows the same pattern: breadcrumb (in the
 * app shell), then this header — title + one short description —
 * then the upload area, options, actions and result. Using one
 * component keeps the six tool pages visually identical instead
 * of drifting apart one heading at a time.
 */
import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'

interface ToolPageHeaderProps {
  /** Stable id — the page's <section> uses it in aria-labelledby. */
  headingId: string
  title: string
  /** Keep to ~2 sentences; the description may be a ReactNode so
   *  pages can mention live state (e.g. whether WASM is loaded). */
  description: ReactNode
  /** Optional right-aligned actions (e.g. a view toggle). */
  actions?: ReactNode
}

export function ToolPageHeader({ headingId, title, description, actions }: ToolPageHeaderProps) {
  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="h5" component="h2" id={headingId}>
          {title}
        </Typography>
        {actions}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 720 }}>
        {description}
      </Typography>
    </Box>
  )
}
