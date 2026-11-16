import { useCallback, useEffect, useState } from 'react'
import { BatchWorkspace } from './components/BatchWorkspace'
import { CapabilitiesTable } from './components/CapabilitiesTable'
import { ConvertWorkspace } from './components/ConvertWorkspace'
import { SettingsPanel } from './components/SettingsPanel'
import { loadSettings, resolveTheme, saveSettings, type Settings } from './lib/settings'
import { WASM_STATUS } from './lib/wasm'

type Tab = 'convert' | 'batch' | 'formats' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'convert', label: 'Convert' },
  { id: 'batch', label: 'Batch' },
  { id: 'formats', label: 'Formats' },
  { id: 'settings', label: 'Settings' },
]

function App() {
  const [tab, setTab] = useState<Tab>('convert')
  const [settings, setSettings] = useState<Settings>(() => loadSettings())

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolveTheme(settings.theme) === 'dark')
    saveSettings(settings)
  }, [settings])

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
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={themeLabel}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            {resolveTheme(settings.theme) === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
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
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'convert' && (
            <ConvertWorkspace settings={settings} onSettingsChange={setSettings} />
          )}
          {tab === 'batch' && <BatchWorkspace settings={settings} />}
          {tab === 'formats' && <CapabilitiesTable />}
          {tab === 'settings' && <SettingsPanel settings={settings} onSettingsChange={setSettings} />}
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        <p>
          OpenPixel Engine — Phase 7 web app. No server, no upload, no account. {WASM_STATUS.detail}
        </p>
        <p className="mt-1">
          In-browser conversion: PNG / JPEG / WebP / BMP output via the browser canvas, plus
          TIFF, QOI, HEIC, JXL, JPEG 2000, ICO, PNM, TGA and GIF via the built-in WASM engine
          (when built). For AVIF, use the native CLI (<code>openpixel convert</code>).
        </p>
      </footer>
    </div>
  )
}

export default App
