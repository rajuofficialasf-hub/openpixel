/**
 * Settings persisted on-device (localStorage). No account, no server.
 */
import type { ResizeMode } from './resize'

export type Theme = 'light' | 'dark' | 'system'

export type MetadataPolicy = 'strip' | 'preserve'

export interface ResizeSettings {
  mode: ResizeMode
  preset: string
  quality: number
  format: string
}

export interface Settings {
  theme: Theme
  defaultQuality: number // JPEG/WebP quality 1–100
  defaultFormat: string // engine format id, e.g. 'webp'
  defaultBackground: string // hex colour used to flatten alpha
  metadataPolicy: MetadataPolicy
  batchWorkers: number // 1–4 files converted concurrently in the batch view
  show3dBackground: boolean // animated Three.js background behind the header
  resize: ResizeSettings // last-used Resize tab settings
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  defaultQuality: 85,
  defaultFormat: 'webp',
  defaultBackground: '#ffffff',
  metadataPolicy: 'strip',
  batchWorkers: 4,
  // Phase 6: the 3D backdrop is decoration — default OFF in the new
  // minimal shell (the Settings toggle still re-enables it).
  show3dBackground: false,
  resize: { mode: 'fit', preset: 'fhd', quality: 85, format: 'jpeg' },
}

const STORAGE_KEY = 'openpixel.settings.v1'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS, resize: { ...DEFAULT_SETTINGS.resize } }
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      theme: parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : 'system',
      defaultQuality:
        typeof parsed.defaultQuality === 'number'
          ? Math.min(100, Math.max(1, Math.round(parsed.defaultQuality)))
          : DEFAULT_SETTINGS.defaultQuality,
      defaultFormat:
        typeof parsed.defaultFormat === 'string' ? parsed.defaultFormat : DEFAULT_SETTINGS.defaultFormat,
      defaultBackground:
        typeof parsed.defaultBackground === 'string'
          ? parsed.defaultBackground
          : DEFAULT_SETTINGS.defaultBackground,
      metadataPolicy: parsed.metadataPolicy === 'preserve' ? 'preserve' : 'strip',
      batchWorkers:
        typeof parsed.batchWorkers === 'number'
          ? Math.min(4, Math.max(1, Math.round(parsed.batchWorkers)))
          : DEFAULT_SETTINGS.batchWorkers,
      show3dBackground:
        typeof parsed.show3dBackground === 'boolean'
          ? parsed.show3dBackground
          : DEFAULT_SETTINGS.show3dBackground,
      resize: parseResizeSettings(parsed.resize),
    }
  } catch {
    return { ...DEFAULT_SETTINGS, resize: { ...DEFAULT_SETTINGS.resize } }
  }
}

const RESIZE_MODES: ResizeMode[] = ['fit', 'fill', 'pad', 'exact']

/** Validate stored resize settings — garbage falls back to defaults, never crashes. */
function parseResizeSettings(value: unknown): ResizeSettings {
  const fallback = { ...DEFAULT_SETTINGS.resize }
  if (!value || typeof value !== 'object') return fallback
  const v = value as Partial<ResizeSettings>
  return {
    mode: typeof v.mode === 'string' && (RESIZE_MODES as string[]).includes(v.mode) ? v.mode : fallback.mode,
    preset: typeof v.preset === 'string' ? v.preset : fallback.preset,
    quality:
      typeof v.quality === 'number'
        ? Math.min(100, Math.max(1, Math.round(v.quality)))
        : fallback.quality,
    format: typeof v.format === 'string' ? v.format : fallback.format,
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage full / private mode — settings just do not persist.
  }
}

/** Resolve the effective theme ('system' follows the OS preference). */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}
