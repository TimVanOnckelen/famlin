import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import livereload from 'livereload';

const workspaceRoot = path.resolve(__dirname, '..');
const outDir = path.resolve(__dirname, '../backend/dist/web');

// Only for `npm run watch` (`vite build --watch`, see package.json), which
// rebuilds outDir on every source change but — unlike the real `vite`/`vite
// build` commands — has no dev server and no HMR client of its own, so a
// browser open on the backend's static-served copy (http://localhost:3000)
// never refreshes on its own. This starts a small livereload server that
// watches outDir and injects its client snippet into the built index.html,
// so that tab reloads itself after each rebuild. Gated behind an env var
// (never set by `npm run build`) so the real production bundle shipped in
// the Docker image never carries this dev-only script.
function watchLivereload(): Plugin | false {
  if (!process.env.LIVERELOAD) return false;
  const server = livereload.createServer({ exts: ['html', 'js', 'css'] });
  // `build.emptyOutDir` (below) deletes outDir on every rebuild before
  // rewriting it, and this chokidar watcher (from server.watch) is pointed
  // at that same directory — an unhandled 'error' event from that race (e.g.
  // ENOENT on a path that briefly doesn't exist) crashes the whole `vite
  // build --watch` process by default, since EventEmitter throws when an
  // 'error' has no listener. Swallow it instead: a missed reload signal is
  // harmless, an entire dead watch process is not.
  server.watch(outDir).on('error', () => {});
  return {
    name: 'watch-livereload',
    transformIndexHtml(html) {
      return `${html}<script src="http://localhost:35729/livereload.js?snipver=1"></script>`;
    },
  };
}

export default defineConfig({
  plugins: [react(), watchLivereload()],
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
    outDir,
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
