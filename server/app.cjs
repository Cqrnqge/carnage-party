'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const { Server } = require('socket.io');

const { DB, makeId, randomCode } = require('./db.cjs');
const { seed } = require('./seed.cjs');
const {
  PERMISSIONS,
  ROLE_COLORS,
  STATUSES,
  DEFAULT_EVERYONE_PERMISSIONS,
} = require('./constants.cjs');
const {
  permissionsOf,
  hasPermission,
  isMember,
  getMember,
  isHigherOrOwner,
  ALL_PERMISSIONS,
} = require('./permissions.cjs');
const { makeSerializers } = require('./serializers.cjs');
const { updateInfo } = require('./updates.cjs');

let appVersion = '1.1.0';
try {
  appVersion = require('../package.json').version || appVersion;
} catch {}

const avatarLimit = 900_000;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_UPLOAD = 25 * 1024 * 1024;

function startServer(options = {}) {
  const dataDir = path.resolve(options.dataDir || path.join(__dirname, '..', 'data'));
  const host = options.host || '127.0.0.1';
  const requestedPort = options.port === undefined ? 3001 : options.port;
  const serveClient = options.serveClient !== false;

  fs.mkdirSync(dataDir, { recursive: true });
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  // Папка с установщиками новых версий. Сервер сканирует её на лету,
  // поэтому файл можно добавить без перезапуска.
  const updatesDir = path.resolve(
    options.updatesDir || process.env.CARNAGE_UPDATE_DIR || path.join(__dirname, '..', 'updates')
  );
  fs.mkdirSync(updatesDir, { recursive: true });

  const db = new DB(dataDir).load();
  if (process.env.CARNAGE_SEED_DEMO === '1') {
    seed(db);
  }

  const ser = makeSerializers(db);
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 2 * 1024 * 1024,
    pingTimeout: 30000,
  });

  app.disable('x-powered-by');
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '6mb' }));
  app.use(express.urlencoded({ extended: true, limit: '6mb' }));
  app.use('/uploads', express.static(uploadsDir, { maxAge: '7d', immutable: true }));
  app.use(
    '/updates',
    express.static(updatesDir, {
      index: false,
      setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', 'no-store');
        if (/\.apk$/i.test(filePath)) {
          res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        }
      },
    })
  );

  // ------------------------------------------------------------------
  // Мелкие утилиты
  // ------------------------------------------------------------------
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const fail = (res, message, status = 400) => res.status(status).json({ error: message });
  const nowIso = () => new Date().toISOString();
  const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
  const isHex = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
  const validUsername = (value) => /^[a-zA-Z0-9_.]{2,24}$/.test(String(value || ''));
  const validImage = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') return undefined;
    if (value.length > avatarLimit) return undefined;
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)) return value;
    if (/^https?:\/\/\S+$/i.test(value)) return value;
    return undefined;
  };
  const channelName = (value) => {
    const slug = String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32);
    return slug || 'канал';
  };
  const tokenFrom = (req) => {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) return header.slice(7);
    return null;
  };
  const signToken = (user) => jwt.sign({ sub: user.id }, db.data.meta.secret, { expiresIn: '30d' });
  const verifyToken = (token) => {
    try {
      return jwt.verify(token, db.data.meta.secret);
    } catch {
      return null;
    }
  };

  function auth(req, res, next) {
    const payload = verifyToken(tokenFrom(req));
    const user = payload ? db.user(payload.sub) : null;
    if (!user) return fail(res, 'Требуется авторизация', 401);
    req.user = user;
    next();
  }

  function userRoom(userId) {
    return `user:${userId}`;
  }
  function serverRoom(serverId) {
    return `server:${serverId}`;
  }
  function channelRoom(channelId) {
    return `channel:${channelId}`;
  }
  function voiceRoom(channelId) {
    return `voice:${channelId}`;
  }
  function emitUser(userId, event, payload) {
    io.to(userRoom(userId)).emit(event, payload);
  }

  function relationship(a, b) {
    for (const f of db.data.friendships) {
      const pair = (f.requesterId === a && f.addresseeId === b) || (f.requesterId === b && f.addresseeId === a);
      if (!pair) continue;
      return f;
    }
    return null;
  }

  function isBlockedBetween(a, b) {
    const f = relationship(a, b);
    return Boolean(f && f.status === 'blocked');
  }

  function sharesServer(a, b) {
    return db.data.servers.some((s) => isMember(s, a) && isMember(s, b));
  }

  function serverChannels(serverId) {
    return db.data.channels
      .filter((c) => c.serverId === serverId)
      .sort((a, b) => (a.position || 0) - (b.position || 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  function accessibleChannels(userId) {
    const result = [];
    for (const channel of db.data.channels) {
      if (channel.type === 'dm') {
        if ((channel.memberIds || []).includes(userId)) {
          if (channel.memberIds.length === 2) {
            const other = channel.memberIds.find((id) => id !== userId);
            if (other && isBlockedBetween(userId, other)) continue;
          }
          result.push(channel);
        }
      } else {
        const server = db.server(channel.serverId);
        if (!server || !isMember(server, userId)) continue;
        if (!hasPermission(server, userId, 'VIEW_CHANNELS')) continue;
        result.push(channel);
      }
    }
    return result;
  }

  function channelDisplayName(channel, viewerId) {
    if (channel.type !== 'dm') return channel.name;
    if (channel.name) return channel.name;
    const others = (channel.memberIds || []).filter((id) => id !== viewerId).map((id) => db.user(id)).filter(Boolean);
    return others.map((u) => u.displayName || u.username).join(', ') || 'Личные сообщения';
  }

  function canAccessChannel(userId, channel) {
    if (!channel) return false;
    if (channel.type === 'dm') {
      if (!(channel.memberIds || []).includes(userId)) return false;
      if (channel.memberIds.length === 2) {
        const other = channel.memberIds.find((id) => id !== userId);
        if (other && isBlockedBetween(userId, other)) return false;
      }
      return true;
    }
    const server = db.server(channel.serverId);
    if (!server || !isMember(server, userId)) return false;
    return hasPermission(server, userId, 'VIEW_CHANNELS');
  }

  function ensureSavedChannel(userId) {
    let channel = db.data.channels.find((c) => c.saved && (c.memberIds || []).includes(userId));
    if (channel) return channel;
    channel = {
      id: `saved_${userId}`,
      serverId: null,
      type: 'dm',
      saved: true,
      name: 'Избранное',
      icon: null,
      ownerId: userId,
      memberIds: [userId],
      createdAt: nowIso(),
    };
    db.data.channels.push(channel);
    db.save();
    return channel;
  }

  function bootstrap(userId) {
    const user = db.user(userId);
    ensureSavedChannel(userId);
    const accessible = accessibleChannels(userId);
    const servers = [];
    for (const server of db.data.servers) {
      if (isMember(server, userId)) servers.push(ser.serverDTO(server));
    }
    servers.sort((a, b) => {
      const am = a.members.find((m) => m.id === userId);
      const bm = b.members.find((m) => m.id === userId);
      return String(am?.joinedAt || '').localeCompare(String(bm?.joinedAt || ''));
    });

    const channels = accessible
      .filter((c) => c.type !== 'dm')
      .sort((a, b) => {
        const sa = db.server(a.serverId);
        const sb = db.server(b.serverId);
        const ai = servers.findIndex((s) => s.id === sa?.id);
        const bi = servers.findIndex((s) => s.id === sb?.id);
        return ai - bi || (a.position || 0) - (b.position || 0);
      })
      .map((c) => ser.channelDTO(c));

    const dms = accessible
      .filter((c) => c.type === 'dm')
      .map((c) => ser.dmDTO(c))
      .sort((a, b) => {
        const at = a.lastMessage?.createdAt || a.createdAt || '';
        const bt = b.lastMessage?.createdAt || b.createdAt || '';
        return String(bt).localeCompare(String(at));
      });

    const unreadChannels = [...channels.map((c) => c.id), ...dms.map((d) => d.id)];
    const unread = ser.unreadData(userId, unreadChannels);

    const presence = {};
    for (const u of db.data.users) presence[u.id] = presenceStatus(u.id);

    const voice = {};
    const accessibleIds = new Set(accessible.map((c) => c.id));
    for (const [channelId, participants] of voiceChannels.entries()) {
      if (accessibleIds.has(channelId)) voice[channelId] = voiceParticipants(channelId);
    }

    const reads = {};
    for (const state of db.data.readStates) {
      if (!accessibleIds.has(state.channelId)) continue;
      if (!reads[state.channelId]) reads[state.channelId] = {};
      reads[state.channelId][state.userId] = state.lastReadAt;
    }

    return {
      user: ser.selfUser(user),
      servers,
      channels,
      dms,
      friends: ser.friendData(userId),
      unread: unread.counts,
      mentions: unread.mentions,
      lastRead: unread.lastRead,
      reads,
      presence,
      voice,
      streams: streamList(),
      watch: watchList(userId),
      meta: {
        version: 1,
        demo: true,
      },
    };
  }

  function broadcastPresence(userId) {
    io.emit('presence:update', { userId, status: presenceStatus(userId) });
  }

  function emitFriends(userId) {
    emitUser(userId, 'friends:update', ser.friendData(userId));
  }

  function emitFriendsBoth(a, b) {
    emitFriends(a);
    emitFriends(b);
  }

  function viewableChannelIds(userId, server) {
    return serverChannels(server.id)
      .filter((c) => hasPermission(server, userId, 'VIEW_CHANNELS'))
      .map((c) => c.id);
  }

  function joinUserToServer(userId, server) {
    const rooms = [serverRoom(server.id), ...viewableChannelIds(userId, server).map(channelRoom)];
    io.in(userRoom(userId)).socketsJoin(rooms);
  }

  function removeUserFromServer(userId, serverId) {
    const rooms = [serverRoom(serverId), ...db.data.channels.filter((c) => c.serverId === serverId).map((c) => channelRoom(c.id))];
    io.in(userRoom(userId)).socketsLeave(rooms);
    for (const [channelId, map] of voiceChannels.entries()) {
      if (map.has(userId) && db.channel(channelId)?.serverId === serverId) {
        map.delete(userId);
        broadcastVoiceState(channelId);
      }
    }
  }

  function resyncServerRooms(server) {
    for (const member of server.members) {
      joinUserToServer(member.userId, server);
    }
  }

  function joinUserToChannel(userId, channelId) {
    io.in(userRoom(userId)).socketsJoin(channelRoom(channelId));
  }

  // ------------------------------------------------------------------
  // Присутствие
  // ------------------------------------------------------------------
  const presence = new Map(); // userId -> { sockets: Set, status }

  function presenceStatus(userId) {
    const live = presence.get(userId);
    if (!live) return 'offline';
    if (live.status === 'invisible') return 'offline';
    return live.status;
  }

  function setPresenceStatus(userId, status) {
    const live = presence.get(userId);
    if (live) live.status = status;
    broadcastPresence(userId);
  }

  // ------------------------------------------------------------------
  // Голосовые состояния
  // ------------------------------------------------------------------
  const voiceChannels = new Map(); // channelId -> Map(userId -> state)
  const voiceBySocket = new Map(); // socketId -> channelId

  function voiceParticipants(channelId) {
    const map = voiceChannels.get(channelId);
    if (!map) return [];
    const list = [];
    for (const [userId, state] of map.entries()) {
      const user = db.user(userId);
      if (!user) continue;
      list.push({
        user: ser.publicUser(user),
        userId,
        muted: Boolean(state.muted),
        deafened: Boolean(state.deafened),
        camera: Boolean(state.camera),
        screen: Boolean(state.screen),
        speaking: Boolean(state.speaking),
        voiceStreamId: String(state.voiceStreamId || ''),
        screenAudioStreamId: String(state.screenAudioStreamId || ''),
        joinedAt: state.joinedAt,
      });
    }
    return list.sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)));
  }

  function broadcastVoiceState(channelId) {
    io.to(channelRoom(channelId)).emit('voice:state', {
      channelId,
      participants: voiceParticipants(channelId),
    });
  }

  // ------------------------------------------------------------------
  // Стриминг
  // ------------------------------------------------------------------
  // Живые трансляции хранятся только в памяти: это эфемерные комнаты.
  // hostSocketId появляется, когда стример подключается к /stream.
  const liveStreams = new Map();
  const streamIo = io.of('/stream');

  function streamRoom(streamId) {
    return `stream:${streamId}`;
  }

  const STREAM_CHAT_LIMIT = 100;
  const STREAM_CHAT_STYLES = new Set(['dark', 'light', 'neon', 'gold', 'minimal']);
  const STREAM_CAMERA_STYLES = new Set(['classic', 'neon', 'gold', 'white', 'none']);

  function sanitizeChatStyle(raw) {
    const value = String(raw || '').trim();
    return STREAM_CHAT_STYLES.has(value) ? value : '';
  }

  function sanitizeCameraStyle(raw) {
    const value = String(raw || '').trim();
    return STREAM_CAMERA_STYLES.has(value) ? value : '';
  }

  function sanitizeChatLayout(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const number = (value, fallback) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const w = Math.min(0.85, Math.max(0.16, number(raw.w, 0.33)));
    const h = Math.min(0.88, Math.max(0.18, number(raw.h, 0.48)));
    const x = Math.min(0.995 - w, Math.max(0.005, number(raw.x, 0.64)));
    const y = Math.min(0.995 - h, Math.max(0.005, number(raw.y, 0.06)));
    return {
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
      w: Number(w.toFixed(4)),
      h: Number(h.toFixed(4)),
    };
  }

  function streamPublic(stream) {
    return {
      id: stream.id,
      title: stream.title,
      mode: stream.mode,
      source: stream.source,
      createdAt: stream.createdAt,
      viewers: stream.viewerSockets.size,
      preview: stream.preview || null,
      channelId: stream.channelId || null,
      owner: ser.publicUser(db.user(stream.hostId)),
      url: stream.mode === 'link' ? stream.publicUrl : null,
      live: Boolean(stream.hostSocketId),
      chatLayout: stream.chatLayout || null,
      chatStyle: stream.chatStyle || 'dark',
      cameraStyle: stream.cameraStyle || 'classic',
    };
  }

  function streamList() {
    // В список попадают и эфиры, которые ждут переподключения стримера:
    // клиент показывает их как «переподключение», а по таймеру сервер
    // окончательно завершает такие трансляции.
    return [...liveStreams.values()]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(streamPublic);
  }

  function clearStreamCleanup(stream) {
    if (!stream?.hostOfflineTimer) return;
    clearTimeout(stream.hostOfflineTimer);
    stream.hostOfflineTimer = null;
  }

  function armStreamCleanup(stream, delay) {
    if (!stream) return;
    clearStreamCleanup(stream);
    stream.hostOfflineTimer = setTimeout(() => {
      stream.hostOfflineTimer = null;
      if (!stream.hostSocketId) endStream(stream.id, 'host-left');
    }, delay);
  }

  function broadcastStreams() {
    io.emit('streams:update', { streams: streamList() });
  }

  function broadcastStreamViewers(stream) {
    streamIo.to(streamRoom(stream.id)).emit('stream:viewers', {
      streamId: stream.id,
      viewers: stream.viewerSockets.size,
    });
  }

  function endStream(streamId, reason = 'ended') {
    const stream = liveStreams.get(streamId);
    if (!stream) return false;
    clearStreamCleanup(stream);
    liveStreams.delete(streamId);
    streamIo.to(streamRoom(streamId)).emit('stream:ended', { streamId, reason });
    for (const socket of [...streamIo.sockets.values()]) {
      if (socket.rooms.has(streamRoom(streamId))) socket.disconnect(true);
    }
    broadcastStreams();
    return true;
  }

  // ------------------------------------------------------------------
  // Watch Party — синхронный совместный просмотр
  // ------------------------------------------------------------------
  // Комнаты живут только в памяти: это эфемерные встречи, как и эфиры.
  const watchRooms = new Map();
  const watchIo = io.of('/watch');
  const WATCH_CHAT_LIMIT = 100;

  function watchRoomName(roomId) {
    return `watch:${roomId}`;
  }

  function youtubeIdFromUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      const host = url.hostname.replace(/^www\./i, '').toLowerCase();
      if (host === 'youtu.be') {
        const id = url.pathname.split('/').filter(Boolean)[0] || '';
        return /^[a-zA-Z0-9_-]{6,20}$/.test(id) ? id : '';
      }
      if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
        if (url.pathname === '/watch') {
          const id = url.searchParams.get('v') || '';
          return /^[a-zA-Z0-9_-]{6,20}$/.test(id) ? id : '';
        }
        const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{6,20})/);
        return match ? match[1] : '';
      }
    } catch {}
    return '';
  }

  function sanitizeWatchSource(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const type = raw.type === 'youtube' ? 'youtube' : raw.type === 'url' ? 'url' : '';
    const url = String(raw.url || '').trim().slice(0, 2048);
    if (!type || !/^https?:\/\//i.test(url)) return null;
    if (type === 'youtube') {
      const videoId = youtubeIdFromUrl(url);
      if (!videoId) return null;
      return {
        type: 'youtube',
        url: `https://www.youtube.com/watch?v=${videoId}`,
        videoId,
        duration: Math.max(0, Math.round(Number(raw.duration) || 0)),
      };
    }
    return {
      type: 'url',
      url,
      videoId: null,
      duration: Math.max(0, Math.round(Number(raw.duration) || 0)),
    };
  }

  function watchParticipants(room) {
    const list = [];
    for (const [userId, state] of room.participants.entries()) {
      const user = db.user(userId);
      if (!user) continue;
      list.push({
        user: ser.publicUser(user),
        userId,
        buffering: Boolean(state.buffering),
        joinedAt: state.joinedAt,
      });
    }
    return list.sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)));
  }

  function watchPublic(room) {
    return {
      id: room.id,
      title: room.title,
      channelId: room.channelId,
      hostId: room.hostId,
      host: ser.publicUser(db.user(room.hostId)),
      source: room.source,
      state: { ...room.state },
      participants: room.participants.size,
      live: Boolean(room.hostSocketId),
      createdAt: room.createdAt,
    };
  }

  function watchList(userId) {
    return [...watchRooms.values()]
      .filter((room) => canAccessChannel(userId, db.channel(room.channelId)))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(watchPublic);
  }

  function broadcastWatchUpdate(room, ended = false) {
    if (!room) return;
    io.to(channelRoom(room.channelId)).emit('watch:update', {
      room: ended ? null : watchPublic(room),
      roomId: room.id,
      channelId: room.channelId,
    });
  }

  function endWatch(roomId, reason = 'ended') {
    const room = watchRooms.get(roomId);
    if (!room) return false;
    if (room.hostTimer) clearTimeout(room.hostTimer);
    if (room.emptyTimer) clearTimeout(room.emptyTimer);
    watchRooms.delete(roomId);
    watchIo.to(watchRoomName(roomId)).emit('watch:ended', { roomId, reason });
    for (const socket of [...watchIo.sockets.values()]) {
      if (socket.rooms.has(watchRoomName(roomId))) socket.disconnect(true);
    }
    broadcastWatchUpdate(room, true);
    return true;
  }

  // ------------------------------------------------------------------
  // Загрузки
  // ------------------------------------------------------------------
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadsDir),
      filename: (_req, file, cb) => {
        const rawExt = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
        const ext = rawExt || '';
        cb(null, crypto.randomBytes(16).toString('hex') + ext);
      },
    }),
    limits: { fileSize: MAX_UPLOAD, files: 8 },
  });

  function decodeFilename(name) {
    if (!name) return 'файл';
    try {
      const converted = Buffer.from(name, 'latin1').toString('utf8');
      if (!converted.includes('\uFFFD') && converted !== name) return converted;
    } catch {}
    return name;
  }

  function parseWaveform(value) {
    if (value === undefined || value === null || value === '') return [];
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .slice(0, 96)
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item))
        .map((item) => Math.round(Math.min(1, Math.max(0, item)) * 1000) / 1000);
    } catch {
      return [];
    }
  }

  function fileList(files, options = {}) {
    const voice = options.kind === 'voice';
    const waveform = voice ? parseWaveform(options.waveform) : [];
    return (files || []).map((file) => {
      const attachment = {
        id: makeId('att'),
        name: decodeFilename(file.originalname),
        size: file.size,
        mime: file.mimetype || 'application/octet-stream',
        url: `/uploads/${file.filename}`,
        duration: voice ? Math.max(0, Math.round(Number(options.duration) || 0)) : 0,
        kind: options.kind || null,
      };
      if (voice) attachment.waveform = waveform;
      return attachment;
    });
  }

  function cleanupAttachments(message) {
    for (const att of message.attachments || []) {
      try {
        const usedElsewhere = db.data.messages.some(
          (other) =>
            other.id !== message.id &&
            (other.attachments || []).some((item) => item.url === att.url)
        );
        if (usedElsewhere) continue;
        const base = path.basename(att.url || '');
        if (!base) continue;
        const target = path.join(uploadsDir, base);
        if (target.startsWith(uploadsDir) && fs.existsSync(target)) fs.unlinkSync(target);
      } catch {}
    }
  }

  // ------------------------------------------------------------------
  // Аутентификация
  // ------------------------------------------------------------------
  app.post(
    '/api/auth/register',
    wrap((req, res) => {
      const username = clean(req.body.username, 24).toLowerCase();
      const displayName = clean(req.body.displayName, 32) || username;
      const email = clean(req.body.email, 120).toLowerCase();
      const password = String(req.body.password || '');
      if (!validUsername(username)) {
        return fail(res, 'Имя пользователя: 2–24 символа, только латиница, цифры, точка и подчёркивание');
      }
      if (!isEmail(email)) return fail(res, 'Введите корректный e-mail');
      if (password.length < 8) return fail(res, 'Пароль должен содержать минимум 8 символов');
      if (db.data.users.some((u) => u.username.toLowerCase() === username)) {
        return fail(res, 'Это имя пользователя уже занято');
      }
      if (db.data.users.some((u) => (u.email || '').toLowerCase() === email)) {
        return fail(res, 'Этот e-mail уже зарегистрирован');
      }
      const colors = ROLE_COLORS;
      const user = {
        id: makeId('u'),
        username,
        displayName,
        email,
        passwordHash: bcrypt.hashSync(password, 10),
        avatar: null,
        banner: null,
        accentColor: colors[Math.floor(Math.random() * colors.length)],
        bio: '',
        customStatus: '',
        status: 'online',
        settings: { theme: 'dark', compact: false, notifications: true },
        createdAt: nowIso(),
      };
      db.data.users.push(user);
      db.saveNow();
      const token = signToken(user);
      res.json({ token, ...bootstrap(user.id) });
    })
  );

  app.post(
    '/api/auth/login',
    wrap((req, res) => {
      const identifier = clean(req.body.identifier, 120).toLowerCase();
      const password = String(req.body.password || '');
      const user = db.data.users.find(
        (u) => u.username.toLowerCase() === identifier || (u.email || '').toLowerCase() === identifier
      );
      if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
        return fail(res, 'Неверное имя пользователя или пароль', 401);
      }
      const token = signToken(user);
      res.json({ token, ...bootstrap(user.id) });
    })
  );

  app.get('/api/bootstrap', auth, (req, res) => {
    res.json(bootstrap(req.user.id));
  });

  app.post(
    '/api/auth/password',
    auth,
    wrap((req, res) => {
      const current = String(req.body.currentPassword || '');
      const next = String(req.body.newPassword || '');
      if (!bcrypt.compareSync(current, req.user.passwordHash)) return fail(res, 'Текущий пароль неверен');
      if (next.length < 8) return fail(res, 'Новый пароль должен содержать минимум 8 символов');
      req.user.passwordHash = bcrypt.hashSync(next, 10);
      db.saveNow();
      res.json({ ok: true });
    })
  );

  app.patch(
    '/api/users/me',
    auth,
    wrap((req, res) => {
      const user = req.user;
      const body = req.body || {};
      if (body.displayName !== undefined) {
        const displayName = clean(body.displayName, 32);
        if (displayName.length < 1) return fail(res, 'Отображаемое имя не может быть пустым');
        user.displayName = displayName;
      }
      if (body.bio !== undefined) user.bio = clean(body.bio, 190);
      if (body.customStatus !== undefined) user.customStatus = clean(body.customStatus, 128);
      if (body.accentColor !== undefined) {
        if (!isHex(body.accentColor)) return fail(res, 'Некорректный цвет');
        user.accentColor = body.accentColor;
      }
      if (body.avatar !== undefined) {
        const avatar = validImage(body.avatar);
        if (avatar === undefined) return fail(res, 'Некорректный аватар');
        user.avatar = avatar;
      }
      if (body.banner !== undefined) {
        if (body.banner === null || body.banner === '') user.banner = null;
        else if (isHex(body.banner)) user.banner = body.banner;
        else {
          const banner = validImage(body.banner);
          if (banner === undefined) return fail(res, 'Некорректный баннер');
          user.banner = banner;
        }
      }
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) return fail(res, 'Некорректный статус');
        user.status = body.status;
        setPresenceStatus(user.id, body.status);
      }
      if (body.settings !== undefined && typeof body.settings === 'object') {
        user.settings = { ...(user.settings || {}), ...body.settings };
      }
      db.save();
      res.json({ user: ser.selfUser(user) });
    })
  );

  app.get(
    '/api/users/:userId',
    auth,
    wrap((req, res) => {
      const target = db.user(req.params.userId);
      if (!target) return fail(res, 'Пользователь не найден', 404);
      const rel = relationship(req.user.id, target.id);
      const mutualServers = db.data.servers.filter(
        (s) => isMember(s, req.user.id) && isMember(s, target.id)
      ).map((s) => ({ id: s.id, name: s.name, icon: s.icon, accentColor: s.accentColor }));
      res.json({
        user: ser.publicUser(target),
        relationship: rel
          ? {
              status: rel.status,
              direction: rel.requesterId === req.user.id ? 'outgoing' : 'incoming',
              blockedByMe: rel.status === 'blocked' && rel.blockedBy === req.user.id,
            }
          : null,
        mutualServers,
      });
    })
  );

  // ------------------------------------------------------------------
  // Друзья
  // ------------------------------------------------------------------
  app.get('/api/friends', auth, (req, res) => {
    res.json(ser.friendData(req.user.id));
  });

  app.post(
    '/api/friends/request',
    auth,
    wrap((req, res) => {
      const targetName = clean(req.body.username, 120).toLowerCase().replace(/^@/, '');
      const target = db.data.users.find(
        (u) => u.username.toLowerCase() === targetName || (u.email || '').toLowerCase() === targetName
      );
      if (!target) return fail(res, 'Пользователь не найден', 404);
      if (target.id === req.user.id) return fail(res, 'Нельзя добавить себя в друзья');
      if (isBlockedBetween(req.user.id, target.id)) return fail(res, 'Пользователь недоступен');
      const existing = relationship(req.user.id, target.id);
      if (existing) {
        if (existing.status === 'accepted') return fail(res, 'Вы уже друзья');
        if (existing.status === 'blocked') return fail(res, 'Пользователь недоступен');
        if (existing.status === 'pending') {
          if (existing.addresseeId === req.user.id) {
            existing.status = 'accepted';
            db.save();
            emitFriendsBoth(req.user.id, target.id);
            return res.json({ ok: true, accepted: true, friends: ser.friendData(req.user.id) });
          }
          return fail(res, 'Заявка уже отправлена');
        }
      }
      db.data.friendships.push({
        id: makeId('fr'),
        requesterId: req.user.id,
        addresseeId: target.id,
        status: 'pending',
        createdAt: nowIso(),
      });
      db.save();
      emitFriendsBoth(req.user.id, target.id);
      res.json({ ok: true, friends: ser.friendData(req.user.id) });
    })
  );

  app.post(
    '/api/friends/:userId/accept',
    auth,
    wrap((req, res) => {
      const other = db.user(req.params.userId);
      if (!other) return fail(res, 'Пользователь не найден', 404);
      const rel = relationship(req.user.id, other.id);
      if (!rel || rel.status !== 'pending' || rel.addresseeId !== req.user.id) {
        return fail(res, 'Входящая заявка не найдена');
      }
      rel.status = 'accepted';
      rel.acceptedAt = nowIso();
      db.save();
      emitFriendsBoth(req.user.id, other.id);
      res.json({ ok: true, friends: ser.friendData(req.user.id) });
    })
  );

  app.delete(
    '/api/friends/:userId',
    auth,
    wrap((req, res) => {
      const other = db.user(req.params.userId);
      if (!other) return fail(res, 'Пользователь не найден', 404);
      const rel = relationship(req.user.id, other.id);
      if (!rel) return fail(res, 'Связь не найдена', 404);
      if (rel.status === 'blocked') return fail(res, 'Сначала разблокируйте пользователя');
      db.data.friendships = db.data.friendships.filter((f) => f.id !== rel.id);
      db.save();
      emitFriendsBoth(req.user.id, other.id);
      res.json({ ok: true, friends: ser.friendData(req.user.id) });
    })
  );

  app.post(
    '/api/users/:userId/block',
    auth,
    wrap((req, res) => {
      const other = db.user(req.params.userId);
      if (!other) return fail(res, 'Пользователь не найден', 404);
      if (other.id === req.user.id) return fail(res, 'Нельзя заблокировать себя');
      const rel = relationship(req.user.id, other.id);
      if (rel) db.data.friendships = db.data.friendships.filter((f) => f.id !== rel.id);
      db.data.friendships.push({
        id: makeId('fr'),
        requesterId: req.user.id,
        addresseeId: other.id,
        status: 'blocked',
        blockedBy: req.user.id,
        createdAt: nowIso(),
      });
      db.save();
      emitFriendsBoth(req.user.id, other.id);
      res.json({ ok: true, friends: ser.friendData(req.user.id) });
    })
  );

  app.delete(
    '/api/users/:userId/block',
    auth,
    wrap((req, res) => {
      const other = db.user(req.params.userId);
      if (!other) return fail(res, 'Пользователь не найден', 404);
      db.data.friendships = db.data.friendships.filter(
        (f) =>
          !(
            f.status === 'blocked' &&
            f.blockedBy === req.user.id &&
            ((f.requesterId === req.user.id && f.addresseeId === other.id) ||
              (f.requesterId === other.id && f.addresseeId === req.user.id))
          )
      );
      db.save();
      emitFriendsBoth(req.user.id, other.id);
      res.json({ ok: true, friends: ser.friendData(req.user.id) });
    })
  );

  // ------------------------------------------------------------------
  // Личные сообщения
  // ------------------------------------------------------------------
  app.post(
    '/api/dms',
    auth,
    wrap((req, res) => {
      const ids = Array.isArray(req.body.userIds) ? req.body.userIds : [req.body.userId];
      const unique = [...new Set(ids.map((id) => String(id)).filter((id) => id && id !== req.user.id))];
      if (!unique.length) return fail(res, 'Выберите хотя бы одного получателя');
      if (unique.length > 9) return fail(res, 'В группе может быть до 10 участников');
      const users = unique.map((id) => db.user(id)).filter(Boolean);
      if (users.length !== unique.length) return fail(res, 'Некоторые пользователи не найдены');
      for (const user of users) {
        if (isBlockedBetween(req.user.id, user.id)) return fail(res, `Пользователь @${user.username} недоступен`);
        const friend = relationship(req.user.id, user.id)?.status === 'accepted';
        if (!friend && !sharesServer(req.user.id, user.id)) {
          return fail(res, `Вы можете писать только друзьям или участникам общих серверов (@${user.username})`);
        }
      }
      if (unique.length === 1) {
        const existing = db.data.channels.find(
          (c) =>
            c.type === 'dm' &&
            (c.memberIds || []).length === 2 &&
            c.memberIds.includes(req.user.id) &&
            c.memberIds.includes(unique[0])
        );
        if (existing) return res.json({ channel: ser.dmDTO(existing) });
      }
      const name = unique.length > 1 ? clean(req.body.name, 64) || null : null;
      const channel = {
        id: makeId('dm'),
        serverId: null,
        type: 'dm',
        name,
        icon: null,
        ownerId: req.user.id,
        memberIds: [req.user.id, ...unique],
        createdAt: nowIso(),
      };
      db.data.channels.push(channel);
      db.save();
      for (const memberId of channel.memberIds) {
        joinUserToChannel(memberId, channel.id);
        emitUser(memberId, 'dm:created', { channel: ser.dmDTO(channel) });
      }
      res.json({ channel: ser.dmDTO(channel) });
    })
  );

  app.patch(
    '/api/dms/:channelId',
    auth,
    wrap((req, res) => {
      const channel = db.channel(req.params.channelId);
      if (!channel || channel.type !== 'dm' || !channel.memberIds.includes(req.user.id)) {
        return fail(res, 'Диалог не найден', 404);
      }
      if (channel.ownerId !== req.user.id) return fail(res, 'Недостаточно прав', 403);
      if (req.body.name !== undefined) channel.name = clean(req.body.name, 64) || null;
      if (req.body.icon !== undefined) {
        const icon = validImage(req.body.icon);
        if (icon === undefined) return fail(res, 'Некорректная иконка');
        channel.icon = icon;
      }
      db.save();
      for (const memberId of channel.memberIds) {
        emitUser(memberId, 'dm:updated', { channel: ser.dmDTO(channel) });
      }
      res.json({ channel: ser.dmDTO(channel) });
    })
  );

  // ------------------------------------------------------------------
  // Серверы
  // ------------------------------------------------------------------
  app.post(
    '/api/servers',
    auth,
    wrap((req, res) => {
      const name = clean(req.body.name, 64);
      if (name.length < 2) return fail(res, 'Название сервера должно содержать минимум 2 символа');
      let icon = null;
      if (req.body.icon !== undefined) {
        const parsed = validImage(req.body.icon);
        if (parsed === undefined) return fail(res, 'Некорректная иконка');
        icon = parsed;
      }
      const accentColor = isHex(req.body.accentColor) ? req.body.accentColor : ROLE_COLORS[Math.floor(Math.random() * ROLE_COLORS.length)];
      const server = {
        id: makeId('srv'),
        name,
        icon,
        accentColor,
        ownerId: req.user.id,
        inviteCode: randomCode(8),
        createdAt: nowIso(),
        roles: [
          {
            id: '',
            name: '@everyone',
            color: '#99aab5',
            permissions: [...DEFAULT_EVERYONE_PERMISSIONS],
            position: 0,
            hoist: false,
            system: true,
          },
        ],
        members: [{ userId: req.user.id, roleIds: [], nickname: null, joinedAt: nowIso() }],
      };
      server.roles[0].id = `${server.id}_everyone`;
      db.data.servers.push(server);
      const general = {
        id: makeId('ch'),
        serverId: server.id,
        name: 'общий',
        type: 'text',
        category: 'Текстовые каналы',
        position: 0,
        topic: 'Добро пожаловать на сервер!',
        userLimit: 0,
        createdAt: nowIso(),
      };
      const voice = {
        id: makeId('ch'),
        serverId: server.id,
        name: 'Общий',
        type: 'voice',
        category: 'Голосовые каналы',
        position: 0,
        topic: '',
        userLimit: 0,
        createdAt: nowIso(),
      };
      db.data.channels.push(general, voice);
      db.save();
      joinUserToServer(req.user.id, server);
      const payload = {
        server: ser.serverDTO(server),
        channels: [ser.channelDTO(general), ser.channelDTO(voice)],
      };
      emitUser(req.user.id, 'server:joined', payload);
      res.json(payload);
    })
  );

  app.post(
    '/api/servers/join',
    auth,
    wrap((req, res) => {
      const code = clean(req.body.code, 32).toUpperCase();
      const server = db.data.servers.find((s) => s.inviteCode === code);
      if (!server) return fail(res, 'Приглашение не найдено или устарело', 404);
      if (isMember(server, req.user.id)) return fail(res, 'Вы уже на этом сервере');
      if (db.data.bans.some((b) => b.serverId === server.id && b.userId === req.user.id)) {
        return fail(res, 'Вы заблокированы на этом сервере', 403);
      }
      server.members.push({ userId: req.user.id, roleIds: [], nickname: null, joinedAt: nowIso() });
      db.save();
      joinUserToServer(req.user.id, server);
      const channels = serverChannels(server.id).map((c) => ser.channelDTO(c));
      emitUser(req.user.id, 'server:joined', { server: ser.serverDTO(server), channels });
      io.to(serverRoom(server.id)).emit('server:updated', { server: ser.serverDTO(server) });
      res.json({ server: ser.serverDTO(server), channels });
    })
  );

  app.patch(
    '/api/servers/:serverId',
    auth,
    wrap((req, res) => {
      const server = db.server(req.params.serverId);
      if (!server) return fail(res, 'Сервер не найден', 404);
      if (!hasPermission(server, req.user.id, 'MANAGE_SERVER')) return fail(res, 'Недостаточно прав', 403);
      if (req.body.name !== undefined) {
        const name = clean(req.body.name, 64);
        if (name.length < 2) return fail(res, 'Название сервера должно содержать минимум 2 символа');
        server.name = name;
      }
      if (req.body.icon !== undefined) {
        const icon = validImage(req.body.icon);
        if (icon === undefined) return fail(res, 'Некорректная иконка');
        server.icon = icon;
      }
      if (req.body.accentColor !== undefined) {
        if (!isHex(req.body.accentColor)) return fail(res, 'Некорректный цвет');
        server.accentColor = req.body.accentColor;
      }
      db.save();
      io.to(serverRoom(server.id)).emit('server:updated', { server: ser.serverDTO(server) });
      res.json({ server: ser.serverDTO(server) });
    })
  );

  app.post(
    '/api/servers/:serverId/invite/regenerate',
    auth,
    wrap((req, res) => {
      const server = db.server(req.params.serverId);
      if (!server) return fail(res, 'Сервер не найден', 404);
      if (!hasPermission(server, req.user.id, 'MANAGE_SERVER')) return fail(res, 'Недостаточно прав', 403);
      let code = randomCode(8);
      while (db.data.servers.some((s) => s.inviteCode === code)) code = randomCode(8);
      server.inviteCode = code;
      db.save();
      io.to(serverRoom(server.id)).emit('server:updated', { server: ser.serverDTO(server) });
      res.json({ code });
    })
  );

  app.post(
    '/api/servers/:serverId/leave',
    auth,
    wrap((req, res) => {
      const server = db.server(req.params.serverId);
      if (!server) return fail(res, 'Сервер не найден', 404);
      if (!isMember(server, req.user.id)) return fail(res, 'Вы не участник сервера');
      if (server.ownerId === req.user.id) {
        return fail(res, 'Владелец не может покинуть сервер. Передайте владение или удалите сервер.');
      }
      server.members = server.members.filter((m) => m.userId !== req.user.id);
      db.save();
      removeUserFromServer(req.user.id, server.id);
      emitUser(req.user.id, 'server:removed', { serverId: server.id, reason: 'left' });
      io.to(serverRoom(server.id)).emit('server:updated', { server: ser.serverDTO(server) });
      res.json({ ok: true });
    })
  );

  app.post(
    '/api/servers/:serverId/transfer',
    auth,
    wrap((req, res) => {
      const server = db.server(req.params.serverId);
      if (!server) return fail(res, 'Сервер не найден', 404);
      if (server.ownerId !== req.user.id) return fail(res, 'Только владелец может передать сервер', 403);
      const target = getMember(server, String(req.body.userId || ''));
      if (!target) return fail(res, 'Участник не найден', 404);
      server.ownerId = target.userId;
      db.save();
      io.to(serverRoom(server.id)).emit('server:updated', { server: ser.serverDTO(server) });
      res.json({ server: ser.serverDTO(server) });
    })
  );

  app.delete(
    '/api/servers/:serverId',
    auth,
    wrap((req, res) => {
      const server = db.server(req.params.serverId);
      if (!server) return fail(res, 'Сервер не найден', 404);
      if (server.ownerId !== req.user.id) return fail(res, 'Удалить сервер может только владелец', 403);
      const channelIds = db.data.channels.filter((c) => c.serverId === server.id).map((c) => c.id);
      db.data.messages = db.data.messages.filter((m) => !channelIds.includes(m.channelId));
      db.data.channels = db.data.channels.filter((c) => c.serverId !== server.id);
      db.data.readStates = db.data.readStates.filter((r) => !channelIds.includes(r.channelId));
      db.data.bans = db.data.bans.filter((b) => b.serverId !== server.id);
      db.data.servers = db.data.servers.filter((s) => s.id !== server.id);
      db.save();
      io.to(serverRoom(server.id)).emit('server:deleted', { serverId: server.id });
      io.in(serverRoom(server.id)).socketsLeave(serverRoom(server.id));
      res.json({ ok: true });
    })
  );

  // ---- Участники ----
  app.delete(
    '/api/servers/:serverId/members/:userId',
    auth,
    wrap((req, res) => {
      const server = db.server(req.params.serverId);
      if (!server) return fail(res, 'Сервер не найден', 404);
      if (!hasPermission(server, req.user.id, 'KICK_MEMBERS')) return fail(res, 'Недостаточно прав', 403);
      const target = getMember(server, req.params.userId);
      if (!target) return fail(res, 'Участник не найден', 404);
      if (target.userId === server.ownerId) return fail(res, 'Нельзя исключить владельца сервера');
      if (!isHigherOrOwner(server, req.user.id, target.userId)) return fail(res, 'Недостаточно прав для этого участника', 403);
      server.members = server.members.filter((m) => m.userId !== target.userId);
      db.save();
      removeUserFromServer(target.userId, server.id);
      emitUser(target.userId, 'server:removed', { serverId: server.id, reason: 'kick' });
      io.to(serverRoom(server.id)).emit('server:updated', { server: ser.serverDTO(server) });
      res.json({ ok: true });
    })
  );

  app.put(
    '/api/servers/:serverId/members/:userId/roles',
    auth,
    wrap((req, res) => {
      const server = db.server(req.params.serverId);
      if (!server) return fail(res, 'Сервер не найден', 404);
      if (!hasPermission(server, req.user.id, 'MANAGE_ROLES')) return fail(res, 'Недостаточно прав', 403);
      const target = getMember(server, req.params.userId);
      if (!target) return fail(res, 'Участник не найден', 404);
      if (target.userId === server.ownerId) return fail(res, 'Нельзя изменить роли владельца');
      if (!isHigherOrOwner(server, req.user.id, target.userId)) return fail(res, 'Недостаточно прав для этого участника', 403);
      const requested = Array.isArray(req.body.roleIds) ? req.body.roleIds.map(String) : [];
      const map = new Map(server.roles.map((r) => [r.id, r]));
      const roleIds = [...new Set(requested)].filter((id) => map.has(id) && !map.get(id).system);
      const actorAdmin = hasPermission(server, req.user.id, 'ADMINISTRATOR');
      if (!actorAdmin) {
        const actor = getMember(server, req.user.id);
        const actorRoles = new Map(server.roles.map((r) => [r.id, r]));
        const actorMax = Math.max(0, ...(actor.roleIds || []).map((id) => actorRoles.get(id)?.position || 0));
        for (const id of roleIds) {
          const role = map.get(id);
          if (role.position >= actorMax && server.ownerId !== req.user.id) {
            return fail(res, 'Нельзя выдать роль выше или равную вашей');
          }
        }
      }
      target.roleIds = roleIds;
      db.save();
      io.to(serverRoom(server.id)).emit('server:updated', { server: ser.serverDTO(server) });
      resyncServerRooms(server);
      res.json({ server: ser.serverDTO(server) });
    })
  );

  // ---- Баны ----
  app.get(
    '/api/servers/:serverId/bans',
    auth,
    wrap((req, res) => {
      const server = db.server(req.params.serverId);
      if (!server) return fail(res, 'Сервер не найден', 404);
      if (!hasPermission(server, req.user.id, 'BAN_MEMBERS')) return fail(res, 'Недостаточно прав', 403);
      const bans = db.data.bans
        .filter((b) => b.serverId === server.id)
        .map((b) => ({ ...b, user: ser.publicUser(db.user(b.userId)) }));
      res.json({ bans });
    })
  );

  app.post(
    '/api/servers/:serverId/bans',
    auth,
    wrap((req, res) => {
      const server = db.server(req.params.serverId);
      if (!server) return fail(res, 'Сервер не найден', 404);
      if (!hasPermission(server, req.user.id, 'BAN_MEMBERS')) return fail(res, 'Недостаточно прав', 403);
      const targetId = String(req.body.userId || '');
      if (targetId === server.ownerId) return fail(res, 'Нельзя забанить владельца сервера');
      if (targetId === req.user.id) return fail(res, 'Нельзя забанить себя');
      if (!db.user(targetId)) return fail(res, 'Пользователь не найден', 404);
      if (getMember(server, targetId) && !isHigherOrOwner(server, req.user.id, targetId)) {
        return fail(res, 'Недостаточно прав для этого участника', 403);
      }
      const reason = clean(req.body.reason, 200);
      server.members = server.members.filter((m) => m.userId !== targetId);
      db.data.bans = db.data.bans.filter((b) => !(b.serverId === server.id && b.userId === targetId));
      db.data.bans.push({
        id: makeId('ban'),
        serverId: server.id,
        userId: targetId,
        bannedBy: req.user.id,
        reason,
        createdAt: nowIso(),
      });
      db.save();
      removeUserFromServer(targetId, server.id);
      emitUser(targetId, 'server:removed', { serverId: server.id, reason: 'ban' });
      io.to(serverRoom(server.id)).emit('server:updated', { server: ser.serverDTO(server) });
      res.json({ ok: true });
    })
  );

  app.delete(
    '/api/servers/:serverId/bans/:userId',
    auth,
    wrap((req, res) => {
      const server = db.server(req.params.serverId);
      if (!server) return fail(res, 'Сервер не найден', 404);
      if (!hasPermission(server, req.user.id, 'BAN_MEMBERS')) return fail(res, 'Недостаточно прав', 403);
      db.data.bans = db.data.bans.filter((b) => !(b.serverId === server.id && b.userId === req.params.userId));
      db.save();
      res.json({ ok: true });
    })
  );

  // ---- Роли ----
  app.post(
    '/api/servers/:serverId/roles',
    auth,
    wrap((req, res) => {
      const server = db.server(req.params.serverId);
      if (!server) return fail(res, 'Сервер не найден', 404);
      if (!hasPermission(server, req.user.id, 'MANAGE_ROLES')) return fail(res, 'Недостаточно прав', 403);
      const name = clean(req.body.name, 32);
      if (!name) return fail(res, 'Введите название роли');
      const color = isHex(req.body.color) ? req.body.color : ROLE_COLORS[Math.floor(Math.random() * ROLE_COLORS.length)];
      const allowed = new Set(ALL_PERMISSIONS);
      let perms = Array.isArray(req.body.permissions) ? req.body.permissions.map(String).filter((p) => allowed.has(p)) : [];
      if (!hasPermission(server, req.user.id, 'ADMINISTRATOR')) perms = perms.filter((p) => p !== 'ADMINISTRATOR');
      const role = {
        id: makeId('role'),
        name,
        color,
        permissions: [...new Set(perms)],
        position: Math.max(0, ...server.roles.map((r) => r.position || 0)) + 1,
        hoist: Boolean(req.body.hoist),
        system: false,
      };
      server.roles.push(role);
      db.save();
      io.to(serverRoom(server.id)).emit('server:updated', { server: ser.serverDTO(server) });
      res.json({ role });
    })
  );

  app.patch(
    '/api/servers/:serverId/roles/:roleId',
    auth,
    wrap((req, res) => {
      const server = db.server(req.params.serverId);
      if (!server) return fail(res, 'Сервер не найден', 404);
      if (!hasPermission(server, req.user.id, 'MANAGE_ROLES')) return fail(res, 'Недостаточно прав', 403);
      const role = server.roles.find((r) => r.id === req.params.roleId);
      if (!role) return fail(res, 'Роль не найдена', 404);
      if (req.body.name !== undefined && !role.system) {
        const name = clean(req.body.name, 32);
        if (!name) return fail(res, 'Введите название роли');
        role.name = name;
      }
      if (req.body.color !== undefined) {
        if (!isHex(req.body.color)) return fail(res, 'Некорректный цвет');
        role.color = req.body.color;
      }
      if (req.body.hoist !== undefined) role.hoist = Boolean(req.body.hoist);
      if (req.body.permissions !== undefined) {
        const allowed = new Set(ALL_PERMISSIONS);
        let perms = Array.isArray(req.body.permissions)
          ? req.body.permissions.map(String).filter((p) => allowed.has(p))
          : [];
        if (!hasPermission(server, req.user.id, 'ADMINISTRATOR')) perms = perms.filter((p) => p !== 'ADMINISTRATOR');
        role.permissions = [...new Set(perms)];
      }
      db.save();
      io.to(serverRoom(server.id)).emit('server:updated', { server: ser.serverDTO(server) });
      resyncServerRooms(server);
      res.json({ role });
    })
  );

  app.delete(
    '/api/servers/:serverId/roles/:roleId',
    auth,
    wrap((req, res) => {
      const server = db.server(req.params.serverId);
      if (!server) return fail(res, 'Сервер не найден', 404);
      if (!hasPermission(server, req.user.id, 'MANAGE_ROLES')) return fail(res, 'Недостаточно прав', 403);
      const role = server.roles.find((r) => r.id === req.params.roleId);
      if (!role) return fail(res, 'Роль не найдена', 404);
      if (role.system) return fail(res, 'Системную роль нельзя удалить');
      server.roles = server.roles.filter((r) => r.id !== role.id);
      for (const member of server.members) member.roleIds = (member.roleIds || []).filter((id) => id !== role.id);
      db.save();
      io.to(serverRoom(server.id)).emit('server:updated', { server: ser.serverDTO(server) });
      resyncServerRooms(server);
      res.json({ ok: true });
    })
  );

  // ------------------------------------------------------------------
  // Каналы
  // ------------------------------------------------------------------
  app.post(
    '/api/servers/:serverId/channels',
    auth,
    wrap((req, res) => {
      const server = db.server(req.params.serverId);
      if (!server) return fail(res, 'Сервер не найден', 404);
      if (!hasPermission(server, req.user.id, 'MANAGE_CHANNELS')) return fail(res, 'Недостаточно прав', 403);
      const type = req.body.type === 'voice' ? 'voice' : 'text';
      const rawName = clean(req.body.name, 64);
      if (!rawName) return fail(res, 'Введите название канала');
      const category = clean(req.body.category, 40) || (type === 'voice' ? 'Голосовые каналы' : 'Текстовые каналы');
      const channel = {
        id: makeId('ch'),
        serverId: server.id,
        name: type === 'voice' ? rawName.slice(0, 32) : channelName(rawName),
        type,
        category,
        topic: clean(req.body.topic, 1024),
        position: Math.max(0, ...serverChannels(server.id).filter((c) => c.type === type).map((c) => c.position || 0)) + 1,
        userLimit: Math.max(0, Math.min(99, Number(req.body.userLimit) || 0)),
        createdAt: nowIso(),
      };
      db.data.channels.push(channel);
      db.save();
      for (const member of server.members) joinUserToChannel(member.userId, channel.id);
      io.to(serverRoom(server.id)).emit('channel:created', { channel: ser.channelDTO(channel) });
      res.json({ channel: ser.channelDTO(channel) });
    })
  );

  app.patch(
    '/api/channels/:channelId',
    auth,
    wrap((req, res) => {
      const channel = db.channel(req.params.channelId);
      if (!channel || channel.type === 'dm') return fail(res, 'Канал не найден', 404);
      const server = db.server(channel.serverId);
      if (!server || !hasPermission(server, req.user.id, 'MANAGE_CHANNELS')) return fail(res, 'Недостаточно прав', 403);
      if (req.body.name !== undefined) {
        const raw = clean(req.body.name, 64);
        if (!raw) return fail(res, 'Введите название канала');
        channel.name = channel.type === 'voice' ? raw.slice(0, 32) : channelName(raw);
      }
      if (req.body.topic !== undefined) channel.topic = clean(req.body.topic, 1024);
      if (req.body.category !== undefined) channel.category = clean(req.body.category, 40);
      if (req.body.userLimit !== undefined) channel.userLimit = Math.max(0, Math.min(99, Number(req.body.userLimit) || 0));
      if (req.body.position !== undefined) channel.position = Math.max(0, Number(req.body.position) || 0);
      db.save();
      io.to(serverRoom(server.id)).emit('channel:updated', { channel: ser.channelDTO(channel) });
      res.json({ channel: ser.channelDTO(channel) });
    })
  );

  app.delete(
    '/api/channels/:channelId',
    auth,
    wrap((req, res) => {
      const channel = db.channel(req.params.channelId);
      if (!channel || channel.type === 'dm') return fail(res, 'Канал не найден', 404);
      const server = db.server(channel.serverId);
      if (!server || !hasPermission(server, req.user.id, 'MANAGE_CHANNELS')) return fail(res, 'Недостаточно прав', 403);
      const textChannels = serverChannels(server.id).filter((c) => c.type === 'text');
      if (textChannels.length <= 1 && channel.type === 'text') {
        return fail(res, 'На сервере должен остаться хотя бы один текстовый канал');
      }
      for (const m of db.data.messages.filter((m) => m.channelId === channel.id)) cleanupAttachments(m);
      db.data.channels = db.data.channels.filter((c) => c.id !== channel.id);
      db.data.messages = db.data.messages.filter((m) => m.channelId !== channel.id);
      db.data.readStates = db.data.readStates.filter((r) => r.channelId !== channel.id);
      db.save();
      io.to(serverRoom(server.id)).emit('channel:deleted', { channelId: channel.id, serverId: server.id });
      res.json({ ok: true });
    })
  );

  // ------------------------------------------------------------------
  // Сообщения
  // ------------------------------------------------------------------
  app.get(
    '/api/channels/:channelId/messages',
    auth,
    wrap((req, res) => {
      const channel = db.channel(req.params.channelId);
      if (!channel || !canAccessChannel(req.user.id, channel)) return fail(res, 'Канал не найден', 404);
      const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
      const before = req.query.before ? String(req.query.before) : null;
      const around = req.query.around ? String(req.query.around) : null;
      let all = db.data.messages
        .filter((m) => m.channelId === channel.id)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      let list;
      let hasMore;
      if (around) {
        const anchor = all.findIndex((m) => m.id === around);
        if (anchor >= 0) {
          const half = Math.floor(limit / 2);
          const start = Math.max(0, anchor - half);
          const end = Math.min(all.length, start + limit);
          const from = Math.max(0, end - limit);
          list = all.slice(from, end);
          hasMore = from > 0;
        } else {
          list = all.slice(-limit);
          hasMore = all.length > limit;
        }
      } else {
        list = before ? all.filter((m) => String(m.createdAt) < before) : all;
        hasMore = list.length > limit;
        if (hasMore) list = list.slice(-limit);
      }
      res.json({
        messages: list.map((m) => ser.messageDTO(m)),
        hasMore,
        channel: ser.channelDTO(channel),
      });
    })
  );

  app.post(
    '/api/channels/:channelId/messages',
    auth,
    upload.array('files', 8),
    wrap((req, res) => {
      const channel = db.channel(req.params.channelId);
      if (!channel || !canAccessChannel(req.user.id, channel)) {
        for (const file of req.files || []) {
          try { fs.unlinkSync(file.path); } catch {}
        }
        return fail(res, 'Канал не найден', 404);
      }
      const server = channel.type === 'dm' ? null : db.server(channel.serverId);
      if (server) {
        if (!hasPermission(server, req.user.id, 'SEND_MESSAGES')) {
          for (const file of req.files || []) {
            try { fs.unlinkSync(file.path); } catch {}
          }
          return fail(res, 'У вас нет права отправлять сообщения', 403);
        }
        if ((req.files || []).length && !hasPermission(server, req.user.id, 'ATTACH_FILES')) {
          for (const file of req.files || []) {
            try { fs.unlinkSync(file.path); } catch {}
          }
          return fail(res, 'У вас нет права прикреплять файлы', 403);
        }
      }
      const content = String(req.body.content || '').trim().slice(0, MAX_MESSAGE_LENGTH);
      const voice = req.body.voice === '1' || req.body.voice === 'true';
      const attachments = fileList(req.files, {
        kind: voice ? 'voice' : null,
        duration: req.body.duration,
        waveform: req.body.waveform,
      });
      if (!content && !attachments.length) return fail(res, 'Сообщение не может быть пустым');
      let replyToId = null;
      if (req.body.replyTo) {
        const original = db.message(String(req.body.replyTo));
        if (original && original.channelId === channel.id) replyToId = original.id;
      }
      const message = {
        id: makeId('m'),
        channelId: channel.id,
        authorId: req.user.id,
        content,
        createdAt: nowIso(),
        editedAt: null,
        replyToId,
        attachments,
        reactions: {},
        pinned: false,
      };
      db.data.messages.push(message);
      db.save();
      const dto = ser.messageDTO(message);
      io.to(channelRoom(channel.id)).emit('message:new', { message: dto });
      res.json({ message: dto });
    })
  );

  app.patch(
    '/api/messages/:messageId',
    auth,
    wrap((req, res) => {
      const message = db.message(req.params.messageId);
      if (!message) return fail(res, 'Сообщение не найдено', 404);
      const channel = db.channel(message.channelId);
      if (!channel || !canAccessChannel(req.user.id, channel)) return fail(res, 'Канал не найден', 404);
      const server = channel.type === 'dm' ? null : db.server(channel.serverId);
      const canManage = message.authorId === req.user.id || (server && hasPermission(server, req.user.id, 'MANAGE_MESSAGES'));
      if (!canManage) return fail(res, 'Недостаточно прав', 403);
      if (req.body.content === undefined) return fail(res, 'Нечего изменять');
      const content = String(req.body.content).trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!content && !(message.attachments || []).length) return fail(res, 'Сообщение не может быть пустым');
      message.content = content;
      message.editedAt = nowIso();
      db.save();
      const dto = ser.messageDTO(message);
      io.to(channelRoom(channel.id)).emit('message:update', { message: dto });
      res.json({ message: dto });
    })
  );

  app.delete(
    '/api/messages/:messageId',
    auth,
    wrap((req, res) => {
      const message = db.message(req.params.messageId);
      if (!message) return fail(res, 'Сообщение не найдено', 404);
      const channel = db.channel(message.channelId);
      if (!channel || !canAccessChannel(req.user.id, channel)) return fail(res, 'Канал не найден', 404);
      const server = channel.type === 'dm' ? null : db.server(channel.serverId);
      const canManage = message.authorId === req.user.id || (server && hasPermission(server, req.user.id, 'MANAGE_MESSAGES'));
      if (!canManage) return fail(res, 'Недостаточно прав', 403);
      cleanupAttachments(message);
      db.data.messages = db.data.messages.filter((m) => m.id !== message.id);
      db.save();
      io.to(channelRoom(channel.id)).emit('message:delete', {
        messageId: message.id,
        channelId: channel.id,
      });
      res.json({ ok: true });
    })
  );

  app.post(
    '/api/messages/:messageId/forward',
    auth,
    wrap((req, res) => {
      const source = db.message(req.params.messageId);
      if (!source) return fail(res, 'Сообщение не найдено', 404);
      const sourceChannel = db.channel(source.channelId);
      if (!sourceChannel || !canAccessChannel(req.user.id, sourceChannel)) {
        return fail(res, 'Канал не найден', 404);
      }
      const target = db.channel(String(req.body.channelId || ''));
      if (!target || !canAccessChannel(req.user.id, target)) {
        return fail(res, 'Чат для пересылки не найден', 404);
      }
      const targetServer = target.type === 'dm' ? null : db.server(target.serverId);
      if (targetServer && !hasPermission(targetServer, req.user.id, 'SEND_MESSAGES')) {
        return fail(res, 'У вас нет права отправлять сообщения в этот канал', 403);
      }
      const content = String(source.content || '').slice(0, MAX_MESSAGE_LENGTH);
      const attachments = (source.attachments || []).map((item) => ({ ...item }));
      if (!content && !attachments.length) return fail(res, 'Нечего пересылать');
      let forwardedFrom = null;
      if (!target.saved) {
        forwardedFrom = source.forwardedFrom
          ? { ...source.forwardedFrom }
          : {
              messageId: source.id,
              channelId: sourceChannel.id,
              channelName: channelDisplayName(sourceChannel, req.user.id),
              authorId: source.authorId,
              createdAt: source.createdAt,
            };
      }
      const message = {
        id: makeId('m'),
        channelId: target.id,
        authorId: req.user.id,
        content,
        createdAt: nowIso(),
        editedAt: null,
        replyToId: null,
        attachments,
        reactions: {},
        pinned: false,
        forwardedFrom,
      };
      db.data.messages.push(message);
      db.save();
      const dto = ser.messageDTO(message);
      io.to(channelRoom(target.id)).emit('message:new', { message: dto });
      res.json({ message: dto });
    })
  );

  app.post(
    '/api/messages/:messageId/reactions',
    auth,
    wrap((req, res) => {
      const message = db.message(req.params.messageId);
      if (!message) return fail(res, 'Сообщение не найдено', 404);
      const channel = db.channel(message.channelId);
      if (!channel || !canAccessChannel(req.user.id, channel)) return fail(res, 'Канал не найден', 404);
      const server = channel.type === 'dm' ? null : db.server(channel.serverId);
      if (server && !hasPermission(server, req.user.id, 'ADD_REACTIONS')) return fail(res, 'Недостаточно прав', 403);
      const emoji = String(req.body.emoji || '').slice(0, 32);
      if (!emoji.trim()) return fail(res, 'Некорректная реакция');
      if (!message.reactions) message.reactions = {};
      const users = new Set(message.reactions[emoji] || []);
      if (users.has(req.user.id)) users.delete(req.user.id);
      else users.add(req.user.id);
      if (users.size) message.reactions[emoji] = [...users];
      else delete message.reactions[emoji];
      db.save();
      const dto = ser.messageDTO(message);
      io.to(channelRoom(channel.id)).emit('message:update', { message: dto });
      res.json({ message: dto });
    })
  );

  app.patch(
    '/api/messages/:messageId/pin',
    auth,
    wrap((req, res) => {
      const message = db.message(req.params.messageId);
      if (!message) return fail(res, 'Сообщение не найдено', 404);
      const channel = db.channel(message.channelId);
      if (!channel || !canAccessChannel(req.user.id, channel)) return fail(res, 'Канал не найден', 404);
      const server = channel.type === 'dm' ? null : db.server(channel.serverId);
      const canPin =
        channel.type === 'dm' ||
        message.authorId === req.user.id ||
        (server && hasPermission(server, req.user.id, 'MANAGE_MESSAGES'));
      if (!canPin) return fail(res, 'Недостаточно прав', 403);
      message.pinned = req.body.pinned === undefined ? !message.pinned : Boolean(req.body.pinned);
      db.save();
      const dto = ser.messageDTO(message);
      io.to(channelRoom(channel.id)).emit('message:update', { message: dto });
      res.json({ message: dto });
    })
  );

  app.get(
    '/api/channels/:channelId/pins',
    auth,
    wrap((req, res) => {
      const channel = db.channel(req.params.channelId);
      if (!channel || !canAccessChannel(req.user.id, channel)) return fail(res, 'Канал не найден', 404);
      const pinned = db.data.messages
        .filter((m) => m.channelId === channel.id && m.pinned)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map((m) => ser.messageDTO(m));
      res.json({ messages: pinned });
    })
  );

  app.post(
    '/api/channels/:channelId/read',
    auth,
    wrap((req, res) => {
      const channel = db.channel(req.params.channelId);
      if (!channel || !canAccessChannel(req.user.id, channel)) return fail(res, 'Канал не найден', 404);
      const at = nowIso();
      const existing = db.data.readStates.find((r) => r.userId === req.user.id && r.channelId === channel.id);
      if (existing) existing.lastReadAt = at;
      else db.data.readStates.push({ userId: req.user.id, channelId: channel.id, lastReadAt: at });
      db.save();
      io.to(userRoom(req.user.id)).emit('read:sync', { channelId: channel.id, lastReadAt: at });
      if (channel.type === 'dm') {
        io.to(channelRoom(channel.id)).emit('read:update', {
          channelId: channel.id,
          userId: req.user.id,
          lastReadAt: at,
        });
      }
      res.json({ ok: true, lastReadAt: at });
    })
  );

  app.get(
    '/api/search',
    auth,
    wrap((req, res) => {
      const query = clean(req.query.q, 100).toLowerCase();
      if (query.length < 1) return res.json({ results: [] });
      const serverId = req.query.serverId ? String(req.query.serverId) : null;
      const channelId = req.query.channelId ? String(req.query.channelId) : null;
      const accessible = accessibleChannels(req.user.id);
      const allowed = new Set(accessible.map((c) => c.id));
      const results = [];
      for (const message of db.data.messages) {
        if (!allowed.has(message.channelId)) continue;
        if (channelId && message.channelId !== channelId) continue;
        const channel = db.channel(message.channelId);
        if (!channel) continue;
        if (serverId && channel.serverId !== serverId) continue;
        if (!(message.content || '').toLowerCase().includes(query)) continue;
        const server = channel.serverId ? db.server(channel.serverId) : null;
        results.push({
          message: ser.messageDTO(message),
          channel: {
            id: channel.id,
            name: channelDisplayName(channel, req.user.id),
            type: channel.type,
            serverId: channel.serverId,
            serverName: server?.name || null,
          },
        });
        if (results.length >= 60) break;
      }
      results.sort((a, b) => String(b.message.createdAt).localeCompare(String(a.message.createdAt)));
      res.json({ results: results.slice(0, 50), query });
    })
  );

  // ------------------------------------------------------------------
  // API стриминга
  // ------------------------------------------------------------------
  app.get('/api/streams', auth, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ streams: streamList() });
  });

  app.post('/api/streams', auth, (req, res) => {
    const title = clean(req.body?.title, 80) || 'Трансляция';
    const mode = req.body?.mode === 'link' ? 'link' : 'app';
    const requestedSource = req.body?.source;
    const source =
      requestedSource === 'screen' || requestedSource === 'both'
        ? requestedSource
        : 'camera';

    // Эфир можно запустить прямо из голосового канала — тогда он
    // закрепляется за каналом и виден его участникам.
    const requestedChannelId = req.body?.channelId ? String(req.body.channelId) : '';
    let channelId = null;
    if (requestedChannelId) {
      const channel = db.channel(requestedChannelId);
      if (!channel) return fail(res, 'Канал не найден', 404);
      const allowed = accessibleChannels(req.user.id).some((item) => item.id === channel.id);
      if (!allowed) return fail(res, 'Нет доступа к этому каналу', 403);
      channelId = channel.id;
    }

    // Один пользователь — одна трансляция. Новый эфир заменяет старый.
    for (const existing of [...liveStreams.values()]) {
      if (existing.hostId === req.user.id) endStream(existing.id, 'restart');
    }

    const id = makeId('stream');
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocol = forwardedProto || req.protocol || 'http';
    const host = req.get('host') || 'localhost:3001';
    const publicUrl = `${protocol}://${host}/stream/${id}`;
    const stream = {
      id,
      hostId: req.user.id,
      title,
      mode,
      source,
      channelId,
      createdAt: nowIso(),
      preview: null,
      lastPreviewAt: 0,
      hostSocketId: null,
      viewerSockets: new Set(),
      publicUrl,
      chat: [],
      chatLayout: null,
      chatStyle: 'dark',
      cameraStyle: 'classic',
    };
    liveStreams.set(id, stream);
    // Если клиент создал эфир, но так и не подключился к сигналингу,
    // не держим «призрачную» трансляцию в реестре.
    armStreamCleanup(stream, 30000);
    res.json({ stream: streamPublic(stream), url: publicUrl });
  });

  app.delete('/api/streams/:id', auth, (req, res) => {
    const stream = liveStreams.get(String(req.params.id || ''));
    if (!stream) return fail(res, 'Трансляция не найдена', 404);
    if (stream.hostId !== req.user.id) return fail(res, 'Это не ваша трансляция', 403);
    endStream(stream.id, 'stopped');
    res.json({ ok: true });
  });

  // Публичная информация для страницы просмотра в браузере.
  app.get('/api/streams/:id/public', (req, res) => {
    const stream = liveStreams.get(String(req.params.id || ''));
    if (!stream) return fail(res, 'Трансляция не найдена', 404);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ stream: streamPublic(stream) });
  });

  // ------------------------------------------------------------------
  // Watch Party REST
  // ------------------------------------------------------------------
  app.get('/api/watch', auth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ rooms: watchList(req.user.id) });
  });

  app.post('/api/watch', auth, (req, res) => {
    const title = clean(req.body?.title, 80) || 'Смотрим вместе';
    const channelId = String(req.body?.channelId || '');
    const channel = db.channel(channelId);
    if (!channel) return fail(res, 'Канал не найден', 404);
    if (!canAccessChannel(req.user.id, channel)) return fail(res, 'Нет доступа к каналу', 403);

    const source = sanitizeWatchSource(req.body?.source);
    if (!source) return fail(res, 'Нужна ссылка на YouTube или прямой видеофайл', 400);

    // В одном канале — одна активная комната, у пользователя — тоже одна.
    for (const existing of [...watchRooms.values()]) {
      if (existing.channelId === channelId || existing.hostId === req.user.id) {
        endWatch(existing.id, 'replaced');
      }
    }

    const room = {
      id: makeId('watch'),
      hostId: req.user.id,
      channelId,
      title,
      source,
      state: { playing: false, position: 0, rate: 1, updatedAt: Date.now(), revision: 1 },
      participants: new Map(),
      chat: [],
      queue: [],
      createdAt: nowIso(),
      hostSocketId: null,
      hostTimer: null,
      emptyTimer: null,
    };
    watchRooms.set(room.id, room);
    broadcastWatchUpdate(room);
    res.json({ room: watchPublic(room) });
  });

  app.get('/api/watch/:id', auth, (req, res) => {
    const room = watchRooms.get(String(req.params.id || ''));
    if (!room) return fail(res, 'Комната не найдена', 404);
    if (!canAccessChannel(req.user.id, db.channel(room.channelId))) {
      return fail(res, 'Нет доступа к комнате', 403);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ room: watchPublic(room) });
  });

  app.delete('/api/watch/:id', auth, (req, res) => {
    const room = watchRooms.get(String(req.params.id || ''));
    if (!room) return fail(res, 'Комната не найдена', 404);
    if (room.hostId !== req.user.id) return fail(res, 'Закрыть комнату может только хост', 403);
    endWatch(room.id, 'stopped');
    res.json({ ok: true });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, users: db.data.users.length, messages: db.data.messages.length });
  });

  // Клиенты (desktop, portable, Android) сверяют свою версию с сервером.
  app.get('/api/version', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(updateInfo(updatesDir, appVersion));
  });

  // ------------------------------------------------------------------
  // Socket.IO
  // ------------------------------------------------------------------
  io.use((socket, next) => {
    const payload = verifyToken(socket.handshake.auth?.token || '');
    const user = payload ? db.user(payload.sub) : null;
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = user.id;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    const user = db.user(userId);
    if (!user) return socket.disconnect(true);

    socket.join(userRoom(userId));
    for (const server of db.data.servers) {
      if (!isMember(server, userId)) continue;
      socket.join(serverRoom(server.id));
      for (const channel of serverChannels(server.id)) {
        if (hasPermission(server, userId, 'VIEW_CHANNELS')) socket.join(channelRoom(channel.id));
      }
    }
    for (const channel of db.data.channels) {
      if (channel.type === 'dm' && (channel.memberIds || []).includes(userId)) {
        socket.join(channelRoom(channel.id));
      }
    }

    const live = presence.get(userId);
    if (live) live.sockets.add(socket.id);
    else {
      presence.set(userId, { sockets: new Set([socket.id]), status: user.status || 'online' });
      broadcastPresence(userId);
    }
    socket.emit('presence:update', { userId, status: presenceStatus(userId) });

    socket.on('typing:start', (payload = {}) => {
      const channel = db.channel(String(payload.channelId || ''));
      if (!channel || !canAccessChannel(userId, channel)) return;
      socket.to(channelRoom(channel.id)).emit('typing:start', {
        channelId: channel.id,
        user: ser.publicUser(db.user(userId)),
      });
    });

    socket.on('typing:stop', (payload = {}) => {
      const channel = db.channel(String(payload.channelId || ''));
      if (!channel) return;
      socket.to(channelRoom(channel.id)).emit('typing:stop', {
        channelId: channel.id,
        userId,
      });
    });

    function leaveVoice(reason = 'leave') {
      const channelId = voiceBySocket.get(socket.id);
      if (!channelId) return;
      voiceBySocket.delete(socket.id);
      socket.leave(voiceRoom(channelId));
      const map = voiceChannels.get(channelId);
      if (map) {
        const state = map.get(userId);
        if (state && state.socketId === socket.id) {
          map.delete(userId);
          if (!map.size) voiceChannels.delete(channelId);
        }
      }
      broadcastVoiceState(channelId);
      const channel = db.channel(channelId);
      if (channel?.type === 'dm' && !voiceChannels.get(channelId)?.size) {
        io.to(channelRoom(channelId)).emit('call:ended', { channelId, reason });
      }
    }

    socket.on('voice:join', (payload = {}, ack) => {
      try {
        const channel = db.channel(String(payload.channelId || ''));
        if (!channel) throw new Error('Канал не найден');
        if (channel.type === 'dm') {
          if (!(channel.memberIds || []).includes(userId)) throw new Error('Нет доступа к звонку');
        } else {
          const server = db.server(channel.serverId);
          if (!server || !isMember(server, userId)) throw new Error('Нет доступа к каналу');
          if (channel.type !== 'voice') throw new Error('Это не голосовой канал');
          if (!hasPermission(server, userId, 'CONNECT')) throw new Error('Нет права подключаться к голосу');
        }
        if (voiceBySocket.has(socket.id)) leaveVoice('switch');
        const map = voiceChannels.get(channel.id) || new Map();
        const state = {
          socketId: socket.id,
          muted: Boolean(payload.muted),
          deafened: Boolean(payload.deafened),
          camera: false,
          screen: false,
          speaking: false,
          voiceStreamId: String(payload.voiceStreamId || '').slice(0, 128),
          screenAudioStreamId: '',
          joinedAt: nowIso(),
        };
        map.set(userId, state);
        voiceChannels.set(channel.id, map);
        voiceBySocket.set(socket.id, channel.id);
        socket.join(voiceRoom(channel.id));
        broadcastVoiceState(channel.id);
        const participants = voiceParticipants(channel.id).filter((p) => p.userId !== userId);
        if (typeof ack === 'function') {
          ack({
            ok: true,
            channelId: channel.id,
            self: {
              userId,
              muted: state.muted,
              deafened: state.deafened,
              camera: false,
              screen: false,
            },
            participants: participants.map((p) => ({
              userId: p.userId,
              user: p.user,
              muted: p.muted,
              deafened: p.deafened,
              camera: p.camera,
              screen: p.screen,
              voiceStreamId: p.voiceStreamId,
              screenAudioStreamId: p.screenAudioStreamId,
            })),
          });
        }
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    socket.on('voice:leave', () => leaveVoice('leave'));

    socket.on('voice:update', (payload = {}) => {
      const channelId = voiceBySocket.get(socket.id);
      if (!channelId) return;
      const map = voiceChannels.get(channelId);
      const state = map?.get(userId);
      if (!state || state.socketId !== socket.id) return;
      if (payload.muted !== undefined) state.muted = Boolean(payload.muted);
      if (payload.deafened !== undefined) state.deafened = Boolean(payload.deafened);
      if (payload.camera !== undefined) state.camera = Boolean(payload.camera);
      if (payload.screen !== undefined) state.screen = Boolean(payload.screen);
      if (payload.voiceStreamId !== undefined) {
        state.voiceStreamId = String(payload.voiceStreamId || '').slice(0, 128);
      }
      if (payload.screenAudioStreamId !== undefined) {
        state.screenAudioStreamId = String(payload.screenAudioStreamId || '').slice(0, 128);
      }
      broadcastVoiceState(channelId);
    });

    socket.on('voice:speaking', (payload = {}) => {
      const channelId = voiceBySocket.get(socket.id);
      if (!channelId) return;
      const map = voiceChannels.get(channelId);
      const state = map?.get(userId);
      if (!state) return;
      state.speaking = Boolean(payload.speaking);
      socket.to(channelRoom(channelId)).emit('voice:speaking', {
        channelId,
        userId,
        speaking: state.speaking,
      });
    });

    socket.on('voice:signal', (payload = {}) => {
      const channelId = voiceBySocket.get(socket.id);
      if (!channelId) return;
      const map = voiceChannels.get(channelId);
      if (!map || !map.has(String(payload.to || ''))) return;
      io.to(userRoom(String(payload.to))).emit('voice:signal', {
        from: userId,
        data: payload.data,
      });
    });

    // Небольшой JPEG-кадр для карточки трансляции в разделе «Стриминг».
    socket.on('stream:preview', (payload = {}) => {
      const stream = [...liveStreams.values()].find(
        (item) => item.hostId === userId && item.hostSocketId
      );
      if (!stream) return;
      const preview = String(payload.preview || '');
      if (!/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(preview)) return;
      if (preview.length > 190_000) return;
      const now = Date.now();
      if (now - (stream.lastPreviewAt || 0) < 3000) return;
      stream.lastPreviewAt = now;
      stream.preview = preview;
      broadcastStreams();
    });

    socket.on('call:invite', (payload = {}) => {
      const channel = db.channel(String(payload.channelId || ''));
      if (!channel || channel.type !== 'dm' || !channel.memberIds.includes(userId)) return;
      for (const memberId of channel.memberIds) {
        if (memberId === userId) continue;
        emitUser(memberId, 'call:incoming', {
          channelId: channel.id,
          from: ser.publicUser(db.user(userId)),
          channel: ser.dmDTO(channel),
        });
      }
    });

    socket.on('call:decline', (payload = {}) => {
      const channel = db.channel(String(payload.channelId || ''));
      if (!channel || channel.type !== 'dm' || !channel.memberIds.includes(userId)) return;
      io.to(channelRoom(channel.id)).emit('call:declined', {
        channelId: channel.id,
        by: ser.publicUser(db.user(userId)),
      });
    });

    socket.on('disconnect', () => {
      leaveVoice('disconnect');
      const liveState = presence.get(userId);
      if (liveState) {
        liveState.sockets.delete(socket.id);
        if (liveState.sockets.size === 0) {
          presence.delete(userId);
          broadcastPresence(userId);
        }
      }
    });
  });

  // ------------------------------------------------------------------
  // WebRTC-сигналинг трансляций (публичная страница и клиент)
  // ------------------------------------------------------------------
  streamIo.on('connection', (socket) => {
    const auth = socket.handshake.auth || {};
    const streamId = String(auth.streamId || '');
    const stream = liveStreams.get(streamId);
    if (!stream) {
      socket.emit('stream:error', { error: 'Трансляция не найдена или уже завершилась' });
      socket.disconnect(true);
      return;
    }

    const role = auth.role === 'host' ? 'host' : 'viewer';
    if (role === 'host') {
      const payload = verifyToken(String(auth.token || ''));
      const user = payload ? db.user(payload.sub) : null;
      if (!user || user.id !== stream.hostId) {
        socket.emit('stream:error', { error: 'Нет прав на эту трансляцию' });
        socket.disconnect(true);
        return;
      }
      // Если стример переподключился, старый сокет больше не нужен.
      if (stream.hostSocketId && stream.hostSocketId !== socket.id) {
        const previous = streamIo.sockets.get(stream.hostSocketId);
        if (previous) previous.disconnect(true);
      }
      stream.hostSocketId = socket.id;
      clearStreamCleanup(stream);
      socket.join(streamRoom(streamId));
      socket.emit('stream:host', { stream: streamPublic(stream) });
      // Стример мог подключиться позже зрителей — знакомим его с ними.
      for (const viewerId of stream.viewerSockets) {
        socket.emit('stream:viewer', { viewerId });
      }
      broadcastStreams();

      socket.on('disconnect', () => {
        if (stream.hostSocketId !== socket.id) return;
        stream.hostSocketId = null;
        if (!liveStreams.has(streamId)) return;
        // Даём стримеру 15 секунд на переподключение, не разрывая зрителей.
        broadcastStreams();
        armStreamCleanup(stream, 15000);
      });
    } else {
      stream.viewerSockets.add(socket.id);
      socket.join(streamRoom(streamId));
      socket.emit('stream:ready', {
        stream: streamPublic(stream),
        hostId: stream.hostSocketId || null,
      });
      if (stream.hostSocketId) {
        streamIo.to(stream.hostSocketId).emit('stream:viewer', { viewerId: socket.id });
      }
      broadcastStreams();
      broadcastStreamViewers(stream);

      socket.on('disconnect', () => {
        stream.viewerSockets.delete(socket.id);
        if (stream.hostSocketId) {
          streamIo.to(stream.hostSocketId).emit('stream:viewer-left', { viewerId: socket.id });
        }
        broadcastStreamViewers(stream);
        broadcastStreams();
      });
    }

    // Кто пишет в чат: авторизованный пользователь — под реальным ником,
    // остальные зрители получают гостевой ник Guest#1234.
    const tokenPayload = verifyToken(String(auth.token || ''));
    const account = tokenPayload ? db.user(tokenPayload.sub) : null;
    let chatUser;
    if (account) {
      const pub = ser.publicUser(account);
      chatUser = {
        id: pub.id,
        name: pub.displayName || pub.username || 'Пользователь',
        avatar: pub.avatar || '',
        guest: false,
      };
    } else {
      let guestName = String(auth.guestName || '').trim();
      if (!/^Guest#\d{4}$/.test(guestName)) {
        guestName = `Guest#${Math.floor(1000 + Math.random() * 9000)}`;
      }
      chatUser = { id: `guest-${socket.id}`, name: guestName, avatar: '', guest: true };
    }
    socket.data.chatUser = chatUser;
    socket.data.lastChatAt = 0;
    if (!Array.isArray(stream.chat)) stream.chat = [];
    socket.emit('stream:chat-history', {
      messages: stream.chat.slice(-STREAM_CHAT_LIMIT),
      self: chatUser,
    });

    socket.on('stream:chat', (payload = {}) => {
      const text = String(payload.text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
      if (!text) return;
      const now = Date.now();
      if (now - (socket.data.lastChatAt || 0) < 600) return;
      socket.data.lastChatAt = now;
      const message = {
        id: `chat_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        user: chatUser,
        text,
        at: new Date(now).toISOString(),
      };
      stream.chat.push(message);
      if (stream.chat.length > STREAM_CHAT_LIMIT) {
        stream.chat.splice(0, stream.chat.length - STREAM_CHAT_LIMIT);
      }
      streamIo.to(streamRoom(streamId)).emit('stream:chat', message);
    });

    socket.on('stream:chat-layout', (payload = {}) => {
      if (role !== 'host') return;
      const layout = sanitizeChatLayout(payload.layout || payload);
      if (!layout) return;
      stream.chatLayout = layout;
      streamIo.to(streamRoom(streamId)).emit('stream:chat-layout', { layout });
    });

    socket.on('stream:chat-style', (payload = {}) => {
      if (role !== 'host') return;
      const style = sanitizeChatStyle(payload.style ?? payload);
      if (!style) return;
      stream.chatStyle = style;
      streamIo.to(streamRoom(streamId)).emit('stream:chat-style', { style });
    });

    socket.on('stream:camera-style', (payload = {}) => {
      if (role !== 'host') return;
      const style = sanitizeCameraStyle(payload.style ?? payload);
      if (!style) return;
      stream.cameraStyle = style;
      streamIo.to(streamRoom(streamId)).emit('stream:camera-style', { style });
    });

    socket.on('stream:signal', (payload = {}) => {
      const to = String(payload.to || '');
      if (!to || !payload.data) return;
      const target = streamIo.sockets.get(to);
      if (!target || !target.rooms.has(streamRoom(streamId))) return;
      target.emit('stream:signal', { from: socket.id, data: payload.data });
    });
  });

  // ------------------------------------------------------------------
  // Watch Party — состояние комнаты, чат и синхронизация плеера
  // ------------------------------------------------------------------
  watchIo.use((socket, next) => {
    const payload = verifyToken(socket.handshake.auth?.token || '');
    const user = payload ? db.user(payload.sub) : null;
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = user.id;
    next();
  });

  watchIo.on('connection', (socket) => {
    const userId = socket.data.userId;
    const roomId = String(socket.handshake.auth?.roomId || '');
    const room = watchRooms.get(roomId);
    if (!room) {
      socket.emit('watch:error', { error: 'Комната не найдена или уже завершилась' });
      socket.disconnect(true);
      return;
    }
    const channel = db.channel(room.channelId);
    if (!channel || !canAccessChannel(userId, channel)) {
      socket.emit('watch:error', { error: 'Нет доступа к комнате' });
      socket.disconnect(true);
      return;
    }
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }

    const previous = room.participants.get(userId);
    if (previous?.socketId && previous.socketId !== socket.id) {
      const oldSocket = watchIo.sockets.get(previous.socketId);
      if (oldSocket) oldSocket.disconnect(true);
    }
    room.participants.set(userId, {
      socketId: socket.id,
      buffering: false,
      joinedAt: previous?.joinedAt || nowIso(),
    });
    socket.join(watchRoomName(room.id));

    const isHost = room.hostId === userId;
    if (isHost) {
      if (room.hostTimer) {
        clearTimeout(room.hostTimer);
        room.hostTimer = null;
      }
      if (room.hostSocketId && room.hostSocketId !== socket.id) {
        const oldHost = watchIo.sockets.get(room.hostSocketId);
        if (oldHost) oldHost.disconnect(true);
      }
      room.hostSocketId = socket.id;
    }

    const emitParticipants = () => {
      watchIo.to(watchRoomName(room.id)).emit('watch:participants', {
        participants: watchParticipants(room),
        live: Boolean(room.hostSocketId),
      });
    };

    socket.emit('watch:state', {
      room: watchPublic(room),
      state: room.state,
      serverNow: Date.now(),
      participants: watchParticipants(room),
      chat: room.chat.slice(-WATCH_CHAT_LIMIT),
      queue: room.queue,
      self: { userId, host: isHost },
    });
    emitParticipants();
    broadcastWatchUpdate(room);

    socket.on('watch:command', (payload = {}, ack) => {
      if (room.hostId !== userId) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Управляет хост' });
        return;
      }
      const action = String(payload.action || '');
      const position = Number(payload.position);
      const rate = Number(payload.rate);
      if (action === 'play' || action === 'pause') {
        room.state.playing = action === 'play';
        if (Number.isFinite(position)) room.state.position = Math.max(0, position);
      } else if (action === 'seek') {
        if (!Number.isFinite(position)) return;
        room.state.position = Math.max(0, position);
      } else if (action === 'rate') {
        if (!Number.isFinite(rate) || rate < 0.25 || rate > 2) return;
        if (Number.isFinite(position)) room.state.position = Math.max(0, position);
        room.state.rate = rate;
      } else {
        return;
      }
      room.state.updatedAt = Date.now();
      room.state.revision += 1;
      watchIo.to(watchRoomName(room.id)).emit('watch:sync', {
        state: room.state,
        serverNow: Date.now(),
      });
      if (typeof ack === 'function') ack({ ok: true, state: room.state });
    });

    // Ссылку может сменить любой участник комнаты, а не только хост.
    socket.on('watch:source', (payload = {}, ack) => {
      const now = Date.now();
      if (now - (socket.data.lastWatchSourceAt || 0) < 1500) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Слишком часто. Подождите пару секунд.' });
        return;
      }
      const source = sanitizeWatchSource(payload.source);
      if (!source) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Нужна ссылка на YouTube, видео или сайт' });
        return;
      }
      socket.data.lastWatchSourceAt = now;
      room.source = source;
      room.state = {
        playing: false,
        position: 0,
        rate: 1,
        updatedAt: now,
        revision: (Number(room.state?.revision) || 0) + 1,
      };
      room.queue = [];
      watchIo.to(watchRoomName(room.id)).emit('watch:source', {
        room: watchPublic(room),
        source: room.source,
        state: room.state,
        serverNow: Date.now(),
      });
      broadcastWatchUpdate(room);
      if (typeof ack === 'function') ack({ ok: true, room: watchPublic(room) });
    });

    socket.on('watch:tick', (payload = {}) => {
      if (room.hostId !== userId || !room.state.playing) return;
      const position = Number(payload.position);
      if (!Number.isFinite(position)) return;
      room.state.position = Math.max(0, position);
      room.state.updatedAt = Date.now();
      room.state.revision += 1;
      watchIo.to(watchRoomName(room.id)).emit('watch:sync', {
        state: room.state,
        serverNow: Date.now(),
      });
    });

    socket.on('watch:buffer', (payload = {}) => {
      const state = room.participants.get(userId);
      if (!state) return;
      state.buffering = Boolean(payload.buffering);
      emitParticipants();
    });

    socket.on('watch:chat', (payload = {}) => {
      const text = String(payload.text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      if (!text) return;
      const now = Date.now();
      if (now - (socket.data.lastWatchChatAt || 0) < 500) return;
      socket.data.lastWatchChatAt = now;
      const message = {
        id: `watch_chat_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        user: ser.publicUser(db.user(userId)),
        text,
        at: new Date(now).toISOString(),
      };
      room.chat.push(message);
      if (room.chat.length > WATCH_CHAT_LIMIT) {
        room.chat.splice(0, room.chat.length - WATCH_CHAT_LIMIT);
      }
      watchIo.to(watchRoomName(room.id)).emit('watch:chat', message);
    });

    socket.on('watch:end', () => {
      if (room.hostId !== userId) return;
      endWatch(room.id, 'stopped');
    });

    const leave = () => {
      const state = room.participants.get(userId);
      if (!state || state.socketId !== socket.id) return;
      room.participants.delete(userId);
      socket.leave(watchRoomName(room.id));
      emitParticipants();
      broadcastWatchUpdate(room);
      if (!room.participants.size) {
        if (room.emptyTimer) clearTimeout(room.emptyTimer);
        room.emptyTimer = setTimeout(() => {
          if (watchRooms.has(room.id) && !room.participants.size) {
            endWatch(room.id, 'empty');
          }
        }, 10 * 60 * 1000);
      }
    };

    socket.on('watch:leave', leave);
    socket.on('disconnect', () => {
      leave();
      if (room.hostId === userId && room.hostSocketId === socket.id) {
        room.hostSocketId = null;
        room.state.playing = false;
        room.state.updatedAt = Date.now();
        room.state.revision += 1;
        watchIo.to(watchRoomName(room.id)).emit('watch:sync', {
          state: room.state,
          serverNow: Date.now(),
        });
        emitParticipants();
        broadcastWatchUpdate(room);
        if (room.hostTimer) clearTimeout(room.hostTimer);
        room.hostTimer = setTimeout(() => {
          if (!room.hostSocketId && watchRooms.has(room.id)) endWatch(room.id, 'host-left');
        }, 2 * 60 * 1000);
      }
    });
  });

  // Публичная страница просмотра: ссылку можно открыть в любом браузере
  // без установки Carnage Party.
  app.get('/stream/:id', (req, res, next) => {
    if (!/^stream_[a-f0-9]{16}$/i.test(String(req.params.id || ''))) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'public', 'stream.html'), (err) => {
      if (err) next(err);
    });
  });

  // ------------------------------------------------------------------
  // Раздача клиента и обработка ошибок
  // ------------------------------------------------------------------
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  if (serveClient && fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist, { index: false }));
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path.startsWith('/socket.io')) {
        return next();
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return fail(res, 'Маршрут не найден', 404);
    res.status(404).send('Not found');
  });

  app.use((err, _req, res, _next) => {
    console.error('[server]', err);
    if (err?.code === 'LIMIT_FILE_SIZE') return fail(res, 'Файл слишком большой (максимум 25 МБ)', 413);
    if (err?.code === 'LIMIT_FILE_COUNT') return fail(res, 'Слишком много файлов (максимум 8)', 413);
    return fail(res, 'Внутренняя ошибка сервера', 500);
  });

  return new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err.code === 'EADDRINUSE') reject(err);
      else reject(err);
    };
    httpServer.once('error', onError);
    httpServer.listen(requestedPort, host, () => {
      httpServer.removeListener('error', onError);
      const actualPort = httpServer.address().port;
      console.log(`[server] Carnage Party API: http://${host}:${actualPort}`);
      let closed = false;
      const close = () =>
        new Promise((done) => {
          if (closed) return done();
          closed = true;
          try { db.flush(); } catch {}
          io.close(() => {
            httpServer.close(() => done());
          });
          setTimeout(done, 1500);
        });
      resolve({
        port: actualPort,
        host,
        server: httpServer,
        app,
        io,
        db,
        close,
        url: `http://${host}:${actualPort}`,
      });
    });
  });
}

module.exports = { startServer };
