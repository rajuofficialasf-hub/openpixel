import { listen } from '@tauri-apps/api/event'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import GridOnIcon from '@mui/icons-material/GridOn'
import ImageIcon from '@mui/icons-material/Image'
import LayersIcon from '@mui/icons-material/Layers'
import LightModeIcon from '@mui/icons-material/LightMode'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import SettingsIcon from '@mui/icons-material/Settings'
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined'
import TableChartIcon from '@mui/icons-material/TableChart'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  ThemeProvider,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BatchWorkspace } from './components/BatchWorkspace'
import { CapabilitiesTable } from './components/CapabilitiesTable'
import { ConvertWorkspace } from './components/ConvertWorkspace'
import { LogsView } from './components/LogsView'
import { PdfWorkspace } from './components/pdf/PdfWorkspace'
import { SettingsPanel } from './components/SettingsPanel'
import { dt } from './lib/i18n'
import { loadSettings, resolveTheme, saveSettings, type Settings } from './lib/settings'
import { fetchAppInfo, fetchCapabilities, type AppInfo, type FormatCapability } from './lib/tauri'
import { getTheme } from './theme/theme'

type TabId = 'convert' | 'batch' | 'pdf' | 'formats' | 'settings' | 'logs'

const SIDEBAR_WIDTH = 232
const SIDEBAR_COLLAPSED = 68

const NAV_GROUPS: { titleKey: string; items: { id: TabId; labelKey: string; icon: ReactNode }[] }[] = [
  {
    titleKey: 'group.tools',
    items: [
      { id: 'convert', labelKey: 'nav.convert', icon: <ImageIcon /> },
      { id: 'batch', labelKey: 'nav.batch', icon: <LayersIcon /> },
      { id: 'pdf', labelKey: 'nav.pdf', icon: <PictureAsPdfIcon /> },
    ],
  },
  {
    titleKey: 'group.app',
    items: [
      { id: 'formats', labelKey: 'nav.formats', icon: <TableChartIcon /> },
      { id: 'settings', labelKey: 'nav.settings', icon: <SettingsIcon /> },
      { id: 'logs', labelKey: 'nav.logs', icon: <ReceiptLongIcon /> },
    ],
  },
]

function App() {
  const [tab, setTab] = useState<TabId>('convert')
  const [collapsed, setCollapsed] = useState(false)
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [capabilities, setCapabilities] = useState<FormatCapability[] | null>(null)
  const [capsError, setCapsError] = useState<string | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [droppedPaths, setDroppedPaths] = useState<string[]>([])

  const mode = resolveTheme(settings.theme)
  const lang = settings.language
  const theme = useMemo(() => getTheme(mode), [mode])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark')
    document.documentElement.lang = lang
    saveSettings(settings)
  }, [settings, mode, lang])

  useEffect(() => {
    void fetchCapabilities()
      .then(setCapabilities)
      .catch((e: unknown) => setCapsError(e instanceof Error ? e.message : String(e)))
    void fetchAppInfo()
      .then(setAppInfo)
      .catch(() => undefined)
  }, [])

  // Native drag-and-drop onto the window: Tauri emits `tauri://drag-drop`.
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

  const toggleLanguage = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      language: prev.language === 'bn' ? 'en' : 'bn',
    }))
  }, [])

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH
  const themeLabel = mode === 'dark' ? dt(lang, 'header.toLight') : dt(lang, 'header.toDark')

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          display: 'flex',
          height: ['100vh', '100dvh'],
          overflow: 'hidden',
        }}
      >
        <Drawer
          variant="permanent"
          sx={{
            width: sidebarWidth,
            flexShrink: 0,
            '& .MuiDrawer-paper': { width: sidebarWidth, boxSizing: 'border-box' },
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-end',
                px: 1,
                minHeight: 56,
              }}
            >
              <IconButton
                size="small"
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? dt(lang, 'header.expand') : dt(lang, 'header.collapse')}
              >
                {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
              </IconButton>
            </Box>
            <Divider />
            <List sx={{ flex: 1, overflowY: 'auto', py: 0.5 }} role="tablist" aria-label="OpenPixel sections">
              {NAV_GROUPS.map((group) => (
                <Box key={group.titleKey}>
                  {!collapsed && (
                    <ListSubheader component="div" sx={{ bgcolor: 'transparent', lineHeight: '28px', fontSize: '0.72rem', mt: 0.5 }}>
                      {dt(lang, group.titleKey)}
                    </ListSubheader>
                  )}
                  {group.items.map((item) => {
                    const selected = tab === item.id
                    const label = dt(lang, item.labelKey)
                    const btn = (
                      <ListItemButton
                        key={item.id}
                        id={`tab-${item.id}`}
                        role="tab"
                        aria-selected={selected}
                        aria-controls={`panel-${item.id}`}
                        selected={selected}
                        onClick={() => setTab(item.id)}
                        sx={collapsed ? { justifyContent: 'center', px: 0 } : undefined}
                      >
                        <ListItemIcon sx={collapsed ? { minWidth: 0 } : undefined}>{item.icon}</ListItemIcon>
                        {!collapsed && <ListItemText primary={label} primaryTypographyProps={{ fontSize: '0.875rem' }} />}
                      </ListItemButton>
                    )
                    return collapsed ? (
                      <Tooltip key={item.id} title={label} placement="right">
                        {btn}
                      </Tooltip>
                    ) : (
                      btn
                    )
                  })}
                </Box>
              ))}
            </List>
          </Box>
        </Drawer>

        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
          <AppBar position="sticky">
            <Toolbar variant="dense" sx={{ minHeight: 56, gap: 1, px: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                  sx={{
                    width: 30,
                    height: 30,
                    borderRadius: 2,
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <GridOnIcon fontSize="small" />
                </Box>
                <Typography variant="h6" component="h1" sx={{ fontSize: '1.05rem', fontWeight: 600 }}>
                  OpenPixel{' '}
                  <Box component="span" sx={{ color: 'primary.main' }}>
                    Studio
                  </Box>
                </Typography>
              </Box>
              <Box sx={{ flex: 1 }} />
              <Tooltip title={dt(lang, 'header.offlineTip')}>
                <Chip
                  size="small"
                  icon={<ShieldOutlinedIcon sx={{ fontSize: 16 }} />}
                  label={dt(lang, 'header.offline')}
                  sx={{
                    bgcolor: (th) => alpha(th.palette.success.main, 0.1),
                    color: 'success.main',
                    border: 1,
                    borderColor: (th) => alpha(th.palette.success.main, 0.25),
                    '& .MuiChip-icon': { color: 'success.main' },
                  }}
                />
              </Tooltip>
              <Button
                type="button"
                size="small"
                onClick={toggleLanguage}
                aria-label={lang === 'bn' ? dt(lang, 'header.toEn') : dt(lang, 'header.toBn')}
                sx={{ minWidth: 40, color: 'inherit', fontWeight: 600 }}
              >
                {lang === 'bn' ? 'EN' : 'বাং'}
              </Button>
              <IconButton type="button" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}>
                {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
            </Toolbar>
          </AppBar>

          <Box
            component="main"
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              px: 3,
              py: 2,
              maxWidth: 1440,
              width: '100%',
              mx: 'auto',
            }}
          >
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
          </Box>

          <Box
            component="footer"
            sx={{
              flex: 'none',
              borderTop: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              px: 3,
              py: 0.75,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 1,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {dt(lang, 'footer.native')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {appInfo ? `App ${appInfo.version} · Engine ${appInfo.engine_version} · ` : ''}
              {capabilities ? `${capabilities.length} formats` : ''}
            </Typography>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default App
