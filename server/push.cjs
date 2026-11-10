'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readOrCreateKeys(dataDir) {
  const file = path.join(dataDir, 'push-keys.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed?.publicKey && parsed?.privateKey) return parsed;
  } catch {}
  let webpush;
  try {
    webpush = require('web-push');
  } catch (err) {
    console.warn('[push] web-push не установлен:', err.message);
    return null;
  }
  const keys = webpush.generateVAPIDKeys();
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(keys, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    console.warn('[push] Не удалось сохранить VAPID-ключи:', err.message);
  }
  return keys;
}

function subscriptionId(endpoint) {
  return `push_${crypto.createHash('sha1').update(String(endpoint)).digest('hex').slice(0, 20)}`;
}

function createPushService({ dataDir, db, app, auth, wrap, fail, makeId, nowIso, presence, canAccessChannel }) {
  let webpush = null;
  let keys = null;
  try {
    webpush = require('web-push');
    keys = readOrCreateKeys(dataDir);
    if (webpush && keys) {
      const subject = String(process.env.CARNAGE_VAPID_SUBJECT || 'mailto:admin@carnage.local');
      webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
    }
  } catch (err) {
    console.warn('[push] Push-уведомления отключены:', err.message);
  }

  const enabled = Boolean(webpush && keys);

  function subscriptionsOf(userId) {
    return (db.data.pushSubscriptions || []).filter((item) => item.userId === userId);
  }

  function subscriptionPayload(item) {
    return {
      endpoint: item.endpoint,
      keys: { p256dh: item.keys?.p256dh || '', auth: item.keys?.auth || '' },
    };
  }

  async function sendToSubscription(item, payload) {
    if (!enabled) return false;
    try {
      await webpush.sendNotification(subscriptionPayload(item), JSON.stringify(payload), {
        TTL: 60 * 60,
        urgency: payload.urgency || 'normal',
      });
      return true;
    } catch (err) {
      const status = Number(err?.statusCode) || 0;
      if (status === 404 || status === 410) {
        db.data.pushSubscriptions = (db.data.pushSubscriptions || []).filter(
          (row) => row.id !== item.id
        );
        db.save();
      } else if (status !== 429) {
        console.warn('[push] Ошибка отправки:', status || err.message);
      }
      return false;
    }
  }

  async function sendToUser(userId, payload) {
    const list = subscriptionsOf(userId);
    let sent = 0;
    for (const item of list) {
      if (await sendToSubscription(item, payload)) sent += 1;
    }
    return sent;
  }

  function isMentioned(message, user) {
    const content = String(message?.content || '').toLowerCase();
    return (
      content.includes('@everyone') ||
      content.includes('@here') ||
      content.includes(`@${String(user.username || '').toLowerCase()}`) ||
      content.includes(`@${String(user.displayName || '').toLowerCase()}`)
    );
  }

  async function notifyMessage(message, channel) {
    if (!enabled || !message || !channel) return;
    if (message.author?.bot) return;
    const author = message.author;
    for (const user of db.data.users || []) {
      if (!user || user.bot || user.id === author?.id) continue;
      if (!canAccessChannel(user.id, channel)) continue;
      const list = subscriptionsOf(user.id);
      if (!list.length) continue;
      const online = Boolean(presence.get(user.id)?.sockets?.size);
      if (online) continue;
      if (!list.some((item) => item.notifyAll || channel.type === 'dm' || isMentioned(message, user))) {
        continue;
      }
      const title = channel.type === 'dm'
        ? author?.displayName || 'Новое сообщение'
        : `${author?.displayName || 'Кто-то'} · #${channel.name || 'канал'}`;
      const body = message.content
        ? String(message.content).slice(0, 180)
        : message.attachments?.length
          ? 'Вложение'
          : 'Новое сообщение';
      await sendToUser(user.id, {
        title,
        body,
        tag: `channel:${channel.id}`,
        url: `/?channel=${encodeURIComponent(channel.id)}`,
        icon: '/favicon.png',
        data: { channelId: channel.id, messageId: message.id },
      });
    }
  }

  async function notifyIncomingCall(userId, from, channel) {
    if (!enabled || !userId) return;
    const online = Boolean(presence.get(userId)?.sockets?.size);
    if (online) return;
    await sendToUser(userId, {
      title: 'Входящий звонок',
      body: `${from?.displayName || 'Пользователь'} звонит в Carnage Party`,
      tag: `call:${channel?.id || ''}`,
      url: '/',
      icon: '/favicon.png',
      urgency: 'high',
      data: { channelId: channel?.id || null, call: true },
    });
  }

  app.get('/api/push/key', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ enabled, publicKey: enabled ? keys.publicKey : '' });
  });

  app.post(
    '/api/push/subscribe',
    auth,
    wrap((req, res) => {
      if (!enabled) return fail(res, 'Push-уведомления на сервере не настроены', 503);
      const raw = req.body?.subscription || req.body;
      const endpoint = String(raw?.endpoint || '').trim();
      const p256dh = String(raw?.keys?.p256dh || '').trim();
      const authKey = String(raw?.keys?.auth || '').trim();
      if (!/^https?:\/\//i.test(endpoint) || !p256dh || !authKey) {
        return fail(res, 'Некорректная push-подписка');
      }
      const id = subscriptionId(endpoint);
      const existing = (db.data.pushSubscriptions || []).find((item) => item.id === id);
      const data = {
        id,
        userId: req.user.id,
        endpoint,
        keys: { p256dh, auth: authKey },
        notifyAll: Boolean(req.body?.notifyAll),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
        createdAt: existing?.createdAt || nowIso(),
        updatedAt: nowIso(),
      };
      if (existing) Object.assign(existing, data);
      else db.data.pushSubscriptions.push(data);
      db.save();
      res.json({ ok: true, id });
    })
  );

  app.post(
    '/api/push/unsubscribe',
    auth,
    wrap((req, res) => {
      const endpoint = String(req.body?.endpoint || '').trim();
      const id = String(req.body?.id || '').trim();
      db.data.pushSubscriptions = (db.data.pushSubscriptions || []).filter(
        (item) => item.userId !== req.user.id || (endpoint ? item.endpoint !== endpoint : item.id !== id)
      );
      db.save();
      res.json({ ok: true });
    })
  );

  app.post(
    '/api/push/test',
    auth,
    wrap(async (req, res) => {
      const sent = await sendToUser(req.user.id, {
        title: 'Carnage Party',
        body: 'Push-уведомления работают. Можно закрывать вкладку.',
        tag: 'push-test',
        url: '/',
        icon: '/favicon.png',
      });
      res.json({ ok: sent > 0, sent, enabled });
    })
  );

  return {
    enabled,
    publicKey: keys?.publicKey || '',
    notifyMessage,
    notifyIncomingCall,
    sendToUser,
  };
}

module.exports = { createPushService };
