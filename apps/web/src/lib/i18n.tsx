/**
 * React binding for the i18n string tables (`lib/i18n.ts`).
 * Kept in its own file so the pure module stays free of JSX
 * (oxlint fast-refresh rule) and stays importable from tests
 * without React.
 */
import { createContext, useContext, type ReactNode } from 'react'
import { translate, type Language } from './i18n'

export type { Language } from './i18n'

export interface I18n {
  lang: Language
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18n>({ lang: 'en', t: (key, vars) => translate('en', key, vars) })

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const value: I18n = {
    lang: language,
    t: (key, vars) => translate(language, key, vars),
  }
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  return useContext(I18nContext)
}
