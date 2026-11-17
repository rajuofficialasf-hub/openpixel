import { Alert, Box, Button, Paper, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { fetchLogs, type LogView } from '../lib/tauri'

/**
 * Application log view. The backend appends every conversion, batch
 * event and error to a file in the app data directory
 * (`<app_data_dir>/logs/openpixel-desktop.log`); this tab shows the
 * tail of that file and its path, so a failure can be diagnosed
 * without opening a terminal.
 */
export function LogsView() {
  const [view, setView] = useState<LogView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setView(await fetchLogs(200))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Conversions, batch events and errors are logged to a file in the app data directory.
        </Typography>
        <Button type="button" variant="outlined" onClick={() => void refresh()}>
          Refresh
        </Button>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {view && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
            {view.path}
          </Typography>
          <Paper
            component="pre"
            sx={{
              maxHeight: '28rem',
              overflow: 'auto',
              p: 2,
              fontSize: '0.75rem',
              lineHeight: 1.6,
              backgroundColor: '#0B1020',
              color: '#F1F5FB',
              margin: 0,
            }}
          >
            {view.lines.length > 0 ? view.lines.join('\n') : '(log is empty — convert something first)'}
          </Paper>
        </>
      )}
    </Box>
  )
}
