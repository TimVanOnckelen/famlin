import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// admin installs independently (not an npm workspace member — see the root
// CLAUDE.md), so @famlin/api-client is a plain `file:../../packages/api-client`
// dependency instead. npm still links it as a symlink though, resolving to a
// real path two levels up under packages/api-client — same situation web/'s
// vite.config.ts documents for its own (workspace) symlink.
const repoRoot = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  build: {
    outDir: path.resolve(import.meta.dirname, '../dist/admin'),
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: an app-only release doesn't invalidate the
        // browser's cached React/i18n code.
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /node_modules\/(react|react-dom|scheduler)\// },
            { name: 'i18n-vendor', test: /node_modules\/(i18next|react-i18next)\// },
          ],
        },
      },
    },
    commonjsOptions: {
      // @famlin/api-client resolves through a symlink to a real path under
      // packages/api-client/dist — outside node_modules, so it falls outside
      // the default include pattern and Rollup's commonjs plugin would
      // otherwise skip its CJS→ESM named-export interop entirely, breaking
      // `import { x } from '@famlin/api-client'`.
      include: [/node_modules/, /packages\/api-client/],
    },
  },
  optimizeDeps: {
    // Same reasoning for the dev server's esbuild pre-bundling step, which
    // by default skips symlinked ("linked") packages.
    include: ['@famlin/api-client'],
  },
  server: {
    port: 5173,
    // @famlin/api-client lives outside backend/admin/ (under repo-root
    // packages/api-client) — allow Vite's dev server to read outside its
    // root so its sourcemaps resolve.
    fs: {
      allow: [repoRoot],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
