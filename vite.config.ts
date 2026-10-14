import path from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The worker control panel. This repo is the standalone source; by default it
// builds into ./dist. Set OUT_DIR to build straight into the easyworker
// server's go:embed directory, e.g.:
//   OUT_DIR=../easyworker/internal/webui/dist npm run build
// The base is '/' and assets are emitted flat so the worker can serve them from
// its own root.
const outDir = process.env.OUT_DIR || 'dist'

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: { $lib: path.resolve('./src/lib') },
  },
  server: {
    host: '0.0.0.0',
    port: 18500,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
  },
})
