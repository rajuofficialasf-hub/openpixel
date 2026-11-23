/**
 * The loaded-PDF hook every PDF tool page shares: the file, the
 * WASM engine state, the status/error/results state and the
 * generic `runOp` (one `pdf_process` call). Kept in its own file
 * so the component file (`shared.tsx`) only exports components
 * (fast-refresh rule).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getPdfInfo,
  getPdfPageCountViaPdfJs,
  pdfOutputName,
  pdfProcess,
  type PdfInfo,
} from '../../lib/pdf'
import { loadWasmEngine } from '../../lib/wasm-engine'
import { recordActivity } from '../../lib/activity'
import { translate, type Language } from '../../lib/i18n'
import { useI18n } from '../../lib/use-i18n'

export interface PdfToolProps {
  /** A PDF handed over from the homepage upload or the picker — consumed once. */
  initialFiles?: File[]
  onInitialFilesConsumed?: () => void
}

export interface PdfResult {
  label: string
  blob: Blob
  filename: string
  pages: number | null
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const wasmMissing = (label: string, lang: Language = 'en'): string =>
  translate(lang, 'pdf.wasmMissing', { label })

export interface UsePdfFile {
  file: File | null
  bytes: Uint8Array<ArrayBuffer> | null
  info: PdfInfo | null
  pageCount: number
  wasmReady: boolean | null
  loading: boolean
  error: string | null
  status: string | null
  results: PdfResult[]
  busy: string | null
  setError: (error: string | null) => void
  setStatus: (status: string | null) => void
  /**
   * Set the status from an i18n key (+ params) — the displayed
   * text is translated now, and the same key/params are stored
   * with the activity entry so My Files / Recent Files render it
   * localised at read time too.
   */
  setStatusKey: (key: string, vars?: Record<string, string | number>) => void
  /** The translated `wasmMissing` error for an operation label. */
  wasmMissing: (label: string) => string
  setResults: (results: PdfResult[]) => void
  setBusy: (busy: string | null) => void
  handleFiles: (files: File[]) => Promise<void>
  clearFile: () => void
  /** One `pdf_process` call; result re-checked with `getPdfInfo`. */
  runOp: (label: string, opsJson: string, suffix: string) => Promise<void>
}

/**
 * The loaded PDF + the engine/result state every PDF tool page
 * needs. `tool` is the route id, recorded in the workspace
 * history so "recently used" opens the exact tool.
 */
export function usePdfFile(
  tool: string,
  initialFiles?: File[],
  onInitialFilesConsumed?: () => void,
): UsePdfFile {
  const [file, setFile] = useState<File | null>(null)
  const [bytes, setBytes] = useState<Uint8Array<ArrayBuffer> | null>(null)
  const [info, setInfo] = useState<PdfInfo | null>(null)
  const [pdfjsPages, setPdfjsPages] = useState<number | null>(null)
  const [wasmReady, setWasmReady] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const { t, lang } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatusState] = useState<string | null>(null)
  const [results, setResults] = useState<PdfResult[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  // Language-neutral form of the current status, for the activity
  // record. A plain setStatus() clears it (the string is already
  // localised and has no key to re-render from).
  const statusRecordRef = useRef<{ key: string; params: Record<string, string | number> } | null>(null)

  const setStatus = useCallback((next: string | null) => {
    statusRecordRef.current = null
    setStatusState(next)
  }, [])

  const setStatusKey = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      statusRecordRef.current = { key, params: vars ?? {} }
      setStatusState(t(key, vars))
    },
    [t],
  )

  const wasmMissingError = useCallback((label: string) => wasmMissing(label, lang), [lang])

  const pageCount = info?.page_count ?? pdfjsPages ?? 0

  useEffect(() => {
    let live = true
    loadWasmEngine().then((mod) => {
      if (live) setWasmReady(mod !== null)
    })
    return () => {
      live = false
    }
  }, [])

  const handleFiles = useCallback(async (files: File[]) => {
    const next = files[0]
    if (!next) return
    setLoading(true)
    setError(null)
    setStatus(null)
    setResults([])
    setInfo(null)
    setPdfjsPages(null)
    const data = new Uint8Array(await next.arrayBuffer())
    setFile(next)
    setBytes(data)
    // Info comes from the WASM engine when it is loaded; the page
    // count falls back to pdf.js, so the page still shows it
    // without the module. An encrypted PDF reports `encrypted:
    // true` instead of erroring — refuse it here: the browser
    // cannot open it (every WASM op and pdf.js refuse encrypted
    // inputs), so the native CLI is the only route.
    const pdfInfo = await getPdfInfo(data)
    if (pdfInfo?.encrypted) {
      setFile(null)
      setBytes(null)
      setError(
        pdfInfo.encryption
          ? t('pdf.encryptedAlg', { alg: pdfInfo.encryption.algorithm })
          : t('pdf.encrypted'),
      )
      setLoading(false)
      return
    }
    if (pdfInfo) {
      setInfo(pdfInfo)
    } else {
      try {
        setPdfjsPages(await getPdfPageCountViaPdfJs(data))
      } catch {
        setFile(null)
        setBytes(null)
        setError(t('pdf.unreadable'))
      }
    }
    setLoading(false)
  }, [t, setStatus])

  // Homepage / picker / paste / chaining hand-off: consume each
  // distinct `initialFiles` reference once (StrictMode-safe, and also
  // supports pasting a new PDF into an already-open PDF tool).
  const lastInitialRef = useRef<File[] | null>(null)
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0 && lastInitialRef.current !== initialFiles) {
      lastInitialRef.current = initialFiles
      void handleFiles(initialFiles)
      onInitialFilesConsumed?.()
    }
  }, [initialFiles, handleFiles, onInitialFilesConsumed])

  // Workspace history: record one entry per produced result set.
  const recordedResultsRef = useRef<PdfResult[] | null>(null)
  useEffect(() => {
    if (results.length > 0 && recordedResultsRef.current !== results && status && file) {
      recordedResultsRef.current = results
      recordActivity({
        fileName: file.name,
        fileSize: file.size,
        fileType: 'application/pdf',
        tool,
        result: status,
        resultKey: statusRecordRef.current?.key,
        resultParams: statusRecordRef.current?.params,
      })
    }
  }, [results, status, file, tool])

  const clearFile = useCallback(() => {
    setFile(null)
    setBytes(null)
    setInfo(null)
    setPdfjsPages(null)
    setResults([])
    setStatus(null)
    setError(null)
  }, [setStatus])

  const runOp = useCallback(
    async (label: string, opsJson: string, suffix: string) => {
      if (!bytes || !file) return
      setBusy(label)
      setError(null)
      setStatus(null)
      const outputs = await pdfProcess(bytes, opsJson)
      if (!outputs) {
        setError(wasmMissing(label, lang))
        setBusy(null)
        return
      }
      const next: PdfResult[] = []
      for (let i = 0; i < outputs.length; i++) {
        const out = outputs[i]
        const outInfo = await getPdfInfo(out)
        next.push({
          label: outputs.length > 1 ? `${label} — part ${i + 1}` : label,
          blob: new Blob([out as BlobPart], { type: 'application/pdf' }),
          filename: pdfOutputName(file.name, outputs.length > 1 ? `${suffix}-${i + 1}` : suffix),
          pages: outInfo?.page_count ?? null,
        })
      }
      setResults(next)
      if (outputs.length > 1) {
        setStatusKey('pdf.opStatusSplit', {
          label,
          n: outputs.length,
          parts: next.map((r) => t('pdf.pagesCount', { n: r.pages ?? '?' })).join(', '),
        })
      } else {
        setStatusKey('pdf.opStatusPages', { label, n: next[0].pages ?? '?' })
      }
      setBusy(null)
    },
    [bytes, file, lang, setStatus, setStatusKey, t],
  )

  return {
    file,
    bytes,
    info,
    pageCount,
    wasmReady,
    loading,
    error,
    status,
    results,
    busy,
    setError,
    setStatus,
    setStatusKey,
    wasmMissing: wasmMissingError,
    setResults,
    setBusy,
    handleFiles,
    clearFile,
    runOp,
  }
}
