import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  Bookmark,
  Hash,
  Loader2,
  Menu,
  MessageSquare,
  Monitor,
  MoreVertical,
  Paperclip,
  Phone,
  Pin,
  Radio,
  Search,
  Settings,
  UserPlus,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { api } from '../../api';
import { useApp, channelSubtitle, channelTitle } from '../../store';
import { dmOther, hasPermission } from '../../constants';
import { cx, formatTime } from '../../utils';
import Avatar, { ChannelIcon } from '../ui/Avatar';
import ContextMenu from '../ui/ContextMenu';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import MemberList from './MemberList';
import VoiceStage from '../voice/VoiceStage';
import ChannelStreamBanner from '../streaming/ChannelStreamBanner';
import { voiceManager } from '../../voice';
import { useMobileClient } from '../../mobile';

function VoiceChannelLanding({ channel }) {
  const voice = useApp((state) => state.voice);
  const voiceStates = useApp((state) => state.voiceStates);
  const user = useApp((state) => state.user);
  const setVoice = useApp((state) => state.setVoice);
  const participants = voiceStates[channel.id] || [];
  const connected = voice.channelId === channel.id && voice.joined;
  const connecting = voice.channelId === channel.id && voice.connecting;

  return (
    <div className="voice-landing">
      <div className="voice-landing-main">
        <div className="voice-landing-icon"><Volume2 size={26} /></div>
        <div className="voice-landing-text">
          <h2>{channel.name}</h2>
          <p>{channel.topic || 'Голосовая комната. Заходите и общайтесь вживую.'}</p>
          <span className="voice-landing-count">
            {participants.length ? `${participants.length} в комнате` : 'Пока никого нет'}
            {channel.userLimit ? ` · лимит ${channel.userLimit}` : ''}
          </span>
        </div>
        <div className="voice-landing-action">
          {connected ? (
            <button className="btn btn-secondary" onClick={() => setVoice({ stageOpen: true })}>
              <Volume2 size={17} /> Открыть комнату
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => voiceManager.join(channel.id)} disabled={connecting}>
              {connecting ? <Loader2 size={17} className="spin" /> : <Volume2 size={17} />}
              {connecting ? 'Подключаемся…' : 'Присоединиться'}
            </button>
          )}
        </div>
      </div>
      {participants.length ? (
        <div className="voice-landing-people">
          {participants.map((participant) => (
            <div className={cx('voice-landing-person', participant.speaking && 'speaking')} key={participant.userId}>
              <Avatar user={participant.user} size={34} />
              <span>{participant.user?.displayName}{participant.userId === user?.id ? ' (вы)' : ''}</span>
              {participant.muted ? <span className="muted-flag">выкл. микро</span> : null}
              {participant.screen ? <span className="screen-flag">экран</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ChatArea({ channel, server }) {
  const user = useApp((state) => state.user);
  const presence = useApp((state) => state.presence);
  const settings = useApp((state) => state.settings);
  const openModal = useApp((state) => state.openModal);
  const toggleMembers = useApp((state) => state.toggleMembers);
  const setPendingJump = useApp((state) => state.setPendingJump);
  const setActive = useApp((state) => state.setActive);
  const toast = useApp((state) => state.toast);
  const markChannelRead = useApp((state) => state.markChannelRead);
  const voice = useApp((state) => state.voice);
  const voiceStates = useApp((state) => state.voiceStates);
  const setVoice = useApp((state) => state.setVoice);
  const setMobilePanel = useApp((state) => state.setMobilePanel);
  const mobile = useMobileClient();

  const [mobileMembersOpen, setMobileMembersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const searchRef = useRef(null);
  const messageInputRef = useRef(null);
  const dragCounter = useRef(0);

  const isVoice = channel?.type === 'voice';
  const isDm = channel?.type === 'dm';
  const isSaved = Boolean(channel?.saved);
  const other = isDm ? dmOther(channel, user?.id) : null;
  const status = other ? presence[other.id] || other.status || 'offline' : null;
  const canManage = !isDm && server ? hasPermission(server, user?.id, 'MANAGE_CHANNELS') : false;
  const canInvite = !isDm && server;
  const title = channelTitle({ user }, channel);
  const voiceRoom = Boolean(
    channel && voice.channelId === channel.id && (voice.joined || voice.connecting)
  );
  const stageOpen = voiceRoom && voice.stageOpen;
  const voiceParticipants = channel ? voiceStates[channel.id] || [] : [];
  const hasScreen = voiceParticipants.some((participant) => participant.screen) || Boolean(voice.screen);
  const voiceCount = voiceParticipants.length || (voice.joined ? 1 : 0);
  const screenSharer = voiceParticipants.find((participant) => participant.screen)?.user?.displayName;

  useEffect(() => {
    setSearchOpen(false);
    setSearchValue('');
    setSearchResults(null);
    setMenu(null);
    setMobileMembersOpen(false);
  }, [channel?.id]);

  const membersVisible = mobile ? mobileMembersOpen : settings.showMembers;
  const toggleMembersView = () => {
    if (mobile) setMobileMembersOpen((value) => !value);
    else toggleMembers();
  };

  useEffect(() => {
    if (!searchOpen) return undefined;
    const onDown = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [searchOpen]);

  const runSearch = async (event) => {
    event?.preventDefault();
    const query = searchValue.trim();
    if (!query) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const data = await api(`/api/search?channelId=${encodeURIComponent(channel.id)}&q=${encodeURIComponent(query)}`);
      setSearchResults(data.results || []);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSearching(false);
    }
  };

  const menuItems = useMemo(() => {
    if (!channel) return [];
    const items = [];
    if (isDm) {
      if (other) {
        items.push({
          label: 'Открыть профиль',
          icon: <Users size={16} />,
          onClick: () => openModal('profile', { userId: other.id }),
        });
        items.push({
          label: 'Позвонить',
          icon: <Phone size={16} />,
          onClick: async () => {
            markChannelRead(channel.id);
            await voiceManager.join(channel.id);
            const { getSocket } = await import('../../socket');
            getSocket()?.emit('call:invite', { channelId: channel.id });
          },
        });
      }
      if (!isSaved) {
        items.push({
          label: 'Настройки диалога',
          icon: <Settings size={16} />,
          onClick: () => openModal('dmSettings', { channelId: channel.id }),
        });
      }
    } else {
      if (canInvite) {
        items.push({
          label: 'Пригласить на сервер',
          icon: <UserPlus size={16} />,
          onClick: () => openModal('invite', { serverId: server.id }),
        });
      }
      if (canManage) {
        items.push({
          label: 'Настройки канала',
          icon: <Settings size={16} />,
          onClick: () => openModal('channelSettings', { serverId: server.id, channelId: channel.id }),
        });
      }
      items.push('separator');
      items.push({
        label: membersVisible ? 'Скрыть список участников' : 'Показать список участников',
        icon: <Users size={16} />,
        onClick: toggleMembersView,
      });
      items.push({
        label: 'Уведомления канала',
        icon: <Bell size={16} />,
        hint: 'вкл.',
        onClick: () => toast('Уведомления канала включены', 'success'),
      });
    }
    return items;
  }, [channel, isDm, isSaved, other, canInvite, canManage, membersVisible, openModal, toast, server, markChannelRead]);

  const openHeaderMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.right - 210, y: rect.bottom + 6 });
  };

  const isFileDrag = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');

  const onChatDragEnter = (event) => {
    if (stageOpen || !isFileDrag(event)) return;
    event.preventDefault();
    dragCounter.current += 1;
    setDragOver(true);
  };

  const onChatDragOver = (event) => {
    if (stageOpen || !isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const onChatDragLeave = () => {
    if (dragCounter.current <= 0) return;
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setDragOver(false);
  };

  const onChatDrop = (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    if (stageOpen) return;
    messageInputRef.current?.addFiles(event.dataTransfer.files);
  };

  if (!channel) return null;

  return (
    <section
      className="chat-area"
      onDragEnter={onChatDragEnter}
      onDragOver={onChatDragOver}
      onDragLeave={onChatDragLeave}
      onDrop={onChatDrop}
    >
      {dragOver && !stageOpen ? (
        <div className="chat-drop-overlay">
          <Paperclip size={30} />
          <strong>Отпустите файлы, чтобы отправить в чат</strong>
          <span>Видео, музыка, изображения и любые файлы — до 8 штук, максимум 25 МБ каждый</span>
        </div>
      ) : null}
      <header className="chat-header">
        {mobile ? (
          <button
            type="button"
            className="icon-btn mobile-menu-btn"
            onClick={() => setMobilePanel('nav')}
            title="Меню каналов"
            aria-label="Меню каналов"
          >
            <Menu size={21} />
          </button>
        ) : null}
        <div className="chat-title">
          {isSaved ? (
            <span className="chat-title-saved"><Bookmark size={17} /></span>
          ) : isDm ? (
            <Avatar user={other} size={28} showStatus status={status} />
          ) : (
            <ChannelIcon type={channel.type} size={21} />
          )}
          <div className="chat-title-text">
            <h1>{isDm ? title : channel.name}</h1>
            {!isDm && channel.topic ? <span className="chat-topic">{channel.topic}</span> : null}
            {isDm ? (
              <span className="chat-topic">
                {isSaved
                  ? channelSubtitle({ user }, channel)
                  : other
                    ? other.customStatus || (status === 'offline' ? 'Не в сети' : 'В сети')
                    : `${(channel.members || []).length} участника(ов)`}
              </span>
            ) : null}
          </div>
        </div>

        <div className="chat-header-actions">
          {isVoice ? (
            <button
              className="icon-btn"
              onClick={() =>
                openModal('startStream', { channelId: channel.id, channelName: channel.name })
              }
              title="Начать трансляцию в канале"
              aria-label="Начать трансляцию в канале"
            >
              <Radio size={19} />
            </button>
          ) : null}
          {isDm && other ? (
            <button
              className="icon-btn mobile-hide"
              title="Позвонить"
              onClick={async () => {
                await voiceManager.join(channel.id);
                const { getSocket } = await import('../../socket');
                getSocket()?.emit('call:invite', { channelId: channel.id });
              }}
            >
              <Phone size={19} />
            </button>
          ) : null}
          <div className={cx('channel-search', searchOpen && 'open')} ref={searchRef}>
            {searchOpen ? (
              <>
                <form onSubmit={runSearch} className="channel-search-form">
                  <Search size={15} />
                  <input
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="Поиск в канале…"
                    autoFocus
                  />
                  {searching ? <Loader2 size={15} className="spin" /> : null}
                  <button
                    type="button"
                    className="icon-btn tiny"
                    onClick={() => {
                      if (searchValue) {
                        setSearchValue('');
                        setSearchResults(null);
                      } else {
                        setSearchOpen(false);
                      }
                    }}
                    aria-label="Закрыть поиск"
                  >
                    <X size={14} />
                  </button>
                </form>
                {searchResults ? (
                  <div className="search-results">
                    <div className="search-results-head">
                      {searchResults.length ? `Найдено: ${searchResults.length}` : 'Ничего не найдено'}
                    </div>
                    <div className="search-results-scroll">
                      {searchResults.map((result) => (
                        <button
                          key={result.message.id}
                          className="search-result"
                          onClick={() => {
                            setPendingJump(result.message.channelId, result.message.id);
                            setSearchOpen(false);
                            setSearchValue('');
                            setSearchResults(null);
                          }}
                        >
                          <Avatar user={result.message.author} size={28} />
                          <div className="search-result-body">
                            <div className="search-result-head">
                              <strong>{result.message.author?.displayName}</strong>
                              <span>{formatTime(result.message.createdAt)}</span>
                            </div>
                            <p>{result.message.content || 'Вложение'}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <button className="icon-btn" onClick={() => setSearchOpen(true)} title="Поиск в канале">
                <Search size={19} />
              </button>
            )}
          </div>
          <button className="icon-btn mobile-hide" onClick={() => openModal('pins', { channelId: channel.id })} title="Закреплённые сообщения">
            <Pin size={19} />
          </button>
          {!isDm ? (
            <button
              className={cx('icon-btn', membersVisible && 'active')}
              onClick={toggleMembersView}
              title="Список участников"
            >
              <Users size={20} />
            </button>
          ) : null}
          {!isSaved ? (
            <button className="icon-btn" onClick={openHeaderMenu} title="Ещё">
              <MoreVertical size={20} />
            </button>
          ) : null}
        </div>
      </header>

      <div className="chat-content">
        <div className={cx('chat-main', stageOpen && 'chat-main-voice')}>
          <ChannelStreamBanner channelId={channel.id} />
          {voiceRoom ? (
            <div className="voice-room-tabs">
              <div className="voice-room-tab-group">
                <button
                  type="button"
                  className={cx('voice-room-tab', !stageOpen && 'active')}
                  onClick={() => setVoice({ stageOpen: false })}
                >
                  <MessageSquare size={15} />
                  Чат
                </button>
                <button
                  type="button"
                  className={cx('voice-room-tab', stageOpen && 'active')}
                  onClick={() => setVoice({ stageOpen: true })}
                >
                  <Monitor size={15} />
                  {hasScreen ? 'Трансляция' : isDm ? 'Звонок' : 'Комната'}
                  {hasScreen ? <span className="voice-room-live" /> : null}
                  {voiceCount ? <span className="voice-room-count">{voiceCount}</span> : null}
                </button>
              </div>
              {hasScreen && !stageOpen ? (
                <button
                  type="button"
                  className="voice-room-watch"
                  onClick={() => setVoice({ stageOpen: true })}
                  title="Открыть трансляцию"
                >
                  <span className="voice-room-live" />
                  <span className="voice-room-watch-text">
                    {screenSharer ? `${screenSharer} показывает экран` : 'Идёт трансляция'}
                  </span>
                  <span className="voice-room-watch-action">Смотреть</span>
                </button>
              ) : null}
            </div>
          ) : null}
          {stageOpen ? (
            <VoiceStage />
          ) : (
            <>
              {isVoice ? <VoiceChannelLanding channel={channel} /> : null}
              <MessageList channel={channel} server={server} />
              <MessageInput ref={messageInputRef} channel={channel} server={server} />
            </>
          )}
        </div>
        {mobile && membersVisible && !isDm && server ? (
          <button
            type="button"
            className="mobile-sheet-backdrop"
            aria-label="Закрыть список участников"
            onClick={() => setMobileMembersOpen(false)}
          />
        ) : null}
        {!isDm && membersVisible && server ? (
          <MemberList
            server={server}
            channel={channel}
            onClose={mobile ? () => setMobileMembersOpen(false) : undefined}
          />
        ) : null}
      </div>

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} /> : null}
    </section>
  );
}
