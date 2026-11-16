import { browserEncodableFormats, formatLabel } from '../lib/capabilities'
import { DEFAULT_SETTINGS, type Settings } from '../lib/settings'

interface SettingsPanelProps {
  settings: Settings
  onSettingsChange: (settings: Settings) => void
}

/**
 * Settings — persisted on-device in localStorage, no account, no server.
 * Every control here does a real operation (including Reset and Clear).
 */
export function SettingsPanel({ settings, onSettingsChange }: SettingsPanelProps) {
  const update = (patch: Partial<Settings>) => onSettingsChange({ ...settings, ...patch })

  return (
    <section aria-labelledby="settings-heading" className="space-y-6">
      <h2 id="settings-heading" className="text-xl font-semibold text-slate-900 dark:text-slate-100">
        Settings
      </h2>

      <div className="max-w-xl space-y-5 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div>
          <label htmlFor="theme" className="block text-sm font-medium text-slate-900 dark:text-slate-100">
            Theme
          </label>
          <select
            id="theme"
            value={settings.theme}
            onChange={(e) => update({ theme: e.target.value as Settings['theme'] })}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="system">System (follow your OS)</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="default-quality"
            className="block text-sm font-medium text-slate-900 dark:text-slate-100"
          >
            Default JPEG / WebP quality: {settings.defaultQuality}
          </label>
          <input
            id="default-quality"
            type="range"
            min={1}
            max={100}
            value={settings.defaultQuality}
            onChange={(e) => update({ defaultQuality: Number(e.target.value) })}
            className="mt-1 w-full"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Used as the starting quality in the Convert and Batch views. The engine default is 85.
          </p>
        </div>

        <div>
          <label
            htmlFor="default-format"
            className="block text-sm font-medium text-slate-900 dark:text-slate-100"
          >
            Default output format
          </label>
          <select
            id="default-format"
            value={settings.defaultFormat}
            onChange={(e) => update({ defaultFormat: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          >
            {browserEncodableFormats().map((t) => (
              <option key={t.format_id} value={t.format_id}>
                {formatLabel(t.format_id)}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Only formats this browser can encode are offered here.
          </p>
        </div>

        <div>
          <label
            htmlFor="default-background"
            className="block text-sm font-medium text-slate-900 dark:text-slate-100"
          >
            Default background colour (flattens transparency for JPEG/BMP)
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="default-background"
              type="color"
              value={settings.defaultBackground}
              onChange={(e) => update({ defaultBackground: e.target.value })}
              className="h-10 w-12 cursor-pointer rounded border border-slate-300 dark:border-slate-600"
              aria-label="Default background colour picker"
            />
            <input
              type="text"
              value={settings.defaultBackground}
              onChange={(e) => update({ defaultBackground: e.target.value })}
              aria-label="Default background colour hex value"
              className="w-28 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="batch-workers"
            className="block text-sm font-medium text-slate-900 dark:text-slate-100"
          >
            Batch concurrency: {settings.batchWorkers} file{settings.batchWorkers === 1 ? '' : 's'} at a
            time
          </label>
          <input
            id="batch-workers"
            type="range"
            min={1}
            max={4}
            step={1}
            value={settings.batchWorkers}
            onChange={(e) => update({ batchWorkers: Number(e.target.value) })}
            className="mt-1 w-full"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            The native CLI allows up to 8 workers; the browser is capped at 4 so a batch cannot
            exhaust tab memory. Conversion itself runs in a Web Worker, so the UI stays responsive.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 pt-1">
          <button
            type="button"
            onClick={() => onSettingsChange({ ...DEFAULT_SETTINGS })}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem('openpixel.settings.v1')
              onSettingsChange({ ...DEFAULT_SETTINGS })
            }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Clear saved settings
          </button>
        </div>
      </div>

      <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        <h3 className="font-medium text-slate-900 dark:text-slate-100">About this app</h3>
        <p className="mt-1">
          OpenPixel web (Phase 7) — React + TypeScript + Vite + Tailwind CSS. All processing is
          local: there is no server, no account, and no upload. Capability data is generated from
          the Rust engine with{' '}
          <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-700">
            npm run generate:capabilities
          </code>
          . WASM processing is available in this build: the real Rust engine compiles to
          wasm32 as a dav1d-free build (`crates/openpixel-wasm`, see docs/WEB.md) and is
          packaged into `public/wasm/` with{' '}
          <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-700">
            npm run build:wasm
          </code>
          ; conversion uses the browser canvas in a Web Worker for PNG / JPEG / WebP and
          the WASM engine for the formats the canvas cannot handle (including BMP, which
          the canvas cannot encode at all). AVIF is not available in
          WASM (it needs the native libdav1d library).
        </p>
      </div>
    </section>
  )
}
