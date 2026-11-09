import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const clientDir = path.dirname(fileURLToPath(import.meta.url));
let version = '1.1.6';
try {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(clientDir, '..', 'package.json'), 'utf8'));
  if (pkg.version) version = pkg.version;
} catch {}

export default defineConfig({
  plugins: [react()],
  base: '/',
  define: {
    __CARNAGE_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
      },
      '/uploads': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
      },
      '/updates': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3001',
        ws: true,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'chrome120',
  },
});
