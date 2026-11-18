/**
 * React binding for the i18n string tables (`lib/i18n.ts`).
 * Kept in its own file so the pure module stays free of JSX
 * (oxlint fast-refresh rule) and stays importable from tests
 * without React. The context + hook live in `use-i18n.ts`
 * (no components there, so the fast-refresh rule stays quiet).
 */
import { type ReactNode } from 'react'
import { translate, type Language } from './i18n'
import { I18nContext, type I18n } from './use-i18n'

export type { Language } from './i18n'
export type { I18n } from './use-i18n'

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const value: I18n = {
    lang: language,
    t: (key, vars) => translate(language, key, vars),
  }
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
