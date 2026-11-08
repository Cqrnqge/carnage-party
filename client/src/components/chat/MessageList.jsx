import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Bookmark, Hash, Loader2, MessageSquare, Phone, RefreshCw, Users, Volume2 } from 'lucide-react';
import { useApp } from '../../store';
import { dmOther } from '../../constants';
import { cx, formatDay } from '../../utils';
import Avatar, { ChannelIcon } from '../ui/Avatar';
import MessageItem from './MessageItem';

const GROUP_WINDOW = 5 * 60 * 1000;
const BOTTOM_THRESHOLD = 140;

// Стабильные ссылки: селектор Zustand не должен возвращать новый объект/массив
// на каждом вызове, иначе useSyncExternalStore уходит в бесконечный цикл.
const EMPTY_MESSAGES = Object.freeze([]);
const EMPTY_META = Object.freeze({});
const EMPTY_TYPING = Object.freeze([]);

export default function MessageList({ channel, server }) {
  const messages = useApp((state) => state.messages[channel?.id] ?? EMPTY_MESSAGES);
  const meta = useApp((state) => state.messageState[channel?.id] ?? EMPTY_META);
  const typing = useApp((state) => state.typing[channel?.id] ?? EMPTY_TYPING);
  const pendingJump = useApp((state) => state.pendingJump);
  const me = useApp((state) => state.user);
  const loadMessages = useApp((state) => state.loadMessages);
  const loadOlder = useApp((state) => state.loadOlder);
  const loadAround = useApp((state) => state.loadAround);
  const markChannelRead = useApp((state) => state.markChannelRead);
  const clearPendingJump = useApp((state) => state.clearPendingJump);
  const openModal = useApp((state) => state.openModal);

  const scrollRef = useRef(null);
  const stickToBottom = useRef(true);
  const initialDone = useRef(false);
  const previousLastId = useRef(null);
  const loadingOlder = useRef(false);
  const lastReadPing = useRef(0);
  const [newBelow, setNewBelow] = useState(false);
  const [jumping, setJumping] = useState(false);

  const channelId = channel?.id;
  const other = channel?.type === 'dm' ? dmOther(channel, me?.id) : null;
  const messageCount = messages.length;

  const scrollToBottom = (behavior = 'auto') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    stickToBottom.current = true;
    setNewBelow(false);
  };

  useEffect(() => {
    initialDone.current = false;
    stickToBottom.current = true;
    previousLastId.current = null;
    setNewBelow(false);
    if (!channelId) return;
    if (!meta.loaded && !meta.loading) loadMessages(channelId, { limit: 60, force: true });
  }, [channelId]);

  useEffect(() => {
    if (!channelId || !meta.loaded || initialDone.current) return;
    initialDone.current = true;
    previousLastId.current = messages[messages.length - 1]?.id || null;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      markChannelRead(channelId);
    });
  }, [meta.loaded, channelId, messageCount]);

  const lastId = messages[messages.length - 1]?.id;

  useEffect(() => {
    if (!channelId || !initialDone.current) return;
    if (!previousLastId.current) {
      previousLastId.current = lastId || null;
      return;
    }
    if (lastId && lastId !== previousLastId.current && !loadingOlder.current) {
      const el = scrollRef.current;
      const nearBottom =
        !el || el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD || stickToBottom.current;
      if (nearBottom) {
        requestAnimationFrame(() => scrollToBottom('smooth'));
        const now = Date.now();
        if (now - lastReadPing.current > 900) {
          lastReadPing.current = now;
          markChannelRead(channelId);
        }
      } else {
        setNewBelow(true);
      }
    }
    previousLastId.current = lastId || null;
  }, [lastId, channelId]);

  useEffect(() => {
    if (!pendingJump || pendingJump.channelId !== channelId) return undefined;
    let cancelled = false;
    const run = async () => {
      let list = useApp.getState().messages[channelId] || [];
      if (!list.some((message) => message.id === pendingJump.messageId)) {
        setJumping(true);
        await loadAround(channelId, pendingJump.messageId);
        list = useApp.getState().messages[channelId] || [];
        if (cancelled) return;
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = document.getElementById(`message-${pendingJump.messageId}`);
          if (el) {
            el.scrollIntoView({ block: 'center', behavior: 'auto' });
            stickToBottom.current = false;
          }
          setJumping(false);
          clearPendingJump();
        });
      });
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [pendingJump?.channelId, pendingJump?.messageId, channelId]);

  const handleScroll = (event) => {
    const el = event.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
    stickToBottom.current = nearBottom;
    if (nearBottom) {
      if (newBelow) setNewBelow(false);
      const now = Date.now();
      if (now - lastReadPing.current > 2200) {
        lastReadPing.current = now;
        markChannelRead(channelId);
      }
    }
    if (el.scrollTop < 180 && meta.hasMore && !meta.loading && !loadingOlder.current) {
      loadingOlder.current = true;
      const prevHeight = el.scrollHeight;
      const prevTop = el.scrollTop;
      loadOlder(channelId).finally(() => {
        loadingOlder.current = false;
        requestAnimationFrame(() => {
          const node = scrollRef.current;
          if (!node) return;
          node.scrollTop = node.scrollHeight - prevHeight + prevTop;
        });
      });
    }
  };

  const rendered = useMemo(() => {
    const out = [];
    let lastDayLabel = null;
    messages.forEach((message, index) => {
      const dayLabel = formatDay(message.createdAt);
      if (dayLabel !== lastDayLabel) {
        lastDayLabel = dayLabel;
        out.push(
          <div className="day-divider" key={`day-${message.id}`}>
            <span>{dayLabel}</span>
          </div>
        );
      }
      const prev = messages[index - 1];
      const sameDay = prev && formatDay(prev.createdAt) === dayLabel;
      const grouped =
        Boolean(prev) &&
        sameDay &&
        prev.author?.id === message.author?.id &&
        !prev.system &&
        !message.system &&
        !message.replyTo &&
        new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW;
      out.push(
        <MessageItem
          key={message.id}
          message={message}
          channel={channel}
          server={server}
          grouped={grouped}
          onJump={(messageId) => useApp.getState().setPendingJump(channelId, messageId)}
        />
      );
    });
    return out;
  }, [messages, channel, server, channelId]);

  const typingNames = typing.map((user) => user.displayName || user.username).filter(Boolean);

  if (!channel) return null;

  return (
    <div className="message-list-wrap">
      <div className="message-list" ref={scrollRef} onScroll={handleScroll}>
        {meta.loading && messages.length === 0 ? (
          <div className="message-loading">
            <Loader2 size={22} className="spin" />
            <span>Загружаем сообщения…</span>
          </div>
        ) : null}

        {meta.error && messages.length === 0 ? (
          <div className="message-error">
            <p>{meta.error}</p>
            <button className="btn btn-secondary btn-small" onClick={() => loadMessages(channelId, { force: true })}>
              <RefreshCw size={15} /> Повторить
            </button>
          </div>
        ) : null}

        {!meta.loading && !meta.error && messages.length === 0 ? (
          <div className="channel-intro">
            {channel.saved ? (
              <span className="intro-icon intro-saved"><Bookmark size={40} /></span>
            ) : channel.type === 'dm' ? (
              <Avatar user={other} size={78} />
            ) : channel.type === 'voice' ? (
              <span className="intro-icon"><Volume2 size={42} /></span>
            ) : (
              <span className="intro-icon"><Hash size={42} /></span>
            )}
            <h1>
              {channel.saved
                ? 'Избранное'
                : channel.type === 'dm'
                  ? other?.displayName || 'Личные сообщения'
                  : `Добро пожаловать в #${channel.name}`}
            </h1>
            <p>
              {channel.saved
                ? 'Ваши личные заметки, ссылки и сохранённые сообщения. Это видите только вы.'
                : channel.type === 'dm'
                  ? `Это начало вашей истории с ${other?.displayName || 'пользователем'}. Скажите привет!`
                  : channel.topic || 'Это начало канала. Отправьте первое сообщение — и общение начнётся.'}
            </p>
            {channel.type === 'dm' && !channel.saved && other ? (
              <div className="channel-intro-actions">
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => openModal('profile', { userId: other.id })}
                >
                  <Users size={15} /> Профиль
                </button>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={async () => {
                    const { voiceManager } = await import('../../voice');
                    useApp.getState().setActive({ type: 'channel', id: channel.id });
                    voiceManager.join(channel.id);
                    const { getSocket } = await import('../../socket');
                    getSocket()?.emit('call:invite', { channelId: channel.id });
                  }}
                >
                  <Phone size={15} /> Позвонить
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {meta.hasMore ? (
          <div className="load-older">
            {meta.loading ? <Loader2 size={15} className="spin" /> : <span>Прокрутите выше, чтобы загрузить историю</span>}
          </div>
        ) : messages.length > 0 ? (
          <div className="channel-start">
            {channel.saved ? <Bookmark size={17} /> : channel.type === 'dm' ? <MessageSquare size={17} /> : <ChannelIcon type={channel.type} size={17} />}
            <span>
              {channel.saved
                ? 'Личные заметки'
                : channel.type === 'dm'
                  ? `Начало переписки с ${other?.displayName || 'пользователем'}`
                  : `Начало канала #${channel.name}`}
            </span>
          </div>
        ) : null}

        <div className="messages">{rendered}</div>

        {typingNames.length ? (
          <div className="typing-row">
            <span className="typing-dots"><i /><i /><i /></span>
            <span>
              {typingNames.slice(0, 3).join(', ')}
              {typingNames.length > 3 ? ` и ещё ${typingNames.length - 3}` : ''}{' '}
              {typingNames.length === 1 ? 'печатает' : 'печатают'}…
            </span>
          </div>
        ) : null}

        {jumping ? (
          <div className="jump-loading">
            <Loader2 size={16} className="spin" /> Переходим к сообщению…
          </div>
        ) : null}
      </div>

      {newBelow ? (
        <button className="new-messages-pill" onClick={() => { scrollToBottom('smooth'); markChannelRead(channelId); }}>
          <ArrowDown size={15} /> Новые сообщения
        </button>
      ) : null}
    </div>
  );
}
