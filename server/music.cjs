'use strict';

function youtubeIdFromUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0] || '';
      return /^[a-zA-Z0-9_-]{6,20}$/.test(id) ? id : '';
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v') || '';
        return /^[a-zA-Z0-9_-]{6,20}$/.test(id) ? id : '';
      }
      const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{6,20})/);
      return match ? match[1] : '';
    }
  } catch {}
  return '';
}

function rutubeIdFromUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'rutube.ru' && !host.endsWith('.rutube.ru')) return '';
    const match = url.pathname.match(
      /^\/(?:video|shorts|play\/embed|live\/video)\/([0-9a-f]{32})/i
    );
    return match ? match[1].toLowerCase() : '';
  } catch {}
  return '';
}

function vkVideoIdFromUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    const isVkHost =
      host === 'vk.com' ||
      host.endsWith('.vk.com') ||
      host === 'vkvideo.ru' ||
      host.endsWith('.vkvideo.ru') ||
      host === 'vk.ru' ||
      host.endsWith('.vk.ru');
    if (!isVkHost) return '';

    if (url.pathname === '/video_ext.php' || url.pathname === '/video.php') {
      const oid = url.searchParams.get('oid') || '';
      const id = url.searchParams.get('id') || '';
      if (/^-?\d+$/.test(oid) && /^\d+$/.test(id)) return `${oid}_${id}`;
      return '';
    }

    const match = url.pathname.match(/^\/video(-?\d+)_(\d+)(?:\/|$)/i);
    if (match) return `${match[1]}_${match[2]}`;
  } catch {}
  return '';
}

function vkAudioQueryFromUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    const isVkHost =
      host === 'vk.com' ||
      host.endsWith('.vk.com') ||
      host === 'vk.ru' ||
      host.endsWith('.vk.ru');
    if (!isVkHost) return '';
    // Страница поиска VK Music: /audio?performer=1&q=... или /music?q=...
    if (!/^\/(?:audio|audios|music)(?:\/|$)/i.test(url.pathname)) return '';
    const query =
      url.searchParams.get('q') ||
      url.searchParams.get('query') ||
      url.searchParams.get('search') ||
      '';
    return String(query).replace(/\s+/g, ' ').trim().slice(0, 180);
  } catch {}
  return '';
}

function prettyUrlTitle(url) {
  try {
    const parsed = new URL(url);
    const raw = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    const clean = raw.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim();
    if (clean) return clean.slice(0, 160);
    return parsed.hostname.replace(/^www\./, '') || 'Аудиопоток';
  } catch {
    return 'Аудиопоток';
  }
}

// Приводит ссылку к источнику, который умеет играть клиент.
// youtube — IFrame API, hls — hls.js, audio — <audio>, radio — live-поток.
function parseMusicSource(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = String(raw.url || '').trim().slice(0, 2048);
  if (!/^https?:\/\//i.test(url)) return null;

  const providedTitle = String(raw.title || '').trim().slice(0, 200);
  const videoId = youtubeIdFromUrl(url);
  if (videoId) {
    return {
      type: 'youtube',
      url: `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
      title: providedTitle || 'YouTube-видео',
      live: false,
    };
  }

  const rutubeId = rutubeIdFromUrl(url);
  if (rutubeId) {
    return {
      type: 'rutube',
      url: `https://rutube.ru/video/${rutubeId}/`,
      videoId: rutubeId,
      title: providedTitle || 'Rutube-видео',
      live: false,
    };
  }

  const vkId = vkVideoIdFromUrl(url);
  if (vkId) {
    const [owner, video] = vkId.split('_');
    return {
      type: 'vk',
      url: `https://vk.com/video${owner}_${video}`,
      videoId: vkId,
      title: providedTitle || 'VK Видео',
      live: false,
    };
  }

  // Ссылка на поиск VK Music: без авторизации VK не отдаёт mp3, поэтому
  // трек ищется на YouTube, а играется через уже готовый прокси.
  const vkAudioQuery = vkAudioQueryFromUrl(url);
  if (vkAudioQuery) {
    return {
      type: 'vk-audio',
      url,
      videoId: null,
      query: vkAudioQuery,
      title: providedTitle || `VK Music: ${vkAudioQuery}`,
      live: false,
    };
  }

  const cleanPath = url.split('#')[0].split('?')[0].toLowerCase();
  let type = 'radio';
  if (/\.m3u8$/.test(cleanPath)) type = 'hls';
  else if (/\.(mp3|ogg|oga|opus|m4a|aac|wav|flac|webm)$/.test(cleanPath)) type = 'audio';

  return {
    type,
    url,
    videoId: null,
    title: providedTitle || prettyUrlTitle(url),
    live: type === 'radio',
  };
}

function musicDTO(session, bot, serverNow = Date.now()) {
  if (!session) return null;
  const source = { ...(session.source || {}) };
  delete source.streamUrl;
  delete source.hlsUrl;
  delete source.hlsUpstream;
  delete source.filePath;
  if (session.streamKey && session.playback) {
    if (source.type === 'youtube' && session.playback.streamUrl) {
      source.streamUrl = `/api/music/stream/${session.botId}?key=${session.streamKey}`;
    }
    if (source.type === 'vk' && session.playback.streamUrl) {
      source.streamUrl = `/api/music/stream/${session.botId}?key=${session.streamKey}`;
    }
    if (source.type === 'rutube' && session.playback.hlsUpstream) {
      source.hlsUrl = `/api/music/hls/${session.botId}?key=${session.streamKey}`;
    }
  }
  return {
    channelId: session.channelId,
    serverId: session.serverId || null,
    botId: session.botId,
    bot: bot || null,
    source,
    playing: Boolean(session.playing),
    position: Number(session.position) || 0,
    updatedAt: session.updatedAt,
    startedAt: session.startedAt,
    startedBy: session.startedBy || null,
    volume: session.volume === undefined ? 100 : Number(session.volume),
    serverNow,
  };
}

module.exports = {
  youtubeIdFromUrl,
  rutubeIdFromUrl,
  vkVideoIdFromUrl,
  vkAudioQueryFromUrl,
  parseMusicSource,
  musicDTO,
  prettyUrlTitle,
};
