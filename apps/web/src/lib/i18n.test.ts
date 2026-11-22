import { describe, expect, it } from 'vitest'
import { bn, en, plural, translate } from './i18n'

describe('i18n', () => {
  it('every English key has a Bengali value except the known fallback', () => {
    const missing: string[] = []
    for (const key of Object.keys(en)) {
      if (key === 'settings.aboutTitle') continue // intentional EN fallback, asserted below
      const value = bn[key]
      if (typeof value !== 'string' || value.length === 0) missing.push(key)
    }
    expect(missing).toEqual([])
  })
  it('returns the English string by default', () => {
    expect(translate('en', 'nav.tools')).toBe('All Tools')
    expect(translate('en', 'home.heroTitle')).toBe('File tools that never upload your files')
  })

  it('returns the Bengali string when present', () => {
    expect(translate('bn', 'nav.tools')).toBe('সব টুল')
    expect(translate('bn', 'nav.settings')).toBe('সেটিংস')
    expect(translate('bn', 'ws.welcome')).toBe('ওভারভিউ')
  })

  it('keeps tool names in English in Bengali mode', () => {
    expect(translate('bn', 'nav.convert')).toBe('Convert Image')
    expect(translate('bn', 'nav.pdf')).toBe('PDF Tools')
    expect(translate('bn', 'nav.ocr')).toBe('OCR')
  })

  it('falls back to English for a missing Bengali string', () => {
    // 'settings.aboutTitle' deliberately has no Bengali entry
    // (see i18n.ts) — the Bengali UI shows the English text.
    expect(translate('bn', 'settings.aboutTitle')).toBe('About this app')
    expect(translate('en', 'settings.aboutTitle')).toBe('About this app')
  })

  it('falls back to the key itself for an unknown key', () => {
    expect(translate('en', 'does.not.exist')).toBe('does.not.exist')
    expect(translate('bn', 'does.not.exist')).toBe('does.not.exist')
  })

  it('interpolates {vars}', () => {
    expect(translate('en', 'home.howStep', { n: 2 })).toBe('Step 2')
    expect(translate('bn', 'home.howStep', { n: 2 })).toBe('ধাপ 2')
    expect(translate('bn', 'tools.count', { n: 5, s: plural('bn', 5) })).toBe('5টি টুল')
    expect(translate('en', 'tools.count', { n: 1, s: plural('en', 1) })).toBe('1 tool')
    expect(translate('en', 'tools.count', { n: 3, s: plural('en', 3) })).toBe('3 tools')
  })

  it('spot-checks the audit-fix keys in both languages', () => {
    expect(translate('en', 'cv.title')).toBe('Convert one image')
    expect(translate('bn', 'cv.title')).toBe('একটি ছবি কনভার্ট করুন')
    expect(translate('bn', 'ocr.title')).toBe('টেক্সট শনাক্তকরণ (OCR)')
    expect(translate('en', 'pdf.mergeDesc')).toBe(
      'Combine two PDFs into one — the second is appended after the first.',
    )
    expect(translate('bn', 'pdf.mergeDesc')).toBe(
      'দুটি PDF একত্রে একটি করুন — দ্বিতীয়টি প্রথমটির পরে জুড়ে দেওয়া হবে।',
    )
    expect(translate('en', 'bt.status', { n: 3, pl: 's', d: 2, f: 0, sk: 1 })).toBe(
      '3 files — 2 converted, 0 failed, 1 skipped (cannot decode in this browser)',
    )
    expect(translate('bn', 'act.convert', { format: 'WebP', w: 512, h: 384, bytes: '120 KB' })).toBe(
      'WebP-এ কনভার্ট হয়েছে · 512×384 · 120 KB',
    )
    expect(translate('bn', 'lib.cv.workerFailed')).toBe('Worker-এ কনভার্শন ব্যর্থ হয়েছে।')
  })

  it('switching language changes the same key', () => {
    const key = 'nav.tools'
    expect(translate('en', key)).not.toBe(translate('bn', key))
    expect(translate('en', key)).toBe('All Tools')
    expect(translate('bn', key)).toBe('সব টুল')
  })
})
