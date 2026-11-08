import { serverUrl } from './api';
import { appVersion } from './version';

const FORCE_KEY = 'carnage_update_platform';

export function parseVersion(value) {
  const match = String(value || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return '';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
  return `${(value / (1024 * 1024)).toFixed(1).replace('.', ',')} МБ`;
}

export function platformLabel(platform) {
  if (platform === 'android') return 'Android';
  if (platform === 'portable') return 'Portable · Windows';
  if (platform === 'windows') return 'Windows';
  return '';
}

// Определяет, какое обновление предлагать: APK для Android, ZIP для
// портативной сборки, установщик для обычной версии.
export async function clientPlatform() {
  if (typeof window === 'undefined') return '';
  // В dev-режиме платформу можно подменить для проверки окна обновления,
  // не собирая APK: localStorage.carnage_update_platform = 'android'.
  if (import.meta.env.DEV) {
    try {
      const forced = localStorage.getItem(FORCE_KEY);
      if (forced) return forced;
    } catch {}
  }
  if (window.CarnageAndroid) return 'android';
  if (window.desktop?.isElectron) {
    if (typeof window.desktop.portable === 'boolean') {
      return window.desktop.portable ? 'portable' : 'windows';
    }
    try {
      const info = await window.desktop.getBuildInfo?.();
      if (info) return info.portable ? 'portable' : 'windows';
    } catch {}
    return 'windows';
  }
  return '';
}

function buildUpdate(platform, release, data, current) {
  return {
    platform,
    current,
    version: release.version,
    url: serverUrl(release.url),
    fileName: String(release.file || ''),
    size: Number(release.size) || 0,
    notes: Array.isArray(release.notes)
      ? release.notes.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20)
      : [],
    notesText: String(data.notes || '').slice(0, 4000),
  };
}

// Подробная проверка обновлений для раздела настроек: отличает
// «обновлений нет» от «сервер недоступен» и возвращает changelog.
export async function fetchUpdateInfo({ timeout = 8000 } = {}) {
  const platform = await clientPlatform();
  const current = appVersion();
  if (!platform) {
    return {
      ok: false,
      platform: '',
      current,
      error: 'Обновления доступны в приложении Carnage Party для Windows, portable и Android.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(serverUrl('/api/version'), {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Сервер вернул ${response.status}`);
    const data = await response.json();
    const release = data?.releases?.[platform];
    const changelog =
      data?.changelog && typeof data.changelog === 'object' ? data.changelog : {};
    const update =
      release?.version &&
      release?.url &&
      compareVersions(release.version, current) > 0
        ? buildUpdate(platform, release, data, current)
        : null;
    return {
      ok: true,
      platform,
      current,
      latest: String(release?.version || data?.latest || current),
      update,
      changelog,
      notesText: String(data?.notes || '').slice(0, 4000),
    };
  } catch (err) {
    return {
      ok: false,
      platform,
      current,
      error:
        err?.name === 'AbortError'
          ? 'Сервер не ответил. Попробуйте проверить обновления ещё раз.'
          : 'Не удалось проверить обновления. Проверьте соединение с сервером.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkForUpdate({ timeout = 6000 } = {}) {
  const info = await fetchUpdateInfo({ timeout });
  return info.ok ? info.update : null;
}
