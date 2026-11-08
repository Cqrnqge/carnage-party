const TOKEN_KEY = 'carnage_token';
const SERVER_KEY = 'carnage_server_url';

function normalizeServer(value) {
  let url = String(value || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}

// В Android-приложении адрес приходит из нативного моста, в браузере и
// desktop-клиенте используется текущий origin. Это позволяет открывать
// один и тот же собранный клиент и с сервера, и из APK.
export function getServerBase() {
  try {
    if (window.CarnageAndroid?.getServerUrl) {
      const nativeUrl = normalizeServer(window.CarnageAndroid.getServerUrl());
      if (nativeUrl) return nativeUrl;
    }
  } catch {}
  try {
    const stored = normalizeServer(localStorage.getItem(SERVER_KEY));
    if (stored) return stored;
  } catch {}
  if (typeof __CARNAGE_DEFAULT_SERVER__ !== 'undefined') {
    return normalizeServer(__CARNAGE_DEFAULT_SERVER__);
  }
  return '';
}

export function setServerBase(value) {
  const normalized = normalizeServer(value);
  try {
    if (normalized) localStorage.setItem(SERVER_KEY, normalized);
    else localStorage.removeItem(SERVER_KEY);
  } catch {}
  return normalized;
}

export function serverUrl(path = '') {
  const value = String(path || '');
  if (!value) return getServerBase();
  if (/^(https?:|data:|blob:|file:|mailto:|tel:)/i.test(value)) return value;
  const base = getServerBase();
  if (!base) return value;
  return `${base}${value.startsWith('/') ? '' : '/'}${value}`;
}

export function assetUrl(path) {
  return serverUrl(path);
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function clearToken() {
  setToken(null);
}

export async function api(path, options = {}) {
  const { method = 'GET', body, signal, headers = {} } = options;
  const opts = { method, headers: { ...headers }, signal };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const token = getToken();
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(serverUrl(path), opts);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Нет соединения с сервером', 0, null);
  }
  let data = null;
  const contentType = response.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) data = await response.json();
    else data = await response.text();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = (data && typeof data === 'object' && data.error) || `Ошибка запроса (${response.status})`;
    if (response.status === 401) {
      try { window.dispatchEvent(new CustomEvent('carnage:unauthorized')); } catch {}
    }
    throw new ApiError(message, response.status, data);
  }
  return data;
}

export function apiPath(path) {
  return serverUrl(path);
}
