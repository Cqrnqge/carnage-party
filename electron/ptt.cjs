'use strict';

// Глобальный режим рации без клавиатурного хука и без сторонних exe.
//
// Discord использует низкоуровневый хук в подписанном приложении. Нам такой
// путь не подходит: Defender удаляет WinKeyServer.exe из node-global-key-listener
// как троян-кейлоггер. Поэтому приложение глобально проверяет состояние только
// одной назначенной клавиши через user32!GetAsyncKeyState. Это не перехватывает
// и не логирует другие клавиши и работает, когда окно свёрнуто или неактивно.

const VK_BY_CODE = {
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  NumpadEnter: 0x0d,
  ShiftLeft: 0xa0,
  ShiftRight: 0xa1,
  ControlLeft: 0xa2,
  ControlRight: 0xa3,
  AltLeft: 0xa4,
  AltRight: 0xa5,
  Pause: 0x13,
  CapsLock: 0x14,
  Escape: 0x1b,
  Space: 0x20,
  PageUp: 0x21,
  PageDown: 0x22,
  End: 0x23,
  Home: 0x24,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  Insert: 0x2d,
  Delete: 0x2e,
  MetaLeft: 0x5b,
  MetaRight: 0x5c,
  NumpadMultiply: 0x6a,
  NumpadAdd: 0x6b,
  NumpadSubtract: 0x6d,
  NumpadDecimal: 0x6e,
  NumpadDivide: 0x6f,
  NumLock: 0x90,
  ScrollLock: 0x91,
  Semicolon: 0xba,
  Equal: 0xbb,
  Comma: 0xbc,
  Minus: 0xbd,
  Period: 0xbe,
  Slash: 0xbf,
  Backquote: 0xc0,
  BracketLeft: 0xdb,
  Backslash: 0xdc,
  BracketRight: 0xdd,
  Quote: 0xde,
  IntlBackslash: 0xe2,
};

const VK_CONTROL = 0x11;
const VK_ALT = 0x12;
const VK_LWIN = 0x5b;
const VK_RWIN = 0x5c;

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

function vkForCode(code) {
  const value = String(code || '');
  if (!value) return 0;
  if (/^Key[A-Z]$/.test(value)) return 0x41 + value.charCodeAt(3) - 65;
  if (/^Digit[0-9]$/.test(value)) return 0x30 + Number(value.slice(5));
  if (/^Numpad[0-9]$/.test(value)) return 0x60 + Number(value.slice(6));
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(value)) {
    return 0x70 + Number(value.slice(1)) - 1;
  }
  return VK_BY_CODE[value] || 0;
}

function setupPtt({ app, ipcMain, getWindow }) {
  let pollTimer = null;
  let getAsyncKeyState = null;
  let activeVk = 0;
  let activeIsModifier = false;
  let held = false;
  let sentDown = false;

  const send = (state) => {
    const win = getWindow?.();
    if (!win || win.isDestroyed()) return;
    if (state === 'down') {
      // Отправляем всегда, даже когда окно в фокусе: keydown из <webview>,
      // iframe и кинотеатра не доходит до window, поэтому интерфейс не может
      // определить нажатие самостоятельно. Повторный pttStart() безвреден —
      // voiceManager игнорирует его, пока микрофон уже включён.
      sentDown = true;
    } else {
      // keyup отправляем всегда, чтобы микрофон не «залипал».
      if (!sentDown) return;
      sentDown = false;
    }
    win.webContents.send('carnage:ptt', { state });
  };

  const ensureApi = () => {
    if (process.platform !== 'win32') return false;
    if (getAsyncKeyState) return true;
    try {
      const koffi = require('koffi');
      const user32 = koffi.load('user32.dll');
      getAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)');
      return true;
    } catch (err) {
      console.warn('[electron] Глобальный режим рации недоступен:', err?.message || err);
      return false;
    }
  };

  const isPressed = (vk) => Boolean(getAsyncKeyState && (getAsyncKeyState(vk) & 0x8000));

  const tick = () => {
    if (!activeVk || !getAsyncKeyState) return;
    const pressed = isPressed(activeVk);
    if (pressed === held) return;
    held = pressed;

    if (!pressed) {
      send('up');
      return;
    }

    // Не срабатываем на Ctrl+V, Alt+V, Win+V, если рация назначена на V.
    if (!activeIsModifier) {
      if (isPressed(VK_CONTROL) || isPressed(VK_ALT) || isPressed(VK_LWIN) || isPressed(VK_RWIN)) {
        return;
      }
    }

    send('down');
  };

  const start = () => {
    if (!ensureApi()) return false;
    if (!pollTimer) pollTimer = setInterval(tick, 30);
    return true;
  };

  const stop = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    held = false;
    send('up');
    activeVk = 0;
    activeIsModifier = false;
  };

  ipcMain.handle('carnage:ptt-set', (_event, payload = {}) => {
    const code = String(payload.key || '');
    const vk = vkForCode(code);
    if (!vk) {
      stop();
      return { ok: false, global: false };
    }
    if (vk !== activeVk) {
      send('up');
      held = false;
    }
    activeVk = vk;
    activeIsModifier = MODIFIER_CODES.has(code);
    const ready = start();
    return { ok: ready, global: ready, key: code };
  });

  app.on('before-quit', () => {
    stop();
  });

  return { stop };
}

module.exports = { setupPtt, vkForCode };
