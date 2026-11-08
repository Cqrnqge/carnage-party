import React, { useState } from 'react';
import { Copy, Loader2, RefreshCw, UserPlus } from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../store';
import { hasPermission } from '../../constants';
import Modal, { ModalHeader } from '../ui/Modal';
import { ServerIcon } from '../ui/Avatar';

export default function InviteModal({ serverId }) {
  const servers = useApp((state) => state.servers);
  const user = useApp((state) => state.user);
  const updateServer = useApp((state) => state.updateServer);
  const closeModal = useApp((state) => state.closeModal);
  const toast = useApp((state) => state.toast);
  const [busy, setBusy] = useState(false);
  const server = servers.find((item) => item.id === serverId);
  if (!server) return null;

  const canManage = hasPermission(server, user?.id, 'MANAGE_SERVER');

  const copy = async (value, message) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(message, 'success');
    } catch {
      toast('Не удалось скопировать', 'error');
    }
  };

  const inviteText = `Присоединяйтесь к «${server.name}» в Carnage Party! Код приглашения: ${server.inviteCode}`;

  const regenerate = async () => {
    setBusy(true);
    try {
      const data = await api(`/api/servers/${server.id}/invite/regenerate`, { method: 'POST' });
      if (data?.code) {
        updateServer({ ...server, inviteCode: data.code });
        toast('Код приглашения обновлён', 'success');
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={closeModal} className="invite-modal" showClose>
      <ModalHeader
        title={`Пригласить на «${server.name}»`}
        subtitle="Отправьте код другу — он сможет присоединиться к серверу."
      />
      <div className="invite-server">
        <ServerIcon server={server} size={56} />
        <div>
          <strong>{server.name}</strong>
          <span>{(server.members || []).length} участников · {(server.channels || []).length || ''}</span>
        </div>
      </div>
      <div className="invite-code-box">
        <span className="invite-code">{server.inviteCode}</span>
        <button className="btn btn-primary" onClick={() => copy(server.inviteCode, 'Код приглашения скопирован')}>
          <Copy size={16} /> Копировать код
        </button>
      </div>
      <button className="btn btn-secondary invite-copy-text" onClick={() => copy(inviteText, 'Приглашение скопировано')}>
        <UserPlus size={16} /> Скопировать приглашение целиком
      </button>
      {canManage ? (
        <div className="invite-regenerate">
          <span>Код можно сменить, если он попал не к тем людям.</span>
          <button className="btn btn-ghost btn-small" onClick={regenerate} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Обновить код
          </button>
        </div>
      ) : null}
    </Modal>
  );
}
