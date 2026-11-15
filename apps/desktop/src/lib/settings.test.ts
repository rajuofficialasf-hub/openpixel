import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings'

describe('desktop settings', () => {
  it('loads defaults when nothing is stored', () => {
    localStorage.clear()
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips a saved settings object', () => {
    localStorage.clear()
    saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark', batchWorkers: 8, defaultQuality: 90 })
    const loaded = loadSettings()
    expect(loaded.theme).toBe('dark')
    expect(loaded.batchWorkers).toBe(8)
    expect(loaded.defaultQuality).toBe(90)
  })

  it('clamps batch workers to the engine range 1..=8', () => {
    localStorage.clear()
    saveSettings({ ...DEFAULT_SETTINGS, batchWorkers: 99 })
    expect(loadSettings().batchWorkers).toBe(8)
    saveSettings({ ...DEFAULT_SETTINGS, batchWorkers: 0 })
    expect(loadSettings().batchWorkers).toBe(1)
  })

  it('clamps quality to 1..=100 and falls back on bad JSON', () => {
    localStorage.clear()
    saveSettings({ ...DEFAULT_SETTINGS, defaultQuality: 500 })
    expect(loadSettings().defaultQuality).toBe(100)
    localStorage.setItem('openpixel.desktop.settings.v1', '{not json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })
})
