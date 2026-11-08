import React, { useMemo, useState } from 'react';
import { Check, Loader2, MessageSquarePlus, Search, Users } from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../store';
import { cx } from '../../utils';
import Avatar from '../ui/Avatar';
import Modal, { FormField, ModalHeader } from '../ui/Modal';

const EMPTY_FRIENDS = Object.freeze([]);

export default function NewDmModal() {
  const friends = useApp((state) => state.friends.accepted ?? EMPTY_FRIENDS);
  const presence = useApp((state) => state.presence);
  const addChannel = useApp((state) => state.addChannel);
  const setActive = useApp((state) => state.setActive);
  const closeModal = useApp((state) => state.closeModal);
  const toast = useApp((state) => state.toast);
  const [selected, setSelected] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(
    () =>
      friends.filter(
        (user) =>
          !query.trim() ||
          user.displayName.toLowerCase().includes(query.toLowerCase()) ||
          user.username.toLowerCase().includes(query.toLowerCase())
      ),
    [friends, query]
  );

  const toggle = (user) => {
    setSelected((current) => {
      if (current.some((item) => item.id === user.id)) {
        return current.filter((item) => item.id !== user.id);
      }
      if (current.length >= 9) {
        toast('В группе может быть до 10 участников', 'error');
        return current;
      }
      return [...current, user];
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!selected.length) return;
    setBusy(true);
    try {
      const data = await api('/api/dms', {
        method: 'POST',
        body: {
          userIds: selected.map((user) => user.id),
          name: selected.length > 1 ? groupName.trim() || null : null,
        },
      });
      if (data?.channel) {
        addChannel(data.channel);
        setActive({ type: 'channel', id: data.channel.id });
      }
      closeModal();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={closeModal} className="new-dm-modal" showClose>
      <ModalHeader
        title="Создать диалог"
        subtitle="Выберите друзей для личной переписки или группового чата."
      />
      <form onSubmit={submit} className="modal-form">
        <div className="dm-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск друзей…" />
        </div>
        {selected.length ? (
          <div className="selected-chips">
            {selected.map((user) => (
              <button type="button" key={user.id} className="selected-chip" onClick={() => toggle(user)}>
                <Avatar user={user} size={18} />
                {user.displayName}
                <span>×</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="dm-friend-list">
          {filtered.length === 0 ? (
            <div className="friend-empty-row">
              {friends.length ? 'Никого не нашли.' : 'У вас пока нет друзей — добавьте их во вкладке «Друзья».'}
            </div>
          ) : (
            filtered.map((user) => {
              const active = selected.some((item) => item.id === user.id);
              return (
                <button type="button" key={user.id} className={cx('dm-friend-row', active && 'active')} onClick={() => toggle(user)}>
                  <Avatar user={user} size={34} showStatus status={presence[user.id] || user.status} />
                  <span className="dm-friend-name">
                    <strong>{user.displayName}</strong>
                    <small>@{user.username}</small>
                  </span>
                  <span className={cx('dm-check', active && 'active')}>{active ? <Check size={14} /> : null}</span>
                </button>
              );
            })
          )}
        </div>
        {selected.length > 1 ? (
          <FormField label="Название группы" hint="Необязательно — можно оставить пустым">
            <input value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={64} placeholder="Например: Ночной созвон" />
          </FormField>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={closeModal}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={!selected.length || busy}>
            {busy ? <Loader2 size={16} className="spin" /> : selected.length > 1 ? <Users size={16} /> : <MessageSquarePlus size={16} />}
            {busy ? 'Создаём…' : selected.length > 1 ? `Создать группу (${selected.length})` : 'Начать диалог'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
