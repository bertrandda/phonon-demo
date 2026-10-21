import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const api = `http://127.0.0.1:${process.env.PORT ?? 3000}`;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/tts': { target: api, ws: true },
      '/api': api,
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
