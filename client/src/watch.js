import { io } from 'socket.io-client';
import { api, getServerBase, getToken } from './api';

function watchSocketUrl() {
  const base = getServerBase();
  return base ? `${base}/watch` : '/watch';
}

let youtubeApiPromise = null;

export function loadYouTubeApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Нет окна'));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        previous?.();
      } catch {}
      if (window.YT?.Player) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('Не удалось загрузить YouTube'));
    document.head.appendChild(script);
    setTimeout(() => {
      if (window.YT?.Player) resolve(window.YT);
    }, 12000);
  });
  return youtubeApiPromise;
}

export function watchTarget(state, offset = 0) {
  if (!state) return 0;
  const now = Date.now() + offset;
  const position = Number(state.position) || 0;
  if (!state.playing) return position;
  return position + Math.max(0, now - (Number(state.updatedAt) || now)) / 1000 * (Number(state.rate) || 1);
}

export function formatWatchTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

class WatchManager {
  constructor() {
    this.socket = null;
    this.roomId = null;
    this.room = null;
    this.state = null;
    this.participants = [];
    this.chat = [];
    this.queue = [];
    this.self = null;
    this.live = false;
    this.connected = false;
    this.ended = false;
    this.error = '';
    this.serverOffset = 0;
    this.listeners = new Set();
  }

  snapshot() {
    return {
      room: this.room,
      state: this.state,
      participants: this.participants,
      chat: this.chat,
      queue: this.queue,
      self: this.self,
      live: this.live,
      connected: this.connected,
      ended: this.ended,
      error: this.error,
      offset: this.serverOffset,
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
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

  async create({ channelId, title, source }) {
    const data = await api('/api/watch', {
      method: 'POST',
      body: { channelId, title, source },
    });
    return data.room;
  }

  join(roomId) {
    if (!roomId) return;
    if (this.socket && this.roomId === roomId) return;
    this.leave({ silent: true });
    this.roomId = roomId;
    this.ended = false;
    this.error = '';
    this.connected = false;
    const socket = io(watchSocketUrl(), {
      auth: { roomId, token: getToken() || '' },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.connected = true;
      this.error = '';
      this.notify();
    });
    socket.on('disconnect', () => {
      this.connected = false;
      this.notify();
    });
    socket.on('connect_error', () => {
      this.connected = false;
      this.error = 'Не удалось подключиться к комнате';
      this.notify();
    });
    socket.on('watch:state', (payload = {}) => {
      this.room = payload.room || null;
      this.state = payload.state || null;
      this.participants = payload.participants || [];
      this.chat = payload.chat || [];
      this.queue = payload.queue || [];
      this.self = payload.self || null;
      this.live = Boolean(this.room?.live);
      if (Number.isFinite(Number(payload.serverNow))) {
        this.serverOffset = Number(payload.serverNow) - Date.now();
      }
      this.notify();
    });
    socket.on('watch:sync', (payload = {}) => {
      if (payload.state) this.state = payload.state;
      if (Number.isFinite(Number(payload.serverNow))) {
        this.serverOffset = Number(payload.serverNow) - Date.now();
      }
      this.notify();
    });
    socket.on('watch:source', (payload = {}) => {
      if (payload.room) this.room = payload.room;
      else if (payload.source && this.room) this.room = { ...this.room, source: payload.source };
      if (payload.state) this.state = payload.state;
      if (Number.isFinite(Number(payload.serverNow))) {
        this.serverOffset = Number(payload.serverNow) - Date.now();
      }
      this.notify();
    });
    socket.on('watch:participants', (payload = {}) => {
      this.participants = payload.participants || [];
      if (payload.live !== undefined) this.live = Boolean(payload.live);
      this.notify();
    });
    socket.on('watch:chat', (message) => {
      if (!message?.id || this.chat.some((item) => item.id === message.id)) return;
      this.chat = [...this.chat, message].slice(-200);
      this.notify();
    });
    socket.on('watch:ended', () => {
      this.ended = true;
      this.live = false;
      this.notify();
    });
    socket.on('watch:error', ({ error } = {}) => {
      this.error = error || 'Ошибка комнаты';
      this.notify();
    });
  }

  command(action, payload = {}) {
    this.socket?.emit('watch:command', { action, ...payload });
  }

  changeSource(source) {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ ok: false, error: 'Нет соединения с комнатой' });
        return;
      }
      try {
        this.socket.emit('watch:source', { source }, (result) => resolve(result || { ok: true }));
      } catch {
        resolve({ ok: false, error: 'Не удалось отправить ссылку' });
      }
    });
  }

  tick(position) {
    this.socket?.emit('watch:tick', { position });
  }

  requestSync() {
    this.socket?.emit('watch:sync-request');
  }

  sendChat(text) {
    const value = String(text || '').trim();
    if (value) this.socket?.emit('watch:chat', { text: value });
  }

  setBuffering(buffering) {
    this.socket?.emit('watch:buffer', { buffering: Boolean(buffering) });
  }

  end() {
    this.socket?.emit('watch:end');
  }

  leave({ silent = false } = {}) {
    if (this.socket) {
      try {
        this.socket.emit('watch:leave');
      } catch {}
      this.socket.removeAllListeners();
      this.socket.disconnect();
    }
    this.socket = null;
    this.roomId = null;
    this.room = null;
    this.state = null;
    this.participants = [];
    this.chat = [];
    this.queue = [];
    this.self = null;
    this.live = false;
    this.connected = false;
    this.ended = false;
    this.error = '';
    this.serverOffset = 0;
    if (!silent) this.notify();
  }
}

export const watchManager = new WatchManager();
