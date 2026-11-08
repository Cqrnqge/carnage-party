import React, { useEffect, useMemo, useRef, useState } from 'react';
import { File, Image as ImageIcon, Loader2, Lock, Mic, Paperclip, Send, Smile, Trash2, X } from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../store';
import { hasPermission } from '../../constants';
import { cx, formatBytes, isImage } from '../../utils';
import { getSocket } from '../../socket';
import { requestMic } from '../../voice';
import EmojiPicker from './EmojiPicker';

const DRAFT_PREFIX = 'carnage_draft';

function draftKey(userId, channelId) {
  return `${DRAFT_PREFIX}_${userId || 'anon'}_${channelId || 'none'}`;
}

function formatRecordTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export default function MessageInput({ channel, server }) {
  const user = useApp((state) => state.user);
  const replyTo = useApp((state) => state.replyTo);
  const setReplyTo = useApp((state) => state.setReplyTo);
  const receiveMessage = useApp((state) => state.receiveMessage);
  const toast = useApp((state) => state.toast);
  const inputDevice = useApp((state) => state.settings.inputDevice);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [mention, setMention] = useState(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimer = useRef(null);
  const lastTyping = useRef(0);
  const dragCounter = useRef(0);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const recordChunks = useRef([]);
  const recordTimer = useRef(null);
  const recordCancelled = useRef(false);
  const recordStartedAt = useRef(0);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const canSend = channel?.type === 'dm' || !server || hasPermission(server, user?.id, 'SEND_MESSAGES');
  const canAttach = channel?.type === 'dm' || !server || hasPermission(server, user?.id, 'ATTACH_FILES');
  const members = useMemo(() => {
    if (channel?.type === 'dm') return channel.members || [];
    return server?.members || [];
  }, [channel, server]);

  useEffect(() => {
    let saved = '';
    try {
      saved = localStorage.getItem(draftKey(user?.id, channel?.id)) || '';
    } catch {}
    setText(saved);
    setFiles([]);
    setEmojiOpen(false);
    setMention(null);
    setReplyTo(null);
  }, [channel?.id, user?.id]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.min(220, Math.max(44, el.scrollHeight));
    el.style.height = `${next}px`;
  }, [text]);

  useEffect(() => () => {
    for (const item of files) {
      if (item.preview) URL.revokeObjectURL(item.preview);
    }
  }, []);

  useEffect(() => {
    if (!text.trim()) return;
    const socket = getSocket();
    if (!socket) return;
    const now = Date.now();
    if (now - lastTyping.current > 2200) {
      socket.emit('typing:start', { channelId: channel.id });
      lastTyping.current = now;
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socket.emit('typing:stop', { channelId: channel.id });
      lastTyping.current = 0;
    }, 2800);
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, [text, channel?.id]);

  useEffect(() => () => {
    const socket = getSocket();
    if (socket && channel?.id) socket.emit('typing:stop', { channelId: channel.id });
  }, [channel?.id]);

  const addFiles = (list) => {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    if (!canAttach) {
      toast('У вас нет права прикреплять файлы', 'error');
      return;
    }
    setFiles((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        if (next.length >= 8) {
          toast('Можно прикрепить не более 8 файлов', 'error');
          break;
        }
        if (file.size > 25 * 1024 * 1024) {
          toast(`Файл «${file.name}» больше 25 МБ`, 'error');
          continue;
        }
        const preview = isImage(file.type) ? URL.createObjectURL(file) : null;
        next.push({ id: Math.random().toString(36).slice(2), file, preview });
      }
      return next;
    });
  };

  const removeFile = (id) => {
    setFiles((prev) => {
      const item = prev.find((f) => f.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  const updateMention = (value, cursor) => {
    if (channel?.type !== 'dm' && !server) {
      setMention(null);
      return;
    }
    const before = value.slice(0, cursor ?? value.length);
    const match = before.match(/(?:^|\s)@([a-zA-Zа-яА-Я0-9_.-]*)$/);
    if (!match) {
      setMention(null);
      return;
    }
    const query = match[1].toLowerCase();
    const candidates = members
      .filter((member) => member.id !== user?.id)
      .filter((member) => member.username.toLowerCase().includes(query) || (member.displayName || '').toLowerCase().includes(query))
      .slice(0, 8);
    if (!candidates.length) {
      setMention(null);
      return;
    }
    setMention({ query, candidates, start: match.index + (match[0].startsWith('@') ? 0 : 1) });
    setMentionIndex(0);
  };

  const insertMention = (member) => {
    const el = textareaRef.current;
    if (!el || !mention) return;
    const cursor = el.selectionStart || 0;
    const before = text.slice(0, mention.start);
    const after = text.slice(cursor);
    const insert = `@${member.username} `;
    const next = before + insert + after;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = before.length + insert.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const insertEmoji = (emoji) => {
    const el = textareaRef.current;
    if (!el) {
      setText((value) => value + emoji);
    } else {
      const start = el.selectionStart ?? text.length;
      const end = el.selectionEnd ?? text.length;
      const next = text.slice(0, start) + emoji + text.slice(end);
      setText(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + emoji.length, start + emoji.length);
      });
    }
    setEmojiOpen(false);
  };

  const send = async () => {
    if (sending || !canSend) return;
    const content = text.trim();
    if (!content && files.length === 0) return;
    setSending(true);
    try {
      const form = new FormData();
      if (content) form.append('content', content);
      if (replyTo?.id) form.append('replyTo', replyTo.id);
      for (const item of files) form.append('files', item.file, item.file.name);
      const data = await api(`/api/channels/${channel.id}/messages`, { method: 'POST', body: form });
      if (data?.message) receiveMessage({ message: data.message });
      const socket = getSocket();
      if (socket) socket.emit('typing:stop', { channelId: channel.id });
      for (const item of files) {
        if (item.preview) URL.revokeObjectURL(item.preview);
      }
      try { localStorage.removeItem(draftKey(user?.id, channel?.id)); } catch {}
      setText('');
      setFiles([]);
      setReplyTo(null);
      setEmojiOpen(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const stopStream = () => {
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch {}
      }
    }
  };

  const sendVoice = async (blob, duration) => {
    setSending(true);
    try {
      const activeReply = useApp.getState().replyTo;
      const form = new FormData();
      form.append('voice', '1');
      form.append('duration', String(Math.max(1, Math.round(duration))));
      const type = blob.type || 'audio/webm';
      const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
      form.append('files', blob, `voice-${Date.now()}.${ext}`);
      if (activeReply?.id) form.append('replyTo', activeReply.id);
      const data = await api(`/api/channels/${channel.id}/messages`, { method: 'POST', body: form });
      if (data?.message) receiveMessage({ message: data.message });
      setReplyTo(null);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    if (recording || sending) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast('Запись голоса не поддерживается на этом устройстве', 'error');
      return;
    }
    try {
      const stream = await requestMic(inputDevice || 'default');
      streamRef.current = stream;
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const mimeType = candidates.find((type) => window.MediaRecorder.isTypeSupported?.(type)) || '';
      const options = { audioBitsPerSecond: 128000 };
      if (mimeType) options.mimeType = mimeType;
      const recorder = new MediaRecorder(stream, options);
      recorderRef.current = recorder;
      recordChunks.current = [];
      recordCancelled.current = false;
      recordStartedAt.current = Date.now();
      setRecordSeconds(0);
      recorder.ondataavailable = (event) => {
        if (event.data?.size) recordChunks.current.push(event.data);
      };
      recorder.onstop = () => {
        const duration = (Date.now() - recordStartedAt.current) / 1000;
        const chunks = recordChunks.current;
        recordChunks.current = [];
        if (recordTimer.current) {
          clearInterval(recordTimer.current);
          recordTimer.current = null;
        }
        stopStream();
        setRecording(false);
        setRecordSeconds(0);
        if (recordCancelled.current) return;
        if (duration < 0.8 || !chunks.length) {
          toast('Слишком короткая запись', 'info');
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' });
        sendVoice(blob, duration);
      };
      recorder.start(1000);
      setRecording(true);
      recordTimer.current = setInterval(() => {
        const elapsed = (Date.now() - recordStartedAt.current) / 1000;
        setRecordSeconds(elapsed);
        if (elapsed >= 300) {
          recordCancelled.current = false;
          try { recorder.stop(); } catch {}
        }
      }, 250);
    } catch {
      stopStream();
      toast('Не удалось получить доступ к микрофону', 'error');
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recordCancelled.current = false;
    try { recorder.stop(); } catch {}
  };

  const cancelRecording = () => {
    recordCancelled.current = true;
    if (recordTimer.current) {
      clearInterval(recordTimer.current);
      recordTimer.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch {}
    } else {
      stopStream();
    }
    setRecording(false);
    setRecordSeconds(0);
  };

  useEffect(() => () => {
    recordCancelled.current = true;
    if (recordTimer.current) clearInterval(recordTimer.current);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch {}
    }
    stopStream();
  }, []);

  const onKeyDown = (event) => {
    if (mention) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIndex((index) => (index + 1) % mention.candidates.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex((index) => (index - 1 + mention.candidates.length) % mention.candidates.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        insertMention(mention.candidates[mentionIndex]);
        return;
      }
      if (event.key === 'Escape') {
        setMention(null);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  if (!canSend) {
    return (
      <div className="message-input-disabled">
        <Lock size={16} />
        У вас нет права отправлять сообщения в этот канал.
      </div>
    );
  }

  return (
    <div
      className={cx('message-input-wrap', dragOver && 'dragging')}
      onDragEnter={(event) => {
        event.preventDefault();
        dragCounter.current += 1;
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragCounter.current -= 1;
        if (dragCounter.current <= 0) setDragOver(false);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        dragCounter.current = 0;
        setDragOver(false);
        addFiles(event.dataTransfer.files);
      }}
    >
      {dragOver ? (
        <div className="drop-overlay">
          <Paperclip size={26} />
          <strong>Отпустите файлы, чтобы прикрепить</strong>
          <span>До 8 файлов, максимум 25 МБ каждый</span>
        </div>
      ) : null}

      {replyTo ? (
        <div className="reply-bar">
          <div className="reply-bar-main">
            <span className="reply-label">
              Ответ <strong>{replyTo.author?.displayName}</strong>
            </span>
            <span className="reply-snippet">{replyTo.content || 'Вложение'}</span>
          </div>
          <button className="icon-btn" onClick={() => setReplyTo(null)} aria-label="Отменить ответ">
            <X size={16} />
          </button>
        </div>
      ) : null}

      {files.length ? (
        <div className="attachment-previews">
          {files.map((item) => (
            <div key={item.id} className="attachment-preview">
              {item.preview ? (
                <img src={item.preview} alt="" />
              ) : (
                <div className="attachment-file-icon"><File size={22} /></div>
              )}
              <div className="attachment-preview-info">
                <span>{item.file.name}</span>
                <small>{formatBytes(item.file.size)}</small>
              </div>
              <button className="attachment-remove" onClick={() => removeFile(item.id)} aria-label="Удалить файл">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {mention ? (
        <div className="mention-popup">
          <div className="mention-title">Участники</div>
          {mention.candidates.map((member, index) => (
            <button
              key={member.id}
              className={cx('mention-item', index === mentionIndex && 'active')}
              onMouseDown={(event) => {
                event.preventDefault();
                insertMention(member);
              }}
            >
              <span className="mention-avatar" style={{ background: member.accentColor || '#5865f2' }}>
                {(member.displayName || member.username || '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="mention-name">{member.displayName}</span>
              <span className="mention-username">@{member.username}</span>
            </button>
          ))}
        </div>
      ) : null}

      {emojiOpen ? (
        <EmojiPicker
          className="input-emoji-picker"
          onPick={insertEmoji}
          onClose={() => setEmojiOpen(false)}
        />
      ) : null}

      {recording ? (
        <div className="voice-recording">
          <span className="voice-recording-dot" />
          <span className="voice-recording-label">Запись</span>
          <span className="voice-recording-time">{formatRecordTime(recordSeconds)}</span>
          <div className="voice-recording-wave" aria-hidden="true">
            {Array.from({ length: 30 }).map((_, index) => (
              <span key={index} style={{ animationDelay: `${(index % 9) * 0.08}s` }} />
            ))}
          </div>
          <button className="icon-btn danger" onClick={cancelRecording} title="Отменить запись" type="button">
            <Trash2 size={18} />
          </button>
          <button className="send-btn active" onClick={stopRecording} title="Отправить голосовое" type="button">
            <Send size={18} />
          </button>
        </div>
      ) : null}

      <div className="message-input-bar">
        <button
          className="icon-btn input-action"
          onClick={() => fileInputRef.current?.click()}
          title="Прикрепить файл"
          disabled={!canAttach}
        >
          <Paperclip size={20} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <textarea
          ref={textareaRef}
          className="message-input"
          rows={1}
          value={text}
          disabled={recording}
          placeholder={
            recording
              ? 'Идёт запись голосового сообщения…'
              : `Написать в ${channel?.type === 'dm' ? 'личные сообщения' : `#${channel?.name}`}`
          }
          maxLength={4000}
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            updateMention(value, event.target.selectionStart);
            try {
              const key = draftKey(user?.id, channel?.id);
              if (value.trim()) localStorage.setItem(key, value);
              else localStorage.removeItem(key);
            } catch {}
          }}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            if (event.clipboardData?.files?.length) {
              event.preventDefault();
              addFiles(event.clipboardData.files);
            }
          }}
        />
        <button
          className={cx('icon-btn input-action', emojiOpen && 'active')}
          onClick={() => setEmojiOpen((value) => !value)}
          title="Эмодзи"
        >
          <Smile size={20} />
        </button>
        {!recording && !text.trim() && !files.length ? (
          <button
            className="icon-btn input-action mic-btn"
            onClick={startRecording}
            disabled={sending}
            title="Записать голосовое сообщение"
          >
            <Mic size={20} />
          </button>
        ) : null}
        {!recording && (text.trim() || files.length) ? (
          <button
            className={cx('send-btn', 'active')}
            onClick={send}
            disabled={sending}
            title="Отправить"
          >
            {sending ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
          </button>
        ) : null}
      </div>
      <div className="input-hints">
        <span><kbd>Enter</kbd> — отправить</span>
        <span><kbd>Shift</kbd> + <kbd>Enter</kbd> — новая строка</span>
        {text.length > 3600 ? <span className={cx('char-count', text.length >= 4000 && 'limit')}>{text.length}/4000</span> : null}
      </div>
    </div>
  );
}
