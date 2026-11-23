/**
 * OpenPixel Studio app shell (prompt §8): global header, sidebar
 * navigation, breadcrumbs, main content area, footer.
 *
 * One layout for every page. The sidebar groups are the honest
 * destinations from `lib/routes.ts` — no auth, no starred/shared
 * (no backend), no tools that do not exist. Tool nav items keep
 * their `tab-*` ids: the e2e suite clicks them exactly like the
 * old header tabs.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AppBar,
  Autocomplete,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  Link,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Snackbar,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import MenuIcon from '@mui/icons-material/Menu'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import LightModeIcon from '@mui/icons-material/LightMode'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined'
import InstallDesktopIcon from '@mui/icons-material/InstallDesktop'
import CloudOffIcon from '@mui/icons-material/CloudOff'
import HomeIcon from '@mui/icons-material/Home'
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import FolderIcon from '@mui/icons-material/Folder'
import HistoryIcon from '@mui/icons-material/History'
import GridViewIcon from '@mui/icons-material/GridView'
import ImageIcon from '@mui/icons-material/Image'
import PhotoSizeSelectLargeIcon from '@mui/icons-material/PhotoSizeSelectLarge'
import CropIcon from '@mui/icons-material/Crop'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import DocumentScannerIcon from '@mui/icons-material/DocumentScanner'
import LayersIcon from '@mui/icons-material/Layers'
import TableChartIcon from '@mui/icons-material/TableChart'
import SettingsIcon from '@mui/icons-material/Settings'
import GridOnIcon from '@mui/icons-material/GridOn'
import { NAV_GROUPS, ROUTE_TITLES, searchTools, type RouteId, type ToolEntry } from '../../lib/routes'
import { NotifyContext } from './notify'
import type { NavigateOpts } from './navigation'
import { CommandPalette } from '../CommandPalette'
import { detectFileFormat } from '../../lib/detect'
import { translate } from '../../lib/i18n'
import { useI18n } from '../../lib/use-i18n'
import { resolveTheme, saveSettings, type Settings } from '../../lib/settings'

const SIDEBAR_WIDTH = 248
const SIDEBAR_COLLAPSED_WIDTH = 72

const ICONS: Record<string, ReactNode> = {
  home: <HomeIcon />,
  dashboard: <DashboardOutlinedIcon />,
  folder: <FolderIcon />,
  history: <HistoryIcon />,
  grid: <GridViewIcon />,
  image: <ImageIcon />,
  resize: <PhotoSizeSelectLargeIcon />,
  crop: <CropIcon />,
  pdf: <PictureAsPdfIcon />,
  ocr: <DocumentScannerIcon />,
  batch: <LayersIcon />,
  formats: <TableChartIcon />,
  settings: <SettingsIcon />,
  help: <HelpOutlineIcon />,
}

interface AppShellProps {
  route: RouteId
  onNavigate: (route: RouteId, opts?: NavigateOpts) => void
  settings: Settings
  onSettingsChange: (next: Settings) => void
  children: ReactNode
}

function Logo({ onNavigate }: { onNavigate: (route: RouteId) => void }) {
  const { t } = useI18n()
  return (
    <Button
      onClick={() => onNavigate('home')}
      aria-label={t('header.logo')}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 1,
        px: 0.5,
        minWidth: 0,
        color: 'text.primary',
        textTransform: 'none',
        '&:hover': { backgroundColor: 'transparent' },
      }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: 2,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
        }}
      >
        <GridOnIcon fontSize="small" />
      </Box>
      <Typography
        variant="h6"
        component="span"
        sx={{ fontSize: '1.125rem', whiteSpace: 'nowrap', display: { xs: 'none', sm: 'block' } }}
      >
        OpenPixel{' '}
        <Box component="span" sx={{ color: 'primary.main' }}>
          Studio
        </Box>
      </Typography>
    </Button>
  )
}

export function AppShell({ route, onNavigate, settings, onSettingsChange, children }: AppShellProps) {
  const theme = useTheme()
  const { t, lang } = useI18n()
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'))
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('openpixel.sidebar.collapsed') === '1'
    } catch {
      return false
    }
  })
  const [snack, setSnack] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [searchValue, setSearchValue] = useState<ToolEntry | string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [offline, setOffline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  )
  const [installPrompt, setInstallPrompt] = useState<{
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  } | null>(null)

  // Listen for browser online/offline changes and PWA install prompt.
  useEffect(() => {
    const onOnline = () => setOffline(false)
    const onOffline = () => setOffline(true)
    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(
        e as unknown as {
          prompt: () => Promise<void>
          userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
        },
      )
    }
    const onInstalled = () => setInstallPrompt(null)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const triggerInstall = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setInstallPrompt(null)
  }

  // Global Ctrl+K / ⌘K shortcut opens the Command Palette from anywhere.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Global Ctrl+V clipboard paste: pasting an image or PDF anywhere in
  // the app loads it directly into the active compatible workspace, or
  // routes straight to Convert / Batch / PDF Tools. Pure text pastes
  // into inputs are untouched.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData
      if (!data) return
      const files: File[] = []
      if (data.files && data.files.length > 0) {
        files.push(...Array.from(data.files))
      } else if (data.items) {
        for (const item of Array.from(data.items)) {
          if (item.kind === 'file') {
            const f = item.getAsFile()
            if (f) files.push(f)
          }
        }
      }
      if (files.length === 0) return

      e.preventDefault()
      void (async () => {
        const first = files[0]
        const head = new Uint8Array(await first.slice(0, 5).arrayBuffer())
        const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46
        const displayName = first.name || (isPdf ? 'pasted.pdf' : 'pasted-image.png')

        if (isPdf) {
          const staysHere = route.startsWith('pdf-') && route !== 'pdf-images-to-pdf'
          const target: RouteId = staysHere ? route : 'pdf'
          onNavigate(target, { files: [first] })
          setSnack(
            staysHere
              ? t('paste.loaded', { name: displayName })
              : t('paste.loadedIn', { name: displayName, tool: ROUTE_TITLES[target].title }),
          )
          return
        }

        const detected = first.type.startsWith('image/') ? first.type : await detectFileFormat(first)
        if (detected !== 'unknown') {
          const imageRoutes: RouteId[] = ['convert', 'resize', 'crop', 'batch', 'ocr', 'pdf-images-to-pdf']
          const staysHere = imageRoutes.includes(route)
          const target: RouteId = staysHere ? route : files.length > 1 ? 'batch' : 'convert'
          onNavigate(target, { files })
          setSnack(
            staysHere
              ? t('paste.loaded', { name: displayName })
              : t('paste.loadedIn', { name: displayName, tool: ROUTE_TITLES[target].title }),
          )
          return
        }

        setSnack(t('paste.unsupported'))
      })()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [route, onNavigate, t])

  const mode = resolveTheme(settings.theme)
  const isDark = mode === 'dark'
  const themeLabel = isDark ? t('header.themeToLight') : t('header.themeToDark')

  const toggleTheme = () => {
    const next: Settings = {
      ...settings,
      theme: resolveTheme(settings.theme) === 'dark' ? 'light' : 'dark',
    }
    onSettingsChange(next)
    saveSettings(next)
  }

  const toggleLanguage = () => {
    const next: Settings = { ...settings, language: settings.language === 'bn' ? 'en' : 'bn' }
    onSettingsChange(next)
    saveSettings(next)
  }

  /** Sidebar label for a nav item — translated, tool names stay English. */
  const navLabel = (itemRoute: RouteId) => translate(lang, `nav.${itemRoute}`)
  const groupLabel = (label: string) =>
    label === 'Tools'
      ? t('navGroup.tools')
      : label === 'Activity'
        ? t('navGroup.activity')
        : label === 'More'
          ? t('navGroup.more')
          : t('navGroup.workspace')
  /** Breadcrumb / page title for a route — generic pages translate, PDF tool pages keep their English tool name. */
  const routeLabel = (r: RouteId) => (r.startsWith('pdf-') ? ROUTE_TITLES[r].crumb : translate(lang, `nav.${r}`))

  const setCollapsedAndSave = (next: boolean) => {
    setCollapsed(next)
    try {
      localStorage.setItem('openpixel.sidebar.collapsed', next ? '1' : '0')
    } catch {
      // ignore
    }
  }

  const go = (next: RouteId) => {
    setMobileOpen(false)
    onNavigate(next)
  }

  const searchOptions = useMemo(() => searchTools(searchInput, lang), [searchInput, lang])

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH

  // Desktop (lg+): lock the entire Studio shell to 100dvh so the
  // outer page NEVER scrolls on PC — header, sidebar, breadcrumbs and
  // workspace stay in view like a native desktop app. Mobile/tablet
  // keeps natural document scrolling.
  const fitViewport = isDesktop
  const isPdfWorkspace = route.startsWith('pdf-')

  const sidebar = (
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
          onClick={() => setCollapsedAndSave(!collapsed)}
          aria-label={collapsed ? t('header.expandSidebar') : t('header.collapseSidebar')}
          size="small"
        >
          {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </IconButton>
      </Box>
      <Divider />
      <List sx={{ flex: 1, overflowY: 'auto', py: 0.5 }} aria-label={t('shell.navAria')}>
        {NAV_GROUPS.map((group) => (
          <Box key={group.label}>
            {!collapsed && (
              <ListSubheader
                component="div"
                sx={{ bgcolor: 'transparent', lineHeight: '26px', fontSize: '0.72rem', mt: 0.5 }}
              >
                {groupLabel(group.label)}
              </ListSubheader>
            )}
            {group.items.map((item) => {
              // A PDF tool page (e.g. /pdf/merge) still selects the
              // "PDF Tools" sidebar item — it is a PDF page.
              const selected = route === item.route || (item.route === 'pdf' && route.startsWith('pdf-'))
              const button = (
                <ListItemButton
                  key={item.route}
                  id={item.tabId}
                  aria-controls={item.tabId ? `panel-${item.route}` : undefined}
                  aria-current={selected ? 'page' : undefined}
                  selected={selected}
                  onClick={() => go(item.route)}
                  sx={collapsed ? { justifyContent: 'center', px: 0 } : undefined}
                >
                  <ListItemIcon sx={collapsed ? { minWidth: 0 } : undefined}>{ICONS[item.icon]}</ListItemIcon>
                  {!collapsed && <ListItemText primary={navLabel(item.route)} primaryTypographyProps={{ fontSize: '0.875rem' }} />}
                </ListItemButton>
              )
              return collapsed ? (
                <Tooltip key={item.route} title={navLabel(item.route)} placement="right">
                  {button}
                </Tooltip>
              ) : (
                button
              )
            })}
          </Box>
        ))}
      </List>
    </Box>
  )

  // One tool = one page: a PDF tool page crumbs as
  // Home / Tools / PDF Tools / <tool>.
  const isPdfTool = route !== 'pdf' && route.startsWith('pdf-')
  const crumbs =
    route === 'home'
      ? []
      : [
          { label: t('nav.home'), route: 'home' as RouteId },
          ...(route === 'convert' || route === 'resize' || route === 'crop' || route === 'pdf' || route === 'ocr' || route === 'batch' || isPdfTool
            ? [{ label: t('crumb.tools'), route: 'tools' as RouteId }]
            : []),
          ...(isPdfTool ? [{ label: t('crumb.pdfTools'), route: 'pdf' as RouteId }] : []),
          { label: routeLabel(route), route },
        ].filter((c, i, all) => !(i === all.length - 1 && all.length > 1 && c.label === all[0].label))

  return (
    <NotifyContext.Provider value={(message) => setSnack(message)}>
      <CssBaseline />
      <Box
        sx={{
          display: 'flex',
          // 100vh first, 100dvh where supported (MUI arrays are
          // CSS fallback values).
          height: fitViewport ? ['100vh', '100dvh'] : undefined,
          minHeight: '100vh',
          overflow: fitViewport ? 'hidden' : undefined,
        }}
      >
        {isDesktop ? (
          <Drawer
            variant="permanent"
            sx={{
              width: sidebarWidth,
              flexShrink: 0,
              '& .MuiDrawer-paper': { width: sidebarWidth, boxSizing: 'border-box' },
            }}
          >
            {sidebar}
          </Drawer>
        ) : (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{ '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, boxSizing: 'border-box' } }}
          >
            {sidebar}
          </Drawer>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: fitViewport ? 0 : undefined }}>
          <AppBar position="sticky" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
            <Toolbar variant="dense" sx={{ minHeight: 56, gap: 1, px: { xs: 1.5, md: 3 } }}>
              {!isDesktop && (
                <IconButton
                  edge="start"
                  color="inherit"
                  aria-label={t('header.navMenu')}
                  onClick={() => setMobileOpen(true)}
                >
                  <MenuIcon />
                </IconButton>
              )}
              <Logo onNavigate={onNavigate} />
              <Box sx={{ flex: 1 }} />
              <Autocomplete<ToolEntry, false, false, true>
                freeSolo
                options={searchOptions}
                getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
                value={searchValue}
                inputValue={searchInput}
                onInputChange={(_, value) => setSearchInput(value)}
                onChange={(_, value) => {
                  if (value && typeof value !== 'string') {
                    if (value.status === 'web' && value.route) onNavigate(value.route)
                    else onNavigate('tools', { toolsQuery: value.name })
                    setSearchValue(null)
                    setSearchInput('')
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchInput.trim()) {
                    onNavigate('tools', { toolsQuery: searchInput.trim() })
                    setSearchInput('')
                  }
                }}
                renderOption={(props, option) => (
                  <li {...props} key={option.id}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', py: 0.5 }}>
                      <Typography variant="body2">{option.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {option.status === 'web'
                          ? t('header.searchAvailable')
                          : option.status === 'cli-only'
                            ? t('header.searchCliOnly')
                            : t('header.searchComingSoon')}
                      </Typography>
                    </Box>
                  </li>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    placeholder={t('header.searchPlaceholder')}
                    // The bare aria-label prop lands on the TextField
                    // root, not the <input> — merge it into
                    // params.inputProps so the real input carries it.
                    inputProps={{ ...params.inputProps, 'aria-label': t('header.searchTools') }}
                    sx={{
                      width: { xs: 140, sm: 220, md: 320 },
                      display: { xs: 'none', sm: 'block' },
                      '& .MuiOutlinedInput-root': { minHeight: 40, bgcolor: 'background.default' },
                    }}
                  />
                )}
              />
              <IconButton
                aria-label={t('header.searchTools')}
                sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
                onClick={() => onNavigate('tools')}
              >
                <GridViewIcon />
              </IconButton>
              <Tooltip title={t('cmd.openPalette')}>
                <Button
                  type="button"
                  size="small"
                  variant="outlined"
                  onClick={() => setPaletteOpen(true)}
                  aria-label={t('cmd.openPalette')}
                  sx={{
                    display: { xs: 'none', sm: 'inline-flex' },
                    minWidth: 0,
                    px: 1,
                    py: 0.5,
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    color: 'text.secondary',
                    borderColor: 'divider',
                  }}
                >
                  Ctrl K
                </Button>
              </Tooltip>
              {installPrompt && (
                <Tooltip title={t('pwa.installTip')}>
                  <Button
                    type="button"
                    size="small"
                    variant="outlined"
                    color="primary"
                    startIcon={<InstallDesktopIcon sx={{ fontSize: 16 }} />}
                    onClick={() => void triggerInstall()}
                    sx={{ display: { xs: 'none', sm: 'inline-flex' }, px: 1.25, py: 0.5 }}
                  >
                    {t('pwa.install')}
                  </Button>
                </Tooltip>
              )}
              <Tooltip title={offline ? t('pwa.offlineTip') : t('header.localBadgeTip')}>
                <Chip
                  icon={offline ? <CloudOffIcon sx={{ fontSize: 16 }} /> : <ShieldOutlinedIcon sx={{ fontSize: 16 }} />}
                  label={offline ? t('pwa.offlineBadge') : t('header.localBadge')}
                  size="small"
                  sx={{
                    display: { xs: 'none', md: 'inline-flex' },
                    bgcolor: (th) => alpha(offline ? th.palette.info.main : th.palette.success.main, 0.1),
                    color: offline ? 'info.main' : 'success.main',
                    border: 1,
                    borderColor: (th) => alpha(offline ? th.palette.info.main : th.palette.success.main, 0.25),
                    '& .MuiChip-icon': { color: offline ? 'info.main' : 'success.main' },
                  }}
                />
              </Tooltip>
              <Button
                type="button"
                id="language-toggle"
                onClick={toggleLanguage}
                aria-label={lang === 'bn' ? t('header.languageToEn') : t('header.languageToBn')}
                title={lang === 'bn' ? t('header.languageToEn') : t('header.languageToBn')}
                sx={{ minWidth: 40, color: 'inherit', fontWeight: 600 }}
              >
                {lang === 'bn' ? 'EN' : 'বাং'}
              </Button>
              <IconButton type="button" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}>
                {isDark ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
              <IconButton aria-label={t('header.help')} title={t('header.help')} onClick={() => go('help')}>
                <HelpOutlineIcon />
              </IconButton>
            </Toolbar>
          </AppBar>

          <Box
            component="main"
            sx={{
              flex: 1,
              minHeight: fitViewport ? 0 : undefined,
              overflow: fitViewport ? 'hidden' : undefined,
              display: fitViewport ? 'flex' : undefined,
              flexDirection: 'column',
              width: '100%',
              maxWidth: 1440,
              mx: 'auto',
              px: { xs: 2, md: 3 },
              py: fitViewport ? 1.5 : 2,
            }}
          >
            {crumbs.length > 0 && (
              <Breadcrumbs aria-label={t('shell.crumbAria')} sx={{ mb: fitViewport ? 1 : 2, flex: 'none' }}>
                {crumbs.map((c, i) =>
                  i === crumbs.length - 1 ? (
                    <Typography
                      key={c.route}
                      color="text.primary"
                      variant="body2"
                      sx={{ minHeight: 22, display: 'inline-flex', alignItems: 'center' }}
                    >
                      {c.label}
                    </Typography>
                  ) : (
                    <Link
                      key={c.route}
                      component="button"
                      variant="body2"
                      underline="hover"
                      onClick={() => onNavigate(c.route)}
                      sx={{ minHeight: 22, py: 0, display: 'inline-flex', alignItems: 'center' }}
                    >
                      {c.label}
                    </Link>
                  ),
                )}
              </Breadcrumbs>
            )}
            <Box
              role="tabpanel"
              id={`panel-${route}`}
              aria-labelledby={NAV_GROUPS.flatMap((g) => g.items).find((i) => i.route === route)?.tabId ?? `nav-${route}`}
              sx={{
                flex: fitViewport ? 1 : undefined,
                minHeight: fitViewport ? 0 : undefined,
                display: fitViewport ? 'flex' : undefined,
                flexDirection: 'column',
                overflowY: fitViewport ? (isPdfWorkspace ? 'hidden' : 'auto') : undefined,
              }}
            >
              {children}
            </Box>
          </Box>

          {/* Slim status-bar footer on desktop (hidden on PDF workspaces). */}
          {!(isPdfWorkspace && isDesktop) && (
            <Box
              component="footer"
              sx={{
                flex: 'none',
                borderTop: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper',
                px: { xs: 2, md: 3 },
                py: 1,
              }}
            >
              <Box
                sx={{
                  maxWidth: 1440,
                  mx: 'auto',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2,
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {t('footer.copyright')} · {t('footer.localNote')}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
                  <Link component="button" variant="caption" underline="hover" color="text.secondary" onClick={() => onNavigate('tools')}>
                    {t('nav.tools')}
                  </Link>
                  <Link component="button" variant="caption" underline="hover" color="text.secondary" onClick={() => onNavigate('formats')}>
                    {t('nav.formats')}
                  </Link>
                  <Link component="button" variant="caption" underline="hover" color="text.secondary" onClick={() => onNavigate('settings')}>
                    {t('nav.settings')}
                  </Link>
                  <Link component="button" variant="caption" underline="hover" color="text.secondary" onClick={() => onNavigate('help')}>
                    {t('nav.help')}
                  </Link>
                  <Link
                    variant="caption"
                    underline="hover"
                    color="text.secondary"
                    href="https://github.com/rajuofficialasf-hub/openpixel"
                    target="_blank"
                    rel="noreferrer"
                  >
                    GitHub
                  </Link>
                </Box>
              </Box>
            </Box>
          )}
        </Box>
      </Box>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(next, opts) => {
          setMobileOpen(false)
          onNavigate(next, opts)
        }}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onToggleLanguage={toggleLanguage}
      />
      <Snackbar
        open={Boolean(snack)}
        autoHideDuration={3000}
        onClose={() => setSnack('')}
        message={snack}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </NotifyContext.Provider>
  )
}
