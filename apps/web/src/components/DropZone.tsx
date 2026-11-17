import { useCallback, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { visuallyHidden } from '@mui/utils'
import { useI18n } from '../lib/i18n-context'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'

interface DropZoneProps {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  label: string
  hint: string
  inputId: string
  /** Smaller padding/icon so the zone fits a viewport-height
      workspace (the PDF page uses it) — same content, less air. */
  compact?: boolean
}

/**
 * Drag-and-drop upload zone + file picker. Files are only ever read
 * with the File API on this device — nothing is uploaded.
 *
 * Keyboard: the zone is focusable (Tab) and Enter/Space opens the
 * file picker — the e2e suite asserts on this behaviour.
 */
export function DropZone({ onFiles, accept, multiple = true, label, hint, inputId, compact = false }: DropZoneProps) {
  const { t } = useI18n()
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
        position: 'relative',
        cursor: 'pointer',
        borderRadius: 4,
        border: '1.5px dashed',
        borderColor: dragging ? 'primary.main' : 'divider',
        bgcolor: dragging ? (t) => alpha(t.palette.primary.main, 0.06) : 'background.paper',
        p: compact ? 3 : 5,
        textAlign: 'center',
        transition: (theme) =>
          theme.transitions.create(['border-color', 'background-color'], {
            duration: theme.transitions.duration.short,
          }),
        '&:hover': { borderColor: 'text.secondary' },
      }}
    >
      <Box
        sx={{
          mx: 'auto',
          width: compact ? 48 : 64,
          height: compact ? 48 : 64,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: (t) => alpha(t.palette.primary.main, 0.08),
        }}
      >
        <CloudUploadIcon color="primary" sx={{ fontSize: compact ? 24 : 32 }} />
      </Box>
      <Typography variant="h6" component="p" sx={{ mt: compact ? 1.5 : 2 }}>
        {label}
      </Typography>
      <Typography id={`${inputId}-hint`} variant="body2" color="text.secondary" sx={{ mt: compact ? 0.5 : 1 }}>
        {hint}
      </Typography>
      <Typography variant="body2" color="primary" fontWeight={600} sx={{ mt: compact ? 1.5 : 2 }}>
        {t('common.chooseFiles')}
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
