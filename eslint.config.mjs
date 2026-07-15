// Root ESLint flat config.
//
// Only covers the packages that are part of the root npm workspace
// (`web/` and `packages/api-client/`, see root package.json's
// `workspaces`) — they share these hoisted devDependencies. `backend/`,
// `backend/admin/`, and `mobile/` install independently (no access to
// this root node_modules) and each carry their own eslint.config.mjs +
// devDependencies instead. ESLint's flat config resolves upward through
// parent directories, so running `eslint .` from inside `web/` or
// `packages/api-client/` picks this file up automatically as long as
// those packages don't have a config file of their own.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      // Everything below has (or will have) its own config + install.
      'backend/**',
      'mobile/**',
      'docs/**',
      'website/**',
      'design/**',
      'graphify-out/**',
      'temp/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Keep the ruleset minimal and pragmatic for v1: typescript-eslint's
    // non-type-checked "recommended" set plus a relaxed unused-vars rule.
    // No type-aware ("recommended-type-checked") rules — too slow/noisy.
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` shows up broadly across existing api-client/web code
      // (mocked axios responses in tests, third-party payload shapes) —
      // downgraded rather than mass-editing source to add real types.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Plain CJS node script, not part of the TS build.
    files: ['packages/api-client/scripts/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // web/src/**: browser React app.
    files: ['web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
    },
  },
  {
    // packages/api-client: isomorphic lib (used by mobile + web + admin),
    // so allow both node and browser globals.
    files: ['packages/api-client/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
);
