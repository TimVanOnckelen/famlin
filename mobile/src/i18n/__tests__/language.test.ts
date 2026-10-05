// Adapted from the TShentu/famlin fork's language test.
import i18n, { initI18nLanguage } from '../index';
import { getLanguage } from '@/utils/storage';
import { getLocales } from 'expo-localization';

jest.mock('@/utils/storage', () => ({ getLanguage: jest.fn() }));
jest.mock('expo-localization', () => ({ getLocales: jest.fn() }));

function deviceLocales(...codes: string[]) {
  jest.mocked(getLocales).mockReturnValue(
    codes.map((languageCode) => ({ languageCode })) as unknown as ReturnType<typeof getLocales>,
  );
}

beforeEach(() => {
  jest.mocked(getLanguage).mockResolvedValue(null);
  deviceLocales('zh');
});

test('Chinese devices start in Chinese and interpolate counts', async () => {
  await initI18nLanguage();
  expect(i18n.language).toBe('zh');
  expect(i18n.t('login.continueButton')).toBe('继续');
  expect(i18n.t('relativeTime.minutesAgo', { count: 2 })).toBe('2 分钟前');
});

test('picks the first supported language in the device preference order', async () => {
  deviceLocales('de', 'nl', 'en');
  await initI18nLanguage();
  expect(i18n.language).toBe('nl');
});

test('persisted selection takes precedence over device language', async () => {
  jest.mocked(getLanguage).mockResolvedValue('nl');
  await initI18nLanguage();
  expect(i18n.language).toBe('nl');
});

test('unsupported saved and device languages fall back to English', async () => {
  jest.mocked(getLanguage).mockResolvedValue('invalid');
  deviceLocales('de');
  await initI18nLanguage();
  expect(i18n.language).toBe('en');
});
