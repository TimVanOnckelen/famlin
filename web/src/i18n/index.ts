import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import nl from './locales/nl.json'
import zh from './locales/zh.json'
import ptPT from './locales/pt-PT.json'
import fr from './locales/fr.json'

export const SUPPORTED_LANGUAGES = ['en', 'nl', 'zh', 'pt-PT', 'fr'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en'

const LANGUAGE_KEY = 'famlin_language'

const resources = {
  en: { translation: en },
  nl: { translation: nl },
  zh: { translation: zh },
  'pt-PT': { translation: ptPT },
  fr: { translation: fr },
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

function getBrowserLanguage(): SupportedLanguage {
  return (navigator.language && matchLanguage(navigator.language)) || DEFAULT_LANGUAGE
}

function getStoredLanguage(): SupportedLanguage | null {
  const stored = localStorage.getItem(LANGUAGE_KEY)
  if (stored && SUPPORTED_LANGUAGES.includes(stored as SupportedLanguage)) {
    return stored as SupportedLanguage
  }
  return null
}

export function getInitialLanguage(): SupportedLanguage {
  return getStoredLanguage() || getBrowserLanguage()
}

export function storeLanguage(lang: SupportedLanguage): void {
  localStorage.setItem(LANGUAGE_KEY, lang)
}

// Keep screen readers and browser typography (CJK font selection) aligned
// with the selected UI language.
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language
})

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
