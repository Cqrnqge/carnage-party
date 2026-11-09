import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  Copy,
  ExternalLink,
  Eye,
  Link2,
  Loader2,
  Maximize2,
  Monitor,
  MonitorPlay,
  Move,
  Play,
  Radio,
  RotateCw,
  Square,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import { useApp } from '../../store';
import { streamBroadcaster, watchStream } from '../../streaming';
import { cx } from '../../utils';
import {
  copyText,
  formatElapsed,
  sourceLabel,
  viewersLabel,
} from '../../stream-utils';
import Avatar from '../ui/Avatar';

const STATUS_MESSAGES = {
  connecting: {
    title: 'Подключаемся к трансляции…',
    text: 'Обычно это занимает несколько секунд.',
    loading: true,
  },
  waiting: {
    title: 'Ждём стримера…',
    text: 'Эфир скоро продолжится — стример переподключается.',
    loading: true,
  },
  reconnecting: {
    title: 'Переподключение…',
    text: 'Восстанавливаем соединение с эфиром.',
    loading: true,
  },
  failed: {
    title: 'Не удалось соединиться',
    text: 'Проверьте интернет и попробуйте ещё раз.',
    loading: false,
  },
  error: {
    title: 'Трансляция недоступна',
    text: 'Не удалось получить видеопоток.',
    loading: false,
  },
  ended: {
    title: 'Трансляция завершена',
    text: 'Стример остановил эфир.',
    loading: false,
  },
};

function useElapsed(value) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return formatElapsed(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function openPublicLink(url) {
  if (!url) return;
  try {
    if (window.desktop?.openExternal) {
      window.desktop.openExternal(url);
      return;
    }
    if (window.CarnageAndroid?.openExternal) {
      window.CarnageAndroid.openExternal(url);
      return;
    }
  } catch {}
  window.open(url, '_blank', 'noopener');
}

function MissingStream({ text }) {
  const setActive = useApp((state) => state.setActive);
  return (
    <div className="stream-view stream-view-missing">
      <div className="streaming-empty">
        <div className="streaming-empty-icon small">
          <WifiOff size={34} />
        </div>
        <h3>Трансляция недоступна</h3>
        <p>{text || 'Похоже, эфир уже закончился или ссылка устарела.'}</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setActive({ type: 'streaming' })}
        >
          <ArrowLeft size={16} /> К трансляциям
        </button>
      </div>
    </div>
  );
}

export default function StreamView({ streamId }) {
  const streams = useApp((state) => state.streams);
  const myStream = useApp((state) => state.myStream);
  const user = useApp((state) => state.user);
  const setActive = useApp((state) => state.setActive);
  const openModal = useApp((state) => state.openModal);
  const toast = useApp((state) => state.toast);

  const mine = Boolean(myStream && myStream.id === streamId);
  const stream = mine
    ? myStream
    : (streams || []).find((item) => item.id === streamId) || null;

  const videoRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const stageRef = useRef(null);
  const frameRef = useRef(null);
  const pipDragRef = useRef(null);
  const [streamState, setStreamState] = useState('connecting');
  const [error, setError] = useState('');
  const [liveViewers, setLiveViewers] = useState(null);
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [pipLayout, setPipLayout] = useState(() => streamBroadcaster.getPipLayout());
  const [cameraAspect, setCameraAspect] = useState(streamBroadcaster.cameraAspect || 16 / 9);
  const [frameBox, setFrameBox] = useState({ left: 0, top: 0, width: 100, height: 100 });
  const elapsed = useElapsed(stream?.createdAt);
  const pipEditor = mine && stream?.source === 'both';

  useEffect(() => {
    setStreamState('connecting');
    setError('');
    setBlocked(false);
    setMuted(false);
    setLiveViewers(null);
    setCopied(false);
  }, [streamId]);

  // Локальный предпросмотр собственного эфира. Для режима «экран + камера»
  // основной холст показывает экран, а камера рендерится отдельным окном,
  // которое можно двигать и растягивать.
  useEffect(() => {
    if (!mine) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    const local =
      (stream?.source === 'both' && streamBroadcaster.screenStream) ||
      streamBroadcaster.localStream;
    video.srcObject = local || null;
    video.muted = true;
    video.classList.toggle('mirror', stream?.source === 'camera');
    if (local) video.play().catch(() => {});
    return () => {
      try {
        video.pause();
        video.srcObject = null;
      } catch {}
    };
  }, [mine, streamId, stream?.source]);

  useEffect(() => {
    if (!pipEditor) return undefined;
    const video = cameraVideoRef.current;
    if (!video) return undefined;
    const camera = streamBroadcaster.cameraStream;
    video.srcObject = camera || null;
    video.muted = true;
    if (camera) video.play().catch(() => {});
    return () => {
      try {
        video.pause();
        video.srcObject = null;
      } catch {}
    };
  }, [pipEditor]);

  // Положение области видео внутри сцены (object-fit: contain) и актуальные
  // пропорции потоков — чтобы окно камеры совпадало с тем, что видят зрители.
  useEffect(() => {
    if (!pipEditor) return undefined;
    const stage = stageRef.current;
    if (!stage) return undefined;

    const update = () => {
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const screenAspect = streamBroadcaster.screenAspect || 16 / 9;
      let width = rect.width;
      let height = width / screenAspect;
      if (height > rect.height) {
        height = rect.height;
        width = height * screenAspect;
      }
      const nextFrame = {
        left: ((rect.width - width) / 2 / rect.width) * 100,
        top: ((rect.height - height) / 2 / rect.height) * 100,
        width: (width / rect.width) * 100,
        height: (height / rect.height) * 100,
      };
      setFrameBox((prev) =>
        Math.abs(prev.left - nextFrame.left) < 0.05 &&
        Math.abs(prev.top - nextFrame.top) < 0.05 &&
        Math.abs(prev.width - nextFrame.width) < 0.05 &&
        Math.abs(prev.height - nextFrame.height) < 0.05
          ? prev
          : nextFrame
      );
      setCameraAspect((prev) => {
        const next = streamBroadcaster.cameraAspect || 16 / 9;
        return Math.abs(prev - next) < 0.0001 ? prev : next;
      });
    };

    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(stage);
    window.addEventListener('resize', update);
    const timer = setInterval(update, 1000);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      clearInterval(timer);
    };
  }, [pipEditor]);

  const beginPipDrag = (event, mode) => {
    if (!pipEditor) return;
    event.preventDefault();
    event.stopPropagation();
    const frame = frameRef.current?.getBoundingClientRect();
    if (!frame?.width || !frame?.height) return;
    const start = { ...pipLayout };
    pipDragRef.current = { mode, start };

    const move = (moveEvent) => {
      const drag = pipDragRef.current;
      if (!drag) return;
      const dx = (moveEvent.clientX - event.clientX) / frame.width;
      const dy = (moveEvent.clientY - event.clientY) / frame.height;
      const aspect = cameraAspect || 16 / 9;
      let next = { ...drag.start };
      if (drag.mode === 'resize') {
        const maxWidthByRight = 0.995 - drag.start.x;
        const maxWidthByBottom =
          ((0.995 - drag.start.y) * frame.height * aspect) / frame.width;
        next.w = clamp(
          drag.start.w + dx,
          0.12,
          Math.max(0.12, Math.min(0.6, maxWidthByRight, maxWidthByBottom))
        );
      } else {
        const heightNorm = (drag.start.w * frame.width / aspect) / frame.height;
        next.x = clamp(drag.start.x + dx, 0.005, 0.995 - drag.start.w);
        next.y = clamp(drag.start.y + dy, 0.005, 0.995 - heightNorm);
      }
      streamBroadcaster.setPipLayout(next);
      setPipLayout(next);
    };

    const finish = () => {
      pipDragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      streamBroadcaster.setPipLayout(streamBroadcaster.getPipLayout(), true);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  // Подключение зрителя к WebRTC-комнате.
  useEffect(() => {
    if (mine) return undefined;
    let watcher = null;

    const startPlayback = (remote) => {
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = remote;
      video.muted = false;
      video.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
    };

    watcher = watchStream(streamId, {
      onState: (value) => setStreamState(value),
      onStream: (remote) => startPlayback(remote),
      onViewers: (value) => setLiveViewers(Number(value) || 0),
      onInfo: (info) => {
        if (info && typeof info.viewers === 'number') setLiveViewers(info.viewers);
      },
      onEnded: () => setStreamState('ended'),
      onError: (message) => {
        setError(message || '');
        setStreamState('error');
      },
    });

    return () => {
      watcher?.close();
      const video = videoRef.current;
      if (video) {
        try {
          video.pause();
          video.srcObject = null;
        } catch {}
      }
    };
  }, [mine, streamId, retryKey]);

  const resumePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setBlocked(false);
    } catch {
      try {
        video.muted = true;
        setMuted(true);
        await video.play();
        setBlocked(false);
      } catch {}
    }
  }, []);

  const toggleMute = () => {
    const video = videoRef.current;
    const next = !muted;
    setMuted(next);
    if (video) video.muted = next;
    if (!next) {
      video?.play().catch(() => setBlocked(true));
    }
  };

  const toggleFullscreen = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      stage.requestFullscreen?.().catch(() => {});
    }
  };

  const copyPublicLink = async () => {
    if (!stream?.url) return;
    const ok = await copyText(stream.url);
    if (ok) {
      setCopied(true);
      toast('Ссылка на трансляцию скопирована', 'success');
      setTimeout(() => setCopied(false), 2200);
    } else {
      toast('Не удалось скопировать ссылку', 'error');
    }
  };

  const stopStream = () => {
    openModal('confirm', {
      title: 'Завершить трансляцию?',
      text: 'Зрители отключатся, а ссылка на эфир перестанет работать.',
      confirmText: 'Остановить эфир',
      danger: true,
      onConfirm: async () => {
        await streamBroadcaster.stop({ silent: true });
        setActive({ type: 'streaming' });
        toast('Трансляция завершена', 'info');
      },
    });
  };

  if (!stream) {
    return <MissingStream text="Похоже, стример уже завершил эфир." />;
  }

  const owner = stream.owner || user || {};
  const viewers = liveViewers ?? (Number(stream.viewers) || 0);
  const hostOffline = !mine && stream.live === false;
  const localMissing = mine && !streamBroadcaster.localStream;
  const effectiveState = mine ? (localMissing ? 'error' : 'playing') : hostOffline ? 'waiting' : streamState;
  const status = STATUS_MESSAGES[effectiveState] || null;
  const showStatus = !blocked && (
    localMissing || (status && effectiveState !== 'playing' && effectiveState !== 'connected')
  );
  const statusTitle = localMissing ? 'Поток недоступен' : status?.title;
  const statusText = localMissing
    ? 'Не удалось получить локальный видеопоток. Запустите трансляцию заново.'
    : effectiveState === 'error' && error
      ? error
      : status?.text;
  const failed = effectiveState === 'failed' || effectiveState === 'error' || localMissing;

  return (
    <div className="stream-view">
      <header className="stream-view-top">
        <button
          type="button"
          className="icon-btn stream-back"
          onClick={() => setActive({ type: 'streaming' })}
          aria-label="К списку трансляций"
          data-tooltip="К трансляциям"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="stream-view-heading">
          <h1>{stream.title || 'Трансляция'}</h1>
          <div className="stream-view-sub">
            <Avatar user={owner} size={22} />
            <span className="stream-view-owner">{owner.displayName || owner.username || 'Стример'}</span>
            <span className={cx('stream-view-state', effectiveState)}>
              <span className="stream-view-state-dot" />
              {hostOffline ? 'Переподключение' : effectiveState === 'playing' || effectiveState === 'connected' ? 'В эфире' : 'Подключение'}
            </span>
            <span className="stream-view-sep" />
            <span>{sourceLabel(stream.source)}</span>
            <span className="stream-view-sep" />
            <span>{elapsed}</span>
          </div>
        </div>
        <div className="stream-view-actions">
          {stream.url ? (
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={copyPublicLink}
              title="Скопировать публичную ссылку"
            >
              <Copy size={15} /> {copied ? 'Скопировано' : 'Ссылка'}
            </button>
          ) : null}
          {stream.url ? (
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => openPublicLink(stream.url)}
              title="Открыть в браузере"
            >
              <ExternalLink size={15} /> В браузере
            </button>
          ) : null}
          {mine ? (
            <button type="button" className="btn btn-danger btn-small" onClick={stopStream}>
              <Square size={13} fill="currentColor" /> Остановить
            </button>
          ) : null}
        </div>
      </header>

      <div className="stream-stage-wrap">
        <div className="stream-stage" ref={stageRef}>
          <video
            ref={videoRef}
            className={cx('stream-stage-video', mine && stream?.source === 'camera' && 'mirror')}
            autoPlay
            playsInline
            muted={mine || muted}
          />

          {pipEditor ? (
            <div
              className="stream-stage-frame"
              ref={frameRef}
              style={{
                left: `${frameBox.left}%`,
                top: `${frameBox.top}%`,
                width: `${frameBox.width}%`,
                height: `${frameBox.height}%`,
              }}
            >
              <div
                className="stream-stage-pip"
                style={{
                  left: `${pipLayout.x * 100}%`,
                  top: `${pipLayout.y * 100}%`,
                  width: `${pipLayout.w * 100}%`,
                  aspectRatio: String(cameraAspect || 16 / 9),
                }}
                onPointerDown={(event) => beginPipDrag(event, 'move')}
              >
                <video ref={cameraVideoRef} autoPlay playsInline muted />
                <span className="stream-pip-move">
                  <Move size={14} />
                </span>
                <button
                  type="button"
                  className="stream-pip-resize"
                  aria-label="Изменить размер камеры"
                  title="Потяните, чтобы изменить размер"
                  onPointerDown={(event) => beginPipDrag(event, 'resize')}
                >
                  <Maximize2 size={13} />
                </button>
              </div>
            </div>
          ) : null}

          {pipEditor && !showStatus && !blocked ? (
            <span className="stream-pip-hint">
              <Move size={13} /> Перетащите камеру · потяните за угол
            </span>
          ) : null}

          {!showStatus && !blocked ? (
            <div className="stream-stage-gradient" />
          ) : null}

          {showStatus ? (
            <div className={cx('stream-stage-overlay', failed && 'failed')}>
              {localMissing || failed || effectiveState === 'ended' ? (
                <span className="stream-overlay-icon">
                  {effectiveState === 'ended' ? <Radio size={34} /> : <AlertCircle size={34} />}
                </span>
              ) : (
                <Loader2 size={36} className="spin stream-overlay-spinner" />
              )}
              <h2>{statusTitle}</h2>
              <p>{statusText}</p>
              {failed && !localMissing ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => {
                    setRetryKey((value) => value + 1);
                    setStreamState('connecting');
                  }}
                >
                  <RotateCw size={15} /> Попробовать снова
                </button>
              ) : null}
              {localMissing ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => setActive({ type: 'streaming' })}
                >
                  <ArrowLeft size={15} /> К трансляциям
                </button>
              ) : null}
            </div>
          ) : null}

          {blocked ? (
            <button type="button" className="stream-unmute-overlay" onClick={resumePlayback}>
              <span className="stream-unmute-icon">
                <Play size={30} fill="currentColor" />
              </span>
              <strong>Нажмите, чтобы смотреть</strong>
              <span>Браузер заблокировал автозапуск видео</span>
            </button>
          ) : null}

          <div className="stream-stage-bottom">
            <span className="stream-live-pill">
              <span className="live-dot" /> LIVE
            </span>
            <span className="stream-stage-viewers">
              <Eye size={14} /> {viewersLabel(viewers)}
            </span>
            <div className="stream-stage-spacer" />
            {!mine ? (
              <button
                type="button"
                className="stream-ctrl"
                onClick={toggleMute}
                title={muted ? 'Включить звук' : 'Выключить звук'}
                aria-label={muted ? 'Включить звук' : 'Выключить звук'}
              >
                {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
            ) : (
              <span className="stream-preview-note">Предпросмотр без звука</span>
            )}
            <button
              type="button"
              className="stream-ctrl"
              onClick={toggleFullscreen}
              title="На весь экран"
              aria-label="На весь экран"
            >
              <Maximize2 size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="stream-details">
        <div className="stream-details-card">
          <Avatar user={owner} size={48} />
          <div className="stream-details-text">
            <strong>{owner.displayName || owner.username || 'Стример'}</strong>
            <span>
              {mine ? 'Это ваш эфир' : 'Стримит прямо сейчас'}
              <span className="stream-details-dot" />
              {stream.mode === 'link' ? 'Публичная ссылка' : 'Только в программе'}
            </span>
          </div>
          <div className="stream-details-stats">
            <span><Eye size={14} /> {viewersLabel(viewers)}</span>
            <span>
              {stream.source === 'both' ? (
                <MonitorPlay size={14} />
              ) : stream.source === 'screen' ? (
                <Monitor size={14} />
              ) : (
                <Camera size={14} />
              )}
              {sourceLabel(stream.source)}
            </span>
          </div>
        </div>

        {stream.url ? (
          <div className="stream-share-card">
            <div className="stream-share-head">
              <span className="stream-share-icon"><Link2 size={18} /></span>
              <div>
                <strong>Публичная ссылка</strong>
                <span>Отправьте друзьям — эфир откроется в любом браузере без установки Carnage Party.</span>
              </div>
            </div>
            <div className="stream-link-row">
              <input readOnly value={stream.url} onFocus={(event) => event.target.select()} />
              <button type="button" className="btn btn-primary btn-small" onClick={copyPublicLink}>
                <Copy size={14} /> {copied ? 'Готово' : 'Копировать'}
              </button>
            </div>
          </div>
        ) : (
          <div className="stream-share-card muted">
            <div className="stream-share-head">
              <span className="stream-share-icon"><Monitor size={18} /></span>
              <div>
                <strong>Трансляция в программе</strong>
                <span>Этот эфир смотрят внутри Carnage Party. При запуске можно было выбрать внешнюю ссылку.</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
