import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, Download, Loader2, Sparkles } from 'lucide-react';
import Modal from '../ui/Modal';
import { checkForUpdate, formatSize, platformLabel } from '../../updates';
import { useUpdateInstaller } from './useUpdateInstaller';

const CHECK_DELAY = 2000;

const HINTS = {
  android:
    'APK скачается внутри приложения, после чего откроется установка. Разрешите установку из Carnage Party.',
  portable:
    'ZIP скачается с прогрессом, затем новые файлы заменят текущие и приложение перезапустится.',
  windows:
    'Установщик скачается с прогрессом. После загрузки приложение закроется, запустится установка, затем новая версия.',
};

export default function UpdatePrompt() {
  const [update, setUpdate] = useState(null);
  const mounted = useRef(true);
  const {
    phase,
    progress,
    message,
    reset,
    startDownload,
    install,
    busy,
  } = useUpdateInstaller();

  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(async () => {
      const found = await checkForUpdate();
      if (mounted.current && found) setUpdate(found);
    }, CHECK_DELAY);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, []);

  if (!update) return null;

  const close = () => {
    if (busy) return;
    setUpdate(null);
    reset();
  };

  const size = formatSize(update.size);
  const notes = Array.isArray(update.notes) ? update.notes : [];
  const receivedText = formatSize(progress.received);
  const totalText = formatSize(progress.total || update.size);

  return (
    <Modal
      onClose={close}
      className="update-modal"
      overlayClassName="update-overlay"
      showClose={!busy}
      closeOnOverlay={!busy}
      closeOnEscape={!busy}
    >
      <div className="update-hero">
        <div className="update-icon">
          <Sparkles size={30} />
        </div>
        <div>
          <span className="update-kicker">Carnage Party</span>
          <h2>Доступно обновление</h2>
        </div>
      </div>

      <div className="update-versions">
        <span className="update-version old">v{update.current}</span>
        <ArrowRight size={17} />
        <span className="update-version new">v{update.version}</span>
      </div>

      <div className="update-meta">
        <span>{platformLabel(update.platform)}</span>
        {size ? <span>{size}</span> : null}
      </div>

      <div className="update-changelog">
        <h3>Что нового в v{update.version}</h3>
        {notes.length ? (
          <ul>
            {notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        ) : update.notesText ? (
          <p>{update.notesText}</p>
        ) : (
          <p>Улучшения и исправления.</p>
        )}
      </div>

      {busy || phase === 'ready' || phase === 'error' || phase === 'done' ? (
        <div className={phase === 'error' ? 'update-progress error' : 'update-progress'}>
          <div className="update-progress-bar">
            <span style={{ width: `${phase === 'error' ? 100 : progress.percent}%` }} />
          </div>
          <div className="update-progress-meta">
            <span>
              {phase === 'downloading' ? (
                <>
                  <Loader2 size={13} className="spin" /> Скачивание… {progress.percent}%
                </>
              ) : phase === 'ready' ? (
                'Загрузка завершена'
              ) : phase === 'installing' ? (
                <>
                  <Loader2 size={13} className="spin" /> Устанавливаем…
                </>
              ) : phase === 'error' ? (
                'Ошибка'
              ) : (
                'Готово'
              )}
            </span>
            {phase === 'downloading' && totalText ? (
              <span>
                {receivedText} из {totalText}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {message ? <p className="update-hint">{message}</p> : null}
      {!message && phase === 'idle' ? <p className="update-hint">{HINTS[update.platform]}</p> : null}

      {phase === 'ready' ? (
        <p className="update-hint">
          {update.platform === 'portable'
            ? 'Файлы будут заменены, приложение перезапустится автоматически.'
            : 'Установщик запустится после закрытия приложения.'}
        </p>
      ) : null}

      <div className="update-actions">
        {phase === 'ready' || phase === 'done' ? null : (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={close}
            disabled={busy}
          >
            {phase === 'error' ? 'Закрыть' : 'Позже'}
          </button>
        )}

        {phase === 'idle' ? (
          <button type="button" className="btn btn-primary" onClick={() => startDownload(update)}>
            <Download size={16} />
            Скачать обновление
          </button>
        ) : null}

        {phase === 'error' ? (
          <button type="button" className="btn btn-primary" onClick={() => startDownload(update)}>
            <Download size={16} />
            Повторить
          </button>
        ) : null}

        {phase === 'ready' ? (
          <button type="button" className="btn btn-primary" onClick={() => install(update)}>
            <CheckCircle2 size={16} />
            {update.platform === 'portable' ? 'Обновить и перезапустить' : 'Установить и перезапустить'}
          </button>
        ) : null}

        {phase === 'done' ? (
          <button type="button" className="btn btn-primary" onClick={close}>
            Закрыть
          </button>
        ) : null}
      </div>
    </Modal>
  );
}
