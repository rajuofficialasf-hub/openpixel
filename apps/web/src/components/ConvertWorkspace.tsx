import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Select,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import DownloadIcon from '@mui/icons-material/Download'
import {
  BROWSER_DECODABLE,
  BROWSER_ENCODABLE,
  formatById,
  formatBytes,
  formatLabel,
  outputFileName,
} from '../lib/capabilities'
import { convertImage, probeImage, ProbeError, type ProbedImage } from '../lib/convert'
import type { DetectedFormat } from '../lib/detect'
import type { Settings } from '../lib/settings'
import { recordActivity } from '../lib/activity'
import { mergeFormatLists, useWasmSupport } from '../lib/wasm-engine'
import { DropZone } from './DropZone'
import { EditorShell } from './EditorShell'
import { ToolPageHeader } from './ToolPage'

type Status = 'idle' | 'probing' | 'ready' | 'converting' | 'done' | 'error'

interface ConvertWorkspaceProps {
  settings: Settings
  onSettingsChange: (settings: Settings) => void
  /** Files handed over from the homepage upload — consumed once on mount. */
  initialFiles?: File[]
  onInitialFilesConsumed?: () => void
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ConvertWorkspace({ settings, onSettingsChange, initialFiles, onInitialFilesConsumed }: ConvertWorkspaceProps) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [probed, setProbed] = useState<ProbedImage | null>(null)
  // Format sniffed from the magic bytes when probing failed (e.g. a
  // TIFF with no WASM engine): shown as the detected format instead
  // of "Unknown". Dimensions stay unknown — never rendered as 0×0.
  const [detectedFormat, setDetectedFormat] = useState<DetectedFormat | null>(null)
  const [targetFormat, setTargetFormat] = useState(settings.defaultFormat)
  const [quality, setQuality] = useState(settings.defaultQuality)
  const [background, setBackground] = useState(settings.defaultBackground)
  const [pngCompression, setPngCompression] = useState(1)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [result, setResult] = useState<{ blob: Blob; url: string; width: number; height: number; bytes: number } | null>(null)
  const resultUrlRef = useRef<string | null>(null)
  // The WASM engine's format support, loaded once on mount. `null`
  // while loading and when the module is absent — the UI works
  // identically either way, just with fewer formats offered.
  const wasmSupport = useWasmSupport()
  const decodableFormats = mergeFormatLists(BROWSER_DECODABLE, wasmSupport?.decode)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    }
  }, [previewUrl])

  const handleFiles = useCallback(
    async (files: File[]) => {
      const next = files[0]
      if (!next) return
      if (resultUrlRef.current) {
        URL.revokeObjectURL(resultUrlRef.current)
        resultUrlRef.current = null
      }
      setResult(null)
      setError(null)
      setWarnings([])
      setDetectedFormat(null)
      setFile(next)
      setStatus('probing')
      const url = URL.createObjectURL(next)
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old)
        return url
      })
      try {
        const info = await probeImage(next)
        setProbed(info)
        const notes: string[] = []
        if (info.format === 'unknown') {
          notes.push(
            'Format not recognised from the file signature — the browser may still be able to open it, but conversion is not guaranteed.',
          )
        } else if (!decodableFormats.includes(info.format)) {
          notes.push(
            `${formatLabel(info.format)} cannot be decoded in this browser. Use the native CLI (openpixel convert) for this file.`,
          )
        } else if (!BROWSER_DECODABLE.includes(info.format)) {
          notes.push(
            `${formatLabel(info.format)} was decoded by the built-in WASM engine (the real Rust engine, in your browser) — the preview below may not render here, but conversion works.`,
          )
        }
        if (info.format === 'gif') {
          notes.push('Animated GIF: only the first frame is converted (same as the engine’s plain decode).')
        }
        if (info.format === 'avif') {
          notes.push('AVIF decoding depends on this browser — if it fails here, use the native CLI.')
        }
        setWarnings(notes)
        setStatus('ready')
      } catch (err) {
        setProbed(null)
        // The format was sniffed even though the file cannot be
        // decoded here — keep it visible instead of "Unknown".
        if (err instanceof ProbeError && err.format !== 'unknown') {
          setDetectedFormat(err.format)
        }
        setError(err instanceof Error ? err.message : 'Could not read this image.')
        setStatus('error')
      }
    },
    [decodableFormats],
  )

  // Homepage hand-off: a file dropped on the home page arrives here
  // already loaded. Consume it once; the ref guard also covers
  // StrictMode's double effect run in development.
  const initialConsumedRef = useRef(false)
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0 && !initialConsumedRef.current) {
      initialConsumedRef.current = true
      void handleFiles(initialFiles)
      onInitialFilesConsumed?.()
    }
  }, [initialFiles, handleFiles, onInitialFilesConsumed])

  const canConvert =
    file !== null && probed !== null && probed.format !== 'unknown' && decodableFormats.includes(probed.format)

  const handleConvert = useCallback(async () => {
    if (!file || !probed) return
    setStatus('converting')
    setError(null)
    setWarnings((prev) => {
      const next = [...prev]
      if (settings.metadataPolicy === 'preserve') {
        next.push(
          'Metadata policy “Preserve” was requested, but in-browser conversion (canvas or WASM engine) always strips EXIF/ICC/XMP — the output has no metadata. Use the native CLI with --metadata preserve to keep it.',
        )
      }
      if (targetFormat === 'png' && pngCompression !== 1) {
        next.push(
          `PNG compression ${pngCompression} is recorded but the browser’s canvas encoder has no PNG compression knob — the output uses the browser default.`,
        )
      }
      return next
    })
    try {
      const converted = await convertImage(file, {
        targetFormat,
        quality,
        background,
        pngCompression,
      })
      const url = URL.createObjectURL(converted.blob)
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = url
      setResult({ blob: converted.blob, url, width: converted.width, height: converted.height, bytes: converted.bytes })
      recordActivity({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || probed.format,
        tool: 'convert',
        result: `Converted to ${formatLabel(targetFormat)} · ${converted.width}×${converted.height} · ${formatBytes(converted.bytes)}`,
      })
      if (converted.engine === 'wasm') {
        setWarnings((prev) => [
          ...prev,
          'Converted with the built-in WASM engine (the real Rust engine, running in your browser).',
        ])
      }
      setStatus('done')
    } catch (err) {
      // "Conversion failed:" belongs here — a real conversion was
      // attempted. Probe failures set their own message in
      // handleFiles and must never wear this label.
      setError(
        err instanceof Error ? `Conversion failed: ${err.message}` : 'Conversion failed.',
      )
      setStatus('error')
    }
  }, [file, probed, targetFormat, quality, background, pngCompression, settings.metadataPolicy])

  const clearFile = useCallback(() => {
    setFile(null)
    setProbed(null)
    setDetectedFormat(null)
    setResult(null)
    setError(null)
    setWarnings([])
    setStatus('idle')
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }
  }, [previewUrl])

  // Output targets: the canvas targets first, then whatever the
  // WASM engine adds (BMP, TIFF, QOI, HEIC, JXL, JPEG 2000, ICO,
  // PNM, TGA, GIF) when its module is present. Without the module
  // the list is exactly the old canvas-only list. BMP is a WASM
  // target, not a canvas one: canvas.toBlob silently returns PNG
  // for BMP (see capabilities.ts).
  const targets = mergeFormatLists(BROWSER_ENCODABLE, wasmSupport?.encode)
    .map((id) => formatById(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined && c.can_encode)

  return (
    <Box component="section" aria-labelledby="convert-heading">
      <Stack spacing={3}>
        <ToolPageHeader
          headingId="convert-heading"
          title="Convert one image"
          description={
            <>
              Files never leave your device — conversion runs locally in your browser.{' '}
              {wasmSupport
                ? 'Canvas targets, plus the WASM engine’s extra formats — AVIF still needs the native CLI.'
                : 'Canvas targets only — the WASM engine’s extra formats need its module built (see Settings, About).'}
            </>
          }
        />

        {!file && (
          <DropZone
            inputId="convert-file"
            label="Drop an image here"
            hint="PNG, JPEG, WebP, GIF, BMP, SVG, AVIF — plus TIFF, QOI, HEIC, JXL and JPEG 2000 when the WASM engine is built."
            multiple={false}
            accept="image/*"
            onFiles={handleFiles}
          />
        )}

        {file && (
          <EditorShell
            main={
              <>
              <Card>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    Source
                  </Typography>
                  {previewUrl &&
                    (probed === null ||
                    probed.format === 'unknown' ||
                    BROWSER_DECODABLE.includes(probed.format) ? (
                      <Box
                        component="img"
                        src={previewUrl}
                        alt={`Preview of ${file.name}`}
                        sx={{
                          display: 'block',
                          mx: 'auto',
                          maxHeight: 320,
                          maxWidth: '100%',
                          borderRadius: 1,
                          objectFit: 'contain',
                        }}
                      />
                    ) : (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        align="center"
                        sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 2, py: 4 }}
                      >
                        No preview for {formatLabel(probed.format)} — this browser cannot display it,
                        but the WASM engine can convert it.
                      </Typography>
                    ))}
                  <Box
                    component="dl"
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr',
                      columnGap: 2,
                      rowGap: 1,
                      mt: 2,
                      mx: 0,
                      mb: 0,
                    }}
                  >
                    <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>
                      File
                    </Box>
                    <Box
                      component="dd"
                      sx={{
                        m: 0,
                        typography: 'body2',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {file.name}
                    </Box>
                    <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>
                      Size
                    </Box>
                    <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }}>
                      {formatBytes(file.size)}
                    </Box>
                    <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>
                      Detected format
                    </Box>
                    <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }}>
                      {probed
                        ? formatLabel(probed.format)
                        : detectedFormat
                          ? formatLabel(detectedFormat)
                          : status === 'probing'
                            ? 'Reading…'
                            : 'Unknown'}
                      <Typography variant="caption" component="span" display="block" color="text.secondary">
                        Detected from magic bytes, not the extension.
                      </Typography>
                    </Box>
                    <Box component="dt" sx={{ color: 'text.secondary', typography: 'body2' }}>
                      Dimensions
                    </Box>
                    <Box component="dd" sx={{ m: 0, typography: 'body2', fontWeight: 500 }}>
                      {probed ? `${probed.width} × ${probed.height} px` : '—'}
                    </Box>
                  </Box>
                  <Button type="button" variant="outlined" onClick={clearFile} sx={{ mt: 2 }}>
                    Choose a different file
                  </Button>
                </CardContent>
              </Card>

              {status === 'probing' && (
                <Typography role="status" variant="body2" color="text.secondary">
                  Reading image…
                </Typography>
              )}
              </>
            }
            tools={
              <>
            <Card>
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  Output
                </Typography>
                <Stack spacing={2.5} sx={{ mt: 1 }}>
                  <Box>
                    <Typography variant="subtitle2" component="label" htmlFor="target-format">
                      Output format
                    </Typography>
                    <Select
                      native
                      fullWidth
                      id="target-format"
                      value={targetFormat}
                      onChange={(e) => setTargetFormat(e.target.value)}
                      sx={{ mt: 0.5 }}
                    >
                      {targets.map((t) => (
                        <option key={t.format_id} value={t.format_id}>
                          {formatLabel(t.format_id)}
                        </option>
                      ))}
                    </Select>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      {wasmSupport
                        ? 'Canvas targets plus the WASM engine’s BMP, TIFF, QOI, HEIC, JXL, JPEG 2000, ICO, PNM, TGA and GIF. AVIF still needs the native CLI — see the Formats tab.'
                        : 'Only formats this browser can encode. BMP, TIFF, AVIF, JXL, QOI and the rest need the WASM engine or the native CLI — see the Formats tab.'}
                    </Typography>
                  </Box>

                  {(targetFormat === 'jpeg' || targetFormat === 'webp') && (
                    <Box>
                      <Typography variant="subtitle2" component="label">
                        Quality: {quality}
                      </Typography>
                      <Slider
                        aria-label="Quality"
                        min={1}
                        max={100}
                        value={quality}
                        onChange={(_, value) => setQuality(value as number)}
                      />
                    </Box>
                  )}

                  {targetFormat === 'png' && (
                    <Box>
                      <Typography variant="subtitle2" component="label">
                        PNG compression: {pngCompression} (0 = fast, 1 = default, 2 = best)
                      </Typography>
                      <Slider
                        aria-label="PNG compression"
                        min={0}
                        max={2}
                        step={1}
                        value={pngCompression}
                        onChange={(_, value) => setPngCompression(value as number)}
                      />
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                        The browser’s canvas encoder has no PNG compression knob — this setting is
                        recorded and honoured by the CLI, but does not change the in-browser output.
                      </Typography>
                    </Box>
                  )}

                  <Box>
                    <Typography variant="subtitle2" component="label">
                      Background colour (flattens transparency for JPEG/BMP)
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                      <TextField
                        type="color"
                        size="small"
                        value={background}
                        onChange={(e) => setBackground(e.target.value)}
                        inputProps={{ 'aria-label': 'Background colour picker' }}
                        sx={{ width: 56, '& input': { p: 0.5, height: 40, cursor: 'pointer' } }}
                      />
                      <TextField
                        size="small"
                        value={background}
                        onChange={(e) => setBackground(e.target.value)}
                        inputProps={{ 'aria-label': 'Background colour hex value' }}
                        sx={{ width: 120, '& input': { fontFamily: 'monospace' } }}
                      />
                    </Stack>
                  </Box>

                  <Box>
                    <Typography variant="subtitle2">Metadata</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      Canvas conversion always strips EXIF/ICC/XMP. “Preserve” is offered so the choice
                      is explicit, but in this browser it still strips — use the CLI to preserve.
                    </Typography>
                    <FormControl sx={{ mt: 1 }}>
                      <RadioGroup
                        row
                        name="metadata-policy"
                        value={settings.metadataPolicy}
                        onChange={(_, value) =>
                          onSettingsChange({ ...settings, metadataPolicy: value as Settings['metadataPolicy'] })
                        }
                      >
                        <FormControlLabel value="strip" control={<Radio />} label="Strip (default)" />
                        <FormControlLabel value="preserve" control={<Radio />} label="Preserve (CLI only)" />
                      </RadioGroup>
                    </FormControl>
                  </Box>

                  <Button
                    type="button"
                    variant="contained"
                    size="large"
                    fullWidth
                    onClick={handleConvert}
                    disabled={!canConvert || status === 'converting'}
                  >
                    {status === 'converting' ? 'Converting…' : `Convert to ${formatLabel(targetFormat)}`}
                  </Button>
                  {!canConvert && probed && (
                    <Typography variant="body2" color="warning.main">
                      This source format cannot be converted in the browser — use the native CLI.
                    </Typography>
                  )}
                </Stack>
              </CardContent>
            </Card>
              </>
            }
          />
        )}

        {warnings.length > 0 && (
          <Box
            role="status"
            sx={{
              borderRadius: 1,
              border: 1,
              borderColor: (t) => alpha(t.palette.warning.main, 0.4),
              bgcolor: (t) => alpha(t.palette.warning.main, 0.08),
              p: 3,
            }}
          >
            <Box component="ul" sx={{ m: 0, pl: 2.5, typography: 'body2' }}>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </Box>
          </Box>
        )}

        {status === 'error' && error && <Alert severity="error">{error}</Alert>}

        {status === 'done' && result && file && (
          <Box
            role="status"
            sx={{
              borderRadius: 1,
              border: 1,
              borderColor: (t) => alpha(t.palette.success.main, 0.4),
              bgcolor: (t) => alpha(t.palette.success.main, 0.08),
              p: 3,
            }}
          >
            {probed && (
              <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                {formatLabel(probed.format)} → {formatLabel(targetFormat)}
              </Typography>
            )}
            <Typography variant="body1" fontWeight={500} color="success.main" sx={{ mt: 0.5 }}>
              Converted: {formatBytes(file.size)} → {formatBytes(result.bytes)} ({result.width} ×{' '}
              {result.height} px)
            </Typography>
            {targetFormat === 'ico' && probed && (result.width < probed.width || result.height < probed.height) && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                Resized to {result.width}×{result.height} for ICO — ICO supports max 256×256.
              </Typography>
            )}
            <Stack direction="row" flexWrap="wrap" spacing={1.5} sx={{ mt: 1.5 }}>
              <Button
                type="button"
                variant="contained"
                startIcon={<DownloadIcon />}
                onClick={() => downloadBlob(result.blob, outputFileName(file.name, targetFormat))}
              >
                Download {outputFileName(file.name, targetFormat)}
              </Button>
              <Button
                type="button"
                variant="outlined"
                onClick={() => {
                  setResult(null)
                  setStatus('ready')
                }}
              >
                Convert again with different settings
              </Button>
            </Stack>
          </Box>
        )}
      </Stack>
    </Box>
  )
}
