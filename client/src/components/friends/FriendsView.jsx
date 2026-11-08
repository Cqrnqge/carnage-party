import React, { useMemo, useState } from 'react';
import {
  Ban,
  Check,
  Menu,
  MessageSquare,
  MoreVertical,
  Phone,
  Search,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../store';
import { getSocket } from '../../socket';
import { voiceManager } from '../../voice';
import { STATUS_META } from '../../constants';
import { cx, pluralMembers } from '../../utils';
import Avatar from '../ui/Avatar';
import ContextMenu from '../ui/ContextMenu';
import { useMobileClient } from '../../mobile';

const TABS = [
  { id: 'online', label: 'В сети' },
  { id: 'all', label: 'Все' },
  { id: 'pending', label: 'Ожидание' },
  { id: 'blocked', label: 'Заблокированные' },
  { id: 'add', label: 'Добавить друга', icon: UserPlus },
];

function FriendRow({ user, onMenu, status }) {
  const openModal = useApp((state) => state.openModal);
  const setActive = useApp((state) => state.setActive);
  const toast = useApp((state) => state.toast);

  const openDm = async () => {
    try {
      const data = await api('/api/dms', { method: 'POST', body: { userId: user.id } });
      if (data?.channel) {
        useApp.getState().addChannel(data.channel);
        setActive({ type: 'channel', id: data.channel.id });
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const call = async () => {
    try {
      const data = await api('/api/dms', { method: 'POST', body: { userId: user.id } });
      if (data?.channel) {
        useApp.getState().addChannel(data.channel);
        setActive({ type: 'channel', id: data.channel.id });
        await voiceManager.join(data.channel.id);
        getSocket()?.emit('call:invite', { channelId: data.channel.id });
        toast(`Звонок для ${user.displayName} отправлен`, 'success');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div
      className={cx('friend-row', status === 'offline' && 'offline')}
      onClick={() => openModal('profile', { userId: user.id })}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event, user);
      }}
    >
      <Avatar user={user} size={38} showStatus status={status} />
      <div className="friend-info">
        <span className="friend-name">{user.displayName}</span>
        <span className="friend-sub">
          {user.customStatus || `@${user.username}`}
        </span>
      </div>
      <div className="friend-actions">
        <button
          className="friend-action"
          onClick={(event) => { event.stopPropagation(); openDm(); }}
          title="Написать"
        >
          <MessageSquare size={18} />
        </button>
        <button
          className="friend-action"
          onClick={(event) => { event.stopPropagation(); call(); }}
          title="Позвонить"
        >
          <Phone size={18} />
        </button>
        <button
          className="friend-action"
          onClick={(event) => {
            event.stopPropagation();
            onMenu(event, user);
          }}
          title="Ещё"
        >
          <MoreVertical size={18} />
        </button>
      </div>
    </div>
  );
}

export default function FriendsView() {
  const friends = useApp((state) => state.friends);
  const presence = useApp((state) => state.presence);
  const setFriends = useApp((state) => state.setFriends);
  const openModal = useApp((state) => state.openModal);
  const setMobilePanel = useApp((state) => state.setMobilePanel);
  const toast = useApp((state) => state.toast);
  const mobile = useMobileClient();
  const [tab, setTab] = useState('online');
  const [query, setQuery] = useState('');
  const [addValue, setAddValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(null);

  const online = useMemo(
    () =>
      (friends.accepted || []).filter((user) => (presence[user.id] || user.status) !== 'offline'),
    [friends.accepted, presence]
  );

  const pendingUsers = useMemo(
    () => [
      ...(friends.incoming || []).map((user) => ({ user, direction: 'incoming' })),
      ...(friends.outgoing || []).map((user) => ({ user, direction: 'outgoing' })),
    ],
    [friends]
  );

  const isOnline = (user) => (presence[user.id] || user.status) !== 'offline';

  const filteredOnline = online.filter((user) =>
    !query.trim() || user.displayName.toLowerCase().includes(query.toLowerCase()) || user.username.toLowerCase().includes(query.toLowerCase())
  );

  const filteredAll = (friends.accepted || []).filter((user) =>
    !query.trim() || user.displayName.toLowerCase().includes(query.toLowerCase()) || user.username.toLowerCase().includes(query.toLowerCase())
  );

  const accept = async (user) => {
    try {
      const data = await api(`/api/friends/${user.id}/accept`, { method: 'POST' });
      if (data?.friends) setFriends(data.friends);
      toast(`${user.displayName} теперь у вас в друзьях`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const decline = async (user) => {
    try {
      const data = await api(`/api/friends/${user.id}`, { method: 'DELETE' });
      if (data?.friends) setFriends(data.friends);
      toast('Заявка отклонена', 'info');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const removeFriend = (user) => {
    openModal('confirm', {
      title: 'Удалить из друзей?',
      text: `${user.displayName} больше не будет в вашем списке друзей.`,
      confirmText: 'Удалить',
      danger: true,
      onConfirm: async () => {
        try {
          const data = await api(`/api/friends/${user.id}`, { method: 'DELETE' });
          if (data?.friends) setFriends(data.friends);
          toast('Пользователь удалён из друзей', 'info');
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    });
  };

  const block = (user) => {
    openModal('confirm', {
      title: 'Заблокировать пользователя?',
      text: `${user.displayName} не сможет писать вам и звонить.`,
      confirmText: 'Заблокировать',
      danger: true,
      onConfirm: async () => {
        try {
          const data = await api(`/api/users/${user.id}/block`, { method: 'POST' });
          if (data?.friends) setFriends(data.friends);
          toast('Пользователь заблокирован', 'info');
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    });
  };

  const unblock = async (user) => {
    try {
      const data = await api(`/api/users/${user.id}/block`, { method: 'DELETE' });
      if (data?.friends) setFriends(data.friends);
      toast('Пользователь разблокирован', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const addFriend = async (event) => {
    event.preventDefault();
    const value = addValue.trim().replace(/^@/, '');
    if (!value) return;
    setAdding(true);
    try {
      const data = await api('/api/friends/request', { method: 'POST', body: { username: value } });
      if (data?.friends) setFriends(data.friends);
      setAddValue('');
      toast(data?.accepted ? 'Заявка принята — вы теперь друзья!' : 'Заявка в друзья отправлена', 'success');
      if (data?.accepted) setTab('all');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setAdding(false);
    }
  };

  const openMenu = (event, user) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom + 4, user });
  };

  const menuItems = menu
    ? [
        {
          label: 'Открыть профиль',
          icon: <Users size={16} />,
          onClick: () => openModal('profile', { userId: menu.user.id }),
        },
        {
          label: 'Удалить из друзей',
          icon: <UserX size={16} />,
          danger: true,
          onClick: () => removeFriend(menu.user),
        },
        {
          label: 'Заблокировать',
          icon: <Ban size={16} />,
          danger: true,
          onClick: () => block(menu.user),
        },
      ]
    : [];

  const renderList = () => {
    if (tab === 'add') {
      return (
        <div className="add-friend">
          <h3>Добавить друга</h3>
          <p>Введите имя пользователя или e-mail — мы отправим заявку.</p>
          <form onSubmit={addFriend} className="add-friend-form">
            <div className="add-friend-input">
              <UserPlus size={18} />
              <input
                value={addValue}
                onChange={(event) => setAddValue(event.target.value)}
                placeholder="Имя пользователя или e-mail"
                autoFocus
              />
              <button className="btn btn-primary btn-small" disabled={adding || !addValue.trim()}>
                {adding ? 'Отправляем…' : 'Отправить заявку'}
              </button>
            </div>
          </form>
          <div className="add-friend-hint">
            <span>Введите точное имя пользователя или e-mail.</span>
          </div>
        </div>
      );
    }

    if (tab === 'pending') {
      return (
        <div className="friend-list">
          <div className="friend-section-label">
            Входящие заявки — {friends.incoming?.length || 0}
          </div>
          {(friends.incoming || []).length === 0 ? (
            <div className="friend-empty-row">Входящих заявок нет.</div>
          ) : (
            (friends.incoming || []).map((user) => (
              <div className="friend-row pending" key={user.id}>
                <Avatar user={user} size={38} />
                <div className="friend-info">
                  <span className="friend-name">{user.displayName}</span>
                  <span className="friend-sub">@{user.username} · хочет добавить вас</span>
                </div>
                <div className="friend-actions visible">
                  <button className="friend-action accept" onClick={() => accept(user)} title="Принять">
                    <Check size={18} />
                  </button>
                  <button className="friend-action danger" onClick={() => decline(user)} title="Отклонить">
                    <X size={18} />
                  </button>
                </div>
              </div>
            ))
          )}
          <div className="friend-section-label">
            Исходящие заявки — {friends.outgoing?.length || 0}
          </div>
          {(friends.outgoing || []).length === 0 ? (
            <div className="friend-empty-row">Вы не отправляли заявок.</div>
          ) : (
            (friends.outgoing || []).map((user) => (
              <div className="friend-row pending" key={user.id}>
                <Avatar user={user} size={38} />
                <div className="friend-info">
                  <span className="friend-name">{user.displayName}</span>
                  <span className="friend-sub">@{user.username} · заявка отправлена</span>
                </div>
                <div className="friend-actions visible">
                  <button className="friend-action danger" onClick={() => decline(user)} title="Отменить заявку">
                    <X size={18} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      );
    }

    if (tab === 'blocked') {
      return (
        <div className="friend-list">
          {(friends.blocked || []).length === 0 ? (
            <div className="friends-empty">
              <Ban size={40} />
              <p>Заблокированных пользователей нет.</p>
            </div>
          ) : (
            (friends.blocked || []).map((user) => (
              <div className="friend-row" key={user.id}>
                <Avatar user={user} size={38} />
                <div className="friend-info">
                  <span className="friend-name">{user.displayName}</span>
                  <span className="friend-sub">@{user.username}</span>
                </div>
                <button className="btn btn-secondary btn-small" onClick={() => unblock(user)}>
                  Разблокировать
                </button>
              </div>
            ))
          )}
        </div>
      );
    }

    const list = tab === 'online' ? filteredOnline : filteredAll;
    if (list.length === 0) {
      return (
        <div className="friends-empty">
          <Users size={42} />
          <h3>{query ? 'Никого не нашли' : tab === 'online' ? 'Пока никого нет в сети' : 'Список друзей пуст'}</h3>
          <p>
            {tab === 'online'
              ? 'Загляните позже или напишите другу личное сообщение.'
              : 'Найдите друзей по имени пользователя и начните общаться.'}
          </p>
          <button className="btn btn-primary btn-small" onClick={() => setTab('add')}>
            <UserPlus size={16} /> Добавить друга
          </button>
        </div>
      );
    }

    return (
      <div className="friend-list">
        <div className="friend-section-label">
          {tab === 'online' ? 'В сети' : 'Все друзья'} — {list.length}
        </div>
        {list.map((user) => (
          <FriendRow
            key={user.id}
            user={user}
            status={presence[user.id] || user.status || 'offline'}
            onMenu={openMenu}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="friends-view">
      <header className="friends-header">
        <div className="friends-head-top">
          <div className="friends-title">
            {mobile ? (
              <button
                type="button"
                className="icon-btn mobile-menu-btn"
                onClick={() => setMobilePanel('nav')}
                aria-label="Меню чатов"
              >
                <Menu size={21} />
              </button>
            ) : null}
            <Users size={22} />
            <h1>Друзья</h1>
            <span className="friends-subtitle">{pluralMembers(friends.accepted?.length || 0)}</span>
          </div>
          <div className="friends-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск друзей…"
            />
          </div>
        </div>
        <nav className="friends-tabs">
          {TABS.map((item) => {
            const Icon = item.icon;
            const count =
              item.id === 'pending' ? (friends.incoming?.length || 0) : 0;
            return (
              <button
                key={item.id}
                className={cx('friends-tab', tab === item.id && 'active', item.id === 'add' && 'add')}
                onClick={() => setTab(item.id)}
              >
                {Icon ? <Icon size={15} /> : null}
                {item.label}
                {count ? <span className="tab-count">{count}</span> : null}
              </button>
            );
          })}
        </nav>
      </header>
      <div className="friends-body">
        {renderList()}
        <div className="friends-tip">
          <UserCheck size={15} />
          Совет: нажмите на профиль друга, чтобы увидеть общие серверы и статус.
        </div>
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}
