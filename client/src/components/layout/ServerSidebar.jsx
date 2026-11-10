import React, { useMemo, useState } from 'react';
import {
  Ban,
  Camera,
  ChevronDown,
  ChevronRight,
  Hash,
  MessageSquare,
  MicOff,
  Music2,
  Plus,
  Settings,
  Trash2,
  UserCog,
  UserMinus,
  UserPlus,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { api } from '../../api';
import { useApp, selectChannel } from '../../store';
import { hasPermission } from '../../constants';
import { cx } from '../../utils';
import Avatar from '../ui/Avatar';
import ContextMenu from '../ui/ContextMenu';
import UserPanel from './UserPanel';
import VoiceDock from './VoiceDock';
import { voiceManager } from '../../voice';

export default function ServerSidebar() {
  const active = useApp((state) => state.active);
  const servers = useApp((state) => state.servers);
  const channels = useApp((state) => state.channels);
  const voiceStates = useApp((state) => state.voiceStates);
  const voice = useApp((state) => state.voice);
  const unread = useApp((state) => state.unread);
  const mentions = useApp((state) => state.mentions);
  const streams = useApp((state) => state.streams);
  const user = useApp((state) => state.user);
  const setActive = useApp((state) => state.setActive);
  const openModal = useApp((state) => state.openModal);
  const setMobilePanel = useApp((state) => state.setMobilePanel);
  const removeServer = useApp((state) => state.removeServer);
  const settings = useApp((state) => state.settings);
  const updateSettings = useApp((state) => state.updateSettings);
  const [collapsed, setCollapsed] = useState({});
  const [menu, setMenu] = useState(null);
  const [channelMenu, setChannelMenu] = useState(null);
  const [voiceMenu, setVoiceMenu] = useState(null);

  const channel = active?.type === 'channel' ? selectChannel({ channels, dms: [] }, active.id) : null;
  const server = useMemo(
    () => (channel?.serverId ? servers.find((s) => s.id === channel.serverId) : null),
    [channel?.serverId, servers]
  );

  if (!server) return null;

  const canManageChannels = hasPermission(server, user?.id, 'MANAGE_CHANNELS');
  const canManageServer = hasPermission(server, user?.id, 'MANAGE_SERVER');
  const canKick = hasPermission(server, user?.id, 'KICK_MEMBERS');
  const canBan = hasPermission(server, user?.id, 'BAN_MEMBERS');
  const canMute = hasPermission(server, user?.id, 'MUTE_MEMBERS');
  const isOwner = server.ownerId === user?.id;
  const mutedUsers = settings.mutedUsers || [];

  const list = channels
    .filter((c) => c.serverId === server.id)
    .sort((a, b) => (a.position || 0) - (b.position || 0));

  const liveChannelIds = new Set(
    (streams || [])
      .filter((stream) => stream.live !== false && stream.channelId)
      .map((stream) => stream.channelId)
  );

  const categories = [];
  const byCategory = new Map();
  for (const item of list) {
    const key = item.category || (item.type === 'voice' ? 'Голосовые каналы' : 'Текстовые каналы');
    if (!byCategory.has(key)) {
      byCategory.set(key, []);
      categories.push(key);
    }
    byCategory.get(key).push(item);
  }

  const openServerMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom + 6 });
  };

  const openChannelMenu = (event, item) => {
    event.preventDefault();
    event.stopPropagation();
    setChannelMenu({ x: event.clientX, y: event.clientY, channel: item });
  };

  const joinVoice = (item) => {
    setActive({ type: 'channel', id: item.id });
    setMobilePanel(null);
    voiceManager.join(item.id);
  };

  const leaveServer = async () => {
    try {
      await api(`/api/servers/${server.id}/leave`, { method: 'POST' });
    } catch (err) {
      useApp.getState().toast(err.message, 'error');
    }
  };

  const deleteServer = () =>
    openModal('confirm', {
      title: 'Удалить сервер навсегда?',
      text: `Сервер «${server.name}», все каналы, боты и сообщения будут удалены без возможности восстановления.`,
      confirmText: 'Удалить сервер',
      danger: true,
      onConfirm: async () => {
        try {
          await api(`/api/servers/${server.id}`, { method: 'DELETE' });
          removeServer(server.id);
          setActive({ type: 'friends' });
          useApp.getState().toast('Сервер удалён', 'info');
        } catch (err) {
          useApp.getState().toast(err.message, 'error');
        }
      },
    });

  const setVoiceMuted = async (memberId, muted) => {
    try {
      await api(`/api/servers/${server.id}/members/${memberId}/voice-mute`, {
        method: 'POST',
        body: { muted },
      });
      useApp
        .getState()
        .toast(muted ? 'Участник заглушён в голосе' : 'Участнику разрешено говорить', 'success');
    } catch (err) {
      useApp.getState().toast(err.message, 'error');
    }
  };

  const toggleLocalMute = (userId) => {
    const next = mutedUsers.includes(userId)
      ? mutedUsers.filter((id) => id !== userId)
      : [...mutedUsers, userId];
    updateSettings({ mutedUsers: next });
  };

  const kickMember = (participant) =>
    openModal('confirm', {
      title: 'Исключить участника?',
      text: `${participant.user?.displayName || 'Участник'} будет удалён с сервера и отключён от голосового канала.`,
      confirmText: 'Исключить',
      danger: true,
      onConfirm: async () => {
        try {
          await api(`/api/servers/${server.id}/members/${participant.userId}`, {
            method: 'DELETE',
          });
          useApp.getState().toast('Участник исключён', 'success');
        } catch (err) {
          useApp.getState().toast(err.message, 'error');
        }
      },
    });

  const openVoiceMenu = (event, participant, channelId) => {
    event.preventDefault();
    event.stopPropagation();
    setVoiceMenu({
      x: event.clientX,
      y: event.clientY,
      participant,
      channelId,
    });
  };

  const openVoiceParticipant = (participant, channelId) => {
    if (participant.bot || participant.user?.bot) {
      openModal('musicBot', { channelId, serverId: server.id });
      return;
    }
    openModal('profile', { userId: participant.userId });
  };

  const serverMenuItems = [
    { label: 'Пригласить на сервер', icon: <UserPlus size={16} />, onClick: () => openModal('invite', { serverId: server.id }) },
    (canManageServer || hasPermission(server, user?.id, 'MANAGE_ROLES') || canManageChannels)
      ? { label: 'Настройки сервера', icon: <Settings size={16} />, onClick: () => openModal('serverSettings', { serverId: server.id }) }
      : null,
    canManageServer
      ? { label: 'Сменить иконку', icon: <Camera size={16} />, onClick: () => openModal('serverSettings', { serverId: server.id }) }
      : null,
    canManageChannels
      ? { label: 'Создать канал', icon: <Plus size={16} />, onClick: () => openModal('channelSettings', { serverId: server.id, create: true }) }
      : null,
    'separator',
    isOwner
      ? {
          label: 'Удалить сервер',
          icon: <Trash2 size={16} />,
          danger: true,
          onClick: deleteServer,
        }
      : {
          label: 'Покинуть сервер',
          icon: <UserPlus size={16} style={{ transform: 'rotate(180deg)' }} />,
          danger: true,
          onClick: () =>
            openModal('confirm', {
              title: 'Покинуть сервер?',
              text: `Вы действительно хотите покинуть «${server.name}»? Вернуться можно будет по новому приглашению.`,
              confirmText: 'Покинуть',
              danger: true,
              onConfirm: leaveServer,
            }),
        },
  ].filter(Boolean);

  const channelMenuItems = channelMenu
    ? [
        channelMenu.channel.type === 'voice'
          ? {
              label: 'Присоединиться к голосу',
              icon: <Volume2 size={16} />,
              onClick: () => joinVoice(channelMenu.channel),
            }
          : null,
        canManageChannels
          ? {
              label: 'Настройки канала',
              icon: <Settings size={16} />,
              onClick: () => openModal('channelSettings', { serverId: server.id, channelId: channelMenu.channel.id }),
            }
          : null,
        canManageChannels
          ? {
              label: 'Удалить канал',
              icon: <Trash2 size={16} />,
              danger: true,
              onClick: () =>
                openModal('confirm', {
                  title: 'Удалить канал?',
                  text: `Канал «${channelMenu.channel.name}» и вся его история будут удалены безвозвратно.`,
                  confirmText: 'Удалить',
                  danger: true,
                  onConfirm: async () => {
                    const { api } = await import('../../api');
                    await api(`/api/channels/${channelMenu.channel.id}`, { method: 'DELETE' });
                  },
                }),
            }
          : null,
      ].filter(Boolean)
    : [];

  const voiceMenuItems = (() => {
    if (!voiceMenu) return [];
    const participant = voiceMenu.participant;
    const isBot = Boolean(participant.bot || participant.user?.bot);
    const isSelf = participant.userId === user?.id;
    const isOwnerTarget = participant.userId === server.ownerId;
    const member = (server.members || []).find((item) => item.id === participant.userId);
    const serverMuted = Boolean(member?.voiceMuted ?? participant.serverMuted);
    const locallyMuted = mutedUsers.includes(participant.userId);

    return [
      isBot
        ? {
            label: 'Музыкальный бот',
            icon: <Music2 size={16} />,
            onClick: () => openModal('musicBot', { channelId: voiceMenu.channelId, serverId: server.id }),
          }
        : {
            label: 'Открыть профиль',
            icon: <UserCog size={16} />,
            onClick: () => openModal('profile', { userId: participant.userId }),
          },
      !isBot && !isSelf
        ? {
            label: 'Написать сообщение',
            icon: <MessageSquare size={16} />,
            onClick: async () => {
              try {
                const data = await api('/api/dms', { method: 'POST', body: { userId: participant.userId } });
                if (data?.channel) {
                  useApp.getState().addChannel(data.channel);
                  setActive({ type: 'channel', id: data.channel.id });
                  setMobilePanel(null);
                }
              } catch (err) {
                useApp.getState().toast(err.message, 'error');
              }
            },
          }
        : null,
      canMute && !isBot && !isSelf && !isOwnerTarget
        ? {
            label: serverMuted ? 'Разрешить говорить' : 'Заглушить в голосе',
            icon: serverMuted ? <Volume2 size={16} /> : <MicOff size={16} />,
            onClick: () => setVoiceMuted(participant.userId, !serverMuted),
          }
        : null,
      !isBot && !isSelf
        ? {
            label: locallyMuted ? 'Включить звук для себя' : 'Заглушить для себя',
            icon: locallyMuted ? <Volume2 size={16} /> : <VolumeX size={16} />,
            onClick: () => toggleLocalMute(participant.userId),
          }
        : null,
      canKick && !isBot && !isSelf && !isOwnerTarget
        ? {
            label: 'Исключить с сервера',
            icon: <UserMinus size={16} />,
            danger: true,
            onClick: () => kickMember(participant),
          }
        : null,
      canBan && !isBot && !isSelf && !isOwnerTarget
        ? {
            label: 'Забанить',
            icon: <Ban size={16} />,
            danger: true,
            onClick: () => openModal('banMember', { serverId: server.id, userId: participant.userId }),
          }
        : null,
    ].filter(Boolean);
  })();

  return (
    <aside className="sidebar server-sidebar">
      <button className="sidebar-header server-header" onClick={openServerMenu}>
        <span className="server-title">{server.name}</span>
        <ChevronDown size={18} />
      </button>
      <div className="sidebar-scroll channels-scroll">
        {categories.map((category) => {
          const isCollapsed = collapsed[category];
          return (
            <div className="channel-category" key={category}>
              <div className="category-header">
                <button
                  className="category-toggle"
                  onClick={() => setCollapsed((prev) => ({ ...prev, [category]: !prev[category] }))}
                >
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <span>{category}</span>
                </button>
                {canManageChannels ? (
                  <button
                    className="icon-btn tiny"
                    aria-label={`Создать канал в ${category}`}
                    onClick={() => openModal('channelSettings', { serverId: server.id, create: true, category })}
                  >
                    <Plus size={14} />
                  </button>
                ) : null}
              </div>
              {!isCollapsed ? (
                <div className="channel-list">
                  {byCategory.get(category).map((item) => {
                    const isActive = active?.type === 'channel' && active.id === item.id;
                    const count = unread[item.id] || 0;
                    const mentionCount = mentions[item.id] || 0;
                    const participants = voiceStates[item.id] || [];
                    const connected = voice.channelId === item.id && voice.joined;
                    const hasStream = liveChannelIds.has(item.id);
                    return (
                      <div key={item.id}>
                        <button
                          className={cx(
                            'channel-row',
                            isActive && 'active',
                            count > 0 && 'unread',
                            item.type === 'voice' && connected && 'voice-connected',
                            hasStream && 'has-stream'
                          )}
                          onClick={() => {
                            if (item.type === 'voice') joinVoice(item);
                            else {
                              setActive({ type: 'channel', id: item.id });
                              setMobilePanel(null);
                            }
                          }}
                          onContextMenu={(event) => openChannelMenu(event, item)}
                        >
                          {item.type === 'voice' ? <Volume2 size={18} /> : <Hash size={18} />}
                          <span className="channel-name">{item.name}</span>
                          {hasStream ? (
                            <span
                              className="channel-live-dot"
                              title="В канале идёт трансляция"
                            />
                          ) : null}
                          {mentionCount > 0 ? (
                            <span className="channel-badge mention-badge">{mentionCount}</span>
                          ) : count > 0 ? (
                            <span className="channel-unread-dot" />
                          ) : null}
                          {canManageChannels ? (
                            <span
                              className="channel-edit"
                              role="button"
                              tabIndex={-1}
                              onClick={(event) => openChannelMenu(event, item)}
                              title="Настройки канала"
                            >
                              <Settings size={13} />
                            </span>
                          ) : null}
                        </button>
                        {item.type === 'voice' && participants.length > 0 ? (
                          <div className="voice-participants">
                            {participants.map((participant) => {
                              const isLocallyMuted = mutedUsers.includes(participant.userId);
                              return (
                                <button
                                  type="button"
                                  className={cx(
                                    'voice-participant',
                                    participant.userId === user?.id && 'is-self',
                                    isLocallyMuted && 'locally-muted'
                                  )}
                                  key={participant.userId}
                                  onClick={() => openVoiceParticipant(participant, item.id)}
                                  onContextMenu={(event) => openVoiceMenu(event, participant, item.id)}
                                  title={`${participant.user?.displayName || 'Участник'} — нажмите для действий`}
                                >
                                  <Avatar
                                    user={participant.user}
                                    size={22}
                                    showStatus
                                    status="online"
                                    className={cx('mini-avatar', participant.speaking && 'speaking')}
                                  />
                                  <span className={cx('voice-name', participant.speaking && 'speaking-text')}>
                                    {participant.user?.displayName}
                                  </span>
                                  {participant.serverMuted ? (
                                    <span className="voice-muted-icon" title="Заглушён администратором">
                                      <MicOff size={13} />
                                    </span>
                                  ) : participant.muted ? (
                                    <svg className="voice-muted-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M9 9v3a3 3 0 0 0 4.6 2.5M15 9V5a3 3 0 0 0-5.7-1.3" />
                                      <path d="M17 16.9A7 7 0 0 1 5 12v-2m7-6a3 3 0 0 1 5 1.5" />
                                      <path d="m2 2 20 20" />
                                    </svg>
                                  ) : null}
                                  {isLocallyMuted ? (
                                    <span className="voice-muted-icon" title="Заглушён для вас">
                                      <VolumeX size={13} />
                                    </span>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
        {categories.length === 0 ? (
          <div className="sidebar-empty">
            На сервере пока нет каналов.
            {canManageChannels ? (
              <button className="btn btn-secondary btn-small" onClick={() => openModal('channelSettings', { serverId: server.id, create: true })}>
                Создать канал
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <VoiceDock />
      <UserPanel />
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={serverMenuItems} onClose={() => setMenu(null)} /> : null}
      {channelMenu ? (
        <ContextMenu x={channelMenu.x} y={channelMenu.y} items={channelMenuItems} onClose={() => setChannelMenu(null)} />
      ) : null}
      {voiceMenu ? (
        <ContextMenu x={voiceMenu.x} y={voiceMenu.y} items={voiceMenuItems} onClose={() => setVoiceMenu(null)} />
      ) : null}
    </aside>
  );
}
