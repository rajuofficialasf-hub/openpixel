/**
 * Browser OCR via tesseract.js 7.0.0 (Studio Phase 4).
 *
 * Everything is self-hosted — the app is local-first and must never
 * fetch from a CDN at runtime. tesseract.js v7 defaults to jsDelivr
 * for all three of its runtime downloads (the worker script, the
 * Tesseract core and the language data), so `createWorker` here is
 * always called with local paths:
 *
 *   workerPath  /tesseract/worker.min.js
 *   corePath    /tesseract/tesseract-core-lstm.wasm.js
 *   langPath    /tessdata/              (eng/ben .traineddata)
 *
 * The core file is the LSTM-only build, pointed at directly (a path
 * ending in `.js` is imported as-is by the worker — no SIMD variant
 * detection). It is the plain build, so it runs on every browser;
 * the SIMD builds would be marginally faster but would triple the
 * shipped core. Its wasm binary is embedded as base64 inside the
 * file (`wa ??= Ga("AGFzbQE...")` in the installed package), so no
 * separate `.wasm` fetch happens. `gzip: false` because the shipped
 * tessdata_fast files are plain `.traineddata`, not `.gz`, and
 * `cacheMethod: 'none'` so no stale language data can linger in
 * IndexedDB across deploys — the files are re-fetched from this
 * site on each worker start.
 *
 * v7 API, read from the installed package (not from memory — v7
 * differs from v5/v6): `createWorker(langs, oem, options)` resolves
 * only after the worker has internally loaded the core, loaded the
 * language data and initialised — there are no separate
 * `loadLanguage` / `initialize` calls to make (those survive only
 * as `worker.reinitialize`). After that, `setParameters` then
 * `recognize(image)`; `recognize` resolves to
 * `{ data: { text, confidence, ... } }` where `confidence` is the
 * mean word confidence (0–100).
 *
 * The tesseract.js module itself is dynamically imported, so its
 * code is a lazy chunk fetched only when OCR actually runs — no
 * worker script, core or language file is fetched at page load, or
 * before the user opens this tab and runs OCR. The worker is cached
 * per language string, so a second run in the same language reuses
 * it instead of re-downloading the language data.
 *
 * This is the browser engine, not the native one: same Tesseract
 * engine family as the CLI/desktop (`openpixel ocr`), but slower,
 * with accuracy that can differ, and with no preprocessing pipeline
 * like the CLI. The UI says so wherever a result is shown.
 */
import { translate, type Language } from './i18n'

export type OcrLanguage = 'eng' | 'ben' | 'eng+ben'
export type OcrPsmId = 'auto' | 'single-block' | 'single-line'

/** Languages offered in the picker. `eng+ben` loads both files. */
export const OCR_LANGUAGES = ['eng', 'ben', 'eng+ben'] as const

export const OCR_LANGUAGE_LABELS: Record<OcrLanguage, string> = {
  eng: 'English',
  ben: 'Bengali',
  'eng+ben': 'English + Bengali',
}

/** Page segmentation modes offered in the picker. */
export const OCR_PSM_MODES = [
  { id: 'auto', label: 'Auto', psm: '3' },
  { id: 'single-block', label: 'Single block', psm: '6' },
  { id: 'single-line', label: 'Single line', psm: '7' },
] as const

/** Engine label shown with every result — never the native engine. */
export const OCR_ENGINE_LABEL = 'tesseract.js (browser)'

/**
 * Parse a language picker value into Tesseract language codes.
 * Returns `null` for anything outside the picker (never passed to
 * the engine unchecked).
 */
export function resolveOcrLanguages(value: string): OcrLanguage | null {
  return (OCR_LANGUAGES as readonly string[]).includes(value) ? (value as OcrLanguage) : null
}

/** The `tessedit_pageseg_mode` value for a picker id. */
export function psmValueFor(id: OcrPsmId): string {
  return OCR_PSM_MODES.find((m) => m.id === id)?.psm ?? '3'
}

/** Count words the way the result line reports them. */
export function countWords(text: string): number {
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  return words.length
}

/** One decimal, e.g. `87.4%`. */
export function formatConfidence(confidence: number): string {
  return `${confidence.toFixed(1)}%`
}

/** Seconds with one decimal, e.g. `3.2 s`. */
export function formatDurationMs(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)} s`
}

/** Output filename for the recognised text, e.g. `scan-ocr.txt`. */
export function ocrOutputName(fileName: string): string {
  const base = fileName.replace(/\.[^.]*$/, '')
  return `${base === '' ? 'ocr' : base}-ocr.txt`
}

/** What a completed recognition returns, shaped for the UI. */
export interface OcrResult {
  text: string
  /** Mean word confidence, 0–100, as reported by Tesseract. */
  confidence: number
  wordCount: number
  durationMs: number
  language: OcrLanguage
  psm: OcrPsmId
  engine: typeof OCR_ENGINE_LABEL
}

/**
 * Shape a raw tesseract.js `data` page into an `OcrResult`.
 * Pure — the unit tests cover this, never a real recognition.
 */
export function shapeOcrResult(
  raw: { text: string; confidence: number },
  language: OcrLanguage,
  psm: OcrPsmId,
  durationMs: number,
): OcrResult {
  const text = raw.text.replace(/\s+$/u, '')
  return {
    text,
    confidence: raw.confidence,
    wordCount: countWords(text),
    durationMs,
    language,
    psm,
    engine: OCR_ENGINE_LABEL,
  }
}

/** Progress reported while a worker loads or recognises. */
export interface OcrProgress {
  /** Human label for the current phase. */
  status: string
  /** 0–1 within the current phase. */
  progress: number
}

export interface RecognizeOptions {
  language: OcrLanguage
  psm: OcrPsmId
  /** Grayscale + contrast the image on a canvas first. */
  enhance: boolean
  onProgress?: (progress: OcrProgress) => void
  /** UI language for progress/error strings (default English). */
  lang?: Language
}

type TesseractWorker = {
  setParameters: (params: { tessedit_pageseg_mode: string }) => Promise<unknown>
  recognize: (image: Blob) => Promise<{ data: { text: string; confidence: number } }>
  terminate: () => Promise<unknown>
}

let cachedWorker: { language: OcrLanguage; worker: TesseractWorker } | null = null
let progressListener: ((progress: OcrProgress) => void) | null = null

const STATUS_LABEL_KEYS: Record<string, string> = {
  'initializing tesseract': 'ocr.progressLoadingEngine',
  'loading language traineddata': 'ocr.progressLoadingLang',
  'recognizing text': 'ocr.progressRecognising',
}

async function getWorker(language: OcrLanguage, lang: Language = 'en'): Promise<TesseractWorker> {
  if (cachedWorker && cachedWorker.language === language) return cachedWorker.worker
  if (cachedWorker) {
    await cachedWorker.worker.terminate().catch(() => undefined)
    cachedWorker = null
  }
  // Dynamic import: the tesseract.js chunk is fetched only when OCR
  // runs, never at page load.
  const { createWorker } = await import('tesseract.js')
  const worker = (await createWorker(language, undefined, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/tesseract-core-lstm.wasm.js',
    langPath: '/tessdata/',
    gzip: false,
    cacheMethod: 'none',
    workerBlobURL: false,
    logger: (message: { status: string; progress: number }) => {
      progressListener?.({
        status: STATUS_LABEL_KEYS[message.status]
          ? translate(lang, STATUS_LABEL_KEYS[message.status])
          : message.status,
        progress: message.progress,
      })
    },
  })) as unknown as TesseractWorker
  cachedWorker = { language, worker }
  return worker
}

/**
 * Grayscale + contrast an image on a canvas and return a PNG blob.
 * A manual pixel loop (not `ctx.filter`) so the result is identical
 * in every browser. Throws when canvas APIs are unavailable.
 */
export async function enhanceImageForOcr(blob: Blob, lang: Language = 'en'): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(translate(lang, 'ocr.enhanceError'))
    ctx.drawImage(bitmap, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data
    const contrast = 1.4
    for (let i = 0; i < data.length; i += 4) {
      const grey = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      const adjusted = (grey - 128) * contrast + 128
      const clamped = adjusted < 0 ? 0 : adjusted > 255 ? 255 : adjusted
      data[i] = clamped
      data[i + 1] = clamped
      data[i + 2] = clamped
    }
    ctx.putImageData(imageData, 0, 0)
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!out) throw new Error(translate(lang, 'ocr.enhanceError'))
    return out
  } finally {
    bitmap.close()
  }
}

/**
 * Recognise the text in an image blob. Loads the worker (and its
 * language data) on first use for the language; the caller reports
 * progress and owns any error message.
 */
export async function recognizeImage(image: Blob, options: RecognizeOptions): Promise<OcrResult> {
  const startedAt = Date.now()
  progressListener = options.onProgress ?? null
  try {
    const worker = await getWorker(options.language, options.lang ?? 'en')
    await worker.setParameters({ tessedit_pageseg_mode: psmValueFor(options.psm) })
    const input = options.enhance ? await enhanceImageForOcr(image, options.lang ?? 'en') : image
    const { data } = await worker.recognize(input)
    return shapeOcrResult(data, options.language, options.psm, Date.now() - startedAt)
  } finally {
    progressListener = null
  }
}
