'use strict';

const { Readable } = require('node:stream');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const YOUTUBE_TTL = 60 * 60 * 1000;
const RUTUBE_TTL = 10 * 60 * 1000;

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
    const info = await yt.getInfo(id, { client: 'IOS' });
    const status = info.playability_status?.status;
    if (status && status !== 'OK') {
      const reason = info.playability_status?.reason || status;
      const error = new Error(reason);
      error.code = 'YOUTUBE_UNAVAILABLE';
      throw error;
    }

    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    if (!format) throw new Error('YouTube не предложил аудиодорожку');

    let url = format.url;
    if (!url && format.decipher) url = await format.decipher(yt.session.player);
    if (!url) throw new Error('YouTube не отдал ссылку на аудиодорожку');

    const entry = {
      streamUrl: String(url),
      mime: format.mime_type || 'audio/mp4',
      title: info.basic_info?.title || '',
      duration: Math.max(0, Number(info.basic_info?.duration) || 0),
      expiresAt: Date.now() + YOUTUBE_TTL,
    };
    youtubeCache.set(id, entry);
    return entry;
  })().finally(() => youtubePending.delete(id));

  youtubePending.set(id, task);
  return task;
}

async function resolveRutube(videoId, { force = false } = {}) {
  const id = String(videoId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error('Некорректная ссылка Rutube');

  const cached = rutubeCache.get(id);
  if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached;

  const response = await fetch(`https://rutube.ru/api/play/options/${id}/?format=json`, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Rutube ответил ошибкой ${response.status}`);
  const data = await response.json();
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
  return fetch(target, { headers: requestHeaders, redirect: 'follow' });
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
