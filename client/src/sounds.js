import { useApp } from './store';

// Небольшой синтезатор интерфейсных звуков: без внешних файлов,
// поэтому звуки одинаково работают в desktop, браузере и APK.
let audioContext = null;

function getContext() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioContext) {
    try {
      audioContext = new Ctx();
    } catch {
      return null;
    }
  }
  return audioContext;
}

function tone(ctx, frequency, start, duration, options = {}) {
  const {
    type = 'sine',
    volume = 0.045,
    endFrequency = null,
    attack = 0.012,
  } = options;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), start + duration);
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

const SOUNDS = {
  // Микрофон.
  mute: (t) => {
    tone(audioContext, 520, t, 0.09, { type: 'triangle', volume: 0.04, endFrequency: 360 });
    tone(audioContext, 330, t + 0.075, 0.1, { type: 'sine', volume: 0.03 });
  },
  unmute: (t) => {
    tone(audioContext, 380, t, 0.09, { type: 'triangle', volume: 0.04, endFrequency: 540 });
    tone(audioContext, 620, t + 0.075, 0.11, { type: 'sine', volume: 0.035 });
  },
  // Звук собеседников (наушники).
  deafen: (t) => {
    tone(audioContext, 440, t, 0.1, { type: 'triangle', volume: 0.035, endFrequency: 280 });
    tone(audioContext, 240, t + 0.08, 0.12, { type: 'sine', volume: 0.028 });
  },
  undeafen: (t) => {
    tone(audioContext, 300, t, 0.1, { type: 'triangle', volume: 0.035, endFrequency: 460 });
    tone(audioContext, 540, t + 0.08, 0.12, { type: 'sine', volume: 0.03 });
  },
  // Демонстрация экрана и камера.
  screenStart: (t) => {
    tone(audioContext, 523.25, t, 0.11, { type: 'triangle', volume: 0.04 });
    tone(audioContext, 659.25, t + 0.085, 0.11, { type: 'triangle', volume: 0.04 });
    tone(audioContext, 783.99, t + 0.17, 0.18, { type: 'sine', volume: 0.045 });
  },
  screenStop: (t) => {
    tone(audioContext, 783.99, t, 0.11, { type: 'triangle', volume: 0.04 });
    tone(audioContext, 659.25, t + 0.085, 0.11, { type: 'triangle', volume: 0.04 });
    tone(audioContext, 523.25, t + 0.17, 0.18, { type: 'sine', volume: 0.04 });
  },
  cameraStart: (t) => {
    tone(audioContext, 587.33, t, 0.1, { type: 'sine', volume: 0.035 });
    tone(audioContext, 880, t + 0.08, 0.14, { type: 'sine', volume: 0.035 });
  },
  cameraStop: (t) => {
    tone(audioContext, 880, t, 0.1, { type: 'sine', volume: 0.035 });
    tone(audioContext, 587.33, t + 0.08, 0.14, { type: 'sine', volume: 0.03 });
  },
  // Голосовой канал.
  join: (t) => {
    tone(audioContext, 523.25, t, 0.12, { type: 'triangle', volume: 0.042 });
    tone(audioContext, 659.25, t + 0.1, 0.12, { type: 'triangle', volume: 0.042 });
    tone(audioContext, 783.99, t + 0.2, 0.22, { type: 'sine', volume: 0.05 });
  },
  leave: (t) => {
    tone(audioContext, 783.99, t, 0.12, { type: 'triangle', volume: 0.04 });
    tone(audioContext, 587.33, t + 0.1, 0.12, { type: 'triangle', volume: 0.038 });
    tone(audioContext, 392, t + 0.2, 0.22, { type: 'sine', volume: 0.04 });
  },
  // Кто-то начал или закончил трансляцию.
  streamStart: (t) => {
    tone(audioContext, 659.25, t, 0.1, { type: 'sine', volume: 0.03 });
    tone(audioContext, 987.77, t + 0.09, 0.16, { type: 'sine', volume: 0.032 });
  },
  streamStop: (t) => {
    tone(audioContext, 987.77, t, 0.1, { type: 'sine', volume: 0.03 });
    tone(audioContext, 659.25, t + 0.09, 0.16, { type: 'sine', volume: 0.028 });
  },
};

export function playSound(name) {
  try {
    if (!useApp.getState().settings.sounds) return;
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const sound = SOUNDS[name];
    if (sound) sound(ctx.currentTime + 0.01);
  } catch {
    // Звук — не повод ломать голосовой чат.
  }
}
