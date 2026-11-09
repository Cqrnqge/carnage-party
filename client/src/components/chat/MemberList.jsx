import React, { useMemo, useState } from 'react';
import { Ban, Crown, MessageSquare, MoreVertical, Shield, UserMinus, UserCog, X } from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../store';
import { hasPermission, roleColor, sortedRoles } from '../../constants';
import { cx } from '../../utils';
import Avatar from '../ui/Avatar';
import ContextMenu from '../ui/ContextMenu';

function MemberRow({ member, server, onMenu, onRoles }) {
  const presence = useApp((state) => state.presence[member.id]);
  const openModal = useApp((state) => state.openModal);
  const status = presence || member.status || 'offline';
  const color = roleColor(server, member.id);
  const topRole = sortedRoles(server).find((role) => (member.roleIds || []).includes(role.id));

  return (
    <div
      className={cx('member-row', status === 'offline' && 'offline')}
      onClick={() => openModal('profile', { userId: member.id })}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event, member);
      }}
    >
      <Avatar user={member} size={32} showStatus status={status} />
      <div className="member-info">
        <span className="member-name" style={color ? { color } : undefined}>
          {member.nickname || member.displayName}
          {server.ownerId === member.id ? <Crown size={12} className="member-crown" title="Владелец" /> : null}
        </span>
        {member.customStatus ? <span className="member-status">{member.customStatus}</span> : null}
        {!member.customStatus && topRole && topRole.name !== '@everyone' ? (
          <span className="member-role-label" style={{ color: topRole.color }}>{topRole.name}</span>
        ) : null}
      </div>
      {onRoles ? (
        <button
          className="member-roles-btn icon-btn tiny"
          onClick={(event) => {
            event.stopPropagation();
            onRoles(member);
          }}
          title="Назначить роли"
          aria-label={`Назначить роли: ${member.displayName}`}
        >
          <Shield size={14} />
        </button>
      ) : null}
      <button
        className="member-more icon-btn tiny"
        onClick={(event) => {
          event.stopPropagation();
          onMenu(event, member);
        }}
        aria-label="Действия участника"
      >
        <MoreVertical size={15} />
      </button>
    </div>
  );
}

export default function MemberList({ server, channel, onClose }) {
  const me = useApp((state) => state.user);
  const presence = useApp((state) => state.presence);
  const openModal = useApp((state) => state.openModal);
  const setActive = useApp((state) => state.setActive);
  const toast = useApp((state) => state.toast);
  const [menu, setMenu] = useState(null);

  const canManageRoles = hasPermission(server, me?.id, 'MANAGE_ROLES');
  const canKick = hasPermission(server, me?.id, 'KICK_MEMBERS');
  const canBan = hasPermission(server, me?.id, 'BAN_MEMBERS');

  const groups = useMemo(() => {
    const members = [...(server.members || [])];
    const byId = new Map(members.map((member) => [member.id, member]));
    const result = [];
    const assigned = new Set();
    const hoisted = sortedRoles(server).filter((role) => role.hoist);
    for (const role of hoisted) {
      const list = members.filter(
        (member) => !assigned.has(member.id) && (member.roleIds || []).includes(role.id)
      );
      if (!list.length) continue;
      for (const member of list) assigned.add(member.id);
      result.push({ id: `role-${role.id}`, label: role.name, color: role.color, members: list });
    }
    const online = [];
    for (const member of members) {
      if (assigned.has(member.id)) continue;
      if ((presence[member.id] || member.status) === 'offline') continue;
      online.push(byId.get(member.id));
      assigned.add(member.id);
    }
    if (online.length) result.push({ id: 'online', label: 'В сети', members: online, count: online.length });
    const offline = members.filter((member) => !assigned.has(member.id));
    if (offline.length) result.push({ id: 'offline', label: 'Не в сети', members: offline, count: offline.length });
    return result;
  }, [server, presence]);

  const openMenu = (event, member) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom + 4, member });
  };

  const openRoles = (member) => {
    openModal('memberRoles', { serverId: server.id, userId: member.id });
  };

  const canAssignRoles = (member) =>
    Boolean(member) &&
    (canManageRoles || server.ownerId === me?.id) &&
    member.id !== me?.id &&
    member.id !== server.ownerId;

  const messageMember = async (member) => {
    try {
      const data = await api('/api/dms', { method: 'POST', body: { userId: member.id } });
      if (data?.channel) {
        useApp.getState().addChannel(data.channel);
        setActive({ type: 'channel', id: data.channel.id });
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const menuItems = menu
    ? [
        {
          label: 'Открыть профиль',
          icon: <UserCog size={16} />,
          onClick: () => openModal('profile', { userId: menu.member.id }),
        },
        menu.member.id !== me?.id
          ? {
              label: 'Написать сообщение',
              icon: <MessageSquare size={16} />,
              onClick: () => messageMember(menu.member),
            }
          : null,
        canAssignRoles(menu.member)
          ? {
              label: 'Назначить роли',
              icon: <Shield size={16} />,
              onClick: () => openRoles(menu.member),
            }
          : null,
        canKick && menu.member.id !== me?.id && menu.member.id !== server.ownerId
          ? {
              label: 'Исключить с сервера',
              icon: <UserMinus size={16} />,
              danger: true,
              onClick: () =>
                openModal('confirm', {
                  title: 'Исключить участника?',
                  text: `${menu.member.displayName} будет удалён с сервера. Он сможет вернуться по приглашению.`,
                  confirmText: 'Исключить',
                  danger: true,
                  onConfirm: async () => {
                    try {
                      await api(`/api/servers/${server.id}/members/${menu.member.id}`, { method: 'DELETE' });
                      useApp.getState().toast('Участник исключён', 'success');
                    } catch (err) {
                      toast(err.message, 'error');
                    }
                  },
                }),
            }
          : null,
        canBan && menu.member.id !== me?.id && menu.member.id !== server.ownerId
          ? {
              label: 'Забанить',
              icon: <Ban size={16} />,
              danger: true,
              onClick: () =>
                openModal('banMember', { serverId: server.id, userId: menu.member.id }),
            }
          : null,
      ].filter(Boolean)
    : [];

  return (
    <aside className="member-list">
      <div className="member-list-head">
        <span>Участники</span>
        <span className="member-count">{server.members?.length || 0}</span>
        {onClose ? (
          <button
            type="button"
            className="icon-btn tiny mobile-members-close"
            onClick={onClose}
            aria-label="Закрыть список участников"
          >
            <X size={17} />
          </button>
        ) : null}
      </div>
      <div className="member-list-scroll">
        {groups.map((group) => (
          <div className="member-group" key={group.id}>
            <div className="member-group-label" style={group.color ? { color: group.color } : undefined}>
              {group.label}
              <span>{group.members.length}</span>
            </div>
            {group.members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                server={server}
                onMenu={openMenu}
                onRoles={canAssignRoles(member) ? openRoles : null}
              />
            ))}
          </div>
        ))}
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} /> : null}
    </aside>
  );
}
