import React, { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  Cast,
  Eye,
  Link2,
  Monitor,
  MonitorPlay,
  Play,
  Radio,
  Search,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useApp } from '../../store';
import { cx, initials } from '../../utils';
import {
  formatElapsed,
  liveCountLabel,
  modeLabel,
  sourceLabel,
  sourceShortLabel,
  viewersLabel,
} from '../../stream-utils';
import Avatar from '../ui/Avatar';

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'app', label: 'В программе' },
  { id: 'link', label: 'По ссылке' },
];

function useElapsed(value) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return formatElapsed(value);
}

function StreamCard({ stream, mine }) {
  const setActive = useApp((state) => state.setActive);
  const setMobilePanel = useApp((state) => state.setMobilePanel);
  const owner = stream.owner || {};
  const elapsed = useElapsed(stream.createdAt);

  return (
    <button
      type="button"
      className={cx('stream-card', mine && 'mine')}
      onClick={() => {
        setActive({ type: 'stream', id: stream.id });
        setMobilePanel(null);
      }}
    >
      <span className="stream-card-thumb">
        {stream.preview ? (
          <img src={stream.preview} alt="" draggable={false} />
        ) : (
          <span className="stream-card-fallback">
            <Radio size={36} />
            <em>{initials(owner.displayName || owner.username || 'CP')}</em>
          </span>
        )}
        <span className="stream-live-chip">LIVE</span>
        <span className="stream-card-viewers">
          <Eye size={13} /> {Number(stream.viewers) || 0}
        </span>
        {mine ? <span className="stream-card-mine">Ваш эфир</span> : null}
        <span className="stream-card-elapsed">{elapsed}</span>
        <span className="stream-card-play">
          <Play size={26} fill="currentColor" />
        </span>
      </span>
      <span className="stream-card-body">
        <Avatar user={owner} size={40} />
        <span className="stream-card-text">
          <strong className="stream-card-title">{stream.title || 'Трансляция'}</strong>
          <span className="stream-card-owner">
            {owner.displayName || owner.username || 'Стример'}
            {mine ? ' · это вы' : ''}
          </span>
          <span className="stream-card-meta">
            <span>
              {stream.source === 'both' ? (
                <MonitorPlay size={12} />
              ) : stream.source === 'screen' ? (
                <Monitor size={12} />
              ) : (
                <Camera size={12} />
              )}
              {sourceShortLabel(stream.source)}
            </span>
            <span>
              {stream.mode === 'link' ? <Link2 size={12} /> : <Cast size={12} />}
              {modeLabel(stream.mode)}
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}

function StreamerBanner({ stream }) {
  const setActive = useApp((state) => state.setActive);
  const setMobilePanel = useApp((state) => state.setMobilePanel);
  const elapsed = useElapsed(stream.createdAt);

  return (
    <div className="streamer-banner">
      {stream.preview ? <img className="streamer-banner-bg" src={stream.preview} alt="" /> : null}
      <div className="streamer-banner-content">
        <span className="streamer-banner-icon">
          <Radio size={22} />
        </span>
        <div className="streamer-banner-text">
          <span className="streamer-banner-label">Вы в эфире</span>
          <strong>{stream.title || 'Трансляция'}</strong>
          <span className="streamer-banner-meta">
            <span className="live-dot" />
            LIVE
            <span className="streamer-banner-sep" />
            {elapsed}
            <span className="streamer-banner-sep" />
            {viewersLabel(stream.viewers)}
            <span className="streamer-banner-sep" />
            {sourceLabel(stream.source)}
          </span>
        </div>
        <div className="streamer-banner-actions">
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => {
              setActive({ type: 'stream', id: stream.id });
              setMobilePanel(null);
            }}
          >
            <Video size={15} /> Открыть студию
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StreamingView() {
  const streams = useApp((state) => state.streams);
  const myStream = useApp((state) => state.myStream);
  const openModal = useApp((state) => state.openModal);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const live = useMemo(
    () => (streams || []).filter((stream) => stream.live !== false),
    [streams]
  );

  const normalized = query.trim().toLowerCase();

  const visible = useMemo(() => {
    return live.filter((stream) => {
      if (filter !== 'all' && stream.mode !== filter) return false;
      if (!normalized) return true;
      const owner = stream.owner || {};
      return `${stream.title || ''} ${owner.displayName || ''} ${owner.username || ''}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [live, filter, normalized]);

  const filterCounts = useMemo(
    () => ({
      all: live.length,
      app: live.filter((stream) => stream.mode !== 'link').length,
      link: live.filter((stream) => stream.mode === 'link').length,
    }),
    [live]
  );

  const startOrOpen = () => {
    if (myStream) {
      useApp.getState().setActive({ type: 'stream', id: myStream.id });
      return;
    }
    openModal('startStream');
  };

  const hasFilters = Boolean(normalized) || filter !== 'all';

  return (
    <div className="streaming-view">
      <header className="streaming-header">
        <div className="streaming-head-top">
          <div className="streaming-title">
            <span className="streaming-title-icon">
              <Radio size={20} />
            </span>
            <h1>Streaming</h1>
            <span className="streaming-subtitle">
              {live.length > 0 ? liveCountLabel(live.length) : 'Прямые трансляции'}
            </span>
          </div>
          <div className="streaming-head-actions">
            <div className="friends-search streaming-search">
              <Search size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Найти трансляцию…"
                aria-label="Найти трансляцию"
              />
              {query ? (
                <button className="icon-btn tiny" onClick={() => setQuery('')} aria-label="Очистить поиск">
                  <X size={13} />
                </button>
              ) : null}
            </div>
            <button type="button" className="btn btn-primary streaming-go-live" onClick={startOrOpen}>
              {myStream ? <Radio size={16} /> : <Video size={16} />}
              {myStream ? 'К трансляции' : 'В эфир'}
            </button>
          </div>
        </div>
        <div className="friends-tabs streaming-tabs">
          {FILTERS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={cx('friends-tab', filter === item.id && 'active')}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              {filterCounts[item.id] > 0 ? <span className="tab-count">{filterCounts[item.id]}</span> : null}
            </button>
          ))}
        </div>
      </header>

      <div className="streaming-body">
        {myStream ? <StreamerBanner stream={myStream} /> : null}

        {live.length === 0 ? (
          <div className="streaming-empty">
            <div className="streaming-empty-icon">
              <Radio size={46} />
              <span className="streaming-empty-glow" />
            </div>
            <h3>Пока никто не в эфире</h3>
            <p>
              Станьте первым! Покажите камеру, экран или всё сразу — друзья смогут
              смотреть эфир прямо в Carnage Party или по ссылке в любом браузере.
            </p>
            <button type="button" className="btn btn-primary" onClick={startOrOpen}>
              <Video size={16} /> Начать трансляцию
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="streaming-empty compact">
            <div className="streaming-empty-icon small">
              <Search size={30} />
            </div>
            <h3>Ничего не нашли</h3>
            <p>Попробуйте изменить запрос или сбросить фильтр.</p>
            {hasFilters ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                Сбросить фильтры
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="streaming-section-label">
              <span>Сейчас в эфире</span>
              <span className="streaming-section-line" />
              <span className="streaming-section-count">{visible.length}</span>
            </div>
            <div className="stream-grid">
              {visible.map((stream) => (
                <StreamCard key={stream.id} stream={stream} mine={myStream?.id === stream.id} />
              ))}
            </div>
          </>
        )}

        <div className="streaming-info-row">
          <div className="streaming-info-card">
            <span className="streaming-info-icon"><Camera size={20} /></span>
            <div>
              <strong>Камера и экран</strong>
              <span>Покажите монитор или игру, закрепив камеру поверх.</span>
            </div>
          </div>
          <div className="streaming-info-card">
            <span className="streaming-info-icon link"><Link2 size={20} /></span>
            <div>
              <strong>Ссылка для друзей</strong>
              <span>Внешний эфир откроется в браузере без установки программы.</span>
            </div>
          </div>
          <div className="streaming-info-card">
            <span className="streaming-info-icon users"><Users size={20} /></span>
            <div>
              <strong>Зрители в реальном времени</strong>
              <span>Счётчик и превью обновляются прямо во время эфира.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
