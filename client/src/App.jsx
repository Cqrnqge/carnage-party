import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, Server, WifiOff } from 'lucide-react';
import { api, clearToken } from './api';
import { useApp, selectChannel } from './store';
import { connectSocket, disconnectSocket } from './socket';
import { voiceManager } from './voice';
import { cx } from './utils';
import AuthScreen from './components/auth/AuthScreen';
import ServerRail from './components/layout/ServerRail';
import HomeSidebar from './components/layout/HomeSidebar';
import ServerSidebar from './components/layout/ServerSidebar';
import FriendsView from './components/friends/FriendsView';
import ChatArea from './components/chat/ChatArea';
import ModalRoot from './components/modals/ModalRoot';
import Toasts from './components/ui/Toasts';
import { BrandMark } from './components/ui/Avatar';
import VoiceDock from './components/layout/VoiceDock';
import MobileTabBar from './components/mobile/MobileTabBar';
import { isAndroidApp, openNativeServerSettings, useMobileClient } from './mobile';
import ScreenPicker from './components/voice/ScreenPicker';
import PushToTalk from './components/voice/PushToTalk';
import AudioOutputs from './components/voice/AudioOutputs';
import IncomingCallModal from './components/voice/IncomingCallModal';

function Splash({ error, message, onRetry }) {
  return (
    <div className="splash">
      <div className="splash-orb splash-orb-one" />
      <div className="splash-orb splash-orb-two" />
      <div className="splash-inner">
        <BrandMark size={86} />
        <h1>Carnage Party</h1>
        {error ? (
          <>
            <p className="splash-error"><AlertCircle size={16} /> {error}</p>
            <button className="btn btn-primary" onClick={onRetry}>
              <RefreshCw size={16} /> Повторить
            </button>
            {isAndroidApp() ? (
              <button className="btn btn-secondary splash-server-btn" onClick={openNativeServerSettings}>
                <Server size={16} /> Сменить сервер
              </button>
            ) : null}
          </>
        ) : (
          <p className="splash-loading"><Loader2 size={17} className="spin" /> {message || 'Подключаемся к тусовке…'}</p>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const token = useApp((state) => state.token);
  const user = useApp((state) => state.user);
  const ready = useApp((state) => state.ready);
  const active = useApp((state) => state.active);
  const servers = useApp((state) => state.servers);
  const channels = useApp((state) => state.channels);
  const dms = useApp((state) => state.dms);
  const unread = useApp((state) => state.unread);
  const mentions = useApp((state) => state.mentions);
  const settings = useApp((state) => state.settings);
  const socketConnected = useApp((state) => state.socketConnected);
  const voice = useApp((state) => state.voice);
  const mobilePanel = useApp((state) => state.mobilePanel);
  const modal = useApp((state) => state.modal);
  const applyBootstrap = useApp((state) => state.applyBootstrap);
  const logout = useApp((state) => state.logout);
  const setActive = useApp((state) => state.setActive);
  const openModal = useApp((state) => state.openModal);
  const setMobilePanel = useApp((state) => state.setMobilePanel);
  const mobile = useMobileClient();
  const [bootState, setBootState] = useState('idle');
  const [bootError, setBootError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      disconnectSocket();
      setBootState('idle');
      return undefined;
    }
    setBootState('loading');
    setBootError('');
    api('/api/bootstrap')
      .then((data) => {
        if (cancelled) return;
        applyBootstrap(data);
        connectSocket(token);
        setBootState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.status === 401) {
          clearToken();
          logout();
          setBootState('idle');
        } else {
          setBootError(err.message || 'Не удалось подключиться к серверу');
          setBootState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, retryKey]);

  useEffect(() => {
    const unauthorized = () => {
      const state = useApp.getState();
      if (state.token) {
        state.toast('Сессия истекла — войдите заново', 'error');
        state.logout();
      }
    };
    window.addEventListener('carnage:unauthorized', unauthorized);
    window.addEventListener('carnage:unauthorized', unauthorized);
    return () => {
      window.removeEventListener('carnage:unauthorized', unauthorized);
      window.removeEventListener('carnage:unauthorized', unauthorized);
    };
  }, []);

  useEffect(() => {
    return () => {
      voiceManager.leave({ silent: true });
      disconnectSocket();
    };
  }, []);

  // Android-кнопка «Назад» сначала закрывает меню или окно, а не приложение.
  useEffect(() => {
    try {
      window.CarnageAndroid?.setOverlayOpen?.(Boolean(mobilePanel || modal));
    } catch {}
  }, [mobilePanel, modal]);

  useEffect(() => {
    const onBack = () => {
      const state = useApp.getState();
      if (state.mobilePanel) {
        state.setMobilePanel(null);
        return;
      }
      if (state.modal) state.closeModal();
    };
    window.addEventListener('carnage:back', onBack);
    return () => window.removeEventListener('carnage:back', onBack);
  }, []);

  const channel = active?.type === 'channel' ? selectChannel({ channels, dms }, active.id) : null;
  const server = channel?.serverId ? servers.find((item) => item.id === channel.serverId) : null;
  const isHome = active?.type === 'friends' || (active?.type === 'channel' && channel?.type === 'dm');

  useEffect(() => {
    if (!ready) return;
    if (active?.type === 'channel' && !channel) {
      setActive({ type: 'friends' });
    }
  }, [ready, active?.type, active?.id, channel]);

  useEffect(() => {
    const onKey = (event) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const state = useApp.getState();
        if (state.modal?.type === 'search') state.closeModal();
        else state.openModal('search');
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        voiceManager.toggleMute();
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        voiceManager.toggleDeafen();
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        useApp.getState().openModal('search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const unreadTotal = useMemo(() => {
    let count = 0;
    for (const value of Object.values(unread || {})) count += Number(value) || 0;
    return count;
  }, [unread]);

  const mentionTotal = useMemo(() => {
    let count = 0;
    for (const value of Object.values(mentions || {})) count += Number(value) || 0;
    return count;
  }, [mentions]);

  useEffect(() => {
    const base = 'Carnage Party';
    if (!channel) {
      document.title = unreadTotal ? `(${unreadTotal}) ${base}` : base;
      return;
    }
    const name =
      channel.type === 'dm'
        ? channel.name || (channel.members || []).filter((member) => member.id !== user?.id).map((member) => member.displayName).join(', ')
        : `#${channel.name}`;
    document.title = unreadTotal ? `(${unreadTotal}) ${name} · ${base}` : `${name} · ${base}`;
  }, [channel, unreadTotal, user?.id]);

  useEffect(() => {
    if (mentionTotal > 0 && settings.notifications) {
      // Мягкое напоминание о непрочитанных упоминаниях.
      document.documentElement.dataset.mentions = String(mentionTotal);
    } else {
      delete document.documentElement.dataset.mentions;
    }
  }, [mentionTotal, settings.notifications]);

  if (!token) {
    return <AuthScreen />;
  }

  if (!user) {
    if (bootState === 'error') {
      return (
        <Splash
          error={`${bootError}. Проверьте, что сервер запущен.`}
          onRetry={() => setRetryKey((value) => value + 1)}
        />
      );
    }
    return <Splash message="Подключаемся к Carnage Party…" />;
  }

  return (
    <div
      className={cx(
        'app',
        `theme-${settings.theme || 'dark'}`,
        settings.compact && 'compact',
        settings.reduceMotion && 'reduce-motion',
        mobile && 'mobile-client',
        mobilePanel && 'mobile-panel-open',
        mobile && voice.channelId && 'mobile-voice-open'
      )}
    >
      <AudioOutputs />
      <PushToTalk />
      <div className={cx('app-nav', mobilePanel === 'nav' && 'open')}>
        <ServerRail />
        {isHome || !server ? <HomeSidebar /> : <ServerSidebar />}
      </div>
      {mobile && mobilePanel ? (
        <button
          type="button"
          className="mobile-backdrop"
          aria-label="Закрыть меню"
          onClick={() => setMobilePanel(null)}
        />
      ) : null}
      <main className="app-main">
        {active?.type === 'friends' ? (
          <FriendsView />
        ) : channel ? (
          <ChatArea channel={channel} server={server} />
        ) : (
          <div className="empty-main">
            <BrandMark size={64} />
            <h2>Выберите канал</h2>
            <p>Слева — серверы и личные сообщения. Начните общение!</p>
          </div>
        )}
      </main>

      {!socketConnected ? (
        <div className="connection-banner">
          <WifiOff size={15} />
          Нет соединения с сервером — переподключаемся…
        </div>
      ) : null}

      {mobile ? <MobileTabBar /> : null}
      {mobile && voice.channelId ? (
        <div className="mobile-voice-dock">
          <VoiceDock />
        </div>
      ) : null}

      <ScreenPicker />
      <IncomingCallModal />
      <ModalRoot />
      <Toasts />
    </div>
  );
}
