import React, { useRef, useState } from 'react';
import { Camera, Check, Loader2, MessageSquare, Phone, Users } from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../store';
import { dmOther } from '../../constants';
import { readImageFile } from '../../utils';
import { voiceManager } from '../../voice';
import { getSocket } from '../../socket';
import Avatar from '../ui/Avatar';
import Modal, { FormField, ModalHeader } from '../ui/Modal';

export default function DmSettingsModal({ channelId }) {
  const dms = useApp((state) => state.dms);
  const me = useApp((state) => state.user);
  const updateDm = useApp((state) => state.updateDm);
  const setActive = useApp((state) => state.setActive);
  const openModal = useApp((state) => state.openModal);
  const closeModal = useApp((state) => state.closeModal);
  const toast = useApp((state) => state.toast);
  const channel = dms.find((item) => item.id === channelId);
  const other = channel ? dmOther(channel, me?.id) : null;
  const isGroup = (channel?.memberIds || []).length > 2;
  const isOwner = channel?.ownerId === me?.id;
  const [name, setName] = useState(channel?.name || '');
  const [icon, setIcon] = useState(channel?.icon || null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  if (!channel) return null;

  const pickIcon = async (file) => {
    if (!file) return;
    try {
      const url = await readImageFile(file, { maxSize: 512, maxBytes: 500_000, square: true });
      setIcon(url);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (!isGroup) return;
    setBusy(true);
    try {
      const data = await api(`/api/dms/${channel.id}`, {
        method: 'PATCH',
        body: { name: name.trim() || null, icon },
      });
      if (data?.channel) updateDm(data.channel);
      toast('Диалог обновлён', 'success');
      closeModal();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const call = async () => {
    setActive({ type: 'channel', id: channel.id });
    closeModal();
    await voiceManager.join(channel.id);
    getSocket()?.emit('call:invite', { channelId: channel.id });
  };

  return (
    <Modal onClose={closeModal} className="dm-settings-modal" showClose>
      <ModalHeader
        title={isGroup ? 'Настройки группы' : 'О диалоге'}
        subtitle={isGroup ? `${(channel.memberIds || []).length} участников` : `@${other?.username || ''}`}
      />
      {isGroup ? (
        <form onSubmit={save} className="modal-form">
          <div className="server-icon-editor">
            <Avatar user={{ displayName: name || 'Группа', avatar: icon, username: channel.id }} size={76} />
            <div>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => fileRef.current?.click()}>
                <Camera size={15} /> Иконка группы
              </button>
              {icon ? <button type="button" className="btn btn-ghost btn-small" onClick={() => setIcon(null)}>Убрать</button> : null}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => { pickIcon(event.target.files?.[0]); event.target.value = ''; }} />
          </div>
          <FormField label="Название группы">
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} placeholder="Без названия" disabled={!isOwner} />
          </FormField>
          {!isOwner ? <p className="form-hint">Менять название и иконку может только создатель группы.</p> : null}
          <div className="group-members">
            {(channel.members || []).map((member) => (
              <div className="group-member" key={member.id}>
                <Avatar user={member} size={30} />
                <span>{member.displayName}{member.id === me?.id ? ' (вы)' : ''}</span>
                {member.id === channel.ownerId ? <span className="member-role-label">Создатель</span> : null}
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={closeModal}>Отмена</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !isOwner}>
              {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Сохранить
            </button>
          </div>
        </form>
      ) : (
        <div className="dm-about">
          <div className="dm-about-head">
            <Avatar user={other} size={76} />
            <div>
              <strong>{other?.displayName}</strong>
              <span>@{other?.username}</span>
            </div>
          </div>
          <p>{other?.bio || 'Пользователь ещё не рассказал о себе.'}</p>
          <div className="dm-about-actions">
            <button className="btn btn-secondary" onClick={() => { closeModal(); openModal('profile', { userId: other?.id }); }}>
              <Users size={16} /> Профиль
            </button>
            <button className="btn btn-primary" onClick={call}>
              <Phone size={16} /> Позвонить
            </button>
          </div>
          <div className="settings-note">
            <MessageSquare size={16} />
            <span>История личных сообщений видна только участникам диалога.</span>
          </div>
        </div>
      )}
    </Modal>
  );
}
