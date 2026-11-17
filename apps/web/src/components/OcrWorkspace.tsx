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
import { alpha } from '@mui/material/styles'
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
      setError('That file is not an image — OCR reads printed text from an image file.')
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
    setProgress({ status: 'Starting…', progress: 0 })
    try {
      const recognised = await recognizeImage(file, {
        language,
        psm,
        enhance,
        onProgress: (p) => setProgress(p),
      })
      setResult(recognised)
      recordActivity({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'image',
        tool: 'ocr',
        result: `OCR (${OCR_LANGUAGE_LABELS[recognised.language]}) · ${recognised.wordCount} words · ${formatConfidence(recognised.confidence)} mean confidence`,
      })
      setProgress(null)
    } catch (err) {
      setProgress(null)
      setError(
        err instanceof Error
          ? `OCR failed: ${err.message} Check the image and try again, or use the native CLI (openpixel ocr).`
          : 'OCR failed. Check the image and try again, or use the native CLI (openpixel ocr).',
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
      setError('Could not copy — select the text and copy it manually.')
    }
  }

  return (
    <Box component="section" aria-labelledby="ocr-heading">
      <Stack spacing={3}>
        <ToolPageHeader
          headingId="ocr-heading"
          title="Text recognition (OCR)"
          description="Read the text out of a photo or scan, entirely in your browser. Files never leave your device — the engine and language data load from this site only when you run OCR."
        />

        <Box
          role="status"
          sx={{
            borderRadius: 3,
            border: 1,
            borderColor: (t) => alpha(t.palette.info.main, 0.4),
            bgcolor: (t) => alpha(t.palette.info.main, 0.08),
            p: 2.5,
          }}
        >
          <Typography variant="body2">
            Browser OCR runs tesseract.js — the same Tesseract engine family as the native CLI,
            but slower, with accuracy that can differ, and without the CLI&apos;s preprocessing
            pipeline. For large batches or the best accuracy use the native CLI (
            <Typography component="code" variant="body2">openpixel ocr</Typography>).
            Handwriting is out of scope — printed text only.
          </Typography>
        </Box>

        {!file && (
          <DropZone
            inputId="ocr-file"
            label="Drop an image here"
            hint="Printed text in a photo or scan — PNG, JPEG, WebP and the other formats this browser decodes. Nothing is uploaded."
            multiple={false}
            accept="image/*"
            onFiles={handleFiles}
          />
        )}

        {file && previewUrl && (
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Image
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
                      Language
                    </Typography>
                    <Select
                      native
                      id="ocr-language"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value as OcrLanguage)}
                      sx={{ mt: 0.5, minWidth: 200 }}
                    >
                      {OCR_LANGUAGES.map((lang) => (
                        <option key={lang} value={lang}>
                          {OCR_LANGUAGE_LABELS[lang]}
                        </option>
                      ))}
                    </Select>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      English is the default — add Bengali only when the image has Bengali
                      text. Each language loads its own file on first use.
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" component="label" htmlFor="ocr-psm" sx={{ display: 'block' }}>
                      Page layout
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
                          {m.label}
                        </option>
                      ))}
                    </Select>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      Auto works for most pages; single line suits one line of text.
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
                  label="Enhance image (grayscale + contrast before recognition)"
                />
                <Typography variant="caption" color="text.secondary">
                  Enhancing helps faint scans, and can hurt clean images — try it only if the
                  first run misses text.
                </Typography>
                <Stack direction="row" spacing={1.5} flexWrap="wrap">
                  <Button
                    type="button"
                    variant="contained"
                    id="ocr-run-button"
                    onClick={() => void handleRun()}
                    disabled={running}
                  >
                    {running ? 'Recognising…' : 'Run OCR'}
                  </Button>
                  <Button type="button" variant="outlined" onClick={clearFile} disabled={running}>
                    Choose a different image
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
              borderRadius: 3,
              border: 1,
              borderColor: (t) => alpha(t.palette.info.main, 0.4),
              bgcolor: (t) => alpha(t.palette.info.main, 0.08),
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

        {result && (
          <Card id="ocr-result">
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Recognised text
              </Typography>
              <Typography variant="body2" color="text.secondary" id="ocr-stats" sx={{ mt: 1 }}>
                Mean confidence: {formatConfidence(result.confidence)} · {result.wordCount}{' '}
                word{result.wordCount === 1 ? '' : 's'} · {formatDurationMs(result.durationMs)} ·{' '}
                {OCR_LANGUAGE_LABELS[result.language]} · {result.engine}
              </Typography>
              {result.text === '' ? (
                <Typography variant="body2" sx={{ mt: 2 }}>
                  No text was recognised — try enhancing the image, or a clearer photo with
                  larger printed text.
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
                    {copied ? 'Copied' : 'Copy text'}
                  </Button>
                  <Button
                    type="button"
                    variant="contained"
                    id="ocr-download-button"
                    startIcon={<DownloadIcon />}
                    onClick={() => downloadText(result.text, ocrOutputName(file?.name ?? 'ocr'))}
                  >
                    Download .txt
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
