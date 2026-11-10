'use strict';

const { permissionsOf } = require('./permissions.cjs');

function makeSerializers(db) {
  const userCache = () => new Map(db.data.users.map((u) => [u.id, u]));

  function publicUser(user) {
    if (!user) {
      return {
        id: 'unknown',
        username: 'unknown',
        displayName: 'Неизвестный',
        avatar: null,
        accentColor: '#5865f2',
        bio: '',
        status: 'offline',
        createdAt: null,
      };
    }
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      avatar: user.avatar || null,
      banner: user.banner || null,
      accentColor: user.accentColor || '#5865f2',
      bio: user.bio || '',
      customStatus: user.customStatus || '',
      status: user.status || 'offline',
      createdAt: user.createdAt || null,
      bot: Boolean(user.bot),
    };
  }

  function botDTO(bot) {
    if (!bot) return null;
    return {
      id: bot.id,
      serverId: bot.serverId || null,
      username: bot.username,
      displayName: bot.displayName || bot.username,
      avatar: bot.avatar || null,
      accentColor: bot.accentColor || '#5865f2',
      ownerId: bot.ownerId || null,
      createdAt: bot.createdAt || null,
      bot: true,
    };
  }

  function selfUser(user) {
    return {
      ...publicUser(user),
      email: user.email,
      settings: user.settings || {},
    };
  }

  function serverDTO(server) {
    const cache = userCache();
    return {
      id: server.id,
      name: server.name,
      icon: server.icon || null,
      accentColor: server.accentColor || '#5865f2',
      ownerId: server.ownerId,
      inviteCode: server.inviteCode,
      createdAt: server.createdAt,
      roles: (server.roles || []).map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        permissions: [...(r.permissions || [])],
        position: r.position || 0,
        hoist: Boolean(r.hoist),
        system: Boolean(r.system),
      })),
      members: (server.members || []).map((m) => ({
        ...publicUser(cache.get(m.userId)),
        roleIds: [...(m.roleIds || [])],
        nickname: m.nickname || null,
        joinedAt: m.joinedAt,
        voiceMuted: Boolean(m.voiceMuted),
        permissions: permissionsOf(server, m.userId),
      })),
    };
  }

  function lastMessageFor(channelId) {
    let last = null;
    for (const m of db.data.messages) {
      if (m.channelId !== channelId) continue;
      if (!last || m.createdAt > last.createdAt) last = m;
    }
    if (!last) return null;
    const author = db.user(last.authorId);
    return {
      id: last.id,
      content: last.content || '',
      createdAt: last.createdAt,
      authorId: last.authorId,
      authorName: author ? author.displayName || author.username : 'Неизвестный',
    };
  }

  function dmDTO(channel) {
    const cache = userCache();
    const members = (channel.memberIds || []).map((id) => publicUser(cache.get(id)));
    let name = channel.name;
    if (!name && members.length > 2) {
      name = members.map((m) => m.displayName).join(', ');
    }
    return {
      id: channel.id,
      serverId: null,
      type: 'dm',
      saved: Boolean(channel.saved),
      name: name || null,
      icon: channel.icon || null,
      ownerId: channel.ownerId || null,
      memberIds: [...(channel.memberIds || [])],
      members,
      createdAt: channel.createdAt,
      lastMessage: lastMessageFor(channel.id),
    };
  }

  function channelDTO(channel) {
    if (channel.type === 'dm') return dmDTO(channel);
    return {
      id: channel.id,
      serverId: channel.serverId,
      type: channel.type,
      name: channel.name,
      category: channel.category || '',
      topic: channel.topic || '',
      position: channel.position || 0,
      userLimit: channel.userLimit || 0,
      createdAt: channel.createdAt,
    };
  }

  function attachmentDTO(file) {
    return {
      id: file.id,
      name: file.name,
      size: file.size,
      mime: file.mime,
      url: file.url,
      duration: Number(file.duration) || 0,
      kind: file.kind || null,
      waveform: Array.isArray(file.waveform) ? file.waveform : [],
    };
  }

  function messageDTO(message, options = {}) {
    const author = db.user(message.authorId);
    let replyTo = null;
    if (message.replyToId) {
      const original = db.message(message.replyToId);
      if (original) {
        const originalAuthor = db.user(original.authorId);
        replyTo = {
          id: original.id,
          content: (original.content || '').slice(0, 180),
          author: originalAuthor ? publicUser(originalAuthor) : null,
          hasAttachments: (original.attachments || []).length > 0,
        };
      }
    }
    let forwardedFrom = null;
    if (message.forwardedFrom) {
      const source = message.forwardedFrom;
      const sourceAuthor = db.user(source.authorId);
      forwardedFrom = {
        messageId: source.messageId || null,
        channelId: source.channelId || null,
        channelName: source.channelName || '',
        author: sourceAuthor ? publicUser(sourceAuthor) : null,
        createdAt: source.createdAt || null,
      };
    }
    return {
      id: message.id,
      channelId: message.channelId,
      author: publicUser(author),
      content: message.content || '',
      createdAt: message.createdAt,
      editedAt: message.editedAt || null,
      replyToId: message.replyToId || null,
      replyTo,
      forwardedFrom,
      attachments: (message.attachments || []).map(attachmentDTO),
      reactions: message.reactions || {},
      pinned: Boolean(message.pinned),
      system: Boolean(message.system),
    };
  }

  function friendData(userId) {
    const cache = userCache();
    const accepted = [];
    const incoming = [];
    const outgoing = [];
    const blocked = [];
    for (const f of db.data.friendships) {
      if (f.status === 'accepted') {
        if (f.requesterId === userId) accepted.push(publicUser(cache.get(f.addresseeId)));
        else if (f.addresseeId === userId) accepted.push(publicUser(cache.get(f.requesterId)));
      } else if (f.status === 'pending') {
        if (f.addresseeId === userId) incoming.push(publicUser(cache.get(f.requesterId)));
        else if (f.requesterId === userId) outgoing.push(publicUser(cache.get(f.addresseeId)));
      } else if (f.status === 'blocked' && f.blockedBy === userId) {
        const other = f.requesterId === userId ? f.addresseeId : f.requesterId;
        blocked.push(publicUser(cache.get(other)));
      }
    }
    return { accepted, incoming, outgoing, blocked };
  }

  function unreadData(userId, channelIds) {
    const readMap = new Map();
    for (const r of db.data.readStates) {
      if (r.userId === userId) readMap.set(r.channelId, r.lastReadAt);
    }
    const user = db.user(userId);
    const nameMention = user ? `@${user.username.toLowerCase()}` : null;
    const counts = {};
    const mentions = {};
    const lastRead = {};
    const grouped = new Map();
    const idSet = new Set(channelIds);
    for (const m of db.data.messages) {
      if (!idSet.has(m.channelId)) continue;
      if (!grouped.has(m.channelId)) grouped.set(m.channelId, []);
      grouped.get(m.channelId).push(m);
    }
    for (const channelId of channelIds) {
      const since = readMap.get(channelId) || 0;
      lastRead[channelId] = since;
      const list = grouped.get(channelId) || [];
      let count = 0;
      let mentionCount = 0;
      for (const m of list) {
        if (m.authorId === userId) continue;
        if (new Date(m.createdAt).getTime() <= since) continue;
        count++;
        const content = (m.content || '').toLowerCase();
        if (nameMention && content.includes(nameMention)) mentionCount++;
        else if (content.includes('@everyone') || content.includes('@here')) mentionCount++;
      }
      if (count) counts[channelId] = count;
      if (mentionCount) mentions[channelId] = mentionCount;
    }
    return { counts, mentions, lastRead };
  }

  return {
    publicUser,
    selfUser,
    botDTO,
    serverDTO,
    channelDTO,
    dmDTO,
    messageDTO,
    friendData,
    unreadData,
    lastMessageFor,
  };
}

module.exports = { makeSerializers };
