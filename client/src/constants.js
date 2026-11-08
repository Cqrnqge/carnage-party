export const PERMISSIONS = [
  {
    key: 'ADMINISTRATOR',
    label: 'Администратор',
    hint: 'Все права, включая обход любых ограничений',
    danger: true,
  },
  { key: 'MANAGE_SERVER', label: 'Управление сервером', hint: 'Название, иконка, удаление сервера' },
  { key: 'MANAGE_CHANNELS', label: 'Управление каналами', hint: 'Создание, изменение и удаление каналов' },
  { key: 'MANAGE_ROLES', label: 'Управление ролями', hint: 'Создание ролей и выдача их участникам' },
  { key: 'MANAGE_MESSAGES', label: 'Управление сообщениями', hint: 'Удаление и закрепление чужих сообщений' },
  { key: 'KICK_MEMBERS', label: 'Кик участников', hint: 'Исключение участников с сервера' },
  { key: 'BAN_MEMBERS', label: 'Бан участников', hint: 'Блокировка входа на сервер' },
  { key: 'VIEW_CHANNELS', label: 'Просмотр каналов', hint: 'Видеть каналы сервера' },
  { key: 'SEND_MESSAGES', label: 'Отправка сообщений', hint: 'Писать в текстовые каналы' },
  { key: 'ATTACH_FILES', label: 'Вложения', hint: 'Прикреплять файлы и изображения' },
  { key: 'ADD_REACTIONS', label: 'Реакции', hint: 'Добавлять реакции на сообщения' },
  { key: 'CONNECT', label: 'Подключение к голосу', hint: 'Входить в голосовые каналы' },
  { key: 'SPEAK', label: 'Голос', hint: 'Говорить в голосовых каналах' },
  { key: 'MENTION_EVERYONE', label: 'Упоминание @everyone', hint: 'Упоминать всех участников' },
];

export const PERMISSION_LABELS = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.label]));
export const ALL_PERMISSIONS = PERMISSIONS.map((p) => p.key);

export const DEFAULT_EVERYONE_PERMISSIONS = [
  'VIEW_CHANNELS',
  'SEND_MESSAGES',
  'ATTACH_FILES',
  'ADD_REACTIONS',
  'CONNECT',
  'SPEAK',
];

export const STATUS_META = {
  online: { label: 'В сети', color: '#23a55a' },
  idle: { label: 'Не активен', color: '#f0b232' },
  dnd: { label: 'Не беспокоить', color: '#f23f43' },
  invisible: { label: 'Невидимка', color: '#80848e' },
  offline: { label: 'Не в сети', color: '#80848e' },
};

export const SERVER_ACCENTS = [
  '#5865f2', '#3ba55d', '#faa81a', '#ed4245', '#eb459e',
  '#9b59b6', '#00b0f4', '#1abc9c', '#f47fff', '#e67e22',
];

export function memberOf(server, userId) {
  return server?.members?.find((m) => m.id === userId) || null;
}

export function permissionsFor(server, userId) {
  if (!server || !userId) return [];
  if (server.ownerId === userId) return [...ALL_PERMISSIONS];
  const member = memberOf(server, userId);
  if (!member) return [];
  if (Array.isArray(member.permissions)) return member.permissions;
  const set = new Set();
  const roles = new Map((server.roles || []).map((r) => [r.id, r]));
  for (const roleId of member.roleIds || []) {
    const role = roles.get(roleId);
    if (role) for (const p of role.permissions || []) set.add(p);
  }
  const everyone = (server.roles || []).find((r) => r.system);
  if (everyone) for (const p of everyone.permissions || []) set.add(p);
  if (set.has('ADMINISTRATOR')) return [...ALL_PERMISSIONS];
  return [...set];
}

export function hasPermission(server, userId, permission) {
  if (!server || !userId) return false;
  if (server.ownerId === userId) return true;
  const perms = permissionsFor(server, userId);
  return perms.includes('ADMINISTRATOR') || perms.includes(permission);
}

export function highestRole(server, userId) {
  if (!server) return null;
  const member = memberOf(server, userId);
  if (!member) return null;
  const roles = (server.roles || [])
    .filter((r) => (member.roleIds || []).includes(r.id))
    .sort((a, b) => (b.position || 0) - (a.position || 0));
  return roles[0] || null;
}

export function roleColor(server, userId) {
  if (!server) return null;
  const member = memberOf(server, userId);
  if (!member) return null;
  if (server.ownerId === userId) {
    return highestRole(server, userId)?.color || null;
  }
  const roles = (server.roles || [])
    .filter((r) => (member.roleIds || []).includes(r.id))
    .sort((a, b) => (b.position || 0) - (a.position || 0));
  const colored = roles.find((r) => r.color && r.color.toLowerCase() !== '#99aab5');
  return colored?.color || null;
}

export function sortedRoles(server) {
  return [...(server?.roles || [])].sort((a, b) => (b.position || 0) - (a.position || 0));
}

export function dmOther(channel, meId) {
  if (!channel) return null;
  return (channel.members || []).find((m) => m.id !== meId) || null;
}

export function dmTitle(channel, meId) {
  if (!channel) return '';
  if (channel.name) return channel.name;
  const others = (channel.members || []).filter((m) => m.id !== meId);
  if (!others.length) return 'Личные сообщения';
  return others.map((m) => m.displayName || m.username).join(', ');
}
