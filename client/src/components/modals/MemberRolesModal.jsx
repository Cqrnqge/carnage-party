import React, { useMemo, useState } from 'react';
import { Check, Loader2, Shield } from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../store';
import { hasPermission, sortedRoles } from '../../constants';
import { cx } from '../../utils';
import Avatar from '../ui/Avatar';
import Modal, { ModalHeader } from '../ui/Modal';

export default function MemberRolesModal({ serverId, userId }) {
  const servers = useApp((state) => state.servers);
  const me = useApp((state) => state.user);
  const updateServer = useApp((state) => state.updateServer);
  const openModal = useApp((state) => state.openModal);
  const closeModal = useApp((state) => state.closeModal);
  const toast = useApp((state) => state.toast);
  const server = servers.find((item) => item.id === serverId);
  const member = server?.members?.find((item) => item.id === userId);
  const [selected, setSelected] = useState(member?.roleIds || []);
  const [busy, setBusy] = useState(false);

  const roles = useMemo(
    () => sortedRoles(server).filter((role) => !role.system),
    [server]
  );
  const isOwner = server?.ownerId === me?.id;
  const canManage = Boolean(server) && (isOwner || hasPermission(server, me?.id, 'MANAGE_ROLES'));

  const createRole = () => {
    closeModal();
    openModal('serverSettings', { serverId: server.id, initialTab: 'roles' });
  };

  if (!server || !member) return null;

  const toggle = (roleId) => {
    setSelected((current) =>
      current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId]
    );
  };

  const save = async () => {
    setBusy(true);
    try {
      const data = await api(`/api/servers/${server.id}/members/${member.id}/roles`, {
        method: 'PUT',
        body: { roleIds: selected },
      });
      if (data?.server) updateServer(data.server);
      toast('Роли участника обновлены', 'success');
      closeModal();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={closeModal} className="roles-modal" showClose>
      <ModalHeader
        title="Роли участника"
        subtitle={
          isOwner
            ? 'Вы создатель сервера: можете выдать участнику любую роль.'
            : 'Выберите роли, которые будут назначены пользователю.'
        }
      />
      <div className="roles-target">
        <Avatar user={member} size={46} />
        <div>
          <strong>{member.displayName}</strong>
          <span>@{member.username}</span>
        </div>
      </div>
      {roles.length === 0 ? (
        <div className="pins-empty">
          <Shield size={36} />
          <h3>На сервере нет пользовательских ролей</h3>
          <p>
            {canManage
              ? 'Создайте первую роль — после этого её можно будет выдать этому участнику.'
              : 'Создайте роли в настройках сервера на вкладке «Роли».'}
          </p>
          {canManage ? (
            <button type="button" className="btn btn-primary btn-small" onClick={createRole}>
              <Shield size={14} /> Создать роль
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="role-check-list">
            {roles.map((role) => {
              const active = selected.includes(role.id);
              return (
                <button
                  key={role.id}
                  className={cx('role-check-row', active && 'active')}
                  onClick={() => toggle(role.id)}
                >
                  <span className="role-color-dot" style={{ background: role.color }} />
                  <span className="role-check-name">{role.name}</span>
                  <span className="role-check-perms">{role.permissions?.length || 0} прав</span>
                  <span className={cx('dm-check', active && 'active')}>{active ? <Check size={14} /> : null}</span>
                </button>
              );
            })}
          </div>
          {canManage ? (
            <button type="button" className="roles-manage-link" onClick={createRole}>
              <Shield size={13} /> Управление ролями сервера
            </button>
          ) : null}
        </>
      )}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={closeModal}>Отмена</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !canManage}>
          {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Сохранить роли
        </button>
      </div>
    </Modal>
  );
}
