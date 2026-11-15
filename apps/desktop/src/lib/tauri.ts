/**
 * Typed wrappers over the Tauri backend commands (see
 * src-tauri/src/commands.rs) plus the pure path/format helpers the
 * UI and the tests share.
 *
 * Capabilities come LIVE from the engine on every launch
 * (`get_capabilities`) — the desktop app never ships a generated or
 * hand-written format list, so the Formats tab and the output
 * selectors always match the registry (21 formats).
 */
import { invoke } from '@tauri-apps/api/core'

export interface FormatCapability {
  format_id: string
  extensions: string[]
  mime_types: string[]
  can_decode: boolean
  can_encode: boolean
  supports_alpha: boolean
  supports_animation: boolean
  supports_metadata: boolean
  supports_icc: boolean
  supports_multiple_frames: boolean
  native_dependency: string
  license: string
  status: string
  max_dimension: number
}

export interface ImageInfo {
  format: string
  width: number
  height: number
  color_type: string
  has_alpha: boolean
  file_size_bytes: number
  is_animated: boolean
  frame_count: number | null
  note: string | null
  orientation: number | null
  has_exif: boolean
  has_icc: boolean
  has_xmp: boolean
}

export interface Metadata {
  orientation: number | null
  camera_make: string | null
  camera_model: string | null
  date_time: string | null
  gps: [number, number] | null
  gps_altitude_m: number | null
  dpi: [number, number] | null
  software: string | null
  artist: string | null
  icc: { description: string | null; is_srgb: boolean; size_bytes: number } | null
  xmp: string | null
  warnings: string[]
}

export interface FrameInfo {
  index: number
  width: number
  height: number
  offset_x: number
  offset_y: number
  delay_ms: number | null
  disposal: number | null
  is_keyframe: boolean
}

export interface AnimationInfo {
  format: string
  frame_count: number
  is_animated: boolean
  is_multi_page: boolean
  loop_count: number | null
  frames: FrameInfo[]
  note: string | null
}

export interface ConvertResult {
  source_format: string
  target_format: string
  width: number
  height: number
  input_bytes: number
  output_bytes: number
  output_path: string
  warnings: string[]
  metadata_preserved: string[]
  metadata_dropped: string[]
  orientation_applied: string | null
}

export interface ConvertRequest {
  quality: number | null
  png_compression: number | null
  background: string
  metadata_policy: string | null
  selected_frame: number | null
  convert_to_srgb: boolean
}

export interface PipelineRequest {
  resize_fit: [number, number] | null
  grayscale: boolean
  rotate_degrees: number | null
  flip_horizontal: boolean
  flip_vertical: boolean
}

export type JobStatus = 'Queued' | 'Running' | 'Done' | 'Failed' | 'Cancelled' | 'Paused'

export interface Job {
  id: number
  input: string
  output: string
  target: string
  options: ConvertRequest
  status: JobStatus
}

export interface JobResult {
  job_id: number
  input: string
  output: string
  bytes: number
  duration_ms: number
  error: string | null
  status: JobStatus
}

export interface BatchProgress {
  total: number
  queued: number
  running: number
  done: number
  failed: number
  cancelled: number
  paused: number
}

export interface BatchStarted {
  job_ids: number[]
  workers: number
  total: number
}

export interface BatchFileRequest {
  input: string
  output: string
  target: string
  options: ConvertRequest
}

export interface AppInfo {
  name: string
  version: string
  engine_version: string
  offline: boolean
  log_path: string
  format_count: number
}

export interface LogView {
  path: string
  lines: string[]
}

// ---- invoke wrappers (one per backend command) ----

export function fetchCapabilities(): Promise<FormatCapability[]> {
  return invoke<FormatCapability[]>('get_capabilities')
}

export function fetchAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>('app_info')
}

export function fetchImageInfo(path: string): Promise<ImageInfo> {
  return invoke<ImageInfo>('get_image_info', { path })
}

export function listDirectoryImages(dir: string): Promise<string[]> {
  return invoke<string[]>('list_directory_images', { dir })
}

export function fetchMetadata(path: string): Promise<Metadata> {
  return invoke<Metadata>('read_metadata', { path })
}

export function fetchFrames(path: string): Promise<AnimationInfo> {
  return invoke<AnimationInfo>('list_frames', { path })
}

export function convertFile(
  input: string,
  output: string,
  target: string,
  options: ConvertRequest,
): Promise<ConvertResult> {
  return invoke<ConvertResult>('convert_file', { input, output, target, options })
}

export function processFile(
  input: string,
  output: string,
  target: string,
  options: ConvertRequest,
  pipeline: PipelineRequest,
): Promise<ConvertResult> {
  return invoke<ConvertResult>('process_file', { input, output, target, options, pipeline })
}

export function extractFrame(
  input: string,
  output: string,
  index: number,
  options: ConvertRequest,
): Promise<ConvertResult> {
  return invoke<ConvertResult>('extract_frame', { input, output, index, options })
}

export function startBatch(files: BatchFileRequest[], workers: number): Promise<BatchStarted> {
  return invoke<BatchStarted>('start_batch', { files, workers })
}

export function fetchBatchProgress(): Promise<BatchProgress> {
  return invoke<BatchProgress>('batch_progress')
}

export function fetchBatchJobs(): Promise<Job[]> {
  return invoke<Job[]>('batch_jobs')
}

export function fetchBatchResults(): Promise<JobResult[]> {
  return invoke<JobResult[]>('batch_results')
}

export function batchPause(): Promise<void> {
  return invoke<void>('batch_pause')
}

export function batchResume(): Promise<void> {
  return invoke<void>('batch_resume')
}

export function batchCancelAll(): Promise<number> {
  return invoke<number>('batch_cancel_all')
}

export function batchCancel(id: number): Promise<boolean> {
  return invoke<boolean>('batch_cancel', { id })
}

export function batchRetryFailed(): Promise<number> {
  return invoke<number>('batch_retry_failed')
}

export function fetchLogs(maxLines?: number): Promise<LogView> {
  return invoke<LogView>('read_logs', { maxLines: maxLines ?? null })
}

// ---- Pure helpers (no Tauri dependency — covered by unit tests) ----

export function formatById(capabilities: FormatCapability[], formatId: string): FormatCapability | undefined {
  return capabilities.find((c) => c.format_id === formatId)
}

/** Formats the engine can encode to (the output selector's options). */
export function encodableFormats(capabilities: FormatCapability[]): FormatCapability[] {
  return capabilities.filter((c) => c.can_encode)
}

/** Formats the engine can decode (accepted by the open-file dialog). */
export function decodableFormats(capabilities: FormatCapability[]): FormatCapability[] {
  return capabilities.filter((c) => c.can_decode)
}

/** All extensions the open-file dialog should accept. */
export function decodableExtensions(capabilities: FormatCapability[]): string[] {
  const out: string[] = []
  for (const cap of decodableFormats(capabilities)) {
    for (const ext of cap.extensions) {
      if (!out.includes(ext)) out.push(ext)
    }
  }
  return out.sort()
}

/** First extension of a format, e.g. 'jpeg' -> 'jpg'. */
export function primaryExtension(capabilities: FormatCapability[], formatId: string): string {
  return formatById(capabilities, formatId)?.extensions[0] ?? formatId
}

export function formatLabel(capabilities: FormatCapability[], formatId: string): string {
  const cap = formatById(capabilities, formatId)
  if (!cap) return formatId.toUpperCase()
  return `${formatId.toUpperCase()} (.${cap.extensions.join(', .')})`
}

/** Output path for a conversion: same folder, same stem, the target's primary extension. */
export function defaultOutputPath(
  inputPath: string,
  targetFormat: string,
  capabilities: FormatCapability[],
): string {
  const ext = primaryExtension(capabilities, targetFormat)
  const dot = inputPath.lastIndexOf('.')
  const slash = Math.max(inputPath.lastIndexOf('/'), inputPath.lastIndexOf('\\'))
  const stem = dot > slash ? inputPath.slice(0, dot) : inputPath
  return `${stem}.${ext}`
}

/** File name (no directory) of a path, either separator. */
export function fileName(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash >= 0 ? path.slice(slash + 1) : path
}

/** Directory of a path, either separator ('' when there is none). */
export function dirName(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash >= 0 ? path.slice(0, slash) : ''
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}
