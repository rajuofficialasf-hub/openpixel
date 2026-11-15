import { useCallback, useEffect, useState } from 'react'
import { fetchLogs, type LogView } from '../lib/tauri'

/**
 * Application log view. The backend appends every conversion, batch
 * event and error to a file in the app data directory
 * (`<app_data_dir>/logs/openpixel-desktop.log`); this tab shows the
 * tail of that file and its path, so a failure can be diagnosed
 * without opening a terminal.
 */
export function LogsView() {
  const [view, setView] = useState<LogView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setView(await fetchLogs(200))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Conversions, batch events and errors are logged to a file in the app data directory.
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
        >
          Refresh
        </button>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}
      {view && (
        <>
          <p className="break-all text-xs text-slate-500 dark:text-slate-400">{view.path}</p>
          <pre className="max-h-[28rem] overflow-auto rounded-xl border border-slate-200 bg-slate-950 p-4 text-xs leading-relaxed text-slate-100 dark:border-slate-700">
            {view.lines.length > 0 ? view.lines.join('\n') : '(log is empty — convert something first)'}
          </pre>
        </>
      )}
    </div>
  )
}
