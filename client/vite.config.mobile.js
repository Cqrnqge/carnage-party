import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const clientDir = path.dirname(fileURLToPath(import.meta.url));
let version = '1.1.7';
try {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(clientDir, '..', 'package.json'), 'utf8'));
  if (pkg.version) version = pkg.version;
} catch {}
let defaultServer = 'http://188.234.161.207:3001';
const envServer = String(process.env.CARNAGE_DEFAULT_SERVER || '').trim();
if (envServer) {
  defaultServer = envServer;
}
try {
  const file = path.resolve(clientDir, '..', 'electron', 'default-server.txt');
  if (fs.existsSync(file)) {
    const value = fs.readFileSync(file, 'utf8').trim();
    if (value) defaultServer = value;
  }
} catch {
  // Оставляем адрес по умолчанию.
}

// Сборка для APK: всё лежит в assets, поэтому пути относительные, а адрес
// сервера подставляется из electron/default-server.txt.
export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __CARNAGE_DEFAULT_SERVER__: JSON.stringify(defaultServer),
    __CARNAGE_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: '../mobile/www',
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome80',
    assetsDir: 'assets',
  },
});
