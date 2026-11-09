import { io } from 'socket.io-client';
import { api, getServerBase } from './api';
import { useApp, selectChannel } from './store';
import { voiceManager } from './voice';

let socket = null;
let hasConnected = false;
let audioContext = null;

const lastNotify = new Map();

function playPing() {
  const state = useApp.getState();
  if (!state.settings.sounds) return;
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1180, now + 0.07);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain).connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch {}
}

function showNotification(title, body) {
  const state = useApp.getState();
  if (!state.settings.notifications) return;
  if (window.desktop?.notify) {
    window.desktop.notify(title, body);
    return;
  }
  try {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        const notification = new Notification(title, { body, silent: true });
        notification.onclick = () => window.focus();
      } else if (Notification.permission === 'default') {
        Notification.requestPermission().then((permission) => {
          if (permission === 'granted') new Notification(title, { body, silent: true });
        }).catch(() => {});
      }
    }
  } catch {}
}

function notifyMessage(message) {
  const state = useApp.getState();
  const me = state.user;
  if (!me || !message || message.author?.id === me.id) return;
  const channel = selectChannel(state, message.channelId);
  if (!channel) return;
  const isDm = channel.type === 'dm';
  const isActive = state.active?.type === 'channel' && state.active.id === message.channelId;
  const focused = typeof document !== 'undefined' && document.hasFocus() && !document.hidden;
  if (isActive && focused) return;
  const mention = state.isMentioned(message, me);
  if (!state.settings.notifyAll && !isDm && !mention) return;
  const now = Date.now();
  const cooldown = lastNotify.get(message.channelId) || 0;
  if (now - cooldown < 2500) return;
  lastNotify.set(message.channelId, now);
  const title = isDm
    ? message.author.displayName
    : `${message.author.displayName} · #${channel.name}`;
  const body = message.content
    ? message.content.slice(0, 180)
    : message.attachments?.length
      ? 'Вложение'
      : 'Новое сообщение';
  showNotification(title, body);
  if (mention || isDm) playPing();
}

function requestNotificationPermission() {
  try {
    if (!window.desktop?.notify && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  } catch {}
}

function handleFriendsUpdate(friends) {
  const before = useApp.getState().friends;
  const beforeIds = new Set((before.incoming || []).map((u) => u.id));
  const newIncoming = (friends?.incoming || []).filter((u) => !beforeIds.has(u.id));
  useApp.getState().setFriends(friends);
  for (const user of newIncoming) {
    useApp.getState().toast(`Новая заявка в друзья от ${user.displayName}`, 'info');
    showNotification('Заявка в друзья', `${user.displayName} (@${user.username}) хочет добавить вас в друзья`);
    playPing();
  }
}

export function connectSocket(token) {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  const app = useApp.getState();
  const base = getServerBase();
  socket = io(base || undefined, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 700,
    reconnectionDelayMax: 4000,
  });

  socket.on('connect', async () => {
    useApp.getState().setSocketConnected(true);
    requestNotificationPermission();
    if (hasConnected) {
      try {
        const data = await api('/api/bootstrap');
        useApp.getState().applyBootstrap(data, { merge: true });
      } catch {}
    }
    hasConnected = true;
  });

  socket.on('disconnect', () => {
    useApp.getState().setSocketConnected(false);
    voiceManager.handleDisconnect();
  });

  socket.on('connect_error', (err) => {
    useApp.getState().setSocketConnected(false);
    if (String(err?.message || '').includes('unauthorized')) {
      try { window.dispatchEvent(new CustomEvent('carnage:unauthorized')); } catch {}
    }
  });

  socket.on('message:new', (payload) => {
    useApp.getState().receiveMessage(payload);
    notifyMessage(payload?.message);
  });

  socket.on('message:update', (payload) => {
    useApp.getState().updateMessage(payload);
  });

  socket.on('message:delete', (payload) => {
    useApp.getState().removeMessage(payload);
  });

  socket.on('typing:start', (payload) => useApp.getState().typingStart(payload));
  socket.on('typing:stop', (payload) => useApp.getState().typingStop(payload));

  socket.on('presence:update', ({ userId, status }) => {
    useApp.getState().setPresence(userId, status);
  });

  socket.on('friends:update', (friends) => handleFriendsUpdate(friends));

  socket.on('server:updated', ({ server }) => {
    if (server) useApp.getState().updateServer(server);
  });

  socket.on('server:joined', ({ server, channels }) => {
    useApp.getState().addServer(server, channels || []);
    useApp.getState().toast(`Вы присоединились к серверу «${server.name}»`, 'success');
  });

  socket.on('server:removed', ({ serverId, reason }) => {
    const state = useApp.getState();
    state.removeServer(serverId);
    if (state.voice.channelId) {
      const channel = selectChannel(state, state.voice.channelId);
      if (channel?.serverId === serverId) voiceManager.leave();
    }
    const reasons = { left: 'Вы покинули сервер', kick: 'Вас исключили с сервера', ban: 'Вы забанены на сервере' };
    state.toast(reasons[reason] || 'Сервер недоступен', reason === 'left' ? 'info' : 'error');
  });

  socket.on('server:deleted', ({ serverId }) => {
    const state = useApp.getState();
    state.removeServer(serverId);
    state.toast('Сервер удалён владельцем', 'info');
    if (state.voice.channelId) {
      const channel = selectChannel(state, state.voice.channelId);
      if (channel?.serverId === serverId) voiceManager.leave();
    }
  });

  socket.on('channel:created', ({ channel }) => {
    useApp.getState().addChannel(channel);
  });

  socket.on('channel:updated', ({ channel }) => {
    useApp.getState().addChannel(channel);
  });

  socket.on('channel:deleted', ({ channelId }) => {
    const state = useApp.getState();
    if (state.voice.channelId === channelId) voiceManager.leave();
    state.removeChannel(channelId);
  });

  socket.on('dm:created', ({ channel }) => {
    if (!channel) return;
    useApp.getState().addChannel(channel);
  });

  socket.on('dm:updated', ({ channel }) => {
    useApp.getState().updateDm(channel);
  });

  socket.on('read:sync', (payload) => useApp.getState().applyReadSync(payload));
  socket.on('read:update', (payload) => useApp.getState().applyReadUpdate(payload));

  socket.on('voice:state', (payload) => {
    useApp.getState().handleVoiceState(payload);
  });

  socket.on('streams:update', ({ streams } = {}) => {
    useApp.getState().setStreams(streams || []);
  });

  socket.on('watch:update', (payload = {}) => {
    useApp.getState().applyWatchUpdate(payload);
  });

  socket.on('voice:speaking', ({ channelId, userId, speaking }) => {
    useApp.getState().setSpeaking(channelId, userId, speaking);
  });

  socket.on('call:incoming', (payload) => {
    if (!payload?.channelId) return;
    const state = useApp.getState();
    if (state.voice.joined && state.voice.channelId === payload.channelId) return;
    state.setIncomingCall(payload);
    playPing();
    if (!document.hasFocus()) {
      showNotification('Входящий звонок', `${payload.from?.displayName || 'Пользователь'} звонит вам`);
    }
  });

  socket.on('call:declined', ({ by }) => {
    useApp.getState().toast(`${by?.displayName || 'Пользователь'} отклонил(а) звонок`, 'info');
  });

  socket.on('call:ended', ({ channelId }) => {
    const state = useApp.getState();
    if (state.incomingCall?.channelId === channelId) state.clearIncomingCall();
  });

  voiceManager.attachSocket(socket);
  return socket;
}

export function disconnectSocket() {
  if (!socket) return;
  voiceManager.detachSocket();
  socket.disconnect();
  socket = null;
  hasConnected = false;
  useApp.getState().setSocketConnected(false);
}

export function getSocket() {
  return socket;
}

export function reconnectVoiceIfNeeded() {
  const voice = useApp.getState().voice;
  if (voice.joined && voice.channelId) voiceManager.reconnect(voice.channelId);
}
