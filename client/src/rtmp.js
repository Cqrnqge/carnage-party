import { useApp } from './store';

/**
 * Клиент RTMP-мультистрима. Сам поток захватывается MediaRecorder и уходит
 * чанками в главный процесс Electron, где ffmpeg перекодирует его и раздаёт
 * на несколько RTMP-площадок одновременно.
 */

export const RTMP_PLATFORMS = [
  {
    id: 'twitch',
    label: 'Twitch',
    hint: 'Ключ из панели Twitch → Настройки → Трансляция',
    server: 'rtmp://live.twitch.tv/app',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    hint: 'Ключ из YouTube Studio → Трансляция',
    server: 'rtmp://a.rtmp.youtube.com/live2',
  },
  {
    id: 'vk',
    label: 'VK Live',
    hint: 'Ключ из VK Видео → Прямые трансляции',
    server: 'rtmp://vk.com/live',
  },
  {
    id: 'custom',
    label: 'Свой RTMP',
    hint: 'Полный адрес вместе с ключом, например rtmp://host/app/key',
    server: '',
  },
];

export function defaultRtmpTargets() {
  return RTMP_PLATFORMS.map((platform) => ({
    id: platform.id,
    platform: platform.id,
    label: platform.label,
    server: platform.server,
    key: '',
    enabled: false,
  }));
}

function mergeTargets(stored) {
  const list = Array.isArray(stored) ? stored : [];
  return defaultRtmpTargets().map((base) => {
    const saved = list.find((item) => item?.platform === base.platform);
    if (!saved) return base;
    return {
      ...base,
      server: saved.server || base.server,
      key: saved.key || '',
      enabled: Boolean(saved.enabled),
    };
  });
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
  ];
  return candidates.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  }) || '';
}

class RtmpManager {
  constructor() {
    this.recorder = null;
    this.stream = null;
    this.targets = defaultRtmpTargets();
    this.secure = false;
    this.status = { phase: 'idle', destinations: [], error: '', log: [] };
    this.listeners = new Set();
    this.statusBound = false;
    this.saving = false;
  }

  get supported() {
    return typeof window !== 'undefined' && Boolean(window.desktop?.rtmp?.start);
  }

  get active() {
    return Boolean(this.recorder) || ['starting', 'live'].includes(this.status.phase);
  }

  snapshot() {
    return {
      supported: this.supported,
      targets: this.targets,
      secure: this.secure,
      status: this.status,
      active: this.active,
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    this.bindStatus();
    return () => this.listeners.delete(listener);
  }

  notify() {
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch {}
    }
  }

  bindStatus() {
    if (this.statusBound || !this.supported) return;
    this.statusBound = true;
    window.desktop.rtmp.onStatus((payload = {}) => {
      this.status = {
        phase: payload.phase || 'idle',
        destinations: Array.isArray(payload.destinations) ? payload.destinations : [],
        error: payload.error || '',
        log: Array.isArray(payload.log) ? payload.log : [],
        startedAt: payload.startedAt || null,
      };
      if (this.status.phase === 'error' && this.status.error) {
        useApp.getState().toast(`Мультистрим: ${this.status.error.split('\n')[0]}`, 'error');
      }
      this.notify();
    });
  }

  async load() {
    if (!this.supported) return this.snapshot();
    this.bindStatus();
    try {
      const data = await window.desktop.rtmp.getTargets();
      this.targets = mergeTargets(data?.targets);
      this.secure = Boolean(data?.secure);
    } catch {}
    try {
      const status = await window.desktop.rtmp.status();
      if (status?.phase) {
        this.status = {
          phase: status.phase,
          destinations: Array.isArray(status.destinations) ? status.destinations : [],
          error: status.error || '',
          log: Array.isArray(status.log) ? status.log : [],
          startedAt: status.startedAt || null,
        };
      }
    } catch {}
    this.notify();
    return this.snapshot();
  }

  setTargets(targets) {
    this.targets = mergeTargets(targets);
    this.notify();
  }

  async saveTargets(targets = this.targets) {
    this.targets = mergeTargets(targets);
    if (!this.supported || this.saving) return;
    this.saving = true;
    try {
      await window.desktop.rtmp.saveTargets(this.targets);
    } catch {}
    this.saving = false;
  }

  async start(stream, targets = this.targets) {
    if (!this.supported) {
      throw new Error('Мультистрим доступен только в приложении Carnage Party для Windows');
    }
    if (!stream?.getVideoTracks?.().length) {
      throw new Error('Нет видеопотока для мультистрима');
    }
    const allTargets = mergeTargets(targets);
    const list = allTargets.filter(
      (item) =>
        item.enabled &&
        item.server.trim() &&
        (item.platform === 'custom' || item.key.trim())
    );
    if (!list.length) return null;

    await this.stop({ silent: true });
    this.bindStatus();
    // Сохраняем все площадки, включая выключенные, чтобы не потерять их ключи.
    await this.saveTargets(allTargets);

    const response = await window.desktop.rtmp.start({
      destinations: list,
      quality: { videoKbps: 3500 },
    });
    if (!response?.ok) {
      throw new Error(response?.error || 'Не удалось запустить ffmpeg');
    }

    const mimeType = pickMimeType();
    const options = {
      videoBitsPerSecond: 4_500_000,
      audioBitsPerSecond: 128_000,
    };
    if (mimeType) options.mimeType = mimeType;
    let recorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch (err) {
      await window.desktop.rtmp.stop();
      throw new Error(err?.message || 'MediaRecorder не поддерживает запись потока');
    }

    recorder.ondataavailable = async (event) => {
      if (!event.data || !event.data.size) return;
      try {
        const buffer = await event.data.arrayBuffer();
        window.desktop.rtmp.chunk(buffer);
      } catch {}
    };
    recorder.onerror = (event) => {
      const message = event?.error?.message || 'Ошибка записи RTMP-потока';
      this.status = { ...this.status, phase: 'error', error: message };
      useApp.getState().toast(`Мультистрим: ${message}`, 'error');
      this.notify();
    };
    recorder.onstop = () => {
      if (this.recorder === recorder) this.recorder = null;
      this.notify();
    };

    try {
      recorder.start(1000);
    } catch (err) {
      await window.desktop.rtmp.stop();
      throw new Error(err?.message || 'Не удалось запустить запись RTMP');
    }
    this.recorder = recorder;
    this.stream = stream;
    this.notify();
    return list.map((item) => ({ platform: item.platform, label: item.label }));
  }

  async stop({ silent = false } = {}) {
    const recorder = this.recorder;
    this.recorder = null;
    this.stream = null;
    if (recorder) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        recorder.onstop = finish;
        try {
          if (recorder.state !== 'inactive') recorder.stop();
          else finish();
        } catch {
          finish();
        }
        setTimeout(finish, 1200);
      });
    }
    if (this.supported) {
      try {
        await window.desktop.rtmp.stop();
      } catch {}
    }
    if (!silent) this.notify();
  }
}

export const rtmpManager = new RtmpManager();
