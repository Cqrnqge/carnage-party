'use strict';

// Права доступа. Порядок используется в интерфейсе настроек ролей.
const PERMISSIONS = [
  {
    key: 'ADMINISTRATOR',
    label: 'Администратор',
    hint: 'Все права, включая обход любых ограничений',
    danger: true,
  },
  { key: 'MANAGE_SERVER', label: 'Управление сервером', hint: 'Изменение названия, иконки, удаление' },
  { key: 'MANAGE_CHANNELS', label: 'Управление каналами', hint: 'Создание, изменение и удаление каналов' },
  { key: 'MANAGE_ROLES', label: 'Управление ролями', hint: 'Создание ролей и выдача их участникам' },
  { key: 'MANAGE_MESSAGES', label: 'Управление сообщениями', hint: 'Удаление и закрепление чужих сообщений' },
  { key: 'KICK_MEMBERS', label: 'Кик участников', hint: 'Исключение участников с сервера' },
  { key: 'BAN_MEMBERS', label: 'Бан участников', hint: 'Блокировка входа на сервер' },
  { key: 'MUTE_MEMBERS', label: 'Мут участников', hint: 'Запрет говорить в голосовых каналах' },
  { key: 'VIEW_CHANNELS', label: 'Просмотр каналов', hint: 'Видеть каналы сервера' },
  { key: 'SEND_MESSAGES', label: 'Отправка сообщений', hint: 'Писать в текстовые каналы' },
  { key: 'ATTACH_FILES', label: 'Вложения', hint: 'Прикреплять файлы и изображения' },
  { key: 'ADD_REACTIONS', label: 'Реакции', hint: 'Добавлять реакции на сообщения' },
  { key: 'CONNECT', label: 'Подключение к голосу', hint: 'Входить в голосовые каналы' },
  { key: 'SPEAK', label: 'Голос', hint: 'Говорить в голосовых каналах' },
  { key: 'MENTION_EVERYONE', label: 'Упоминание @everyone', hint: 'Упоминать всех участников' },
];

const DEFAULT_EVERYONE_PERMISSIONS = [
  'VIEW_CHANNELS',
  'SEND_MESSAGES',
  'ATTACH_FILES',
  'ADD_REACTIONS',
  'CONNECT',
  'SPEAK',
];

const STATUSES = ['online', 'idle', 'dnd', 'invisible'];

const ROLE_COLORS = [
  '#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#f47fff',
  '#00b0f4', '#f0b232', '#23a55a', '#9b59b6', '#e67e22', '#1abc9c',
];

module.exports = {
  PERMISSIONS,
  DEFAULT_EVERYONE_PERMISSIONS,
  STATUSES,
  ROLE_COLORS,
};
