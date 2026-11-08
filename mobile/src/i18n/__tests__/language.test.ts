// Adapted from the TShentu/famlin fork's language test.
import i18n, { initI18nLanguage } from '../index'
import { getLanguage } from '@/utils/storage'
import { getLocales } from 'expo-localization'

jest.mock('@/utils/storage', () => ({ getLanguage: jest.fn() }))
jest.mock('expo-localization', () => ({ getLocales: jest.fn() }))

function deviceLocales(...tags: string[]) {
  jest
    .mocked(getLocales)
    .mockReturnValue(
      tags.map((languageTag) => ({ languageTag, languageCode: languageTag.split('-')[0] })) as unknown as ReturnType<
        typeof getLocales
      >
    )
}

beforeEach(() => {
  jest.mocked(getLanguage).mockResolvedValue(null)
  deviceLocales('zh')
})

test('Chinese devices start in Chinese and interpolate counts', async () => {
  await initI18nLanguage()
  expect(i18n.language).toBe('zh')
  expect(i18n.t('login.continueButton')).toBe('继续')
  expect(i18n.t('relativeTime.minutesAgo', { count: 2 })).toBe('2 分钟前')
})

test('Portuguese (Portugal) devices start in pt-PT with European Portuguese plurals', async () => {
  deviceLocales('pt-PT')
  await initI18nLanguage()
  expect(i18n.language).toBe('pt-PT')
  expect(i18n.t('login.continueButton')).toBe('Continuar')
  expect(i18n.t('relativeTime.minutesAgo', { count: 1 })).toBe('há 1 minuto')
  expect(i18n.t('relativeTime.minutesAgo', { count: 0 })).toBe('há 0 minutos')
})

test('other Portuguese variants fall back to pt-PT', async () => {
  deviceLocales('pt-BR')
  await initI18nLanguage()
  expect(i18n.language).toBe('pt-PT')
})

test('French devices start in French with French plurals', async () => {
  deviceLocales('fr-CH')
  await initI18nLanguage()
  expect(i18n.language).toBe('fr')
  expect(i18n.t('login.continueButton')).toBe('Continuer')
  expect(i18n.t('relativeTime.minutesAgo', { count: 0 })).toBe('il y a 0 minute')
  expect(i18n.t('relativeTime.minutesAgo', { count: 2 })).toBe('il y a 2 minutes')
})

test('picks the first supported language in the device preference order', async () => {
  deviceLocales('de', 'nl', 'en')
  await initI18nLanguage()
  expect(i18n.language).toBe('nl')
})

test('persisted selection takes precedence over device language', async () => {
  jest.mocked(getLanguage).mockResolvedValue('nl')
  await initI18nLanguage()
  expect(i18n.language).toBe('nl')
})

test('unsupported saved and device languages fall back to English', async () => {
  jest.mocked(getLanguage).mockResolvedValue('invalid')
  deviceLocales('de')
  await initI18nLanguage()
  expect(i18n.language).toBe('en')
})
