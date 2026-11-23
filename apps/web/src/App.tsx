import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Box, LinearProgress } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { HomePage } from './components/HomePage'
import { AppShell } from './components/layout/AppShell'
import { NavigationContext, type NavigateOpts } from './components/layout/navigation'
import { loadSettings, resolveTheme, saveSettings, type Settings } from './lib/settings'
import { I18nProvider } from './lib/i18n-context'
import { translate } from './lib/i18n'
import { getTheme } from './theme/theme'
import { ROUTE_PATHS, routeFromPath, type RouteId } from './lib/routes'
import type { ToolsCategoryFilter } from './components/ToolsDirectory'

// Lazy-loaded workspaces & secondary pages: HomePage paints
// immediately while heavy toolchains (pdf.js, tesseract.js, jszip,
// Three.js) load strictly on demand when the user opens those routes.
const Background3D = lazy(() => import('./components/Background3D'))
const ConvertWorkspace = lazy(() => import('./components/ConvertWorkspace').then((m) => ({ default: m.ConvertWorkspace })))
const ResizeWorkspace = lazy(() => import('./components/ResizeWorkspace').then((m) => ({ default: m.ResizeWorkspace })))
const CropWorkspace = lazy(() => import('./components/CropWorkspace').then((m) => ({ default: m.CropWorkspace })))
const BatchWorkspace = lazy(() => import('./components/BatchWorkspace').then((m) => ({ default: m.BatchWorkspace })))
const OcrWorkspace = lazy(() => import('./components/OcrWorkspace').then((m) => ({ default: m.OcrWorkspace })))
const ToolsDirectory = lazy(() => import('./components/ToolsDirectory').then((m) => ({ default: m.ToolsDirectory })))
const CapabilitiesTable = lazy(() => import('./components/CapabilitiesTable').then((m) => ({ default: m.CapabilitiesTable })))
const SettingsPanel = lazy(() => import('./components/SettingsPanel').then((m) => ({ default: m.SettingsPanel })))
const HelpPage = lazy(() => import('./components/HelpPage').then((m) => ({ default: m.HelpPage })))
const WorkspaceDashboard = lazy(() => import('./components/Workspace').then((m) => ({ default: m.WorkspaceDashboard })))
const MyFilesPage = lazy(() => import('./components/Workspace').then((m) => ({ default: m.MyFilesPage })))
const RecentFilesPage = lazy(() => import('./components/Workspace').then((m) => ({ default: m.RecentFilesPage })))

const PdfPicker = lazy(() => import('./components/pdf/PdfPicker').then((m) => ({ default: m.PdfPicker })))
const CompressTool = lazy(() => import('./components/pdf/CompressTool').then((m) => ({ default: m.CompressTool })))
const MergeTool = lazy(() => import('./components/pdf/MergeTool').then((m) => ({ default: m.MergeTool })))
const ImagesToPdfTool = lazy(() => import('./components/pdf/ImagesToPdfTool').then((m) => ({ default: m.ImagesToPdfTool })))
const PdfToImageTool = lazy(() => import('./components/pdf/PdfToImageTool').then((m) => ({ default: m.PdfToImageTool })))
const ExtractTextTool = lazy(() => import('./components/pdf/ExtractTextTool').then((m) => ({ default: m.ExtractTextTool })))
const EditTool = lazy(() => import('./components/pdf/EditTool').then((m) => ({ default: m.EditTool })))

const BookletTool = lazy(() => import('./components/pdf/PageOpsTools').then((m) => ({ default: m.BookletTool })))
const DuplicateTool = lazy(() => import('./components/pdf/PageOpsTools').then((m) => ({ default: m.DuplicateTool })))
const ExtractTool = lazy(() => import('./components/pdf/PageOpsTools').then((m) => ({ default: m.ExtractTool })))
const NupTool = lazy(() => import('./components/pdf/PageOpsTools').then((m) => ({ default: m.NupTool })))
const RemoveTool = lazy(() => import('./components/pdf/PageOpsTools').then((m) => ({ default: m.RemoveTool })))
const ReorderTool = lazy(() => import('./components/pdf/PageOpsTools').then((m) => ({ default: m.ReorderTool })))
const ReverseTool = lazy(() => import('./components/pdf/PageOpsTools').then((m) => ({ default: m.ReverseTool })))
const RotateTool = lazy(() => import('./components/pdf/PageOpsTools').then((m) => ({ default: m.RotateTool })))
const SplitTool = lazy(() => import('./components/pdf/PageOpsTools').then((m) => ({ default: m.SplitTool })))

const FlattenTool = lazy(() => import('./components/pdf/CleanUpTools').then((m) => ({ default: m.FlattenTool })))
const MetadataTool = lazy(() => import('./components/pdf/CleanUpTools').then((m) => ({ default: m.MetadataTool })))
const RedactTool = lazy(() => import('./components/pdf/CleanUpTools').then((m) => ({ default: m.RedactTool })))
const RepairTool = lazy(() => import('./components/pdf/CleanUpTools').then((m) => ({ default: m.RepairTool })))
const SanitizeTool = lazy(() => import('./components/pdf/CleanUpTools').then((m) => ({ default: m.SanitizeTool })))

interface PendingFiles {
  files: File[]
  route: RouteId
}

function RouteFallback() {
  return (
    <Box sx={{ width: '100%', pt: 1 }}>
      <LinearProgress sx={{ borderRadius: 1 }} />
    </Box>
  )
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
    document.documentElement.classList.toggle('dark', mode === 'dark')
    document.documentElement.lang = settings.language === 'bn' ? 'bn' : 'en'
    document.title = `OpenPixel Studio — ${translate(settings.language, 'home.heroTitle')}`
    saveSettings(settings)
  }, [settings, mode])

  useEffect(() => {
    const fixPath = () => {
      const path = window.location.pathname
      const resolved = routeFromPath(path)
      if (resolved === 'home' && path !== '/') {
        window.history.replaceState(null, '', '/')
      } else if (resolved === 'pdf' && path !== '/pdf') {
        window.history.replaceState(null, '', '/pdf')
      }
    }
    fixPath()
    const onPopState = () => {
      setRoute(routeFromPath(window.location.pathname))
      window.scrollTo({ top: 0 })
      fixPath()
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
    const path = ROUTE_PATHS[next]
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
    window.scrollTo({ top: 0 })
  }, [])

  const clearPending = useCallback(() => setPending(null), [])

  const pendingFor = (target: RouteId) => (pending?.route === target ? pending.files : undefined)

  const pdfToolProps = (target: RouteId) => ({
    initialFiles: pendingFor(target),
    onInitialFilesConsumed: clearPending,
  })

  const navValue = useMemo(() => ({ route, navigate }), [route, navigate])

  return (
    <ThemeProvider theme={theme}>
      {settings.show3dBackground && (
        <Suspense fallback={null}>
          <Background3D />
        </Suspense>
      )}
      <Box sx={{ position: 'relative', zIndex: 1 }}>
        <I18nProvider language={settings.language}>
          <NavigationContext.Provider value={navValue}>
            <AppShell route={route} onNavigate={navigate} settings={settings} onSettingsChange={setSettings}>
              {route === 'home' ? (
                <HomePage onNavigate={navigate} />
              ) : (
                <Suspense fallback={<RouteFallback />}>
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
                      initialFiles={pendingFor('convert')}
                      onInitialFilesConsumed={clearPending}
                    />
                  )}
                  {route === 'resize' && (
                    <ResizeWorkspace
                      settings={settings}
                      onSettingsChange={setSettings}
                      initialFiles={pendingFor('resize')}
                      onInitialFilesConsumed={clearPending}
                    />
                  )}
                  {route === 'crop' && (
                    <CropWorkspace
                      initialFiles={pendingFor('crop')}
                      onInitialFilesConsumed={clearPending}
                    />
                  )}
                  {route === 'pdf' && (
                    <PdfPicker
                      initialFiles={pendingFor('pdf')}
                      onInitialFilesConsumed={clearPending}
                      onNavigate={navigate}
                    />
                  )}
                  {route === 'pdf-merge' && <MergeTool {...pdfToolProps('pdf-merge')} />}
                  {route === 'pdf-split' && <SplitTool {...pdfToolProps('pdf-split')} />}
                  {route === 'pdf-rotate' && <RotateTool {...pdfToolProps('pdf-rotate')} />}
                  {route === 'pdf-extract' && <ExtractTool {...pdfToolProps('pdf-extract')} />}
                  {route === 'pdf-remove' && <RemoveTool {...pdfToolProps('pdf-remove')} />}
                  {route === 'pdf-reorder' && <ReorderTool {...pdfToolProps('pdf-reorder')} />}
                  {route === 'pdf-duplicate' && <DuplicateTool {...pdfToolProps('pdf-duplicate')} />}
                  {route === 'pdf-reverse' && <ReverseTool {...pdfToolProps('pdf-reverse')} />}
                  {route === 'pdf-booklet' && <BookletTool {...pdfToolProps('pdf-booklet')} />}
                  {route === 'pdf-nup' && <NupTool {...pdfToolProps('pdf-nup')} />}
                  {route === 'pdf-compress' && <CompressTool {...pdfToolProps('pdf-compress')} />}
                  {route === 'pdf-edit' && <EditTool {...pdfToolProps('pdf-edit')} />}
                  {route === 'pdf-redact' && <RedactTool {...pdfToolProps('pdf-redact')} />}
                  {route === 'pdf-metadata' && <MetadataTool {...pdfToolProps('pdf-metadata')} />}
                  {route === 'pdf-sanitize' && <SanitizeTool {...pdfToolProps('pdf-sanitize')} />}
                  {route === 'pdf-flatten' && <FlattenTool {...pdfToolProps('pdf-flatten')} />}
                  {route === 'pdf-repair' && <RepairTool {...pdfToolProps('pdf-repair')} />}
                  {route === 'pdf-to-image' && <PdfToImageTool {...pdfToolProps('pdf-to-image')} />}
                  {route === 'pdf-images-to-pdf' && <ImagesToPdfTool {...pdfToolProps('pdf-images-to-pdf')} />}
                  {route === 'pdf-extract-text' && <ExtractTextTool {...pdfToolProps('pdf-extract-text')} />}
                  {route === 'ocr' && (
                    <OcrWorkspace
                      initialFiles={pendingFor('ocr')}
                      onInitialFilesConsumed={clearPending}
                    />
                  )}
                  {route === 'batch' && (
                    <BatchWorkspace
                      settings={settings}
                      initialFiles={pendingFor('batch')}
                      onInitialFilesConsumed={clearPending}
                    />
                  )}
                  {route === 'formats' && <CapabilitiesTable />}
                  {route === 'files' && <MyFilesPage onNavigate={navigate} />}
                  {route === 'recent' && <RecentFilesPage onNavigate={navigate} />}
                  {route === 'settings' && <SettingsPanel settings={settings} onSettingsChange={setSettings} />}
                  {route === 'help' && <HelpPage />}
                </Suspense>
              )}
            </AppShell>
          </NavigationContext.Provider>
        </I18nProvider>
      </Box>
    </ThemeProvider>
  )
}

export default App
