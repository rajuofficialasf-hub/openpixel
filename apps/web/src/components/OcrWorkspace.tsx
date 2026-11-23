import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  FormControlLabel,
  LinearProgress,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DownloadIcon from '@mui/icons-material/Download'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import { formatBytes } from '../lib/capabilities'
import { recordActivity } from '../lib/activity'
import {
  countWords,
  formatConfidence,
  formatDurationMs,
  OCR_ENGINE_LABEL,
  ocrOutputName,
  recognizeImage,
  OCR_LANGUAGE_LABELS,
  OCR_LANGUAGES,
  OCR_PSM_MODES,
  type OcrLanguage,
  type OcrProgress,
  type OcrPsmId,
  type OcrResult,
} from '../lib/ocr'
import { getPdfPageCountViaPdfJs, parsePageList, renderPdfPageBlob } from '../lib/pdf'
import { DropZone } from './DropZone'
import { EditorShell } from './EditorShell'
import { ToolPageHeader } from './ToolPage'
import { WorkflowSteps } from './WorkflowSteps'
import { plural } from '../lib/i18n'
import { useI18n } from '../lib/use-i18n'

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

interface OcrWorkspaceProps {
  initialFiles?: File[]
  onInitialFilesConsumed?: () => void
}

export function OcrWorkspace({ initialFiles, onInitialFilesConsumed }: OcrWorkspaceProps = {}) {
  const { t, lang } = useI18n()
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null)
  const [pdfPageCount, setPdfPageCount] = useState<number>(0)
  const [pdfPagesInput, setPdfPagesInput] = useState('')
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [language, setLanguage] = useState<OcrLanguage>('eng')
  const [psm, setPsm] = useState<OcrPsmId>('auto')
  const [enhance, setEnhance] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<OcrProgress | null>(null)
  const [result, setResult] = useState<OcrResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const handleFiles = useCallback(
    async (files: File[]) => {
      const next = files[0]
      if (!next) return
      const isImage = next.type.startsWith('image/')
      const looksLikePdf = next.type === 'application/pdf' || /\.pdf$/i.test(next.name)
      let isPdf = looksLikePdf
      if (!isImage && !isPdf) {
        const head = new Uint8Array(await next.slice(0, 5).arrayBuffer())
        isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46
      }
      if (!isImage && !isPdf) {
        setError(t('ocr.notImageOrPdf'))
        return
      }
      setResult(null)
      setError(null)
      setProgress(null)
      setCopied(false)

      if (isPdf) {
        setLoadingPdf(true)
        try {
          const bytes = new Uint8Array(await next.arrayBuffer())
          const pages = await getPdfPageCountViaPdfJs(bytes)
          const firstPage = await renderPdfPageBlob(bytes, 1, 1.5, 'png', lang)
          const url = URL.createObjectURL(firstPage.blob)
          setFile(next)
          setPdfBytes(bytes)
          setPdfPageCount(pages)
          setPdfPagesInput('')
          setPreviewUrl((old) => {
            if (old) URL.revokeObjectURL(old)
            return url
          })
        } catch {
          setError(t('ocr.pdfReadError'))
        } finally {
          setLoadingPdf(false)
        }
        return
      }

      setFile(next)
      setPdfBytes(null)
      setPdfPageCount(0)
      setPdfPagesInput('')
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old)
        return URL.createObjectURL(next)
      })
    },
    [lang, t],
  )

  const lastInitialRef = useRef<File[] | null>(null)
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0 && lastInitialRef.current !== initialFiles) {
      lastInitialRef.current = initialFiles
      void handleFiles(initialFiles)
      onInitialFilesConsumed?.()
    }
  }, [initialFiles, handleFiles, onInitialFilesConsumed])

  const clearFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl(null)
    setPdfBytes(null)
    setPdfPageCount(0)
    setPdfPagesInput('')
    setResult(null)
    setError(null)
    setProgress(null)
    setCopied(false)
  }

  const handleRun = async () => {
    if (!file || running) return

    if (pdfBytes && pdfPageCount > 0) {
      let targetPages: number[]
      if (pdfPagesInput.trim() === '') {
        targetPages = Array.from({ length: pdfPageCount }, (_, i) => i + 1)
      } else {
        const parsed = parsePageList(pdfPagesInput, pdfPageCount)
        if (!parsed || parsed.length === 0) {
          setError(t('ocr.pdfPagesError', { n: pdfPageCount }))
          return
        }
        targetPages = parsed
      }

      setRunning(true)
      setError(null)
      setResult(null)
      setCopied(false)
      const startedAt = Date.now()
      try {
        const sections: string[] = []
        let confSum = 0
        for (let idx = 0; idx < targetPages.length; idx++) {
          const pageNum = targetPages[idx]
          setProgress({
            status: t('ocr.pdfRendering', { cur: idx + 1, total: targetPages.length }),
            progress: idx / targetPages.length,
          })
          const rendered = await renderPdfPageBlob(pdfBytes, pageNum, 2, 'png', lang)
          const pageResult = await recognizeImage(rendered.blob, {
            language,
            psm,
            enhance,
            lang,
            onProgress: (p) => {
              setProgress({
                status: t('ocr.pdfProgress', { cur: idx + 1, total: targetPages.length, status: p.status }),
                progress: (idx + p.progress) / targetPages.length,
              })
            },
          })
          confSum += pageResult.confidence
          if (targetPages.length > 1) {
            sections.push(`${t('ocr.pdfPageHeader', { n: pageNum })}\n${pageResult.text}`.trimEnd())
          } else {
            sections.push(pageResult.text)
          }
        }
        const combinedText = sections.join('\n\n').replace(/\s+$/u, '')
        const recognised: OcrResult = {
          text: combinedText,
          confidence: targetPages.length > 0 ? confSum / targetPages.length : 0,
          wordCount: countWords(combinedText),
          durationMs: Date.now() - startedAt,
          language,
          psm,
          engine: OCR_ENGINE_LABEL,
        }
        setResult(recognised)
        recordActivity({
          fileName: file.name,
          fileSize: file.size,
          fileType: 'application/pdf',
          tool: 'ocr',
          result: `OCR (${OCR_LANGUAGE_LABELS[recognised.language]}) · ${recognised.wordCount} words · ${formatConfidence(recognised.confidence)} mean confidence`,
          resultKey: 'act.ocr',
          resultParams: {
            lang: t(
              recognised.language === 'eng'
                ? 'ocr.langEng'
                : recognised.language === 'ben'
                  ? 'ocr.langBen'
                  : 'ocr.langBoth',
            ),
            words: recognised.wordCount,
            conf: formatConfidence(recognised.confidence),
          },
        })
        setProgress(null)
      } catch (err) {
        setProgress(null)
        setError(
          err instanceof Error
            ? t('ocr.failed', { msg: err.message })
            : t('ocr.failedPlain'),
        )
      }
      setRunning(false)
      return
    }

    setRunning(true)
    setError(null)
    setResult(null)
    setCopied(false)
    setProgress({ status: t('ocr.starting'), progress: 0 })
    try {
      const recognised = await recognizeImage(file, {
        language,
        psm,
        enhance,
        lang,
        onProgress: (p) => setProgress(p),
      })
      setResult(recognised)
      recordActivity({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'image',
        tool: 'ocr',
        result: `OCR (${OCR_LANGUAGE_LABELS[recognised.language]}) · ${recognised.wordCount} words · ${formatConfidence(recognised.confidence)} mean confidence`,
        resultKey: 'act.ocr',
        resultParams: {
          lang: t(
            recognised.language === 'eng'
              ? 'ocr.langEng'
              : recognised.language === 'ben'
                ? 'ocr.langBen'
                : 'ocr.langBoth',
          ),
          words: recognised.wordCount,
          conf: formatConfidence(recognised.confidence),
        },
      })
      setProgress(null)
    } catch (err) {
      setProgress(null)
      setError(
        err instanceof Error
          ? t('ocr.failed', { msg: err.message })
          : t('ocr.failedPlain'),
      )
    }
    setRunning(false)
  }

  const handleCopy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError(t('ocr.copyFailed'))
    }
  }

  return (
    <Box component="section" aria-labelledby="ocr-heading" sx={{ display: 'flex', flexDirection: 'column', flex: { lg: 1 }, minHeight: { lg: 0 } }}>
      <Stack spacing={2} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 } }}>
        <ToolPageHeader
          headingId="ocr-heading"
          title={t('ocr.title')}
          description={t('ocr.desc')}
          actions={
            <WorkflowSteps
              activeStep={!file ? 0 : result ? 2 : 1}
              steps={[t('step.upload'), t('step.extract'), t('step.copySave')]}
            />
          }
        />

        {!file && (
          <Box sx={{ flex: { lg: 1 }, display: 'flex', flexDirection: 'column', '& > *': { flex: { lg: 1 } } }}>
            <DropZone
              inputId="ocr-file"
              label={t('cv.dropLabel')}
              hint={t('ocr.dropHintPdf')}
              multiple={false}
              accept="image/*,application/pdf,.pdf"
              onFiles={(files) => void handleFiles(files)}
            />
          </Box>
        )}

        {loadingPdf && (
          <Typography role="status" variant="body2" color="text.secondary">
            {t('common.readingPdf')}
          </Typography>
        )}

        {file && previewUrl && (
          <EditorShell
            main={
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="overline" color="text.secondary">
                        {t('ocr.image')}
                      </Typography>
                      {pdfPageCount > 0 && (
                        <Chip
                          size="small"
                          color="primary"
                          variant="outlined"
                          icon={<PictureAsPdfIcon sx={{ fontSize: 15 }} />}
                          label={t('ocr.pdfBadge', { n: pdfPageCount, s: plural(lang, pdfPageCount) })}
                        />
                      )}
                    </Stack>
                    <Button type="button" variant="outlined" size="small" onClick={clearFile} disabled={running}>
                      {t('ocr.chooseDifferent')}
                    </Button>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                    <Box
                      component="img"
                      src={previewUrl}
                      alt={file.name}
                      id="ocr-preview"
                      sx={{
                        display: 'block',
                        maxHeight: { xs: 240, lg: 'clamp(140px, calc(100dvh - 450px), 260px)' },
                        maxWidth: '100%',
                        borderRadius: 1,
                        border: 1,
                        borderColor: 'divider',
                        objectFit: 'contain',
                      }}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    {file.name} — {formatBytes(file.size)}
                  </Typography>
                  <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                    {pdfPageCount > 1 && (
                      <TextField
                        id="ocr-pdf-pages"
                        size="small"
                        fullWidth
                        label={t('ocr.pdfPagesLabel')}
                        placeholder={t('ocr.pdfPagesPlaceholder')}
                        value={pdfPagesInput}
                        onChange={(e) => setPdfPagesInput(e.target.value)}
                      />
                    )}
                    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { sm: '1fr 1fr' } }}>
                      <Box>
                        <Typography variant="subtitle2" component="label" htmlFor="ocr-language" sx={{ display: 'block' }}>
                          {t('ocr.language')}
                        </Typography>
                        <Select
                          native
                          fullWidth
                          id="ocr-language"
                          value={language}
                          onChange={(e) => setLanguage(e.target.value as OcrLanguage)}
                          sx={{ mt: 0.5 }}
                        >
                          {OCR_LANGUAGES.map((code) => (
                            <option key={code} value={code}>
                              {t(
                                code === 'eng'
                                  ? 'ocr.langEng'
                                  : code === 'ben'
                                    ? 'ocr.langBen'
                                    : 'ocr.langBoth',
                              )}
                            </option>
                          ))}
                        </Select>
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" component="label" htmlFor="ocr-psm" sx={{ display: 'block' }}>
                          {t('ocr.psm')}
                        </Typography>
                        <Select
                          native
                          fullWidth
                          id="ocr-psm"
                          value={psm}
                          onChange={(e) => setPsm(e.target.value as OcrPsmId)}
                          sx={{ mt: 0.5 }}
                        >
                          {OCR_PSM_MODES.map((m) => (
                            <option key={m.id} value={m.id}>
                              {t(
                                m.id === 'auto'
                                  ? 'ocr.psmAuto'
                                  : m.id === 'single-block'
                                    ? 'ocr.psmBlock'
                                    : 'ocr.psmLine',
                              )}
                            </option>
                          ))}
                        </Select>
                      </Box>
                    </Box>
                    <FormControlLabel
                      control={
                        <Checkbox
                          id="ocr-enhance"
                          size="small"
                          checked={enhance}
                          onChange={(e) => setEnhance(e.target.checked)}
                        />
                      }
                      label={<Typography variant="body2">{t('ocr.enhance')}</Typography>}
                    />
                    <Button
                      type="button"
                      variant="contained"
                      size="large"
                      fullWidth
                      id="ocr-run-button"
                      onClick={() => void handleRun()}
                      disabled={running}
                    >
                      {running ? t('ocr.running') : t('ocr.run')}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            }
            tools={
              <>
                {running && progress && (
                  <Box
                    role="status"
                    sx={{
                      borderRadius: 1,
                      border: 1,
                      borderColor: 'divider',
                      bgcolor: 'background.paper',
                      p: 2.5,
                    }}
                  >
                    <Typography variant="body2" id="ocr-progress">
                      {progress.status} {Math.round(progress.progress * 100)}%
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={Math.round(progress.progress * 100)}
                      sx={{ mt: 1.5 }}
                    />
                  </Box>
                )}

                {result ? (
                  <Card id="ocr-result">
                    <CardContent>
                      <Typography variant="overline" color="text.secondary">
                        {t('ocr.resultTitle')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" id="ocr-stats" sx={{ display: 'block', mt: 0.5 }}>
                        {t('ocr.stats', {
                          conf: formatConfidence(result.confidence),
                          words: result.wordCount,
                          s: plural(lang, result.wordCount),
                          dur: formatDurationMs(result.durationMs),
                          lang: t(
                            result.language === 'eng'
                              ? 'ocr.langEng'
                              : result.language === 'ben'
                                ? 'ocr.langBen'
                                : 'ocr.langBoth',
                          ),
                          engine: result.engine,
                        })}
                      </Typography>
                      {result.text === '' ? (
                        <Typography variant="body2" sx={{ mt: 1.5 }}>
                          {t('ocr.noText')}
                        </Typography>
                      ) : (
                        <Box
                          component="pre"
                          id="ocr-text"
                          sx={{
                            mt: 1.5,
                            mb: 0,
                            p: 1.5,
                            borderRadius: 1,
                            border: 1,
                            borderColor: 'divider',
                            bgcolor: 'background.default',
                            typography: 'body2',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            overflowWrap: 'break-word',
                            maxHeight: { lg: 'calc(100dvh - 380px)' },
                            overflowY: 'auto',
                          }}
                        >
                          {result.text}
                        </Box>
                      )}
                      {result.text !== '' && (
                        <Stack direction="row" spacing={1.5} flexWrap="wrap" sx={{ mt: 1.5 }}>
                          <Button
                            type="button"
                            variant="outlined"
                            id="ocr-copy-button"
                            startIcon={<ContentCopyIcon />}
                            onClick={() => void handleCopy()}
                          >
                            {copied ? t('ocr.copied') : t('ocr.copy')}
                          </Button>
                          <Button
                            type="button"
                            variant="contained"
                            id="ocr-download-button"
                            startIcon={<DownloadIcon />}
                            onClick={() => downloadText(result.text, ocrOutputName(file?.name ?? 'ocr'))}
                          >
                            {t('ocr.downloadTxt')}
                          </Button>
                        </Stack>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  !running && (
                    <Card>
                      <CardContent>
                        <Typography variant="overline" color="text.secondary">
                          {t('ocr.resultTitle')}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                          {t('ocr.langCaption')} {t('ocr.psmCaption')}
                        </Typography>
                      </CardContent>
                    </Card>
                  )
                )}

                {error && <Alert severity="error">{error}</Alert>}
              </>
            }
          />
        )}

        {!file && error && <Alert severity="error">{error}</Alert>}

        <Typography variant="caption" color="text.secondary" sx={{ flex: 'none' }}>
          {t('ocr.cliHint')}
          <Box component="code" sx={{ fontFamily: 'monospace' }}>openpixel ocr</Box>
        </Typography>
      </Stack>
    </Box>
  )
}
