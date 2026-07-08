import '@testing-library/jest-dom/vitest';
import i18n from '@/i18n';

// Deterministic language regardless of the jsdom navigator locale.
beforeAll(async () => {
  await i18n.changeLanguage('en');
});
