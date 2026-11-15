import { open } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Settings } from '../lib/settings'
import {
  batchCancel,
  batchCancelAll,
  batchPause,
  batchResume,
  batchRetryFailed,
  decodableExtensions,
  defaultOutputPath,
  dirName,
  encodableFormats,
  fetchBatchJobs,
  fetchBatchProgress,
  fetchBatchResults,
  fileName,
  formatBytes,
  listDirectoryImages,
  startBatch,
  type BatchFileRequest,
  type BatchProgress,
  type FormatCapability,
  type Job,
  type JobResult,
} from '../lib/tauri'
import { DropZone } from './DropZone'

interface BatchFile {
  input: string
  target: string
}

interface BatchWorkspaceProps {
  capabilities: FormatCapability[]
  settings: Settings
  droppedPaths: string[]
  onDroppedConsumed: () => void
}

export function BatchWorkspace({
  capabilities,
  settings,
  droppedPaths,
  onDroppedConsumed,
}: BatchWorkspaceProps) {
  const [files, setFiles] = useState<BatchFile[]>([])
  const [outDir, setOutDir] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<BatchProgress | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [results, setResults] = useState<JobResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const filesRef = useRef(files)
  filesRef.current = files

  const encodable = encodableFormats(capabilities)
  const resultByJob = new Map(results.map((r) => [r.job_id, r]))

  const addPaths = useCallback(
    (paths: string[]) => {
      setFiles((prev) => {
        const seen = new Set(prev.map((f) => f.input))
        const fresh = paths
          .filter((p) => !seen.has(p))
          .map((input) => ({ input, target: settings.defaultFormat }))
        if (fresh.length === 0) return prev
        return [...prev, ...fresh]
      })
      setOutDir((prev) => prev || (paths.length > 0 ? dirName(paths[0]) : prev))
    },
    [settings.defaultFormat],
  )

  const pickFiles = useCallback(async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: 'Images', extensions: decodableExtensions(capabilities) }],
    })
    if (Array.isArray(picked)) addPaths(picked)
    else if (typeof picked === 'string') addPaths([picked])
  }, [capabilities, addPaths])

  const pickFolder = useCallback(async () => {
    const picked = await open({ multiple: false, directory: true })
    if (typeof picked !== 'string') return
    try {
      const listed = await listDirectoryImages(picked)
      if (listed.length === 0) {
        setError(`No decodable images in ${picked}.`)
        return
      }
      addPaths(listed)
      setOutDir(picked)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [addPaths])

  useEffect(() => {
    if (droppedPaths.length > 0) {
      addPaths(droppedPaths)
      onDroppedConsumed()
    }
  }, [droppedPaths, addPaths, onDroppedConsumed])

  const refresh = useCallback(async () => {
    try {
      const [p, j, r] = await Promise.all([
        fetchBatchProgress(),
        fetchBatchJobs(),
        fetchBatchResults(),
      ])
      setProgress(p)
      setJobs(j)
      setResults(r)
      if (p.total > 0 && p.done + p.failed + p.cancelled >= p.total) {
        setRunning(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (!running) return
    void refresh()
    pollRef.current = setInterval(() => void refresh(), 500)
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current)
    }
  }, [running, refresh])

  useEffect(
    () => () => {
      if (pollRef.current !== null) clearInterval(pollRef.current)
    },
    [],
  )

  const start = async () => {
    if (files.length === 0) return
    setError(null)
    setResults([])
    setJobs([])
    setProgress(null)
    try {
      const requests: BatchFileRequest[] = files.map((f) => ({
        input: f.input,
        output: outDir
          ? `${outDir}/${fileName(defaultOutputPath(f.input, f.target, capabilities))}`
          : defaultOutputPath(f.input, f.target, capabilities),
        target: f.target,
        options: {
          quality: settings.defaultQuality,
          png_compression: null,
          background: settings.defaultBackground,
          metadata_policy: settings.metadataPolicy,
          selected_frame: null,
          convert_to_srgb: false,
        },
      }))
      await startBatch(requests, settings.batchWorkers)
      setRunning(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const done = progress !== null && progress.done + progress.failed + progress.cancelled >= progress.total

  return (
    <div className="space-y-6">
      <DropZone
        onPick={() => void pickFiles()}
        label="Batch convert"
        hint={`Add files (or a whole folder) — the engine worker pool converts up to ${settings.batchWorkers} at a time. A failed file never stops the batch.`}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void pickFolder()}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
        >
          Open folder…
        </button>
        <button
          type="button"
          onClick={() => setFiles([])}
          disabled={files.length === 0 || running}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700"
        >
          Clear list
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {files.length > 0 && (
        <section aria-label="Batch files" className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              {files.length} file{files.length === 1 ? '' : 's'}
            </h2>
            <label className="flex items-center gap-2 text-sm">
              Output folder
              <input
                type="text"
                value={outDir}
                onChange={(e) => setOutDir(e.target.value)}
                aria-label="Output folder"
                className="w-72 rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-700"
              />
            </label>
          </div>

          <ul className="mt-3 space-y-2">
            {files.map((f, i) => {
              const job = jobs.find((j) => j.input === f.input)
              const result = job ? resultByJob.get(job.id) : undefined
              return (
                <li
                  key={f.input}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
                >
                  <span className="min-w-0 flex-1 break-all">{fileName(f.input)}</span>
                  <select
                    value={f.target}
                    disabled={running}
                    aria-label={`Target format for ${fileName(f.input)}`}
                    onChange={(e) =>
                      setFiles((prev) => prev.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))
                    }
                    className="rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-700"
                  >
                    {encodable.map((c) => (
                      <option key={c.format_id} value={c.format_id}>
                        {c.format_id.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <span
                    role="status"
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      job?.status === 'Done'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : job?.status === 'Failed'
                          ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                          : job?.status === 'Running'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {job?.status ?? 'Queued'}
                    {result && result.status === 'Done' ? ` · ${formatBytes(result.bytes)}` : ''}
                  </span>
                  {result?.error && (
                    <span className="w-full text-xs text-red-700 dark:text-red-400">{result.error}</span>
                  )}
                  {!running && (
                    <button
                      type="button"
                      aria-label={`Remove ${fileName(f.input)}`}
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="rounded px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      ✕
                    </button>
                  )}
                  {job && job.status === 'Queued' && running && (
                    <button
                      type="button"
                      onClick={() => void batchCancel(job.id).then(() => void refresh())}
                      className="rounded px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      Cancel
                    </button>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void start()}
              disabled={running || files.length === 0}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Start batch ({settings.batchWorkers} worker{settings.batchWorkers === 1 ? '' : 's'})
            </button>
            {running && (
              <>
                <button
                  type="button"
                  onClick={() => void batchPause().then(() => void refresh())}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
                >
                  Pause queue
                </button>
                <button
                  type="button"
                  onClick={() => void batchResume().then(() => void refresh())}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
                >
                  Resume
                </button>
                <button
                  type="button"
                  onClick={() => void batchCancelAll().then(() => void refresh())}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
                >
                  Cancel all queued
                </button>
              </>
            )}
            {done && progress !== null && progress.failed > 0 && (
              <button
                type="button"
                onClick={() => void batchRetryFailed().then(() => void refresh())}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
              >
                Retry {progress.failed} failed
              </button>
            )}
          </div>

          {progress && (
            <p role="status" className="mt-3 text-sm text-slate-600 dark:text-slate-400">
              {progress.done} done · {progress.failed} failed · {progress.running} running ·{' '}
              {progress.queued} queued · {progress.cancelled} cancelled · {progress.paused} paused
              (total {progress.total})
            </p>
          )}
        </section>
      )}
    </div>
  )
}
