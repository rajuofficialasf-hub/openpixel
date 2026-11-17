import { convertFileSrc } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import type { Settings } from '../lib/settings'
import {
  convertFile,
  decodableExtensions,
  defaultOutputPath,
  encodableFormats,
  extractFrame,
  fetchFrames,
  fetchImageInfo,
  fetchMetadata,
  fileName,
  formatBytes,
  formatLabel,
  primaryExtension,
  processFile,
  type AnimationInfo,
  type ConvertResult,
  type FormatCapability,
  type ImageInfo,
  type Metadata,
  type PipelineRequest,
} from '../lib/tauri'
import { DropZone } from './DropZone'

interface ConvertWorkspaceProps {
  capabilities: FormatCapability[]
  settings: Settings
  droppedPaths: string[]
  onDroppedConsumed: () => void
}

function buildOptions(
  quality: number,
  background: string,
  metadataPolicy: string,
  selectedFrame: number | null,
): {
  quality: number | null
  png_compression: number | null
  background: string
  metadata_policy: string | null
  selected_frame: number | null
  convert_to_srgb: boolean
} {
  return {
    quality,
    png_compression: null,
    background,
    metadata_policy: metadataPolicy,
    selected_frame: selectedFrame,
    convert_to_srgb: false,
  }
}

export function ConvertWorkspace({
  capabilities,
  settings,
  droppedPaths,
  onDroppedConsumed,
}: ConvertWorkspaceProps) {
  const [inputPath, setInputPath] = useState<string | null>(null)
  const [info, setInfo] = useState<ImageInfo | null>(null)
  const [metadata, setMetadata] = useState<Metadata | null>(null)
  const [frames, setFrames] = useState<AnimationInfo | null>(null)
  const [target, setTarget] = useState(settings.defaultFormat)
  const [quality, setQuality] = useState(settings.defaultQuality)
  const [background, setBackground] = useState(settings.defaultBackground)
  const [metadataPolicy, setMetadataPolicy] = useState<string>(settings.metadataPolicy)
  const [selectedFrame, setSelectedFrame] = useState(0)
  const [resizeFit, setResizeFit] = useState('')
  const [grayscale, setGrayscale] = useState(false)
  const [rotate, setRotate] = useState('0')
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [result, setResult] = useState<ConvertResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)

  const encodable = encodableFormats(capabilities)
  const targetCap = capabilities.find((c) => c.format_id === target)

  const loadFile = useCallback(async (path: string) => {
    setInputPath(path)
    setInfo(null)
    setMetadata(null)
    setFrames(null)
    setResult(null)
    setError(null)
    setPreviewFailed(false)
    setSelectedFrame(0)
    try {
      const [i, m, f] = await Promise.all([
        fetchImageInfo(path),
        fetchMetadata(path).catch(() => null),
        fetchFrames(path).catch(() => null),
      ])
      setInfo(i)
      setMetadata(m)
      setFrames(f)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const pickFile = useCallback(async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: decodableExtensions(capabilities) }],
    })
    if (typeof picked === 'string') void loadFile(picked)
  }, [capabilities, loadFile])

  // Files dropped onto the window (App.tsx forwards the paths).
  useEffect(() => {
    if (droppedPaths.length > 0) {
      void loadFile(droppedPaths[0])
      onDroppedConsumed()
    }
  }, [droppedPaths, loadFile, onDroppedConsumed])

  const pipeline: PipelineRequest = {
    resize_fit: null,
    grayscale,
    rotate_degrees: rotate === '0' ? null : Number(rotate),
    flip_horizontal: flipH,
    flip_vertical: flipV,
  }
  const resizeParts = resizeFit.split('x').map((p) => Number(p.trim()))
  if (resizeParts.length === 2 && resizeParts[0] > 0 && resizeParts[1] > 0) {
    pipeline.resize_fit = [resizeParts[0], resizeParts[1]]
  }
  const hasPipeline =
    pipeline.resize_fit !== null ||
    pipeline.grayscale ||
    pipeline.rotate_degrees !== null ||
    pipeline.flip_horizontal ||
    pipeline.flip_vertical

  const runConvert = async () => {
    if (!inputPath) return
    setBusy(true)
    setBusyLabel('Converting…')
    setError(null)
    setResult(null)
    try {
      const ext = primaryExtension(capabilities, target)
      const output = await save({
        defaultPath: defaultOutputPath(inputPath, target, capabilities),
        filters: [{ name: target.toUpperCase(), extensions: [ext] }],
      })
      if (output === null) {
        setBusy(false)
        return
      }
      const options = buildOptions(quality, background, metadataPolicy, null)
      const r = hasPipeline
        ? await processFile(inputPath, output, target, options, pipeline)
        : await convertFile(inputPath, output, target, options)
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const runExtractFrame = async () => {
    if (!inputPath || !frames) return
    setBusy(true)
    setBusyLabel(`Extracting frame ${selectedFrame}…`)
    setError(null)
    setResult(null)
    try {
      const output = await save({
        defaultPath: defaultOutputPath(inputPath, 'png', capabilities),
        filters: [{ name: 'PNG', extensions: ['png'] }],
      })
      if (output === null) {
        setBusy(false)
        return
      }
      const options = buildOptions(quality, background, metadataPolicy, null)
      const r = await extractFrame(inputPath, output, selectedFrame, options)
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const qualityApplies = target === 'jpeg' || target === 'webp' || target === 'avif'
  const targetHasNoAlpha = targetCap !== undefined && !targetCap.supports_alpha

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <DropZone
        onPick={() => void pickFile()}
        label="Convert an image"
        hint="The native engine converts it — PNG, JPEG, WebP, TIFF, AVIF, JXL, SVG and more. Files never leave your device."
      />

      {error && <Alert severity="error">{error}</Alert>}

      {inputPath && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  Source
                </Typography>
                <Typography variant="body2" fontWeight={600} sx={{ mt: 1, wordBreak: 'break-all' }}>
                  {fileName(inputPath)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                  {inputPath}
                </Typography>
                {info ? (
                  <Box sx={{ mt: 2 }}>
                    <Box
                      component="img"
                      src={convertFileSrc(inputPath)}
                      alt={`Preview of ${fileName(inputPath)}`}
                      onError={() => setPreviewFailed(true)}
                      sx={{
                        maxHeight: 256,
                        maxWidth: '100%',
                        borderRadius: 2,
                        border: 1,
                        borderColor: 'divider',
                      }}
                    />
                    {previewFailed && (
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                        No preview in the app window for this format — the info below comes from the engine.
                      </Typography>
                    )}
                    <Grid container spacing={1} sx={{ mt: 2 }}>
                      <Grid size={6}><Typography variant="body2" color="text.secondary">Detected format</Typography></Grid>
                      <Grid size={6}><Typography variant="body2">{info.format.toUpperCase()}</Typography></Grid>
                      <Grid size={6}><Typography variant="body2" color="text.secondary">Dimensions</Typography></Grid>
                      <Grid size={6}><Typography variant="body2">{info.width} × {info.height}</Typography></Grid>
                      <Grid size={6}><Typography variant="body2" color="text.secondary">Colour</Typography></Grid>
                      <Grid size={6}><Typography variant="body2">{info.color_type}{info.has_alpha ? ' · alpha' : ''}</Typography></Grid>
                      <Grid size={6}><Typography variant="body2" color="text.secondary">File size</Typography></Grid>
                      <Grid size={6}><Typography variant="body2">{formatBytes(info.file_size_bytes)}</Typography></Grid>
                      {info.is_animated && (
                        <>
                          <Grid size={6}><Typography variant="body2" color="text.secondary">Frames</Typography></Grid>
                          <Grid size={6}><Typography variant="body2">{info.frame_count ?? frames?.frame_count ?? '?'} {frames?.is_multi_page ? '(multi-page)' : '(animated)'}</Typography></Grid>
                        </>
                      )}
                      {info.orientation !== null && (
                        <>
                          <Grid size={6}><Typography variant="body2" color="text.secondary">EXIF orientation</Typography></Grid>
                          <Grid size={6}><Typography variant="body2">{info.orientation}</Typography></Grid>
                        </>
                      )}
                      <Grid size={6}><Typography variant="body2" color="text.secondary">Metadata</Typography></Grid>
                      <Grid size={6}><Typography variant="body2">
                        {[
                          info.has_exif ? 'EXIF' : null,
                          info.has_icc ? 'ICC' : null,
                          info.has_xmp ? 'XMP' : null,
                        ]
                          .filter(Boolean)
                          .join(', ') || 'none'}
                      </Typography></Grid>
                    </Grid>
                    {metadata?.camera_make && (
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                        {metadata.camera_make} {metadata.camera_model ?? ''} · {metadata.date_time ?? ''}
                        {metadata.gps ? ` · GPS ${metadata.gps[0].toFixed(5)}, ${metadata.gps[1].toFixed(5)}` : ''}
                      </Typography>
                    )}
                    {metadata && metadata.warnings.length > 0 && (
                      <Typography variant="caption" color="warning.main" sx={{ mt: 1, display: 'block' }}>
                        Metadata warnings: {metadata.warnings.join('; ')}
                      </Typography>
                    )}
                    {info.note && (
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                        {info.note}
                      </Typography>
                    )}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary" role="status" sx={{ mt: 2 }}>
                    Reading image info…
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography variant="overline" color="text.secondary">
                  Output
                </Typography>
                <FormControl fullWidth>
                  <InputLabel id="target-format-label">Output format</InputLabel>
                  <Select
                    labelId="target-format-label"
                    id="target-format"
                    label="Output format"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    {encodable.map((c) => (
                      <MenuItem key={c.format_id} value={c.format_id}>
                        {formatLabel(capabilities, c.format_id)}
                      </MenuItem>
                    ))}
                  </Select>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    {encodable.length} encodable formats, from the engine registry. SVG is decode-only;
                    HEIC / HEIF / APNG / RAW / PSD are not convertible in this build.
                  </Typography>
                </FormControl>

                <Box>
                  <Typography id="quality-label" gutterBottom>
                    Quality: {quality}
                  </Typography>
                  <Slider
                    id="quality"
                    aria-labelledby="quality-label"
                    min={1}
                    max={100}
                    value={quality}
                    disabled={!qualityApplies}
                    onChange={(_e, value) => setQuality(value as number)}
                  />
                  {!qualityApplies && (
                    <Typography variant="caption" color="text.secondary">
                      Quality applies to JPEG, WebP and AVIF only; {target.toUpperCase()} ignores it.
                    </Typography>
                  )}
                </Box>

                <Box>
                  <Typography id="background-label" gutterBottom>
                    Background colour (flattens transparency)
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <input
                      id="background"
                      aria-labelledby="background-label"
                      type="color"
                      value={background}
                      onChange={(e) => setBackground(e.target.value)}
                      style={{ height: 40, width: 48 }}
                    />
                    <Typography variant="body2">{background}</Typography>
                  </Box>
                  {targetHasNoAlpha && (
                    <Typography variant="caption" color="text.secondary">
                      {target.toUpperCase()} has no alpha channel — transparent pixels become {background}.
                    </Typography>
                  )}
                </Box>

                <FormControl fullWidth>
                  <InputLabel id="metadata-policy-label">Metadata</InputLabel>
                  <Select
                    labelId="metadata-policy-label"
                    id="metadata-policy"
                    label="Metadata"
                    value={metadataPolicy}
                    onChange={(e) => setMetadataPolicy(e.target.value)}
                  >
                    <MenuItem value="strip">Strip (default)</MenuItem>
                    <MenuItem value="preserve">Preserve (EXIF / ICC / XMP)</MenuItem>
                    <MenuItem value="preserve-color-profiles">Preserve colour profiles only</MenuItem>
                    <MenuItem value="normalize-orientation">Normalise orientation</MenuItem>
                  </Select>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    Preservation is byte-exact for JPEG and PNG targets only; other targets drop
                    metadata and the result says so.
                  </Typography>
                </FormControl>

                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Processing (optional)
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2">Resize to fit</Typography>
                      <TextField
                        value={resizeFit}
                        onChange={(e) => setResizeFit(e.target.value)}
                        placeholder="800x600"
                        aria-label="Resize to fit, width x height"
                        size="small"
                        sx={{ width: 120 }}
                      />
                      <Typography variant="caption" color="text.secondary">never upscales</Typography>
                    </Box>
                    <FormControlLabel
                      control={<Checkbox checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} />}
                      label="Grayscale"
                    />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2">Rotate</Typography>
                      <Select value={rotate} onChange={(e) => setRotate(e.target.value)} size="small">
                        <MenuItem value="0">None</MenuItem>
                        <MenuItem value="90">90°</MenuItem>
                        <MenuItem value="180">180°</MenuItem>
                        <MenuItem value="270">270°</MenuItem>
                      </Select>
                    </Box>
                    <FormControlLabel
                      control={<Checkbox checked={flipH} onChange={(e) => setFlipH(e.target.checked)} />}
                      label="Flip horizontal"
                    />
                    <FormControlLabel
                      control={<Checkbox checked={flipV} onChange={(e) => setFlipV(e.target.checked)} />}
                      label="Flip vertical"
                    />
                  </Box>
                  {hasPipeline && (
                    <Typography variant="caption" color="text.secondary">
                      Processing is on — this runs <code>Engine::process</code> instead of plain convert.
                    </Typography>
                  )}
                </Box>

                {frames && frames.frame_count > 1 && (
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>
                      Frame / page to extract ({frames.frame_count}{' '}
                      {frames.is_multi_page ? 'pages' : 'frames'})
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <FormControl sx={{ flexGrow: 1 }}>
                        <InputLabel id="frame-select-label">Frame</InputLabel>
                        <Select
                          labelId="frame-select-label"
                          id="frame-select"
                          label="Frame"
                          value={selectedFrame}
                          onChange={(e) => setSelectedFrame(Number(e.target.value))}
                        >
                          {frames.frames.map((f) => (
                            <MenuItem key={f.index} value={f.index}>
                              Frame {f.index} — {f.width}×{f.height}
                              {f.delay_ms !== null ? ` · ${f.delay_ms} ms` : ''}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Button type="button" variant="outlined" onClick={() => void runExtractFrame()} disabled={busy}>
                        Extract frame
                      </Button>
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      GIF and multi-page TIFF extract any frame; APNG / animated WebP only report frame
                      info — extracting a later frame fails honestly.
                    </Typography>
                  </Box>
                )}

                <Button
                  type="button"
                  variant="contained"
                  size="large"
                  onClick={() => void runConvert()}
                  disabled={busy || !info}
                >
                  {busy ? busyLabel : `Convert to ${target.toUpperCase()}`}
                </Button>
                {busy && (
                  <Typography variant="body2" color="text.secondary" role="status">
                    {busyLabel} The engine runs on this machine; large files (up to 100 MiB / 100 MP)
                    can take a few seconds.
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {result && (
        <Alert severity="success" role="status">
          <Typography variant="subtitle2">Converted</Typography>
          <Typography variant="body2">
            {result.source_format.toUpperCase()} → {result.target_format.toUpperCase()} ·{' '}
            {result.width}×{result.height} · {formatBytes(result.input_bytes)} →{' '}
            {formatBytes(result.output_bytes)}
          </Typography>
          <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
            {result.output_path}
          </Typography>
          {result.warnings.length > 0 && (
            <ul>
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {result.metadata_preserved.length > 0 && (
            <Typography variant="caption">Metadata preserved: {result.metadata_preserved.join(', ')}</Typography>
          )}
          {result.metadata_dropped.length > 0 && (
            <Typography variant="caption">Metadata dropped: {result.metadata_dropped.join(', ')}</Typography>
          )}
          {result.orientation_applied && (
            <Typography variant="caption">Orientation applied: {result.orientation_applied}</Typography>
          )}
        </Alert>
      )}
    </Box>
  )
}
