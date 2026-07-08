import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const workspaceRoot = path.resolve(__dirname, '..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirror tsconfig.json's "@/*" → "src/*" paths — Vite doesn't read
    // tsconfig path mappings itself.
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    // Built into the backend's dist so Fastify serves it at / from the same
    // container — the exact pattern backend/admin uses with ../dist/admin.
    outDir: path.resolve(__dirname, '../backend/dist/web'),
    emptyOutDir: true,
    commonjsOptions: {
      // @famlin/api-client resolves through a workspace symlink to a real
      // path under packages/api-client/dist — outside node_modules, so it
      // falls outside the default include pattern and Rollup's commonjs
      // plugin would otherwise skip its CJS→ESM named-export interop
      // entirely, breaking `import { x } from '@famlin/api-client'`.
      include: [/node_modules/, /packages\/api-client/],
    },
  },
  optimizeDeps: {
    // Same reasoning for the dev server's esbuild pre-bundling step, which
    // by default skips symlinked ("linked") packages.
    include: ['@famlin/api-client'],
  },
  server: {
    port: 5174,
    // @famlin/api-client is a sibling workspace package (packages/api-client) —
    // allow Vite's dev server to read outside web/ so its sourcemaps resolve.
    fs: {
      allow: [workspaceRoot],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Uploaded media is served from /uploads (outside /api) and
      // getUploadUrl() builds those URLs against this dev origin — without
      // this entry Vite would answer them itself with a 404.
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
