const path = require('path');

// @famlin/api-client is installed via `file:../packages/api-client`, which
// npm links as a symlink — Jest resolves symlinks to their real path before
// matching transformIgnorePatterns, so the compiled dist/ output (real path:
// packages/api-client/dist, no "node_modules" segment) isn't covered by
// jest-expo's default patterns and gets run through Babel like source, which
// then fails looking for @babel/runtime helpers. `<rootDir>/..` isn't
// path-normalized by Jest's substitution, so it never matches the already-
// normalized real path — resolve it ourselves instead.
const apiClientDist = path.resolve(__dirname, '../packages/api-client/dist');

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // This key isn't merged with the preset's, only overridden — so jest-expo's
  // own defaults are repeated here alongside our addition.
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation))',
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
    apiClientDist,
  ],
};
