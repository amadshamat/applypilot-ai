import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const outDir = process.env.APPLYPILOT_E2E === '1' ? 'dist-e2e' : 'dist';

/** The content script, bundled into one self-contained IIFE: content.js. */
export default defineConfig({
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: false,
    target: 'chrome116',
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'ApplyPilotContent',
      fileName: () => 'content.js',
    },
  },
});
