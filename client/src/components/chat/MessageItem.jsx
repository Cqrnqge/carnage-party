import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  CheckCheck,
  Copy,
  CornerUpLeft,
  Download,
  FileText,
  Forward,
  Image as ImageIcon,
  MoreHorizontal,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  SmilePlus,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { api, assetUrl } from '../../api';
import { useApp, selectChannel } from '../../store';
import { hasPermission, roleColor } from '../../constants';
import { cx, formatFullDate, formatTime, isAudio, isImage, isVideo } from '../../utils';
import Avatar from '../ui/Avatar';
import RichText from '../ui/RichText';
import ContextMenu from '../ui/ContextMenu';
import EmojiPicker from './EmojiPicker';

function formatDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(value % 60).padStart(2, '0')}`;
}

function VoiceAttachment({ attachment }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(Number(attachment.duration) || 0);

  const bars = useMemo(() => {
    const seed = String(attachment.id || attachment.name || 'voice');
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    }
    return Array.from({ length: 34 }, (_, index) => {
      const value = 7 + ((hash >> (index % 24)) & 15);
      return Math.min(27, value);
    });
  }, [attachment.id, attachment.name]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };

  const duration = total || Number(attachment.duration) || 0;

  return (
    <div className={cx('voice-message', playing && 'playing')}>
      <button
        type="button"
        className="voice-message-play"
        onClick={toggle}
        title={playing ? 'Пауза' : 'Воспроизвести'}
      >
        {playing ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
      </button>
      <div className="voice-message-main">
        <div className="voice-message-wave" aria-hidden="true">
          {bars.map((height, index) => (
            <span
              key={index}
              className={cx('voice-message-bar', progress > index / bars.length && 'played')}
              style={{ height: `${height}px` }}
            />
          ))}
        </div>
        <div className="voice-message-meta">
          <span>{formatDuration(duration)}</span>
          <span>Голосовое сообщение</span>
        </div>
      </div>
      <audio
        ref={audioRef}
        src={assetUrl(attachment.url)}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setTotal(value);
        }}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          const value = total || audio.duration || 0;
          setProgress(value ? audio.currentTime / value : 0);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
      />
    </div>
  );
}

function Attachment({ attachment, onPreview }) {
  const { mime, name, url, size } = attachment;
  const resolvedUrl = assetUrl(url);
  const sizeLabel = size ? `${(size / 1024).toFixed(1)} КБ` : '';
  if (attachment.kind === 'voice') {
    return <VoiceAttachment attachment={attachment} />;
  }
  if (isImage(mime)) {
    return (
      <button className="attachment-image-btn" onClick={() => onPreview({ ...attachment, url: resolvedUrl })}>
        <img src={resolvedUrl} alt={name} className="attachment-image" loading="lazy" draggable={false} />
      </button>
    );
  }
  if (isVideo(mime)) {
    return (
      <video className="attachment-video" src={resolvedUrl} controls preload="metadata" />
    );
  }
  if (isAudio(mime)) {
    return (
      <div className="attachment-audio">
        <Volume2 size={18} />
        <audio src={resolvedUrl} controls preload="metadata" />
      </div>
    );
  }
  return (
    <a className="attachment-file" href={resolvedUrl} download={name} target="_blank" rel="noreferrer">
      <span className="attachment-file-icon">
        {mime === 'application/pdf' ? <FileText size={22} /> : <Download size={22} />}
      </span>
      <span className="attachment-file-info">
        <span>{name}</span>
        <small>{sizeLabel}</small>
      </span>
      <Download size={16} className="attachment-file-download" />
    </a>
  );
}

export default function MessageItem({ message, channel, server, grouped = false, onJump }) {
  const me = useApp((state) => state.user);
  const presence = useApp((state) => state.presence);
  const openModal = useApp((state) => state.openModal);
  const setReplyTo = useApp((state) => state.setReplyTo);
  const updateMessage = useApp((state) => state.updateMessage);
  const removeMessage = useApp((state) => state.removeMessage);
  const toast = useApp((state) => state.toast);
  const pendingJump = useApp((state) => state.pendingJump);
  const markChannelRead = useApp((state) => state.markChannelRead);
  const reads = useApp((state) => state.reads);
  const dms = useApp((state) => state.dms);

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content || '');
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState(null);
  const [reactionOpen, setReactionOpen] = useState(false);
  const [highlight, setHighlight] = useState(false);
  const editRef = useRef(null);
  const reactionRef = useRef(null);

  const author = message.author || {};
  const mine = author.id === me?.id;
  const isAdmin = server ? hasPermission(server, me?.id, 'MANAGE_MESSAGES') : false;
  const canDelete = mine || isAdmin || channel?.type === 'dm';
  const canPin = channel?.type === 'dm' || mine || isAdmin;
  const color = server ? roleColor(server, author.id) : null;
  const status = presence[author.id] || author.status || 'offline';
  const isDm = channel?.type === 'dm';
  const saved = Boolean(channel?.saved);
  const savedChannel = dms.find((item) => item.saved && (item.memberIds || []).includes(me?.id));
  const otherMember = isDm && !saved ? (channel.members || []).find((member) => member.id !== me?.id) : null;
  const otherReadAt = otherMember ? reads[channel?.id]?.[otherMember.id] : null;
  const readByOther = Boolean(
    otherReadAt && message.createdAt && String(message.createdAt) <= String(otherReadAt)
  );
  const showReceipt = isDm && !saved && Boolean(otherMember) && mine;

  const isJumpTarget = pendingJump?.messageId === message.id;

  useEffect(() => {
    if (!isJumpTarget) return undefined;
    setHighlight(true);
    const timer = setTimeout(() => setHighlight(false), 2200);
    return () => clearTimeout(timer);
  }, [isJumpTarget]);

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.setSelectionRange(editRef.current.value.length, editRef.current.value.length);
    }
  }, [editing]);

  useEffect(() => {
    if (!reactionOpen) return undefined;
    const handler = (event) => {
      if (reactionRef.current && !reactionRef.current.contains(event.target)) setReactionOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [reactionOpen]);

  if (!message) return null;

  if (message.system) {
    return (
      <div className={cx('message-system', isJumpTarget && 'highlight')} id={`message-${message.id}`}>
        <span>{message.content}</span>
        <time>{formatTime(message.createdAt)}</time>
      </div>
    );
  }

  const startEdit = () => {
    setEditing(true);
    setEditText(message.content || '');
  };

  const saveEdit = async () => {
    const content = editText.trim();
    if (!content) {
      setEditing(false);
      return;
    }
    if (content === message.content) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const data = await api(`/api/messages/${message.id}`, { method: 'PATCH', body: { content } });
      if (data?.message) updateMessage({ message: data.message });
      setEditing(false);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleReaction = async (emoji) => {
    setReactionOpen(false);
    try {
      const data = await api(`/api/messages/${message.id}/reactions`, { method: 'POST', body: { emoji } });
      if (data?.message) updateMessage({ message: data.message });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const togglePin = async () => {
    try {
      const data = await api(`/api/messages/${message.id}/pin`, { method: 'PATCH', body: { pinned: !message.pinned } });
      if (data?.message) updateMessage({ message: data.message });
      toast(data?.message?.pinned ? 'Сообщение закреплено' : 'Сообщение откреплено', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const remove = () => {
    openModal('confirm', {
      title: 'Удалить сообщение?',
      text: 'Сообщение будет удалено для всех участников без возможности восстановления.',
      confirmText: 'Удалить',
      danger: true,
      onConfirm: async () => {
        try {
          await api(`/api/messages/${message.id}`, { method: 'DELETE' });
          removeMessage({ channelId: message.channelId, messageId: message.id });
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    });
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(message.content || '');
      toast('Текст скопирован', 'success');
    } catch {
      toast('Не удалось скопировать текст', 'error');
    }
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(message.id);
      toast('ID сообщения скопирован', 'success');
    } catch {
      toast('Не удалось скопировать ID', 'error');
    }
  };

  const jumpToReply = () => {
    if (!message.replyTo) return;
    if (onJump) onJump(message.replyTo.id);
    else useApp.getState().setPendingJump(message.channelId, message.replyTo.id);
  };

  const jumpToForward = () => {
    const source = message.forwardedFrom;
    if (!source?.channelId) return;
    if (source.messageId) useApp.getState().setPendingJump(source.channelId, source.messageId);
    else useApp.getState().setActive({ type: 'channel', id: source.channelId });
  };

  const saveToSaved = async () => {
    if (!savedChannel) {
      toast('Избранное недоступно', 'error');
      return;
    }
    try {
      await api(`/api/messages/${message.id}/forward`, {
        method: 'POST',
        body: { channelId: savedChannel.id },
      });
      toast('Сохранено в Избранное', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const openForward = () => openModal('forward', { message });

  const openProfile = () => {
    if (author.id && author.id !== 'unknown') openModal('profile', { userId: author.id });
  };

  const onContextMenu = (event) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  };

  const menuItems = [
    { label: 'Ответить', icon: <CornerUpLeft size={16} />, onClick: () => setReplyTo(message) },
    { label: 'Переслать', icon: <Forward size={16} />, onClick: openForward },
    !saved && savedChannel
      ? { label: 'Сохранить в Избранное', icon: <Bookmark size={16} />, onClick: saveToSaved }
      : null,
    message.content ? { label: 'Копировать текст', icon: <Copy size={16} />, onClick: copyText } : null,
    mine ? { label: 'Редактировать', icon: <Pencil size={16} />, onClick: startEdit } : null,
    canPin
      ? {
          label: message.pinned ? 'Открепить' : 'Закрепить',
          icon: message.pinned ? <PinOff size={16} /> : <Pin size={16} />,
          onClick: togglePin,
        }
      : null,
    'separator',
    { label: 'Скопировать ID', icon: <Copy size={16} />, onClick: copyId },
    canDelete
      ? { label: 'Удалить', icon: <Trash2 size={16} />, danger: true, onClick: remove }
      : null,
  ].filter(Boolean);

  const reactionEntries = Object.entries(message.reactions || {}).filter(([, users]) => users?.length);
  const hasAttachments = (message.attachments || []).length > 0;
  const paragraphs = String(message.content || '').split('\n').length > 12;

  return (
    <div
      id={`message-${message.id}`}
      className={cx(
        'message',
        mine && 'mine',
        grouped && 'grouped',
        highlight && 'highlight',
        message.pinned && 'pinned',
        isJumpTarget && 'jump-target'
      )}
      onContextMenu={onContextMenu}
    >
      {message.pinned && !grouped ? (
        <div className="message-pinned-flag"><Pin size={11} /> Закреплено</div>
      ) : null}
      <div className="message-gutter">
        {grouped ? (
          <span className="message-time-hover">{formatTime(message.createdAt)}</span>
        ) : (
          <Avatar user={author} size={40} showStatus status={status} onClick={openProfile} className="message-avatar" />
        )}
      </div>
      <div className="message-body">
        {!grouped ? (
          <div className="message-head">
            <button className="message-author" style={color ? { color } : undefined} onClick={openProfile}>
              {author.displayName || author.username || 'Неизвестный'}
            </button>
            {server && author.id === server.ownerId ? <span className="author-tag owner">Владелец</span> : null}
            {server && !author.id?.startsWith('u_') ? null : null}
            <time className="message-time" title={formatFullDate(message.createdAt)}>
              {formatTime(message.createdAt)}
            </time>
            {message.editedAt ? <span className="message-edited">(изменено)</span> : null}
          </div>
        ) : null}

        {message.replyTo ? (
          <button className="reply-preview" onClick={jumpToReply}>
            <CornerUpLeft size={12} />
            <span className="reply-preview-author">{message.replyTo.author?.displayName || 'Пользователь'}</span>
            <span className="reply-preview-text">
              {message.replyTo.content || (message.replyTo.hasAttachments ? 'Вложение' : 'Сообщение удалено')}
            </span>
          </button>
        ) : null}

        {message.forwardedFrom ? (
          message.forwardedFrom.channelId ? (
            <button type="button" className="forwarded-label" onClick={jumpToForward} title="Перейти к оригиналу">
              <Forward size={13} />
              <span>
                Переслано от{' '}
                <b>{message.forwardedFrom.author?.displayName || message.forwardedFrom.author?.username || 'пользователя'}</b>
              </span>
              {message.forwardedFrom.channelName ? (
                <span className="forwarded-channel">· {message.forwardedFrom.channelName}</span>
              ) : null}
            </button>
          ) : (
            <div className="forwarded-label static">
              <Forward size={13} />
              <span>
                Переслано от{' '}
                <b>{message.forwardedFrom.author?.displayName || message.forwardedFrom.author?.username || 'пользователя'}</b>
              </span>
            </div>
          )
        ) : null}

        {editing ? (
          <div className="message-edit">
            <textarea
              ref={editRef}
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  saveEdit();
                }
                if (event.key === 'Escape') setEditing(false);
              }}
              rows={Math.min(8, Math.max(2, editText.split('\n').length))}
              maxLength={4000}
            />
            <div className="message-edit-actions">
              <button className="btn btn-ghost btn-small" onClick={() => setEditing(false)} disabled={saving}>
                Отмена
              </button>
              <button className="btn btn-primary btn-small" onClick={saveEdit} disabled={saving || !editText.trim()}>
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </div>
          </div>
        ) : message.content ? (
          <RichText
            text={message.content}
            currentUsername={me?.username}
            className={cx('message-content', paragraphs && 'message-content-long')}
          />
        ) : null}

        {hasAttachments ? (
          <div className="message-attachments">
            {message.attachments.map((attachment) => (
              <Attachment
                key={attachment.id}
                attachment={attachment}
                onPreview={(item) => openModal('image', { url: item.url, name: item.name })}
              />
            ))}
          </div>
        ) : null}

        {reactionEntries.length ? (
          <div className="reactions">
            {reactionEntries.map(([emoji, users]) => {
              const active = users.includes(me?.id);
              return (
                <button
                  key={emoji}
                  className={cx('reaction', active && 'active')}
                  onClick={() => toggleReaction(emoji)}
                  title={users.map((id) => {
                    const member = server?.members?.find((m) => m.id === id);
                    return member?.displayName || id;
                  }).join(', ')}
                >
                  <span className="reaction-emoji">{emoji}</span>
                  <span className="reaction-count">{users.length}</span>
                </button>
              );
            })}
            <button className="reaction add-reaction" onClick={() => setReactionOpen((value) => !value)} title="Добавить реакцию">
              <SmilePlus size={15} />
            </button>
          </div>
        ) : null}

        {reactionOpen ? (
          <div className="reaction-picker" ref={reactionRef}>
            <EmojiPicker onPick={toggleReaction} onClose={() => setReactionOpen(false)} className="reaction-emoji-picker" />
          </div>
        ) : null}

        {showReceipt ? (
          <div className={cx('message-receipt', readByOther && 'read')} title={readByOther ? 'Прочитано' : 'Доставлено'}>
            {readByOther ? <CheckCheck size={14} /> : <Check size={14} />}
            <span>{readByOther ? 'Прочитано' : 'Доставлено'}</span>
          </div>
        ) : null}
      </div>

      <div className="message-actions">
        {reactionEntries.length === 0 ? (
          <button className="message-action" onClick={() => setReactionOpen((value) => !value)} title="Добавить реакцию">
            <SmilePlus size={16} />
          </button>
        ) : null}
        <button className="message-action" onClick={() => setReplyTo(message)} title="Ответить">
          <CornerUpLeft size={16} />
        </button>
        <button className="message-action" onClick={openForward} title="Переслать">
          <Forward size={16} />
        </button>
        {mine ? (
          <button className="message-action" onClick={startEdit} title="Редактировать">
            <Pencil size={15} />
          </button>
        ) : null}
        <button
          className="message-action"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ x: rect.left, y: rect.bottom + 4 });
          }}
          title="Ещё"
        >
          <MoreHorizontal size={17} />
        </button>
      </div>

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}
