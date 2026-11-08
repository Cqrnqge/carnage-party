import React, { useState } from 'react';
import { Ban, Loader2 } from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../store';
import Avatar from '../ui/Avatar';
import Modal, { FormField, ModalHeader } from '../ui/Modal';

export default function BanMemberModal({ serverId, userId }) {
  const servers = useApp((state) => state.servers);
  const closeModal = useApp((state) => state.closeModal);
  const toast = useApp((state) => state.toast);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const server = servers.find((item) => item.id === serverId);
  const member = server?.members?.find((item) => item.id === userId);

  if (!server || !member) return null;

  const ban = async () => {
    setBusy(true);
    try {
      await api(`/api/servers/${server.id}/bans`, {
        method: 'POST',
        body: { userId, reason: reason.trim() },
      });
      toast(`${member.displayName} забанен на сервере`, 'success');
      closeModal();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={closeModal} className="ban-modal" showClose>
      <ModalHeader
        title={`Забанить ${member.displayName}`}
        subtitle="Пользователь не сможет вернуться на сервер по приглашению."
      />
      <div className="ban-user">
        <Avatar user={member} size={48} />
        <div>
          <strong>{member.displayName}</strong>
          <span>@{member.username}</span>
        </div>
      </div>
      <FormField label="Причина бана" hint="Видна в списке банов. Необязательно.">
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={200} placeholder="Например: нарушение правил" />
      </FormField>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={closeModal}>Отмена</button>
        <button className="btn btn-danger" onClick={ban} disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <Ban size={16} />}
          {busy ? 'Баним…' : 'Забанить'}
        </button>
      </div>
    </Modal>
  );
}
