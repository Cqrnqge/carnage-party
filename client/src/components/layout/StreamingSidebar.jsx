import React, { useMemo, useState } from 'react';
import { Eye, Plus, Radio, Search, X } from 'lucide-react';
import { useApp } from '../../store';
import { cx } from '../../utils';
import { sourceShortLabel } from '../../stream-utils';
import Avatar from '../ui/Avatar';
import UserPanel from './UserPanel';
import VoiceDock from './VoiceDock';

function StreamRow({ stream }) {
  const active = useApp((state) => state.active);
  const myStream = useApp((state) => state.myStream);
  const setActive = useApp((state) => state.setActive);
  const setMobilePanel = useApp((state) => state.setMobilePanel);
  const mine = myStream?.id === stream.id;
  const isActive = active?.type === 'stream' && active.id === stream.id;
  const owner = stream.owner || {};

  return (
    <button
      type="button"
      className={cx('stream-side-row', isActive && 'active', mine && 'mine')}
      onClick={() => {
        setActive({ type: 'stream', id: stream.id });
        setMobilePanel(null);
      }}
    >
      <span className="stream-side-thumb">
        {stream.preview ? (
          <img src={stream.preview} alt="" draggable={false} />
        ) : (
          <span className="stream-side-thumb-fallback">
            <Radio size={18} />
          </span>
        )}
        <span className="stream-side-live">LIVE</span>
      </span>
      <span className="stream-side-info">
        <span className="stream-side-owner">
          {owner.displayName || owner.username || 'Стример'}
          {mine ? <em>вы</em> : null}
        </span>
        <span className="stream-side-title">{stream.title || 'Трансляция'}</span>
        <span className="stream-side-meta">
          <Eye size={11} />
          {Number(stream.viewers) || 0}
          <span className="stream-side-dot" />
          {sourceShortLabel(stream.source)}
        </span>
      </span>
    </button>
  );
}

export default function StreamingSidebar() {
  const streams = useApp((state) => state.streams);
  const myStream = useApp((state) => state.myStream);
  const active = useApp((state) => state.active);
  const user = useApp((state) => state.user);
  const setActive = useApp((state) => state.setActive);
  const setMobilePanel = useApp((state) => state.setMobilePanel);
  const openModal = useApp((state) => state.openModal);
  const [query, setQuery] = useState('');

  const live = useMemo(
    () => (streams || []).filter((stream) => stream.live !== false),
    [streams]
  );

  const normalized = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const list = live.filter((stream) => stream.id !== myStream?.id);
    if (!normalized) return list;
    return list.filter((stream) => {
      const owner = stream.owner || {};
      return `${stream.title || ''} ${owner.displayName || ''} ${owner.username || ''}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [live, myStream?.id, normalized]);

  const startOrOpen = () => {
    if (myStream) {
      setActive({ type: 'stream', id: myStream.id });
      setMobilePanel(null);
      return;
    }
    openModal('startStream');
  };

  return (
    <aside className="sidebar streaming-sidebar">
      <div className="sidebar-header home-header streaming-sidebar-header">
        <span className="home-title streaming-sidebar-title">
          <Radio size={17} />
          Streaming
        </span>
        <button
          type="button"
          className="icon-btn"
          data-tooltip={myStream ? 'Перейти к своему эфиру' : 'Начать трансляцию'}
          aria-label={myStream ? 'Перейти к своему эфиру' : 'Начать трансляцию'}
          onClick={startOrOpen}
        >
          {myStream ? <Radio size={18} /> : <Plus size={18} />}
        </button>
      </div>

      <div className="sidebar-scroll">
        <button
          type="button"
          className={cx('home-nav-item', active?.type === 'streaming' && 'active')}
          onClick={() => {
            setActive({ type: 'streaming' });
            setMobilePanel(null);
          }}
        >
          <Radio size={20} />
          <span>Все трансляции</span>
          {live.length > 0 ? <span className="nav-badge">{live.length}</span> : null}
        </button>

        {myStream ? (
          <button
            type="button"
            className={cx(
              'home-nav-item',
              'streaming-my-item',
              active?.type === 'stream' && active.id === myStream.id && 'active'
            )}
            onClick={() => {
              setActive({ type: 'stream', id: myStream.id });
              setMobilePanel(null);
            }}
          >
            <span className="streaming-my-dot" />
            <span>Моя трансляция</span>
            <span className="streaming-my-badge">LIVE</span>
          </button>
        ) : null}

        <div className="dm-search stream-side-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск трансляций…"
            aria-label="Поиск трансляций"
          />
          {query ? (
            <button className="icon-btn tiny" onClick={() => setQuery('')} aria-label="Очистить поиск">
              <X size={13} />
            </button>
          ) : null}
        </div>

        <div className="sidebar-section-label stream-side-section">
          <span>Сейчас в эфире</span>
          <span className="stream-side-count">{live.length}</span>
        </div>

        <div className="stream-side-list">
          {visible.length === 0 ? (
            <div className="sidebar-empty stream-side-empty">
              {normalized
                ? 'Никого не нашли — попробуйте другой запрос.'
                : myStream && live.length <= 1
                  ? 'Кроме вашего эфира сейчас никого нет.'
                  : 'Пока никто не стримит. Зажгите эфир первым!'}
              {!normalized && !myStream ? (
                <button type="button" className="btn btn-secondary btn-small" onClick={startOrOpen}>
                  Начать трансляцию
                </button>
              ) : null}
            </div>
          ) : (
            visible.map((stream) => <StreamRow key={stream.id} stream={stream} />)
          )}
        </div>

        {live.length > 0 ? (
          <div className="stream-side-tip">
            <Avatar user={user} size={24} />
            <span>Нажмите на карточку, чтобы смотреть эфир прямо в программе.</span>
          </div>
        ) : null}
      </div>

      <VoiceDock />
      <UserPanel />
    </aside>
  );
}
