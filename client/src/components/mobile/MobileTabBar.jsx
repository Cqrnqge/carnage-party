import React, { useMemo } from 'react';
import { Compass, MessageSquare, Search, Settings } from 'lucide-react';
import { useApp, selectChannel } from '../../store';
import { cx } from '../../utils';

export default function MobileTabBar() {
  const active = useApp((state) => state.active);
  const channels = useApp((state) => state.channels);
  const unread = useApp((state) => state.unread);
  const mentions = useApp((state) => state.mentions);
  const setActive = useApp((state) => state.setActive);
  const setMobilePanel = useApp((state) => state.setMobilePanel);
  const openModal = useApp((state) => state.openModal);

  const channel = active?.type === 'channel' ? selectChannel({ channels, dms: [] }, active.id) : null;
  const unreadTotal = useMemo(
    () => Object.values(unread || {}).reduce((sum, value) => sum + (Number(value) || 0), 0),
    [unread]
  );
  const mentionTotal = useMemo(
    () => Object.values(mentions || {}).reduce((sum, value) => sum + (Number(value) || 0), 0),
    [mentions]
  );

  const openChats = () => {
    setActive({ type: 'friends' });
    setMobilePanel('nav');
  };

  return (
    <nav className="mobile-tabbar" aria-label="Навигация">
      <button
        type="button"
        className={cx('mobile-tab', active?.type === 'friends' && 'active')}
        onClick={openChats}
      >
        <span className="mobile-tab-icon">
          <MessageSquare size={21} />
          {unreadTotal > 0 ? (
            <span className={cx('mobile-tab-badge', mentionTotal > 0 && 'mention')}>
              {mentionTotal > 0 ? mentionTotal : unreadTotal > 99 ? '99+' : unreadTotal}
            </span>
          ) : null}
        </span>
        <span>Чаты</span>
      </button>

      <button
        type="button"
        className={cx('mobile-tab', channel?.serverId && 'active')}
        onClick={() => setMobilePanel('nav')}
      >
        <span className="mobile-tab-icon"><Compass size={21} /></span>
        <span>Серверы</span>
      </button>

      <button type="button" className="mobile-tab" onClick={() => openModal('search')}>
        <span className="mobile-tab-icon"><Search size={21} /></span>
        <span>Поиск</span>
      </button>

      <button
        type="button"
        className="mobile-tab"
        onClick={() => openModal('settings', { tab: 'profile' })}
      >
        <span className="mobile-tab-icon"><Settings size={21} /></span>
        <span>Настройки</span>
      </button>
    </nav>
  );
}
