import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useState } from 'react'
import { BatchWorkspace } from './components/BatchWorkspace'
import { CapabilitiesTable } from './components/CapabilitiesTable'
import { ConvertWorkspace } from './components/ConvertWorkspace'
import { LogsView } from './components/LogsView'
import { SettingsPanel } from './components/SettingsPanel'
import { loadSettings, resolveTheme, saveSettings, type Settings } from './lib/settings'
import { fetchAppInfo, fetchCapabilities, type AppInfo, type FormatCapability } from './lib/tauri'

type Tab = 'convert' | 'batch' | 'formats' | 'settings' | 'logs'

const TABS: { id: Tab; label: string }[] = [
  { id: 'convert', label: 'Convert' },
  { id: 'batch', label: 'Batch' },
  { id: 'formats', label: 'Formats' },
  { id: 'settings', label: 'Settings' },
  { id: 'logs', label: 'Logs' },
]

function App() {
  const [tab, setTab] = useState<Tab>('convert')
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [capabilities, setCapabilities] = useState<FormatCapability[] | null>(null)
  const [capsError, setCapsError] = useState<string | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [droppedPaths, setDroppedPaths] = useState<string[]>([])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolveTheme(settings.theme) === 'dark')
    saveSettings(settings)
  }, [settings])

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

  const themeLabel = resolveTheme(settings.theme) === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-2xl font-bold">OpenPixel</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Local image conversion — files never leave your device.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800 dark:bg-green-900 dark:text-green-200"
              title="No server, no uploads, no account — everything runs on this machine."
            >
              ● Offline
            </span>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={themeLabel}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
            >
              {resolveTheme(settings.theme) === 'dark' ? '☀️ Light' : '🌙 Dark'}
            </button>
          </div>
        </div>
        <nav aria-label="Main" className="mx-auto max-w-6xl px-4 pb-3">
          <div role="tablist" aria-label="OpenPixel sections" className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                id={`tab-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${
                  tab === t.id
                    ? 'bg-blue-600 text-white'
                    : 'border border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {capsError && (
          <div role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
            Could not reach the engine backend: {capsError}. The app cannot convert without it —
            try restarting OpenPixel.
          </div>
        )}
        {capabilities === null && !capsError && (
          <p role="status" className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Loading format capabilities from the engine…
          </p>
        )}
        {capabilities !== null && (
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
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
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        <p>
          OpenPixel Engine — desktop app (Tauri 2 + native Rust engine). No server, no upload, no
          account. {appInfo ? `App ${appInfo.version} · engine ${appInfo.engine_version} · ` : ''}
          {capabilities ? `${capabilities.length} formats known.` : ''}
        </p>
        <p className="mt-1">
          Full conversion (TIFF, AVIF, JXL, SVG, EXR, HDR, JPEG 2000, TGA, ICO, PNM, QOI) runs in
          this app — the web app only does PNG / JPEG / WebP / BMP in the browser.
        </p>
      </footer>
    </div>
  )
}

export default App
