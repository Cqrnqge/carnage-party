import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  Check,
  Copy,
  ExternalLink,
  Eye,
  Link2,
  Loader2,
  Maximize2,
  MessageCircle,
  Monitor,
  MonitorPlay,
  Move,
  Palette,
  Play,
  Radio,
  RotateCw,
  Send,
  Smile,
  Square,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react';
import { useApp } from '../../store';
import {
  CAMERA_STYLE_OPTIONS,
  CHAT_STYLE_OPTIONS,
  streamBroadcaster,
  watchStream,
} from '../../streaming';
import { cx } from '../../utils';
import {
  moveChatLayout,
  movePipLayout,
  resizeChatLayout,
  resizePipLayout,
} from '../../stream-layout';
import {
  copyText,
  formatElapsed,
  sourceLabel,
  viewersLabel,
} from '../../stream-utils';
import Avatar from '../ui/Avatar';
import EmojiPicker from '../chat/EmojiPicker';

const RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

function ResizeHandles({ onStart, className = '' }) {
  return RESIZE_DIRECTIONS.map((direction) => (
    <span
      key={direction}
      className={cx('stream-resize-handle', `dir-${direction}`, className)}
      onPointerDown={(event) => onStart(event, direction)}
      aria-hidden="true"
    />
  ));
}

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

// Прокручивает список чата к последнему сообщению. Повторяем в нескольких
// кадрах: высота сообщения может измениться после подгрузки шрифта/эмодзи.
function pinChatToBottom(list) {
  if (!list) return;
  const apply = () => {
    if (!list.isConnected) return;
    list.scrollTop = list.scrollHeight;
  };
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
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
  const stageRef = useRef(null);
  const frameRef = useRef(null);
  const pipDragRef = useRef(null);
  const chatListRef = useRef(null);
  const chatInputRef = useRef(null);
  const chatDragRef = useRef(null);
  const watcherRef = useRef(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState('');
  const [chatSelf, setChatSelf] = useState(null);
  const [chatLayout, setChatLayout] = useState(() => streamBroadcaster.getChatLayout());
  const [chatStyle, setChatStyle] = useState(() => streamBroadcaster.getChatStyle());
  const [cameraStyle, setCameraStyle] = useState(() => streamBroadcaster.getCameraStyle());
  const [styleMenu, setStyleMenu] = useState(null);
  const [streamState, setStreamState] = useState('connecting');
  const [error, setError] = useState('');
  const [liveViewers, setLiveViewers] = useState(null);
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiBox, setEmojiBox] = useState(null);
  const [pipLayout, setPipLayout] = useState(() => streamBroadcaster.getPipLayout());
  const [cameraAspect, setCameraAspect] = useState(streamBroadcaster.cameraAspect || 16 / 9);
  const [frameBox, setFrameBox] = useState({ left: 0, top: 0, width: 100, height: 100 });
  const elapsed = useElapsed(stream?.createdAt);
  const pipEditor = mine && stream?.source === 'both';
  const chatEditor = mine;

  useEffect(() => {
    setStreamState('connecting');
    setError('');
    setBlocked(false);
    setMuted(false);
    setLiveViewers(null);
    setCopied(false);
    setChatMessages([]);
    setChatText('');
    setChatSelf(null);
    setChatLayout(streamBroadcaster.getChatLayout());
    setStyleMenu(null);
    setEmojiOpen(false);
    setEmojiBox(null);
  }, [streamId]);

  useEffect(() => {
    if (!styleMenu) return undefined;
    const close = () => setStyleMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [styleMenu]);

  // Чат эфира: у стримера сообщения приходят через signalling-сокет.
  useEffect(() => {
    if (!mine) return undefined;
    // Важно: копируем массив. Иначе сокет мутирует тот же экземпляр,
    // React не видит изменения состояния и не запускает автопрокрутку.
    setChatMessages(Array.isArray(streamBroadcaster.chatMessages) ? [...streamBroadcaster.chatMessages] : []);
    setChatSelf(streamBroadcaster.chatSelf || null);
    setChatLayout(streamBroadcaster.getChatLayout());
    return streamBroadcaster.onChat((event, payload) => {
      if (event === 'history') {
        setChatMessages(Array.isArray(payload?.messages) ? [...payload.messages] : []);
        setChatSelf(payload?.self || null);
      } else if (event === 'message') {
        setChatMessages((prev) => {
          if (payload?.id && prev.some((item) => item.id === payload.id)) return prev;
          return [...prev.slice(-99), payload];
        });
      } else if (event === 'layout' && payload?.layout) {
        setChatLayout(payload.layout);
      } else if (event === 'chat-style' && payload?.style) {
        setChatStyle(payload.style);
      } else if (event === 'camera-style' && payload?.style) {
        setCameraStyle(payload.style);
      }
    });
  }, [mine, streamId]);

  // Локальный предпросмотр собственного эфира. Показываем именно итоговый
  // поток: в режиме «экран + камера» он уже содержит камеру, а при захвате
  // окна — обрезанную область без лишней части монитора.
  useEffect(() => {
    if (!mine) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    const local = streamBroadcaster.localStream;
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

  const beginPipDrag = (event, mode, direction = 'se') => {
    if (!pipEditor) return;
    event.preventDefault();
    event.stopPropagation();
    const frame = frameRef.current?.getBoundingClientRect();
    if (!frame?.width || !frame?.height) return;
    const start = { ...pipLayout };
    pipDragRef.current = { mode, start, direction };

    const move = (moveEvent) => {
      const drag = pipDragRef.current;
      if (!drag) return;
      const dx = (moveEvent.clientX - event.clientX) / frame.width;
      const dy = (moveEvent.clientY - event.clientY) / frame.height;
      // Сколько долей высоты сцены приходится на одну долю ширины камеры.
      const heightPerWidth =
        frame.width / Math.max(1, frame.height * (cameraAspect || 16 / 9));
      const next =
        drag.mode === 'resize'
          ? resizePipLayout(drag.start, dx, dy, drag.direction, heightPerWidth)
          : movePipLayout(drag.start, dx, dy, heightPerWidth);
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
        if (info?.chatLayout) setChatLayout(info.chatLayout);
        if (info?.chatStyle) setChatStyle(info.chatStyle);
        if (info?.cameraStyle) setCameraStyle(info.cameraStyle);
      },
      onChatHistory: (payload = {}) => {
        setChatMessages(Array.isArray(payload.messages) ? [...payload.messages] : []);
        setChatSelf(payload.self || null);
      },
      onChat: (message) => {
        if (!message) return;
        setChatMessages((prev) => {
          if (message.id && prev.some((item) => item.id === message.id)) return prev;
          return [...prev.slice(-99), message];
        });
      },
      onChatLayout: (layout) => {
        if (layout) setChatLayout(layout);
      },
      onChatStyle: (style) => {
        if (style) setChatStyle(style);
      },
      onCameraStyle: (style) => {
        if (style) setCameraStyle(style);
      },
      onEnded: () => setStreamState('ended'),
      onError: (message) => {
        setError(message || '');
        setStreamState('error');
      },
    });
    watcherRef.current = watcher;

    return () => {
      watcherRef.current = null;
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

  // Новое сообщение или загруженная история — всегда вниз.
  useEffect(() => {
    pinChatToBottom(chatListRef.current);
  }, [chatMessages]);

  // При изменении размера/положения чата тоже держим последнее сообщение.
  useEffect(() => {
    pinChatToBottom(chatListRef.current);
  }, [chatLayout, chatStyle]);

  // Окно чата могут растянуть или изменить размер окна приложения.
  useEffect(() => {
    const list = chatListRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => pinChatToBottom(list));
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  const beginChatDrag = (event, mode, direction = 'se') => {
    if (!chatEditor) return;
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const start = { ...chatLayout };
    chatDragRef.current = { mode, direction, start };

    const move = (moveEvent) => {
      const drag = chatDragRef.current;
      if (!drag) return;
      const dx = (moveEvent.clientX - event.clientX) / rect.width;
      const dy = (moveEvent.clientY - event.clientY) / rect.height;
      const next =
        drag.mode === 'resize'
          ? resizeChatLayout(drag.start, dx, dy, drag.direction)
          : moveChatLayout(drag.start, dx, dy);
      streamBroadcaster.setChatLayout(next);
      setChatLayout(streamBroadcaster.getChatLayout());
    };

    const finish = () => {
      chatDragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      streamBroadcaster.setChatLayout(streamBroadcaster.getChatLayout(), true);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const sendChatMessage = (event) => {
    event?.preventDefault?.();
    const value = chatText.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!value) return;
    if (mine) streamBroadcaster.sendChat(value);
    else watcherRef.current?.sendChat(value);
    setChatText('');
  };

  const toggleEmojiPicker = (event) => {
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
    if (top < 8) {
      top = Math.min(window.innerHeight - height - 8, rect.bottom + 8);
    }
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

  const chooseChatStyle = (style) => {
    streamBroadcaster.setChatStyle(style, true);
    setChatStyle(style);
    setStyleMenu(null);
  };

  const chooseCameraStyle = (style) => {
    streamBroadcaster.setCameraStyle(style, true);
    setCameraStyle(style);
    setStyleMenu(null);
  };

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
                className={cx('stream-stage-pip', 'baked', `camera-style-${cameraStyle}`)}
                style={{
                  left: `${pipLayout.x * 100}%`,
                  top: `${pipLayout.y * 100}%`,
                  width: `${pipLayout.w * 100}%`,
                  aspectRatio: String(cameraAspect || 16 / 9),
                }}
                onPointerDown={(event) => beginPipDrag(event, 'move')}
              >
                <span className="stream-pip-move">
                  <Move size={14} />
                </span>
                <button
                  type="button"
                  className="stream-pip-style"
                  aria-label="Сменить стиль камеры"
                  title="Сменить стиль камеры"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    setStyleMenu((current) => (current === 'camera' ? null : 'camera'));
                  }}
                >
                  <Palette size={12} />
                  <span>Сменить стиль</span>
                </button>
                <ResizeHandles
                  onStart={(event, direction) => beginPipDrag(event, 'resize', direction)}
                />
              </div>
            </div>
          ) : null}

          <div
            className={cx('stream-chat', `chat-style-${chatStyle}`, chatEditor && 'editable')}
            style={{
              left: `${chatLayout.x * 100}%`,
              top: `${chatLayout.y * 100}%`,
              width: `${chatLayout.w * 100}%`,
              height: `${chatLayout.h * 100}%`,
            }}
          >
            <div
              className="stream-chat-head"
              onPointerDown={chatEditor ? (event) => beginChatDrag(event, 'move') : undefined}
            >
              <span className="stream-chat-title">
                <MessageCircle size={14} /> Чат
              </span>
              {chatEditor ? (
                <button
                  type="button"
                  className="stream-chat-style-btn"
                  aria-label="Сменить стиль чата"
                  title="Сменить стиль чата"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    setStyleMenu((current) => (current === 'chat' ? null : 'chat'));
                  }}
                >
                  <Palette size={12} />
                  <span>Сменить стиль</span>
                </button>
              ) : null}
              <span className="stream-chat-self">
                {chatSelf?.name ? `Вы: ${chatSelf.name}` : mine ? 'Стример' : 'Зритель'}
              </span>
              {chatEditor ? (
                <span className="stream-chat-move" title="Перетащите чат">
                  <Move size={12} />
                </span>
              ) : null}
            </div>
            <div className="stream-chat-list" ref={chatListRef}>
              {chatMessages.length ? (
                chatMessages.map((message, index) => (
                  <div
                    className={cx('stream-chat-msg', message.user?.guest && 'guest')}
                    key={message.id || `${message.at || ''}-${index}`}
                  >
                    <span className="stream-chat-author">{message.user?.name || 'Гость'}</span>
                    <span className="stream-chat-text">{message.text}</span>
                  </div>
                ))
              ) : (
                <div className="stream-chat-empty">Пока тихо. Напишите первым!</div>
              )}
            </div>
            <form
              className="stream-chat-form"
              onSubmit={sendChatMessage}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="stream-chat-emoji-btn"
                aria-label="Смайлы"
                title="Смайлы"
                aria-expanded={emojiOpen}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={toggleEmojiPicker}
              >
                <Smile size={15} />
              </button>
              <input
                ref={chatInputRef}
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                maxLength={500}
                placeholder="Сообщение в эфир…"
                aria-label="Сообщение в чат трансляции"
              />
              <button type="submit" disabled={!chatText.trim()} aria-label="Отправить сообщение">
                <Send size={14} />
              </button>
            </form>
            {chatEditor ? (
              <ResizeHandles
                onStart={(event, direction) => beginChatDrag(event, 'resize', direction)}
              />
            ) : null}
          </div>

          {styleMenu && chatEditor ? (
            <div
              className="stream-style-menu"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="stream-style-menu-head">
                <span>
                  <Palette size={14} />
                  {styleMenu === 'chat' ? 'Стиль чата' : 'Стиль камеры'}
                </span>
                <button
                  type="button"
                  className="stream-style-close"
                  aria-label="Закрыть выбор стиля"
                  onClick={() => setStyleMenu(null)}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="stream-style-options">
                {(styleMenu === 'chat' ? CHAT_STYLE_OPTIONS : CAMERA_STYLE_OPTIONS).map(
                  (option) => {
                    const active =
                      styleMenu === 'chat' ? chatStyle === option.id : cameraStyle === option.id;
                    return (
                      <button
                        type="button"
                        key={option.id}
                        className={cx('stream-style-option', active && 'active')}
                        onClick={() =>
                          styleMenu === 'chat'
                            ? chooseChatStyle(option.id)
                            : chooseCameraStyle(option.id)
                        }
                      >
                        <span
                          className={cx(
                            'stream-style-swatch',
                            styleMenu === 'chat'
                              ? `chat-style-${option.id}`
                              : `camera-style-${option.id}`
                          )}
                        />
                        <span className="stream-style-option-text">
                          <strong>{option.label}</strong>
                          <em>{option.hint}</em>
                        </span>
                        {active ? <Check size={14} /> : null}
                      </button>
                    );
                  }
                )}
              </div>
            </div>
          ) : null}

          {chatEditor && !showStatus && !blocked ? (
            <span className="stream-pip-hint">
              <Move size={13} />
              {pipEditor
                ? 'Перетащите камеру и чат · тяните за любую сторону'
                : 'Перетащите чат · тяните за любую сторону'}
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

      {emojiOpen && emojiBox && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="stream-emoji-pop"
              style={{
                left: `${emojiBox.left}px`,
                top: `${emojiBox.top}px`,
                width: `${emojiBox.width}px`,
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <EmojiPicker
                className="stream-emoji-picker"
                onPick={insertChatEmoji}
                onClose={() => setEmojiOpen(false)}
              />
            </div>,
            stageRef.current || document.body
          )
        : null}

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
