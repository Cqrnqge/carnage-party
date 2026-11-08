'use strict';

const bcrypt = require('bcryptjs');
const { makeId } = require('./db.cjs');
const { DEFAULT_EVERYONE_PERMISSIONS, ROLE_COLORS } = require('./constants.cjs');

const PASSWORD = 'demo1234';
const now = Date.now();
const mins = (m) => new Date(now - m * 60 * 1000).toISOString();
const hours = (h) => mins(h * 60);

function seed(db) {
  if (db.data.meta.seeded || db.data.users.length > 0) {
    db.data.meta.seeded = true;
    return;
  }

  const hash = bcrypt.hashSync(PASSWORD, 10);

  const createUser = (id, username, displayName, email, bio, accentColor, status, createdMin) => ({
    id,
    username,
    displayName,
    email,
    passwordHash: hash,
    avatar: null,
    banner: null,
    accentColor,
    bio,
    status,
    settings: { theme: 'dark', compact: false, notifications: true },
    createdAt: hours(createdMin),
  });

  const demo = createUser('u_demo', 'demo', 'Демо', 'demo@carnage.local', 'Основатель Carnage Party. Люблю хорошие интерфейсы и голосовые вечеринки.', '#5865f2', 'online', 24 * 60);
  const nova = createUser('u_nova', 'nova', 'Nova', 'nova@carnage.local', 'Дизайнер и модератор. Пиксели, кофе, музыка.', '#eb459e', 'online', 24 * 52);
  const alex = createUser('u_alex', 'alex', 'Alex', 'alex@carnage.local', 'Разработчик. React, Node.js и немного магии WebRTC.', '#23a55a', 'idle', 24 * 40);
  const mira = createUser('u_mira', 'mira', 'Mira', 'mira@carnage.local', 'Музыка, мемы и кофе. Всегда за созвон.', '#f0b232', 'dnd', 24 * 30);

  db.data.users = [demo, nova, alex, mira];

  const everyonePerms = [...DEFAULT_EVERYONE_PERMISSIONS];

  // ---------- Сервер 1: Carnage Party ----------
  const carnage = {
    id: 'srv_carnage',
    name: 'Carnage Party',
    icon: null,
    accentColor: '#5865f2',
    ownerId: demo.id,
    inviteCode: 'CARNAGE',
    createdAt: hours(24 * 20),
    roles: [
      {
        id: 'role_carnage_everyone',
        name: '@everyone',
        color: '#99aab5',
        permissions: everyonePerms,
        position: 0,
        hoist: false,
        system: true,
      },
      {
        id: 'role_carnage_designer',
        name: 'Дизайнер',
        color: ROLE_COLORS[3],
        permissions: [...everyonePerms],
        position: 1,
        hoist: true,
        system: false,
      },
      {
        id: 'role_carnage_mod',
        name: 'Модератор',
        color: ROLE_COLORS[0],
        permissions: [...everyonePerms, 'MANAGE_MESSAGES', 'KICK_MEMBERS', 'MENTION_EVERYONE'],
        position: 2,
        hoist: true,
        system: false,
      },
    ],
    members: [
      { userId: demo.id, roleIds: [], nickname: null, joinedAt: hours(24 * 20) },
      { userId: nova.id, roleIds: ['role_carnage_mod'], nickname: null, joinedAt: hours(24 * 19) },
      { userId: alex.id, roleIds: [], nickname: null, joinedAt: hours(24 * 18) },
      { userId: mira.id, roleIds: ['role_carnage_designer'], nickname: null, joinedAt: hours(24 * 17) },
    ],
  };

  // ---------- Сервер 2: Design Hub ----------
  const design = {
    id: 'srv_design',
    name: 'Design Hub',
    icon: null,
    accentColor: '#eb459e',
    ownerId: nova.id,
    inviteCode: 'DESIGN',
    createdAt: hours(24 * 12),
    roles: [
      {
        id: 'role_design_everyone',
        name: '@everyone',
        color: '#99aab5',
        permissions: everyonePerms,
        position: 0,
        hoist: false,
        system: true,
      },
      {
        id: 'role_design_author',
        name: 'Автор',
        color: ROLE_COLORS[2],
        permissions: [...everyonePerms],
        position: 1,
        hoist: true,
        system: false,
      },
    ],
    members: [
      { userId: nova.id, roleIds: [], nickname: null, joinedAt: hours(24 * 12) },
      { userId: demo.id, roleIds: [], nickname: null, joinedAt: hours(24 * 10) },
      { userId: mira.id, roleIds: ['role_design_author'], nickname: null, joinedAt: hours(24 * 9) },
    ],
  };

  db.data.servers = [carnage, design];

  const channel = (id, serverId, name, type, category, position, topic, userLimit) => ({
    id,
    serverId,
    name,
    type,
    category,
    position,
    topic: topic || '',
    userLimit: userLimit || 0,
    createdAt: hours(24 * 20),
  });

  db.data.channels = [
    channel('ch_carnage_general', carnage.id, 'общий', 'text', 'Текстовые каналы', 0, 'Главный канал сообщества. Представься и поздоровайся!'),
    channel('ch_carnage_flood', carnage.id, 'флуд', 'text', 'Текстовые каналы', 1, 'Общение на любые темы'),
    channel('ch_carnage_memes', carnage.id, 'мемы', 'text', 'Текстовые каналы', 2, 'Только мемы. Серьёзно.'),
    channel('ch_carnage_voice', carnage.id, 'Общий', 'voice', 'Голосовые каналы', 0, 'Основная голосовая комната', 0),
    channel('ch_carnage_chill', carnage.id, 'Чилл', 'voice', 'Голосовые каналы', 1, 'Тихая комната для работы', 8),
    channel('ch_design_welcome', design.id, 'приветствие', 'text', 'Текстовые каналы', 0, 'Правила и знакомство', 0),
    channel('ch_design_showcase', design.id, 'витрина', 'text', 'Текстовые каналы', 1, 'Показывайте свои работы', 0),
    channel('ch_design_voice', design.id, 'Созвон', 'voice', 'Голосовые каналы', 0, 'Обсуждаем дизайн', 0),
  ];

  const msg = (id, channelId, authorId, content, createdAt, extra = {}) => ({
    id,
    channelId,
    authorId,
    content,
    createdAt,
    editedAt: null,
    replyToId: null,
    attachments: [],
    reactions: {},
    pinned: false,
    ...extra,
  });

  db.data.messages = [
    msg('m1', 'ch_carnage_general', nova.id, 'Привет всем! 👋 Добро пожаловать в **Carnage Party**.', hours(3)),
    msg('m2', 'ch_carnage_general', demo.id, 'Привет, Nova! Наконец-то запустили собственный сервер 🚀', mins(170)),
    msg('m3', 'ch_carnage_general', alex.id, 'Выглядит очень круто. Голосовой чат уже работает?', mins(160)),
    msg('m4', 'ch_carnage_general', nova.id, 'Да! Заходите в «Общий», проверим звук.', mins(150)),
    msg('m5', 'ch_carnage_general', mira.id, 'Я в деле! Только кофе допью ☕', mins(140)),
    msg('m6', 'ch_carnage_general', demo.id, 'Кстати, можно закреплять сообщения и делать реакции. Попробуйте 👇', mins(130), {
      pinned: true,
      reactions: { '🔥': [nova.id, alex.id, mira.id], '👍': [nova.id] },
    }),
    msg('m7', 'ch_carnage_flood', alex.id, 'Кто сегодня в голосовой?', mins(95)),
    msg('m8', 'ch_carnage_flood', mira.id, 'Я буду после 8 вечера 🎧', mins(90)),
    msg('m9', 'ch_carnage_flood', demo.id, 'Отлично, созвонимся!', mins(88)),
    msg('m10', 'ch_carnage_memes', mira.id, 'Когда дедлайн уже вчера 😅', mins(75)),
    msg('m11', 'ch_carnage_memes', alex.id, 'Это не мем, это боль.', mins(73), { reactions: { '😢': [mira.id, demo.id] } }),
    msg('m12', 'ch_design_welcome', nova.id, 'Добро пожаловать в **Design Hub** — место, где рождаются красивые интерфейсы.', hours(30)),
    msg('m13', 'ch_design_showcase', mira.id, 'Сделала новую обложку для подкаста. Как вам?', hours(22)),
    msg('m14', 'ch_design_showcase', demo.id, 'Огонь! Особенно цветовая гамма 🔥', hours(21), { reactions: { '🔥': [nova.id, mira.id] } }),
  ];

  const dm = {
    id: 'ch_dm_demo_nova',
    serverId: null,
    type: 'dm',
    name: null,
    icon: null,
    memberIds: [demo.id, nova.id],
    ownerId: demo.id,
    createdAt: hours(5),
  };
  db.data.channels.push(dm);

  db.data.messages.push(
    msg('dm1', dm.id, nova.id, 'Привет! Как тебе приложение?', mins(65)),
    msg('dm2', dm.id, demo.id, 'Очень удобно. Особенно голосовые каналы!', mins(55)),
    msg('dm3', dm.id, nova.id, 'Согласна. Давай позже созвонимся.', mins(50))
  );

  db.data.friendships = [
    { id: 'fr1', requesterId: demo.id, addresseeId: nova.id, status: 'accepted', createdAt: hours(48) },
    { id: 'fr2', requesterId: alex.id, addresseeId: demo.id, status: 'accepted', createdAt: hours(40) },
    { id: 'fr3', requesterId: mira.id, addresseeId: demo.id, status: 'pending', createdAt: mins(70) },
    { id: 'fr4', requesterId: nova.id, addresseeId: mira.id, status: 'accepted', createdAt: hours(36) },
  ];

  db.data.readStates = [
    { userId: demo.id, channelId: 'ch_carnage_general', lastReadAt: mins(165) },
    { userId: demo.id, channelId: 'ch_carnage_flood', lastReadAt: hours(72) },
    { userId: demo.id, channelId: 'ch_carnage_memes', lastReadAt: mins(80) },
    { userId: demo.id, channelId: dm.id, lastReadAt: mins(60) },
  ];

  db.data.meta.seeded = true;
  db.saveNow();
  console.log('[seed] Демо-данные созданы (CARNAGE_SEED_DEMO=1). Аккаунт: demo / demo1234');
}

module.exports = { seed, DEMO_PASSWORD: PASSWORD };
