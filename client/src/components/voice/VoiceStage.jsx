import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Headphones,
  Loader2,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  Monitor,
  MonitorOff,
  PhoneOff,
  Radio,
  Settings,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useApp } from '../../store';
import { cx, keyLabel } from '../../utils';
import Avatar from '../ui/Avatar';
import { voiceManager } from '../../voice';
import { playSound } from '../../sounds';

function VideoStream({ stream, className = '', muted = true }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream || null;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}

function ParticipantTile({ participant, stream, isSelf, localStream, compact, onFullscreen }) {
  const screen = Boolean(participant.screen) && stream;
  const camera = Boolean(participant.camera);

  if (screen) {
    return (
      <div
        className="voice-tile voice-tile-screen"
        onDoubleClick={() => onFullscreen?.(participant.userId)}
      >
        <VideoStream stream={stream} className="voice-screen-video" />
        <button
          type="button"
          className="voice-tile-fullscreen"
          onClick={(event) => {
            event.stopPropagation();
            onFullscreen?.(participant.userId);
          }}
          title="Развернуть трансляцию на весь экран"
          aria-label="Развернуть трансляцию на весь экран"
        >
          <Maximize2 size={17} />
        </button>
        <div className="voice-tile-label">
          <span className="voice-live-dot" />
          {participant.user?.displayName || 'Экран'} показывает экран
        </div>
      </div>
    );
  }

  if (camera && stream) {
    return (
      <div className={cx('voice-tile voice-tile-video', participant.speaking && 'speaking')}>
        <VideoStream stream={stream} className={cx('voice-camera-video', isSelf && 'mirror')} />
        <div className="voice-tile-label">
          <span>{participant.user?.displayName || 'Участник'}{isSelf ? ' (вы)' : ''}</span>
          {participant.muted ? <MicOff size={12} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cx(
        'voice-tile voice-tile-avatar',
        participant.speaking && 'speaking',
        compact && 'compact'
      )}
    >
      <Avatar user={participant.user} size={compact ? 54 : 86} />
      <div className="voice-tile-name">
        <span>{participant.user?.displayName || 'Участник'}{isSelf ? ' (вы)' : ''}</span>
        <div className="voice-tile-badges">
          {participant.muted ? <span className="voice-badge muted"><MicOff size={12} /></span> : null}
          {participant.deafened ? <span className="voice-badge"><VolumeX size={12} /></span> : null}
          {participant.screen ? <span className="voice-badge screen"><Monitor size={12} /></span> : null}
        </div>
      </div>
      {camera ? (
        <div className="voice-camera-pending">
          <Loader2 size={15} className="spin" /> Включаем камеру…
        </div>
      ) : null}
    </div>
  );
}

export default function VoiceStage() {
  const voice = useApp((state) => state.voice);
  const user = useApp((state) => state.user);
  const voiceStates = useApp((state) => state.voiceStates);
  const settings = useApp((state) => state.settings);
  const setVoice = useApp((state) => state.setVoice);
  const openModal = useApp((state) => state.openModal);
  const [fullscreen, setFullscreen] = useState(false);
  const [streamFullscreen, setStreamFullscreen] = useState(null);
  const previousScreens = useRef({ channelId: null, ids: new Set() });

  const channelParticipants = voiceStates[voice.channelId] || [];

  useEffect(() => {
    if (!voice.joined) {
      setFullscreen(false);
      setStreamFullscreen(null);
    }
  }, [voice.joined]);

  const participants = useMemo(() => {
    if (!voice.joined && !voice.connecting) return [];
    const list = [];
    const seen = new Set();
    if (user) {
      list.push({
        userId: user.id,
        user,
        muted: voice.muted,
        deafened: voice.deafened,
        camera: voice.camera,
        screen: voice.screen,
        speaking: voice.selfSpeaking,
        isSelf: true,
      });
      seen.add(user.id);
    }
    for (const participant of voice.participants || []) {
      if (seen.has(participant.userId)) continue;
      seen.add(participant.userId);
      list.push({
        ...participant,
        user: participant.user || channelParticipants.find((p) => p.userId === participant.userId)?.user,
      });
    }
    for (const participant of channelParticipants) {
      if (seen.has(participant.userId)) continue;
      seen.add(participant.userId);
      list.push(participant);
    }
    return list;
  }, [
    voice.joined,
    voice.connecting,
    voice.participants,
    voice.muted,
    voice.deafened,
    voice.camera,
    voice.screen,
    voice.selfSpeaking,
    channelParticipants,
    user,
  ]);

  const screenKey = participants
    .filter((participant) => !participant.isSelf && participant.screen)
    .map((participant) => participant.userId)
    .sort()
    .join(',');

  useEffect(() => {
    const ids = new Set(screenKey ? screenKey.split(',') : []);
    const previous = previousScreens.current;
    if (previous.channelId === voice.channelId) {
      for (const userId of ids) {
        if (!previous.ids.has(userId)) playSound('streamStart');
      }
      for (const userId of previous.ids) {
        if (!ids.has(userId)) playSound('streamStop');
      }
    }
    previousScreens.current = { channelId: voice.channelId, ids };
  }, [screenKey, voice.channelId]);

  const focused = streamFullscreen
    ? participants.find((participant) => participant.userId === streamFullscreen)
    : null;
  const focusedStream = focused
    ? focused.isSelf
      ? voiceManager.screenStream
      : voice.streams[focused.userId]
    : null;

  useEffect(() => {
    if (streamFullscreen && (!focused || !focused.screen || !focusedStream)) {
      setStreamFullscreen(null);
    }
  }, [streamFullscreen, focused, focusedStream]);

  useEffect(() => {
    if (!streamFullscreen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setStreamFullscreen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [streamFullscreen]);

  if (!voice.channelId) {
    return null;
  }

  const hasScreen = participants.some((participant) => participant.screen);
  const columns =
    participants.length <= 1 ? 1 : participants.length <= 4 ? 2 : participants.length <= 9 ? 3 : 4;

  const content = (
    <div className={cx('voice-stage', 'voice-stage-inline', fullscreen && 'voice-stage-fullscreen')}>
      <div className="voice-stage-topbar">
        {fullscreen ? (
          <button
            className="icon-btn"
            onClick={() => {
              setFullscreen(false);
              setVoice({ stageOpen: false });
            }}
            title="Вернуться в чат"
          >
            <MessageSquare size={18} />
          </button>
        ) : null}
        <button
          className="icon-btn"
          onClick={() => setFullscreen((value) => !value)}
          title={fullscreen ? 'Свернуть' : 'На весь экран'}
        >
          {fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
        </button>
      </div>

      <div
        className={cx('voice-grid', `columns-${columns}`, hasScreen && 'has-screen')}
        style={{ '--voice-columns': columns }}
      >
        {participants.length === 0 && voice.connecting ? (
          <div className="voice-connecting">
            <Loader2 size={28} className="spin" />
            <p>Подключаемся к голосовому каналу…</p>
          </div>
        ) : null}
        {participants.map((participant) => {
          const stream = participant.isSelf
            ? voiceManager.screenStream || voiceManager.cameraStream
            : voice.streams[participant.userId];
          return (
            <ParticipantTile
              key={participant.userId}
              participant={participant}
              stream={stream}
              isSelf={Boolean(participant.isSelf)}
              localStream={participant.isSelf ? voiceManager.localStream : null}
              compact={participants.length > 4}
              onFullscreen={setStreamFullscreen}
            />
          );
        })}
        {!voice.connecting && participants.length === 0 ? (
          <div className="voice-empty">
            <Volume2 size={36} />
            <p>В комнате пока никого нет. Пригласите друзей!</p>
          </div>
        ) : null}
      </div>

      <footer className="voice-stage-footer">
        <div className="voice-controls">
          {settings.pushToTalk ? (
            <button
              className={cx('voice-control ptt', voice.ptt && 'active')}
              onPointerDown={(event) => {
                event.preventDefault();
                try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
                voiceManager.pttStart();
              }}
              onPointerUp={() => voiceManager.pttEnd()}
              onPointerCancel={() => voiceManager.pttEnd()}
              onLostPointerCapture={() => voiceManager.pttEnd()}
              onKeyDown={(event) => {
                if (event.code !== 'Space' && event.code !== 'Enter') return;
                event.preventDefault();
                voiceManager.pttStart();
              }}
              onKeyUp={(event) => {
                if (event.code !== 'Space' && event.code !== 'Enter') return;
                event.preventDefault();
                voiceManager.pttEnd();
              }}
              onContextMenu={(event) => event.preventDefault()}
              title={`Удерживайте, чтобы говорить (${keyLabel(settings.pttKey)})`}
            >
              <Radio size={22} />
              <span>{voice.ptt ? 'Говорю' : 'Рация'}</span>
            </button>
          ) : null}
          <button
            className={cx('voice-control', voice.muted && 'danger active')}
            onClick={() => voiceManager.toggleMute()}
            title={voice.muted ? 'Включить микрофон' : 'Выключить микрофон'}
          >
            {voice.muted ? <MicOff size={22} /> : <Mic size={22} />}
            <span>{voice.muted ? 'Вкл. микро' : 'Микрофон'}</span>
          </button>
          <button
            className={cx('voice-control', voice.deafened && 'danger active')}
            onClick={() => voiceManager.toggleDeafen()}
            title={voice.deafened ? 'Включить звук' : 'Не слышать других'}
          >
            {voice.deafened ? <VolumeX size={22} /> : <Headphones size={22} />}
            <span>{voice.deafened ? 'Вкл. звук' : 'Звук'}</span>
          </button>
          <button
            className={cx('voice-control', voice.camera && 'active')}
            onClick={() => voiceManager.toggleCamera()}
            title={voice.camera ? 'Выключить камеру' : 'Включить камеру'}
          >
            {voice.camera ? <Camera size={22} /> : <CameraOff size={22} />}
            <span>Камера</span>
          </button>
          <button
            className={cx('voice-control', voice.screen && 'active screen')}
            onClick={() => voiceManager.toggleScreen()}
            title={voice.screen ? 'Остановить показ экрана' : 'Показать экран'}
          >
            {voice.screen ? <Monitor size={22} /> : <MonitorOff size={22} />}
            <span>Экран</span>
          </button>
          <button
            className="voice-control"
            onClick={() => openModal('settings', { tab: 'voice' })}
            title="Настройки голоса"
          >
            <Settings size={22} />
            <span>Настройки</span>
          </button>
          <button
            className="voice-control leave"
            onClick={() => voiceManager.leave()}
            title="Покинуть комнату"
          >
            <PhoneOff size={22} />
            <span>Выйти</span>
          </button>
        </div>
        <div className="voice-stage-status">
          {voice.joined ? (
            <>
              <span className="status-dot-online" /> Подключено
            </>
          ) : (
            <>
              <Loader2 size={13} className="spin" /> Соединение…
            </>
          )}
          {voice.error ? <span className="voice-stage-error">{voice.error}</span> : null}
        </div>
      </footer>
    </div>
  );

  return (
    <>
      {content}
      {focused && focused.screen && focusedStream ? (
        <div className="voice-stream-fullscreen">
          <VideoStream stream={focusedStream} className="voice-stream-fullscreen-video" />
          <div className="voice-stream-fullscreen-bar">
            <span className="voice-stream-fullscreen-title">
              <span className="voice-live-dot" />
              {focused.user?.displayName || 'Участник'} показывает экран
            </span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setStreamFullscreen(null)}
              title="Свернуть трансляцию"
              aria-label="Свернуть трансляцию"
            >
              <Minimize2 size={20} />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
