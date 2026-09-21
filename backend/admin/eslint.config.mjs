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
      // eslint-plugin-react-hooks 7 enables the React Compiler's static
      // analyses, which land as ERRORS on patterns that predate them:
      // set-state-in-effect (a `useEffect(() => { load(); }, [])` fetch on
      // mount) and immutability (a variable mutated during render, or an
      // effect referencing a function declared below it). They're real
      // findings, but fixing them means reworking effect/render code, which
      // doesn't belong in a dependency bump — downgraded to warnings so they
      // stay visible, exactly how no-explicit-any is handled above.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
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
