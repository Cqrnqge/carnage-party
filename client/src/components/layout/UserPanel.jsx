import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronUp, Headphones, LogOut, Mic, MicOff, Settings, VolumeX } from 'lucide-react';
import { useApp } from '../../store';
import { api } from '../../api';
import { STATUS_META, dmOther } from '../../constants';
import { cx } from '../../utils';
import Avatar from '../ui/Avatar';
import { voiceManager } from '../../voice';
import { getSocket } from '../../socket';

const STATUS_ORDER = ['online', 'idle', 'dnd', 'invisible'];

export default function UserPanel() {
  const user = useApp((state) => state.user);
  const presence = useApp((state) => state.presence);
  const voice = useApp((state) => state.voice);
  const settings = useApp((state) => state.settings);
  const updateUser = useApp((state) => state.updateUser);
  const openModal = useApp((state) => state.openModal);
  const toast = useApp((state) => state.toast);
  const logout = useApp((state) => state.logout);
  const socketConnected = useApp((state) => state.socketConnected);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const status = presence[user?.id] || user?.status || 'offline';
  const meta = STATUS_META[status] || STATUS_META.offline;

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const changeStatus = async (nextStatus) => {
    setOpen(false);
    try {
      await api('/api/users/me', { method: 'PATCH', body: { status: nextStatus } });
      updateUser({ status: nextStatus });
      toast(`Статус изменён: ${STATUS_META[nextStatus].label}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const handleMic = () => {
    if (!voice.joined) {
      toast('Сначала подключитесь к голосовому каналу', 'info');
      return;
    }
    voiceManager.toggleMute();
  };

  const handleDeafen = () => {
    if (!voice.joined) {
      toast('Сначала подключитесь к голосовому каналу', 'info');
      return;
    }
    voiceManager.toggleDeafen();
  };

  return (
    <div className="user-panel" ref={rootRef}>
      {open ? (
        <div className="user-popover">
          <div className="user-popover-head">
            <Avatar user={user} size={44} showStatus status={status} />
            <div>
              <strong>{user.displayName}</strong>
              <span>@{user.username}</span>
            </div>
          </div>
          <div className="popover-divider" />
          <div className="popover-label">Статус</div>
          {STATUS_ORDER.map((key) => (
            <button
              key={key}
              className={cx('popover-item', user.status === key && 'active')}
              onClick={() => changeStatus(key)}
            >
              <span className="status-dot-inline" style={{ background: STATUS_META[key].color }} />
              <span>{STATUS_META[key].label}</span>
              {user.status === key ? <Check size={15} className="popover-check" /> : null}
            </button>
          ))}
          <div className="popover-divider" />
          <button className="popover-item" onClick={() => { setOpen(false); openModal('settings', { tab: 'account' }); }}>
            <Settings size={16} />
            <span>Настройки пользователя</span>
          </button>
          <button
            className="popover-item"
            onClick={() => { setOpen(false); openModal('profile', { userId: user.id }); }}
          >
            <span className="popover-item-avatar"><Avatar user={user} size={18} /></span>
            <span>Мой профиль</span>
          </button>
          <div className="popover-divider" />
          <button
            className="popover-item danger"
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            <LogOut size={16} />
            <span>Выйти</span>
          </button>
        </div>
      ) : null}

      <div className="user-panel-main">
        <button className="user-info" onClick={() => setOpen((value) => !value)}>
          <Avatar user={user} size={34} showStatus status={status} />
          <div className="user-names">
            <span className="user-display-name">{user.displayName}</span>
            <span className="user-handle">
              {socketConnected ? user.customStatus || `@${user.username}` : 'Соединение…'}
            </span>
          </div>
          <ChevronUp size={15} className={cx('user-chevron', open && 'open')} />
        </button>
        <div className="user-actions">
          <button
            className={cx('icon-btn user-action', voice.muted && 'danger')}
            onClick={handleMic}
            title={voice.muted ? 'Включить микрофон' : 'Выключить микрофон'}
            data-tooltip={voice.muted ? 'Включить микрофон' : 'Выключить микрофон'}
          >
            {voice.muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button
            className={cx('icon-btn user-action', voice.deafened && 'danger')}
            onClick={handleDeafen}
            title={voice.deafened ? 'Выйти из режима «не слышу»' : 'Не слышать других'}
            data-tooltip={voice.deafened ? 'Включить звук' : 'Не слышать других'}
          >
            {voice.deafened ? <VolumeX size={18} /> : <Headphones size={18} />}
          </button>
          <button
            className="icon-btn user-action"
            onClick={() => openModal('settings', { tab: 'account' })}
            title="Настройки"
            data-tooltip="Настройки"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>
      <div className="user-panel-status" style={{ color: meta.color }}>
        <span className="status-dot-inline" style={{ background: meta.color }} />
        {meta.label}
        {!socketConnected ? <span className="offline-hint">· нет связи</span> : null}
      </div>
    </div>
  );
}
