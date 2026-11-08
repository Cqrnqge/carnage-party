import React, { useEffect, useMemo, useState } from 'react';
import { Compass, Plus } from 'lucide-react';
import { useApp, selectChannel } from '../../store';
import { serverUnread, serverMentions } from '../../store';
import { BrandMark, ServerIcon } from '../ui/Avatar';
import { cx } from '../../utils';

const LAST_CHANNEL_KEY = 'carnage_last_channel';

function readLastChannels() {
  try {
    return JSON.parse(localStorage.getItem(LAST_CHANNEL_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeLastChannel(serverId, channelId) {
  if (!serverId || !channelId) return;
  try {
    const map = readLastChannels();
    map[serverId] = channelId;
    localStorage.setItem(LAST_CHANNEL_KEY, JSON.stringify(map));
  } catch {}
}

export default function ServerRail() {
  const servers = useApp((state) => state.servers);
  const channels = useApp((state) => state.channels);
  const active = useApp((state) => state.active);
  const unread = useApp((state) => state.unread);
  const mentions = useApp((state) => state.mentions);
  const setActive = useApp((state) => state.setActive);
  const openModal = useApp((state) => state.openModal);
  const [lastChannels, setLastChannels] = useState(readLastChannels);

  const activeChannel = active?.type === 'channel' ? selectChannel({ channels, dms: [] }, active.id) : null;
  const activeServerId = activeChannel?.serverId || null;

  useEffect(() => {
    if (activeChannel?.serverId) {
      writeLastChannel(activeChannel.serverId, activeChannel.id);
      setLastChannels((prev) => ({ ...prev, [activeChannel.serverId]: activeChannel.id }));
    }
  }, [activeChannel?.id, activeChannel?.serverId]);

  const totals = useMemo(() => {
    const map = {};
    for (const server of servers) {
      const serverState = { channels, unread, mentions };
      map[server.id] = {
        unread: serverUnread(serverState, server.id),
        mentions: serverMentions(serverState, server.id),
      };
    }
    return map;
  }, [servers, channels, unread, mentions]);

  const openServer = (server) => {
    const list = channels
      .filter((channel) => channel.serverId === server.id)
      .sort((a, b) => (a.position || 0) - (b.position || 0));
    const remembered = list.find((channel) => channel.id === lastChannels[server.id]);
    const firstText = list.find((channel) => channel.type === 'text');
    const target = remembered || firstText || list[0];
    if (target) setActive({ type: 'channel', id: target.id });
  };

  return (
    <nav className="server-rail" aria-label="Серверы">
      <div className="rail-home">
        <button
          className={cx('rail-item rail-home-btn', active?.type === 'friends' && 'active')}
          data-tooltip="Личные сообщения"
          onClick={() => setActive({ type: 'friends' })}
          aria-label="Личные сообщения"
        >
          <BrandMark size={48} />
        </button>
      </div>
      <div className="rail-separator" />
      <div className="rail-servers">
        {servers.map((server) => {
          const totalsForServer = totals[server.id] || { unread: 0, mentions: 0 };
          return (
            <button
              key={server.id}
              className={cx('rail-item', activeServerId === server.id && 'active')}
              data-tooltip={server.name}
              onClick={() => openServer(server)}
              aria-label={server.name}
            >
              <ServerIcon server={server} size={48} />
              {totalsForServer.unread > 0 ? (
                <span className={cx('rail-badge', totalsForServer.mentions > 0 && 'mention-badge')}>
                  {totalsForServer.mentions > 0 ? totalsForServer.mentions : totalsForServer.unread > 99 ? '99+' : totalsForServer.unread}
                </span>
              ) : null}
            </button>
          );
        })}
        <button
          className="rail-item rail-add"
          data-tooltip="Создать сервер"
          onClick={() => openModal('createServer')}
          aria-label="Создать сервер"
        >
          <Plus size={24} />
        </button>
        <button
          className="rail-item rail-add"
          data-tooltip="Присоединиться по коду"
          onClick={() => openModal('joinServer')}
          aria-label="Присоединиться к серверу"
        >
          <Compass size={24} />
        </button>
      </div>
    </nav>
  );
}
