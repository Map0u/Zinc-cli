import { createContext, useContext, useMemo, type ReactNode } from 'react'
import enUS from './locales/en-US.json'
import zhCN from './locales/zh-CN.json'
import { useSettings } from '../settings/SettingsContext'
import type { LanguagePref } from '../../../shared/settingsTypes'

export type LocaleKey = keyof typeof enUS
type ResolvedLanguage = 'en' | 'zh'

const DICTIONARIES: Record<ResolvedLanguage, Record<string, string>> = { en: enUS, zh: zhCN }

/** `Auto` follows the OS/browser locale — no restart required (parity §1.7 enhancement over the WinUI original). */
function resolveSystemLanguage(): ResolvedLanguage {
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

interface I18nContextValue {
  t: (key: LocaleKey) => string
  language: ResolvedLanguage
  languagePref: LanguagePref
  setLanguagePref: (pref: LanguagePref) => void
}

const I18nContext = createContext<I18nContextValue | null>(null)

/**
 * Lightweight in-house i18n (flat key→string JSON, no external dependency).
 * Reads/writes the language preference through SettingsContext so a change
 * is both applied immediately (this provider re-renders) and persisted —
 * must be mounted inside a SettingsProvider.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const { settings, updateImmediate } = useSettings()
  const languagePref: LanguagePref = settings?.Language ?? 'auto'
  const language = languagePref === 'auto' ? resolveSystemLanguage() : languagePref
  const dict = DICTIONARIES[language]

  const value = useMemo<I18nContextValue>(
    () => ({
      t: (key: LocaleKey) => dict[key] ?? key,
      language,
      languagePref,
      setLanguagePref: (pref: LanguagePref) => updateImmediate({ Language: pref })
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dict, language, languagePref]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider')
  return ctx
}
