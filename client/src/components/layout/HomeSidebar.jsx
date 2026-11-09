import React, { useMemo, useState } from 'react';
import { Bookmark, Plus, Search, Users, X } from 'lucide-react';
import { useApp, channelTitle, selectChannel } from '../../store';
import { dmOther, STATUS_META } from '../../constants';
import { cx, formatDayShort, initials } from '../../utils';
import Avatar from '../ui/Avatar';
import UserPanel from './UserPanel';
import VoiceDock from './VoiceDock';

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'unread', label: 'Непрочитанные' },
  { id: 'private', label: 'Личные' },
  { id: 'groups', label: 'Группы' },
];

function DmRow({ channel }) {
  const active = useApp((state) => state.active);
  const user = useApp((state) => state.user);
  const presence = useApp((state) => state.presence);
  const unread = useApp((state) => state.unread[channel.id] || 0);
  const mentions = useApp((state) => state.mentions[channel.id] || 0);
  const setActive = useApp((state) => state.setActive);
  const setMobilePanel = useApp((state) => state.setMobilePanel);
  const hasStream = useApp((state) =>
    (state.streams || []).some(
      (stream) => stream.live !== false && stream.channelId === channel.id
    )
  );
  const isActive = active?.type === 'channel' && active.id === channel.id;
  const other = dmOther(channel, user?.id);
  const isGroup = (channel.members || []).length > 2;
  const status = isGroup ? null : presence[other?.id] || other?.status || 'offline';
  const title = channelTitle({ user }, channel);
  const isSaved = Boolean(channel.saved);

  return (
    <button
      className={cx('dm-row', isActive && 'active', unread > 0 && 'unread', isSaved && 'saved-row')}
      onClick={() => {
        setActive({ type: 'channel', id: channel.id });
        setMobilePanel(null);
      }}
    >
      <div className="dm-avatar-wrap">
        {isSaved ? (
          <div className="saved-avatar"><Bookmark size={17} /></div>
        ) : isGroup ? (
          <div className="group-avatar" style={{ background: 'linear-gradient(135deg,#ff3d71,#7c3aed)' }}>
            {initials(title)}
          </div>
        ) : (
          <Avatar user={other} size={36} showStatus status={status} />
        )}
        {hasStream ? (
          <span className="dm-live-dot" title="Идёт трансляция" />
        ) : unread > 0 && !isActive ? (
          <span className="dm-unread-dot" />
        ) : null}
      </div>
      <div className="dm-text">
        <div className="dm-top">
          <span className="dm-name">{title}</span>
          {channel.lastMessage ? (
            <span className="dm-time">{formatDayShort(channel.lastMessage.createdAt)}</span>
          ) : null}
        </div>
        <div className="dm-preview">
          {isSaved ? (
            <span className="muted">Заметки, ссылки и сохранённые сообщения</span>
          ) : channel.lastMessage ? (
            <>
              <span className="dm-last-author">{channel.lastMessage.authorName}:</span>{' '}
              {channel.lastMessage.content || 'Вложение'}
            </>
          ) : (
            <span className="muted">Начните переписку</span>
          )}
        </div>
      </div>
      {mentions > 0 ? <span className="dm-badge mention-badge">{mentions}</span> : unread > 0 && !isActive ? <span className="dm-badge">{unread}</span> : null}
    </button>
  );
}

export default function HomeSidebar() {
  const dms = useApp((state) => state.dms);
  const friends = useApp((state) => state.friends);
  const active = useApp((state) => state.active);
  const setActive = useApp((state) => state.setActive);
  const openModal = useApp((state) => state.openModal);
  const setMobilePanel = useApp((state) => state.setMobilePanel);
  const unread = useApp((state) => state.unread);
  const user = useApp((state) => state.user);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const savedChannel = useMemo(
    () => dms.find((channel) => channel.saved && (channel.memberIds || []).includes(user?.id)),
    [dms, user?.id]
  );

  const normalized = query.trim().toLowerCase();

  const chats = useMemo(() => {
    const list = dms.filter((channel) => channel.id !== savedChannel?.id);
    return list.filter((channel) => {
      if (normalized) {
        const title = channelTitle({ user }, channel).toLowerCase();
        const members = (channel.members || [])
          .map((member) => `${member.displayName || ''} ${member.username || ''}`)
          .join(' ')
          .toLowerCase();
        if (!title.includes(normalized) && !members.includes(normalized)) return false;
      }
      const isGroup = (channel.members || []).length > 2;
      if (filter === 'unread') return (unread[channel.id] || 0) > 0;
      if (filter === 'private') return !isGroup;
      if (filter === 'groups') return isGroup;
      return true;
    });
  }, [dms, savedChannel?.id, filter, normalized, unread, user]);

  const unreadChats = useMemo(
    () => dms.filter((channel) => (unread[channel.id] || 0) > 0).length,
    [dms, unread]
  );

  const showSaved =
    savedChannel &&
    (filter === 'all' || filter === 'private') &&
    (!normalized || 'избранное'.includes(normalized));

  return (
    <aside className="sidebar home-sidebar">
      <div className="sidebar-header home-header">
        <span className="home-title">Личные сообщения</span>
        <button
          className="icon-btn"
          onClick={() => openModal('newDm')}
          data-tooltip="Создать диалог"
          aria-label="Создать диалог"
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="sidebar-scroll">
        <button
          className={cx('home-nav-item', active?.type === 'friends' && 'active')}
          onClick={() => {
            setActive({ type: 'friends' });
            setMobilePanel(null);
          }}
        >
          <Users size={20} />
          <span>Друзья</span>
          {friends.incoming?.length ? <span className="nav-badge">{friends.incoming.length}</span> : null}
        </button>
        <div className="dm-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по чатам…"
            aria-label="Поиск по чатам"
          />
          {query ? (
            <button className="icon-btn tiny" onClick={() => setQuery('')} aria-label="Очистить поиск">
              <X size={13} />
            </button>
          ) : null}
        </div>
        <div className="dm-filters">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className={cx('dm-filter', filter === item.id && 'active')}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              {item.id === 'unread' && unreadChats ? <span className="dm-filter-count">{unreadChats}</span> : null}
            </button>
          ))}
        </div>
        <div className="sidebar-section-label">
          <span>{filter === 'unread' ? 'Непрочитанные' : filter === 'groups' ? 'Группы' : 'Личные сообщения'}</span>
          <button className="icon-btn tiny" onClick={() => openModal('newDm')} aria-label="Новый диалог">
            <Plus size={14} />
          </button>
        </div>
        <div className="dm-list">
          {showSaved ? <DmRow channel={savedChannel} /> : null}
          {chats.length === 0 ? (
            <div className="sidebar-empty">
              {normalized || filter !== 'all'
                ? 'Ничего не нашли — измените запрос или фильтр.'
                : 'Пока пусто. Добавьте друзей и начните первый диалог.'}
              {!normalized && filter === 'all' ? (
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => {
                    setActive({ type: 'friends' });
                    setMobilePanel(null);
                  }}
                >
                  Найти друзей
                </button>
              ) : null}
            </div>
          ) : (
            chats.map((channel) => <DmRow key={channel.id} channel={channel} />)
          )}
        </div>
      </div>
      <VoiceDock />
      <UserPanel />
    </aside>
  );
}
