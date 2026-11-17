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
import { plural, useI18n } from '../lib/i18n'

interface SettingsPanelProps {
  settings: Settings
  onSettingsChange: (settings: Settings) => void
}

/**
 * Settings — persisted on-device in localStorage, no account, no server.
 * Every control here does a real operation (including Reset and Clear).
 */
export function SettingsPanel({ settings, onSettingsChange }: SettingsPanelProps) {
  const { t, lang } = useI18n()
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
            {t('settings.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 720 }}>
            {t('settings.savedNote')}
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
              {t('settings.preferences')}
            </Typography>
            <Stack spacing={2.5} sx={{ mt: 1 }}>
              <Box>
                <Typography variant="subtitle2" component="label" htmlFor="theme">
                  {t('settings.theme')}
                </Typography>
                <Select
                  native
                  fullWidth
                  id="theme"
                  value={settings.theme}
                  onChange={(e) => update({ theme: e.target.value as Settings['theme'] })}
                  sx={{ mt: 0.5 }}
                >
                  <option value="system">{t('settings.themeSystem')}</option>
                  <option value="light">{t('settings.themeLight')}</option>
                  <option value="dark">{t('settings.themeDark')}</option>
                </Select>
              </Box>

              <Box>
                <Typography variant="subtitle2" component="label" htmlFor="language">
                  {t('settings.language')}
                </Typography>
                <Select
                  native
                  fullWidth
                  id="language"
                  value={settings.language}
                  onChange={(e) => update({ language: e.target.value as Settings['language'] })}
                  sx={{ mt: 0.5 }}
                >
                  <option value="en">{t('settings.languageEn')}</option>
                  <option value="bn">{t('settings.languageBn')}</option>
                </Select>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  {t('settings.languageNote')}
                </Typography>
              </Box>

              <Box>
                <Typography variant="subtitle2" component="label">
                  {t('settings.quality', { n: settings.defaultQuality })}
                </Typography>
                <Slider
                  aria-label="Default JPEG / WebP quality"
                  min={1}
                  max={100}
                  value={settings.defaultQuality}
                  onChange={(_, value) => update({ defaultQuality: value as number })}
                />
                <Typography variant="caption" color="text.secondary">
                  {t('settings.qualityNote')}
                </Typography>
              </Box>

              <Box>
                <Typography variant="subtitle2" component="label" htmlFor="default-format">
                  {t('settings.defaultFormat')}
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
                  {t('settings.defaultFormatNote')}
                </Typography>
              </Box>

              <Box>
                <Typography variant="subtitle2" component="label">
                  {t('settings.defaultBg')}
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
                  {t('settings.batch', { n: settings.batchWorkers, s: plural(lang, settings.batchWorkers) })}
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
                  {t('settings.batchNote')}
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
                  label={t('settings.bg3d')}
                />
                <Typography variant="caption" color="text.secondary" display="block">
                  {t('settings.bg3dNote')}
                </Typography>
              </Box>

              <Stack direction="row" flexWrap="wrap" spacing={1.5} sx={{ pt: 0.5 }}>
                <Button type="button" variant="outlined" onClick={() => onSettingsChange({ ...DEFAULT_SETTINGS })}>
                  {t('settings.reset')}
                </Button>
                <Button
                  type="button"
                  variant="outlined"
                  onClick={() => {
                    localStorage.removeItem('openpixel.settings.v1')
                    onSettingsChange({ ...DEFAULT_SETTINGS })
                  }}
                >
                  {t('settings.clearSaved')}
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              {t('settings.about')}
            </Typography>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 1 }}>
              {t('settings.aboutTitle')}
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
              {t('settings.privacy')}
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
                  label={t('settings.record')}
                />
                <Typography variant="caption" color="text.secondary" display="block">
                  {t('settings.recordNote')}
                </Typography>
              </Box>
              <Box>
                <Typography variant="body2">
                  {t('settings.historyCount', { n: historyCount, s: plural(lang, historyCount), bytes: formatActivityBytes(historyBytes) })}
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
                  {t('common.clearHistory')}
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              {t('settings.storage')}
            </Typography>
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              <Typography variant="body2">
                {t('settings.storageHistory', { bytes: formatActivityBytes(historyBytes), n: historyCount })}
              </Typography>
              <Typography variant="body2">
                {wasmSupport
                  ? t('settings.wasmLoaded', { d: wasmSupport.decode.length, e: wasmSupport.encode.length })
                  : t('settings.wasmMissing')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('settings.filesNeverStored')}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
        </Box>
      </Stack>
    </Box>
  )
}
