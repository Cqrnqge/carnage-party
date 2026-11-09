import React, { useState } from 'react';
import { Hash, Link2, Loader2, Play, Tv } from 'lucide-react';
import { useApp } from '../../store';
import { watchManager } from '../../watch';
import Modal, { ModalHeader } from '../ui/Modal';

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

  const start = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!channelId) {
      setError('Watch Party запускается из канала — откройте канал и попробуйте снова');
      return;
    }
    const value = url.trim();
    if (!value) {
      setError('Вставьте ссылку на YouTube или прямой видеофайл');
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
    <Modal onClose={busy ? undefined : closeModal} className="watch-setup-modal" showClose={!busy} closeOnEscape={!busy}>
      <ModalHeader
        title="Watch Party"
        subtitle="Смотрите видео вместе: пауза, перемотка и позиция синхронизируются у всех участников."
      />

      <form className="watch-setup" onSubmit={start}>
        <div className="watch-setup-hero">
          <span className="watch-setup-hero-icon"><Tv size={30} /></span>
          <div>
            <strong>Кино, клипы, стримы — всё вместе</strong>
            <p>YouTube или прямая ссылка на MP4/WebM. Каждый смотрит у себя, звук остаётся локальным.</p>
          </div>
        </div>

        <label className="form-field">
          <span className="form-label">Ссылка на видео</span>
          <div className="watch-url-row">
            <Link2 size={17} />
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=... или https://.../video.mp4"
              disabled={busy}
              autoFocus
            />
          </div>
          <span className="form-hint">Для YouTube можно вставить обычную ссылку, Shorts или youtu.be.</span>
        </label>

        <label className="form-field">
          <span className="form-label">Название комнаты</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={80}
            disabled={busy}
            placeholder="Например, вечерний киносеанс"
          />
          <span className="form-hint">{title.length}/80</span>
        </label>

        {channelId ? (
          <div className="watch-setup-note">
            <Hash size={16} />
            <span>
              Комната появится в канале{channelName ? ` #${channelName}` : ''}. Участники увидят баннер и смогут присоединиться.
            </span>
          </div>
        ) : null}

        <div className="watch-setup-note watch-setup-note-soft">
          <Play size={16} />
          <span>Управлять плеером будет создатель комнаты. Остальные смотрят синхронно и общаются в чате.</span>
        </div>

        {error ? <div className="watch-setup-error">{error}</div> : null}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={closeModal} disabled={busy}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Tv size={16} />}
            {busy ? 'Создаём комнату…' : 'Начать Watch Party'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
