import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3100';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  build: { outDir: resolve(__dirname, 'dist'), emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/auth': apiTarget,
    },
  },
});
