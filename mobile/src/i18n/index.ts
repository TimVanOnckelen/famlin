import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import en from './locales/en.json';
import nl from './locales/nl.json';
import { getLanguage } from '@/utils/storage';

export const SUPPORTED_LANGUAGES = ['en', 'nl'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

const resources = {
  en: { translation: en },
  nl: { translation: nl },
};

i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
});

export async function initI18nLanguage() {
  const storedLang = await getLanguage();
  if (storedLang && SUPPORTED_LANGUAGES.includes(storedLang as SupportedLanguage)) {
    await i18n.changeLanguage(storedLang);
    return;
  }

  const locales = Localization.getLocales();
  const deviceLang = locales[0]?.languageCode;
  if (deviceLang === 'nl') {
    await i18n.changeLanguage('nl');
  }
}

export default i18n;
