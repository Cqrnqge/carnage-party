import { useEffect } from 'react';
import { useApp } from '../../store';
import { voiceManager } from '../../voice';

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Режим рации: пока зажата назначенная клавиша, микрофон включён.
 * В активном окне работает локальный keydown/keyup, а в свёрнутом или
 * неактивном — глобальный слушатель клавиатуры из Electron main.
 */
export default function PushToTalk() {
  const enabled = useApp((state) => state.settings.pushToTalk);
  const pttKey = useApp((state) => state.settings.pttKey);
  const joined = useApp((state) => state.voice.joined);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop?.setPtt) return undefined;
    const activeKey = enabled && joined && pttKey ? pttKey : '';
    Promise.resolve(desktop.setPtt(activeKey)).catch(() => {});
    return () => {
      Promise.resolve(desktop.setPtt('')).catch(() => {});
    };
  }, [enabled, joined, pttKey]);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop?.onPtt) return undefined;
    return desktop.onPtt(({ state }) => {
      const current = useApp.getState();
      if (!current.settings.pushToTalk || !current.voice.joined) return;
      if (state === 'up') {
        voiceManager.pttEnd();
        return;
      }
      if (state !== 'down') return;
      // Глобальное событие приходит и при активном окне. Не включаем микрофон,
      // только если пользователь действительно печатает: фокус внутри
      // <webview>/iframe даёт activeElement не input, и рация должна работать.
      if (document.hasFocus() && isTypingTarget(document.activeElement)) return;
      voiceManager.pttStart();
    });
  }, []);

  useEffect(() => {
    if (!enabled || !joined || !pttKey) return undefined;

    const isModifierKey = /^(Control|Shift|Alt|Meta)/.test(pttKey);

    const onKeyDown = (event) => {
      if (event.code !== pttKey || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      // Не перехватываем сочетания вроде Ctrl+V, если рация назначена на V.
      if (!isModifierKey && (event.ctrlKey || event.metaKey || event.altKey)) return;
      event.preventDefault();
      voiceManager.pttStart();
    };

    const onKeyUp = (event) => {
      if (event.code !== pttKey) return;
      voiceManager.pttEnd();
    };

    const release = () => voiceManager.pttEnd();
    const onVisibility = () => {
      if (document.hidden) voiceManager.pttEnd();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onVisibility);
      voiceManager.pttEnd();
    };
  }, [enabled, joined, pttKey]);

  return null;
}
