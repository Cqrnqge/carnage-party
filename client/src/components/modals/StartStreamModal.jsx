import React, { useEffect, useRef, useState } from 'react';
import {
  AppWindow,
  Camera,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Hash,
  KeyRound,
  Link2,
  Loader2,
  Monitor,
  MonitorPlay,
  Radio,
  RadioTower,
  ShieldCheck,
  Signal,
  Video,
} from 'lucide-react';
import { useApp } from '../../store';
import { streamBroadcaster } from '../../streaming';
import { copyText, sourceLabel } from '../../stream-utils';
import { RTMP_PLATFORMS, rtmpManager } from '../../rtmp';
import { cx } from '../../utils';
import Modal, { ModalHeader } from '../ui/Modal';

function openPublicLink(url) {
  if (!url) return;
  try {
    if (window.desktop?.openExternal) {
      window.desktop.openExternal(url);
      return;
    }
    if (window.CarnageAndroid?.openExternal) {
      window.CarnageAndroid.openExternal(url);
      return;
    }
  } catch {}
  window.open(url, '_blank', 'noopener');
}

export default function StartStreamModal({ channelId = null, channelName = '' } = {}) {
  const user = useApp((state) => state.user);
  const myStream = useApp((state) => state.myStream);
  const closeModal = useApp((state) => state.closeModal);
  const setActive = useApp((state) => state.setActive);
  const toast = useApp((state) => state.toast);

  const [step, setStep] = useState(() => (myStream ? 'ready' : 'setup'));
  const [mode, setMode] = useState('app');
  const [wants, setWants] = useState({ camera: true, screen: false });
  const [title, setTitle] = useState(() => `${user?.displayName || 'Моя'} — в эфире`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(myStream || null);
  const [copied, setCopied] = useState(false);
  const [screens, setScreens] = useState([]);
  const [screenId, setScreenId] = useState('');
  const [screenError, setScreenError] = useState('');
  const [sourceTab, setSourceTab] = useState('screen');
  const [rtmp, setRtmp] = useState(() => rtmpManager.snapshot());
  const [rtmpError, setRtmpError] = useState('');
  const [showKeys, setShowKeys] = useState({});
  const [systemAudio, setSystemAudio] = useState(() => {
    try {
      return localStorage.getItem('carnage_stream_system_audio') !== '0';
    } catch {
      return true;
    }
  });
  const previewRef = useRef(null);

  const canScreen = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
  const desktopScreens = typeof window !== 'undefined' && Boolean(window.desktop?.listScreenSources);
  const rtmpSupported = typeof window !== 'undefined' && Boolean(window.desktop?.rtmp?.start);
  const wantsBoth = wants.camera && wants.screen;
  const selectedSource = wantsBoth ? 'both' : wants.screen ? 'screen' : 'camera';
  const monitorSources = screens.filter((source) => source.type !== 'window');
  const windowSources = screens.filter((source) => source.type === 'window');
  const activeSources = sourceTab === 'window' ? windowSources : monitorSources;

  const selectSourceTab = (nextTab) => {
    setSourceTab(nextTab);
    const list = nextTab === 'window' ? windowSources : monitorSources;
    if (list.length && !list.some((source) => source.id === screenId)) {
      setScreenId(list[0].id);
    }
  };

  // В Electron список мониторов доступен заранее — даём выбрать его
  // прямо в окне запуска, без системного диалога.
  useEffect(() => {
    if (!desktopScreens || !wants.screen) return undefined;
    let cancelled = false;
    window.desktop
      .listScreenSources()
      .then((list) => {
        if (cancelled) return;
        const items = Array.isArray(list) ? list.filter((item) => item?.id) : [];
        const monitors = items.filter((item) => item.type !== 'window');
        const windows = items.filter((item) => item.type === 'window');
        setScreens(items);
        setScreenError('');
        setSourceTab(monitors.length || !windows.length ? 'screen' : 'window');
        setScreenId((prev) => {
          if (items.some((item) => item.id === prev)) return prev;
          return monitors[0]?.id || windows[0]?.id || '';
        });
      })
      .catch((err) => {
        if (!cancelled) setScreenError(err?.message || String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [desktopScreens, wants.screen]);

  useEffect(() => {
    if (!rtmpSupported) return undefined;
    const unsubscribe = rtmpManager.subscribe(setRtmp);
    rtmpManager.load().catch(() => {});
    return unsubscribe;
  }, [rtmpSupported]);

  const toggleSource = (key) => {
    if (busy) return;
    if (key === 'screen' && !canScreen) return;
    setWants((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // Хотя бы один источник должен остаться выбранным.
      if (!next.camera && !next.screen) return prev;
      return next;
    });
  };

  const toggleSystemAudio = () => {
    if (busy) return;
    setSystemAudio((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('carnage_stream_system_audio', next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  const updateRtmpTarget = (platform, patch) => {
    const next = rtmp.targets.map((item) =>
      item.platform === platform ? { ...item, ...patch } : item
    );
    rtmpManager.setTargets(next);
    setRtmp(rtmpManager.snapshot());
  };

  const toggleRtmpTarget = (platform) => {
    if (busy) return;
    const target = rtmp.targets.find((item) => item.platform === platform);
    if (!target) return;
    updateRtmpTarget(platform, { enabled: !target.enabled });
  };

  const enabledRtmpTargets = rtmp.targets.filter(
    (item) =>
      item.enabled &&
      item.server.trim() &&
      (item.platform === 'custom' || item.key.trim())
  );

  const startRtmp = async () => {
    if (!enabledRtmpTargets.length) return;
    setRtmpError('');
    try {
      await rtmpManager.start(streamBroadcaster.localStream, rtmp.targets);
    } catch (err) {
      const message = err?.message || 'Не удалось запустить мультистрим';
      setRtmpError(message);
      toast(message, 'error');
    }
  };

  useEffect(() => {
    if (step !== 'ready') return;
    const video = previewRef.current;
    const local = streamBroadcaster.localStream;
    if (!video || !local) return;
    video.srcObject = local;
    video.muted = true;
    video.play().catch(() => {});
    return () => {
      try {
        video.pause();
        video.srcObject = null;
      } catch {}
    };
  }, [step]);

  useEffect(() => {
    if (!myStream && step === 'ready' && result?.id) {
      // Эфир остановили из другого места — возвращаемся к настройкам.
      setStep('setup');
      setResult(null);
    }
  }, [myStream, step, result?.id]);

  const start = async () => {
    if (busy) return;
    const value = title.trim() || 'Трансляция';
    setBusy(true);
    setError('');
    try {
      const stream = await streamBroadcaster.start({
        title: value,
        mode,
        source: selectedSource,
        screenSourceId: wants.screen ? screenId || screens[0]?.id || '' : '',
        // Звук системы нужен только вместе с экраном. Его отключение
        // гарантирует, что эфир не «подхватит» сам себя с этого же ПК.
        systemAudio: wants.screen ? systemAudio : false,
        channelId: channelId || null,
      });
      setResult(stream);
      setStep('ready');
      toast(mode === 'link' ? 'Эфир запущен — ссылка готова' : 'Вы в эфире!', 'success');
      if (enabledRtmpTargets.length) {
        setRtmpError('');
        rtmpManager
          .start(streamBroadcaster.localStream, rtmp.targets)
          .catch((err) => {
            const message = err?.message || 'Не удалось запустить мультистрим';
            setRtmpError(message);
            toast(message, 'error');
          });
      }
    } catch (err) {
      setError(err?.message || 'Не удалось начать трансляцию');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    closeModal();
  };

  const goToStream = () => {
    closeModal();
    if (result?.id) setActive({ type: 'stream', id: result.id });
  };

  const copyLink = async () => {
    const url = result?.url;
    if (!url) return;
    const ok = await copyText(url);
    if (!ok) {
      toast('Не удалось скопировать ссылку', 'error');
      return;
    }
    setCopied(true);
    toast('Ссылка скопирована', 'success');
    setTimeout(() => setCopied(false), 2200);
  };

  const rtmpFailed =
    rtmp.status.phase === 'error' ||
    (rtmp.status.phase === 'idle' && Boolean(rtmpError));

  return (
    <Modal onClose={close} className="start-stream-modal" showClose={!busy} closeOnEscape={!busy}>
      <ModalHeader
        title={step === 'ready' ? 'Вы в эфире' : 'Начать трансляцию'}
        subtitle={
          step === 'ready'
            ? 'Эфир уже идёт. Можно перейти в студию или свернуть это окно.'
            : channelId
              ? `Эфир появится в канале${channelName ? ` #${channelName}` : ''} и в разделе Streaming.`
              : 'Покажите камеру, экран или всё сразу — зрители увидят эфир в разделе Streaming.'
        }
      />

      {step === 'ready' && result ? (
        <div className="stream-ready">
          <div className="stream-ready-preview-wrap">
            <video ref={previewRef} className="stream-ready-preview" autoPlay playsInline muted />
            <span className="stream-live-chip">LIVE</span>
            <span className="stream-ready-preview-label">
              <Radio size={13} /> Предпросмотр
            </span>
          </div>

          <div className="stream-ready-title">
            <span className="stream-ready-dot" />
            <div>
              <strong>{result.title}</strong>
              <span>
                {sourceLabel(result.source || selectedSource)}
                {' · '}
                {result.mode === 'link' ? 'Публичная ссылка' : 'В программе'}
              </span>
            </div>
          </div>

          {result.channelId || channelId ? (
            <div className="stream-ready-note stream-ready-channel">
              <Hash size={17} />
              <span>
                Эфир закреплён в канале
                {channelName ? ` #${channelName}` : ''} — участники увидят его прямо в канале.
              </span>
            </div>
          ) : null}

          {result.mode === 'link' ? (
            <div className="stream-ready-link">
              <div className="stream-ready-link-head">
                <Link2 size={16} />
                <span>Ссылка для зрителей</span>
              </div>
              <div className="stream-link-row">
                <input readOnly value={result.url || ''} onFocus={(event) => event.target.select()} />
                <button type="button" className="btn btn-primary btn-small" onClick={copyLink}>
                  <Copy size={14} /> {copied ? 'Готово' : 'Копировать'}
                </button>
              </div>
              <button
                type="button"
                className="stream-open-browser"
                onClick={() => openPublicLink(result.url)}
              >
                <ExternalLink size={14} /> Открыть страницу в браузере
              </button>
            </div>
          ) : (
            <div className="stream-ready-note">
              <MonitorPlay size={17} />
              <span>Зрители найдут эфир в разделе Streaming и смогут смотреть его прямо в Carnage Party.</span>
            </div>
          )}

          {rtmpSupported && (rtmpFailed || rtmp.status.phase !== 'idle') ? (
            <div className={cx('stream-rtmp-status', rtmpFailed && 'error')}>
              <span className="stream-rtmp-status-icon">
                {rtmpFailed ? (
                  <RadioTower size={17} />
                ) : (
                  <Signal size={17} className={rtmp.status.phase === 'live' ? 'live' : 'spin'} />
                )}
              </span>
              <div className="stream-rtmp-status-text">
                <strong>
                  {rtmpFailed
                    ? 'Мультистрим остановлен'
                    : rtmp.status.phase === 'live'
                      ? 'Мультистрим идёт'
                      : 'Запускаем мультистрим…'}
                </strong>
                <span>
                  {rtmp.status.destinations?.length
                    ? rtmp.status.destinations.map((item) => item.label).join(' · ')
                    : enabledRtmpTargets.map((item) => item.label).join(' · ')}
                </span>
                {rtmpFailed && (rtmpError || rtmp.status.error) ? (
                  <em>{(rtmpError || rtmp.status.error).split('\n')[0]}</em>
                ) : null}
              </div>
              {rtmp.status.phase === 'live' && !rtmpFailed ? (
                <span className="stream-rtmp-live-chip">LIVE</span>
              ) : null}
              {rtmpFailed ? (
                <button type="button" className="btn btn-ghost btn-small" onClick={startRtmp}>
                  Повторить
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={close}>
              Свернуть
            </button>
            <button type="button" className="btn btn-primary" onClick={goToStream}>
              <Video size={16} /> Перейти к трансляции
            </button>
          </div>
        </div>
      ) : (
        <div className="stream-setup">
          <div className="stream-step-head">
            <span className="stream-step-num">1</span>
            <span className="stream-step-label">Как смотреть зрителям?</span>
          </div>
          <div className="stream-choice-grid">
            <button
              type="button"
              className={cx('stream-choice', mode === 'app' && 'active')}
              onClick={() => setMode('app')}
              disabled={busy}
              aria-pressed={mode === 'app'}
            >
              <span className="stream-choice-icon"><MonitorPlay size={22} /></span>
              <span className="stream-choice-text">
                <strong>В программе</strong>
                <span>Зрители смотрят эфир внутри Carnage Party.</span>
              </span>
              {mode === 'app' ? <span className="stream-choice-check"><Check size={14} /></span> : null}
            </button>
            <button
              type="button"
              className={cx('stream-choice', mode === 'link' && 'active')}
              onClick={() => setMode('link')}
              disabled={busy}
              aria-pressed={mode === 'link'}
            >
              <span className="stream-choice-icon link"><Link2 size={22} /></span>
              <span className="stream-choice-text">
                <strong>Внешняя ссылка</strong>
                <span>Получите ссылку — она откроется в любом браузере.</span>
              </span>
              {mode === 'link' ? <span className="stream-choice-check"><Check size={14} /></span> : null}
            </button>
          </div>

          <div className="stream-step-head">
            <span className="stream-step-num">2</span>
            <span className="stream-step-label">Что показываем?</span>
            <span className="stream-step-optional">можно выбрать оба</span>
          </div>
          <div className="stream-source-grid">
            <button
              type="button"
              className={cx('stream-source', wants.camera && 'active')}
              onClick={() => toggleSource('camera')}
              disabled={busy}
              aria-pressed={wants.camera}
            >
              <span className="stream-source-icon"><Camera size={20} /></span>
              <span className="stream-source-text">
                <strong>Камера</strong>
                <em>Вы и ваш микрофон</em>
              </span>
              <span className={cx('stream-source-check', wants.camera && 'on')}>
                {wants.camera ? <Check size={13} /> : null}
              </span>
            </button>
            <button
              type="button"
              className={cx('stream-source', 'screen', wants.screen && 'active')}
              onClick={() => toggleSource('screen')}
              disabled={busy || !canScreen}
              aria-pressed={wants.screen}
              title={canScreen ? 'Показать экран' : 'На этом устройстве демонстрация экрана недоступна'}
            >
              <span className="stream-source-icon screen"><Monitor size={20} /></span>
              <span className="stream-source-text">
                <strong>Экран</strong>
                <em>{canScreen ? 'Игра, окно или весь монитор' : 'Недоступно на этом устройстве'}</em>
              </span>
              <span className={cx('stream-source-check', wants.screen && 'on')}>
                {wants.screen ? <Check size={13} /> : null}
              </span>
            </button>
          </div>

          {wantsBoth ? (
            <div className="stream-source-hint">
              <MonitorPlay size={15} />
              <span>Камера будет закреплена поверх экрана — двигайте её и меняйте размер в студии.</span>
            </div>
          ) : null}

          {wants.screen ? (
            desktopScreens ? (
              <div className="stream-monitor-block">
                <div className="stream-step-head stream-step-sub">
                  <span className="stream-step-num">3</span>
                  <span className="stream-step-label">Монитор или приложение</span>
                  <span className="stream-step-optional">что показываем</span>
                </div>
                {screens.length ? (
                  <>
                    <div className="stream-source-tabs" role="tablist" aria-label="Тип источника">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={sourceTab === 'screen'}
                        className={cx('stream-source-tab', sourceTab === 'screen' && 'active')}
                        onClick={() => selectSourceTab('screen')}
                        disabled={busy}
                      >
                        <Monitor size={14} />
                        Экраны
                        <span>{monitorSources.length}</span>
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={sourceTab === 'window'}
                        className={cx('stream-source-tab', sourceTab === 'window' && 'active')}
                        onClick={() => selectSourceTab('window')}
                        disabled={busy}
                      >
                        <AppWindow size={14} />
                        Приложения
                        <span>{windowSources.length}</span>
                      </button>
                    </div>
                    {activeSources.length ? (
                      <div className="stream-monitor-grid">
                        {activeSources.map((source) => {
                          const isWindow = source.type === 'window';
                          const monitorIndex = monitorSources.indexOf(source);
                          return (
                            <button
                              type="button"
                              key={source.id}
                              className={cx('stream-monitor', screenId === source.id && 'active')}
                              onClick={() => setScreenId(source.id)}
                              disabled={busy}
                              aria-pressed={screenId === source.id}
                            >
                              <span className="stream-monitor-thumb">
                                {source.thumbnail ? (
                                  <img src={source.thumbnail} alt="" draggable={false} />
                                ) : isWindow ? (
                                  <AppWindow size={24} />
                                ) : (
                                  <Monitor size={24} />
                                )}
                                <span className="stream-monitor-badge">
                                  {isWindow ? 'Приложение' : `Монитор ${monitorIndex + 1}`}
                                </span>
                                {screenId === source.id ? (
                                  <span className="stream-monitor-check"><Check size={13} /></span>
                                ) : null}
                              </span>
                              <span className="stream-monitor-name">
                                {source.name || (isWindow ? 'Приложение' : `Монитор ${monitorIndex + 1}`)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="stream-monitor-hint">
                        {sourceTab === 'window'
                          ? 'Открытых приложений не найдено. Запустите нужную программу и откройте список снова.'
                          : screenError
                            ? 'Не удалось получить список мониторов — выберем основной.'
                            : 'Ищем мониторы…'}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="stream-monitor-hint">
                    {screenError ? 'Не удалось получить список мониторов — выберем основной.' : 'Ищем мониторы…'}
                  </div>
                )}
              </div>
            ) : (
              <div className="stream-setup-note stream-monitor-note">
                <Monitor size={16} />
                <span>После нажатия «Начать трансляцию» выберите экран или окно в системном окне.</span>
              </div>
            )
          ) : null}

          {wants.screen ? (
            <button
              type="button"
              className="stream-audio-row"
              onClick={toggleSystemAudio}
              disabled={busy}
              aria-pressed={systemAudio}
            >
              <span className="stream-audio-text">
                <strong>Звук системы</strong>
                <small>
                  {systemAudio
                    ? 'Игры и приложения. Не слушайте свой эфир на этом же ПК: звук попадёт в захват и зациклится.'
                    : 'Только микрофон — эхо и петля из системного звука исключены.'}
                </small>
              </span>
              <span className={cx('toggle', systemAudio && 'on')}><span /></span>
            </button>
          ) : null}

          {rtmpSupported ? (
            <div className="stream-rtmp-block">
              <div className="stream-rtmp-head">
                <span className="stream-rtmp-head-title">
                  <RadioTower size={16} />
                  Мультистрим
                </span>
                <span className="stream-step-optional">Twitch · YouTube · VK · свой RTMP</span>
              </div>
              <p className="stream-rtmp-hint">
                Отправляйте эфир сразу на несколько площадок. ffmpeg перекодирует поток
                на этом компьютере — интернет площадок не влияет на эфир в Carnage Party.
              </p>

              <div className="stream-rtmp-grid">
                {RTMP_PLATFORMS.map((platform) => {
                  const target = rtmp.targets.find((item) => item.platform === platform.id);
                  const active = Boolean(target?.enabled);
                  return (
                    <button
                      type="button"
                      key={platform.id}
                      className={cx('stream-rtmp-chip', active && 'active')}
                      onClick={() => toggleRtmpTarget(platform.id)}
                      disabled={busy}
                      aria-pressed={active}
                    >
                      <span className="stream-rtmp-chip-dot" />
                      <span className="stream-rtmp-chip-text">
                        <strong>{platform.label}</strong>
                        <em>{active ? 'включено' : 'выключено'}</em>
                      </span>
                      <span className={cx('stream-rtmp-chip-check', active && 'on')}>
                        {active ? <Check size={12} /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>

              {rtmp.targets
                .filter((item) => item.enabled)
                .map((target) => {
                  const platform = RTMP_PLATFORMS.find((item) => item.id === target.platform);
                  return (
                    <div className="stream-rtmp-card" key={target.id}>
                      <div className="stream-rtmp-card-head">
                        <strong>{platform?.label || target.label}</strong>
                        <span>{platform?.hint}</span>
                      </div>
                      {target.platform === 'custom' ? (
                        <label className="stream-rtmp-field">
                          <span>Полный RTMP-адрес</span>
                          <div className="stream-rtmp-input">
                            <Link2 size={14} />
                            <input
                              value={target.server}
                              onChange={(event) =>
                                updateRtmpTarget(target.platform, { server: event.target.value })
                              }
                              placeholder="rtmp://host/app/key"
                              disabled={busy}
                              spellCheck={false}
                            />
                          </div>
                        </label>
                      ) : (
                        <>
                          <label className="stream-rtmp-field">
                            <span>Адрес сервера</span>
                            <div className="stream-rtmp-input">
                              <Link2 size={14} />
                              <input
                                value={target.server}
                                onChange={(event) =>
                                  updateRtmpTarget(target.platform, { server: event.target.value })
                                }
                                placeholder={platform?.server}
                                disabled={busy}
                                spellCheck={false}
                              />
                            </div>
                          </label>
                          <label className="stream-rtmp-field">
                            <span>Ключ потока</span>
                            <div className="stream-rtmp-input">
                              <KeyRound size={14} />
                              <input
                                type={showKeys[target.id] ? 'text' : 'password'}
                                value={target.key}
                                onChange={(event) =>
                                  updateRtmpTarget(target.platform, { key: event.target.value })
                                }
                                placeholder="Вставьте ключ трансляции"
                                disabled={busy}
                                autoComplete="off"
                                spellCheck={false}
                              />
                              <button
                                type="button"
                                className="icon-btn stream-rtmp-eye"
                                onClick={() =>
                                  setShowKeys((prev) => ({ ...prev, [target.id]: !prev[target.id] }))
                                }
                                title={showKeys[target.id] ? 'Скрыть ключ' : 'Показать ключ'}
                                tabIndex={-1}
                              >
                                {showKeys[target.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                            </div>
                          </label>
                        </>
                      )}
                    </div>
                  );
                })}

              <div className="stream-rtmp-note">
                <ShieldCheck size={14} />
                <span>
                  Ключи шифруются средствами Windows и хранятся только на этом компьютере.
                  На сервер Carnage Party они не отправляются.
                </span>
              </div>
            </div>
          ) : null}

          <label className="form-field stream-title-field">
            <span className="stream-title-head">
              <span className="form-label">Название трансляции</span>
              <span className="stream-title-count">{title.length}/80</span>
            </span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={80}
              placeholder="Например, вечерний катки"
              disabled={busy}
            />
            <span className="form-hint">До 80 символов — так эфир будет проще найти.</span>
          </label>

          {mode === 'link' ? (
            <div className="stream-setup-note">
              <Link2 size={16} />
              <span>
                После запуска появится публичная ссылка. Её можно отправить кому угодно —
                смотреть эфир можно в браузере без установки программы.
              </span>
            </div>
          ) : (
            <div className="stream-setup-note">
              <MonitorPlay size={16} />
              <span>
                Эфир появится в разделе Streaming у всех пользователей Carnage Party.
              </span>
            </div>
          )}

          {channelId ? (
            <div className="stream-setup-note stream-setup-channel">
              <Hash size={16} />
              <span>
                Трансляция будет закреплена за каналом
                {channelName ? ` #${channelName}` : ''}. Участники смогут открыть её прямо из канала.
              </span>
            </div>
          ) : null}

          {error ? <div className="stream-setup-error">{error}</div> : null}
          {rtmpError ? <div className="stream-setup-error">{rtmpError}</div> : null}

          <div className="modal-actions stream-setup-actions">
            <span className="stream-footnote">
              <Radio size={13} /> Эфир можно остановить в любой момент
            </span>
            <div className="stream-modal-buttons">
              <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
                Отмена
              </button>
              <button type="button" className="btn btn-primary" onClick={start} disabled={busy}>
                {busy ? <Loader2 size={16} className="spin" /> : <Video size={16} />}
                {busy ? 'Запускаем эфир…' : 'Начать трансляцию'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
