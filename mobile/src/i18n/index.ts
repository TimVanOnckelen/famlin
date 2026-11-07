import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import * as Localization from 'expo-localization'

import en from './locales/en.json'
import nl from './locales/nl.json'
import zh from './locales/zh.json'
import ptPT from './locales/pt-PT.json'
import { getLanguage } from '@/utils/storage'

export const SUPPORTED_LANGUAGES = ['en', 'nl', 'zh', 'pt-PT'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en'

const resources = {
  en: { translation: en },
  nl: { translation: nl },
  zh: { translation: zh },
  'pt-PT': { translation: ptPT },
}

i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
})

export async function initI18nLanguage() {
  const storedLang = await getLanguage()
  if (storedLang && SUPPORTED_LANGUAGES.includes(storedLang as SupportedLanguage)) {
    await i18n.changeLanguage(storedLang)
    return
  }

  await i18n.changeLanguage(getDeviceLanguage())
}

// Exact tag first, then primary subtag — so pt-PT, pt and pt-BR all resolve to
// pt-PT, and en-GB to en.
function matchLanguage(tag: string): SupportedLanguage | undefined {
  const lower = tag.toLowerCase()
  const primary = lower.split('-')[0]
  return (
    SUPPORTED_LANGUAGES.find((lang) => lang.toLowerCase() === lower) ??
    SUPPORTED_LANGUAGES.find((lang) => lang.split('-')[0] === primary)
  )
}

// First supported language in the device's preference order, so e.g. a
// phone set to "German, then Dutch" opens in Dutch rather than English.
export function getDeviceLanguage(): SupportedLanguage {
  for (const locale of Localization.getLocales()) {
    const match = matchLanguage(locale.languageTag)
    if (match) return match
  }
  return DEFAULT_LANGUAGE
}

export default i18n
