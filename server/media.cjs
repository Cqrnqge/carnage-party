'use strict';

const https = require('node:https');
const { Readable } = require('node:stream');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const YOUTUBE_TTL = 60 * 60 * 1000;
const RUTUBE_TTL = 10 * 60 * 1000;
// YouTube периодически меняет требования к клиентам. Пробуем несколько
// клиентов подряд: если один получает отказ или не отдаёт ссылку, следующий
// часто всё равно работает.
const YOUTUBE_CLIENTS = ['IOS', 'ANDROID', 'MWEB', 'WEB'];

let innertubePromise = null;
const youtubeCache = new Map();
const youtubePending = new Map();
const rutubeCache = new Map();

// youtubei.js — ESM-пакет, поэтому подгружаем его динамически и только при первом треке.
function getInnertube() {
  if (!innertubePromise) {
    innertubePromise = import('youtubei.js')
      .then(({ Innertube }) => Innertube.create({ lang: 'ru', location: 'RU' }))
      .catch((error) => {
        innertubePromise = null;
        throw error;
      });
  }
  return innertubePromise;
}

// Возвращает прямой аудиопоток YouTube, который сервер отдаёт клиентам через прокси.
async function resolveYouTube(videoId, { force = false } = {}) {
  const id = String(videoId || '').trim();
  if (!id) throw new Error('Не указан идентификатор видео');

  const cached = youtubeCache.get(id);
  if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached;
  if (!force && youtubePending.has(id)) return youtubePending.get(id);

  const task = (async () => {
    const yt = await getInnertube();
    const failures = [];
    for (const client of YOUTUBE_CLIENTS) {
      try {
        const info = await yt.getInfo(id, { client });
        const status = info.playability_status?.status;
        if (status && status !== 'OK') {
          failures.push(`${client}: ${info.playability_status?.reason || status}`);
          continue;
        }

        const format = info.chooseFormat({ type: 'audio', quality: 'best' });
        if (!format) {
          failures.push(`${client}: нет аудиодорожки`);
          continue;
        }

        let url = format.url;
        if (!url && format.decipher) {
          try {
            url = await format.decipher(yt.session.player);
          } catch (error) {
            failures.push(`${client}: ${error.message}`);
          }
        }
        if (!url) {
          if (!failures.some((item) => item.startsWith(`${client}:`))) {
            failures.push(`${client}: нет ссылки на аудиодорожку`);
          }
          continue;
        }

        const entry = {
          streamUrl: String(url),
          mime: format.mime_type || 'audio/mp4',
          title: info.basic_info?.title || '',
          duration: Math.max(0, Number(info.basic_info?.duration) || 0),
          expiresAt: Date.now() + YOUTUBE_TTL,
        };
        youtubeCache.set(id, entry);
        return entry;
      } catch (error) {
        failures.push(`${client}: ${error.message}`);
      }
    }

    if (failures.length) {
      for (const message of failures) console.warn('[youtube]', id, message);
    }
    const error = new Error(failures[0] || 'YouTube не отдал аудиодорожку');
    error.code = 'YOUTUBE_UNAVAILABLE';
    error.details = failures;
    throw error;
  })().finally(() => youtubePending.delete(id));

  youtubePending.set(id, task);
  return task;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeFetchError(error) {
  const cause = error?.cause;
  const code = cause?.code || cause?.errno || error?.code || '';
  const message = cause?.message || error?.message || String(error || 'Неизвестная ошибка');
  return code && !String(message).includes(code) ? `${message} (${code})` : message;
}

// Запрос JSON через Node https с принудительным IPv4. На части серверов
// сломан IPv6-маршрут, и встроенный fetch (undici) падает с «fetch failed».
function requestJsonHttps(url, { headers = {}, timeout = 12000, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers, timeout, family: 4 }, (response) => {
      const status = Number(response.statusCode) || 0;
      if (
        [301, 302, 303, 307, 308].includes(status) &&
        response.headers.location &&
        redirects > 0
      ) {
        response.resume();
        resolve(
          requestJsonHttps(new URL(response.headers.location, url).toString(), {
            headers,
            timeout,
            redirects: redirects - 1,
          })
        );
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) {
          request.destroy(new Error('Rutube вернул слишком большой ответ'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (status < 200 || status >= 300) {
          reject(new Error(`Rutube ответил ошибкой ${status}`));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error('Rutube вернул некорректный ответ'));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Таймаут соединения с Rutube')));
    request.on('error', reject);
  });
}

async function requestJsonFetch(url, headers) {
  const response = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Rutube ответил ошибкой ${response.status}`);
  return response.json();
}

async function fetchRutubeOptions(id) {
  const url = `https://rutube.ru/api/play/options/${id}/?format=json`;
  const headers = {
    'user-agent': USER_AGENT,
    accept: 'application/json, text/plain, */*',
    referer: 'https://rutube.ru/',
    origin: 'https://rutube.ru',
  };
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await requestJsonHttps(url, { headers });
    } catch (error) {
      lastError = error;
    }
    try {
      return await requestJsonFetch(url, headers);
    } catch (error) {
      lastError = error;
    }
    if (attempt === 0) await wait(400);
  }
  throw new Error(describeFetchError(lastError));
}

async function resolveRutube(videoId, { force = false } = {}) {
  const id = String(videoId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error('Некорректная ссылка Rutube');

  const cached = rutubeCache.get(id);
  if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached;

  const data = await fetchRutubeOptions(id);
  const hlsUrl = data.video_balancer?.m3u8 || data.video_balancer?.default;
  if (!hlsUrl) throw new Error('Rutube не отдал HLS-поток');

  const entry = {
    hlsUrl: String(hlsUrl),
    title: data.title || '',
    duration: Math.max(0, Math.round((Number(data.duration) || 0) / 1000)),
    live: Boolean(data.is_live) || String(data.stream_type || '').toLowerCase() === 'live',
    expiresAt: Date.now() + RUTUBE_TTL,
  };
  rutubeCache.set(id, entry);
  return entry;
}

function isAllowedUpstream(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    return (
      host === 'rutube.ru' ||
      host.endsWith('.rutube.ru') ||
      host === 'rtbcdn.ru' ||
      host.endsWith('.rtbcdn.ru')
    );
  } catch {
    return false;
  }
}

async function fetchUpstream(req, target, { range = true, headers = {} } = {}) {
  const requestHeaders = {
    'user-agent': USER_AGENT,
    accept: '*/*',
    ...headers,
  };
  if (range && req.headers.range) requestHeaders.range = req.headers.range;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch(target, { headers: requestHeaders, redirect: 'follow' });
    } catch (error) {
      lastError = error;
      if (attempt === 0) await wait(250);
    }
  }
  throw lastError;
}

function pipeResponse(res, upstream) {
  res.status(upstream.status);
  const copy = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'cache-control',
    'last-modified',
    'etag',
  ];
  for (const name of copy) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader('access-control-allow-origin', '*');
  if (!upstream.body) {
    res.end();
    return;
  }
  const body = Readable.fromWeb(upstream.body);
  body.on('error', () => {
    try {
      res.destroy();
    } catch {}
  });
  res.on('close', () => {
    try {
      body.destroy();
    } catch {}
  });
  body.pipe(res);
}

function isPlaylist(target, contentType) {
  return /mpegurl/i.test(String(contentType || '')) || /\.m3u8(?:$|[?#])/i.test(String(target || ''));
}

function safeAbsolute(value, base) {
  try {
    const url = new URL(String(value || ''), base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

// Переписывает все ссылки плейлиста на локальный прокси, чтобы hls.js не упирался в CORS.
function rewritePlaylist(text, baseUrl, makeUrl) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      const value = line.trim();
      if (!value) return line;
      if (value.startsWith('#')) {
        return line.replace(/URI="([^"]*)"/g, (match, uri) => {
          const absolute = safeAbsolute(uri, baseUrl);
          return absolute ? `URI="${makeUrl(absolute)}"` : match;
        });
      }
      const absolute = safeAbsolute(value, baseUrl);
      return absolute ? makeUrl(absolute) : line;
    })
    .join('\n');
}

module.exports = {
  USER_AGENT,
  resolveYouTube,
  resolveRutube,
  isAllowedUpstream,
  fetchUpstream,
  pipeResponse,
  isPlaylist,
  rewritePlaylist,
};
