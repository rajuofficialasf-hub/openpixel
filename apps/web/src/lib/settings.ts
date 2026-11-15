/**
 * Settings persisted on-device (localStorage). No account, no server.
 */
export type Theme = 'light' | 'dark' | 'system'

export type MetadataPolicy = 'strip' | 'preserve'

export interface Settings {
  theme: Theme
  defaultQuality: number // JPEG/WebP quality 1–100
  defaultFormat: string // engine format id, e.g. 'webp'
  defaultBackground: string // hex colour used to flatten alpha
  metadataPolicy: MetadataPolicy
  batchWorkers: number // 1–4 files converted concurrently in the batch view
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  defaultQuality: 85,
  defaultFormat: 'webp',
  defaultBackground: '#ffffff',
  metadataPolicy: 'strip',
  batchWorkers: 4,
}

const STORAGE_KEY = 'openpixel.settings.v1'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
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
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
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
