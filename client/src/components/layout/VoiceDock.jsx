import React from 'react';
import { Loader2, Maximize2, Monitor, Phone, PhoneOff, Volume2 } from 'lucide-react';
import { useApp, selectChannel } from '../../store';
import { dmTitle } from '../../constants';
import { cx } from '../../utils';
import { voiceManager } from '../../voice';
import Avatar from '../ui/Avatar';

export default function VoiceDock() {
  const voice = useApp((state) => state.voice);
  const channels = useApp((state) => state.channels);
  const dms = useApp((state) => state.dms);
  const user = useApp((state) => state.user);
  const setVoice = useApp((state) => state.setVoice);
  const setActive = useApp((state) => state.setActive);

  if (!voice.channelId) return null;
  const channel = selectChannel({ channels, dms }, voice.channelId);
  if (!channel) return null;
  const title = channel.type === 'dm' ? dmTitle(channel, user?.id) : channel.name;
  const isDm = channel.type === 'dm';
  const hasScreen = Boolean(voice.screen) || (voice.participants || []).some((p) => p.screen);
  const participants = [user, ...(voice.participants || []).map((p) => p.user)].filter(Boolean);

  return (
    <div className={cx('voice-dock', voice.connecting && 'connecting')}>
      <div className="voice-dock-head">
        <span className={cx('voice-dock-icon', voice.joined && 'connected')}>
          {voice.connecting ? <Loader2 size={16} className="spin" /> : isDm ? <Phone size={16} /> : <Volume2 size={16} />}
        </span>
        <div className="voice-dock-text">
          <strong>{title}</strong>
          <span>
            {voice.connecting
              ? 'Подключение…'
              : voice.joined
                ? `${isDm ? 'Звонок' : 'Голос подключён'} · ${participants.length}`
                : 'Отключено'}
          </span>
        </div>
        <div className="voice-dock-actions">
          {voice.joined ? (
            <button
              className={cx('icon-btn', hasScreen && 'live')}
              onClick={() => {
                setActive({ type: 'channel', id: voice.channelId });
                setVoice({ stageOpen: true });
              }}
              title={hasScreen ? 'Открыть трансляцию' : 'Открыть комнату'}
              aria-label={hasScreen ? 'Открыть трансляцию' : 'Открыть комнату'}
            >
              {hasScreen ? <Monitor size={15} /> : <Maximize2 size={15} />}
              {hasScreen ? <span className="voice-dock-live-dot" /> : null}
            </button>
          ) : null}
          <button
            className="icon-btn danger"
            onClick={() => voiceManager.leave()}
            title="Отключиться"
            aria-label="Отключиться от голоса"
          >
            <PhoneOff size={16} />
          </button>
        </div>
      </div>
      {voice.joined && participants.length > 1 ? (
        <div className="voice-dock-avatars">
          {participants.slice(0, 5).map((participant) => (
            <span key={participant.id} className="voice-dock-avatar" title={participant.displayName}>
              <Avatar user={participant} size={20} />
              <span className="voice-dock-dot" />
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
