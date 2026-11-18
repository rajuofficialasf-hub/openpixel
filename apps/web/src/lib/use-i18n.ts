/**
 * The i18n React context + hook (`useI18n`).
 * Lives in its own file (no components) so oxlint's
 * `react(only-export-components)` fast-refresh rule stays quiet:
 * the provider component lives in `i18n-context.tsx` and imports
 * the context from here.
 */
import { createContext, useContext } from 'react'
import { translate, type Language } from './i18n'

export interface I18n {
  lang: Language
  t: (key: string, vars?: Record<string, string | number>) => string
}

export const I18nContext = createContext<I18n>({
  lang: 'en',
  t: (key, vars) => translate('en', key, vars),
})

export function useI18n(): I18n {
  return useContext(I18nContext)
}
