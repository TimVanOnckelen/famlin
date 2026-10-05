import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import nl from './locales/nl.json';
import zh from './locales/zh.json';

export const SUPPORTED_LANGUAGES = ['en', 'nl', 'zh'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

const LANGUAGE_KEY = 'famlin_language';

const resources = {
  en: { translation: en },
  nl: { translation: nl },
  zh: { translation: zh },
};

function getBrowserLanguage(): SupportedLanguage {
  const lang = navigator.language?.split('-')[0];
  return SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage) ? (lang as SupportedLanguage) : DEFAULT_LANGUAGE;
}

function getStoredLanguage(): SupportedLanguage | null {
  const stored = localStorage.getItem(LANGUAGE_KEY);
  if (stored && SUPPORTED_LANGUAGES.includes(stored as SupportedLanguage)) {
    return stored as SupportedLanguage;
  }
  return null;
}

export function getInitialLanguage(): SupportedLanguage {
  return getStoredLanguage() || getBrowserLanguage();
}

export function storeLanguage(lang: SupportedLanguage): void {
  localStorage.setItem(LANGUAGE_KEY, lang);
}

// Keep screen readers and browser typography (CJK font selection) aligned
// with the selected UI language.
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
