import { getServerBase } from './api';

// Резервный STUN-конфиг: используется, пока сервер не прислал свой.
const FALLBACK_ICE = [
  {
    urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
  },
];

const CACHE_KEY = 'carnage_ice_cache';
const MIN_LIFETIME = 5 * 60 * 1000;
const STATIC_LIFETIME = 60 * 60 * 1000;

let iceServers = FALLBACK_ICE;
let expiresAt = 0;
let pending = null;

function sanitize(servers) {
  if (!Array.isArray(servers)) return null;
  const result = [];
  for (const server of servers) {
    if (!server) continue;
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    const clean = urls.map((url) => String(url || '').trim()).filter(Boolean);
    if (!clean.length) continue;
    const entry = { urls: clean };
    if (server.username) entry.username = String(server.username);
    if (server.credential) entry.credential = String(server.credential);
    result.push(entry);
  }
  return result.length ? result : null;
}

function applyCache(entry) {
  const servers = sanitize(entry?.iceServers);
  if (!servers) return false;
  iceServers = servers;
  expiresAt = Number(entry?.expiresAt) || 0;
  return true;
}

function readStored() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.expiresAt > Date.now()) applyCache(parsed);
  } catch {}
}

function saveStored() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ iceServers, expiresAt }));
  } catch {}
}

readStored();

export function currentIceServers() {
  return iceServers;
}

export function iceConfig() {
  return { iceServers };
}

// Загружает ICE-конфиг с сервера. Повторные вызовы объединяются в один запрос.
export function refreshIceConfig(userId = '') {
  if (expiresAt > Date.now() + 30 * 1000) return Promise.resolve(iceServers);
  if (pending) return pending;
  pending = (async () => {
    try {
      const base = getServerBase();
      const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
      const response = await fetch(`${base}/api/ice${query}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`ICE ${response.status}`);
      const data = await response.json();
      const servers = sanitize(data.iceServers);
      if (!servers) throw new Error('Пустой ICE-конфиг');
      const ttl = Number(data.ttl) || 0;
      // Временные credentials обновляем заранее, статические кешируем на час.
      const lifetime = ttl > 0 ? Math.max(MIN_LIFETIME, ttl * 1000 - 60 * 1000) : STATIC_LIFETIME;
      iceServers = servers;
      expiresAt = Date.now() + lifetime;
      saveStored();
      return iceServers;
    } catch {
      // Сервер мог не ответить — работаем по STUN и пробуем позже.
      expiresAt = Date.now() + MIN_LIFETIME;
      return iceServers;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

// Прогревает конфиг заранее, чтобы к моменту звонка он уже был в памяти.
export function warmIceConfig(userId = '') {
  refreshIceConfig(userId).catch(() => {});
}
