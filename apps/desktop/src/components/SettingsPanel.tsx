import {
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Typography,
} from '@mui/material'
import type { AppInfo, FormatCapability } from '../lib/tauri'
import { encodableFormats, formatLabel } from '../lib/tauri'
import type { Settings } from '../lib/settings'
import { DEFAULT_SETTINGS } from '../lib/settings'

interface SettingsPanelProps {
  settings: Settings
  onSettingsChange: (settings: Settings) => void
  capabilities: FormatCapability[]
  appInfo: AppInfo | null
}

export function SettingsPanel({ settings, onSettingsChange, capabilities, appInfo }: SettingsPanelProps) {
  const set = (patch: Partial<Settings>) => onSettingsChange({ ...settings, ...patch })
  const encodable = encodableFormats(capabilities)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Card>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Typography variant="overline" color="text.secondary">
            Preferences
          </Typography>
          <FormControl sx={{ maxWidth: 320 }}>
            <InputLabel id="theme-label">Theme</InputLabel>
            <Select
              labelId="theme-label"
              id="theme"
              label="Theme"
              value={settings.theme}
              onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}
            >
              <MenuItem value="system">System</MenuItem>
              <MenuItem value="light">Light</MenuItem>
              <MenuItem value="dark">Dark</MenuItem>
            </Select>
          </FormControl>
          <Box sx={{ maxWidth: 320 }}>
            <Typography id="default-quality-label" gutterBottom>
              Default quality: {settings.defaultQuality}
            </Typography>
            <Slider
              id="default-quality"
              aria-labelledby="default-quality-label"
              min={1}
              max={100}
              value={settings.defaultQuality}
              onChange={(_e, value) => set({ defaultQuality: value as number })}
            />
            <Typography variant="caption" color="text.secondary">
              Applies to JPEG, WebP and AVIF targets.
            </Typography>
          </Box>
          <FormControl sx={{ maxWidth: 320 }}>
            <InputLabel id="default-format-label">Default output format</InputLabel>
            <Select
              labelId="default-format-label"
              id="default-format"
              label="Default output format"
              value={settings.defaultFormat}
              onChange={(e) => set({ defaultFormat: e.target.value })}
            >
              {encodable.map((c) => (
                <MenuItem key={c.format_id} value={c.format_id}>
                  {formatLabel(capabilities, c.format_id)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Box>
            <Typography id="default-background-label" gutterBottom>
              Default background colour
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <input
                id="default-background"
                aria-labelledby="default-background-label"
                type="color"
                value={settings.defaultBackground}
                onChange={(e) => set({ defaultBackground: e.target.value })}
                style={{ height: 40, width: 48 }}
              />
              <Typography variant="body2">{settings.defaultBackground}</Typography>
            </Box>
          </Box>
          <FormControl sx={{ maxWidth: 320 }}>
            <InputLabel id="metadata-policy-label">Default metadata policy</InputLabel>
            <Select
              labelId="metadata-policy-label"
              id="metadata-policy"
              label="Default metadata policy"
              value={settings.metadataPolicy}
              onChange={(e) => set({ metadataPolicy: e.target.value as Settings['metadataPolicy'] })}
            >
              <MenuItem value="strip">Strip</MenuItem>
              <MenuItem value="preserve">Preserve</MenuItem>
            </Select>
          </FormControl>
          <Box sx={{ maxWidth: 320 }}>
            <Typography id="batch-workers-label" gutterBottom>
              Batch workers: {settings.batchWorkers}
            </Typography>
            <Slider
              id="batch-workers"
              aria-labelledby="batch-workers-label"
              min={1}
              max={8}
              value={settings.batchWorkers}
              onChange={(_e, value) => set({ batchWorkers: value as number })}
            />
            <Typography variant="caption" color="text.secondary">
              1–8 concurrent conversions in the engine worker pool (default 4). Fewer workers use
              less memory on large images.
            </Typography>
          </Box>
          <Box>
            <Button type="button" variant="outlined" onClick={() => onSettingsChange({ ...DEFAULT_SETTINGS })}>
              Reset to defaults
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="overline" color="text.secondary">
            About
          </Typography>
          <Typography variant="body2">
            <strong>OpenPixel</strong> {appInfo ? `desktop ${appInfo.version}` : ''} — the native
            engine (same code as the <code>openpixel</code> CLI) behind a desktop window.
          </Typography>
          <Typography variant="body2">
            <strong>Offline:</strong> yes — no server, no uploads, no account, no network requests.
            Conversion, batching, metadata and logging all happen on this machine.
          </Typography>
          {appInfo && (
            <>
              <Typography variant="body2">Engine version: {appInfo.engine_version}</Typography>
              <Typography variant="body2">Formats known to the engine: {appInfo.format_count}</Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                Log file: {appInfo.log_path}
              </Typography>
            </>
          )}
          <Typography variant="caption" color="text.secondary">
            Conversion limits (enforced by the engine): 100 MiB per file, 100 MP, 16 384 px per side.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}
