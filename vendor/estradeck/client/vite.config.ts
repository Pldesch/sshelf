import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: '/estradeck/',
  plugins: [react()],
  resolve: {
    alias: {
      '@studio/shared': path.resolve(here, '../shared/src/types.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/estradeck/api': {
        target: 'http://127.0.0.1:5174',
        rewrite: (path) => path.replace(/^\/estradeck/, ''),
      },
      '/estradeck/decks': {
        target: 'http://127.0.0.1:5174',
        rewrite: (path) => path.replace(/^\/estradeck/, ''),
      },
      '/estradeck/themes': {
        target: 'http://127.0.0.1:5174',
        rewrite: (path) => path.replace(/^\/estradeck/, ''),
      },
      '/estradeck/ws': {
        target: 'ws://127.0.0.1:5174',
        ws: true,
        rewrite: (path) => path.replace(/^\/estradeck/, ''),
      },
    },
  },
});
