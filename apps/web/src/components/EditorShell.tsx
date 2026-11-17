/**
 * Shared editor layout (prompt §14–15): the canvas/preview area
 * on the left, the tools/options panel on the right — one column
 * on mobile. The PDF editor uses the same visual language with
 * an extra thumbnails rail on the left. No engine behaviour lives
 * here; it is only the grid.
 */
import type { ReactNode } from 'react'
import { Box } from '@mui/material'

interface EditorShellProps {
  /** Main canvas/preview area (left on desktop). */
  main: ReactNode
  /** Tools/options panel (right on desktop). */
  tools: ReactNode
}

export function EditorShell({ main, tools }: EditorShellProps) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
        alignItems: 'start',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>{main}</Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>{tools}</Box>
    </Box>
  )
}
