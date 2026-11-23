import { open } from '@tauri-apps/plugin-dialog'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItem,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
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
import { WorkflowSteps } from './WorkflowSteps'
import { dt } from '../lib/i18n'

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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
        <Typography variant="h5" component="h2">
          {dt(settings.language, 'nav.batch')}
        </Typography>
        <WorkflowSteps
          activeStep={files.length === 0 ? 0 : done ? 2 : 1}
          steps={[
            dt(settings.language, 'step.upload'),
            dt(settings.language, 'step.options'),
            dt(settings.language, 'step.save'),
          ]}
        />
      </Box>
      <DropZone
        onPick={() => void pickFiles()}
        label="Batch convert"
        hint={`Add files (or a whole folder) — the engine worker pool converts up to ${settings.batchWorkers} at a time. A failed file never stops the batch.`}
      />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Button type="button" variant="outlined" onClick={() => void pickFolder()}>
          Open folder…
        </Button>
        <Button
          type="button"
          variant="outlined"
          onClick={() => setFiles([])}
          disabled={files.length === 0 || running}
        >
          Clear list
        </Button>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      {files.length > 0 && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
              <Typography variant="subtitle1">
                {files.length} file{files.length === 1 ? '' : 's'}
              </Typography>
              <TextField
                label="Output folder"
                value={outDir}
                onChange={(e) => setOutDir(e.target.value)}
                aria-label="Output folder"
                size="small"
                sx={{ width: 320 }}
              />
            </Box>

            <List>
              {files.map((f, i) => {
                const job = jobs.find((j) => j.input === f.input)
                const result = job ? resultByJob.get(job.id) : undefined
                return (
                  <ListItem
                    key={f.input}
                    sx={{ border: 1, borderColor: 'divider', borderRadius: 2, mb: 1, flexWrap: 'wrap', gap: 1 }}
                  >
                    <Typography variant="body2" sx={{ flexGrow: 1, wordBreak: 'break-all' }}>
                      {fileName(f.input)}
                    </Typography>
                    <FormControl size="small" sx={{ minWidth: 110 }}>
                      <InputLabel id={`batch-target-${i}-label`}>Format</InputLabel>
                      <Select
                        labelId={`batch-target-${i}-label`}
                        value={f.target}
                        disabled={running}
                        aria-label={`Target format for ${fileName(f.input)}`}
                        label="Format"
                        onChange={(e) =>
                          setFiles((prev) => prev.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))
                        }
                      >
                        {encodable.map((c) => (
                          <MenuItem key={c.format_id} value={c.format_id}>
                            {c.format_id.toUpperCase()}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Chip
                      role="status"
                      size="small"
                      label={
                        `${job?.status ?? 'Queued'}` +
                        (result && result.status === 'Done' ? ` · ${formatBytes(result.bytes)}` : '')
                      }
                      color={
                        job?.status === 'Done'
                          ? 'success'
                          : job?.status === 'Failed'
                            ? 'error'
                            : job?.status === 'Running'
                              ? 'info'
                              : 'default'
                      }
                    />
                    {result?.error && (
                      <Typography variant="caption" color="error" sx={{ width: '100%' }}>
                        {result.error}
                      </Typography>
                    )}
                    {!running && (
                      <IconButton
                        type="button"
                        size="small"
                        aria-label={`Remove ${fileName(f.input)}`}
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    )}
                    {job && job.status === 'Queued' && running && (
                      <Button
                        type="button"
                        size="small"
                        onClick={() => void batchCancel(job.id).then(() => void refresh())}
                      >
                        Cancel
                      </Button>
                    )}
                  </ListItem>
                )
              })}
            </List>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
              <Button
                type="button"
                variant="contained"
                onClick={() => void start()}
                disabled={running || files.length === 0}
              >
                Start batch ({settings.batchWorkers} worker{settings.batchWorkers === 1 ? '' : 's'})
              </Button>
              {running && (
                <>
                  <Button type="button" variant="outlined" onClick={() => void batchPause().then(() => void refresh())}>
                    Pause queue
                  </Button>
                  <Button type="button" variant="outlined" onClick={() => void batchResume().then(() => void refresh())}>
                    Resume
                  </Button>
                  <Button type="button" variant="outlined" onClick={() => void batchCancelAll().then(() => void refresh())}>
                    Cancel all queued
                  </Button>
                </>
              )}
              {done && progress !== null && progress.failed > 0 && (
                <Button type="button" variant="outlined" onClick={() => void batchRetryFailed().then(() => void refresh())}>
                  Retry {progress.failed} failed
                </Button>
              )}
            </Box>

            {progress && (
              <Typography variant="body2" color="text.secondary" role="status" sx={{ mt: 2 }}>
                {progress.done} done · {progress.failed} failed · {progress.running} running ·{' '}
                {progress.queued} queued · {progress.cancelled} cancelled · {progress.paused} paused
                (total {progress.total})
              </Typography>
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  )
}
