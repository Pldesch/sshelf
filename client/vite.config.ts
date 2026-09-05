import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@studio/shared': path.resolve(here, '../shared/src/types.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5174',
      '/decks': 'http://localhost:5174',
      '/themes': 'http://localhost:5174',
      '/ws': { target: 'ws://localhost:5174', ws: true },
    },
  },
});
