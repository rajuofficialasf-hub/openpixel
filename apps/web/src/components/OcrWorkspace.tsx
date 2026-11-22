import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DownloadIcon from '@mui/icons-material/Download'
import { formatBytes } from '../lib/capabilities'
import { recordActivity } from '../lib/activity'
import {
  formatConfidence,
  formatDurationMs,
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
import { DropZone } from './DropZone'
import { ToolPageHeader } from './ToolPage'
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

export function OcrWorkspace() {
  const { t, lang } = useI18n()
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
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

  const handleFiles = (files: File[]) => {
    const next = files[0]
    if (!next) return
    if (!next.type.startsWith('image/')) {
      setError(t('ocr.notImage'))
      return
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(next)
    setPreviewUrl(URL.createObjectURL(next))
    setResult(null)
    setError(null)
    setProgress(null)
    setCopied(false)
  }

  const clearFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl(null)
    setResult(null)
    setError(null)
    setProgress(null)
    setCopied(false)
  }

  const handleRun = async () => {
    if (!file || running) return
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
    <Box component="section" aria-labelledby="ocr-heading">
      <Stack spacing={3}>
        <ToolPageHeader
          headingId="ocr-heading"
          title={t('ocr.title')}
          description={t('ocr.desc')}
        />

        <Box
          role="status"
          sx={{
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            p: 3,
          }}
        >
          <Typography variant="body2">
            {t('ocr.infoA')}
            <Typography component="code" variant="body2">openpixel ocr</Typography>
            {t('ocr.infoB')}
          </Typography>
        </Box>

        {!file && (
          <DropZone
            inputId="ocr-file"
            label={t('cv.dropLabel')}
            hint={t('ocr.dropHint')}
            multiple={false}
            accept="image/*"
            onFiles={handleFiles}
          />
        )}

        {file && previewUrl && (
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                {t('ocr.image')}
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
                <Box
                  component="img"
                  src={previewUrl}
                  alt={file.name}
                  id="ocr-preview"
                  sx={{ display: 'block', maxHeight: 320, maxWidth: '100%', borderRadius: 1, border: 1, borderColor: 'divider', objectFit: 'contain' }}
                />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                {file.name} — {formatBytes(file.size)}
              </Typography>
              <Stack spacing={2.5} sx={{ mt: 2 }}>
                <Stack direction="row" spacing={2} alignItems="flex-start" flexWrap="wrap">
                  <Box>
                    <Typography variant="subtitle2" component="label" htmlFor="ocr-language" sx={{ display: 'block' }}>
                      {t('ocr.language')}
                    </Typography>
                    <Select
                      native
                      id="ocr-language"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value as OcrLanguage)}
                      sx={{ mt: 0.5, minWidth: 200 }}
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
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      {t('ocr.langCaption')}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" component="label" htmlFor="ocr-psm" sx={{ display: 'block' }}>
                      {t('ocr.psm')}
                    </Typography>
                    <Select
                      native
                      id="ocr-psm"
                      value={psm}
                      onChange={(e) => setPsm(e.target.value as OcrPsmId)}
                      sx={{ mt: 0.5, minWidth: 180 }}
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
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      {t('ocr.psmCaption')}
                    </Typography>
                  </Box>
                </Stack>
                <FormControlLabel
                  control={
                    <Checkbox
                      id="ocr-enhance"
                      checked={enhance}
                      onChange={(e) => setEnhance(e.target.checked)}
                    />
                  }
                  label={t('ocr.enhance')}
                />
                <Typography variant="caption" color="text.secondary">
                  {t('ocr.enhanceCaption')}
                </Typography>
                <Stack direction="row" spacing={1.5} flexWrap="wrap">
                  <Button
                    type="button"
                    variant="contained"
                    id="ocr-run-button"
                    onClick={() => void handleRun()}
                    disabled={running}
                  >
                    {running ? t('ocr.running') : t('ocr.run')}
                  </Button>
                  <Button type="button" variant="outlined" onClick={clearFile} disabled={running}>
                    {t('ocr.chooseDifferent')}
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}

        {running && progress && (
          <Box
            role="status"
            sx={{
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              p: 3,
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

        {result && (
          <Card id="ocr-result">
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                {t('ocr.resultTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary" id="ocr-stats" sx={{ mt: 1 }}>
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
                <Typography variant="body2" sx={{ mt: 2 }}>
                  {t('ocr.noText')}
                </Typography>
              ) : (
                <Box
                  component="pre"
                  id="ocr-text"
                  sx={{
                    mt: 2,
                    mb: 0,
                    p: 2,
                    borderRadius: 1,
                    border: 1,
                    borderColor: 'divider',
                    bgcolor: 'background.default',
                    typography: 'body1',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    overflowWrap: 'break-word',
                  }}
                >
                  {result.text}
                </Box>
              )}
              {result.text !== '' && (
                <Stack direction="row" spacing={1.5} flexWrap="wrap" sx={{ mt: 2 }}>
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
        )}

        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Box>
  )
}
