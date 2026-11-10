import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  FileAudio,
  FolderOpen,
  Link2,
  Loader2,
  Music2,
  Pause,
  Play,
  Radio,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import Hls from 'hls.js';
import { api, assetUrl } from '../../api';
import { useApp, selectChannel } from '../../store';
import { loadYouTubeApi } from '../../watch';
import { cx } from '../../utils';

function targetPosition(session, receivedAt, now = Date.now()) {
  if (!session) return 0;
  const base = Math.max(0, Number(session.position) || 0);
  if (session.source?.live) return 0;
  if (!session.playing) return base;
  const updatedAt = Number(session.updatedAt) || now;
  const serverNow = Number(session.serverNow) || updatedAt;
  const serverPart = Math.max(0, serverNow - updatedAt) / 1000;
  const localPart = Math.max(0, now - receivedAt) / 1000;
  return base + serverPart + localPart;
}

function formatTime(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const PLAYER_POSITION_KEY = 'carnage_music_player_position';

function clampPlayerPosition(x, y, element) {
  const width = element?.offsetWidth || 380;
  const height = element?.offsetHeight || 82;
  return {
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - width - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - height - 8)),
  };
}

function loadPlayerPosition() {
  try {
    const raw = localStorage.getItem(PLAYER_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {}
  return null;
}

export default function MusicPlayer() {
  const channelId = useApp((state) => state.voice.channelId);
  const joined = useApp((state) => state.voice.joined);
  const deafened = useApp((state) => state.voice.deafened);
  const music = useApp((state) => state.music);
  const user = useApp((state) => state.user);
  const servers = useApp((state) => state.servers);
  const channels = useApp((state) => state.channels);
  const dms = useApp((state) => state.dms);
  const volume = useApp((state) => state.settings.musicVolume ?? 70);
  const localMuted = useApp((state) => state.settings.musicMuted);
  const updateSettings = useApp((state) => state.updateSettings);
  const toast = useApp((state) => state.toast);

  const session = channelId ? music[channelId] : null;
  const channel = channelId ? selectChannel({ channels, dms }, channelId) : null;
  const server = channel?.serverId ? servers.find((item) => item.id === channel.serverId) : null;
  // Музыкой управляет любой участник канала: пауза, продолжение и стоп
  // применяются ко всем, а позиция и громкость плеера остаются локальными.
  const canManage = Boolean(
    session &&
      user &&
      (server
        ? (server.members || []).some((member) => member.id === user.id)
        : session.startedBy === user.id)
  );

  const audioRef = useRef(null);
  const audioSrcRef = useRef('');
  const ytHostRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const hlsRef = useRef(null);
  const playerRef = useRef(null);
  const dragRef = useRef(null);
  const modeRef = useRef('');
  const timingRef = useRef({ key: '', receivedAt: Date.now() });
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [duration, setDuration] = useState(0);
  const [tick, setTick] = useState(0);
  const [dragPos, setDragPos] = useState(loadPlayerPosition);
  const dragPosRef = useRef(dragPos);
  const [dragging, setDragging] = useState(false);
  const [scrub, setScrub] = useState(null);
  const [pendingSeek, setPendingSeek] = useState(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const sessionKey = session
    ? `${session.botId}|${session.source?.url || ''}|${session.playing}|${session.position}|${session.updatedAt}`
    : '';

  useEffect(() => {
    if (!session) {
      timingRef.current = { key: '', receivedAt: Date.now() };
      return;
    }
    if (timingRef.current.key !== sessionKey) {
      timingRef.current = { key: sessionKey, receivedAt: Date.now() };
    }
  }, [sessionKey, session]);

  const cleanupPlayback = () => {
    try {
      ytPlayerRef.current?.destroy?.();
    } catch {}
    ytPlayerRef.current = null;
    if (ytHostRef.current) ytHostRef.current.innerHTML = '';
    try {
      hlsRef.current?.destroy?.();
    } catch {}
    hlsRef.current = null;
    const audio = audioRef.current;
    audioSrcRef.current = '';
    if (audio) {
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch {}
    }
  };

  const applyTarget = (force = false) => {
    if (!session || session.source?.live) return;
    const target = targetPosition(session, timingRef.current.receivedAt);
    const player = ytPlayerRef.current;
    const audio = audioRef.current;
    if (modeRef.current === 'youtube' && player?.seekTo && player.getCurrentTime) {
      const current = Number(player.getCurrentTime()) || 0;
      if (force || Math.abs(current - target) > 2.5) {
        try {
          player.seekTo(target, true);
        } catch {}
      }
      return;
    }
    if (audio && audio.readyState >= 1) {
      const current = Number(audio.currentTime) || 0;
      if (force || Math.abs(current - target) > 2.5) {
        try {
          audio.currentTime = target;
        } catch {}
      }
    }
  };

  const attemptPlay = (retry = false) => {
    const player = ytPlayerRef.current;
    // В режиме IFrame отдельный <audio> пуст: его play() всегда завершается
    // ошибкой и раньше возвращал кнопку «Включить звук» обратно.
    if (modeRef.current === 'youtube' || player?.playVideo) {
      if (player?.playVideo) {
        try {
          const mute = localMuted || deafened;
          player.setVolume?.(volume);
          if (mute) player.mute?.();
          else player.unMute?.();
          player.playVideo();
          setBlocked(false);
          setError('');
        } catch {}
      }
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    // После ошибки формата браузер не делает новый запрос, пока элемент не
    // перезагружен. Пользовательская кнопка должна повторять загрузку потока.
    if (retry && modeRef.current === 'audio' && audioSrcRef.current && (audio.error || !audio.src)) {
      try {
        audio.src = audioSrcRef.current;
        audio.load();
      } catch {}
    }
    audio
      .play()
      .then(() => {
        setBlocked(false);
        setError('');
      })
      .catch((err) => {
        setBlocked(true);
        if (err?.name !== 'NotAllowedError') {
          setError(
            session?.source?.type === 'youtube'
              ? 'Не удалось воспроизвести аудиопоток YouTube'
              : 'Не удалось воспроизвести аудио'
          );
        }
      });
  };

  // Загрузка источника при смене трека.
  useEffect(() => {
    let cancelled = false;
    cleanupPlayback();
    setBlocked(false);
    setError('');
    setDuration(0);
    modeRef.current = '';
    if (!joined || !session) return undefined;

    const source = session.source || {};
    setDuration(Math.max(0, Number(source.duration) || 0));

    // YouTube без серверного аудиопотока — резервный вариант через IFrame.
    if (source.type === 'youtube' && !source.streamUrl) {
      modeRef.current = 'youtube';
      loadYouTubeApi()
        .then((YT) => {
          if (cancelled || !ytHostRef.current) return;
          const holder = document.createElement('div');
          ytHostRef.current.innerHTML = '';
          ytHostRef.current.appendChild(holder);
          const player = new YT.Player(holder, {
            videoId: source.videoId,
            playerVars: {
              autoplay: 1,
              controls: 0,
              disablekb: 1,
              modestbranding: 1,
              playsinline: 1,
              rel: 0,
            },
            events: {
              onReady: (event) => {
                if (cancelled) return;
                ytPlayerRef.current = event.target;
                event.target.setVolume(volume);
                if (localMuted || deafened) event.target.mute();
                applyTarget(true);
                if (session.playing) {
                  event.target.playVideo();
                  setTimeout(() => {
                    if (cancelled || !session.playing) return;
                    try {
                      if (event.target.getPlayerState?.() !== YT.PlayerState.PLAYING) {
                        setBlocked(true);
                      }
                    } catch {}
                  }, 2500);
                } else {
                  event.target.pauseVideo();
                }
                try {
                  const value = Number(event.target.getDuration?.()) || 0;
                  if (value) setDuration(value);
                } catch {}
              },
              onStateChange: (event) => {
                if (event.data === YT.PlayerState.PLAYING) setBlocked(false);
                if (event.data === YT.PlayerState.ENDED) setBlocked(false);
              },
              onError: () =>
                setError(
                  source.playbackError
                    ? `YouTube не разрешил воспроизведение: ${source.playbackError}`
                    : 'YouTube не разрешил воспроизведение этого видео'
                ),
            },
          });
          ytPlayerRef.current = player;
        })
        .catch(() => {
          if (!cancelled) setError('Не удалось загрузить YouTube');
        });
    } else {
      const audio = audioRef.current;
      if (audio) {
        modeRef.current = 'audio';
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        if (source.type === 'hls' || source.type === 'rutube') {
          modeRef.current = 'hls';
          const hlsSource = assetUrl(source.hlsUrl || source.url);
          if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
            hlsRef.current = hls;
            hls.loadSource(hlsSource);
            hls.attachMedia(audio);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (cancelled) return;
              applyTarget(true);
              if (session.playing) attemptPlay();
            });
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data?.fatal) setError('Не удалось открыть HLS-поток');
            });
          } else {
            audio.src = hlsSource;
            audio.load();
          }
        } else {
          audioSrcRef.current = assetUrl(source.streamUrl || source.url);
          audio.src = audioSrcRef.current;
          audio.load();
        }
        if (session.playing) attemptPlay();
        else audio.pause();
      }
    }

    return () => {
      cancelled = true;
      cleanupPlayback();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, session?.botId, session?.source?.url, session?.source?.streamUrl, session?.source?.hlsUrl]);

  // Синхронизация позиции и состояния паузы.
  useEffect(() => {
    if (!session || !joined) return undefined;
    const sync = () => {
      const player = ytPlayerRef.current;
      const audio = audioRef.current;
      if (modeRef.current === 'youtube' && player?.getPlayerState) {
        const state = player.getPlayerState();
        if (!session.playing) {
          if (state === 1) player.pauseVideo();
          return;
        }
        if (state !== 1) {
          try {
            player.playVideo();
          } catch {}
        }
        applyTarget(false);
        try {
          const value = Number(player.getDuration?.()) || 0;
          if (value) setDuration(value);
        } catch {}
        return;
      }
      if (audio) {
        if (!session.playing) {
          if (!audio.paused) audio.pause();
          return;
        }
        if (audio.paused) attemptPlay();
        applyTarget(false);
        if (Number.isFinite(audio.duration)) setDuration(audio.duration);
      }
    };
    sync();
    const id = setInterval(sync, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionKey, joined]);

  // Тик для прогресс-бара.
  useEffect(() => {
    if (!session) return undefined;
    const id = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [session]);

  // Громкость и локальное отключение звука.
  useEffect(() => {
    const mute = localMuted || deafened;
    const audio = audioRef.current;
    if (audio) {
      audio.volume = mute ? 0 : Math.max(0, Math.min(1, volume / 100));
      audio.muted = mute;
    }
    const player = ytPlayerRef.current;
    if (player?.setVolume) {
      try {
        player.setVolume(volume);
        if (mute) player.mute();
        else player.unMute();
      } catch {}
    }
  }, [volume, localMuted, deafened, session?.source?.url]);

  useEffect(() => () => cleanupPlayback(), []);

  const visible = Boolean(joined && session);
  const position = session ? targetPosition(session, timingRef.current.receivedAt) : 0;
  const isLive = Boolean(session?.source?.live);
  const totalDuration = duration || Math.max(0, Number(session?.source?.duration) || 0);
  const pendingPosition = pendingSeek
    ? pendingSeek.position +
      (session?.playing ? Math.max(0, Date.now() - pendingSeek.at) / 1000 : 0)
    : null;
  const displayPosition =
    scrub !== null ? scrub : pendingPosition !== null ? pendingPosition : position;
  const progress =
    !isLive && totalDuration > 0
      ? Math.min(100, (Math.max(0, displayPosition) / totalDuration) * 100)
      : 0;
  const typeLabel =
    session?.source?.type === 'youtube'
      ? 'YouTube'
      : session?.source?.type === 'rutube'
        ? 'Rutube'
        : session?.source?.type === 'hls'
          ? 'HLS-поток'
          : session?.source?.type === 'radio'
            ? 'Радио'
            : session?.source?.type === 'file'
              ? 'Файл'
              : 'Аудио';

  const control = async (action) => {
    if (!session?.botId || busy) return;
    setBusy(true);
    try {
      await api(`/api/bots/${session.botId}/${action}`, { method: 'POST' });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const commitSeek = async (value) => {
    if (!session?.botId || isLive || !totalDuration) {
      setScrub(null);
      return;
    }
    const target = Math.max(0, Math.min(totalDuration, Number(value) || 0));
    setScrub(null);
    setPendingSeek({ position: target, at: Date.now() });
    const player = ytPlayerRef.current;
    if (modeRef.current === 'youtube' && player?.seekTo) {
      try {
        player.seekTo(target, true);
      } catch {}
    }
    const audio = audioRef.current;
    if (audio && audio.readyState >= 1) {
      try {
        audio.currentTime = target;
      } catch {}
    }
    try {
      await api(`/api/bots/${session.botId}/seek`, {
        method: 'POST',
        body: { position: target },
      });
    } catch (err) {
      setPendingSeek(null);
      toast(err.message, 'error');
    }
  };

  useEffect(() => {
    setPendingSeek(null);
  }, [session?.position, session?.updatedAt]);

  const replaceSource = async (event) => {
    event.preventDefault();
    if (!session?.botId || busy || uploading) return;
    const value = sourceUrl.trim();
    if (!/^https?:\/\//i.test(value)) {
      setSourceError('Вставьте ссылку http(s):// — YouTube, Rutube, HLS или радио');
      return;
    }
    setBusy(true);
    setSourceError('');
    try {
      await api(`/api/bots/${session.botId}/play`, {
        method: 'POST',
        body: { channelId: session.channelId, source: { url: value } },
      });
      setSourceOpen(false);
      setSourceUrl('');
      toast('Источник заменён у всех', 'success');
    } catch (err) {
      setSourceError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadLocalFile = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file || !session?.botId) return;
    if (file.size > 100 * 1024 * 1024) {
      setSourceError('Файл слишком большой (максимум 100 МБ)');
      setSourceOpen(true);
      return;
    }
    setUploading(true);
    setSourceError('');
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      form.append('channelId', session.channelId);
      await api(`/api/bots/${session.botId}/play-file`, { method: 'POST', body: form });
      setSourceOpen(false);
      setSourceUrl('');
      toast('Файл включён для всех участников', 'success');
    } catch (err) {
      setSourceError(err.message);
      setSourceOpen(true);
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    setScrub(null);
    setPendingSeek(null);
  }, [session?.botId, session?.source?.url]);

  useEffect(() => {
    dragPosRef.current = dragPos;
  }, [dragPos]);

  useEffect(() => {
    if (!joined || !session) return undefined;
    const clamp = () => {
      const current = dragPosRef.current;
      const element = playerRef.current;
      if (!current || !element) return;
      const next = clampPlayerPosition(current.x, current.y, element);
      if (next.x !== current.x || next.y !== current.y) setDragPos(next);
    };
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [joined, session, dragPos]);

  const savePlayerPosition = (value) => {
    try {
      if (value) localStorage.setItem(PLAYER_POSITION_KEY, JSON.stringify(value));
      else localStorage.removeItem(PLAYER_POSITION_KEY);
    } catch {}
  };

  const startPlayerDrag = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button, input, a, select, textarea, [data-no-drag]')) return;
    const element = playerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    dragRef.current = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      moved: false,
    };
    try {
      element.setPointerCapture(event.pointerId);
    } catch {}
    setDragging(true);
  };

  const movePlayerDrag = (event) => {
    const drag = dragRef.current;
    const element = playerRef.current;
    if (!drag || !element) return;
    drag.moved = true;
    const next = clampPlayerPosition(event.clientX - drag.dx, event.clientY - drag.dy, element);
    dragPosRef.current = next;
    setDragPos(next);
  };

  const endPlayerDrag = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    try {
      playerRef.current?.releasePointerCapture?.(event.pointerId);
    } catch {}
    if (drag.moved) savePlayerPosition(dragPosRef.current);
  };

  const resetPlayerPosition = (event) => {
    if (event.target.closest('button, input, a, select, textarea, [data-no-drag]')) return;
    dragRef.current = null;
    dragPosRef.current = null;
    setDragPos(null);
    setDragging(false);
    savePlayerPosition(null);
  };

  return (
    <>
      <div ref={ytHostRef} className="music-audio-host" aria-hidden="true" />
      <audio
        ref={audioRef}
        className="music-audio-host"
        preload="auto"
        onPlaying={() => {
          setBlocked(false);
          setError('');
        }}
        onError={() => {
          if (modeRef.current !== 'audio') return;
          setBlocked(true);
          setError(
            session?.source?.type === 'youtube'
              ? 'Не удалось включить YouTube: сервер не отдал аудиопоток'
              : 'Не удалось воспроизвести аудио'
          );
        }}
      />
      {visible ? (
      <div
        ref={playerRef}
        className={cx(
          'music-player',
          blocked && 'music-player-blocked',
          dragging && 'music-player-dragging'
        )}
        style={
          dragPos
            ? { left: `${dragPos.x}px`, top: `${dragPos.y}px`, right: 'auto', bottom: 'auto' }
            : undefined
        }
        onPointerDown={startPlayerDrag}
        onPointerMove={movePlayerDrag}
        onPointerUp={endPlayerDrag}
        onPointerCancel={endPlayerDrag}
        onDoubleClick={resetPlayerPosition}
        title="Перетащите плеер в удобное место. Двойной клик — вернуть в угол"
      >
        <div className="music-art">
          {blocked ? (
            <AlertCircle size={20} />
          ) : session.source?.type === 'file' ? (
            <FileAudio size={20} />
          ) : (
            <Music2 size={20} />
          )}
        </div>
        <div className="music-main">
          <div className="music-title" title={session.source?.title}>
            {session.source?.title || 'Музыка'}
          </div>
          <div className="music-sub">
            <span className="music-bot-name">{session.bot?.displayName || 'Music Bot'}</span>
            <span className="music-sep">·</span>
            <span>{typeLabel}</span>
            {isLive ? <span className="music-live">LIVE</span> : null}
            {blocked ? <span className="music-hint">включите звук</span> : null}
            {error ? <span className="music-error" title={error}>{error}</span> : null}
          </div>
        </div>
        <div className="music-controls" data-no-drag>
          {blocked ? (
            <button type="button" className="btn btn-primary btn-small" onClick={() => attemptPlay(true)}>
              <Volume2 size={15} /> Включить звук
            </button>
          ) : null}
          {canManage ? (
            <>
              <button
                type="button"
                className="icon-btn"
                title={session.playing ? 'Пауза' : 'Продолжить'}
                onClick={() => control(session.playing ? 'pause' : 'resume')}
                disabled={busy}
              >
                {busy ? <Loader2 size={16} className="spin" /> : session.playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button
                type="button"
                className="icon-btn danger"
                title="Остановить и убрать бота"
                onClick={() => control('stop')}
                disabled={busy}
              >
                <Square size={15} />
              </button>
              <button
                type="button"
                className={cx('icon-btn', sourceOpen && 'active')}
                title="Заменить ссылку на трек"
                onClick={() => {
                  setSourceOpen((value) => !value);
                  setSourceError('');
                }}
                disabled={uploading}
              >
                <Link2 size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Включить локальный файл"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 size={16} className="spin" /> : <FolderOpen size={16} />}
              </button>
              <input
                ref={fileRef}
                type="file"
                className="music-source-file-input"
                accept="audio/*,.mp3,.m4a,.m4b,.aac,.ogg,.oga,.opus,.wav,.flac,.weba,.webm,.mp4,.aif,.aiff"
                onChange={uploadLocalFile}
                tabIndex={-1}
                aria-hidden="true"
              />
            </>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            title={localMuted ? 'Включить звук' : 'Выключить звук'}
            onClick={() => updateSettings({ musicMuted: !localMuted })}
          >
            {localMuted || deafened ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={(event) => updateSettings({ musicVolume: Number(event.target.value) })}
            className="music-volume"
            title={`Громкость музыки: ${volume}%`}
          />
          <span className="music-volume-value">{volume}%</span>
          {isLive ? <Radio size={14} className="music-radio-icon" /> : null}
        </div>
        {!isLive && totalDuration > 0 ? (
          <div className="music-progress">
            <span>{formatTime(displayPosition)}</span>
            <input
              type="range"
              className="music-progress-range"
              min="0"
              max={Math.max(1, Math.round(totalDuration))}
              step="1"
              value={Math.round(Math.min(totalDuration, Math.max(0, displayPosition)))}
              style={{ '--music-progress': `${progress}%` }}
              onChange={(event) => setScrub(Number(event.target.value))}
              onPointerUp={(event) => commitSeek(event.currentTarget.value)}
              onKeyUp={(event) => {
                if (
                  event.key.startsWith('Arrow') ||
                  ['Home', 'End', 'PageUp', 'PageDown'].includes(event.key)
                ) {
                  commitSeek(event.currentTarget.value);
                }
              }}
              onBlur={() => {
                if (scrub !== null) commitSeek(scrub);
              }}
              disabled={!canManage}
              aria-label="Перемотка трека"
              title="Перемотать трек"
            />
            <span>{formatTime(totalDuration)}</span>
          </div>
        ) : null}
        {sourceOpen && canManage ? (
          <form className="music-source-panel" data-no-drag onSubmit={replaceSource}>
            <div className="music-source-head">
              <span className="music-source-title"><Link2 size={13} /> Новый источник для всех</span>
              <button
                type="button"
                className="icon-btn"
                title="Закрыть"
                onClick={() => setSourceOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="music-source-row">
              <input
                value={sourceUrl}
                onChange={(event) => {
                  setSourceUrl(event.target.value);
                  if (sourceError) setSourceError('');
                }}
                placeholder="Ссылка YouTube, Rutube, HLS или радио"
                inputMode="url"
                autoFocus
                aria-label="Новая ссылка на трек"
              />
              <button
                type="submit"
                className="btn btn-primary btn-small"
                disabled={busy || uploading || !sourceUrl.trim()}
              >
                {busy ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                Заменить
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />}
                Файл
              </button>
            </div>
            {sourceError ? <div className="music-source-error">{sourceError}</div> : null}
          </form>
        ) : null}
      </div>
      ) : null}
    </>
  );
}
