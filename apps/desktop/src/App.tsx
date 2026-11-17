import { listen } from '@tauri-apps/api/event'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import LightModeIcon from '@mui/icons-material/LightMode'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  CssBaseline,
  Tab,
  Tabs,
  ThemeProvider,
  Toolbar,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BatchWorkspace } from './components/BatchWorkspace'
import { CapabilitiesTable } from './components/CapabilitiesTable'
import { ConvertWorkspace } from './components/ConvertWorkspace'
import { LogsView } from './components/LogsView'
import { PdfWorkspace } from './components/pdf/PdfWorkspace'
import { SettingsPanel } from './components/SettingsPanel'
import { loadSettings, resolveTheme, saveSettings, type Settings } from './lib/settings'
import { fetchAppInfo, fetchCapabilities, type AppInfo, type FormatCapability } from './lib/tauri'
import { getTheme } from './theme/theme'

type TabId = 'convert' | 'batch' | 'pdf' | 'formats' | 'settings' | 'logs'

const TABS: { id: TabId; label: string }[] = [
  { id: 'convert', label: 'Convert' },
  { id: 'batch', label: 'Batch' },
  { id: 'pdf', label: 'PDF' },
  { id: 'formats', label: 'Formats' },
  { id: 'settings', label: 'Settings' },
  { id: 'logs', label: 'Logs' },
]

function App() {
  const [tab, setTab] = useState<TabId>('convert')
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [capabilities, setCapabilities] = useState<FormatCapability[] | null>(null)
  const [capsError, setCapsError] = useState<string | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [droppedPaths, setDroppedPaths] = useState<string[]>([])

  const mode = resolveTheme(settings.theme)
  const theme = useMemo(() => getTheme(mode), [mode])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark')
    saveSettings(settings)
  }, [settings, mode])

  useEffect(() => {
    void fetchCapabilities()
      .then(setCapabilities)
      .catch((e: unknown) => setCapsError(e instanceof Error ? e.message : String(e)))
    void fetchAppInfo()
      .then(setAppInfo)
      .catch(() => undefined)
  }, [])

  // Native drag-and-drop onto the window: Tauri emits
  // `tauri://drag-drop` with the dropped file paths. The active
  // workspace consumes them (Convert takes the first, Batch takes all).
  useEffect(() => {
    let unlisten: (() => void) | undefined
    void listen<{ type?: string; paths?: string[] }>('tauri://drag-drop', (event) => {
      if (event.payload.type === 'drop' && event.payload.paths && event.payload.paths.length > 0) {
        setDroppedPaths(event.payload.paths)
      }
    }).then((fn) => {
      unlisten = fn
    })
    return () => unlisten?.()
  }, [])

  const clearDropped = useCallback(() => setDroppedPaths([]), [])

  const toggleTheme = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      theme: resolveTheme(prev.theme) === 'dark' ? 'light' : 'dark',
    }))
  }, [])

  const themeLabel = mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <AppBar position="static" color="default">
          <Toolbar sx={{ flexWrap: 'wrap', gap: 2 }}>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h6" component="h1">
                OpenPixel
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Local image conversion — files never leave your device.
              </Typography>
            </Box>
            <Chip
              label="● Offline"
              color="success"
              title="No server, no uploads, no account — everything runs on this machine."
            />
            <Button
              type="button"
              variant="outlined"
              onClick={toggleTheme}
              aria-label={themeLabel}
              startIcon={mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            >
              {mode === 'dark' ? 'Light' : 'Dark'}
            </Button>
          </Toolbar>
          <Box sx={{ px: 2 }}>
            <Tabs
              value={tab}
              onChange={(_e, value: TabId) => setTab(value)}
              aria-label="OpenPixel sections"
              role="tablist"
            >
              {TABS.map((t) => (
                <Tab
                  key={t.id}
                  value={t.id}
                  label={t.label}
                  id={`tab-${t.id}`}
                  aria-controls={`panel-${t.id}`}
                />
              ))}
            </Tabs>
          </Box>
        </AppBar>

        <Container maxWidth="lg" sx={{ py: 3, flexGrow: 1 }} component="main">
          {capsError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Could not reach the engine backend: {capsError}. The app cannot convert without it —
              try restarting OpenPixel.
            </Alert>
          )}
          {capabilities === null && !capsError && (
            <Typography role="status" variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Loading format capabilities from the engine…
            </Typography>
          )}
          {capabilities !== null && (
            <Box role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === 'convert' && (
                <ConvertWorkspace
                  capabilities={capabilities}
                  settings={settings}
                  droppedPaths={droppedPaths}
                  onDroppedConsumed={clearDropped}
                />
              )}
              {tab === 'batch' && (
                <BatchWorkspace
                  capabilities={capabilities}
                  settings={settings}
                  droppedPaths={droppedPaths}
                  onDroppedConsumed={clearDropped}
                />
              )}
              {tab === 'pdf' && <PdfWorkspace droppedPaths={droppedPaths} onDroppedConsumed={clearDropped} />}
              {tab === 'formats' && <CapabilitiesTable capabilities={capabilities} />}
              {tab === 'settings' && (
                <SettingsPanel
                  settings={settings}
                  onSettingsChange={setSettings}
                  capabilities={capabilities}
                  appInfo={appInfo}
                />
              )}
              {tab === 'logs' && <LogsView />}
            </Box>
          )}
        </Container>

        <Box
          component="footer"
          sx={{
            borderTop: 1,
            borderColor: 'divider',
            px: 2,
            py: 2,
            textAlign: 'center',
          }}
        >
          <Typography variant="caption" color="text.secondary" display="block">
            OpenPixel Engine — desktop app (Tauri 2 + native Rust engine). No server, no upload, no
            account. {appInfo ? `App ${appInfo.version} · engine ${appInfo.engine_version} · ` : ''}
            {capabilities ? `${capabilities.length} formats known.` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Full conversion (TIFF, AVIF, JXL, SVG, EXR, HDR, JPEG 2000, TGA, ICO, PNM, QOI) runs in
            this app — the web app only does PNG / JPEG / WebP / BMP in the browser.
          </Typography>
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default App
