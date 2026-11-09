'use strict';

/**
 * Smoke-тест Carnage Party: проверяет health, вход, bootstrap, каналы,
 * Socket.IO, отправку/удаление сообщения и раздачу SPA.
 *
 * Запуск:  node scripts/smoke-test.cjs [baseUrl]
 * Пример:  node scripts/smoke-test.cjs http://127.0.0.1:3001
 */

const { io } = require('../client/node_modules/socket.io-client');

const base = (process.argv[2] || process.env.CARNAGE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
let passed = 0;
let failed = 0;

function ok(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  [OK]   ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    failed += 1;
    console.error(`  [FAIL] ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function json(path, options = {}) {
  const response = await fetch(base + path, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { response, data };
}

function waitForEvent(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Нет события ${event} за ${timeout} мс`));
    }, timeout);
    const handler = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

(async () => {
  console.log(`\nCarnage Party — smoke-тест: ${base}\n`);

  // 1. Health
  const health = await json('/api/health');
  ok('GET /api/health', health.response.ok && health.data?.ok === true, JSON.stringify(health.data));

  // 2. Login
  const login = await json('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'demo', password: 'demo1234' }),
  });
  ok('POST /api/auth/login', login.response.ok && Boolean(login.data?.token), login.response.status);
  if (!login.response.ok) throw new Error('Без токена дальше нельзя');
  const token = login.data.token;
  const auth = { Authorization: `Bearer ${token}` };

  // 3. Bootstrap
  const boot = await json('/api/bootstrap', { headers: auth });
  const data = boot.data || {};
  ok('GET /api/bootstrap', boot.response.ok && data.user?.username === 'demo');
  ok('Серверы в bootstrap', Array.isArray(data.servers) && data.servers.length >= 2, `${data.servers?.length} шт.`);
  ok('Каналы в bootstrap', Array.isArray(data.channels) && data.channels.length > 0, `${data.channels?.length} шт.`);
  ok('Друзья в bootstrap', Boolean(data.friends && Array.isArray(data.friends.accepted)));
  ok('Демо-сервер CARNAGE', (data.servers || []).some((s) => s.id === 'srv_carnage'));

  // 4. Каналы и история
  const channel = (data.channels || []).find((c) => c.type === 'text') || data.channels?.[0];
  ok('Текстовый канал найден', Boolean(channel), channel?.name);
  if (channel) {
    const history = await json(`/api/channels/${channel.id}/messages?limit=10`, { headers: auth });
    ok('GET сообщений канала', history.response.ok && Array.isArray(history.data?.messages), `${history.data?.messages?.length} шт.`);
  }

  // 5. SPA fallback
  const spa = await fetch(base + '/some/deep/route');
  const spaText = await spa.text();
  ok('SPA fallback отдаёт index.html', spa.ok && spaText.includes('id="root"'));

  // 6. Socket.IO
  const socket = io(base, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 5000 });
  const connected = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 6000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(true);
    });
    socket.once('connect_error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  ok('Socket.IO подключение', connected);
  ok('Socket.IO presence:update', connected && Boolean(await waitForEvent(socket, 'presence:update').catch(() => null)));

  // 7. Отправка и удаление сообщения
  if (channel && connected) {
    const waitNew = waitForEvent(socket, 'message:new', 6000).catch(() => null);
    const sent = await json(`/api/channels/${channel.id}/messages`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'smoke-test: проверка сообщения' }),
    });
    ok('POST сообщения', sent.response.ok && Boolean(sent.data?.message?.id), sent.response.status);
    const pushed = await waitNew;
    ok('message:new по Socket.IO', pushed?.message?.id === sent.data?.message?.id);
    if (sent.data?.message?.id) {
      const removed = await json(`/api/messages/${sent.data.message.id}`, { method: 'DELETE', headers: auth });
      ok('DELETE тестового сообщения', removed.response.ok);
    }
  }

  // 8. Watch Party: создание комнаты, сокет, синхронизация, чат, закрытие
  if (channel) {
    const created = await json('/api/watch', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: channel.id,
        title: 'smoke-test: watch party',
        source: { type: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      }),
    });
    const room = created.data?.room;
    ok('POST /api/watch', created.response.ok && Boolean(room?.id), created.response.status);
    ok('Watch Party источник YouTube', room?.source?.videoId === 'dQw4w9WgXcQ');

    const listed = await json('/api/watch', { headers: auth });
    ok('GET /api/watch', listed.response.ok && (listed.data?.rooms || []).some((r) => r.id === room?.id));

    const bootWithWatch = await json('/api/bootstrap', { headers: auth });
    ok('Watch Party в bootstrap', (bootWithWatch.data?.watch || []).some((r) => r.id === room?.id));

    if (room?.id) {
      const watchSocket = io(`${base}/watch`, {
        auth: { token, roomId: room.id },
        transports: ['websocket'],
        reconnection: false,
        timeout: 5000,
      });
      const watchConnected = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 6000);
        watchSocket.once('connect', () => {
          clearTimeout(timer);
          resolve(true);
        });
        watchSocket.once('connect_error', () => {
          clearTimeout(timer);
          resolve(false);
        });
      });
      ok('Watch Party socket подключение', watchConnected);
      const state = await waitForEvent(watchSocket, 'watch:state').catch(() => null);
      ok('watch:state при входе', state?.room?.id === room.id && state?.self?.host === true);

      if (watchConnected) {
        const syncWait = waitForEvent(watchSocket, 'watch:sync', 5000).catch(() => null);
        watchSocket.emit('watch:command', { action: 'play', position: 12 });
        const sync = await syncWait;
        ok('watch:sync после команды хоста', sync?.state?.playing === true && sync?.state?.position === 12);

        const chatWait = waitForEvent(watchSocket, 'watch:chat', 5000).catch(() => null);
        watchSocket.emit('watch:chat', { text: 'smoke-test: привет из комнаты' });
        const chatMessage = await chatWait;
        ok('watch:chat сообщение', chatMessage?.text === 'smoke-test: привет из комнаты');
      }

      const removed = await json(`/api/watch/${room.id}`, { method: 'DELETE', headers: auth });
      ok('DELETE /api/watch', removed.response.ok);
      watchSocket.close();
    }
  }

  if (connected) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 500);
      socket.once('disconnect', () => {
        clearTimeout(timer);
        setTimeout(resolve, 100);
      });
      socket.close();
    });
  }

  console.log(`\nИтог: ${passed} OK, ${failed} FAIL\n`);
  process.exitCode = failed === 0 ? 0 : 1;
  setTimeout(() => process.exit(process.exitCode), 250);
})().catch((err) => {
  console.error('\nОшибка smoke-теста:', err.message);
  process.exit(1);
});
