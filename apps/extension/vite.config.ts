import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { createManifest } from './src/manifest.ts';

const e2e = process.env.APPLYPILOT_E2E === '1';
const outDir = e2e ? 'dist-e2e' : 'dist';

/** Emits manifest.json from the typed definition in src/manifest.ts. */
function manifestPlugin(): Plugin {
  return {
    name: 'applypilot-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(createManifest({ e2e }), null, 2)}\n`,
      });
    },
  };
}

/**
 * Extension pages (side panel, options) and the module service worker.
 * The content script is built separately as a single classic script
 * (see vite.content.config.ts) because injected scripts cannot import chunks.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), manifestPlugin()],
  base: '',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'chrome116',
    sourcemap: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
        options: resolve(import.meta.dirname, 'options.html'),
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
