import { useCallback, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'

interface DropZoneProps {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  label: string
  hint: string
  inputId: string
}

/**
 * Drag-and-drop upload zone + file picker. Files are only ever read
 * with the File API on this device — nothing is uploaded.
 *
 * Keyboard: the zone is focusable (Tab) and Enter/Space opens the
 * file picker — the e2e suite asserts on this behaviour.
 */
export function DropZone({ onFiles, accept, multiple = true, label, hint, inputId }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setDragging(false)
      const files = Array.from(event.dataTransfer.files)
      if (files.length > 0) onFiles(files)
    },
    [onFiles],
  )

  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-describedby={`${inputId}-hint`}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      sx={{
        cursor: 'pointer',
        borderRadius: 3,
        border: 2,
        borderStyle: 'dashed',
        borderColor: dragging ? 'primary.main' : 'divider',
        bgcolor: dragging ? 'action.selected' : 'action.hover',
        p: 4,
        textAlign: 'center',
        transition: (theme) =>
          theme.transitions.create(['border-color', 'background-color'], {
            duration: theme.transitions.duration.short,
          }),
        '&:hover': { borderColor: 'text.secondary' },
      }}
    >
      <CloudUploadIcon color="primary" sx={{ fontSize: 40 }} />
      <Typography variant="h6" component="p" sx={{ mt: 1 }}>
        {label}
      </Typography>
      <Typography id={`${inputId}-hint`} variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {hint}
      </Typography>
      <Typography variant="body2" color="primary" fontWeight={600} sx={{ mt: 1.5 }}>
        Choose files or drag them here
      </Typography>
      <Box
        component="input"
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        aria-label={label}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) onFiles(files)
          event.target.value = ''
        }}
        sx={visuallyHidden}
      />
    </Box>
  )
}
