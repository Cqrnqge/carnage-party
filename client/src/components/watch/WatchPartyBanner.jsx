import React from 'react';
import { Crown, Play, Tv, Users } from 'lucide-react';
import { useApp } from '../../store';
import Avatar from '../ui/Avatar';

export default function WatchPartyBanner({ channelId }) {
  const rooms = useApp((state) => state.watchRooms);
  const user = useApp((state) => state.user);
  const openModal = useApp((state) => state.openModal);

  const room = (rooms || []).find((item) => item.channelId === channelId);
  if (!room) return null;
  const mine = room.hostId === user?.id;

  return (
    <div className="channel-watch-banner">
      <span className="channel-watch-icon"><Tv size={17} /></span>
      <Avatar user={room.host} size={30} />
      <div className="channel-watch-text">
        <strong>{room.title}</strong>
        <span>
          <Crown size={11} /> {room.host?.displayName || 'Хост'}
          {' · '}
          <Users size={11} /> {room.participants || 0}
          {' · '}
          {room.live ? 'хост в комнате' : 'хост отключён'}
        </span>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-small"
        onClick={() => openModal('watchParty', { roomId: room.id, channelId })}
      >
        <Play size={14} /> {mine ? 'Открыть' : 'Присоединиться'}
      </button>
    </div>
  );
}
