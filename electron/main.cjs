'use strict';

const { app, BrowserWindow, session, shell, ipcMain, desktopCapturer, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { setupPtt } = require('./ptt.cjs');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const externalServer = process.env.CARNAGE_EXTERNAL_SERVER === '1';
const basePort = Number(process.env.CARNAGE_PORT || 32456);
const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
const DEFAULT_SERVER_FALLBACK = 'http://188.234.161.207:3001';

function normalizeServerUrl(value) {
  let url = String(value || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}

// Быстрая проверка: сервер отвечает? Нужна, чтобы при недоступном
// адресе не ждать таймаут Chromium, а сразу показать страницу настройки.
async function isServerReachable(url, timeoutMs = 4500) {
  if (!url) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${url.replace(/\/+$/, '')}/api/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    return Boolean(response);
  } catch {
    return false;
  }
}

// Адрес сервера, зашитый в portable-сборку. Генерируется
// scripts/write-default-server.cjs по физическому IP без VPN.
function readBundledServer() {
  try {
    return normalizeServerUrl(fs.readFileSync(path.join(__dirname, 'default-server.txt'), 'utf8'));
  } catch {
    return DEFAULT_SERVER_FALLBACK;
  }
}

function serverConfigPath() {
  return path.join(app.getPath('userData'), 'server-config.json');
}

function readServerConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(serverConfigPath(), 'utf8'));
    if (parsed?.mode === 'local') return { mode: 'local' };
    if (parsed?.mode === 'remote' && parsed.url) {
      return { mode: 'remote', url: normalizeServerUrl(parsed.url) };
    }
  } catch {}
  return null;
}

function writeServerConfig(config) {
  try {
    const file = serverConfigPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

// Старый способ: server.txt рядом с exe. Оставлен только как ручной
// override при запуске из исходников. Portable его игнорирует, чтобы
// старый файл с VPN-IP не перекрывал адрес из настроек.
function readServerFile() {
  const candidates = [
    path.join(__dirname, '..', 'server.txt'),
    path.join(path.dirname(process.execPath), 'server.txt'),
  ];
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    candidates.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'server.txt'));
  }
  for (const file of candidates) {
    try {
      const value = fs.readFileSync(file, 'utf8').trim();
      if (value) return value;
    } catch {}
  }
  return '';
}

const serverArg = process.argv.find((arg) => arg.startsWith('--server='));
const explicitServer = normalizeServerUrl(
  process.env.CARNAGE_SERVER_URL || (serverArg ? serverArg.slice('--server='.length) : '')
);
const bundledServer = readBundledServer();
const savedServerConfig = readServerConfig();

// Приоритет: параметр запуска → настройки в приложении → адрес по умолчанию
// (только portable) → server.txt для запуска из исходников → локальный сервер.
let remoteServerUrl = explicitServer;
if (!remoteServerUrl && savedServerConfig) {
  if (savedServerConfig.mode === 'remote') remoteServerUrl = savedServerConfig.url;
} else if (!remoteServerUrl && !savedServerConfig) {
  if (isPortable && bundledServer) remoteServerUrl = bundledServer;
  else if (!isPortable) remoteServerUrl = normalizeServerUrl(readServerFile());
}

// Chromium не даёт камеру/микрофон/экран на http://LAN-IP.
// Добавляем все известные адреса заранее, чтобы переключение
// на сервер по умолчанию работало без перезапуска.
try {
  const origins = new Set();
  for (const candidate of [remoteServerUrl, bundledServer, savedServerConfig?.url]) {
    if (!candidate) continue;
    const origin = new URL(candidate).origin;
    if (origin.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      origins.add(origin);
    }
  }
  if (origins.size) {
    app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', [...origins].join(','));
  }
} catch {}

let mainWindow = null;
let serverHandle = null;
let quitting = false;
// Источник экрана, выбранный пользователем в окне выбора монитора.
let pendingScreenSourceId = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.setAppUserModelId('ru.carnageparty.messenger');

  async function ensureServer(force = false) {
    if (!force && (externalServer || remoteServerUrl)) return;
    if (serverHandle) return;
    const dataDir = path.join(app.getPath('userData'), 'data');
    let lastError = null;
    for (let port = basePort; port < basePort + 8; port++) {
      try {
        serverHandle = await require('../server/app.cjs').startServer({
          dataDir,
          port,
          host: '127.0.0.1',
          serveClient: true,
        });
        return;
      } catch (err) {
        lastError = err;
        if (err.code !== 'EADDRINUSE') throw err;
      }
    }
    throw lastError || new Error('Не удалось запустить локальный сервер');
  }

  async function createWindow() {
    await ensureServer();

    const target = isDev
      ? process.env.VITE_DEV_SERVER_URL
      : remoteServerUrl || serverHandle?.url || `http://127.0.0.1:${basePort}`;

    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1000,
      minHeight: 640,
      show: false,
      title: 'Carnage Party',
      backgroundColor: '#1e1f22',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        backgroundThrottling: false,
      },
    });

    mainWindow.once('ready-to-show', () => mainWindow.show());

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
      const current = mainWindow.webContents.getURL();
      if (url === current) return;
      // Разрешаем только навигацию внутри приложения или внешнего сервера.
      const allowedBase = remoteServerUrl || serverHandle?.url || 'http://localhost:5173';
      if (url.startsWith(allowedBase)) return;
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    });

    // Если внешний сервер недоступен, показываем локальную страницу,
    // где можно ввести новый адрес или запустить локальный сервер.
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isDev || !isMainFrame || errorCode === -3) return;
      if (!validatedURL || validatedURL.startsWith('file://')) return;
      mainWindow
        .loadFile(path.join(__dirname, 'offline.html'), {
          query: { url: validatedURL, error: errorDescription || String(errorCode) },
        })
        .catch(() => {});
    });

    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
        mainWindow.webContents.toggleDevTools();
      }
    });

    // Проверяем внешний сервер заранее: при выключенном хосте или
    // недоступном IP не ждём таймаут Chromium, а сразу показываем
    // локальную страницу с настройкой адреса.
    if (!isDev && remoteServerUrl && !(await isServerReachable(remoteServerUrl))) {
      await mainWindow.loadFile(path.join(__dirname, 'offline.html'), {
        query: { url: remoteServerUrl, error: 'Сервер не отвечает' },
      });
    } else {
      await mainWindow.loadURL(target);
    }

    if (!isDev && !serverHandle) {
      // На случай запуска с внешним сервером в production-режиме.
      console.warn('[electron] Внешний сервер не запущен внутри приложения.');
    }
  }

  app.whenReady().then(async () => {
    const allowedPermissions = new Set([
      'media',
      'mediaKeySystem',
      'audioCapture',
      'videoCapture',
      'display-capture',
      'notifications',
      'clipboard-read',
      'clipboard-sanitized-write',
      'fullscreen',
    ]);

    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(allowedPermissions.has(permission));
    });

    session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowedPermissions.has(permission));

    setupPtt({ app, ipcMain, getWindow: () => mainWindow });

    ipcMain.handle('carnage:screen-sources', async () => {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 480, height: 270 },
        fetchWindowIcons: false,
      });
      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        displayId: source.display_id || '',
        thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
      }));
    });

    ipcMain.handle('carnage:screen-select', (_event, sourceId) => {
      pendingScreenSourceId = typeof sourceId === 'string' ? sourceId : null;
      return true;
    });

    try {
      session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
        try {
          const sources = await desktopCapturer.getSources({ types: ['screen'] });
          const selected = pendingScreenSourceId;
          pendingScreenSourceId = null;
          const source =
            sources.find((s) => s.id === selected) ||
            sources.find((s) => String(s.id).startsWith('screen:')) ||
            sources[0];
          if (source) {
            console.log('[electron] Демонстрация экрана:', source.name);
            callback({ video: source });
          } else {
            callback({});
          }
        } catch (err) {
          console.warn('[electron] Не удалось получить источник экрана:', err.message);
          callback({});
        }
      });
    } catch (err) {
      console.warn('[electron] Демонстрация экрана недоступна:', err.message);
    }

    ipcMain.handle('carnage:open-external', (_e, url) => {
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url);
      return null;
    });

    ipcMain.handle('carnage:notify', (_e, payload = {}) => {
      try {
        const title = String(payload.title || 'Carnage Party').slice(0, 120);
        const body = String(payload.body || '').slice(0, 500);
        if (Notification.isSupported()) {
          const notification = new Notification({ title, body });
          notification.on('click', () => {
            if (!mainWindow) return;
            mainWindow.show();
            mainWindow.focus();
          });
          notification.show();
        }
        if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
        return true;
      } catch {
        return false;
      }
    });

    ipcMain.handle('carnage:version', () => app.getVersion());
    ipcMain.handle('carnage:data-path', () => path.join(app.getPath('userData'), 'data'));

    ipcMain.handle('carnage:server-config', () => ({
      mode: remoteServerUrl ? 'remote' : 'local',
      current: remoteServerUrl || serverHandle?.url || `http://127.0.0.1:${basePort}`,
      defaultUrl: bundledServer,
      portable: isPortable,
      canSwitch: !isDev && !externalServer,
    }));

    ipcMain.handle('carnage:set-server', async (_event, payload = {}) => {
      if (isDev || externalServer) {
        return { ok: false, error: 'В режиме разработки адрес сервера задаётся при запуске.' };
      }
      const mode = payload?.mode === 'local' ? 'local' : 'remote';
      if (mode === 'local') {
        writeServerConfig({ mode: 'local' });
        remoteServerUrl = '';
        try {
          await ensureServer(true);
          if (!serverHandle) throw new Error('Не удалось запустить локальный сервер');
          await mainWindow?.loadURL(serverHandle.url);
          return { ok: true, mode: 'local', url: serverHandle.url, restarted: false };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }

      const url = normalizeServerUrl(payload?.url);
      if (!url) return { ok: false, error: 'Укажите адрес сервера' };
      try {
        const parsed = new URL(url);
        if (!/^https?:$/.test(parsed.protocol)) throw new Error();
      } catch {
        return { ok: false, error: 'Адрес должен начинаться с http:// или https://' };
      }

      if (!(await isServerReachable(url))) {
        return {
          ok: false,
          error: `Сервер ${url} не отвечает. Проверьте адрес, запущен ли сервер и открыт ли порт.`,
        };
      }

      writeServerConfig({ mode: 'remote', url });
      const origin = new URL(url).origin;
      const insecureSwitch = app.commandLine.getSwitchValue('unsafely-treat-insecure-origin-as-secure');
      const allowed =
        origin.startsWith('https://') ||
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
        insecureSwitch
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .includes(origin);

      if (allowed) {
        remoteServerUrl = url;
        try {
          await mainWindow?.loadURL(url);
          return { ok: true, mode: 'remote', url, restarted: false };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }

      // Новый http-адрес: Chromium разрешит камеру/микрофон только после
      // перезапуска с этим origin в списке безопасных.
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 800);
      return { ok: true, mode: 'remote', url, restarted: true };
    });

    ipcMain.handle('carnage:retry-server', async () => {
      try {
        if (remoteServerUrl) {
          if (!(await isServerReachable(remoteServerUrl))) {
            return { ok: false, error: `Сервер ${remoteServerUrl} не отвечает.` };
          }
          await mainWindow?.loadURL(remoteServerUrl);
        } else {
          await ensureServer();
          if (!serverHandle) throw new Error('Локальный сервер не запущен');
          await mainWindow?.loadURL(serverHandle.url);
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });

    ipcMain.handle('carnage:focus', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    app.on('browser-window-focus', () => {
      if (mainWindow) mainWindow.flashFrame(false);
    });

    await createWindow();

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow();
    });
  }).catch((err) => {
    console.error('[electron] Ошибка запуска:', err);
    const { dialog } = require('electron');
    dialog.showErrorBox(
      'Carnage Party не удалось запустить',
      String(err?.message || err) +
        '\n\nЕсли клиент ещё не собран, выполните:\n  npm run build:client\nзатем снова: npm start'
    );
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (quitting || !serverHandle) return;
    event.preventDefault();
    quitting = true;
    serverHandle
      .close()
      .catch(() => {})
      .finally(() => app.quit());
  });
}
