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
import { useMemo, useState, type ReactNode } from 'react'
import {
  AppBar,
  Autocomplete,
  Box,
  Breadcrumbs,
  Button,
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
  Menu,
  MenuItem,
  Snackbar,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import MenuIcon from '@mui/icons-material/Menu'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import LightModeIcon from '@mui/icons-material/LightMode'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import HomeIcon from '@mui/icons-material/Home'
import FolderIcon from '@mui/icons-material/Folder'
import HistoryIcon from '@mui/icons-material/History'
import GridViewIcon from '@mui/icons-material/GridView'
import ImageIcon from '@mui/icons-material/Image'
import PhotoSizeSelectLargeIcon from '@mui/icons-material/PhotoSizeSelectLarge'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import DocumentScannerIcon from '@mui/icons-material/DocumentScanner'
import LayersIcon from '@mui/icons-material/Layers'
import TableChartIcon from '@mui/icons-material/TableChart'
import SettingsIcon from '@mui/icons-material/Settings'
import GridOnIcon from '@mui/icons-material/GridOn'
import { NAV_GROUPS, ROUTE_TITLES, searchTools, type RouteId, type ToolEntry } from '../../lib/routes'
import { NotifyContext } from './notify'
import { translate } from '../../lib/i18n'
import { useI18n } from '../../lib/use-i18n'
import { resolveTheme, saveSettings, type Settings } from '../../lib/settings'

const SIDEBAR_WIDTH = 248
const SIDEBAR_COLLAPSED_WIDTH = 72

const ICONS: Record<string, ReactNode> = {
  home: <HomeIcon />,
  folder: <FolderIcon />,
  history: <HistoryIcon />,
  grid: <GridViewIcon />,
  image: <ImageIcon />,
  resize: <PhotoSizeSelectLargeIcon />,
  pdf: <PictureAsPdfIcon />,
  ocr: <DocumentScannerIcon />,
  batch: <LayersIcon />,
  formats: <TableChartIcon />,
  settings: <SettingsIcon />,
  help: <HelpOutlineIcon />,
}

interface AppShellProps {
  route: RouteId
  onNavigate: (route: RouteId, opts?: { toolsQuery?: string }) => void
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
  const [profileAnchor, setProfileAnchor] = useState<null | HTMLElement>(null)
  const [snack, setSnack] = useState('')
  const [searchValue, setSearchValue] = useState<ToolEntry | string | null>(null)
  const [searchInput, setSearchInput] = useState('')

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
    label === 'Workspace' ? t('navGroup.workspace') : label === 'Tools' ? t('navGroup.tools') : t('navGroup.account')
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

  const searchOptions = useMemo(() => searchTools(searchInput), [searchInput])

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH

  // Every PDF tool page is a viewport-height workspace (like
  // Acrobat / Figma): the page itself never scrolls on desktop —
  // the Edit editor's three columns scroll internally, and the
  // simple tool pages scroll inside their own container when
  // they are taller than the viewport (e.g. Merge at 1366x768).
  // Desktop only — below lg the pages keep their normal stacked
  // scrolling layout. The /pdf picker is a directory, not a
  // workspace, so it keeps normal page scrolling.
  const fitViewport = route.startsWith('pdf-') && isDesktop

  const sidebar = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-end',
          px: 1,
          minHeight: 64,
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
      <List sx={{ flex: 1, overflowY: 'auto', py: 1 }} aria-label="OpenPixel Studio navigation">
        {NAV_GROUPS.map((group) => (
          <Box key={group.label}>
            {!collapsed && (
              <ListSubheader
                component="div"
                sx={{ bgcolor: 'transparent', lineHeight: '32px', fontSize: '0.75rem' }}
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
  // Overview / Tools / PDF Tools / <tool>.
  const isPdfTool = route !== 'pdf' && route.startsWith('pdf-')
  const crumbs =
    route === 'home'
      ? []
      : [
          { label: t('crumb.overview'), route: 'home' as RouteId },
          ...(route === 'convert' || route === 'resize' || route === 'pdf' || route === 'ocr' || route === 'batch' || isPdfTool
            ? [{ label: t('crumb.tools'), route: 'tools' as RouteId }]
            : []),
          ...(isPdfTool ? [{ label: t('crumb.pdfTools'), route: 'pdf' as RouteId }] : []),
          { label: routeLabel(route), route },
        ]

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
            <Toolbar sx={{ minHeight: 64, gap: 1, px: { xs: 1.5, md: 3 } }}>
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
                    aria-label={t('header.searchTools')}
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
              <Button
                type="button"
                id="language-toggle"
                onClick={toggleLanguage}
                aria-label={lang === 'bn' ? t('header.languageToEn') : t('header.languageToBn')}
                title={lang === 'bn' ? t('header.languageToEn') : t('header.languageToBn')}
                sx={{ minWidth: 40, color: 'inherit', fontWeight: 700 }}
              >
                {lang === 'bn' ? 'EN' : 'বাং'}
              </Button>
              <IconButton type="button" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}>
                {isDark ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
              <IconButton aria-label={t('header.help')} title={t('header.help')} onClick={() => go('help')}>
                <HelpOutlineIcon />
              </IconButton>
              <IconButton
                aria-label={t('header.profile')}
                title={t('header.profile')}
                onClick={(e) => setProfileAnchor(e.currentTarget)}
              >
                <AccountCircleIcon />
              </IconButton>
              <Menu
                anchorEl={profileAnchor}
                open={Boolean(profileAnchor)}
                onClose={() => setProfileAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              >
                <Box sx={{ px: 2, py: 1, maxWidth: 280 }}>
                  <Typography variant="subtitle2">{t('header.profile')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('header.profileText')}
                  </Typography>
                </Box>
                <Divider />
                <MenuItem
                  onClick={() => {
                    setProfileAnchor(null)
                    go('settings')
                  }}
                >
                  {t('nav.settings')}
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setProfileAnchor(null)
                    go('help')
                  }}
                >
                  {t('nav.help')}
                </MenuItem>
              </Menu>
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
              px: { xs: 2, md: 4 },
              py: fitViewport ? { xs: 2, md: 2 } : { xs: 2, md: 4 },
            }}
          >
            {crumbs.length > 0 && (
              <Breadcrumbs aria-label="Breadcrumb" sx={{ mb: fitViewport ? 2 : 3 }}>
                {crumbs.map((c, i) =>
                  i === crumbs.length - 1 ? (
                    <Typography key={c.route} color="text.primary" variant="body2">
                      {c.label}
                    </Typography>
                  ) : (
                    <Link
                      key={c.route}
                      component="button"
                      variant="body2"
                      underline="hover"
                      onClick={() => onNavigate(c.route)}
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
              }}
            >
              {children}
            </Box>
          </Box>

          {/* No footer in the viewport-fit workspace — it would eat
              workspace height. Every other route keeps it. */}
          {!fitViewport && (
          <Box
            component="footer"
            sx={{ borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper', px: { xs: 2, md: 4 }, py: 4 }}
          >
            <Box
              sx={{
                maxWidth: 1440,
                mx: 'auto',
                display: 'grid',
                gap: 3,
                gridTemplateColumns: { xs: '1fr 1fr', md: '2fr 1fr 1fr 1fr' },
              }}
            >
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  OpenPixel Studio
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('footer.tagline')}
                </Typography>
              </Box>
              <Box>
                <Typography variant="overline" color="text.secondary" display="block" gutterBottom>
                  {t('footer.tools')}
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-start' }}>
                  <Button size="small" onClick={() => onNavigate('tools')} sx={{ px: 0 }}>
                    {t('nav.tools')}
                  </Button>
                  <Button size="small" onClick={() => onNavigate('convert')} sx={{ px: 0 }}>
                    {t('nav.convert')}
                  </Button>
                  <Button size="small" onClick={() => onNavigate('pdf')} sx={{ px: 0 }}>
                    {t('nav.pdf')}
                  </Button>
                  <Button size="small" onClick={() => onNavigate('ocr')} sx={{ px: 0 }}>
                    {t('nav.ocr')}
                  </Button>
                </Box>
              </Box>
              <Box>
                <Typography variant="overline" color="text.secondary" display="block" gutterBottom>
                  {t('footer.resources')}
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-start' }}>
                  <Button size="small" onClick={() => onNavigate('formats')} sx={{ px: 0 }}>
                    {t('nav.formats')}
                  </Button>
                  <Button size="small" onClick={() => onNavigate('settings')} sx={{ px: 0 }}>
                    {t('nav.settings')}
                  </Button>
                  <Button size="small" onClick={() => onNavigate('help')} sx={{ px: 0 }}>
                    {t('nav.help')}
                  </Button>
                  <Button
                    size="small"
                    component="a"
                    href="https://github.com/rajuofficialasf-hub/openpixel"
                    target="_blank"
                    rel="noreferrer"
                    sx={{ px: 0 }}
                  >
                    GitHub
                  </Button>
                </Box>
              </Box>
              <Box>
                <Typography variant="overline" color="text.secondary" display="block" gutterBottom>
                  {t('footer.legal')}
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-start' }}>
                  <Button size="small" onClick={() => onNavigate('help')} sx={{ px: 0 }}>
                    {t('footer.privacy')}
                  </Button>
                  <Button size="small" onClick={() => onNavigate('help')} sx={{ px: 0 }}>
                    {t('footer.terms')}
                  </Button>
                  <Button size="small" onClick={() => onNavigate('help')} sx={{ px: 0 }}>
                    {t('footer.about')}
                  </Button>
                </Box>
              </Box>
            </Box>
            <Divider sx={{ my: 3 }} />
            <Typography
              variant="caption"
              color="text.secondary"
              component="p"
              sx={{ maxWidth: 1440, mx: 'auto', textAlign: 'center' }}
            >
              {t('footer.copyright')}
            </Typography>
          </Box>
          )}
        </Box>
      </Box>
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
