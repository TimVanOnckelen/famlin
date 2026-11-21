import '@testing-library/jest-dom/vitest'
import i18n from '@/i18n'

// Deterministic language regardless of the jsdom navigator locale.
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

// jsdom never loads media metadata, so reading a video's length would hang;
// tests that care override this with vi.mocked(videoDuration).
vi.mock('@/utils/videoDuration', () => ({ videoDuration: vi.fn(async () => 0) }))
