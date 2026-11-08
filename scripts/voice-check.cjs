'use strict';

/**
 * Проверка голосовой части через Chrome DevTools Protocol.
 * Запускает сценарий в уже открытом Electron:
 *   npx electron . --remote-debugging-port=9333 --use-fake-device-for-media-stream --use-fake-ui-for-media-stream
 * Затем:
 *   node scripts/voice-check.cjs
 */

const SERVER = process.env.TEST_SERVER || 'http://127.0.0.1:3010';
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
let nextId = 1;
const pending = new Map();
let ws = null;
const consoleErrors = [];
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  const page = targets.find((t) => t.type === 'page') || targets[0];
  if (!page?.webSocketDebuggerUrl) throw new Error('Не найден page-target CDP');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('Ошибка WebSocket CDP')), { once: true });
  });
  ws.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description || 'Исключение');
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
}

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 20000);
  });
}

async function evaluate(expression, options = {}) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
    ...options,
  });
  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(description);
  }
  return result.result?.value;
}

async function waitFor(expression, timeout = 10000, interval = 250) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeout) {
    try {
      const value = await evaluate(expression);
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await delay(interval);
  }
  throw lastError || new Error(`Не дождались: ${expression}`);
}

(async () => {
  console.log(`\nCarnage Party — проверка камеры, микрофона и экрана\nСервер: ${SERVER}\n`);

  // Данные для входа и голосовой канал
  const login = await (await fetch(`${SERVER}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'demo', password: 'demo1234' }),
  })).json();
  if (!login.token) throw new Error('Не удалось войти в демо-аккаунт');
  const bootstrap = await (await fetch(`${SERVER}/api/bootstrap`, {
    headers: { Authorization: `Bearer ${login.token}` },
  })).json();
  const voiceChannel = (bootstrap.channels || []).find((c) => c.type === 'voice' && c.serverId === 'srv_carnage');
  ok('Демо-вход и голосовой канал', Boolean(voiceChannel), voiceChannel?.name);
  if (!voiceChannel) throw new Error('Голосовой канал не найден');

  await connect();
  const page = await evaluate('({ href: location.href, title: document.title })');
  ok('CDP подключён к приложению', /^https?:/.test(page.href), `${page.title} · ${page.href}`);

  // Проверка доступа к устройствам
  const devices = await evaluate(`navigator.mediaDevices.enumerateDevices().then(list => list.map(d => ({ kind: d.kind, label: d.label })))`);
  ok('Перечисление медиаустройств', Array.isArray(devices) && devices.length > 0, `${devices.length} устройств`);

  const media = await evaluate(`(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    const tracks = stream.getTracks().map(t => ({ kind: t.kind, state: t.readyState, label: t.label }));
    stream.getTracks().forEach(t => t.stop());
    return tracks;
  })()`);
  ok('getUserMedia: микрофон + камера', media.some((t) => t.kind === 'audio') && media.some((t) => t.kind === 'video'),
    media.map((t) => t.kind).join(' + '));

  const display = await evaluate(`(async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = stream.getVideoTracks()[0];
    const settings = track ? track.getSettings() : {};
    const info = { kind: track && track.kind, state: track && track.readyState, width: settings.width, height: settings.height };
    stream.getTracks().forEach(t => t.stop());
    return info;
  })()`);
  ok('getDisplayMedia: экран', display.kind === 'video' && display.state === 'live',
    `${display.width || '?'}x${display.height || '?'}`);

  // Входим в приложение и открываем голосовой канал
  await evaluate(`(() => {
    localStorage.setItem('carnage_token', ${JSON.stringify(login.token)});
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem('carnage_settings') || '{}'); } catch {}
    settings.pushToTalk = false;
    settings.inputDevice = 'default';
    settings.videoDevice = 'default';
    localStorage.setItem('carnage_settings', JSON.stringify(settings));
    location.reload();
    return true;
  })()`);
  await waitFor(`document.querySelector('.server-rail') !== null`, 15000);
  await evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="Carnage Party"]');
    if (btn) btn.click();
    return Boolean(btn);
  })()`);
  await waitFor(`[...document.querySelectorAll('.channel-name')].some(el => el.textContent.trim() === ${JSON.stringify(voiceChannel.name)})`, 8000);
  const joinedClick = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.channel-row')].find(r => r.querySelector('.channel-name')?.textContent.trim() === ${JSON.stringify(voiceChannel.name)});
    if (!row) return false;
    row.click();
    return true;
  })()`);
  ok('Клик по голосовому каналу', joinedClick);

  const joined = await waitFor(`document.querySelector('.voice-stage') && document.querySelector('.voice-stage-status')?.textContent.includes('Подключено')`, 15000).then(() => true).catch(() => false);
  ok('Подключение к голосовой комнате', joined);

  const controls = await evaluate(`[...document.querySelectorAll('.voice-control')].map(b => b.title)`);
  ok('Кнопки управления отображаются', controls.length >= 6, controls.join(' | '));

  // Камера
  const cameraClicked = await evaluate(`(() => { const b=[...document.querySelectorAll('.voice-control')].find(x=>x.title==='Включить камеру'); if(!b) return false; b.click(); return true; })()`);
  const cameraOn = await waitFor(`Boolean(document.querySelector('.voice-control[title="Выключить камеру"]') && document.querySelector('.voice-tile-video'))`, 12000).then(() => true).catch(() => false);
  ok('Камера включается и транслируется', cameraClicked && cameraOn);

  // Экран
  const screenClicked = await evaluate(`(() => { const b=[...document.querySelectorAll('.voice-control')].find(x=>x.title==='Показать экран'); if(!b) return false; b.click(); return true; })()`);
  const pickerShown = await waitFor(`Boolean(document.querySelector('.screen-picker .screen-source'))`, 10000).then(() => true).catch(() => false);
  const monitorCount = await evaluate(`document.querySelectorAll('.screen-picker .screen-source').length`).catch(() => 0);
  ok('Окно выбора монитора', pickerShown && monitorCount > 0, `${monitorCount} экран(ов)`);
  if (pickerShown) {
    const pickerShot = await send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync(require('path').join(__dirname, '..', 'voice-picker.png'), Buffer.from(pickerShot.data, 'base64'));
  }
  const sourcePicked = await evaluate(`(() => { const b=document.querySelector('.screen-picker .screen-source'); if(!b) return false; b.click(); return true; })()`).catch(() => false);
  const screenOn = await waitFor(`Boolean(document.querySelector('.voice-control[title="Остановить показ экрана"]') && document.querySelector('.voice-tile-screen'))`, 15000).then(() => true).catch(() => false);
  ok('Демонстрация экрана включается и транслируется', screenClicked && sourcePicked && screenOn);

  // Микрофон
  const muteClicked = await evaluate(`(() => { const b=[...document.querySelectorAll('.voice-control')].find(x=>x.title==='Выключить микрофон'); if(!b) return false; b.click(); return true; })()`);
  const muted = await waitFor(`Boolean(document.querySelector('.voice-control[title="Включить микрофон"]'))`, 5000).then(() => true).catch(() => false);
  ok('Микрофон выключается', muteClicked && muted);

  // Режим рации: включаем в настройках голоса
  const settingsOpened = await evaluate(`(() => { const b=[...document.querySelectorAll('.voice-control')].find(x=>x.title==='Настройки голоса'); if(!b) return false; b.click(); return true; })()`);
  const settingsVisible = await waitFor(`Boolean([...document.querySelectorAll('.toggle-row')].find(r=>r.textContent.includes('Режим рации')))`, 8000).then(() => true).catch(() => false);
  ok('Настройки: переключатель режима рации', settingsOpened && settingsVisible);

  const pttEnabled = await evaluate(`(() => {
    const row=[...document.querySelectorAll('.toggle-row')].find(r=>r.textContent.includes('Режим рации'));
    if(!row) return false;
    if(!row.querySelector('.toggle.on')) row.click();
    return true;
  })()`);
  const defaultKeyShown = await waitFor(`Boolean([...document.querySelectorAll('.ptt-key-btn')].find(b=>b.textContent.trim()==='V'))`, 5000).then(() => true).catch(() => false);
  ok('Настройки: клавиша рации по умолчанию', pttEnabled && defaultKeyShown);

  // Назначаем другую клавишу и возвращаем V
  const rebindClick = await evaluate(`(() => {
    const b=document.querySelector('.ptt-key-btn');
    if(!b) return false;
    b.click();
    return true;
  })()`);
  const listening = await waitFor(`Boolean([...document.querySelectorAll('.ptt-key-btn')].find(b=>b.textContent.includes('Нажмите клавишу')))`, 4000).then(() => true).catch(() => false);
  const rebind = await evaluate(`(() => { window.dispatchEvent(new KeyboardEvent('keydown',{key:'t',code:'KeyT',bubbles:true})); return true; })()`);
  const rebound = await waitFor(`Boolean([...document.querySelectorAll('.ptt-key-btn')].find(b=>b.textContent.trim()==='T'))`, 5000).then(() => true).catch(() => false);
  await evaluate(`document.querySelector('.ptt-key-btn')?.click(); true`);
  await waitFor(`Boolean([...document.querySelectorAll('.ptt-key-btn')].find(b=>b.textContent.includes('Нажмите клавишу')))`, 4000).catch(() => null);
  await evaluate(`(() => { window.dispatchEvent(new KeyboardEvent('keydown',{key:'v',code:'KeyV',bubbles:true})); return true; })()`);
  const reboundBack = await waitFor(`Boolean([...document.querySelectorAll('.ptt-key-btn')].find(b=>b.textContent.trim()==='V'))`, 5000).then(() => true).catch(() => false);
  ok('Настройки: переназначение клавиши рации', rebindClick && listening && rebind && rebound && reboundBack);
  const pttSettingsShot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync(require('path').join(__dirname, '..', 'voice-ptt-settings.png'), Buffer.from(pttSettingsShot.data, 'base64'));

  await evaluate(`(() => {
    const close=document.querySelector('.modal-close');
    if (close) { close.click(); return true; }
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
    return true;
  })()`);
  await waitFor(`Boolean(document.querySelector('.voice-control.ptt'))`, 5000).catch(() => null);

  const pttKeyDown = await evaluate(`(() => { window.dispatchEvent(new KeyboardEvent('keydown',{key:'v',code:'KeyV',bubbles:true})); return true; })()`);
  const pttActive = await waitFor(`Boolean(document.querySelector('.voice-control.ptt.active'))`, 5000).then(() => true).catch(() => false);
  ok('Рация: удержание клавиши включает микрофон', pttKeyDown && pttActive);
  const pttActiveShot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync(require('path').join(__dirname, '..', 'voice-ptt-active.png'), Buffer.from(pttActiveShot.data, 'base64'));

  await evaluate(`window.dispatchEvent(new KeyboardEvent('keyup',{key:'v',code:'KeyV',bubbles:true})); true`);
  const pttReleased = await waitFor(`Boolean(!document.querySelector('.voice-control.ptt.active') && document.querySelector('.voice-control[title="Включить микрофон"]'))`, 5000).then(() => true).catch(() => false);
  ok('Рация: отпускание клавиши выключает микрофон', pttReleased);

  // Скриншот состояния (через Page.captureScreenshot)
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const fs = require('fs');
  const path = require('path');
  const shotPath = path.join(__dirname, '..', 'voice-check.png');
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  console.log(`  [INFO] Скриншот: ${shotPath}`);

  // Выходим из комнаты
  await evaluate(`(() => { const b=[...document.querySelectorAll('.voice-control')].find(x=>x.title==='Покинуть комнату'); if(b) b.click(); return true; })()`).catch(() => {});
  await delay(500);

  ok('Нет ошибок в консоли', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '));

  console.log(`\nИтог: ${passed} OK, ${failed} FAIL\n`);
  ws.close();
  setTimeout(() => process.exit(failed === 0 ? 0 : 1), 300);
})().catch((err) => {
  console.error('\nОшибка проверки:', err.message);
  if (consoleErrors.length) console.error('Ошибки консоли:', consoleErrors.slice(0, 5));
  try { ws?.close(); } catch {}
  setTimeout(() => process.exit(1), 300);
});
