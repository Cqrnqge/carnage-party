import { create } from 'zustand';
import { api, clearToken, getToken, setToken } from './api';
import { dmTitle, memberOf, dmOther } from './constants';

const SETTINGS_KEY = 'carnage_settings';

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  compact: false,
  messageGrouping: true,
  notifications: true,
  notifyAll: false,
  sounds: true,
  showMembers: true,
  inputDevice: 'default',
  outputDevice: 'default',
  videoDevice: 'default',
  inputVolume: 100,
  outputVolume: 100,
  streamVolume: 100,
  streamMuted: false,
  reduceMotion: false,
  pushToTalk: false,
  pttKey: 'KeyV',
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function persistSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

export function readStoredSettings() {
  return loadSettings();
}

const emptyFriends = { accepted: [], incoming: [], outgoing: [], blocked: [] };

const initialVoice = {
  channelId: null,
  joined: false,
  connecting: false,
  stageOpen: false,
  muted: false,
  deafened: false,
  camera: false,
  screen: false,
  ptt: false,
  participants: [],
  streams: {},
  screenAudioStreams: {},
  selfSpeaking: false,
  error: null,
};

const typingTimers = new Map();
const notificationCooldowns = new Map();

function isMentioned(message, user) {
  if (!user) return false;
  const content = String(message.content || '').toLowerCase();
  return (
    content.includes('@everyone') ||
    content.includes('@here') ||
    content.includes(`@${String(user.username).toLowerCase()}`) ||
    content.includes(`@${String(user.displayName).toLowerCase()}`)
  );
}

export const useApp = create((set, get) => ({
  token: getToken(),
  user: null,
  ready: false,
  socketConnected: false,

  servers: [],
  channels: [],
  dms: [],
  friends: { ...emptyFriends },
  presence: {},
  unread: {},
  mentions: {},
  lastRead: {},
  reads: {},

  active: { type: 'friends' },
  mobilePanel: null,
  messages: {},
  messageState: {},
  typing: {},

  voiceStates: {},
  voice: { ...initialVoice },
  incomingCall: null,

  streams: [],
  myStream: null,
  watchRooms: [],

  modal: null,
  screenPicker: null,
  toasts: [],
  replyTo: null,
  pendingJump: null,
  settings: loadSettings(),

  // ------------------------------------------------------------------
  // Сессия и загрузка
  // ------------------------------------------------------------------
  setSession: (payload) => {
    if (payload.token) {
      setToken(payload.token);
      set({ token: payload.token });
    }
    get().applyBootstrap(payload);
  },

  applyBootstrap: (payload, options = {}) => {
    const merge = Boolean(options.merge);
    const state = get();
    const servers = payload.servers || [];
    const channels = payload.channels || [];
    const dms = payload.dms || [];
    const allChannelIds = new Set([...channels.map((c) => c.id), ...dms.map((c) => c.id)]);

    let active = state.active;
    if (!merge || !active || (active.type === 'channel' && !allChannelIds.has(active.id))) {
      if (active?.type === 'channel' && allChannelIds.has(active.id)) {
        // оставляем текущий канал
      } else if (merge && active?.type === 'friends') {
        // остаёмся на друзьях
      } else {
        active = { type: 'friends' };
      }
    }

    const presence = merge ? { ...state.presence, ...(payload.presence || {}) } : { ...(payload.presence || {}) };
    if (payload.user) presence[payload.user.id] = payload.user.status || 'online';

    const voiceStates = merge ? { ...state.voiceStates, ...(payload.voice || {}) } : { ...(payload.voice || {}) };
    let voice = state.voice;
    if (voice.channelId && voiceStates[voice.channelId]) {
      const me = payload.user || state.user;
      const participants = voiceStates[voice.channelId].filter((p) => p.userId !== me?.id);
      voice = { ...voice, participants };
    }

    const streams = Array.isArray(payload.streams) ? payload.streams : state.streams;
    const myStream = state.myStream
      ? streams.find((stream) => stream.id === state.myStream.id) || state.myStream
      : null;
    const watchRooms = Array.isArray(payload.watch) ? payload.watch : state.watchRooms;

    set({
      user: payload.user || state.user,
      servers,
      channels,
      dms,
      friends: payload.friends || emptyFriends,
      presence,
      unread: payload.unread || {},
      mentions: payload.mentions || {},
      lastRead: payload.lastRead || {},
      reads: merge ? { ...state.reads, ...(payload.reads || {}) } : { ...(payload.reads || {}) },
      voiceStates,
      voice,
      streams,
      myStream,
      watchRooms,
      active,
      ready: true,
    });
  },

  logout: () => {
    clearToken();
    set({
      token: null,
      user: null,
      ready: false,
      socketConnected: false,
      servers: [],
      channels: [],
      dms: [],
      friends: { ...emptyFriends },
      presence: {},
      unread: {},
      mentions: {},
      lastRead: {},
      reads: {},
      active: { type: 'friends' },
      mobilePanel: null,
      messages: {},
      messageState: {},
      typing: {},
      voiceStates: {},
      voice: { ...initialVoice },
      incomingCall: null,
      streams: [],
      myStream: null,
      watchRooms: [],
      modal: null,
      toasts: [],
      replyTo: null,
      pendingJump: null,
    });
  },

  setSocketConnected: (connected) => set({ socketConnected: connected }),

  // ------------------------------------------------------------------
  // Стриминг
  // ------------------------------------------------------------------
  setStreams: (streams) => {
    const list = Array.isArray(streams) ? streams : [];
    const myStream = get().myStream;
    const fresh = myStream ? list.find((stream) => stream.id === myStream.id) : null;
    set({
      streams: list,
      myStream: myStream ? (fresh ? { ...myStream, ...fresh, url: myStream.url || fresh.url } : myStream) : null,
    });
  },

  setMyStream: (stream) => set({ myStream: stream ? { ...stream } : null }),

  applyWatchUpdate: ({ room, roomId, channelId }) => {
    const id = room?.id || roomId;
    if (!id) return;
    const list = (get().watchRooms || []).filter((item) => item.id !== id);
    if (room) list.push(room);
    set({ watchRooms: list });
  },

  // ------------------------------------------------------------------
  // Навигация
  // ------------------------------------------------------------------
  setActive: (active) => {
    set({ active, replyTo: null });
  },

  setMobilePanel: (panel) => set({ mobilePanel: panel || null }),

  toggleMobilePanel: (panel) => {
    set({ mobilePanel: get().mobilePanel === panel ? null : panel });
  },

  setPendingJump: (channelId, messageId) => {
    set({
      active: { type: 'channel', id: channelId },
      pendingJump: { channelId, messageId },
    });
  },

  clearPendingJump: () => set({ pendingJump: null }),

  toggleMembers: () => {
    const settings = { ...get().settings, showMembers: !get().settings.showMembers };
    persistSettings(settings);
    set({ settings });
  },

  setReplyTo: (message) => set({ replyTo: message || null }),

  // ------------------------------------------------------------------
  // Сообщения
  // ------------------------------------------------------------------
  loadMessages: async (channelId, options = {}) => {
    const state = get();
    if (state.messageState[channelId]?.loading && !options.force) return;
    set({
      messageState: {
        ...get().messageState,
        [channelId]: { ...(get().messageState[channelId] || {}), loading: true, error: null },
      },
    });
    try {
      const query = new URLSearchParams({ limit: String(options.limit || 50) });
      if (options.before) query.set('before', options.before);
      if (options.around) query.set('around', options.around);
      const data = await api(`/api/channels/${channelId}/messages?${query.toString()}`);
      const prev = get().messages[channelId] || [];
      let messages = data.messages || [];
      if (options.before) {
        messages = [...messages, ...prev];
      }
      set({
        messages: { ...get().messages, [channelId]: messages },
        messageState: {
          ...get().messageState,
          [channelId]: {
            loading: false,
            hasMore: Boolean(data.hasMore),
            error: null,
            loaded: true,
          },
        },
      });
      return data;
    } catch (err) {
      set({
        messageState: {
          ...get().messageState,
          [channelId]: {
            ...(get().messageState[channelId] || {}),
            loading: false,
            error: err.message,
          },
        },
      });
      if (err.status !== 0) get().toast(err.message, 'error');
      return null;
    }
  },

  loadOlder: async (channelId) => {
    const state = get();
    const meta = state.messageState[channelId] || {};
    if (!meta.hasMore || meta.loading) return;
    const list = state.messages[channelId] || [];
    const oldest = list[0];
    if (!oldest) return;
    await get().loadMessages(channelId, { before: oldest.createdAt, limit: 50 });
  },

  loadAround: async (channelId, messageId) => {
    const data = await get().loadMessages(channelId, { around: messageId, limit: 60, force: true });
    return data;
  },

  receiveMessage: ({ message }) => {
    if (!message) return;
    const state = get();
    const me = state.user;
    const list = state.messages[message.channelId];
    let nextList = list;
    if (list) {
      if (list.some((m) => m.id === message.id)) {
        nextList = list.map((m) => (m.id === message.id ? message : m));
      } else {
        nextList = [...list, message];
      }
    }
    const isActive = state.active?.type === 'channel' && state.active.id === message.channelId;
    const focused = typeof document === 'undefined' ? true : document.hasFocus() && !document.hidden;
    const unread = { ...state.unread };
    const mentions = { ...state.mentions };
    if (message.author?.id !== me?.id && (!isActive || !focused)) {
      unread[message.channelId] = (unread[message.channelId] || 0) + 1;
      if (isMentioned(message, me)) mentions[message.channelId] = (mentions[message.channelId] || 0) + 1;
    }
    const dms = state.dms.map((dm) =>
      dm.id === message.channelId
        ? {
            ...dm,
            lastMessage: {
              id: message.id,
              content: message.content || '',
              createdAt: message.createdAt,
              authorId: message.author?.id,
              authorName: message.author?.displayName,
            },
          }
        : dm
    ).sort((a, b) => String(b.lastMessage?.createdAt || b.createdAt || '').localeCompare(String(a.lastMessage?.createdAt || a.createdAt || '')));
    set({
      messages: nextList ? { ...state.messages, [message.channelId]: nextList } : state.messages,
      unread,
      mentions,
      dms,
    });
  },

  updateMessage: ({ message }) => {
    if (!message) return;
    const state = get();
    const list = state.messages[message.channelId];
    if (!list) return;
    set({
      messages: {
        ...state.messages,
        [message.channelId]: list.map((m) => (m.id === message.id ? message : m)),
      },
    });
  },

  removeMessage: ({ channelId, messageId }) => {
    const state = get();
    const list = state.messages[channelId];
    if (!list) return;
    set({
      messages: {
        ...state.messages,
        [channelId]: list.filter((m) => m.id !== messageId),
      },
    });
  },

  markChannelRead: (channelId) => {
    if (!channelId) return;
    const state = get();
    const now = new Date().toISOString();
    set({
      unread: { ...state.unread, [channelId]: 0 },
      mentions: { ...state.mentions, [channelId]: 0 },
      lastRead: { ...state.lastRead, [channelId]: now },
    });
    api(`/api/channels/${channelId}/read`, { method: 'POST' }).catch(() => {});
  },

  applyReadSync: ({ channelId, lastReadAt }) => {
    const state = get();
    if (!channelId) return;
    const at = lastReadAt || new Date().toISOString();
    const reads = { ...state.reads, [channelId]: { ...(state.reads[channelId] || {}) } };
    if (state.user?.id) reads[channelId][state.user.id] = at;
    set({
      unread: { ...state.unread, [channelId]: 0 },
      mentions: { ...state.mentions, [channelId]: 0 },
      lastRead: { ...state.lastRead, [channelId]: at },
      reads,
    });
  },

  applyReadUpdate: ({ channelId, userId, lastReadAt }) => {
    const state = get();
    if (!channelId || !userId || !lastReadAt) return;
    set({
      reads: {
        ...state.reads,
        [channelId]: { ...(state.reads[channelId] || {}), [userId]: lastReadAt },
      },
    });
  },

  // ------------------------------------------------------------------
  // Индикатор набора текста
  // ------------------------------------------------------------------
  typingStart: ({ channelId, user }) => {
    if (!channelId || !user) return;
    const state = get();
    const existing = state.typing[channelId] || [];
    const filtered = existing.filter((u) => u.id !== user.id);
    const next = [...filtered, { ...user, at: Date.now() }];
    set({ typing: { ...state.typing, [channelId]: next } });
    const key = `${channelId}:${user.id}`;
    if (typingTimers.has(key)) clearTimeout(typingTimers.get(key));
    typingTimers.set(
      key,
      setTimeout(() => {
        const current = get().typing[channelId] || [];
        set({
          typing: {
            ...get().typing,
            [channelId]: current.filter((u) => u.id !== user.id),
          },
        });
        typingTimers.delete(key);
      }, 5000)
    );
  },

  typingStop: ({ channelId, userId }) => {
    if (!channelId) return;
    const state = get();
    const current = state.typing[channelId] || [];
    set({
      typing: {
        ...state.typing,
        [channelId]: current.filter((u) => u.id !== userId),
      },
    });
    const key = `${channelId}:${userId}`;
    if (typingTimers.has(key)) {
      clearTimeout(typingTimers.get(key));
      typingTimers.delete(key);
    }
  },

  // ------------------------------------------------------------------
  // Друзья и присутствие
  // ------------------------------------------------------------------
  setFriends: (friends) => set({ friends: friends || emptyFriends }),

  setPresence: (userId, status) => {
    if (!userId) return;
    set({ presence: { ...get().presence, [userId]: status } });
  },

  setPresenceAll: (presence) => set({ presence: { ...get().presence, ...presence } }),

  // ------------------------------------------------------------------
  // Серверы и каналы
  // ------------------------------------------------------------------
  updateServer: (server) => {
    if (!server) return;
    set({ servers: get().servers.map((s) => (s.id === server.id ? server : s)) });
  },

  addServer: (server, channels) => {
    if (!server) return;
    const state = get();
    const servers = state.servers.some((s) => s.id === server.id)
      ? state.servers.map((s) => (s.id === server.id ? server : s))
      : [...state.servers, server];
    const incoming = (channels || []).filter((c) => c.serverId === server.id);
    const others = state.channels.filter((c) => c.serverId !== server.id);
    const merged = [...others];
    for (const ch of incoming) {
      const idx = merged.findIndex((c) => c.id === ch.id);
      if (idx >= 0) merged[idx] = ch;
      else merged.push(ch);
    }
    const firstText = incoming.find((c) => c.type === 'text');
    set({
      servers,
      channels: merged,
      active: firstText ? { type: 'channel', id: firstText.id } : state.active,
    });
  },

  removeServer: (serverId) => {
    const state = get();
    const removedChannelIds = new Set(state.channels.filter((c) => c.serverId === serverId).map((c) => c.id));
    const unread = { ...state.unread };
    const mentions = { ...state.mentions };
    for (const id of removedChannelIds) {
      delete unread[id];
      delete mentions[id];
    }
    const messages = { ...state.messages };
    for (const id of removedChannelIds) delete messages[id];
    const active =
      state.active?.type === 'channel' && removedChannelIds.has(state.active.id)
        ? { type: 'friends' }
        : state.active;
    set({
      servers: state.servers.filter((s) => s.id !== serverId),
      channels: state.channels.filter((c) => c.serverId !== serverId),
      unread,
      mentions,
      messages,
      active,
    });
  },

  addChannel: (channel) => {
    if (!channel) return;
    const state = get();
    if (channel.type === 'dm') {
      const exists = state.dms.some((d) => d.id === channel.id);
      const dms = exists
        ? state.dms.map((d) => (d.id === channel.id ? { ...d, ...channel } : d))
        : [channel, ...state.dms];
      set({ dms });
      return;
    }
    const exists = state.channels.some((c) => c.id === channel.id);
    set({
      channels: exists
        ? state.channels.map((c) => (c.id === channel.id ? channel : c))
        : [...state.channels, channel],
    });
  },

  updateDm: (channel) => {
    if (!channel) return;
    set({ dms: get().dms.map((d) => (d.id === channel.id ? { ...d, ...channel } : d)) });
  },

  removeChannel: (channelId) => {
    const state = get();
    const active = state.active?.type === 'channel' && state.active.id === channelId
      ? { type: 'friends' }
      : state.active;
    const unread = { ...state.unread };
    const mentions = { ...state.mentions };
    delete unread[channelId];
    delete mentions[channelId];
    set({
      channels: state.channels.filter((c) => c.id !== channelId),
      dms: state.dms.filter((d) => d.id !== channelId),
      unread,
      mentions,
      active,
    });
  },

  // ------------------------------------------------------------------
  // Голос
  // ------------------------------------------------------------------
  setVoice: (patch) => set({ voice: { ...get().voice, ...patch } }),

  setVoiceStream: (userId, stream) => {
    const voice = get().voice;
    set({ voice: { ...voice, streams: { ...voice.streams, [userId]: stream } } });
  },

  removeVoiceStream: (userId) => {
    const voice = get().voice;
    if (!voice.streams[userId] && !voice.screenAudioStreams?.[userId]) return;
    const streams = { ...voice.streams };
    const screenAudioStreams = { ...voice.screenAudioStreams };
    delete streams[userId];
    delete screenAudioStreams[userId];
    set({ voice: { ...voice, streams, screenAudioStreams } });
  },

  setVoiceScreenAudioStream: (userId, stream) => {
    const voice = get().voice;
    set({
      voice: {
        ...voice,
        screenAudioStreams: { ...voice.screenAudioStreams, [userId]: stream },
      },
    });
  },

  removeVoiceScreenAudioStream: (userId) => {
    const voice = get().voice;
    if (!voice.screenAudioStreams?.[userId]) return;
    const screenAudioStreams = { ...voice.screenAudioStreams };
    delete screenAudioStreams[userId];
    set({ voice: { ...voice, screenAudioStreams } });
  },

  handleVoiceState: ({ channelId, participants }) => {
    if (!channelId) return;
    const state = get();
    const me = state.user;
    const voiceStates = { ...state.voiceStates, [channelId]: participants || [] };
    let voice = state.voice;
    let incomingCall = state.incomingCall;
    if (incomingCall?.channelId === channelId && (participants || []).some((p) => p.userId === incomingCall.from?.id)) {
      // звонок ещё активен
    }
    if (voice.channelId === channelId) {
      const remote = (participants || []).filter((p) => p.userId !== me?.id);
      const streamKeys = Object.keys(voice.streams);
      const streams = {};
      for (const key of streamKeys) {
        if (remote.some((p) => p.userId === key)) streams[key] = voice.streams[key];
      }
      const screenAudioStreams = {};
      for (const [key, value] of Object.entries(voice.screenAudioStreams || {})) {
        if (remote.some((p) => p.userId === key)) screenAudioStreams[key] = value;
      }
      voice = { ...voice, participants: remote, streams, screenAudioStreams };
    }
    set({ voiceStates, voice, incomingCall });
  },

  setSpeaking: (channelId, userId, speaking) => {
    const state = get();
    const voiceStates = { ...state.voiceStates };
    voiceStates[channelId] = (voiceStates[channelId] || []).map((p) =>
      p.userId === userId ? { ...p, speaking } : p
    );
    let voice = state.voice;
    if (voice.channelId === channelId) {
      voice = {
        ...voice,
        participants: voice.participants.map((p) => (p.userId === userId ? { ...p, speaking } : p)),
      };
    }
    set({ voiceStates, voice });
  },

  setSelfSpeaking: (speaking) => set({ voice: { ...get().voice, selfSpeaking: speaking } }),

  resetVoice: () => set({ voice: { ...initialVoice } }),

  setIncomingCall: (call) => set({ incomingCall: call }),

  clearIncomingCall: () => set({ incomingCall: null }),

  // ------------------------------------------------------------------
  // Интерфейс
  // ------------------------------------------------------------------
  openModal: (type, props = {}) => set({ modal: { type, props } }),
  closeModal: () => set({ modal: null }),

  // Окно выбора монитора для демонстрации экрана.
  requestScreenSource: (sources) =>
    new Promise((resolve) => set({ screenPicker: { sources, resolve } })),
  resolveScreenSource: (sourceId) => {
    const picker = get().screenPicker;
    set({ screenPicker: null });
    if (picker?.resolve) picker.resolve(sourceId || '');
  },

  toast: (message, type = 'info') => {
    const id = Math.random().toString(36).slice(2, 10);
    set({ toasts: [...get().toasts, { id, message, type }] });
    setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    }, 4200);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    persistSettings(settings);
    set({ settings });
  },

  updateUser: (patch) => {
    const user = { ...(get().user || {}), ...patch };
    const presence = { ...get().presence };
    if (patch.status) presence[user.id] = patch.status;
    set({ user, presence });
    const channels = get().channels;
    const dms = get().dms;
    // Обновляем автора в уже загруженных сообщениях.
    const messages = { ...get().messages };
    for (const key of Object.keys(messages)) {
      messages[key] = messages[key].map((m) =>
        m.author?.id === user.id ? { ...m, author: { ...m.author, ...patch } } : m
      );
    }
    set({ channels, dms, messages });
  },

  isMentioned,
}));

export function selectChannel(state, channelId) {
  if (!channelId) return null;
  return state.channels.find((c) => c.id === channelId) || state.dms.find((d) => d.id === channelId) || null;
}

export function selectServerForChannel(state, channelId) {
  const channel = selectChannel(state, channelId);
  if (!channel?.serverId) return null;
  return state.servers.find((s) => s.id === channel.serverId) || null;
}

export function serverUnread(state, serverId) {
  const channelIds = state.channels.filter((c) => c.serverId === serverId).map((c) => c.id);
  return channelIds.reduce((sum, id) => sum + (state.unread[id] || 0), 0);
}

export function serverMentions(state, serverId) {
  const channelIds = state.channels.filter((c) => c.serverId === serverId).map((c) => c.id);
  return channelIds.reduce((sum, id) => sum + (state.mentions[id] || 0), 0);
}

export function channelTitle(state, channel) {
  if (!channel) return '';
  if (channel.type === 'dm') return dmTitle(channel, state.user?.id);
  return channel.name;
}

export function channelSubtitle(state, channel) {
  if (!channel) return '';
  if (channel.type === 'dm') {
    if (channel.saved) return 'Личные заметки и сохранённые сообщения';
    const other = dmOther(channel, state.user?.id);
    if (other) return other.customStatus || `@${other.username}`;
    return 'Групповой чат';
  }
  if (channel.topic) return channel.topic;
  return channel.type === 'voice' ? 'Голосовой канал' : '';
}

export function memberListForServer(state, serverId) {
  const server = state.servers.find((s) => s.id === serverId);
  return server?.members || [];
}

export function canSeeServer(state, serverId) {
  return state.servers.some((s) => s.id === serverId);
}

export function myMember(server, userId) {
  return memberOf(server, userId);
}

export { notificationCooldowns };
