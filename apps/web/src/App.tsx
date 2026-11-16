import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Button, Container, CssBaseline, Tab, Tabs, Typography } from '@mui/material'
import { alpha, ThemeProvider } from '@mui/material/styles'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import LightModeIcon from '@mui/icons-material/LightMode'
import { BatchWorkspace } from './components/BatchWorkspace'
import { CapabilitiesTable } from './components/CapabilitiesTable'
import { ConvertWorkspace } from './components/ConvertWorkspace'
import { OcrWorkspace } from './components/OcrWorkspace'
import { PdfWorkspace } from './components/PdfWorkspace'
import { ResizeWorkspace } from './components/ResizeWorkspace'
import { SettingsPanel } from './components/SettingsPanel'
import { loadSettings, resolveTheme, saveSettings, type Settings } from './lib/settings'
import { getTheme } from './theme/theme'

// Lazy: the 3D backdrop is decoration — it must never block first
// paint. The chunk loads only when the setting is on.
const Background3D = lazy(() => import('./components/Background3D'))

type TabId = 'convert' | 'resize' | 'pdf' | 'ocr' | 'batch' | 'formats' | 'settings'

const TABS: { id: TabId; label: string }[] = [
  { id: 'convert', label: 'Convert' },
  { id: 'resize', label: 'Resize' },
  { id: 'pdf', label: 'PDF' },
  { id: 'ocr', label: 'OCR' },
  { id: 'batch', label: 'Batch' },
  { id: 'formats', label: 'Formats' },
  { id: 'settings', label: 'Settings' },
]

function App() {
  const [tab, setTab] = useState<TabId>('convert')
  const [settings, setSettings] = useState<Settings>(() => loadSettings())

  const mode = resolveTheme(settings.theme)
  const theme = useMemo(() => getTheme(mode), [mode])

  useEffect(() => {
    // The `dark` class is kept for the e2e suite (it asserts on
    // `documentElement.classList.contains('dark')`); the MUI theme
    // itself does not need it.
    document.documentElement.classList.toggle('dark', mode === 'dark')
    saveSettings(settings)
  }, [settings, mode])

  const toggleTheme = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      theme: resolveTheme(prev.theme) === 'dark' ? 'light' : 'dark',
    }))
  }, [])

  const isDark = mode === 'dark'
  const themeLabel = isDark ? 'Switch to light theme' : 'Switch to dark theme'

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {settings.show3dBackground && (
        <Suspense fallback={null}>
          <Background3D />
        </Suspense>
      )}
      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box
          component="header"
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: (t) => alpha(t.palette.background.paper, 0.85),
            backdropFilter: 'blur(10px)',
          }}
        >
          <Container maxWidth="lg">
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
                py: 2,
              }}
            >
              <Box>
                <Typography variant="h5" component="h1">
                  OpenPixel
                  <Box component="span" sx={{ color: 'secondary.main' }}>
                    .
                  </Box>
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Local image conversion — files never leave your device.
                </Typography>
              </Box>
              <Button
                type="button"
                variant="outlined"
                onClick={toggleTheme}
                aria-label={themeLabel}
                startIcon={isDark ? <LightModeIcon /> : <DarkModeIcon />}
              >
                {isDark ? 'Light' : 'Dark'}
              </Button>
            </Box>
            <Tabs
              value={tab}
              onChange={(_, value: TabId) => setTab(value)}
              aria-label="OpenPixel sections"
              sx={{ mt: 1 }}
            >
              {TABS.map((t) => (
                <Tab key={t.id} value={t.id} label={t.label} id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} />
              ))}
            </Tabs>
          </Container>
        </Box>

        <Container component="main" maxWidth="lg" sx={{ py: 4, flex: 1, width: '100%' }}>
          <Box role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'convert' && (
              <ConvertWorkspace settings={settings} onSettingsChange={setSettings} />
            )}
            {tab === 'resize' && (
              <ResizeWorkspace settings={settings} onSettingsChange={setSettings} />
            )}
            {tab === 'pdf' && <PdfWorkspace />}
            {tab === 'ocr' && <OcrWorkspace />}
            {tab === 'batch' && <BatchWorkspace settings={settings} />}
            {tab === 'formats' && <CapabilitiesTable />}
            {tab === 'settings' && <SettingsPanel settings={settings} onSettingsChange={setSettings} />}
          </Box>
        </Container>

        <Box
          component="footer"
          sx={{
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: (t) => alpha(t.palette.background.paper, 0.85),
            backdropFilter: 'blur(10px)',
            px: 2,
            py: 2,
            textAlign: 'center',
          }}
        >
          <Typography variant="caption" color="text.secondary" component="p">
            OpenPixel Engine — local processing. No server, no upload, no account.
          </Typography>
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default App
