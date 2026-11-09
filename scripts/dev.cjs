'use strict';

// UTF-8 для русских логов в Windows-консоли.
if (process.platform === 'win32' && process.stdout.isTTY) {
  try {
    require('child_process').execFileSync('chcp.com', ['65001'], { stdio: 'ignore', windowsHide: true });
  } catch {}
}

const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const clientDir = path.join(root, 'client');
const electronPath = require('electron');
const { startServer } = require('../server/app.cjs');

function waitForPort(port, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const attempt = () => {
      const socket = net.connect({ port, host: '127.0.0.1' }, () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error(`Vite не запустился на порту ${port}`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

(async () => {
  let server = null;
  let vite = null;
  let electron = null;
  let shuttingDown = false;

  const shutdown = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      if (electron && !electron.killed) {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(electron.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          electron.kill('SIGTERM');
        }
      }
      if (vite && !vite.killed) {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(vite.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          vite.kill('SIGTERM');
        }
      }
      if (server) await server.close();
    } catch {}
    setTimeout(() => process.exit(code), 300);
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  try {
    server = await startServer({
      dataDir: path.join(root, 'data-dev'),
      port: 3001,
      host: '127.0.0.1',
      serveClient: true,
    });

    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    vite = spawn(npm, ['run', 'dev'], {
      cwd: clientDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env },
    });
    vite.on('close', (code) => {
      console.log('[dev] Vite завершился с кодом', code);
      shutdown(code || 0);
    });

    await waitForPort(5173);
    console.log('[dev] Vite готов, запускаю Electron…');

    electron = spawn(electronPath, ['.'], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: 'http://localhost:5173',
        CARNAGE_EXTERNAL_SERVER: '1',
        CARNAGE_PORT: '3001',
      },
    });

    electron.on('close', (code) => {
      console.log('[dev] Electron закрыт');
      shutdown(code || 0);
    });
  } catch (err) {
    console.error('[dev] Ошибка:', err);
    shutdown(1);
  }
})();
