import i18n from 'i18next';
import type { FastifyRequest } from 'fastify';

import en from './locales/en.json' with { type: 'json' };
import nl from './locales/nl.json' with { type: 'json' };

export const SUPPORTED_LANGUAGES = ['en', 'nl'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

const resources = {
  en: { translation: en },
  nl: { translation: nl },
};

i18n.init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
});

export function parseAcceptLanguage(header?: string): SupportedLanguage {
  if (!header) return DEFAULT_LANGUAGE;

  const parsed = header
    .split(',')
    .map((part) => {
      const [lang, qualityPart] = part.trim().split(';');
      const language = lang.split('-')[0].trim().toLowerCase();
      let quality = 1;
      if (qualityPart) {
        const match = qualityPart.match(/q=([0-9.]+)/);
        if (match) quality = parseFloat(match[1]);
      }
      return { language, quality };
    })
    .filter((item) => SUPPORTED_LANGUAGES.includes(item.language as SupportedLanguage))
    .sort((a, b) => b.quality - a.quality);

  return (parsed[0]?.language as SupportedLanguage) || DEFAULT_LANGUAGE;
}

export function getLanguageFromRequest(request: FastifyRequest): SupportedLanguage {
  const header = request.headers['accept-language'];
  return parseAcceptLanguage(Array.isArray(header) ? header[0] : header);
}

export function getT(request: FastifyRequest) {
  const lang = getLanguageFromRequest(request);
  return i18n.getFixedT(lang);
}

export default i18n;
