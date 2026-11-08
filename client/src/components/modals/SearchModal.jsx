import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Loader2, Search, Volume2 } from 'lucide-react';
import { api } from '../../api';
import { useApp, selectChannel } from '../../store';
import { formatFullDate } from '../../utils';
import Avatar from '../ui/Avatar';
import Modal from '../ui/Modal';

export default function SearchModal() {
  const servers = useApp((state) => state.servers);
  const channels = useApp((state) => state.channels);
  const dms = useApp((state) => state.dms);
  const closeModal = useApp((state) => state.closeModal);
  const setActive = useApp((state) => state.setActive);
  const setPendingJump = useApp((state) => state.setPendingJump);
  const [query, setQuery] = useState('');
  const [serverId, setServerId] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      setLoading(false);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: query.trim() });
        if (serverId) params.set('serverId', serverId);
        const data = await api(`/api/search?${params.toString()}`);
        setResults(data.results || []);
        setActiveIndex(0);
      } catch (err) {
        useApp.getState().toast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [query, serverId]);

  const channelMatches = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return [];
    return channels
      .filter((channel) => !serverId || channel.serverId === serverId)
      .filter((channel) => channel.name.toLowerCase().includes(value))
      .slice(0, 6);
  }, [channels, query, serverId]);

  const jump = (message) => {
    closeModal();
    setPendingJump(message.channelId, message.id);
  };

  const openChannel = (channelId) => {
    closeModal();
    const channel = selectChannel({ channels, dms }, channelId);
    if (channel) setActive({ type: 'channel', id: channelId });
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') closeModal();
    if (!results?.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(results.length - 1, index + 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const result = results[activeIndex];
      if (result) jump(result.message);
    }
  };

  return (
    <Modal onClose={closeModal} className="search-modal" overlayClassName="search-overlay">
      <div className="search-modal-head">
        <Search size={20} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Поиск по сообщениям и каналам…"
        />
        {loading ? <Loader2 size={18} className="spin" /> : null}
        <kbd>Esc</kbd>
      </div>
      <div className="search-filters">
        <button className={!serverId ? 'active' : ''} onClick={() => setServerId('')}>Везде</button>
        {servers.map((server) => (
          <button
            key={server.id}
            className={serverId === server.id ? 'active' : ''}
            onClick={() => setServerId(server.id)}
          >
            {server.name}
          </button>
        ))}
      </div>
      <div className="search-modal-body">
        {!query.trim() ? (
          <div className="search-hint">
            <Search size={30} />
            <p>Введите запрос, чтобы найти сообщения, каналы и людей.</p>
            <div className="search-shortcuts">
              <span><kbd>↑</kbd><kbd>↓</kbd> навигация</span>
              <span><kbd>Enter</kbd> перейти</span>
              <span><kbd>Ctrl</kbd> + <kbd>K</kbd> поиск</span>
            </div>
          </div>
        ) : null}

        {channelMatches.length ? (
          <div className="search-section">
            <div className="search-section-title">Каналы</div>
            {channelMatches.map((channel) => (
              <button key={channel.id} className="search-channel-row" onClick={() => openChannel(channel.id)}>
                <span className="search-channel-icon">
                  {channel.type === 'voice' ? <Volume2 size={16} /> : <Hash size={16} />}
                </span>
                <span>{channel.name}</span>
                <small>{servers.find((server) => server.id === channel.serverId)?.name}</small>
              </button>
            ))}
          </div>
        ) : null}

        {results ? (
          <div className="search-section">
            <div className="search-section-title">
              Сообщения {results.length ? `— ${results.length}` : ''}
            </div>
            {results.length === 0 ? (
              <div className="search-empty">Ничего не найдено{qwerySafe(query)}</div>
            ) : (
              results.map((result, index) => (
                <button
                  key={result.message.id}
                  className={`search-result ${index === activeIndex ? 'active' : ''}`}
                  onClick={() => jump(result.message)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <Avatar user={result.message.author} size={30} />
                  <div className="search-result-body">
                    <div className="search-result-head">
                      <strong>{result.message.author?.displayName}</strong>
                      <span className="search-result-channel">
                        {result.channel.serverName ? `${result.channel.serverName} · ` : ''}
                        #{result.channel.name}
                      </span>
                      <time>{formatFullDate(result.message.createdAt)}</time>
                    </div>
                    <p>{result.message.content || 'Вложение'}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function qwerySafe(value) {
  return value ? ` по запросу «${value}»` : '';
}
