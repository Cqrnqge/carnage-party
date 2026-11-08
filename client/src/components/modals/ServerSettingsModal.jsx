import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Camera,
  Check,
  Crown,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../store';
import { PERMISSIONS, SERVER_ACCENTS, hasPermission, sortedRoles } from '../../constants';
import { cx, formatFullDate, readIconFile } from '../../utils';
import Avatar, { ServerIcon } from '../ui/Avatar';
import Modal, { FormField, ModalHeader } from '../ui/Modal';

const TABS = [
  { id: 'overview', label: 'Обзор' },
  { id: 'roles', label: 'Роли' },
  { id: 'members', label: 'Участники' },
  { id: 'bans', label: 'Баны' },
  { id: 'danger', label: 'Опасная зона' },
];

function RoleEditor({ server, role, onSave, onDelete, onCancel, busy }) {
  const isNew = !role?.id;
  const [name, setName] = useState(role?.name || '');
  const [color, setColor] = useState(role?.color || '#5865f2');
  const [hoist, setHoist] = useState(Boolean(role?.hoist));
  const [permissions, setPermissions] = useState(role?.permissions || []);

  const togglePermission = (key) => {
    setPermissions((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  };

  return (
    <div className="role-editor">
      <div className="role-editor-head">
        <span className="role-color-dot" style={{ background: color }} />
        <strong>{isNew ? 'Новая роль' : role.name}</strong>
        <button className="icon-btn tiny" onClick={onCancel} title="Закрыть редактор">×</button>
      </div>
      <div className="settings-form-grid">
        <FormField label="Название роли">
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} disabled={role?.system} />
        </FormField>
        <FormField label="Цвет">
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
        </FormField>
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={hoist} onChange={(event) => setHoist(event.target.checked)} />
        <span>Показывать роль отдельной группой в списке участников</span>
      </label>
      <div className="settings-label">Права роли</div>
      <div className="permission-grid">
        {PERMISSIONS.map((permission) => (
          <label key={permission.key} className={cx('permission-item', permission.danger && 'danger')}>
            <input
              type="checkbox"
              checked={permissions.includes(permission.key)}
              onChange={() => togglePermission(permission.key)}
            />
            <span>
              <strong>{permission.label}</strong>
              <small>{permission.hint}</small>
            </span>
          </label>
        ))}
      </div>
      <div className="modal-actions split">
        {!isNew && !role.system ? (
          <button className="btn btn-danger" onClick={onDelete}><Trash2 size={15} /> Удалить роль</button>
        ) : <span />}
        <div className="modal-actions-right">
          <button className="btn btn-ghost" onClick={onCancel}>Отмена</button>
          <button
            className="btn btn-primary"
            disabled={busy || !name.trim()}
            onClick={() => onSave({ name: name.trim(), color, hoist, permissions })}
          >
            {busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Сохранить роль
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ServerSettingsModal({ serverId }) {
  const servers = useApp((state) => state.servers);
  const me = useApp((state) => state.user);
  const updateServer = useApp((state) => state.updateServer);
  const removeServer = useApp((state) => state.removeServer);
  const setActive = useApp((state) => state.setActive);
  const closeModal = useApp((state) => state.closeModal);
  const toast = useApp((state) => state.toast);
  const server = servers.find((item) => item.id === serverId);

  const [tab, setTab] = useState('overview');
  const [name, setName] = useState(server?.name || '');
  const [icon, setIcon] = useState(server?.icon || null);
  const [accentColor, setAccentColor] = useState(server?.accentColor || '#5865f2');
  const [saving, setSaving] = useState(false);
  const iconRef = useRef(null);

  const [editingRole, setEditingRole] = useState(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [pendingRoleDelete, setPendingRoleDelete] = useState(null);

  const [memberEditor, setMemberEditor] = useState(null);
  const [memberBusy, setMemberBusy] = useState(false);

  const [bans, setBans] = useState(null);
  const [bansLoading, setBansLoading] = useState(false);
  const [transferTo, setTransferTo] = useState('');

  const isOwner = server?.ownerId === me?.id;
  const canManage = server ? hasPermission(server, me?.id, 'MANAGE_SERVER') : false;
  const canRoles = server ? hasPermission(server, me?.id, 'MANAGE_ROLES') : false;
  const canBans = server ? hasPermission(server, me?.id, 'BAN_MEMBERS') : false;
  const canKick = server ? hasPermission(server, me?.id, 'KICK_MEMBERS') : false;

  useEffect(() => {
    if (tab !== 'bans' || !server || bans !== null) return;
    setBansLoading(true);
    api(`/api/servers/${server.id}/bans`)
      .then((data) => setBans(data.bans || []))
      .catch((err) => toast(err.message, 'error'))
      .finally(() => setBansLoading(false));
  }, [tab, server?.id]);

  if (!server) return null;

  const saveOverview = async () => {
    if (name.trim().length < 2) return toast('Название сервера должно быть не короче 2 символов', 'error');
    setSaving(true);
    try {
      const data = await api(`/api/servers/${server.id}`, {
        method: 'PATCH',
        body: { name: name.trim(), icon, accentColor },
      });
      if (data?.server) updateServer(data.server);
      toast('Настройки сервера сохранены', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const pickIcon = async (file) => {
    if (!file || !canManage) return;
    try {
      const url = await readIconFile(file, { maxSize: 512, maxBytes: 600_000 });
      setIcon(url);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const saveRole = async (payload) => {
    setRoleBusy(true);
    try {
      if (editingRole?.id) {
        await api(`/api/servers/${server.id}/roles/${editingRole.id}`, { method: 'PATCH', body: payload });
      } else {
        await api(`/api/servers/${server.id}/roles`, { method: 'POST', body: payload });
      }
      const data = await api('/api/bootstrap');
      const fresh = data.servers?.find((item) => item.id === server.id);
      if (fresh) updateServer(fresh);
      setEditingRole(null);
      toast('Роль сохранена', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRoleBusy(false);
    }
  };

  const deleteRole = async (role) => {
    setRoleBusy(true);
    try {
      await api(`/api/servers/${server.id}/roles/${role.id}`, { method: 'DELETE' });
      const data = await api('/api/bootstrap');
      const fresh = data.servers?.find((item) => item.id === server.id);
      if (fresh) updateServer(fresh);
      setEditingRole(null);
      setPendingRoleDelete(null);
      toast('Роль удалена', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRoleBusy(false);
    }
  };

  const saveMemberRoles = async () => {
    if (!memberEditor) return;
    setMemberBusy(true);
    try {
      const data = await api(`/api/servers/${server.id}/members/${memberEditor.userId}/roles`, {
        method: 'PUT',
        body: { roleIds: memberEditor.roleIds },
      });
      if (data?.server) updateServer(data.server);
      toast('Роли участника обновлены', 'success');
      setMemberEditor(null);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setMemberBusy(false);
    }
  };

  const kickMember = (member) => {
    useApp.getState().openModal('confirm', {
      title: 'Исключить участника?',
      text: `${member.displayName} будет удалён с сервера.`,
      confirmText: 'Исключить',
      danger: true,
      onConfirm: async () => {
        await api(`/api/servers/${server.id}/members/${member.id}`, { method: 'DELETE' });
        toast('Участник исключён', 'success');
      },
    });
  };

  const banMember = (member) => {
    useApp.getState().openModal('banMember', { serverId: server.id, userId: member.id });
  };

  const unban = async (userId) => {
    try {
      await api(`/api/servers/${server.id}/bans/${userId}`, { method: 'DELETE' });
      setBans((current) => (current || []).filter((ban) => ban.userId !== userId));
      toast('Пользователь разбанен', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const transferOwnership = async () => {
    if (!transferTo) return;
    const target = server.members.find((member) => member.id === transferTo);
    useApp.getState().openModal('confirm', {
      title: 'Передать владение сервером?',
      text: `Владельцем сервера станет ${target?.displayName}. Вы потеряете часть прав.`,
      confirmText: 'Передать',
      danger: true,
      onConfirm: async () => {
        const data = await api(`/api/servers/${server.id}/transfer`, {
          method: 'POST',
          body: { userId: transferTo },
        });
        if (data?.server) updateServer(data.server);
        toast('Владение передано', 'success');
      },
    });
  };

  const deleteServer = () => {
    useApp.getState().openModal('confirm', {
      title: 'Удалить сервер навсегда?',
      text: `Сервер «${server.name}», все каналы и сообщения будут удалены без возможности восстановления.`,
      confirmText: 'Удалить сервер',
      danger: true,
      onConfirm: async () => {
        await api(`/api/servers/${server.id}`, { method: 'DELETE' });
        removeServer(server.id);
        toast('Сервер удалён', 'info');
      },
    });
  };

  const leaveServer = () => {
    useApp.getState().openModal('confirm', {
      title: 'Покинуть сервер?',
      text: `Вы покинете «${server.name}». Вернуться можно будет по приглашению.`,
      confirmText: 'Покинуть',
      danger: true,
      onConfirm: async () => {
        await api(`/api/servers/${server.id}/leave`, { method: 'POST' });
        removeServer(server.id);
        setActive({ type: 'friends' });
        toast('Вы покинули сервер', 'info');
      },
    });
  };

  const nonSystemRoles = sortedRoles(server).filter((role) => !role.system);

  return (
    <Modal onClose={closeModal} className="server-settings-modal" showClose>
      <div className="server-settings-layout">
        <aside className="server-settings-side">
          <div className="server-settings-brand">
            <ServerIcon server={server} size={44} />
            <div>
              <strong>{server.name}</strong>
              <span>Настройки сервера</span>
            </div>
          </div>
          {TABS.map((item) => (
            <button
              key={item.id}
              className={cx('settings-nav-item', tab === item.id && 'active', item.id === 'danger' && 'danger')}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </aside>

        <div className="server-settings-content">
          {tab === 'overview' ? (
            <>
              <ModalHeader title="Обзор сервера" subtitle="Название, иконка и цвет — так сервер видят участники." />
              <div className="server-icon-editor">
                {canManage ? (
                  <button
                    type="button"
                    className="server-icon-pick"
                    onClick={() => iconRef.current?.click()}
                    title="Выбрать иконку с компьютера"
                    aria-label="Выбрать иконку с компьютера"
                  >
                    <ServerIcon server={{ ...server, name, icon, accentColor }} size={82} />
                    <span className="server-icon-pick-badge"><Camera size={15} /></span>
                  </button>
                ) : (
                  <ServerIcon server={{ ...server, name, icon, accentColor }} size={82} />
                )}
                <div>
                  {canManage ? (
                    <button className="btn btn-secondary btn-small" onClick={() => iconRef.current?.click()}>
                      <Camera size={15} /> Сменить иконку
                    </button>
                  ) : null}
                  {canManage && icon ? <button className="btn btn-ghost btn-small" onClick={() => setIcon(null)}>Убрать</button> : null}
                  <p className="form-hint">PNG, JPG, WebP, GIF или ICO — подрежем и сожмём автоматически.</p>
                </div>
                {canManage ? (
                  <input ref={iconRef} type="file" accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.ico,.cur,.avif,.svg" hidden onChange={(event) => { pickIcon(event.target.files?.[0]); event.target.value = ''; }} />
                ) : null}
              </div>
              <FormField label="Название сервера">
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} disabled={!canManage} />
              </FormField>
              <div className="settings-label">Цвет сервера</div>
              <div className="color-palette">
                {SERVER_ACCENTS.map((color) => (
                  <button
                    key={color}
                    className={cx('color-swatch', accentColor === color && 'active')}
                    style={{ background: color }}
                    onClick={() => setAccentColor(color)}
                    disabled={!canManage}
                  >
                    {accentColor === color ? <Check size={15} /> : null}
                  </button>
                ))}
              </div>
              <div className="account-card">
                <div className="account-row"><span>Код приглашения</span><code>{server.inviteCode}</code></div>
                <div className="account-row"><span>Создан</span><strong>{formatFullDate(server.createdAt)}</strong></div>
                <div className="account-row"><span>Участников</span><strong>{server.members?.length || 0}</strong></div>
                <div className="account-row"><span>Ролей</span><strong>{server.roles?.length || 0}</strong></div>
              </div>
              {canManage ? (
                <div className="settings-actions">
                  <button className="btn btn-primary" onClick={saveOverview} disabled={saving}>
                    {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />} Сохранить
                  </button>
                </div>
              ) : (
                <div className="settings-note"><Shield size={16} /><span>У вас нет прав на изменение сервера.</span></div>
              )}
            </>
          ) : null}

          {tab === 'roles' ? (
            <>
              <ModalHeader title="Роли" subtitle="Права определяют, что участники могут делать на сервере.">
                {canRoles && !editingRole ? (
                  <button className="btn btn-primary btn-small" onClick={() => setEditingRole({})}>
                    <Plus size={15} /> Новая роль
                  </button>
                ) : null}
              </ModalHeader>
              {editingRole ? (
                <>
                  {pendingRoleDelete ? (
                    <div className="inline-confirm">
                      <span>Удалить роль «{pendingRoleDelete.name}»? Это действие нельзя отменить.</span>
                      <div>
                        <button className="btn btn-ghost btn-small" onClick={() => setPendingRoleDelete(null)}>Отмена</button>
                        <button className="btn btn-danger btn-small" onClick={() => deleteRole(pendingRoleDelete)} disabled={roleBusy}>Удалить</button>
                      </div>
                    </div>
                  ) : null}
                  <RoleEditor
                    key={editingRole.id || 'new'}
                    server={server}
                    role={editingRole}
                    busy={roleBusy}
                    onCancel={() => setEditingRole(null)}
                    onDelete={() => setPendingRoleDelete(editingRole)}
                    onSave={saveRole}
                  />
                </>
              ) : (
                <div className="roles-list">
                  {sortedRoles(server).map((role) => (
                    <button
                      key={role.id}
                      className="role-row"
                      onClick={() => canRoles && setEditingRole(role)}
                    >
                      <span className="role-color-dot" style={{ background: role.color }} />
                      <span className="role-row-name">
                        {role.name}
                        {role.system ? <small>системная</small> : null}
                      </span>
                      <span className="role-row-perms">{role.permissions?.length || 0} прав</span>
                      {role.hoist ? <span className="role-row-hoist">показана отдельно</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : null}

          {tab === 'members' ? (
            <>
              <ModalHeader title="Участники" subtitle="Управление ролями и доступом на сервер." />
              <div className="member-admin-list">
                {(server.members || []).map((member) => {
                  const isSelf = member.id === me?.id;
                  const isServerOwner = member.id === server.ownerId;
                  const expanded = memberEditor?.userId === member.id;
                  const memberColor = sortedRoles(server).find((role) => (member.roleIds || []).includes(role.id))?.color;
                  return (
                    <div className={cx('member-admin-row', expanded && 'expanded')} key={member.id}>
                      <div className="member-admin-main">
                        <Avatar user={member} size={36} />
                        <div className="member-admin-info">
                          <strong style={memberColor ? { color: memberColor } : undefined}>
                            {member.nickname || member.displayName}
                            {isServerOwner ? <Crown size={12} /> : null}
                          </strong>
                          <span>@{member.username}{isSelf ? ' · это вы' : ''}</span>
                        </div>
                        <div className="member-admin-roles">
                          {nonSystemRoles
                            .filter((role) => (member.roleIds || []).includes(role.id))
                            .map((role) => (
                              <span className="role-chip" key={role.id} style={{ borderColor: role.color, color: role.color }}>{role.name}</span>
                            ))}
                        </div>
                        {canRoles && !isServerOwner ? (
                          <button
                            className="btn btn-secondary btn-small"
                            onClick={() =>
                              setMemberEditor(expanded ? null : { userId: member.id, roleIds: member.roleIds || [] })
                            }
                          >
                            <Shield size={14} /> Роли
                          </button>
                        ) : null}
                        {canKick && !isServerOwner && !isSelf ? (
                          <button className="icon-btn danger" onClick={() => kickMember(member)} title="Исключить">
                            <UserMinus size={17} />
                          </button>
                        ) : null}
                        {canBans && !isServerOwner && !isSelf ? (
                          <button className="icon-btn danger" onClick={() => banMember(member)} title="Забанить">
                            <Ban size={17} />
                          </button>
                        ) : null}
                      </div>
                      {expanded ? (
                        <div className="member-admin-expand">
                          <div className="role-check-list compact">
                            {nonSystemRoles.map((role) => {
                              const active = memberEditor.roleIds.includes(role.id);
                              return (
                                <button
                                  key={role.id}
                                  className={cx('role-check-row', active && 'active')}
                                  onClick={() =>
                                    setMemberEditor((current) => ({
                                      ...current,
                                      roleIds: active
                                        ? current.roleIds.filter((id) => id !== role.id)
                                        : [...current.roleIds, role.id],
                                    }))
                                  }
                                >
                                  <span className="role-color-dot" style={{ background: role.color }} />
                                  <span className="role-check-name">{role.name}</span>
                                  <span className={cx('dm-check', active && 'active')}>{active ? <Check size={13} /> : null}</span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="member-admin-expand-actions">
                            <button className="btn btn-ghost btn-small" onClick={() => setMemberEditor(null)}>Отмена</button>
                            <button className="btn btn-primary btn-small" onClick={saveMemberRoles} disabled={memberBusy}>
                              {memberBusy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Сохранить
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          {tab === 'bans' ? (
            <>
              <ModalHeader title="Баны" subtitle="Пользователи, которым закрыт вход на сервер.">
                <button className="icon-btn" onClick={() => { setBans(null); }} title="Обновить">
                  <RefreshCw size={17} />
                </button>
              </ModalHeader>
              {bansLoading ? (
                <div className="modal-loading"><Loader2 size={20} className="spin" /> Загружаем…</div>
              ) : (bans || []).length === 0 ? (
                <div className="pins-empty">
                  <Ban size={36} />
                  <h3>Забаненных пользователей нет</h3>
                  <p>Сервер чист — так держать.</p>
                </div>
              ) : (
                <div className="ban-list">
                  {(bans || []).map((ban) => (
                    <div className="ban-row" key={ban.id}>
                      <Avatar user={ban.user} size={34} />
                      <div className="ban-info">
                        <strong>{ban.user?.displayName || 'Пользователь'}</strong>
                        <span>@{ban.user?.username}{ban.reason ? ` · ${ban.reason}` : ''}</span>
                      </div>
                      <span className="ban-date">{formatFullDate(ban.createdAt)}</span>
                      <button className="btn btn-secondary btn-small" onClick={() => unban(ban.userId)}>
                        Разбанить
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}

          {tab === 'danger' ? (
            <>
              <ModalHeader title="Опасная зона" subtitle="Действия, которые сложно или невозможно отменить." />
              {isOwner ? (
                <>
                  <div className="danger-card">
                    <div>
                      <strong><Crown size={16} /> Передать владение</strong>
                      <span>Новый владелец получит полный контроль над сервером.</span>
                    </div>
                    <div className="danger-card-row">
                      <select value={transferTo} onChange={(event) => setTransferTo(event.target.value)}>
                        <option value="">Выберите участника…</option>
                        {(server.members || [])
                          .filter((member) => member.id !== server.ownerId)
                          .map((member) => (
                            <option key={member.id} value={member.id}>{member.displayName}</option>
                          ))}
                      </select>
                      <button className="btn btn-secondary" onClick={transferOwnership} disabled={!transferTo}>
                        Передать
                      </button>
                    </div>
                  </div>
                  <div className="danger-card">
                    <div>
                      <strong><Trash2 size={16} /> Удалить сервер</strong>
                      <span>Все каналы, сообщения, роли и баны будут стёрты навсегда.</span>
                    </div>
                    <button className="btn btn-danger" onClick={deleteServer}>
                      <Trash2 size={16} /> Удалить сервер
                    </button>
                  </div>
                </>
              ) : (
                <div className="danger-card">
                  <div>
                    <strong><AlertTriangle size={16} /> Покинуть сервер</strong>
                    <span>Вы больше не будете видеть каналы этого сервера.</span>
                  </div>
                  <button className="btn btn-danger" onClick={leaveServer}>Покинуть сервер</button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
