import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Crown,
  ExternalLink,
  Link2,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Smile,
  Tv,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useApp } from '../../store';
import { formatTime } from '../../utils';
import { copyText } from '../../stream-utils';
import Avatar from '../ui/Avatar';
import EmojiPicker from '../chat/EmojiPicker';
import Modal from '../ui/Modal';
import {
  formatWatchTime,
  loadYouTubeApi,
  watchManager,
  watchTarget,
} from '../../watch';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isDirectVideoUrl(url) {
  const value = String(url || '').trim();
  if (!value) return false;
  if (/^(data:video\/|blob:)/i.test(value)) return true;
  const clean = value.split('?')[0].split('#')[0].toLowerCase();
  return /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi|m3u8|mpd)$/.test(clean);
}

// YouTube-страница во встроенном браузере: убираем всё, кроме плеера.
const WATCH_WEBVIEW_CSS = `
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    background: #000 !important;
  }
  #masthead-container, ytd-masthead, #secondary, #secondary-inner, #related,
  #comments, #comment-section, #below, ytd-watch-metadata, #chat, #chat-container,
  #donation-shelf, #merch-shelf, #panels, ytd-engagement-panel-section-list-renderer,
  ytd-popup-container, tp-yt-paper-dialog, ytd-consent-bump-v2-lightbox,
  .ytp-chrome-top, .ytp-chrome-bottom, .ytp-gradient-top, .ytp-gradient-bottom,
  .ytp-pause-overlay, .ytp-endscreen-content, .ytp-ce-element, .ytp-cards-teaser,
  .ytp-large-play-button, .ytp-ad-overlay-container, .ytp-ad-image-overlay,
  .ytp-ad-text-overlay, .ytp-suggestion-set {
    display: none !important;
  }
  #page-manager, ytd-watch-flexy, #columns, #primary, #primary-inner {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    max-width: none !important;
    min-width: 0 !important;
  }
  #player-container-outer, #player-container, #player, ytd-player, #movie_player {
    position: fixed !important;
    inset: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    z-index: 2147483647 !important;
    background: #000 !important;
  }
  video.html5-main-video {
    object-fit: contain !important;
  }
`;

export default function WatchPartyView({ roomId } = {}) {
  const closeModal = useApp((state) => state.closeModal);
  const toast = useApp((state) => state.toast);
  const [snapshot, setSnapshot] = useState(() => watchManager.snapshot());
  const [playerReady, setPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState('');
  const [needsGesture, setNeedsGesture] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekValue, setSeekValue] = useState(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [showChat, setShowChat] = useState(true);
  const [webviewFallback, setWebviewFallback] = useState(false);
  const [webviewPageReady, setWebviewPageReady] = useState(false);
  const [webviewAd, setWebviewAd] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiBox, setEmojiBox] = useState(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [sourceBusy, setSourceBusy] = useState(false);

  const mediaRef = useRef(null);
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const webviewRef = useRef(null);
  const webviewStateRef = useRef({ currentTime: 0, duration: 0, paused: true, ad: false });
  const webviewAdRef = useRef(false);
  const applyStateRef = useRef(null);
  const gestureTimerRef = useRef(null);
  const playerKindRef = useRef('');
  const applyingRef = useRef(false);
  const rateTimerRef = useRef(null);
  const snapshotRef = useRef(snapshot);
  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);

  const servers = useApp((app) => app.servers);
  const channels = useApp((app) => app.channels);

  snapshotRef.current = snapshot;
  volumeRef.current = volume;
  mutedRef.current = muted;
  const { room, state, participants, chat, self, live, ended, error, offset } = snapshot;
  const isHost = Boolean(self?.host);

  const canWebview = typeof window !== 'undefined' && Boolean(window.desktop);
  const isDirectVideo = room?.source?.type === 'url' && isDirectVideoUrl(room.source.url);
  const isWebPage = room?.source?.type === 'url' && !isDirectVideo;
  const useYouTubeWebview = room?.source?.type === 'youtube' && webviewFallback && canWebview;
  const useWebview = useYouTubeWebview || (isWebPage && canWebview);
  const webviewSrc = useYouTubeWebview
    ? `https://www.youtube.com/watch?v=${room.source.videoId}&autoplay=0&playsinline=1`
    : isWebPage
      ? room.source.url
      : null;
  const browserOnly = isWebPage && !canWebview;
  const webviewUserAgent = typeof navigator !== 'undefined'
    ? navigator.userAgent.replace(/\sElectron\/[\d.]+/i, '').replace(/\sCarnage Party\/[\d.]+/i, '')
    : undefined;
  const roomChannel = (channels || []).find((item) => item.id === room?.channelId);
  const roomServer = (servers || []).find((item) => item.id === roomChannel?.serverId);

  useEffect(() => {
    const unsubscribe = watchManager.subscribe(setSnapshot);
    watchManager.join(roomId);
    return () => {
      unsubscribe();
      watchManager.leave();
      if (gestureTimerRef.current) clearTimeout(gestureTimerRef.current);
    };
  }, [roomId]);

  useEffect(() => {
    setPlayerReady(false);
    setPlayerError('');
    setNeedsGesture(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setSeekValue(null);
    setWebviewFallback(false);
    setWebviewPageReady(false);
    setWebviewAd(false);
    setEmojiOpen(false);
    setSourceOpen(false);
    setSourceError('');
    webviewStateRef.current = { currentTime: 0, duration: 0, paused: true, ad: false };
    webviewAdRef.current = false;
    playerKindRef.current = room?.source?.type || '';
  }, [room?.id, room?.source?.type, room?.source?.videoId, room?.source?.url]);

  // YouTube-плеер.
  useEffect(() => {
    if (room?.source?.type !== 'youtube' || !room?.source?.videoId) return undefined;
    if (webviewFallback) return undefined;
    let cancelled = false;
    const media = mediaRef.current;
    if (!media) return undefined;
    media.querySelectorAll('.watch-youtube-host').forEach((node) => node.remove());
    const host = document.createElement('div');
    host.className = 'watch-youtube-host';
    media.appendChild(host);

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        const player = new YT.Player(host, {
          videoId: room.source.videoId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              if (cancelled) return;
              playerRef.current = event.target;
              setPlayerReady(true);
              setDuration(event.target.getDuration?.() || 0);
              try {
                event.target.setVolume(Math.round(volume * 100));
                if (muted) event.target.mute();
              } catch {}
            },
            onStateChange: (event) => {
              const value = Number(event.data);
              if (value === 1) {
                setPlaying(true);
                setNeedsGesture(false);
                watchManager.setBuffering(false);
              } else if (value === 2) {
                setPlaying(false);
              } else if (value === 3) {
                watchManager.setBuffering(true);
              } else if (value === 0) {
                setPlaying(false);
              }
            },
            onError: (event) => {
              const code = Number(event.data);
              if ((code === 101 || code === 150) && canWebview) {
                setPlayerError('');
                setPlayerReady(false);
                setWebviewFallback(true);
                return;
              }
              setPlayerError(
                code === 101 || code === 150
                  ? 'YouTube запрещает встраивание этого видео. Откройте его в приложении Carnage Party — там работает встроенный браузер — или на YouTube.'
                  : 'YouTube не смог воспроизвести видео. Попробуйте другую ссылку.'
              );
            },
          },
        });
        playerRef.current = player;
      })
      .catch(() => {
        if (!cancelled) setPlayerError('Не удалось загрузить YouTube. Проверьте интернет.');
      });

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy?.();
      } catch {}
      playerRef.current = null;
      host.remove();
    };
  }, [room?.source?.type, room?.source?.videoId, webviewFallback, canWebview]);

  useEffect(() => {
    if (room?.source?.type !== 'url' || !videoRef.current) return undefined;
    const video = videoRef.current;
    const onLoaded = () => {
      setPlayerReady(true);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setPlaying(!video.paused);
    };
    const onPlay = () => {
      setPlaying(true);
      setNeedsGesture(false);
      watchManager.setBuffering(false);
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => watchManager.setBuffering(true);
    const onPlaying = () => {
      setPlaying(true);
      watchManager.setBuffering(false);
    };
    const onEnded = () => setPlaying(false);
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('ended', onEnded);
    };
  }, [room?.source?.type, room?.source?.url]);

  // Встроенный браузер: YouTube-страница или любой другой сайт.
  useEffect(() => {
    if (!useWebview || !webviewSrc) return undefined;
    const view = webviewRef.current;
    if (!view) return undefined;
    let disposed = false;
    let poll = null;
    let cssKey = null;

    const execute = (code, userGesture = false) => {
      try {
        if (typeof view.executeJavaScript !== 'function') return Promise.resolve(null);
        return Promise.resolve(view.executeJavaScript(code, userGesture)).catch(() => null);
      } catch {
        return Promise.resolve(null);
      }
    };

    const inject = async () => {
      if (disposed) return;
      try {
        if (typeof view.insertCSS === 'function') {
          const key = await view.insertCSS(WATCH_WEBVIEW_CSS);
          if (!disposed) cssKey = key;
        }
      } catch {}
      // Закрываем баннеры согласия, если YouTube их показал.
      execute(`(() => {
        const labels = ['Принять все', 'Accept all', 'I agree', 'Согласен'];
        const buttons = Array.from(document.querySelectorAll('button, tp-yt-paper-button, yt-button-shape button'));
        const target = buttons.find((button) => labels.includes((button.innerText || '').trim()));
        target?.click();
        return true;
      })()`);
    };

    const read = () => execute(`(() => {
      const player = document.querySelector('.html5-video-player');
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (!video) return null;
      const ad = Boolean(player?.classList.contains('ad-showing')) || Boolean(document.querySelector('.ytp-ad-player-overlay'));
      return {
        currentTime: Number(video.currentTime) || 0,
        duration: Number(video.duration) || 0,
        paused: Boolean(video.paused),
        ad,
      };
    })()`);

    const tick = async () => {
      if (disposed || isWebPage) return;
      const data = await read();
      if (!data || disposed) return;
      if (data.ad) {
        webviewAdRef.current = true;
        setWebviewAd(true);
        return;
      }
      if (webviewAdRef.current) {
        webviewAdRef.current = false;
        setWebviewAd(false);
        applyStateRef.current?.(snapshotRef.current.state, true);
      }
      webviewStateRef.current = {
        currentTime: data.currentTime,
        duration: Number.isFinite(data.duration) ? data.duration : 0,
        paused: data.paused,
        ad: false,
      };
      setPlayerReady(true);
      if (Number.isFinite(data.duration) && data.duration > 0) setDuration(data.duration);
      setCurrentTime(data.currentTime);
      setPlaying(!data.paused);
      if (!data.paused) setNeedsGesture(false);
    };

    const start = () => {
      inject();
      try {
        if (typeof view.getURL === 'function' && view.getURL()) setWebviewPageReady(true);
      } catch {}
      if (!poll) {
        tick();
        poll = setInterval(tick, 500);
      }
    };

    const onReady = () => {
      setWebviewPageReady(true);
      start();
    };
    const onFail = (event) => {
      if (event?.isMainFrame === false) return;
      if (event?.errorCode === -3) return;
      setPlayerError('Не удалось открыть страницу во встроенном браузере. Проверьте ссылку.');
    };

    view.addEventListener('dom-ready', onReady);
    view.addEventListener('did-attach', start);
    view.addEventListener('did-finish-load', onReady);
    view.addEventListener('did-fail-load', onFail);
    start();
    const fallbackTimer = setTimeout(start, 1500);

    return () => {
      disposed = true;
      clearTimeout(fallbackTimer);
      if (poll) clearInterval(poll);
      view.removeEventListener('dom-ready', onReady);
      view.removeEventListener('did-attach', start);
      view.removeEventListener('did-finish-load', onReady);
      view.removeEventListener('did-fail-load', onFail);
      if (cssKey) {
        try {
          if (typeof view.removeInsertedCSS === 'function') view.removeInsertedCSS(cssKey);
        } catch {}
      }
    };
  }, [useWebview, webviewSrc, isWebPage]);

  const webviewExecute = (code, userGesture = false) => {
    const view = webviewRef.current;
    if (!view || typeof view.executeJavaScript !== 'function') return Promise.resolve(null);
    try {
      return Promise.resolve(view.executeJavaScript(code, userGesture)).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };

  const getCurrentTime = () => {
    if (useYouTubeWebview) return webviewStateRef.current.currentTime || 0;
    if (room?.source?.type === 'youtube') {
      const value = playerRef.current?.getCurrentTime?.();
      return Number.isFinite(value) ? value : 0;
    }
    if (isDirectVideo) return videoRef.current?.currentTime || 0;
    return 0;
  };

  const getDuration = () => {
    if (useYouTubeWebview) {
      const value = webviewStateRef.current.duration;
      return Number.isFinite(value) && value > 0 ? value : duration;
    }
    if (room?.source?.type === 'youtube') {
      const value = playerRef.current?.getDuration?.();
      return Number.isFinite(value) ? value : duration;
    }
    const value = videoRef.current?.duration;
    return Number.isFinite(value) ? value : duration;
  };

  const isPaused = () => {
    if (useYouTubeWebview) return webviewStateRef.current.paused !== false;
    if (room?.source?.type === 'youtube') {
      return playerRef.current?.getPlayerState?.() !== 1;
    }
    return videoRef.current?.paused !== false;
  };

  const play = () => {
    if (useYouTubeWebview) {
      const nextVolume = Number(volumeRef.current) || 0;
      const nextMuted = Boolean(mutedRef.current);
      webviewExecute(`(async () => {
        const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (!video) return false;
        try {
          video.volume = ${nextVolume};
          video.muted = ${nextMuted ? 'true' : 'false'};
          await video.play();
          return true;
        } catch {
          return false;
        }
      })()`, true).then((ok) => {
        if (ok === false) {
          setNeedsGesture(true);
        } else {
          webviewStateRef.current.paused = false;
          setNeedsGesture(false);
        }
      });
      return;
    }
    try {
      if (room?.source?.type === 'youtube') playerRef.current?.playVideo?.();
      else if (isDirectVideo) videoRef.current?.play?.().catch(() => setNeedsGesture(true));
    } catch {
      setNeedsGesture(true);
    }
  };

  const pause = () => {
    if (useYouTubeWebview) {
      webviewStateRef.current.paused = true;
      webviewExecute(`(() => {
        const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (video) video.pause();
        return true;
      })()`);
      return;
    }
    try {
      if (room?.source?.type === 'youtube') playerRef.current?.pauseVideo?.();
      else if (isDirectVideo) videoRef.current?.pause?.();
    } catch {}
  };

  const seek = (value) => {
    const target = clamp(Number(value) || 0, 0, Math.max(0, getDuration()));
    if (useYouTubeWebview) {
      webviewStateRef.current.currentTime = target;
      webviewExecute(`(() => {
        const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (video) video.currentTime = ${target};
        return true;
      })()`);
      return;
    }
    try {
      if (room?.source?.type === 'youtube') playerRef.current?.seekTo?.(target, true);
      else if (isDirectVideo && videoRef.current) videoRef.current.currentTime = target;
    } catch {}
  };

  const setPlaybackRate = (value) => {
    const rate = clamp(Number(value) || 1, 0.25, 2);
    if (useYouTubeWebview) {
      webviewExecute(`(() => {
        const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (video) video.playbackRate = ${rate};
        return true;
      })()`);
      return;
    }
    try {
      if (room?.source?.type === 'youtube') playerRef.current?.setPlaybackRate?.(rate);
      else if (isDirectVideo && videoRef.current) videoRef.current.playbackRate = rate;
    } catch {}
  };

  const applyState = (next, force = false) => {
    if (!next || !playerReady || webviewAdRef.current) return;
    const target = watchTarget(next, offset);
    const current = getCurrentTime();
    const drift = Number.isFinite(current) ? current - target : 0;
    const paused = isPaused();
    applyingRef.current = true;
    try {
      if (next.playing) {
        if (paused) {
          play();
          // Браузер может заблокировать автозапуск — показываем кнопку,
          // чтобы пользователь включил видео осознанным кликом.
          if (gestureTimerRef.current) clearTimeout(gestureTimerRef.current);
          gestureTimerRef.current = setTimeout(() => {
            if (next.playing && isPaused()) setNeedsGesture(true);
          }, 1800);
        }
        if (force || Math.abs(drift) > 1.0) seek(target);
        else if (Math.abs(drift) > 0.25) setPlaybackRate((next.rate || 1) * (drift > 0 ? 0.97 : 1.03));
        else setPlaybackRate(next.rate || 1);
      } else {
        if (!paused) pause();
        if (force || Math.abs(drift) > 0.15) seek(target);
        setPlaybackRate(next.rate || 1);
      }
    } finally {
      if (rateTimerRef.current) clearTimeout(rateTimerRef.current);
      rateTimerRef.current = setTimeout(() => setPlaybackRate(next.rate || 1), 4000);
      setTimeout(() => {
        applyingRef.current = false;
      }, 350);
    }
  };

  applyStateRef.current = applyState;

  useEffect(() => {
    if (!playerReady || !state) return;
    applyState(state, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, playerReady]);

  // Прогресс и авто-тик хоста.
  useEffect(() => {
    if (!playerReady) return undefined;
    const progress = setInterval(() => {
      const value = getCurrentTime();
      if (Number.isFinite(value)) setCurrentTime(value);
      const total = getDuration();
      if (Number.isFinite(total) && total > 0) setDuration(total);
    }, 500);
    return () => clearInterval(progress);
  }, [playerReady, room?.source?.type]);

  useEffect(() => {
    if (!isHost || !playerReady || isWebPage) return undefined;
    const tick = setInterval(() => {
      if (webviewAdRef.current) return;
      if (!snapshotRef.current.state?.playing) return;
      const value = getCurrentTime();
      if (Number.isFinite(value)) watchManager.tick(value);
    }, 2000);
    return () => clearInterval(tick);
  }, [isHost, playerReady, room?.id, isWebPage]);

  // Остальные участники периодически запрашивают актуальное состояние:
  // так плеер догоняет после потери пакетов, сворачивания окна или
  // переподключения, даже если очередной тик хоста не дошёл.
  useEffect(() => {
    if (isHost || !playerReady || !room?.id) return undefined;
    const request = () => watchManager.requestSync();
    request();
    const id = setInterval(request, 4000);
    const onVisible = () => {
      if (!document.hidden) request();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [isHost, playerReady, room?.id]);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ block: 'end' });
  }, [chat.length]);

  const togglePlay = () => {
    if (!isHost || !state) return;
    const value = getCurrentTime();
    watchManager.command(state.playing ? 'pause' : 'play', { position: value });
  };

  const commitSeek = () => {
    if (!isHost || seekValue === null || !state) return;
    const value = clamp(seekValue, 0, Math.max(0, duration));
    setSeekValue(null);
    watchManager.command('seek', { position: value });
  };

  const resync = () => {
    if (state) applyState(state, true);
  };

  const sendChat = (event) => {
    event.preventDefault();
    const value = chatText.trim();
    if (!value) return;
    watchManager.sendChat(value);
    setChatText('');
  };

  const leave = () => {
    watchManager.leave();
    closeModal();
  };

  const endRoom = () => {
    watchManager.end();
    setTimeout(() => {
      watchManager.leave();
      closeModal();
    }, 120);
  };

  const toggleEmoji = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (emojiOpen) {
      setEmojiOpen(false);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(330, Math.max(240, window.innerWidth - 24));
    const height = Math.min(394, Math.max(140, window.innerHeight - 96));
    let top = rect.top - height - 8;
    if (top < 8) top = Math.min(window.innerHeight - height - 8, rect.bottom + 8);
    setEmojiBox({
      left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8),
      top: Math.max(8, top),
      width,
    });
    setEmojiOpen(true);
  };

  const insertChatEmoji = (emoji) => {
    const el = chatInputRef.current;
    const start = el?.selectionStart ?? chatText.length;
    const end = el?.selectionEnd ?? chatText.length;
    const next = (chatText.slice(0, start) + emoji + chatText.slice(end)).slice(0, 500);
    setChatText(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const position = Math.min(start + emoji.length, next.length);
      el.setSelectionRange(position, position);
    });
  };

  const openExternal = (url) => {
    if (!url) return;
    if (window.desktop?.openExternal) {
      window.desktop.openExternal(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const toggleSourceEditor = () => {
    if (sourceOpen) {
      setSourceOpen(false);
      return;
    }
    setSourceUrl(room?.source?.url || '');
    setSourceError('');
    setSourceOpen(true);
  };

  const submitSource = async (event) => {
    event.preventDefault();
    const value = sourceUrl.trim();
    if (!/^https?:\/\//i.test(value)) {
      setSourceError('Нужна ссылка, начинающаяся с http:// или https://');
      return;
    }
    setSourceBusy(true);
    setSourceError('');
    const type = /(?:youtube\.com|youtu\.be)/i.test(value) ? 'youtube' : 'url';
    const result = await watchManager.changeSource({ type, url: value });
    setSourceBusy(false);
    if (result?.ok === false) {
      setSourceError(result.error || 'Не удалось сменить ссылку');
      return;
    }
    setSourceOpen(false);
  };

  const inviteToWatch = async () => {
    const channelName = roomChannel?.name ? `#${roomChannel.name}` : 'канале';
    const serverName = roomServer?.name ? ` на сервере «${roomServer.name}»` : '';
    const code = roomServer?.inviteCode ? ` Код приглашения: ${roomServer.inviteCode}` : '';
    const text = `Присоединяйтесь к Watch Party «${room?.title || 'Смотрим вместе'}» в ${channelName}${serverName}!${code}`;
    const ok = await copyText(text);
    toast(ok ? 'Приглашение скопировано' : 'Не удалось скопировать приглашение', ok ? 'success' : 'error');
  };

  const applyVolume = (nextVolume, nextMuted) => {
    if (isWebPage) return;
    if (useYouTubeWebview) {
      webviewExecute(`(() => {
        const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (video) {
          video.volume = ${Number(nextVolume)};
          video.muted = ${nextMuted ? 'true' : 'false'};
        }
        return true;
      })()`);
      return;
    }
    if (room?.source?.type === 'youtube') {
      try {
        playerRef.current?.setVolume?.(Math.round(nextVolume * 100));
        if (nextMuted) playerRef.current?.mute?.();
        else playerRef.current?.unMute?.();
      } catch {}
    } else if (isDirectVideo && videoRef.current) {
      videoRef.current.volume = nextVolume;
      videoRef.current.muted = nextMuted;
    }
  };

  const changeVolume = (event) => {
    const value = clamp(Number(event.target.value) || 0, 0, 1);
    setVolume(value);
    setMuted(value === 0);
    applyVolume(value, value === 0);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    applyVolume(volume, next);
  };

  const progressValue = seekValue ?? currentTime;
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const mediaReady = useWebview
    ? isWebPage
      ? webviewPageReady
      : playerReady
    : playerReady;

  if (!room) {
    return (
      <Modal onClose={leave} className="watch-modal" overlayClassName="watch-overlay" closeOnOverlay={false} closeOnEscape={false}>
        <div className="watch-loading">
          {error ? <AlertCircle size={34} /> : <Loader2 size={34} className="spin" />}
          <strong>{error || 'Подключаемся к Watch Party…'}</strong>
          <button type="button" className="btn btn-ghost" onClick={leave}>Закрыть</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      onClose={leave}
      className={`watch-modal${fullscreen ? ' watch-fullscreen' : ''}`}
      overlayClassName="watch-overlay"
      closeOnOverlay={false}
      closeOnEscape={false}
    >
      <header className="watch-header">
        <div className="watch-header-title">
          <span className="watch-header-icon"><Tv size={20} /></span>
          <div>
            <strong>{room.title}</strong>
            <span>
              <Crown size={12} /> {room.host?.displayName || 'Хост'}
              {' · '}
              {participants.length} участн.
              {live ? ' · в эфире' : ' · хост отключён'}
            </span>
          </div>
        </div>
        <div className="watch-header-actions">
          <button
            type="button"
            className="btn btn-ghost btn-small watch-invite"
            onClick={inviteToWatch}
            title="Скопировать приглашение в Watch Party"
          >
            <UserPlus size={15} /> <span>Пригласить</span>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={toggleSourceEditor}
            title="Сменить ссылку"
            aria-expanded={sourceOpen}
          >
            <Link2 size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              setEmojiOpen(false);
              setShowChat((value) => !value);
            }}
            title={showChat ? 'Скрыть чат' : 'Показать чат'}
          >
            <MessageSquare size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setFullscreen((value) => !value)}
            title={fullscreen ? 'Свернуть' : 'На весь экран'}
          >
            {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button type="button" className="icon-btn" onClick={leave} title="Закрыть">
            <X size={19} />
          </button>
        </div>
      </header>

      {sourceOpen ? (
        <form className="watch-source-form" onSubmit={submitSource}>
          <Link2 size={16} />
          <input
            autoFocus
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=… или любая ссылка"
            maxLength={2048}
          />
          <button type="submit" className="btn btn-primary btn-small" disabled={sourceBusy}>
            {sourceBusy ? 'Меняем…' : 'Сменить'}
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setSourceOpen(false)}>
            Отмена
          </button>
          {sourceError ? <span className="watch-source-error">{sourceError}</span> : null}
        </form>
      ) : null}

      <div className="watch-body">
        <div className="watch-stage">
          <div className="watch-player">
            <div className="watch-player-media" ref={mediaRef}>
              {isDirectVideo ? (
                <video ref={videoRef} src={room.source.url} playsInline preload="auto" />
              ) : null}
            </div>
            {useWebview ? (
              <webview
                ref={webviewRef}
                className="watch-webview"
                src={webviewSrc}
                useragent={webviewUserAgent}
                partition="persist:carnage-watch"
                webpreferences="contextIsolation=yes, nodeIntegration=no, sandbox=yes"
              />
            ) : null}
            {useYouTubeWebview ? <div className="watch-webview-shield" /> : null}
            {!mediaReady && !playerError && !webviewAd && !browserOnly ? (
              <div className="watch-player-overlay">
                <Loader2 size={30} className="spin" />
                <span>{isWebPage ? 'Открываем страницу…' : 'Загружаем видео…'}</span>
              </div>
            ) : null}
            {browserOnly ? (
              <div className="watch-player-overlay watch-player-error">
                <Tv size={30} />
                <strong>Встроенный браузер доступен в приложении Carnage Party</strong>
                <span>В веб-версии сайты нельзя открыть внутри окна. Запустите приложение или откройте ссылку в браузере.</span>
                <button type="button" className="btn btn-primary btn-small" onClick={() => openExternal(room.source.url)}>
                  <ExternalLink size={14} /> Открыть ссылку
                </button>
              </div>
            ) : null}
            {playerError ? (
              <div className="watch-player-overlay watch-player-error">
                <AlertCircle size={30} />
                <strong>{playerError}</strong>
                <span>Ссылку может сменить любой участник комнаты.</span>
                <button type="button" className="btn btn-primary btn-small" onClick={() => openExternal(room.source.url)}>
                  <ExternalLink size={14} /> {room.source?.type === 'youtube' ? 'Открыть на YouTube' : 'Открыть ссылку'}
                </button>
              </div>
            ) : null}
            {webviewAd ? (
              <div className="watch-player-overlay watch-ad">
                <Loader2 size={30} className="spin" />
                <strong>Реклама YouTube</strong>
                <span>Видео продолжится после рекламы.</span>
              </div>
            ) : null}
            {needsGesture && !playerError && !webviewAd && !isWebPage ? (
              <button type="button" className="watch-gesture" onClick={() => applyState(state, true)}>
                <Play size={24} /> Включить видео
              </button>
            ) : null}
            {ended ? (
              <div className="watch-player-overlay watch-ended">
                <Tv size={32} />
                <strong>Комната завершена</strong>
                <button type="button" className="btn btn-primary" onClick={leave}>Закрыть</button>
              </div>
            ) : null}
          </div>

          {isWebPage ? (
            <div className="watch-controls watch-browser-controls">
              <span className="watch-browser-hint">
                <ExternalLink size={15} /> {canWebview ? 'Встроенный браузер' : 'Веб-страница'}
              </span>
              {canWebview ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => webviewExecute('location.reload()')}
                >
                  <RefreshCw size={14} /> Обновить
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => openExternal(room.source.url)}
              >
                <ExternalLink size={14} /> В браузере
              </button>
              {isHost ? (
                <button type="button" className="btn btn-ghost btn-small watch-end" onClick={endRoom}>
                  Завершить
                </button>
              ) : null}
            </div>
          ) : (
            <div className="watch-controls">
              <button
                type="button"
                className="watch-play"
                onClick={togglePlay}
                disabled={!isHost || !mediaReady || ended}
                title={isHost ? (playing ? 'Пауза' : 'Играть') : 'Управляет хост'}
              >
                {playing ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <span className="watch-time">{formatWatchTime(progressValue)}</span>
              <input
                type="range"
                className="watch-seek"
                min="0"
                max={Math.max(1, total)}
                step="0.1"
                value={Math.min(progressValue, Math.max(1, total))}
                onChange={(event) => {
                  if (!isHost) return;
                  setSeekValue(Number(event.target.value));
                }}
                onPointerUp={commitSeek}
                onKeyUp={commitSeek}
                disabled={!isHost || !mediaReady || ended}
                aria-label="Позиция видео"
              />
              <span className="watch-time">{formatWatchTime(total)}</span>
              <button
                type="button"
                className="icon-btn watch-volume-btn"
                onClick={toggleMute}
                title={muted ? 'Включить звук' : 'Выключить звук'}
              >
                {muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
              </button>
              <input
                type="range"
                className="watch-volume"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                onChange={changeVolume}
                aria-label="Громкость"
              />
              {!isHost ? (
                <button type="button" className="btn btn-ghost btn-small watch-resync" onClick={resync}>
                  <RotateCcw size={14} /> Синхронизировать
                </button>
              ) : null}
              {isHost ? (
                <button type="button" className="btn btn-ghost btn-small watch-end" onClick={endRoom}>
                  Завершить
                </button>
              ) : null}
            </div>
          )}

          {!live && !ended ? (
            <div className="watch-host-offline">
              <AlertCircle size={15} /> Хост отключился — видео на паузе. Ждём возвращения.
            </div>
          ) : null}
        </div>

        {showChat ? (
          <aside className="watch-side">
            <div className="watch-side-head">
              <span><Users size={15} /> Участники</span>
              <span>{participants.length}</span>
            </div>
            <div className="watch-participants">
              {participants.map((participant) => (
                <div className="watch-participant" key={participant.userId}>
                  <Avatar user={participant.user} size={26} />
                  <span>
                    {participant.user?.displayName || 'Участник'}
                    {participant.userId === self?.userId ? ' (вы)' : ''}
                  </span>
                  {participant.userId === room.hostId ? <Crown size={13} /> : null}
                  {participant.buffering ? <Loader2 size={12} className="spin" /> : null}
                </div>
              ))}
            </div>

            <div className="watch-side-head watch-chat-head">
              <span><MessageSquare size={15} /> Чат комнаты</span>
            </div>
            <div className="watch-chat">
              {chat.length ? chat.map((message) => (
                <div className="watch-chat-message" key={message.id}>
                  <Avatar user={message.user} size={24} />
                  <div className="watch-chat-body">
                    <div className="watch-chat-meta">
                      <strong>{message.user?.displayName || 'Участник'}</strong>
                      <span>{formatTime(message.at)}</span>
                    </div>
                    <p>{message.text}</p>
                  </div>
                </div>
              )) : (
                <div className="watch-chat-empty">Пока тихо. Напишите первым!</div>
              )}
              <div ref={chatEndRef} />
            </div>
            <form className="watch-chat-form" onSubmit={sendChat}>
              <button
                type="button"
                className="watch-chat-emoji-btn"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={toggleEmoji}
                aria-label="Смайлы"
                title="Смайлы"
                aria-expanded={emojiOpen}
              >
                <Smile size={16} />
              </button>
              <input
                ref={chatInputRef}
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                placeholder={ended ? 'Комната завершена' : 'Сообщение…'}
                maxLength={500}
                disabled={ended}
              />
              <button type="submit" className="icon-btn" disabled={!chatText.trim() || ended} title="Отправить">
                <Send size={16} />
              </button>
            </form>
            {emojiOpen && emojiBox && typeof document !== 'undefined'
              ? createPortal(
                  <div
                    className="watch-emoji-pop"
                    style={{
                      left: `${emojiBox.left}px`,
                      top: `${emojiBox.top}px`,
                      width: `${emojiBox.width}px`,
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <EmojiPicker
                      className="watch-emoji-picker"
                      onPick={insertChatEmoji}
                      onClose={() => setEmojiOpen(false)}
                    />
                  </div>,
                  document.body
                )
              : null}
          </aside>
        ) : null}
      </div>
    </Modal>
  );
}
