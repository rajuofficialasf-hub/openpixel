import { useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  activityStoreBytes,
  clearActivity,
  formatBytes as formatActivityBytes,
  isActivityRecordingOn,
  loadActivity,
  setActivityRecording,
} from '../lib/activity'
import { browserEncodableFormats, formatLabel } from '../lib/capabilities'
import { DEFAULT_SETTINGS, type Settings } from '../lib/settings'
import { useWasmSupport } from '../lib/wasm-engine'

interface SettingsPanelProps {
  settings: Settings
  onSettingsChange: (settings: Settings) => void
}

/**
 * Settings — persisted on-device in localStorage, no account, no server.
 * Every control here does a real operation (including Reset and Clear).
 */
export function SettingsPanel({ settings, onSettingsChange }: SettingsPanelProps) {
  const update = (patch: Partial<Settings>) => onSettingsChange({ ...settings, ...patch })

  // Privacy / Storage cards read the local history store directly —
  // the numbers refresh after Clear, and after the recording toggle.
  const [recording, setRecording] = useState(() => isActivityRecordingOn())
  const [historyBytes, setHistoryBytes] = useState(() => activityStoreBytes())
  const [historyCount, setHistoryCount] = useState(() => loadActivity().length)
  const refreshHistory = () => {
    setHistoryBytes(activityStoreBytes())
    setHistoryCount(loadActivity().length)
  }
  const wasmSupport = useWasmSupport()

  const codeSx = {
    fontFamily: 'monospace',
    fontSize: '0.85em',
    bgcolor: 'action.hover',
    px: 0.5,
    borderRadius: 0.5,
  }

  return (
    <Box component="section" aria-labelledby="settings-heading">
      <Stack spacing={3}>
        <Box>
          <Typography variant="h5" component="h2" id="settings-heading">
            Settings
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 720 }}>
            Saved on this device only — no account, no server.
          </Typography>
        </Box>

        <Box
          sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: { md: 'minmax(0, 7fr) minmax(0, 5fr)' },
            alignItems: 'start',
          }}
        >
        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              Preferences
            </Typography>
            <Stack spacing={2.5} sx={{ mt: 1 }}>
              <Box>
                <Typography variant="subtitle2" component="label" htmlFor="theme">
                  Theme
                </Typography>
                <Select
                  native
                  fullWidth
                  id="theme"
                  value={settings.theme}
                  onChange={(e) => update({ theme: e.target.value as Settings['theme'] })}
                  sx={{ mt: 0.5 }}
                >
                  <option value="system">System (follow your OS)</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </Select>
              </Box>

              <Box>
                <Typography variant="subtitle2" component="label" htmlFor="language">
                  Language
                </Typography>
                <Select
                  native
                  fullWidth
                  id="language"
                  value={settings.language}
                  onChange={(e) => update({ language: e.target.value as Settings['language'] })}
                  sx={{ mt: 0.5 }}
                >
                  <option value="en">English</option>
                  <option value="bn">বাংলা (Bengali)</option>
                </Select>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  Bengali is saved as your preference now — the interface itself stays in English until the
                  Bengali strings land. The Bengali font is already bundled.
                </Typography>
              </Box>

              <Box>
                <Typography variant="subtitle2" component="label">
                  Default JPEG / WebP quality: {settings.defaultQuality}
                </Typography>
                <Slider
                  aria-label="Default JPEG / WebP quality"
                  min={1}
                  max={100}
                  value={settings.defaultQuality}
                  onChange={(_, value) => update({ defaultQuality: value as number })}
                />
                <Typography variant="caption" color="text.secondary">
                  Used as the starting quality in the Convert and Batch views. The engine default is 85.
                </Typography>
              </Box>

              <Box>
                <Typography variant="subtitle2" component="label" htmlFor="default-format">
                  Default output format
                </Typography>
                <Select
                  native
                  fullWidth
                  id="default-format"
                  value={settings.defaultFormat}
                  onChange={(e) => update({ defaultFormat: e.target.value })}
                  sx={{ mt: 0.5 }}
                >
                  {browserEncodableFormats().map((t) => (
                    <option key={t.format_id} value={t.format_id}>
                      {formatLabel(t.format_id)}
                    </option>
                  ))}
                </Select>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  Only formats this browser can encode are offered here.
                </Typography>
              </Box>

              <Box>
                <Typography variant="subtitle2" component="label">
                  Default background colour (flattens transparency for JPEG/BMP)
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                  <TextField
                    type="color"
                    size="small"
                    value={settings.defaultBackground}
                    onChange={(e) => update({ defaultBackground: e.target.value })}
                    inputProps={{ 'aria-label': 'Default background colour picker' }}
                    sx={{ width: 56, '& input': { p: 0.5, height: 40, cursor: 'pointer' } }}
                  />
                  <TextField
                    size="small"
                    value={settings.defaultBackground}
                    onChange={(e) => update({ defaultBackground: e.target.value })}
                    inputProps={{ 'aria-label': 'Default background colour hex value' }}
                    sx={{ width: 120, '& input': { fontFamily: 'monospace' } }}
                  />
                </Stack>
              </Box>

              <Box>
                <Typography variant="subtitle2" component="label">
                  Batch concurrency: {settings.batchWorkers} file{settings.batchWorkers === 1 ? '' : 's'} at a
                  time
                </Typography>
                <Slider
                  aria-label="Batch concurrency"
                  min={1}
                  max={4}
                  step={1}
                  value={settings.batchWorkers}
                  onChange={(_, value) => update({ batchWorkers: value as number })}
                />
                <Typography variant="caption" color="text.secondary">
                  The native CLI allows up to 8 workers; the browser is capped at 4 so a batch cannot
                  exhaust tab memory. Conversion itself runs in a Web Worker, so the UI stays responsive.
                </Typography>
              </Box>

              <Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.show3dBackground}
                      onChange={(_, checked) => update({ show3dBackground: checked })}
                      inputProps={{ 'aria-label': '3D background' }}
                    />
                  }
                  label="3D background"
                />
                <Typography variant="caption" color="text.secondary" display="block">
                  Animated Three.js backdrop behind the header. Turn it off for a static page, or if
                  motion is distracting — the setting is saved on this device.
                </Typography>
              </Box>

              <Stack direction="row" flexWrap="wrap" spacing={1.5} sx={{ pt: 0.5 }}>
                <Button type="button" variant="outlined" onClick={() => onSettingsChange({ ...DEFAULT_SETTINGS })}>
                  Reset to defaults
                </Button>
                <Button
                  type="button"
                  variant="outlined"
                  onClick={() => {
                    localStorage.removeItem('openpixel.settings.v1')
                    onSettingsChange({ ...DEFAULT_SETTINGS })
                  }}
                >
                  Clear saved settings
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              About
            </Typography>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 1 }}>
              About this app
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              OpenPixel web (Phase 7) — React + TypeScript + Vite + Material UI, with a Three.js
              animated background. All processing is local: there is no server, no account, and no
              upload. Capability data is generated from the Rust engine with{' '}
              <Box component="code" sx={codeSx}>
                npm run generate:capabilities
              </Box>
              . WASM processing is available in this build: the real Rust engine compiles to
              wasm32 as a dav1d-free build (`crates/openpixel-wasm`, see docs/WEB.md) and is
              packaged into `public/wasm/` with{' '}
              <Box component="code" sx={codeSx}>
                npm run build:wasm
              </Box>
              ; conversion uses the browser canvas in a Web Worker for PNG / JPEG / WebP and
              the WASM engine for the formats the canvas cannot handle (including BMP, which
              the canvas cannot encode at all). AVIF is not available in
              WASM (it needs the native libdav1d library).
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              Privacy
            </Typography>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={recording}
                      onChange={(_, checked) => {
                        setActivityRecording(checked)
                        setRecording(checked)
                      }}
                      inputProps={{ 'aria-label': 'Record processed files in My Files' }}
                    />
                  }
                  label="Record processed files in My Files"
                />
                <Typography variant="caption" color="text.secondary" display="block">
                  When on, the file name, size, tool and result of each file you process are saved on this
                  device (My Files, Recent Files, dashboard). File contents are never stored. Turning it off
                  stops new entries — existing history stays until you clear it.
                </Typography>
              </Box>
              <Box>
                <Typography variant="body2">
                  {historyCount} file{historyCount === 1 ? '' : 's'} in history ·{' '}
                  {formatActivityBytes(historyBytes)}
                </Typography>
                <Button
                  type="button"
                  variant="outlined"
                  sx={{ mt: 1 }}
                  onClick={() => {
                    clearActivity()
                    refreshHistory()
                  }}
                >
                  Clear history
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              Storage
            </Typography>
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              <Typography variant="body2">
                History: {formatActivityBytes(historyBytes)} ({historyCount} of max 200 entries)
              </Typography>
              <Typography variant="body2">
                WASM engine:{' '}
                {wasmSupport
                  ? `loaded — decodes ${wasmSupport.decode.length} formats, encodes ${wasmSupport.encode.length}`
                  : 'not loaded — still loading, or the module was not built (npm run build:wasm)'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Your files themselves are never stored on this device — only the history above. Results download
                straight to your Downloads folder.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
        </Box>
      </Stack>
    </Box>
  )
}
