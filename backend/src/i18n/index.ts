import i18n from 'i18next'
import type { FastifyRequest } from 'fastify'

import en from './locales/en.json' with { type: 'json' }
import nl from './locales/nl.json' with { type: 'json' }
import zh from './locales/zh.json' with { type: 'json' }
import ptPT from './locales/pt-PT.json' with { type: 'json' }

export const SUPPORTED_LANGUAGES = ['en', 'nl', 'zh', 'pt-PT'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en'

const resources = {
  en: { translation: en },
  nl: { translation: nl },
  zh: { translation: zh },
  'pt-PT': { translation: ptPT },
}

i18n.init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
})

// Exact tag first, then primary subtag — so pt-PT, pt and pt-BR all resolve to
// pt-PT, and en-GB to en.
function matchLanguage(tag: string): SupportedLanguage | undefined {
  const lower = tag.trim().toLowerCase()
  const primary = lower.split('-')[0]
  return (
    SUPPORTED_LANGUAGES.find((lang) => lang.toLowerCase() === lower) ??
    SUPPORTED_LANGUAGES.find((lang) => lang.split('-')[0] === primary)
  )
}

export function parseAcceptLanguage(header?: string): SupportedLanguage {
  if (!header) return DEFAULT_LANGUAGE

  const parsed = header
    .split(',')
    .map((part) => {
      const [lang, qualityPart] = part.trim().split(';')
      const language = matchLanguage(lang)
      let quality = 1
      if (qualityPart) {
        const match = qualityPart.match(/q=([0-9.]+)/)
        if (match) quality = parseFloat(match[1])
      }
      return { language, quality }
    })
    .filter((item): item is { language: SupportedLanguage; quality: number } => item.language !== undefined)
    .sort((a, b) => b.quality - a.quality)

  return parsed[0]?.language ?? DEFAULT_LANGUAGE
}

export function getLanguageFromRequest(request: FastifyRequest): SupportedLanguage {
  const header = request.headers['accept-language']
  return parseAcceptLanguage(Array.isArray(header) ? header[0] : header)
}

export function getT(request: FastifyRequest) {
  const lang = getLanguageFromRequest(request)
  return i18n.getFixedT(lang)
}

export default i18n
