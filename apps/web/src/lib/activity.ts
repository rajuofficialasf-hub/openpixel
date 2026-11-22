/**
 * Local activity history — the only record of processed files.
 *
 * There is no account and no server: this store keeps file NAME,
 * SIZE, TYPE, the tool used, a short result summary and the date —
 * never file contents, never a thumbnail. It lives in localStorage
 * (`openpixel.activity.v1`, capped at 200 entries, oldest first
 * out). The workspace pages (My Files, Recent Files, dashboard)
 * and the All Tools "recently used" section read it. If it is
 * empty, those pages show the honest empty state — never invented
 * files. Recording can be switched off in Settings; clearing it
 * deletes the whole history.
 */

import { translate, type Language } from './i18n'

export interface ActivityEntry {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  tool: string
  result: string
  /**
   * Language-neutral result, when the recorder supplied one: the
   * i18n key plus its params, rendered localised at read time by
   * `formatActivityResult`. `result` stays the English text, so
   * entries recorded before this field existed (and any entry
   * without a key) still render as-is — never blank, never a crash.
   */
  resultKey?: string
  resultParams?: Record<string, string | number>
  at: number
  starred: boolean
}

/** Render an entry's result in the given language. */
export function formatActivityResult(lang: Language, entry: ActivityEntry): string {
  if (entry.resultKey) return translate(lang, entry.resultKey, entry.resultParams)
  return entry.result
}

const STORAGE_KEY = 'openpixel.activity.v1'
const MAX_ENTRIES = 200

export function loadActivity(): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (e): e is ActivityEntry =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as ActivityEntry).fileName === 'string' &&
          typeof (e as ActivityEntry).at === 'number',
      )
      .slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

function save(entries: ActivityEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // Storage full / private mode — history just does not persist.
  }
}

/** Bytes the history itself occupies (for the Storage card). */
export function activityStoreBytes(): number {
  try {
    return (localStorage.getItem(STORAGE_KEY) ?? '').length
  } catch {
    return 0
  }
}

export function recordActivity(entry: Omit<ActivityEntry, 'id' | 'at' | 'starred'>): void {
  try {
    if (localStorage.getItem('openpixel.activity.off') === '1') return
  } catch {
    return
  }
  const full: ActivityEntry = {
    ...entry,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    starred: false,
  }
  save([full, ...loadActivity()])
}

export function isActivityRecordingOn(): boolean {
  try {
    return localStorage.getItem('openpixel.activity.off') !== '1'
  } catch {
    return true
  }
}

export function setActivityRecording(on: boolean): void {
  try {
    if (on) localStorage.removeItem('openpixel.activity.off')
    else localStorage.setItem('openpixel.activity.off', '1')
  } catch {
    // ignore
  }
}

export function clearActivity(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function toggleStar(id: string): void {
  save(loadActivity().map((e) => (e.id === id ? { ...e, starred: !e.starred } : e)))
}

export function removeActivity(id: string): void {
  save(loadActivity().filter((e) => e.id !== id))
}

/** Human file size, e.g. 143.4 KB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * Short date, e.g. "17 Nov 2026, 13:40" in English. The month
 * (and digits) follow the language: `Intl.DateTimeFormat` with
 * `bn-BD` renders the Bengali month name, `en-GB` the English
 * one — no hand-kept month list to drift out of sync.
 */
export function formatDate(at: number, lang: Language = 'en'): string {
  return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(at))
}
