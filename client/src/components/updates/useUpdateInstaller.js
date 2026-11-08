import { useCallback, useEffect, useRef, useState } from 'react';

const PENDING_KEY = 'carnage_pending_version';

// Общая логика скачивания и установки обновления для окна при запуске
// и раздела «Обновления» в настройках.
export function useUpdateInstaller() {
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState({ percent: 0, received: 0, total: 0 });
  const [message, setMessage] = useState('');
  const downloadedPath = useRef('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let removeDesktop = null;
    if (window.desktop?.onUpdateProgress) {
      removeDesktop = window.desktop.onUpdateProgress((payload = {}) => {
        if (!mounted.current) return;
        setProgress({
          percent: Number(payload.percent) || 0,
          received: Number(payload.received) || 0,
          total: Number(payload.total) || 0,
        });
      });
    }

    const onNative = (event) => {
      if (!mounted.current) return;
      const detail = event?.detail || {};
      const phaseName = String(detail.phase || '');
      if (phaseName === 'error') {
        setPhase('error');
        setMessage('Не удалось скачать APK. Проверьте соединение и повторите.');
        return;
      }
      setProgress({
        percent: Number(detail.percent) || 0,
        received: Number(detail.received) || 0,
        total: Number(detail.total) || 0,
      });
      if (phaseName === 'downloaded' || Number(detail.percent) >= 100) {
        setPhase('done');
        setMessage('Установщик открыт. Подтвердите установку на телефоне.');
      }
    };
    window.addEventListener('carnage:update-progress', onNative);

    return () => {
      if (typeof removeDesktop === 'function') removeDesktop();
      window.removeEventListener('carnage:update-progress', onNative);
    };
  }, []);

  const reset = useCallback(() => {
    downloadedPath.current = '';
    setPhase('idle');
    setProgress({ percent: 0, received: 0, total: 0 });
    setMessage('');
  }, []);

  const startDownload = useCallback(async (update) => {
    if (!update) return;
    setPhase('downloading');
    setMessage('');
    setProgress({ percent: 0, received: 0, total: Number(update.size) || 0 });
    const fileName = update.fileName || 'carnage-update';

    if (update.platform === 'android' && window.CarnageAndroid?.downloadUpdate) {
      try {
        localStorage.setItem(PENDING_KEY, update.version);
      } catch {}
      try {
        window.CarnageAndroid.downloadUpdate(update.url, fileName);
      } catch {
        setPhase('error');
        setMessage('Не удалось запустить загрузку APK.');
      }
      return;
    }

    if (window.desktop?.downloadUpdate) {
      try {
        const result = await window.desktop.downloadUpdate({ url: update.url, fileName });
        if (!mounted.current) return;
        if (!result?.ok) {
          setPhase('error');
          setMessage(result?.error || 'Не удалось скачать обновление.');
          return;
        }
        downloadedPath.current = result.path;
        setProgress((current) => ({
          ...current,
          percent: 100,
          received: result.size || current.received,
        }));
        setPhase('ready');
      } catch (err) {
        setPhase('error');
        setMessage(err.message || 'Не удалось скачать обновление.');
      }
      return;
    }

    window.open(update.url, '_blank', 'noopener');
    setPhase('done');
    setMessage('Загрузка открылась в браузере.');
  }, []);

  const install = useCallback(async (update) => {
    if (!update) return;
    if (update.platform === 'android') {
      setPhase('done');
      return;
    }
    if (!window.desktop?.installUpdate) {
      setPhase('error');
      setMessage('Установка доступна только в приложении Carnage Party.');
      return;
    }
    try {
      localStorage.setItem(PENDING_KEY, update.version);
    } catch {}
    setPhase('installing');
    const result = await window.desktop.installUpdate({
      mode: update.platform === 'portable' ? 'portable' : 'installed',
      path: downloadedPath.current,
    });
    if (!mounted.current) return;
    if (!result?.ok) {
      setPhase('error');
      setMessage(result?.error || 'Не удалось установить обновление.');
      return;
    }
    setPhase('done');
    setMessage(
      update.platform === 'portable'
        ? 'Файлы обновляются. Приложение перезапустится само.'
        : 'Приложение закроется, запустится установщик, затем откроется новая версия.'
    );
  }, []);

  return {
    phase,
    progress,
    message,
    setMessage,
    reset,
    startDownload,
    install,
    busy: phase === 'downloading' || phase === 'installing',
  };
}
