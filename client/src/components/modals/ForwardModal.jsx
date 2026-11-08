import React, { useMemo, useState } from 'react';
import { Bookmark, Check, Forward, Hash, Loader2, Search } from 'lucide-react';
import { api } from '../../api';
import { useApp, channelTitle } from '../../store';
import { cx, formatTime } from '../../utils';
import Avatar from '../ui/Avatar';
import Modal, { ModalHeader } from '../ui/Modal';

const EMPTY_LIST = Object.freeze([]);

export default function ForwardModal({ message }) {
  const user = useApp((state) => state.user);
  const dms = useApp((state) => state.dms ?? EMPTY_LIST);
  const channels = useApp((state) => state.channels ?? EMPTY_LIST);
  const servers = useApp((state) => state.servers ?? EMPTY_LIST);
  const closeModal = useApp((state) => state.closeModal);
  const toast = useApp((state) => state.toast);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);

  const savedChannel = useMemo(
    () => dms.find((channel) => channel.saved && (channel.memberIds || []).includes(user?.id)),
    [dms, user?.id]
  );

  const orderedServers = useMemo(() => {
    const result = [];
    for (const server of servers) {
      const list = channels
        .filter((channel) => channel.serverId === server.id && channel.type !== 'voice')
        .sort((a, b) => (a.position || 0) - (b.position || 0));
      if (list.length) result.push({ server, channels: list });
    }
    return result;
  }, [servers, channels]);

  const privateChats = useMemo(() => {
    const list = dms.filter((channel) => channel.id !== savedChannel?.id);
    return [...list].sort((a, b) => {
      const at = a.lastMessage?.createdAt || a.createdAt || '';
      const bt = b.lastMessage?.createdAt || b.createdAt || '';
      return String(bt).localeCompare(String(at));
    });
  }, [dms, savedChannel?.id]);

  const normalized = query.trim().toLowerCase();

  const matchChannel = (channel, extra = '') => {
    if (!normalized) return true;
    const title = channelTitle({ user }, channel) || channel.name || '';
    return `${title} ${extra}`.toLowerCase().includes(normalized);
  };

  const filteredSaved = savedChannel && matchChannel(savedChannel, 'избранное saved') ? [savedChannel] : [];
  const filteredPrivate = privateChats.filter((channel) => {
    const names = (channel.members || []).map((member) => `${member.displayName} ${member.username}`).join(' ');
    return matchChannel(channel, names);
  });
  const filteredServers = orderedServers
    .map((group) => ({
      server: group.server,
      channels: group.channels.filter((channel) => matchChannel(channel, group.server.name)),
    }))
    .filter((group) => group.channels.length);

  const total = filteredSaved.length + filteredPrivate.length + filteredServers.reduce((sum, g) => sum + g.channels.length, 0);

  const toggle = (channel) => {
    setSelected((current) => {
      if (current.includes(channel.id)) return current.filter((id) => id !== channel.id);
      return [...current, channel.id];
    });
  };

  const submit = async () => {
    if (!selected.length || !message) return;
    setBusy(true);
    let sent = 0;
    let failed = 0;
    for (const channelId of selected) {
      try {
        await api(`/api/messages/${message.id}/forward`, { method: 'POST', body: { channelId } });
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    setBusy(false);
    if (sent) {
      toast(
        sent === 1 ? 'Сообщение переслано' : `Сообщение переслано в ${sent} ${sent < 5 ? 'чата' : 'чатов'}`,
        'success'
      );
    }
    if (failed) toast(`Не удалось переслать в ${failed} чат(ов)`, 'error');
    closeModal();
  };

  const renderRow = (channel, extraClass = '') => {
    const active = selected.includes(channel.id);
    const isSaved = Boolean(channel.saved);
    const other = !isSaved && channel.type === 'dm'
      ? (channel.members || []).find((member) => member.id !== user?.id)
      : null;
    const isGroup = channel.type === 'dm' && !other;
    return (
      <button
        type="button"
        key={channel.id}
        className={cx('forward-row', active && 'active', extraClass)}
        onClick={() => toggle(channel)}
      >
        {isSaved ? (
          <span className="forward-row-icon saved"><Bookmark size={17} /></span>
        ) : other ? (
          <Avatar user={other} size={32} />
        ) : isGroup ? (
          <span className="forward-row-icon"><Hash size={17} /></span>
        ) : (
          <span className="forward-row-icon"><Hash size={17} /></span>
        )}
        <span className="forward-row-name">
          <strong>{channelTitle({ user }, channel) || channel.name}</strong>
          <small>
            {isSaved
              ? 'Личные заметки'
              : other
                ? `@${other.username}`
                : isGroup
                  ? `${(channel.members || []).length} участника(ов)`
                  : channel.type === 'voice'
                    ? 'Голосовой канал'
                    : 'Текстовый канал'}
          </small>
        </span>
        <span className={cx('dm-check', active && 'active')}>{active ? <Check size={14} /> : null}</span>
      </button>
    );
  };

  const attachmentCount = (message?.attachments || []).length;
  const previewText = message?.content?.trim() || (attachmentCount ? 'Вложение' : 'Сообщение');

  return (
    <Modal onClose={closeModal} className="forward-modal" showClose>
      <ModalHeader
        title="Переслать сообщение"
        subtitle="Выберите один или несколько чатов — сообщение будет отправлено от вашего имени."
      />
      <div className="forward-preview">
        <Forward size={15} />
        <span className="forward-preview-text">{previewText}</span>
        {attachmentCount ? <span className="forward-preview-badge">+{attachmentCount} файл(ов)</span> : null}
        <time>{formatTime(message?.createdAt)}</time>
      </div>
      <div className="dm-search">
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск чатов и каналов…"
          autoFocus
        />
      </div>
      <div className="forward-list">
        {!total ? <div className="friend-empty-row">Ничего не нашли.</div> : null}
        {filteredSaved.length ? (
          <div className="forward-group">
            <div className="forward-group-title">Избранное</div>
            {filteredSaved.map((channel) => renderRow(channel))}
          </div>
        ) : null}
        {filteredPrivate.length ? (
          <div className="forward-group">
            <div className="forward-group-title">Личные сообщения</div>
            {filteredPrivate.map((channel) => renderRow(channel))}
          </div>
        ) : null}
        {filteredServers.map((group) => (
          <div className="forward-group" key={group.server.id}>
            <div className="forward-group-title">{group.server.name}</div>
            {group.channels.map((channel) => renderRow(channel))}
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <span className="forward-counter">
          {selected.length ? `Выбрано: ${selected.length}` : 'Ничего не выбрано'}
        </span>
        <button type="button" className="btn btn-ghost" onClick={closeModal} disabled={busy}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={!selected.length || busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <Forward size={16} />}
          {busy ? 'Пересылаем…' : `Переслать${selected.length > 1 ? ` (${selected.length})` : ''}`}
        </button>
      </div>
    </Modal>
  );
}
