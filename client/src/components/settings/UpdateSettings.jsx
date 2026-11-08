import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Download,
  Info,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { appVersion } from '../../version';
import {
  fetchUpdateInfo,
  formatSize,
  platformLabel,
} from '../../updates';
import localChangelog from '../../changelog.json';
import { useUpdateInstaller } from '../updates/useUpdateInstaller';

const HINTS = {
  android:
    'APK скачается внутри приложения, после чего откроется системный установщик.',
  portable:
    'ZIP скачается с прогрессом, затем заменит файлы и приложение перезапустится.',
  windows:
    'Установщик скачается с прогрессом, затем приложение закроется и переустановится.',
};

export default function UpdateSettings() {
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState(null);
  const {
    phase,
    progress,
    message,
    reset,
    startDownload,
    install,
    busy,
  } = useUpdateInstaller();

  const runCheck = async () => {
    setChecking(true);
    reset();
    const result = await fetchUpdateInfo();
    setInfo(result);
    setChecking(false);
  };

  useEffect(() => {
    const timer = setTimeout(runCheck, 500);
    return () => clearTimeout(timer);
    // Проверка выполняется один раз при открытии раздела.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = info?.current || appVersion();
  const update = info?.ok ? info.update : null;
  const currentNotes =
    (info?.changelog && info.changelog[current]) ||
    localChangelog[current] ||
    [];
  const platform = platformLabel(info?.platform) || 'Приложение';
  const size = formatSize(update?.size);
  const receivedText = formatSize(progress.received);
  const totalText = formatSize(progress.total || update?.size || 0);

  return (
    <div className="update-settings">
      <div className="update-settings-card">
        <div className="update-settings-version">
          <div className="update-settings-icon">
            <RefreshCw size={22} />
          </div>
          <div>
            <span>Установленная версия</span>
            <strong>v{current}</strong>
          </div>
          <span className="update-settings-platform">{platform}</span>
        </div>

        {!update ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={runCheck}
            disabled={checking || busy}
          >
            {checking ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            {checking ? 'Проверяем…' : 'Проверить обновления'}
          </button>
        ) : null}

        {checking ? (
          <p className="update-settings-status">Запрашиваем версию у сервера…</p>
        ) : info && !info.ok ? (
          <p className="update-settings-status error">{info.error}</p>
        ) : info?.ok && !update ? (
          <p className="update-settings-status ok">
            <CheckCircle2 size={15} /> Установлена последняя версия
          </p>
        ) : null}

        {update ? (
          <div className="update-settings-found">
            <div className="update-versions">
              <span className="update-version old">v{current}</span>
              <ArrowRight size={17} />
              <span className="update-version new">v{update.version}</span>
            </div>
            <div className="update-meta">
              <span>{platformLabel(update.platform)}</span>
              {size ? <span>{size}</span> : null}
            </div>

            <div className="update-changelog update-settings-changelog">
              <h3>Что нового в v{update.version}</h3>
              {update.notes?.length ? (
                <ul>
                  {update.notes.map((note, index) => (
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
            {!message && phase === 'idle' ? (
              <p className="update-hint">{HINTS[update.platform]}</p>
            ) : null}

            <div className="update-settings-actions">
              {phase === 'idle' || phase === 'error' ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => startDownload(update)}
                  >
                    <Download size={16} />
                    {phase === 'error' ? 'Повторить' : 'Обновить'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={runCheck}
                    disabled={busy}
                  >
                    <RefreshCw size={16} />
                    Проверить снова
                  </button>
                </>
              ) : null}

              {phase === 'ready' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => install(update)}
                >
                  <CheckCircle2 size={16} />
                  {update.platform === 'portable'
                    ? 'Обновить и перезапустить'
                    : 'Установить и перезапустить'}
                </button>
              ) : null}

              {phase === 'done' ? (
                <button type="button" className="btn btn-secondary" onClick={runCheck}>
                  <RefreshCw size={16} />
                  Проверить снова
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="update-settings-card">
        <div className="update-settings-changelog-head">
          <Sparkles size={17} />
          <h3>Что нового в v{current}</h3>
        </div>
        {currentNotes.length ? (
          <ul className="update-settings-list">
            {currentNotes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        ) : (
          <p className="update-settings-status">Список изменений для этой версии недоступен.</p>
        )}
      </div>

      <div className="settings-note">
        <Info size={16} />
        <span>
          Обновления для Windows, portable и Android скачиваются с сервера Carnage Party.
          Если сервер выключен, проверка не выполняется.
        </span>
      </div>
    </div>
  );
}
