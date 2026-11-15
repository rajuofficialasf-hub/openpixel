import type { AppInfo, FormatCapability } from '../lib/tauri'
import { encodableFormats, formatLabel } from '../lib/tauri'
import type { Settings } from '../lib/settings'
import { DEFAULT_SETTINGS } from '../lib/settings'

interface SettingsPanelProps {
  settings: Settings
  onSettingsChange: (settings: Settings) => void
  capabilities: FormatCapability[]
  appInfo: AppInfo | null
}

export function SettingsPanel({ settings, onSettingsChange, capabilities, appInfo }: SettingsPanelProps) {
  const set = (patch: Partial<Settings>) => onSettingsChange({ ...settings, ...patch })
  const encodable = encodableFormats(capabilities)

  return (
    <div className="space-y-6">
      <section aria-label="Preferences" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">PREFERENCES</h2>
        <div>
          <label htmlFor="theme" className="block text-sm font-medium">
            Theme
          </label>
          <select
            id="theme"
            value={settings.theme}
            onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}
            className="mt-1 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div>
          <label htmlFor="default-quality" className="block text-sm font-medium">
            Default quality: {settings.defaultQuality}
          </label>
          <input
            id="default-quality"
            type="range"
            min={1}
            max={100}
            value={settings.defaultQuality}
            onChange={(e) => set({ defaultQuality: Number(e.target.value) })}
            className="w-full max-w-xs"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Applies to JPEG, WebP and AVIF targets.
          </p>
        </div>
        <div>
          <label htmlFor="default-format" className="block text-sm font-medium">
            Default output format
          </label>
          <select
            id="default-format"
            value={settings.defaultFormat}
            onChange={(e) => set({ defaultFormat: e.target.value })}
            className="mt-1 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
          >
            {encodable.map((c) => (
              <option key={c.format_id} value={c.format_id}>
                {formatLabel(capabilities, c.format_id)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="default-background" className="block text-sm font-medium">
            Default background colour
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="default-background"
              type="color"
              value={settings.defaultBackground}
              onChange={(e) => set({ defaultBackground: e.target.value })}
              className="h-10 w-12 rounded border border-slate-300 dark:border-slate-600"
            />
            <span className="text-sm">{settings.defaultBackground}</span>
          </div>
        </div>
        <div>
          <label htmlFor="metadata-policy" className="block text-sm font-medium">
            Default metadata policy
          </label>
          <select
            id="metadata-policy"
            value={settings.metadataPolicy}
            onChange={(e) => set({ metadataPolicy: e.target.value as Settings['metadataPolicy'] })}
            className="mt-1 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
          >
            <option value="strip">Strip</option>
            <option value="preserve">Preserve</option>
          </select>
        </div>
        <div>
          <label htmlFor="batch-workers" className="block text-sm font-medium">
            Batch workers: {settings.batchWorkers}
          </label>
          <input
            id="batch-workers"
            type="range"
            min={1}
            max={8}
            value={settings.batchWorkers}
            onChange={(e) => set({ batchWorkers: Number(e.target.value) })}
            className="w-full max-w-xs"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            1–8 concurrent conversions in the engine worker pool (default 4). Fewer workers use
            less memory on large images.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onSettingsChange({ ...DEFAULT_SETTINGS })}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
        >
          Reset to defaults
        </button>
      </section>

      <section aria-label="About" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">ABOUT</h2>
        <p>
          <strong>OpenPixel</strong> {appInfo ? `desktop ${appInfo.version}` : ''} — the native
          engine (same code as the <code>openpixel</code> CLI) behind a desktop window.
        </p>
        <p>
          <strong>Offline:</strong> yes — no server, no uploads, no account, no network requests.
          Conversion, batching, metadata and logging all happen on this machine.
        </p>
        {appInfo && (
          <>
            <p>Engine version: {appInfo.engine_version}</p>
            <p>Formats known to the engine: {appInfo.format_count}</p>
            <p className="break-all">Log file: {appInfo.log_path}</p>
          </>
        )}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Conversion limits (enforced by the engine): 100 MiB per file, 100 MP, 16 384 px per side.
        </p>
      </section>
    </div>
  )
}
