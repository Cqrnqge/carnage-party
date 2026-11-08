import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  MessageSquare,
  Mic,
  Server,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../store';
import { BrandMark } from '../ui/Avatar';
import Modal from '../ui/Modal';
import ServerSettings from '../settings/ServerSettings';
import { isAndroidApp, openNativeServerSettings } from '../../mobile';
import { appVersion } from '../../version';
import { cx } from '../../utils';

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [serverModal, setServerModal] = useState(false);
  const [serverInfo, setServerInfo] = useState(null);
  const [nativeServer] = useState(() => {
    try {
      return window.CarnageAndroid?.getServerUrl?.() || '';
    } catch {
      return '';
    }
  });
  const setSession = useApp((state) => state.setSession);

  useEffect(() => {
    if (!window.desktop?.getServerConfig) return undefined;
    let cancelled = false;
    window.desktop
      .getServerConfig()
      .then((data) => {
        if (!cancelled) setServerInfo(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const finish = (data) => {
    setSession(data);
  };

  const login = async (loginIdentifier = identifier, loginPassword = password) => {
    setError('');
    setLoading(true);
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { identifier: loginIdentifier, password: loginPassword },
      });
      finish(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const register = async (event) => {
    event.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Пароли не совпадают');
      return;
    }
    setLoading(true);
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: {
          username: username.toLowerCase(),
          displayName: displayName || username,
          email,
          password,
        },
      });
      finish(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const submitLogin = (event) => {
    event.preventDefault();
    login();
  };

  return (
    <div className="auth-screen">
      <div className="auth-hero">
        <div className="auth-orb auth-orb-one" />
        <div className="auth-orb auth-orb-two" />
        <div className="auth-hero-inner">
          <div className="auth-brand">
            <BrandMark size={62} />
            <div className="auth-brand-text">
              <span className="auth-brand-name">Carnage Party</span>
              <span className="auth-brand-tag">Твоя стая. Твой голос. Твоя вечеринка.</span>
            </div>
          </div>

          <div className="auth-pitch">
            <h1>
              Собирай своих.
              <br />
              Общайся <span>без границ</span>.
            </h1>
            <p>
              Серверы, голосовые комнаты, друзья и мемы — всё в одном месте.
              Создай своё пространство за пару секунд.
            </p>
            <div className="auth-features">
              <div className="auth-feature">
                <span className="auth-feature-icon"><MessageSquare size={18} /></span>
                <div>
                  <strong>Живые чаты</strong>
                  <span>Реакции, ответы, вложения и поиск</span>
                </div>
              </div>
              <div className="auth-feature">
                <span className="auth-feature-icon"><Mic size={18} /></span>
                <div>
                  <strong>Голос и видео</strong>
                  <span>WebRTC, камера и демонстрация экрана</span>
                </div>
              </div>
              <div className="auth-feature">
                <span className="auth-feature-icon"><ShieldCheck size={18} /></span>
                <div>
                  <strong>Роли и права</strong>
                  <span>Гибкая настройка доступа на сервере</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-card">
          <div className="auth-card-top">
            <div>
              <h2>{mode === 'login' ? 'С возвращением!' : 'Создай аккаунт'}</h2>
              <p>
                {mode === 'login'
                  ? 'Рады видеть тебя снова в Carnage Party.'
                  : 'Пара полей — и ты в самой громкой тусовке.'}
              </p>
            </div>
            <span className="auth-mini-logo"><Sparkles size={18} /></span>
          </div>

          <div className="auth-tabs">
            <button
              className={cx('auth-tab', mode === 'login' && 'active')}
              onClick={() => { setMode('login'); setError(''); setNotice(''); }}
            >
              Вход
            </button>
            <button
              className={cx('auth-tab', mode === 'register' && 'active')}
              onClick={() => { setMode('register'); setError(''); setNotice(''); }}
            >
              Регистрация
            </button>
          </div>

          {error ? <div className="auth-error">{error}</div> : null}
          {notice ? <div className="auth-notice">{notice}</div> : null}

          {mode === 'login' ? (
            <form onSubmit={submitLogin} className="auth-form">
              <label className="auth-field">
                <span>Имя пользователя или e-mail</span>
                <input
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="username"
                  autoComplete="username"
                  autoFocus
                  required
                />
              </label>
              <label className="auth-field">
                <span>Пароль</span>
                <div className="auth-password">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>
              <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
                {loading ? <Loader2 size={18} className="spin" /> : <ArrowRight size={18} />}
                {loading ? 'Входим…' : 'Войти в Carnage Party'}
              </button>
            </form>
          ) : (
            <form onSubmit={register} className="auth-form">
              <div className="auth-grid">
                <label className="auth-field">
                  <span>Имя пользователя</span>
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value.toLowerCase())}
                    placeholder="carnage_fan"
                    pattern="[a-zA-Z0-9_.]{2,24}"
                    title="2–24 символа: латиница, цифры, точка, подчёркивание"
                    autoComplete="username"
                    required
                  />
                </label>
                <label className="auth-field">
                  <span>Отображаемое имя</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Как тебя звать?"
                    maxLength={32}
                    autoComplete="nickname"
                  />
                </label>
              </div>
              <label className="auth-field">
                <span>E-mail</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </label>
              <div className="auth-grid">
                <label className="auth-field">
                  <span>Пароль</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Минимум 8 символов"
                    minLength={8}
                    autoComplete="new-password"
                    required
                  />
                </label>
                <label className="auth-field">
                  <span>Повтори пароль</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    placeholder="Ещё раз"
                    minLength={8}
                    autoComplete="new-password"
                    required
                  />
                </label>
              </div>
              <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
                {loading ? <Loader2 size={18} className="spin" /> : <Users size={18} />}
                {loading ? 'Создаём…' : 'Создать аккаунт'}
              </button>
              <p className="auth-legal">
                Регистрируясь, ты соглашаешься вести себя по-человечески и уважать других участников.
              </p>
            </form>
          )}

          <div className="auth-footer">
            <span>Carnage Party · локальный мессенджер</span>
            <div className="auth-footer-right">
              {window.desktop?.getServerConfig || isAndroidApp() ? (
                <button
                  type="button"
                  className="auth-server-btn"
                  onClick={() => {
                    if (isAndroidApp()) {
                      openNativeServerSettings();
                      return;
                    }
                    setServerModal(true);
                  }}
                  title="Сменить сервер"
                >
                  <Server size={13} />
                  <span>
                    {isAndroidApp()
                      ? nativeServer || 'Сервер'
                      : serverInfo?.mode === 'local'
                        ? 'Локальный сервер'
                        : serverInfo?.current || 'Сервер'}
                  </span>
                </button>
              ) : null}
              <span className="auth-version">
                {isAndroidApp()
                  ? `v${appVersion()} · android`
                  : window.desktop
                    ? `v${appVersion()} · desktop`
                    : `v${appVersion()} · web`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {serverModal ? (
        <Modal onClose={() => setServerModal(false)} className="server-modal" showClose>
          <div className="settings-head">
            <h2>Сервер</h2>
            <p>К какому серверу подключается Carnage Party.</p>
          </div>
          <ServerSettings onDone={() => setServerModal(false)} />
        </Modal>
      ) : null}
    </div>
  );
}
