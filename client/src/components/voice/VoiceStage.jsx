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
  ScreenShare,
  Settings,
  Tv,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useApp, selectChannel } from '../../store';
import { cx, keyLabel } from '../../utils';
import Avatar from '../ui/Avatar';
import ContextMenu from '../ui/ContextMenu';
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

// Отдельная громкость звука чужой трансляции: не влияет на голос
// участников и запоминается между запусками.
function StreamVolumeControl({ className = '' }) {
  const volume = useApp((state) => state.settings.streamVolume ?? 100);
  const muted = useApp((state) => state.settings.streamMuted);
  const deafened = useApp((state) => state.voice.deafened);
  const updateSettings = useApp((state) => state.updateSettings);
  const silent = Boolean(muted || deafened);
  return (
    <div
      className={cx('voice-stream-audio', className)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="voice-stream-audio-toggle"
        onClick={() => updateSettings({ streamMuted: !muted })}
        title={silent ? 'Включить звук трансляции' : 'Выключить звук трансляции'}
        aria-label={silent ? 'Включить звук трансляции' : 'Выключить звук трансляции'}
      >
        {silent ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={volume}
        onChange={(event) => updateSettings({ streamVolume: Number(event.target.value) })}
        title={`Громкость трансляции: ${volume}%`}
        aria-label="Громкость трансляции"
      />
      <span>{silent ? 'выкл' : `${volume}%`}</span>
    </div>
  );
}

function ParticipantTile({ participant, stream, isSelf, localStream, compact, onFullscreen, fullscreen }) {
  const screen = Boolean(participant.screen) && stream;
  const camera = Boolean(participant.camera);

  if (screen) {
    return (
      <div
        className="voice-tile voice-tile-screen"
        onDoubleClick={() => {
          if (!fullscreen) onFullscreen?.(participant.userId);
        }}
      >
        <VideoStream stream={stream} className="voice-screen-video" />
        {!fullscreen ? (
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
        ) : null}
        {!isSelf ? <StreamVolumeControl /> : null}
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
  const channels = useApp((state) => state.channels);
  const dms = useApp((state) => state.dms);
  const streams = useApp((state) => state.streams);
  const [fullscreen, setFullscreen] = useState(false);
  const [streamFullscreen, setStreamFullscreen] = useState(null);
  const [demoMenu, setDemoMenu] = useState(null);
  const previousScreens = useRef({ channelId: null, ids: new Set() });

  const channelParticipants = voiceStates[voice.channelId] || [];
  const channel = voice.channelId ? selectChannel({ channels, dms }, voice.channelId) : null;
  const channelName = channel && channel.type !== 'dm' ? channel.name : '';
  const channelStreams = (streams || []).filter(
    (stream) => stream.live !== false && stream.channelId === voice.channelId
  );

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
      {fullscreen || !hasScreen ? (
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
      ) : null}

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
              fullscreen={fullscreen}
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
            className={cx(
              'voice-control',
              'demo',
              (voice.camera || voice.screen) && 'active screen'
            )}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setDemoMenu({
                x: Math.max(8, rect.left + rect.width / 2 - 130),
                y: Math.max(8, rect.top - 196),
              });
            }}
            title="Демонстрация: камера или экран только для канала"
            aria-haspopup="menu"
            aria-expanded={Boolean(demoMenu)}
          >
            <ScreenShare size={22} />
            <span>Демонстрация</span>
            {voice.camera || voice.screen ? (
              <span className="voice-control-demo-dot" />
            ) : null}
          </button>
          <button
            className={cx('voice-control', 'stream', channelStreams.length > 0 && 'live')}
            onClick={() =>
              openModal('startStream', {
                channelId: voice.channelId,
                channelName,
              })
            }
            title="Начать трансляцию в канале"
          >
            <Radio size={22} />
            <span>Стрим</span>
            {channelStreams.length ? <span className="voice-control-live" /> : null}
          </button>
          <button
            className="voice-control watch"
            onClick={() =>
              openModal('watchSetup', {
                channelId: voice.channelId,
                channelName,
              })
            }
            title="Watch Party — смотреть видео вместе"
          >
            <Tv size={22} />
            <span>Watch Party</span>
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
      {demoMenu ? (
        <ContextMenu
          x={demoMenu.x}
          y={demoMenu.y}
          menuTitle="Демонстрация"
          menuNote="Камеру и экран видят только участники голосового канала."
          items={[
            {
              key: 'camera',
              icon: voice.camera ? <Camera size={16} /> : <CameraOff size={16} />,
              label: voice.camera ? 'Выключить камеру' : 'Включить камеру',
              hint: voice.camera ? 'включена' : '',
              onClick: () => {
                setDemoMenu(null);
                voiceManager.toggleCamera();
              },
            },
            {
              key: 'screen',
              icon: voice.screen ? <Monitor size={16} /> : <MonitorOff size={16} />,
              label: voice.screen ? 'Остановить показ экрана' : 'Показать экран',
              hint: voice.screen ? 'показан' : '',
              onClick: () => {
                setDemoMenu(null);
                voiceManager.toggleScreen();
              },
            },
          ]}
          onClose={() => setDemoMenu(null)}
        />
      ) : null}
      {focused && focused.screen && focusedStream ? (
        <div
          className="voice-stream-fullscreen"
          onClick={() => setStreamFullscreen(null)}
          title="Нажмите, чтобы свернуть трансляцию"
        >
          <VideoStream stream={focusedStream} className="voice-stream-fullscreen-video" />
          {!focused.isSelf ? (
            <StreamVolumeControl className="fullscreen" />
          ) : null}
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
