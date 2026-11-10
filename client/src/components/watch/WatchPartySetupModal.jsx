import React, { useState } from 'react';
import {
  Clapperboard,
  ClipboardPaste,
  Film,
  Hash,
  Link2,
  Loader2,
  Play,
  Tv,
} from 'lucide-react';
import { useApp } from '../../store';
import { watchManager } from '../../watch';
import Modal from '../ui/Modal';

function guessSourceType(url) {
  const value = String(url || '').trim();
  if (/(?:youtube\.com|youtu\.be)/i.test(value)) return 'youtube';
  return 'url';
}

export default function WatchPartySetupModal({ channelId = null, channelName = '' } = {}) {
  const user = useApp((state) => state.user);
  const closeModal = useApp((state) => state.closeModal);
  const openModal = useApp((state) => state.openModal);
  const toast = useApp((state) => state.toast);

  const [title, setTitle] = useState(() => `${user?.displayName || 'Моя'} — смотрим вместе`);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pasteUrl = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text?.trim()) {
        toast('Буфер обмена пуст', 'info');
        return;
      }
      setUrl(text.trim());
      setError('');
    } catch {
      toast('Не удалось прочитать буфер обмена — вставьте ссылку вручную', 'error');
    }
  };

  const start = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!channelId) {
      setError('Watch Party запускается из канала — откройте канал и попробуйте снова');
      return;
    }
    const value = url.trim();
    if (!/^https?:\/\//i.test(value)) {
      setError('Вставьте ссылку на видео (http/https)');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const room = await watchManager.create({
        channelId,
        title: title.trim() || 'Смотрим вместе',
        source: { type: guessSourceType(value), url: value },
      });
      closeModal();
      openModal('watchParty', { roomId: room.id, channelId });
      toast('Watch Party создана — приглашайте своих', 'success');
    } catch (err) {
      setError(err?.message || 'Не удалось создать комнату');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={busy ? undefined : closeModal}
      className="watch-setup-modal"
      showClose={!busy}
      closeOnOverlay={!busy}
      closeOnEscape={!busy}
    >
      <div className="watch-setup-hero">
        <span className="watch-setup-hero-icon"><Tv size={23} /></span>
        <div>
          <h2>Watch Party</h2>
          <p>Смотрите видео вместе: пауза, перемотка и позиция синхронизируются у всех участников.</p>
        </div>
      </div>

      {error ? <div className="form-error watch-setup-error">{error}</div> : null}

      <form className="watch-setup-form" onSubmit={start}>
        <section className="watch-setup-section">
          <div className="watch-setup-section-head">
            <span className="watch-setup-section-title">Ссылка на видео</span>
            <span className="watch-setup-counter">{url.length}/2048</span>
          </div>
          <div className="watch-setup-url">
            <Link2 size={17} className="watch-setup-url-icon" />
            <input
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                if (error) setError('');
              }}
              placeholder="https://youtube.com/watch?v=… или https://…/video.mp4"
              inputMode="url"
              maxLength={2048}
              disabled={busy}
              autoFocus
              aria-label="Ссылка на видео"
            />
            <button type="button" className="watch-setup-paste" onClick={pasteUrl} disabled={busy}>
              <ClipboardPaste size={14} />
              <span>Вставить</span>
            </button>
          </div>
          <div className="watch-setup-hints">
            <span className="watch-setup-chip"><Play size={12} /> YouTube</span>
            <span className="watch-setup-chip"><Clapperboard size={12} /> Клипы и Shorts</span>
            <span className="watch-setup-chip"><Film size={12} /> MP4 и WebM</span>
            <span className="watch-setup-chip"><Link2 size={12} /> youtu.be</span>
          </div>
        </section>

        <section className="watch-setup-section">
          <div className="watch-setup-section-head">
            <span className="watch-setup-section-title">Комната</span>
            <span className="watch-setup-counter">{title.length}/80</span>
          </div>
          <input
            className="watch-setup-title-input"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (error) setError('');
            }}
            maxLength={80}
            disabled={busy}
            placeholder="Например, вечерний киносеанс"
            aria-label="Название комнаты"
          />
          <div className="watch-setup-note">
            <Hash size={15} />
            <span>
              {channelId
                ? `Комната появится в канале${channelName ? ` #${channelName}` : ''}. Участники увидят баннер и смогут присоединиться.`
                : 'Комната появится в выбранном канале — участники увидят баннер и смогут присоединиться.'}
            </span>
          </div>
        </section>

        <div className="watch-setup-footer">
          <span className="watch-setup-footer-note">
            <Play size={13} /> Управляет создатель, остальные смотрят синхронно
          </span>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={closeModal} disabled={busy}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !url.trim()}>
              {busy ? <Loader2 size={16} className="spin" /> : <Tv size={16} />}
              {busy ? 'Создаём комнату…' : 'Начать Watch Party'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
