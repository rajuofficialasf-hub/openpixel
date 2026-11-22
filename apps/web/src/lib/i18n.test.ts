import { describe, expect, it } from 'vitest'
import { plural, translate } from './i18n'

describe('i18n', () => {
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

  it('switching language changes the same key', () => {
    const key = 'nav.tools'
    expect(translate('en', key)).not.toBe(translate('bn', key))
    expect(translate('en', key)).toBe('All Tools')
    expect(translate('bn', key)).toBe('সব টুল')
  })
})
