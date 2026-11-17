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

// ---- PDF / OCR / document types + invoke wrappers (Phase 7) ----

export interface PdfInfo {
  page_count: number
  version: string
  title: string | null
  author: string | null
  subject: string | null
  keywords: string | null
  creator: string | null
  producer: string | null
  encrypted: boolean
  encryption: {
    algorithm: string
    revision: number | null
    print: boolean
    modify: boolean
    copy: boolean
    annotate: boolean
  } | null
  page_sizes: [number, number][]
}

export interface PdfThreats {
  javascript: string[]
  embedded_files: string[]
  launch_actions: string[]
  auto_actions: string[]
  warnings: string[]
}

export interface DesktopCapabilities {
  pdfium_present: boolean
  tesseract_present: boolean
  tesseract_version: string | null
  tesseract_languages: string[]
  libreoffice_present: boolean
  libreoffice_version: string | null
}

export interface PdfFileResult {
  output: string
  page_count: number
  input_bytes: number
  output_bytes: number
}

export interface PdfSplitResult {
  outputs: string[]
  page_counts: number[]
}

export interface CompressOutcome {
  mode: string
  input_bytes: number
  output_bytes: number
  compressed_bytes: number
  saved_bytes: number
  saved_percent: number
  images_total: number
  images_recompressed: number
  images_skipped: number
  skipped_reasons: string[]
  metadata_stripped: boolean
  note: string | null
}

export interface PdfCompressResult {
  output: string
  outcome: CompressOutcome
}

export interface EditOutcome {
  ops_applied: number
  pages_touched: number
  comments_added: number
  warnings: string[]
}

export interface PdfEditResult {
  output: string
  outcome: EditOutcome
}

export interface RedactOutcome {
  pages_touched: number
  runs_removed: number
  characters_removed: number
  annotations_removed: number
  redacted_texts: string[]
  warnings: string[]
}

export interface PdfRedactResult {
  output: string
  outcome: RedactOutcome
}

export interface FlattenOutcome {
  annotations_flattened: number
  annotations_dropped: number
  form_fields_removed: number
  warnings: string[]
}

export interface PdfFlattenResult {
  output: string
  outcome: FlattenOutcome
}

export interface SanitizeOutcome {
  javascript_removed: number
  embedded_files_removed: number
  launch_actions_removed: number
  auto_actions_removed: number
  warnings: string[]
}

export interface PdfSanitizeResult {
  output: string
  outcome: SanitizeOutcome
}

export interface RepairOutcome {
  recovery: string
  warnings: string[]
}

export interface PdfRepairResult {
  output: string
  outcome: RepairOutcome
}

export interface PageText {
  page: number
  text: string
  lines: { text: string; x: number; y_top: number; width: number; height: number }[]
}

export interface PdfTextResult {
  pages: PageText[]
  text: string
  output: string | null
}

export interface PdfImagesResult {
  outputs: string[]
}

export interface OcrWord {
  text: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
}

export interface OcrResult {
  text: string
  words: OcrWord[]
  mean_confidence: number
  language: string
  engine: string
  width: number
  height: number
  duration_ms: number
  preprocessed: string[]
}

export interface OcrSearchableResult {
  output: string
  page_count: number
  results: OcrResult[]
}

export interface ConversionOutcome {
  source: string
  target: string
  engine: string
  input_bytes: number
  output_bytes: number
  fidelity: string
}

export interface DocumentConversion {
  source: string
  target: string
  engine: string
  runs_where: string
  fidelity: string
}

export interface PdfPageOpRequest {
  op: string
  pages: number[] | null
  degrees: number | null
  order: number[] | null
  cols: number | null
  rows: number | null
}

export interface PdfEditRequest {
  text: string | null
  text_page: number | null
  text_x: number | null
  text_y: number | null
  text_size: number | null
  page_numbers: boolean
  page_number_position: string | null
  header: string | null
  footer: string | null
}

export interface PdfRedactRequest {
  texts: string[]
  rects: { page: number; x: number; y: number; width: number; height: number }[]
}

export interface OcrRequest {
  languages: string[]
  psm: number | null
  preprocess: string | null
}

export interface MetadataEdit {
  title: string | null
  author: string | null
  subject: string | null
  keywords: string | null
  creator: string | null
  producer: string | null
}

export function fetchDesktopCapabilities(): Promise<DesktopCapabilities> {
  return invoke<DesktopCapabilities>('get_desktop_capabilities')
}

export function fetchPdfInfo(path: string): Promise<PdfInfo> {
  return invoke<PdfInfo>('pdf_info', { path })
}

export function fetchPdfThreats(path: string): Promise<PdfThreats> {
  return invoke<PdfThreats>('pdf_inspect', { path })
}

export function pdfMerge(inputs: string[], output: string): Promise<PdfFileResult> {
  return invoke<PdfFileResult>('pdf_merge', { inputs, output })
}

export function pdfSplit(
  input: string,
  ranges: [number, number][],
  outputDir: string,
): Promise<PdfSplitResult> {
  return invoke<PdfSplitResult>('pdf_split', { input, ranges, outputDir })
}

export function pdfPageOp(
  input: string,
  output: string,
  request: PdfPageOpRequest,
): Promise<PdfFileResult> {
  return invoke<PdfFileResult>('pdf_page_op', { input, output, request })
}

export function pdfCompress(
  input: string,
  output: string,
  mode: string,
  stripMetadata: boolean,
): Promise<PdfCompressResult> {
  return invoke<PdfCompressResult>('pdf_compress', { input, output, mode, stripMetadata })
}

export function pdfEdit(
  input: string,
  output: string,
  request: PdfEditRequest,
): Promise<PdfEditResult> {
  return invoke<PdfEditResult>('pdf_edit', { input, output, request })
}

export function pdfRedact(
  input: string,
  output: string,
  request: PdfRedactRequest,
): Promise<PdfRedactResult> {
  return invoke<PdfRedactResult>('pdf_redact', { input, output, request })
}

export function pdfFlatten(input: string, output: string): Promise<PdfFlattenResult> {
  return invoke<PdfFlattenResult>('pdf_flatten', { input, output })
}

export function pdfSetMetadata(
  input: string,
  output: string,
  edit: MetadataEdit,
): Promise<PdfFileResult> {
  return invoke<PdfFileResult>('pdf_set_metadata', { input, output, edit })
}

export function pdfSanitize(input: string, output: string): Promise<PdfSanitizeResult> {
  return invoke<PdfSanitizeResult>('pdf_sanitize', { input, output })
}

export function pdfRepair(input: string, output: string): Promise<PdfRepairResult> {
  return invoke<PdfRepairResult>('pdf_repair', { input, output })
}

export function pdfExtractText(
  input: string,
  pages: number[] | null,
  format: string,
  output: string | null,
): Promise<PdfTextResult> {
  return invoke<PdfTextResult>('pdf_extract_text', { input, pages, format, output })
}

export function pdfFromImages(
  inputs: string[],
  output: string,
  pageSize: string | null,
): Promise<PdfFileResult> {
  return invoke<PdfFileResult>('pdf_from_images', { inputs, output, pageSize })
}

export function pdfToImages(
  input: string,
  outputDir: string,
  pages: number[] | null,
  scale: number,
  format: string,
): Promise<PdfImagesResult> {
  return invoke<PdfImagesResult>('pdf_to_images', { input, outputDir, pages, scale, format })
}

export function ocrRecognize(input: string, request: OcrRequest): Promise<OcrResult> {
  return invoke<OcrResult>('ocr_recognize', { input, request })
}

export function pdfOcrSearchable(
  inputs: string[],
  output: string,
  request: OcrRequest,
  title: string,
): Promise<OcrSearchableResult> {
  return invoke<OcrSearchableResult>('pdf_ocr_searchable', { inputs, output, request, title })
}

export function docConvert(
  input: string,
  output: string,
  target: string,
  sourceHint: string | null,
): Promise<ConversionOutcome> {
  return invoke<ConversionOutcome>('doc_convert', { input, output, target, sourceHint })
}

export function fetchDocFormats(): Promise<DocumentConversion[]> {
  return invoke<DocumentConversion[]>('doc_formats')
}

// ---- Pure PDF helpers (no Tauri dependency — covered by unit tests) ----

/**
 * Parse a page list like "1, 3-5, 8" into 1-based page numbers.
 * Returns null for empty input; throws on a bad token or a
 * reversed range. Duplicates are kept (extract/reorder allow them);
 * callers that need a set de-duplicate.
 */
export function parsePageList(spec: string): number[] | null {
  const trimmed = spec.trim()
  if (trimmed === '') return null
  const out: number[] = []
  for (const part of trimmed.split(',')) {
    const token = part.trim()
    if (token === '') throw new Error(`empty entry in page list "${spec}"`)
    const dash = token.indexOf('-')
    if (dash >= 0) {
      const start = Number(token.slice(0, dash).trim())
      const end = Number(token.slice(dash + 1).trim())
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
        throw new Error(`bad page range "${token}" — use e.g. 3-5`)
      }
      for (let p = start; p <= end; p++) out.push(p)
    } else {
      const page = Number(token)
      if (!Number.isInteger(page) || page < 1) {
        throw new Error(`bad page number "${token}" — pages start at 1`)
      }
      out.push(page)
    }
  }
  return out
}

/** Parse a split spec like "1-2, 3-5" into inclusive ranges. */
export function parseRanges(spec: string): [number, number][] {
  const trimmed = spec.trim()
  if (trimmed === '') throw new Error('split needs at least one range, e.g. 1-2, 3-5')
  const out: [number, number][] = []
  for (const part of trimmed.split(',')) {
    const token = part.trim()
    const dash = token.indexOf('-')
    if (dash < 0) {
      const page = Number(token)
      if (!Number.isInteger(page) || page < 1) {
        throw new Error(`bad split range "${token}" — use e.g. 1-2`)
      }
      out.push([page, page])
    } else {
      const start = Number(token.slice(0, dash).trim())
      const end = Number(token.slice(dash + 1).trim())
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
        throw new Error(`bad split range "${token}" — use e.g. 1-2`)
      }
      out.push([start, end])
    }
  }
  return out
}

/** Clamp a split/extract page list to the document's page count. */
export function clampPages(pages: number[], pageCount: number): number[] {
  return pages.filter((p) => p >= 1 && p <= pageCount)
}
