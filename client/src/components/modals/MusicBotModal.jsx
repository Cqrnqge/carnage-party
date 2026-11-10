import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Clapperboard,
  ClipboardPaste,
  FileAudio,
  FolderOpen,
  Link2,
  Loader2,
  Music2,
  Play,
  Plus,
  Radio,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../store';
import { hasPermission } from '../../constants';
import Modal from '../ui/Modal';
import { cx } from '../../utils';

function sourceTypeLabel(source) {
  if (!source) return 'аудио';
  if (source.type === 'youtube') return 'YouTube';
  if (source.type === 'rutube') return 'Rutube';
  if (source.type === 'hls') return 'HLS-поток';
  if (source.type === 'radio') return 'Радио';
  if (source.type === 'file') return 'Файл';
  return 'Аудио';
}

function formatFileSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
  return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

const MUSIC_FILE_EXTENSIONS = /\.(mp3|m4a|m4b|aac|ogg|oga|opus|wav|flac|weba|webm|mp4|aif|aiff)$/i;
const MAX_MUSIC_FILE = 100 * 1024 * 1024;

export default function MusicBotModal({ channelId, serverId } = {}) {
  const closeModal = useApp((state) => state.closeModal);
  const toast = useApp((state) => state.toast);
  const bots = useApp((state) => state.bots);
  const addBot = useApp((state) => state.addBot);
  const removeBot = useApp((state) => state.removeBot);
  const music = useApp((state) => state.music);
  const user = useApp((state) => state.user);
  const servers = useApp((state) => state.servers);
  const server = servers.find((item) => item.id === serverId);
  const isAdmin = hasPermission(server, user?.id, 'ADMINISTRATOR');
  const canDeleteBot = (bot) => isAdmin || bot.ownerId === user?.id;

  const serverBots = useMemo(
    () => bots.filter((bot) => bot.serverId === serverId),
    [bots, serverId]
  );
  const activeSession = channelId ? music[channelId] : null;
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('Music Bot');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!serverBots.length) {
      setSelectedId('');
      return;
    }
    if (!serverBots.some((bot) => bot.id === selectedId)) {
      setSelectedId(serverBots[0].id);
    }
  }, [serverBots, selectedId]);

  const createBot = async () => {
    if (!serverId) return;
    if (name.trim().length < 2) {
      setError('Название бота должно быть не короче 2 символов');
      return;
    }
    setBusy('create');
    setError('');
    try {
      const data = await api(`/api/servers/${serverId}/bots`, {
        method: 'POST',
        body: { name: name.trim() },
      });
      if (data?.bot) {
        addBot(data.bot);
        setSelectedId(data.bot.id);
        setName('Music Bot');
        setShowCreate(false);
        toast(`Бот «${data.bot.displayName}» создан`, 'success');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const deleteBot = async (bot) => {
    if (!window.confirm(`Удалить бота «${bot.displayName}»?`)) return;
    setBusy(`delete:${bot.id}`);
    setError('');
    try {
      await api(`/api/bots/${bot.id}`, { method: 'DELETE' });
      removeBot(bot.id);
      toast('Бот удалён', 'info');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const pasteUrl = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text?.trim()) {
        toast('Буфер обмена пуст', 'info');
        return;
      }
      setUrl(text.trim());
      setFile(null);
      setError('');
    } catch {
      toast('Не удалось прочитать буфер обмена — вставьте ссылку вручную', 'error');
    }
  };

  const pickFile = () => fileInputRef.current?.click();

  const selectFile = (event) => {
    const chosen = event.target.files?.[0] || null;
    event.target.value = '';
    if (!chosen) return;
    if (chosen.size > MAX_MUSIC_FILE) {
      setError('Аудиофайл слишком большой (максимум 100 МБ)');
      return;
    }
    if (!MUSIC_FILE_EXTENSIONS.test(chosen.name) && !String(chosen.type || '').startsWith('audio/')) {
      setError('Выберите аудиофайл: MP3, M4A, OGG, WAV, FLAC и другие');
      return;
    }
    setFile(chosen);
    setUrl('');
    setError('');
  };

  const play = async (event) => {
    event.preventDefault();
    if (!selectedId) {
      setError('Сначала создайте музыкального бота');
      return;
    }
    if (file) {
      const form = new FormData();
      form.append('file', file, file.name);
      if (channelId) form.append('channelId', channelId);
      setBusy('play');
      setError('');
      try {
        await api(`/api/bots/${selectedId}/play-file`, { method: 'POST', body: form });
        toast('Бот включил ваш файл в канале', 'success');
        closeModal();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy('');
      }
      return;
    }
    const value = url.trim();
    if (!/^https?:\/\//i.test(value)) {
      setError('Вставьте ссылку на YouTube, Rutube, трек, клип или радио (http/https)');
      return;
    }
    setBusy('play');
    setError('');
    try {
      await api(`/api/bots/${selectedId}/play`, {
        method: 'POST',
        body: { channelId, source: { url: value } },
      });
      toast('Бот включил музыку в вашем канале', 'success');
      closeModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const stop = async () => {
    const botId = activeSession?.botId;
    if (!botId) return;
    setBusy('stop');
    try {
      await api(`/api/bots/${botId}/stop`, { method: 'POST' });
      toast('Бот остановлен', 'info');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <Modal onClose={closeModal} className="music-bot-modal" showClose>
      <div className="music-bot-hero">
        <span className="music-bot-hero-icon"><Music2 size={23} /></span>
        <div>
          <h2>Музыкальный бот</h2>
          <p>Заходит в ваш голосовой канал и включает трек для всех участников. Включать и управлять музыкой может любой участник сервера.</p>
        </div>
      </div>

      {error ? <div className="form-error music-bot-error">{error}</div> : null}

      {activeSession ? (
        <div className="music-bot-current">
          <div className={cx('music-bot-eq', activeSession.playing && 'playing')} aria-hidden="true">
            <span /><span /><span /><span />
          </div>
          <div className="music-bot-current-info">
            <span className="music-bot-eyebrow">Сейчас играет</span>
            <strong>{activeSession.source?.title || activeSession.source?.url}</strong>
            <small>
              {activeSession.bot?.displayName || 'Music Bot'} · {sourceTypeLabel(activeSession.source)} ·{' '}
              {activeSession.playing ? 'играет' : 'на паузе'}
            </small>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-small music-bot-stop"
            onClick={stop}
            disabled={busy === 'stop'}
          >
            {busy === 'stop' ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
            Остановить
          </button>
        </div>
      ) : null}

      <form onSubmit={play} className="music-bot-form">
        <section className="music-bot-section">
          <div className="music-bot-section-head">
            <span className="music-bot-section-title">Бот</span>
            {serverBots.length ? (
              <button
                type="button"
                className="music-bot-link-btn"
                onClick={() => setShowCreate((value) => !value)}
              >
                <Plus size={14} /> {showCreate ? 'Скрыть' : 'Новый бот'}
              </button>
            ) : null}
          </div>

          {serverBots.length ? (
            <div className="music-bot-select-row">
              <span className="music-bot-avatar"><Music2 size={17} /></span>
              <select
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
                aria-label="Музыкальный бот"
              >
                {serverBots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.displayName}
                  </option>
                ))}
              </select>
              <Check size={16} className="music-bot-select-check" />
            </div>
          ) : null}

          {showCreate || !serverBots.length ? (
            <div className="music-bot-create">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Имя бота, например DJ Carnage"
                maxLength={32}
                aria-label="Имя нового бота"
              />
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={createBot}
                disabled={busy === 'create'}
              >
                {busy === 'create' ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
                Создать
              </button>
            </div>
          ) : null}
        </section>

        <section className="music-bot-section">
          <div className="music-bot-section-head">
            <span className="music-bot-section-title">Ссылка на источник</span>
            <span className="music-bot-counter">{url.length}/2048</span>
          </div>
          <div className="music-bot-url">
            <Link2 size={17} className="music-bot-url-icon" />
            <input
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                if (file) setFile(null);
                if (error) setError('');
              }}
              placeholder="https://youtube.com/watch?v=…, rutube.ru/video/… или радио"
              inputMode="url"
              autoFocus
              aria-label="Ссылка на музыку"
            />
            <button type="button" className="music-bot-paste" onClick={pasteUrl}>
              <ClipboardPaste size={14} />
              <span>Вставить</span>
            </button>
          </div>
          <div className="music-bot-source-or"><span>или файл с компьютера</span></div>
          <input
            ref={fileInputRef}
            type="file"
            className="music-bot-file-input"
            accept="audio/*,.mp3,.m4a,.m4b,.aac,.ogg,.oga,.opus,.wav,.flac,.weba,.webm,.mp4,.aif,.aiff"
            onChange={selectFile}
            tabIndex={-1}
            aria-hidden="true"
          />
          {file ? (
            <div className="music-bot-file">
              <span className="music-bot-file-icon"><FileAudio size={17} /></span>
              <div className="music-bot-file-info">
                <strong title={file.name}>{file.name}</strong>
                <small>{formatFileSize(file.size)} · файл будет слышен всем в канале</small>
              </div>
              <button
                type="button"
                className="icon-btn"
                title="Убрать файл"
                onClick={() => setFile(null)}
              >
                <X size={15} />
              </button>
            </div>
          ) : (
            <button type="button" className="music-bot-file-pick" onClick={pickFile}>
              <span className="music-bot-file-pick-icon"><FolderOpen size={18} /></span>
              <span className="music-bot-file-pick-text">
                <strong>Выбрать файл на компьютере</strong>
                <small>MP3, M4A, OGG, WAV, FLAC · до 100 МБ</small>
              </span>
            </button>
          )}
          <div className="music-bot-hints">
            <span className="music-bot-chip"><Play size={12} /> YouTube и клипы</span>
            <span className="music-bot-chip"><Clapperboard size={12} /> Rutube</span>
            <span className="music-bot-chip"><FileAudio size={12} /> Файл с компьютера</span>
            <span className="music-bot-chip"><Radio size={12} /> HLS и радио</span>
          </div>
        </section>

        <div className="music-bot-footer">
          <span className="music-bot-footer-note">
            {file ? 'Файл загрузится на сервер и будет слышен всем' : 'Бот появится в канале как участник'}
          </span>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={closeModal}>
              Отмена
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!selectedId || busy === 'play' || (!file && !url.trim())}
            >
              {busy === 'play' ? (
                <Loader2 size={16} className="spin" />
              ) : file ? (
                <FileAudio size={16} />
              ) : (
                <Play size={16} />
              )}
              {file ? 'Включить файл' : 'Включить в канале'}
            </button>
          </div>
        </div>
      </form>

      {serverBots.length ? (
        <section className="music-bot-list">
          <div className="music-bot-list-head">
            <span>Боты сервера</span>
            <span>{serverBots.length}</span>
          </div>
          {serverBots.map((bot) => (
            <div key={bot.id} className={cx('music-bot-row', bot.id === selectedId && 'active')}>
              <button
                type="button"
                className="music-bot-pick"
                onClick={() => setSelectedId(bot.id)}
                title="Выбрать бота"
              >
                <span className="music-bot-avatar small"><Music2 size={15} /></span>
                <span className="music-bot-row-name">{bot.displayName}</span>
                {bot.ownerId === user?.id ? <span className="music-bot-own">ваш</span> : null}
                {bot.id === selectedId ? <Check size={14} className="music-bot-row-check" /> : null}
              </button>
              {canDeleteBot(bot) ? (
                <button
                  type="button"
                  className="icon-btn danger"
                  title="Удалить бота"
                  onClick={() => deleteBot(bot)}
                  disabled={busy === `delete:${bot.id}`}
                >
                  {busy === `delete:${bot.id}` ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
                </button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
    </Modal>
  );
}
