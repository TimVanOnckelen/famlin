import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import en from './locales/en.json';
import nl from './locales/nl.json';
import zh from './locales/zh.json';
import { getLanguage } from '@/utils/storage';

export const SUPPORTED_LANGUAGES = ['en', 'nl', 'zh'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

const resources = {
  en: { translation: en },
  nl: { translation: nl },
  zh: { translation: zh },
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

  await i18n.changeLanguage(getDeviceLanguage());
}

// First supported language in the device's preference order, so e.g. a
// phone set to "German, then Dutch" opens in Dutch rather than English.
export function getDeviceLanguage(): SupportedLanguage {
  const match = Localization.getLocales()
    .map((locale) => locale.languageCode)
    .find((code): code is SupportedLanguage => !!code && SUPPORTED_LANGUAGES.includes(code as SupportedLanguage));
  return match ?? DEFAULT_LANGUAGE;
}

export default i18n;
