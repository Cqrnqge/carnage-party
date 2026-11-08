import React, { useEffect, useState } from 'react';
import {
  Ban,
  CalendarDays,
  Check,
  Loader2,
  MessageSquare,
  Phone,
  ShieldCheck,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { api, assetUrl } from '../../api';
import { useApp } from '../../store';
import { getSocket } from '../../socket';
import { voiceManager } from '../../voice';
import { STATUS_META } from '../../constants';
import { cx, formatMembership, gradientStyle } from '../../utils';
import Avatar from '../ui/Avatar';
import Modal from '../ui/Modal';

export default function ProfileModal({ userId }) {
  const me = useApp((state) => state.user);
  const presence = useApp((state) => state.presence);
  const setFriends = useApp((state) => state.setFriends);
  const openModal = useApp((state) => state.openModal);
  const closeModal = useApp((state) => state.closeModal);
  const addChannel = useApp((state) => state.addChannel);
  const setActive = useApp((state) => state.setActive);
  const toast = useApp((state) => state.toast);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const isMe = userId === me?.id;

  const load = async () => {
    setLoading(true);
    try {
      const result = await api(`/api/users/${userId}`);
      setData(result);
    } catch (err) {
      toast(err.message, 'error');
      closeModal();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [userId]);

  if (loading) {
    return (
      <Modal onClose={closeModal} className="profile-modal" showClose>
        <div className="modal-loading"><Loader2 size={24} className="spin" /> Загружаем профиль…</div>
      </Modal>
    );
  }
  if (!data?.user) return null;

  const user = data.user;
  const relationship = data.relationship;
  const status = presence[user.id] || user.status || 'offline';
  const meta = STATUS_META[status] || STATUS_META.offline;
  const isFriend = relationship?.status === 'accepted';
  const incoming = relationship?.status === 'pending' && relationship.direction === 'incoming';
  const outgoing = relationship?.status === 'pending' && relationship.direction === 'outgoing';
  const blocked = relationship?.status === 'blocked';
  const blockedByMe = blocked && relationship.blockedByMe;

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openDm = (call = false) =>
    run(async () => {
      const result = await api('/api/dms', { method: 'POST', body: { userId: user.id } });
      if (!result?.channel) return;
      addChannel(result.channel);
      setActive({ type: 'channel', id: result.channel.id });
      closeModal();
      if (call) {
        await voiceManager.join(result.channel.id);
        getSocket()?.emit('call:invite', { channelId: result.channel.id });
      }
    });

  const addFriend = () =>
    run(async () => {
      const result = await api('/api/friends/request', { method: 'POST', body: { username: user.username } });
      if (result?.friends) setFriends(result.friends);
      toast(result?.accepted ? 'Теперь вы друзья!' : 'Заявка отправлена', 'success');
      await load();
    });

  const acceptFriend = () =>
    run(async () => {
      const result = await api(`/api/friends/${user.id}/accept`, { method: 'POST' });
      if (result?.friends) setFriends(result.friends);
      toast('Заявка принята', 'success');
      await load();
    });

  const removeFriend = () =>
    run(async () => {
      const result = await api(`/api/friends/${user.id}`, { method: 'DELETE' });
      if (result?.friends) setFriends(result.friends);
      toast('Пользователь удалён из друзей', 'info');
      await load();
    });

  const blockUser = () =>
    run(async () => {
      const result = await api(`/api/users/${user.id}/block`, { method: 'POST' });
      if (result?.friends) setFriends(result.friends);
      toast('Пользователь заблокирован', 'info');
      await load();
    });

  const unblockUser = () =>
    run(async () => {
      const result = await api(`/api/users/${user.id}/block`, { method: 'DELETE' });
      if (result?.friends) setFriends(result.friends);
      toast('Пользователь разблокирован', 'success');
      await load();
    });

  return (
    <Modal onClose={closeModal} className="profile-modal" showClose overlayClassName="profile-overlay">
      <div
        className="profile-banner"
        style={
          user.banner
            ? user.banner.startsWith('#')
              ? { background: user.banner }
              : { backgroundImage: `url(${assetUrl(user.banner)})` }
            : { ...gradientStyle(user), filter: 'saturate(1.05)' }
        }
      >
        <span className="profile-banner-glow" />
      </div>

      <div className="profile-head">
        <Avatar user={user} size={92} showStatus status={status} className="profile-avatar" />
        <div className="profile-head-main">
          <div className="profile-name-row">
            <h2>{user.displayName}</h2>
            {isFriend ? <span className="profile-friend-badge"><Check size={12} /> Друг</span> : null}
          </div>
          <span className="profile-username">@{user.username}</span>
          <span className="profile-status" style={{ color: meta.color }}>
            <span className="status-dot-inline" style={{ background: meta.color }} /> {meta.label}
            {user.customStatus ? <span className="profile-custom"> · {user.customStatus}</span> : null}
          </span>
        </div>
        {isMe ? (
          <button className="btn btn-secondary btn-small" onClick={() => openModal('settings', { tab: 'profile' })}>
            Редактировать
          </button>
        ) : null}
      </div>

      <div className="profile-body">
        <div className="profile-section">
          <h3>О пользователе</h3>
          <p className={cx('profile-bio', !user.bio && 'muted')}>
            {user.bio || 'Пользователь ещё не рассказал о себе.'}
          </p>
          <div className="profile-meta">
            <span><CalendarDays size={15} /> В Carnage Party с {formatMembership(user.createdAt)}</span>
            {user.email && isMe ? <span>E-mail: {user.email}</span> : null}
          </div>
        </div>

        {data.mutualServers?.length ? (
          <div className="profile-section">
            <h3>Общие серверы — {data.mutualServers.length}</h3>
            <div className="mutual-servers">
              {data.mutualServers.map((server) => (
                <span className="mutual-server" key={server.id}>
                  <span className="mutual-server-icon" style={gradientStyle({ accentColor: server.accentColor, username: server.name })}>
                    {(server.name || '?').slice(0, 1).toUpperCase()}
                  </span>
                  {server.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {!isMe ? (
          <div className="profile-actions">
            {isFriend || data.mutualServers?.length ? (
              <>
                <button className="btn btn-primary" onClick={() => openDm(false)} disabled={busy}>
                  <MessageSquare size={17} /> Написать
                </button>
                <button className="btn btn-secondary" onClick={() => openDm(true)} disabled={busy}>
                  <Phone size={17} /> Позвонить
                </button>
              </>
            ) : null}
            {!relationship ? (
              <button className="btn btn-secondary" onClick={addFriend} disabled={busy}>
                <UserPlus size={17} /> Добавить в друзья
              </button>
            ) : null}
            {incoming ? (
              <button className="btn btn-primary" onClick={acceptFriend} disabled={busy}>
                <Check size={17} /> Принять заявку
              </button>
            ) : null}
            {outgoing ? (
              <button className="btn btn-secondary" onClick={removeFriend} disabled={busy}>
                <X size={17} /> Отменить заявку
              </button>
            ) : null}
            {isFriend ? (
              <button className="btn btn-ghost" onClick={removeFriend} disabled={busy}>
                <UserMinus size={17} /> Удалить из друзей
              </button>
            ) : null}
            {blockedByMe ? (
              <button className="btn btn-secondary" onClick={unblockUser} disabled={busy}>
                <ShieldCheck size={17} /> Разблокировать
              </button>
            ) : !blocked ? (
              <button className="btn btn-ghost danger-text" onClick={blockUser} disabled={busy}>
                <Ban size={17} /> Заблокировать
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
