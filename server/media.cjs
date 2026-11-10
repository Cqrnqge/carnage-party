'use strict';

const dns = require('node:dns');
const https = require('node:https');
const net = require('node:net');
const { Readable } = require('node:stream');
const { Agent, fetch: undiciFetch } = require('undici');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const YOUTUBE_TTL = 60 * 60 * 1000;
const RUTUBE_TTL = 10 * 60 * 1000;
const VK_TTL = 30 * 60 * 1000;
// YouTube периодически меняет требования к клиентам. Пробуем несколько
// клиентов подряд: если один получает отказ или не отдаёт ссылку, следующий
// часто всё равно работает. VISIONOS отдаёт готовую ссылку без расшифровки
// подписи и разрешает читать файл с любого смещения. IOS и ANDROID_VR тоже
// отдают ссылку, но у них она часто ограничена первым мегабайтом — такие
// ссылки браузер воспроизвести не может.
const YOUTUBE_CLIENTS = ['VISIONOS', 'IOS', 'ANDROID_VR', 'MWEB', 'ANDROID', 'WEB', 'TV'];
const YOUTUBE_PROBE_BYTES = 1024;

const DNS_TTL = 5 * 60 * 1000;
const DNS_TIMEOUT = 5000;
const dnsCache = new Map();
const dnsPending = new Map();

// DNS на некоторых серверах периодически отвечает EAI_AGAIN, хотя интернет
// работает. Тогда спрашиваем адрес через DNS-over-HTTPS по IP-адресу
// резолвера — так запрос не зависит от системного DNS.
function queryDohType(hostname, type) {
  const recordType = type === 'AAAA' ? 28 : 1;
  const endpoints = [
    {
      address: '1.1.1.1',
      servername: 'cloudflare-dns.com',
      path: `/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
      host: 'cloudflare-dns.com',
    },
    {
      address: '8.8.8.8',
      servername: 'dns.google',
      path: `/resolve?name=${encodeURIComponent(hostname)}&type=${type}`,
      host: 'dns.google',
    },
  ];

  return new Promise((resolve, reject) => {
    let index = 0;
    let lastError = null;

    const next = () => {
      if (index >= endpoints.length) {
        reject(lastError || new Error(`Не удалось определить адрес ${hostname}`));
        return;
      }
      const endpoint = endpoints[index];
      index += 1;
      const request = https.get(
        {
          hostname: endpoint.address,
          family: 4,
          servername: endpoint.servername,
          path: endpoint.path,
          headers: {
            host: endpoint.host,
            accept: 'application/dns-json',
            'user-agent': USER_AGENT,
          },
          timeout: DNS_TIMEOUT,
        },
        (response) => {
          const chunks = [];
          let size = 0;
          response.on('data', (chunk) => {
            size += chunk.length;
            if (size > 256 * 1024) {
              request.destroy(new Error('DNS-ответ слишком большой'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            if (response.statusCode !== 200) {
              lastError = new Error(`DNS-сервер ответил ${response.statusCode}`);
              next();
              return;
            }
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              const answers = Array.isArray(data.Answer) ? data.Answer : [];
              const addresses = answers
                .filter((item) => Number(item.type) === recordType)
                .map((item) => String(item.data || '').trim())
                .filter((address) => net.isIP(address))
                .map((address) => ({ address, family: net.isIP(address) }));
              if (addresses.length) {
                resolve(addresses);
                return;
              }
              lastError = new Error(`DNS-сервер не вернул ${type}-адрес`);
              next();
            } catch (error) {
              lastError = error;
              next();
            }
          });
        }
      );
      request.on('timeout', () => request.destroy(new Error('Таймаут DNS-запроса')));
      request.on('error', (error) => {
        lastError = error;
        next();
      });
    };

    next();
  });
}

async function queryDoh(hostname) {
  const results = await Promise.allSettled([
    queryDohType(hostname, 'A'),
    queryDohType(hostname, 'AAAA'),
  ]);
  const addresses = [];
  for (const result of results) {
    if (result.status === 'fulfilled') addresses.push(...result.value);
  }
  if (!addresses.length) throw new Error(`Не удалось определить адрес ${hostname}`);
  return addresses;
}

function lookupSystem(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(Array.isArray(addresses) ? addresses : []);
    });
  });
}

function resolveHostAddresses(hostname) {
  const host = String(hostname || '').toLowerCase();
  const family = net.isIP(host);
  if (family) return Promise.resolve([{ address: host, family }]);

  const cached = dnsCache.get(host);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.addresses);
  if (dnsPending.has(host)) return dnsPending.get(host);

  const task = (async () => {
    let addresses = [];
    try {
      addresses = await lookupSystem(host);
    } catch {}
    if (!addresses.length) addresses = await queryDoh(host);

    const unique = [];
    const seen = new Set();
    for (const item of addresses) {
      const address = String(item.address || '');
      if (!address || seen.has(address)) continue;
      seen.add(address);
      unique.push({ address, family: Number(item.family) || net.isIP(address) });
    }
    if (!unique.length) throw new Error(`Не удалось определить адрес ${host}`);
    dnsCache.set(host, { addresses: unique, expiresAt: Date.now() + DNS_TTL });
    return unique;
  })().finally(() => dnsPending.delete(host));

  dnsPending.set(host, task);
  return task;
}

// lookup для Node https и undici: сначала системный DNS, при ошибке — DoH.
function familyLookup(family) {
  return (hostname, options, callback) => {
    let opts = options;
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    } else if (typeof opts === 'number') {
      opts = { family: opts };
    }
    resolveHostAddresses(hostname)
      .then((addresses) => {
        let list = addresses.filter((item) => item.family === family);
        if (!list.length) list = addresses;
        if (opts?.all) {
          callback(null, list);
          return;
        }
        callback(null, list[0].address, list[0].family);
      })
      .catch((error) => callback(error));
  };
}

const upstreamAgents = new Map();

function getUpstreamAgent(family = 4) {
  if (!upstreamAgents.has(family)) {
    upstreamAgents.set(
      family,
      new Agent({
        connect: { lookup: familyLookup(family), family },
        connections: 32,
        keepAliveTimeout: 30_000,
      })
    );
  }
  return upstreamAgents.get(family);
}

function isConnectError(error) {
  const code = error?.cause?.code || error?.code || '';
  return (
    [
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENETUNREACH',
      'EHOSTUNREACH',
      'EAI_AGAIN',
      'UND_ERR_CONNECT_TIMEOUT',
    ].includes(code) ||
    /fetch failed|socket disconnected|TLS|handshake/i.test(String(error?.message || ''))
  );
}

// Пробует сначала предпочтительное семейство адресов, затем второе.
// На части сетей IPv4 у YouTube сбрасывает TLS, а IPv6 работает (и наоборот
// для Rutube), поэтому жёстко выбирать одно семейство нельзя.
async function fetchWithFallback(url, init = {}, preferredFamily = 4) {
  const order = preferredFamily === 6 ? [6, 4] : [4, 6];
  let lastError = null;
  for (const family of order) {
    try {
      return await undiciFetch(url, { ...init, dispatcher: getUpstreamAgent(family) });
    } catch (error) {
      lastError = error;
      if (!isConnectError(error)) throw error;
    }
  }
  throw lastError;
}

function isYouTubeHost(value) {
  try {
    const host = new URL(String(value || '')).hostname.toLowerCase();
    return (
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtu.be' ||
      host.endsWith('.googlevideo.com') ||
      host.endsWith('.ytimg.com')
    );
  } catch {
    return false;
  }
}

let innertubePromise = null;
const youtubeCache = new Map();
const youtubePending = new Map();
const rutubeCache = new Map();
const vkCache = new Map();
const vkPending = new Map();

// youtubei.js передаёт свой Request-объект, который undici не понимает
// напрямую. Приводим его к URL + параметрам и сохраняем устойчивый DNS.
function youtubeFetch(input, init = {}) {
  const isRequest =
    input && typeof input === 'object' && typeof input.url === 'string' && !(input instanceof URL);
  const url = isRequest ? input.url : input;
  return fetchWithFallback(
    url,
    {
      ...(init || {}),
      method: init?.method || (isRequest ? input.method : undefined),
      headers: init?.headers || (isRequest ? input.headers : undefined),
    },
    6
  );
}

// youtubei.js — ESM-пакет, поэтому подгружаем его динамически и только при первом треке.
function getInnertube() {
  if (!innertubePromise) {
    innertubePromise = import('youtubei.js')
      .then(({ Innertube }) =>
        Innertube.create({
          lang: 'ru',
          location: 'RU',
          // Запросы к YouTube тоже идут через устойчивый DNS: иначе при
          // EAI_AGAIN резолвер не сможет даже получить данные о видео.
          fetch: youtubeFetch,
        })
      )
      .catch((error) => {
        innertubePromise = null;
        throw error;
      });
  }
  return innertubePromise;
}

// Проверяет, что ссылка googlevideo отдаёт не только начало файла: у IOS и
// ANDROID_VR YouTube часто разрешает чтение лишь первого мегабайта. Запрос
// последнего килобайта быстро показывает, можно ли отдать весь трек.
async function youtubeStreamReadable(url) {
  try {
    const size = Number(new URL(String(url)).searchParams.get('clen')) || 0;
    if (size <= YOUTUBE_PROBE_BYTES) return true;
    const start = size - YOUTUBE_PROBE_BYTES;
    const response = await fetchUpstream(
      { headers: { range: `bytes=${start}-${size - 1}` } },
      url,
      { range: true }
    );
    const ok = response.status === 206 || response.status === 200;
    try {
      await response.body?.cancel();
    } catch {}
    return ok;
  } catch {
    return false;
  }
}

// Перебирает клиентов YouTube на одной сессии. Возвращает поток или null.
async function resolveYouTubeWith(yt, id, failures) {
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

      const streamUrl = String(url);
      if (!(await youtubeStreamReadable(streamUrl))) {
        failures.push(`${client}: ссылка ограничена по диапазону`);
        continue;
      }

      return {
        streamUrl,
        mime: format.mime_type || 'audio/mp4',
        title: info.basic_info?.title || '',
        duration: Math.max(0, Number(info.basic_info?.duration) || 0),
        expiresAt: Date.now() + YOUTUBE_TTL,
      };
    } catch (error) {
      failures.push(`${client}: ${error.message}`);
    }
  }
  return null;
}

// Возвращает прямой аудиопоток YouTube, который сервер отдаёт клиентам через прокси.
async function resolveYouTube(videoId, { force = false } = {}) {
  const id = String(videoId || '').trim();
  if (!id) throw new Error('Не указан идентификатор видео');

  const cached = youtubeCache.get(id);
  if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached;
  if (!force && youtubePending.has(id)) return youtubePending.get(id);

  const task = (async () => {
    const failures = [];
    let entry = null;

    try {
      entry = await resolveYouTubeWith(await getInnertube(), id, failures);
    } catch (error) {
      failures.push(`session: ${error.message}`);
    }

    // Если все клиенты отказали, пробуем один раз с новой сессией:
    // YouTube иногда помечает visitorData как подозрительный.
    if (!entry) {
      innertubePromise = null;
      try {
        entry = await resolveYouTubeWith(await getInnertube(), id, failures);
      } catch (error) {
        failures.push(`new session: ${error.message}`);
      }
    }

    if (entry) {
      youtubeCache.set(id, entry);
      return entry;
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
    const request = https.get(
      url,
      {
        headers,
        timeout,
        lookup: familyLookup(4),
        family: 4,
      },
      (response) => {
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
  const response = await fetchWithFallback(
    url,
    {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    },
    4
  );
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

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_match, code) => {
      try {
        return String.fromCodePoint(Number(code));
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      try {
        return String.fromCodePoint(parseInt(code, 16));
      } catch {
        return '';
      }
    })
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// VK складывает данные плеера в payload[1], но структура меняется: иногда это
// массив, иногда объект с числовыми ключами. Ищем её рекурсивно.
function findVkPlayerData(root, depth = 0) {
  if (!root || typeof root !== 'object' || depth > 6) return null;
  if (root.player && Array.isArray(root.player.params) && root.player.params[0]) return root;
  if (root.player && root.player.params && typeof root.player.params === 'object') return root;
  for (const value of Object.values(root)) {
    const found = findVkPlayerData(value, depth + 1);
    if (found) return found;
  }
  return null;
}

async function fetchVkPlayer(videoId) {
  const body = new URLSearchParams({
    act: 'show',
    video: videoId,
    al: '1',
  }).toString();

  const response = await fetchWithFallback(
    'https://vk.com/al_video.php',
    {
      method: 'POST',
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        referer: 'https://vk.com/al_video.php',
        origin: 'https://vk.com',
      },
      body,
      signal: AbortSignal.timeout(15_000),
    },
    4
  );

  if (!response.ok) throw new Error(`VK ответил ошибкой ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = String(response.headers.get('content-type') || '');
  let text = buffer.toString('utf8');
  // VK обычно отдаёт JSON в windows-1251: без правильной кодировки русский
  // заголовок превращается в мусор. Если VK перейдёт на UTF-8 — не ломаемся.
  try {
    text = new TextDecoder(/charset=windows-1251/i.test(contentType) ? 'windows-1251' : 'utf-8').decode(buffer);
  } catch {}

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('VK вернул некорректный ответ');
  }

  const payload = data?.payload?.[1] ?? data?.payload ?? data;
  const entry = findVkPlayerData(payload);
  if (!entry) throw new Error('VK не вернул данные плеера');
  return entry;
}

async function resolveVk(videoId, { force = false } = {}) {
  const id = String(videoId || '').trim();
  if (!/^-?\d+_\d+$/.test(id)) throw new Error('Некорректная ссылка VK Видео');

  const cached = vkCache.get(id);
  if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached;
  if (!force && vkPending.has(id)) return vkPending.get(id);

  const task = (async () => {
    const entry = await fetchVkPlayer(id);
    const params = Array.isArray(entry.player?.params)
      ? entry.player.params[0]
      : entry.player?.params || {};
    const mvData = entry.mvData || {};
    const live = Boolean(mvData.is_live || mvData.is_active_live);

    let streamUrl = '';
    for (const key of ['url1080', 'url720', 'url480', 'url360', 'url240', 'url144']) {
      if (params[key]) {
        streamUrl = String(params[key]);
        break;
      }
    }
    if (!streamUrl) {
      throw new Error(
        live
          ? 'прямые трансляции VK пока не поддерживаются'
          : 'VK не отдал видеопоток'
      );
    }

    let expiresAt = Date.now() + VK_TTL;
    try {
      const raw = Number(new URL(streamUrl).searchParams.get('expires'));
      if (raw > 0) expiresAt = Math.min(expiresAt, raw);
    } catch {}
    if (expiresAt <= Date.now() + 60_000) expiresAt = Date.now() + VK_TTL;

    const resolved = {
      streamUrl,
      title: decodeHtmlEntities(mvData.title || '').slice(0, 200) || 'VK Видео',
      duration: Math.max(0, Math.round(Number(mvData.duration) || 0)),
      live,
      expiresAt,
    };
    vkCache.set(id, resolved);
    return resolved;
  })().finally(() => vkPending.delete(id));

  vkPending.set(id, task);
  return task;
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
      return await fetchWithFallback(
        target,
        {
          headers: requestHeaders,
          redirect: 'follow',
        },
        isYouTubeHost(target) ? 6 : 4
      );
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
  resolveVk,
  isAllowedUpstream,
  fetchUpstream,
  pipeResponse,
  isPlaylist,
  rewritePlaylist,
};
