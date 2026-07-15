// ESLint flat config for the admin UI (React + Vite).
//
// backend/admin/ installs independently (see repo root CLAUDE.md), so it
// carries its own eslint + typescript-eslint + react-hooks devDependencies
// rather than relying on the root workspace's hoisted node_modules.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` shows up broadly in existing catch-block/error-handling code —
      // downgraded rather than mass-editing source to add real types.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
