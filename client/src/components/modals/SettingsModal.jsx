import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Camera,
  Check,
  FolderOpen,
  Info,
  KeyRound,
  Loader2,
  LogOut,
  Mic,
  MonitorSpeaker,
  Palette,
  Play,
  RefreshCw,
  Server,
  Shield,
  Square,
  User,
  Volume2,
} from 'lucide-react';
import { api, assetUrl } from '../../api';
import { useApp } from '../../store';
import { SERVER_ACCENTS, STATUS_META } from '../../constants';
import { cx, keyLabel, readImageFile } from '../../utils';
import Avatar from '../ui/Avatar';
import Modal, { FormField } from '../ui/Modal';
import ServerSettings from '../settings/ServerSettings';
import UpdateSettings from '../settings/UpdateSettings';
import { voiceManager } from '../../voice';
import { appVersion } from '../../version';

const TABS = [
  { id: 'profile', label: 'Профиль', icon: User },
  { id: 'appearance', label: 'Оформление', icon: Palette },
  { id: 'notifications', label: 'Уведомления', icon: Bell },
  { id: 'voice', label: 'Голос и видео', icon: Mic },
  { id: 'network', label: 'Сервер', icon: Server },
  { id: 'updates', label: 'Обновления', icon: RefreshCw },
  { id: 'account', label: 'Аккаунт', icon: Shield },
];

function Toggle({ checked, onChange, label, hint }) {
  return (
    <button className="toggle-row" onClick={() => onChange(!checked)} type="button">
      <div>
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </div>
      <span className={cx('toggle', checked && 'on')}><span /></span>
    </button>
  );
}

export default function SettingsModal({ tab: initialTab = 'profile' }) {
  const user = useApp((state) => state.user);
  const settings = useApp((state) => state.settings);
  const updateSettings = useApp((state) => state.updateSettings);
  const updateUser = useApp((state) => state.updateUser);
  const closeModal = useApp((state) => state.closeModal);
  const toast = useApp((state) => state.toast);
  const logout = useApp((state) => state.logout);
  const [tab, setTab] = useState(initialTab);

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [customStatus, setCustomStatus] = useState(user?.customStatus || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [accentColor, setAccentColor] = useState(user?.accentColor || '#5865f2');
  const [banner, setBanner] = useState(user?.banner || null);
  const [avatar, setAvatar] = useState(user?.avatar || null);
  const [savingProfile, setSavingProfile] = useState(false);
  const avatarInput = useRef(null);

  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [savingPassword, setSavingPassword] = useState(false);
  const [dataPath, setDataPath] = useState('');

  const [devices, setDevices] = useState({ audioinput: [], audiooutput: [], videoinput: [] });
  const [micTesting, setMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [pttListening, setPttListening] = useState(false);
  const testRef = useRef({ stream: null, ctx: null, raf: null });

  useEffect(() => {
    if (tab !== 'voice') return undefined;
    let cancelled = false;
    navigator.mediaDevices?.enumerateDevices?.().then((list) => {
      if (cancelled) return;
      const grouped = { audioinput: [], audiooutput: [], videoinput: [] };
      for (const device of list) {
        if (grouped[device.kind]) {
          grouped[device.kind].push(device);
        }
      }
      setDevices(grouped);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tab]);

  useEffect(() => () => {
    const { stream, ctx, raf } = testRef.current;
    if (raf) cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (ctx) ctx.close().catch(() => {});
  }, []);

  // Захват клавиши для режима рации.
  useEffect(() => {
    if (!pttListening) return undefined;
    const onKeyDown = (event) => {
      if (event.repeat) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === 'Escape') {
        setPttListening(false);
        return;
      }
      updateSettings({ pttKey: event.code });
      setPttListening(false);
      toast(`Клавиша рации: ${keyLabel(event.code)}`, 'success');
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [pttListening, updateSettings, toast]);

  if (!user) return null;

  const saveProfile = async () => {
    if (!displayName.trim()) {
      toast('Отображаемое имя не может быть пустым', 'error');
      return;
    }
    setSavingProfile(true);
    try {
      const data = await api('/api/users/me', {
        method: 'PATCH',
        body: {
          displayName: displayName.trim(),
          customStatus: customStatus.trim(),
          bio: bio.trim(),
          accentColor,
          banner,
          avatar,
        },
      });
      if (data?.user) updateUser(data.user);
      toast('Профиль обновлён', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const pickAvatar = async (file) => {
    if (!file) return;
    try {
      const url = await readImageFile(file, { maxSize: 512, maxBytes: 700_000, square: true });
      setAvatar(url);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    if (!passwords.current) return toast('Введите текущий пароль', 'error');
    if (passwords.next.length < 8) return toast('Новый пароль должен быть не короче 8 символов', 'error');
    if (passwords.next !== passwords.confirm) return toast('Новые пароли не совпадают', 'error');
    setSavingPassword(true);
    try {
      await api('/api/auth/password', {
        method: 'POST',
        body: { currentPassword: passwords.current, newPassword: passwords.next },
      });
      setPasswords({ current: '', next: '', confirm: '' });
      toast('Пароль изменён', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  const requestDevices = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      const list = await navigator.mediaDevices.enumerateDevices();
      const grouped = { audioinput: [], audiooutput: [], videoinput: [] };
      for (const device of list) if (grouped[device.kind]) grouped[device.kind].push(device);
      setDevices(grouped);
    } catch (err) {
      toast(`Не удалось получить доступ к микрофону: ${err.message}`, 'error');
    }
  };

  const stopMicTest = () => {
    const { stream, ctx, raf } = testRef.current;
    if (raf) cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (ctx) ctx.close().catch(() => {});
    testRef.current = { stream: null, ctx: null, raf: null };
    setMicTesting(false);
    setMicLevel(0);
  };

  const startMicTest = async () => {
    stopMicTest();
    try {
      const deviceId = settings.inputDevice;
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true,
        });
      } catch (err) {
        if (deviceId && deviceId !== 'default' && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          throw err;
        }
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buffer = new Uint8Array(analyser.fftSize);
      testRef.current = { stream, ctx, raf: null };
      setMicTesting(true);
      const tick = () => {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const value = (buffer[i] - 128) / 128;
          sum += value * value;
        }
        setMicLevel(Math.min(100, Math.round(Math.sqrt(sum / buffer.length) * 480)));
        testRef.current.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      toast(`Микрофон недоступен: ${err.message}`, 'error');
    }
  };

  const changeSetting = (patch) => updateSettings(patch);

  const changeInput = async (deviceId) => {
    changeSetting({ inputDevice: deviceId });
    if (voiceManager.joined) {
      await voiceManager.changeInputDevice(deviceId);
    }
  };

  const openDataFolder = async () => {
    try {
      const path = await window.desktop?.getDataPath?.();
      if (path) {
        setDataPath(path);
        await navigator.clipboard.writeText(path).catch(() => {});
        toast('Путь к данным скопирован в буфер обмена', 'success');
      }
    } catch {
      toast('Не удалось получить путь к данным', 'error');
    }
  };

  return (
    <Modal onClose={closeModal} className="settings-modal" showClose>
      <div className="settings-layout">
        <aside className="settings-nav">
          <div className="settings-nav-title">Настройки</div>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={cx('settings-nav-item', tab === id && 'active')}
              onClick={() => setTab(id)}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
          <div className="settings-nav-sep" />
          <button className="settings-nav-item danger" onClick={logout}>
            <LogOut size={17} />
            <span>Выйти</span>
          </button>
          <div className="settings-version">Carnage Party · v{appVersion()}</div>
        </aside>

        <div className="settings-content">
          {tab === 'profile' ? (
            <>
              <div className="settings-head">
                <h2>Профиль</h2>
                <p>Так вас видят другие участники Carnage Party.</p>
              </div>
              <div className="settings-profile-preview">
                <div
                  className="settings-banner"
                  style={
                    banner
                      ? banner.startsWith('#')
                        ? { background: banner }
                        : { backgroundImage: `url(${assetUrl(banner)})` }
                      : { background: `linear-gradient(120deg, ${accentColor}, #7c3aed)` }
                  }
                />
                <div className="settings-preview-body">
                  <Avatar user={{ ...user, avatar, accentColor, displayName }} size={72} className="settings-preview-avatar" />
                  <div className="settings-preview-meta">
                    <strong>{displayName || 'Ваше имя'}</strong>
                    <span>@{user.username}</span>
                  </div>
                  <button className="btn btn-secondary btn-small" onClick={() => avatarInput.current?.click()}>
                    <Camera size={15} /> Сменить аватар
                  </button>
                  <input
                    ref={avatarInput}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      pickAvatar(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                </div>
              </div>

              <div className="settings-form-grid">
                <FormField label="Отображаемое имя">
                  <input value={displayName} maxLength={32} onChange={(event) => setDisplayName(event.target.value)} />
                </FormField>
                <FormField label="Статус" hint="Короткая фраза о том, чем вы заняты">
                  <input value={customStatus} maxLength={128} onChange={(event) => setCustomStatus(event.target.value)} placeholder="Например: слушаю музыку" />
                </FormField>
              </div>
              <FormField label="О себе" hint={`${bio.length}/190`}>
                <textarea value={bio} maxLength={190} rows={4} onChange={(event) => setBio(event.target.value)} placeholder="Расскажите о себе…" />
              </FormField>

              <div className="settings-label">Акцентный цвет</div>
              <div className="color-palette">
                {SERVER_ACCENTS.map((color) => (
                  <button
                    key={color}
                    className={cx('color-swatch', accentColor === color && 'active')}
                    style={{ background: color }}
                    onClick={() => setAccentColor(color)}
                    aria-label={color}
                  >
                    {accentColor === color ? <Check size={15} /> : null}
                  </button>
                ))}
              </div>

              <div className="settings-label">Баннер профиля</div>
              <div className="color-palette">
                <button
                  className={cx('color-swatch banner-swatch', !banner && 'active')}
                  style={{ background: 'linear-gradient(135deg,#2b2d31,#1e1f22)' }}
                  onClick={() => setBanner(null)}
                  title="Без баннера"
                >
                  {!banner ? <Check size={15} /> : null}
                </button>
                {SERVER_ACCENTS.map((color) => (
                  <button
                    key={`banner-${color}`}
                    className={cx('color-swatch', banner === color && 'active')}
                    style={{ background: `linear-gradient(135deg, ${color}, #7c3aed)` }}
                    onClick={() => setBanner(color)}
                    aria-label={`Баннер ${color}`}
                  >
                    {banner === color ? <Check size={15} /> : null}
                  </button>
                ))}
              </div>

              <div className="settings-actions">
                {avatar ? (
                  <button className="btn btn-ghost" onClick={() => setAvatar(null)}>
                    Убрать аватар
                  </button>
                ) : null}
                <button className="btn btn-primary" onClick={saveProfile} disabled={savingProfile}>
                  {savingProfile ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
                  {savingProfile ? 'Сохраняем…' : 'Сохранить изменения'}
                </button>
              </div>
            </>
          ) : null}

          {tab === 'appearance' ? (
            <>
              <div className="settings-head">
                <h2>Оформление</h2>
                <p>Настройте внешний вид приложения под себя.</p>
              </div>
              <div className="settings-group">
                <div className="settings-label">Тема</div>
                <div className="theme-options">
                  {[
                    { id: 'dark', label: 'Чёрно-серая', colors: ['#242427', '#0a0a0b'] },
                    { id: 'carnage', label: 'Carnage', colors: ['#241e30', '#0b0910'] },
                    { id: 'midnight', label: 'Полночь', colors: ['#1a1b2e', '#0f1019'] },
                    { id: 'crimson', label: 'Багровая', colors: ['#2a1420', '#160b10'] },
                  ].map((theme) => (
                    <button
                      key={theme.id}
                      className={cx('theme-card', settings.theme === theme.id && 'active')}
                      onClick={() => changeSetting({ theme: theme.id })}
                    >
                      <span className="theme-preview" style={{ background: `linear-gradient(135deg, ${theme.colors[0]}, ${theme.colors[1]})` }} />
                      <span>{theme.label}</span>
                      {settings.theme === theme.id ? <Check size={15} /> : null}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-group">
                <Toggle
                  checked={settings.compact}
                  onChange={(value) => changeSetting({ compact: value })}
                  label="Компактный режим"
                  hint="Уменьшает отступы между сообщениями"
                />
                <Toggle
                  checked={settings.messageGrouping}
                  onChange={(value) => changeSetting({ messageGrouping: value })}
                  label="Группировать сообщения"
                  hint="Сообщения одного автора подряд объединяются"
                />
                <Toggle
                  checked={settings.reduceMotion}
                  onChange={(value) => changeSetting({ reduceMotion: value })}
                  label="Меньше анимаций"
                  hint="Отключает часть переходов и эффектов"
                />
                <Toggle
                  checked={settings.showMembers}
                  onChange={(value) => changeSetting({ showMembers: value })}
                  label="Показывать участников"
                  hint="Список участников справа в каналах"
                />
              </div>
            </>
          ) : null}

          {tab === 'notifications' ? (
            <>
              <div className="settings-head">
                <h2>Уведомления</h2>
                <p>Решите, когда Carnage Party должен вас звать.</p>
              </div>
              <div className="settings-group">
                <Toggle
                  checked={settings.notifications}
                  onChange={(value) => {
                    changeSetting({ notifications: value });
                    if (value && 'Notification' in window && Notification.permission === 'default') {
                      Notification.requestPermission().catch(() => {});
                    }
                  }}
                  label="Уведомления на рабочем столе"
                  hint="Показывать всплывающие уведомления о новых сообщениях"
                />
                <Toggle
                  checked={settings.notifyAll}
                  onChange={(value) => changeSetting({ notifyAll: value })}
                  label="Уведомлять о всех сообщениях"
                  hint="Иначе уведомления приходят только для упоминаний и личных сообщений"
                />
                <Toggle
                  checked={settings.sounds}
                  onChange={(value) => changeSetting({ sounds: value })}
                  label="Звуки"
                  hint="Звук новых сообщений, упоминаний и звонков"
                />
              </div>
              <div className="settings-note">
                <Info size={16} />
                <span>В desktop-версии уведомления показываются системно. В браузере нужно разрешение.</span>
              </div>
            </>
          ) : null}

          {tab === 'voice' ? (
            <>
              <div className="settings-head">
                <h2>Голос и видео</h2>
                <p>Выберите устройства и проверьте микрофон перед звонком.</p>
              </div>
              {!devices.audioinput.length ? (
                <button className="btn btn-secondary" onClick={requestDevices}>
                  <Mic size={16} /> Разрешить доступ к устройствам
                </button>
              ) : null}
              <FormField label="Микрофон">
                <select value={settings.inputDevice} onChange={(event) => changeInput(event.target.value)}>
                  <option value="default">По умолчанию</option>
                  {devices.audioinput.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Микрофон ${index + 1}`}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Устройство вывода звука">
                <select
                  value={settings.outputDevice}
                  onChange={(event) => changeSetting({ outputDevice: event.target.value })}
                >
                  <option value="default">По умолчанию</option>
                  {devices.audiooutput.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Устройство ${index + 1}`}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Камера">
                <select
                  value={settings.videoDevice}
                  onChange={(event) => changeSetting({ videoDevice: event.target.value })}
                >
                  <option value="default">По умолчанию</option>
                  {devices.videoinput.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Камера ${index + 1}`}
                    </option>
                  ))}
                </select>
              </FormField>

              <div className="ptt-settings">
                <Toggle
                  checked={settings.pushToTalk}
                  onChange={(value) => {
                    changeSetting({ pushToTalk: value });
                    voiceManager.applyPushToTalk(value);
                  }}
                  label="Режим рации (Push-to-Talk)"
                  hint="Микрофон выключен, пока вы удерживаете кнопку «Рация» или клавишу"
                />
                {settings.pushToTalk ? (
                  <div className="ptt-key-row">
                    <div className="ptt-key-info">
                      <span>Клавиша рации</span>
                      <small>Работает даже при свёрнутом окне — главное, быть в голосовом канале</small>
                    </div>
                    <button
                      type="button"
                      className={cx('btn', pttListening ? 'btn-primary' : 'btn-secondary', 'ptt-key-btn')}
                      onClick={() => setPttListening(true)}
                    >
                      {pttListening ? 'Нажмите клавишу…' : keyLabel(settings.pttKey)}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="settings-label">Громкость микрофона — {settings.inputVolume}%</div>
              <input
                type="range"
                min="0"
                max="150"
                value={settings.inputVolume}
                onChange={(event) => changeSetting({ inputVolume: Number(event.target.value) })}
              />
              <div className="settings-label">Громкость собеседников — {settings.outputVolume}%</div>
              <input
                type="range"
                min="0"
                max="100"
                value={settings.outputVolume}
                onChange={(event) => changeSetting({ outputVolume: Number(event.target.value) })}
              />

              <div className="mic-test">
                <button className={micTesting ? 'btn btn-danger' : 'btn btn-secondary'} onClick={micTesting ? stopMicTest : startMicTest}>
                  {micTesting ? <Square size={15} /> : <Play size={15} />}
                  {micTesting ? 'Остановить проверку' : 'Проверить микрофон'}
                </button>
                <div className="mic-meter">
                  <span style={{ width: `${micLevel}%` }} />
                </div>
              </div>
              <div className="settings-note">
                <MonitorSpeaker size={16} />
                <span>Эхо-подавление и шумоподавление включены автоматически. Демонстрация экрана доступна в голосовой комнате.</span>
              </div>
            </>
          ) : null}

          {tab === 'network' ? (
            <>
              <div className="settings-head">
                <h2>Сервер</h2>
                <p>К какому серверу подключается Carnage Party.</p>
              </div>
              <ServerSettings />
            </>
          ) : null}

          {tab === 'updates' ? (
            <>
              <div className="settings-head">
                <h2>Обновления</h2>
                <p>Проверьте версию и установите новую, не выходя из приложения.</p>
              </div>
              <UpdateSettings />
            </>
          ) : null}

          {tab === 'account' ? (
            <>
              <div className="settings-head">
                <h2>Аккаунт</h2>
                <p>Управление учётной записью и данными приложения.</p>
              </div>
              <div className="account-card">
                <div className="account-row"><span>Имя пользователя</span><strong>@{user.username}</strong></div>
                <div className="account-row"><span>E-mail</span><strong>{user.email}</strong></div>
                <div className="account-row"><span>Статус</span><strong style={{ color: STATUS_META[user.status]?.color }}>{STATUS_META[user.status]?.label || 'В сети'}</strong></div>
                <div className="account-row"><span>ID</span><code>{user.id}</code></div>
              </div>

              <h3 className="settings-subtitle"><KeyRound size={17} /> Сменить пароль</h3>
              <form className="password-form" onSubmit={changePassword}>
                <FormField label="Текущий пароль">
                  <input type="password" value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} autoComplete="current-password" />
                </FormField>
                <div className="settings-form-grid">
                  <FormField label="Новый пароль">
                    <input type="password" value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} autoComplete="new-password" />
                  </FormField>
                  <FormField label="Повторите новый пароль">
                    <input type="password" value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })} autoComplete="new-password" />
                  </FormField>
                </div>
                <button className="btn btn-primary" disabled={savingPassword}>
                  {savingPassword ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />} Изменить пароль
                </button>
              </form>

              <h3 className="settings-subtitle"><FolderOpen size={17} /> Данные приложения</h3>
              <div className="settings-note">
                <Info size={16} />
                <span>Все сообщения, файлы и настройки хранятся локально на этом компьютере.</span>
              </div>
              {window.desktop ? (
                <button className="btn btn-secondary" onClick={openDataFolder}>
                  <FolderOpen size={16} /> {dataPath ? 'Скопировать путь к данным' : 'Показать папку данных'}
                </button>
              ) : null}

              <div className="settings-danger-zone">
                <div>
                  <strong>Выйти из аккаунта</strong>
                  <span>Потребуется снова ввести имя пользователя и пароль.</span>
                </div>
                <button className="btn btn-danger" onClick={logout}>
                  <LogOut size={16} /> Выйти
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
