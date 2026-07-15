// ESLint flat config for the backend (Fastify + TS, ESM/NodeNext).
//
// backend/ installs independently (see repo root CLAUDE.md), so it carries
// its own eslint + typescript-eslint devDependencies rather than relying on
// the root workspace's hoisted node_modules.
//
// NOTE: backend/src is under active concurrent development elsewhere, so
// this config is deliberately conservative — typescript-eslint's
// non-type-checked "recommended" rules only, and anything that doesn't
// cleanly pass against the current codebase is downgraded to "warn" rather
// than fixed by editing source here. See the per-rule comments below.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      // Own subpackage with its own config/install — see backend/admin/eslint.config.mjs.
      'admin/**',
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'media-cache/**',
      'uploads/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` is used broadly (route bodies, cast-heavy Prisma/test helpers)
      // across the current codebase — downgraded rather than mass-editing
      // routes/services here while backend/src is under concurrent work.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
