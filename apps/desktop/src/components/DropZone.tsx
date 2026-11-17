import { Box, Typography } from '@mui/material'
import { useState } from 'react'

interface DropZoneProps {
  onPick: () => void
  label: string
  hint: string
}

/**
 * Drop target + picker button. In the desktop app the real drag-and-drop
 * arrives as a window-level `tauri://drag-drop` event (handled in
 * App.tsx and passed down as dropped paths); this zone is the visible
 * target and the keyboard-operable way to open the native file dialog.
 * Files are only ever read by the Rust backend on this device.
 */
export function DropZone({ onPick, label, hint }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)

  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onPick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onPick()
        }
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
      }}
      sx={(theme) => ({
        cursor: 'pointer',
        borderRadius: 3,
        border: '2px dashed',
        borderColor: dragging ? theme.palette.primary.main : theme.palette.divider,
        backgroundColor: dragging
          ? theme.palette.action.hover
          : theme.palette.background.paper,
        p: 4,
        textAlign: 'center',
      })}
    >
      <Typography variant="h6">{label}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {hint}
      </Typography>
      <Typography variant="body2" color="primary" fontWeight={600} sx={{ mt: 2 }}>
        Choose a file or drag one onto the window
      </Typography>
    </Box>
  )
}
