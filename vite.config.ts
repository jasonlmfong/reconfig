/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Cytoscape alone is ~0.5 MB minified; the app is a single local-first bundle.
    chunkSizeWarningLimit: 900,
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    benchmark: {
      include: ['tests/**/*.bench.ts'],
    },
    environment: 'node',
    testTimeout: 120_000,
  },
});
