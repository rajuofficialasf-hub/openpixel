import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Box } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { BatchWorkspace } from './components/BatchWorkspace'
import { CapabilitiesTable } from './components/CapabilitiesTable'
import { ConvertWorkspace } from './components/ConvertWorkspace'
import { HelpPage } from './components/HelpPage'
import { HomePage } from './components/HomePage'
import { OcrWorkspace } from './components/OcrWorkspace'
import { PdfWorkspace } from './components/PdfWorkspace'
import { ResizeWorkspace } from './components/ResizeWorkspace'
import { SettingsPanel } from './components/SettingsPanel'
import { ToolsDirectory, type ToolsCategoryFilter } from './components/ToolsDirectory'
import { MyFilesPage, RecentFilesPage, WorkspaceDashboard } from './components/Workspace'
import { AppShell } from './components/layout/AppShell'
import { loadSettings, resolveTheme, saveSettings, type Settings } from './lib/settings'
import { getTheme } from './theme/theme'
import { ROUTE_PATHS, routeFromPath, type RouteId, type ToolCategory } from './lib/routes'

// Lazy: the 3D backdrop is decoration — it must never block first
// paint. The chunk loads only when the setting is on.
const Background3D = lazy(() => import('./components/Background3D'))

interface PendingFiles {
  files: File[]
  route: RouteId
}

interface NavigateOpts {
  toolsQuery?: string
  toolsCategory?: ToolCategory
  files?: File[]
}

function App() {
  // Deep links open the matching page; an unknown path renders home
  // (the address bar is corrected to '/' on mount, below).
  const [route, setRoute] = useState<RouteId>(() => routeFromPath(window.location.pathname))
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [toolsFilter, setToolsFilter] = useState<{ query: string; category: ToolsCategoryFilter }>({
    query: '',
    category: 'all',
  })
  const [pending, setPending] = useState<PendingFiles | null>(null)

  const mode = resolveTheme(settings.theme)
  const theme = useMemo(() => getTheme(mode), [mode])

  useEffect(() => {
    // The `dark` class is kept for the e2e suite (it asserts on
    // `documentElement.classList.contains('dark')`); the MUI theme
    // itself does not need it.
    document.documentElement.classList.toggle('dark', mode === 'dark')
    saveSettings(settings)
  }, [settings, mode])

  useEffect(() => {
    // Unknown deep link: the route is home, so correct the address
    // bar instead of leaving a bogus path in place.
    if (routeFromPath(window.location.pathname) === 'home' && window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/')
    }
    // Browser back/forward: the URL drives the route.
    const onPopState = () => {
      setRoute(routeFromPath(window.location.pathname))
      window.scrollTo({ top: 0 })
      if (routeFromPath(window.location.pathname) === 'home' && window.location.pathname !== '/') {
        window.history.replaceState(null, '', '/')
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((next: RouteId, opts?: NavigateOpts) => {
    if (opts?.toolsQuery !== undefined || opts?.toolsCategory !== undefined) {
      setToolsFilter((prev) => ({
        query: opts.toolsQuery !== undefined ? opts.toolsQuery : prev.query,
        category: opts.toolsCategory !== undefined ? opts.toolsCategory : prev.category,
      }))
    }
    if (opts?.files) setPending({ files: opts.files, route: next })
    setRoute(next)
    // Shareable URL: push the route's path, unless we are already
    // there (re-clicking the current sidebar item must not add a
    // duplicate history entry — one back press must leave the page).
    const path = ROUTE_PATHS[next]
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
    window.scrollTo({ top: 0 })
  }, [])

  const clearPending = useCallback(() => setPending(null), [])

  return (
    <ThemeProvider theme={theme}>
      {settings.show3dBackground && (
        <Suspense fallback={null}>
          <Background3D />
        </Suspense>
      )}
      {/* The content sits above the (optional) 3D backdrop. */}
      <Box sx={{ position: 'relative', zIndex: 1 }}>
        <AppShell route={route} onNavigate={navigate} settings={settings} onSettingsChange={setSettings}>
          {route === 'home' && <HomePage onNavigate={navigate} />}
          {route === 'overview' && <WorkspaceDashboard onNavigate={navigate} />}
          {route === 'tools' && (
            <ToolsDirectory
              query={toolsFilter.query}
              onQueryChange={(query) => setToolsFilter((prev) => ({ ...prev, query }))}
              category={toolsFilter.category}
              onCategoryChange={(category) => setToolsFilter((prev) => ({ ...prev, category }))}
              onNavigate={navigate}
            />
          )}
          {route === 'convert' && (
            <ConvertWorkspace
              settings={settings}
              onSettingsChange={setSettings}
              initialFiles={pending?.route === 'convert' ? pending.files : undefined}
              onInitialFilesConsumed={clearPending}
            />
          )}
          {route === 'resize' && <ResizeWorkspace settings={settings} onSettingsChange={setSettings} />}
          {route === 'pdf' && (
            <PdfWorkspace
              initialFiles={pending?.route === 'pdf' ? pending.files : undefined}
              onInitialFilesConsumed={clearPending}
            />
          )}
          {route === 'ocr' && <OcrWorkspace />}
          {route === 'batch' && (
            <BatchWorkspace
              settings={settings}
              initialFiles={pending?.route === 'batch' ? pending.files : undefined}
              onInitialFilesConsumed={clearPending}
            />
          )}
          {route === 'formats' && <CapabilitiesTable />}
          {route === 'files' && <MyFilesPage onNavigate={navigate} />}
          {route === 'recent' && <RecentFilesPage onNavigate={navigate} />}
          {route === 'settings' && <SettingsPanel settings={settings} onSettingsChange={setSettings} />}
          {route === 'help' && <HelpPage />}
        </AppShell>
      </Box>
    </ThemeProvider>
  )
}

export default App
