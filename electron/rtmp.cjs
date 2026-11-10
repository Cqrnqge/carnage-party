'use strict';

/**
 * RTMP-мультистрим: рендерер отдаёт WebM-чанки MediaRecorder, главный процесс
 * перекодирует их в H.264/AAC и раздаёт через ffmpeg tee на Twitch, YouTube,
 * VK Live и произвольные RTMP-серверы.
 *
 * Ключи потоков хранятся в userData и шифруются через Electron safeStorage.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PLATFORM_SERVERS = {
  twitch: 'rtmp://live.twitch.tv/app',
  youtube: 'rtmp://a.rtmp.youtube.com/live2',
  vk: 'rtmp://vk.com/live',
  custom: '',
};

const PLATFORM_LABELS = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  vk: 'VK Live',
  custom: 'Свой RTMP',
};

// 720p30 — компромисс между качеством и нагрузкой на CPU при перекодировании
// сразу для нескольких площадок.
const VIDEO_KBPS = 3500;
const AUDIO_KBPS = 160;

// Каждая площадка получает собственный поток fifo: медленный или зависший
// приёмник больше не тормозит остальные и не превращает эфир в «петлю».
// Очередь ~8 секунд, дальше пакеты отбрасываются, чтобы не копить задержку.
const TEE_FIFO_OPTIONS = [
  'queue_size=600',
  'drop_pkts_on_overflow=1',
  'attempt_recovery=1',
  'recovery_wait_time=1',
  'max_recovery_attempts=0',
  'restart_with_keyframe=1',
].join(':');

function resolveFfmpegPath() {
  try {
    const bundled = require('ffmpeg-static');
    if (bundled) {
      // В собранном приложении бинарник лежит в app.asar.unpacked.
      return String(bundled).replace('app.asar', 'app.asar.unpacked');
    }
  } catch {}
  return 'ffmpeg';
}

function targetsFile(app) {
  return path.join(app.getPath('userData'), 'rtmp-targets.json');
}

function encryptValue(value, safeStorage) {
  if (!value) return '';
  try {
    if (safeStorage?.isEncryptionAvailable?.()) {
      return `enc:${safeStorage.encryptString(String(value)).toString('base64')}`;
    }
  } catch {}
  // safeStorage недоступен (например, Linux без keyring) — сохраняем хотя бы
  // не в открытом виде, но честно помечаем как небезопасное хранилище.
  return `b64:${Buffer.from(String(value), 'utf8').toString('base64')}`;
}

function decryptValue(value, safeStorage) {
  const raw = String(value || '');
  if (!raw) return '';
  try {
    if (raw.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'));
    }
    if (raw.startsWith('b64:')) {
      return Buffer.from(raw.slice(4), 'base64').toString('utf8');
    }
  } catch {}
  return raw;
}

function readTargets(app, safeStorage) {
  try {
    const raw = JSON.parse(fs.readFileSync(targetsFile(app), 'utf8'));
    const list = Array.isArray(raw?.targets) ? raw.targets : [];
    return list
      .filter((item) => item && PLATFORM_SERVERS[item.platform] !== undefined)
      .map((item) => ({
        id: String(item.id || item.platform),
        platform: item.platform,
        label: String(item.label || PLATFORM_LABELS[item.platform] || 'RTMP'),
        server: String(item.server || PLATFORM_SERVERS[item.platform] || ''),
        key: decryptValue(item.key, safeStorage),
        enabled: Boolean(item.enabled),
      }));
  } catch {
    return [];
  }
}

function writeTargets(app, safeStorage, targets) {
  const list = (Array.isArray(targets) ? targets : [])
    .filter((item) => item && PLATFORM_SERVERS[item.platform] !== undefined)
    .map((item) => ({
      id: String(item.id || item.platform),
      platform: item.platform,
      label: String(item.label || PLATFORM_LABELS[item.platform] || 'RTMP').slice(0, 60),
      server: String(item.server || PLATFORM_SERVERS[item.platform] || '').slice(0, 500),
      key: encryptValue(item.key, safeStorage),
      enabled: Boolean(item.enabled),
    }));
  const file = targetsFile(app);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, targets: list }, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return list.length;
}

function normalizeDestination(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const platform = PLATFORM_SERVERS[raw.platform] !== undefined ? raw.platform : 'custom';
  let server = String(raw.server || PLATFORM_SERVERS[platform] || '').trim();
  let key = String(raw.key || '').trim();
  if (!/^rtmps?:\/\//i.test(server)) return null;
  if (platform !== 'custom' && !key) return null;
  if (platform !== 'custom') {
    server = server.replace(/\/+$/, '');
    key = key.replace(/^\/+/, '');
  }
  const url = platform === 'custom' ? server : `${server}/${key}`;
  // Символы |, [, ] ломают синтаксис tee-муксера, переводы строк — аргументы.
  if (!url || /[|\r\n[\]]/.test(url)) return null;
  return {
    platform,
    label: PLATFORM_LABELS[platform],
    server,
    key,
    url,
  };
}

function registerRtmp({ ipcMain, app, safeStorage, broadcast }) {
  let proc = null;
  let stopping = false;
  let liveTimer = null;
  let logLines = [];
  let status = {
    phase: 'idle',
    destinations: [],
    error: '',
    warning: '',
    warningAt: 0,
    startedAt: null,
    log: [],
  };
  // Не спамим одинаковыми предупреждениями, если площадка «моргает».
  let lastWarningAt = 0;

  const ffmpegPath = resolveFfmpegPath();

  const emitStatus = (patch = {}) => {
    status = { ...status, ...patch };
    try {
      broadcast?.('carnage:rtmp-status', { ...status, ffmpeg: ffmpegPath });
    } catch {}
  };

  const pushLog = (line) => {
    const text = String(line || '').trim();
    if (!text) return;
    logLines.push(text);
    if (logLines.length > 60) logLines.splice(0, logLines.length - 60);
  };

  const killProcess = () => {
    if (!proc) return;
    try {
      proc.stdin?.end();
    } catch {}
    try {
      proc.kill('SIGTERM');
    } catch {}
    const child = proc;
    setTimeout(() => {
      if (proc === child) {
        try {
          child.kill('SIGKILL');
        } catch {}
      }
    }, 3000).unref?.();
  };

  const stop = () => {
    stopping = true;
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = null;
    const child = proc;
    proc = null;
    logLines = [];
    if (child) {
      try {
        child.stdin?.end();
      } catch {}
      try {
        child.kill('SIGTERM');
      } catch {}
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, 3000).unref?.();
    }
    emitStatus({
      phase: 'idle',
      destinations: [],
      error: '',
      warning: '',
      warningAt: 0,
      startedAt: null,
      log: [],
    });
    return true;
  };

  const start = ({ destinations, quality } = {}) => {
    if (!ffmpegPath) {
      emitStatus({ phase: 'error', error: 'ffmpeg не найден' });
      return { ok: false, error: 'ffmpeg не найден' };
    }
    if (proc) stop();

    const list = (Array.isArray(destinations) ? destinations : [])
      .map(normalizeDestination)
      .filter(Boolean);
    if (!list.length) {
      const error = 'Укажите хотя бы один RTMP-сервер и ключ потока';
      emitStatus({ phase: 'error', error });
      return { ok: false, error };
    }

    const videoKbps = Math.max(800, Math.min(8000, Number(quality?.videoKbps) || VIDEO_KBPS));
    const teeSpec = list
      .map((item) => `[f=flv:onfail=ignore]${item.url}`)
      .join('|');

    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-fflags', '+genpts',
      '-i', 'pipe:0',
      // Живой WebM приходит чанками — фиксируем CFR, чтобы FLV/RTMP
      // не получал рваные таймстампы на стыках чанков.
      '-fps_mode', 'cfr',
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-profile:v', 'main',
      '-pix_fmt', 'yuv420p',
      '-g', '60',
      '-keyint_min', '60',
      '-sc_threshold', '0',
      '-r', '30',
      '-b:v', `${videoKbps}k`,
      '-maxrate', `${videoKbps}k`,
      '-bufsize', `${videoKbps * 2}k`,
      '-vf', "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-c:a', 'aac',
      '-b:a', `${AUDIO_KBPS}k`,
      '-ar', '48000',
      '-ac', '2',
      // Отдельный поток и буфер на каждую площадку + авто-переподключение.
      '-use_fifo', '1',
      '-fifo_options', TEE_FIFO_OPTIONS,
      '-f', 'tee',
      teeSpec,
    ];

    stopping = false;
    logLines = [];
    try {
      proc = spawn(ffmpegPath, args, {
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'pipe'],
      });
    } catch (err) {
      proc = null;
      const error = err?.message || 'Не удалось запустить ffmpeg';
      emitStatus({ phase: 'error', error });
      return { ok: false, error };
    }

    const child = proc;
    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        pushLog(line);
        // Площадка отвалилась, но tee/fifo её переподключает. Сообщаем
        // пользователю, чтобы «тихий» обрыв не выглядел как зависший эфир.
        if (
          !stopping &&
          /(Slave muxer #\d+ failed|Error writing trailer|Connection (refused|reset)|Broken pipe|Operation timed out|Error opening output)/i.test(
            line
          )
        ) {
          const now = Date.now();
          if (now - lastWarningAt > 20000) {
            lastWarningAt = now;
            emitStatus({
              warning: 'Площадка отключилась — ffmpeg переподключается автоматически',
              warningAt: now,
            });
          }
        }
      }
    });
    child.stdin?.on('error', () => {});
    child.on('error', (err) => {
      if (proc !== child) return;
      emitStatus({ phase: 'error', error: err?.message || 'ffmpeg недоступен' });
    });
    child.on('exit', (code, signal) => {
      if (proc !== child) return;
      proc = null;
      if (liveTimer) clearTimeout(liveTimer);
      liveTimer = null;
      const wasStopping = stopping;
      stopping = false;
      if (wasStopping) {
        emitStatus({ phase: 'idle', destinations: [], error: '', startedAt: null, log: [] });
        return;
      }
      const tail = logLines.slice(-6).join('\n');
      const error =
        code === 0
          ? 'ffmpeg завершился'
          : `ffmpeg остановился (код ${code ?? signal ?? '?'})${tail ? `:\n${tail}` : ''}`;
      emitStatus({ phase: 'error', error, log: logLines.slice(-12) });
    });

    lastWarningAt = 0;
    emitStatus({
      phase: 'starting',
      destinations: list.map((item) => ({ platform: item.platform, label: item.label })),
      error: '',
      warning: '',
      warningAt: 0,
      startedAt: Date.now(),
      log: [],
    });

    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      if (proc === child) emitStatus({ phase: 'live' });
    }, 1500);
    liveTimer.unref?.();

    return {
      ok: true,
      destinations: list.map((item) => ({ platform: item.platform, label: item.label })),
    };
  };

  const writeChunk = (data) => {
    if (!proc || !proc.stdin || proc.stdin.destroyed) return;
    try {
      const buffer = Buffer.isBuffer(data)
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : ArrayBuffer.isView(data)
            ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
            : Buffer.from(data || '');
      if (!buffer.length) return;
      proc.stdin.write(buffer);
    } catch {}
  };

  ipcMain.handle('carnage:rtmp-targets', () => {
    const targets = readTargets(app, safeStorage);
    let secure = false;
    try {
      secure = Boolean(safeStorage?.isEncryptionAvailable?.());
    } catch {}
    return { targets, secure };
  });

  ipcMain.handle('carnage:rtmp-save-targets', (_event, targets = []) => {
    const count = writeTargets(app, safeStorage, targets);
    return { ok: true, count };
  });

  ipcMain.handle('carnage:rtmp-start', (_event, payload = {}) => start(payload));
  ipcMain.handle('carnage:rtmp-stop', () => ({ ok: stop() }));
  ipcMain.handle('carnage:rtmp-status', () => ({ ...status, ffmpeg: ffmpegPath }));
  ipcMain.on('carnage:rtmp-chunk', (_event, data) => writeChunk(data));

  app.on('before-quit', () => {
    stopping = true;
    killProcess();
  });

  return { stop };
}

module.exports = {
  PLATFORM_SERVERS,
  PLATFORM_LABELS,
  registerRtmp,
  resolveFfmpegPath,
};
