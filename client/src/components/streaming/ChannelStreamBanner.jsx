import React, { useState } from 'react';
import {
  Copy,
  Eye,
  Link2,
  Radio,
  Square,
} from 'lucide-react';
import { useApp } from '../../store';
import { streamBroadcaster } from '../../streaming';
import { copyText, sourceShortLabel, viewersLabel } from '../../stream-utils';
import Avatar from '../ui/Avatar';

export default function ChannelStreamBanner({ channelId }) {
  const streams = useApp((state) => state.streams);
  const myStream = useApp((state) => state.myStream);
  const user = useApp((state) => state.user);
  const setActive = useApp((state) => state.setActive);
  const openModal = useApp((state) => state.openModal);
  const toast = useApp((state) => state.toast);
  const [copiedId, setCopiedId] = useState('');

  const list = (streams || []).filter(
    (stream) => stream.live !== false && stream.channelId === channelId
  );
  if (!list.length) return null;

  const copyLink = async (stream) => {
    const ok = await copyText(stream.url);
    if (!ok) {
      toast('Не удалось скопировать ссылку', 'error');
      return;
    }
    setCopiedId(stream.id);
    toast('Ссылка на трансляцию скопирована', 'success');
    setTimeout(() => setCopiedId(''), 2000);
  };

  const stopStream = (stream) => {
    openModal('confirm', {
      title: 'Остановить трансляцию?',
      text: 'Зрители в канале и по публичной ссылке потеряют доступ к эфиру.',
      confirmText: 'Остановить эфир',
      danger: true,
      onConfirm: async () => {
        await streamBroadcaster.stop({ silent: true });
        toast('Трансляция остановлена', 'info');
      },
    });
  };

  return (
    <div className="channel-streams">
      {list.map((stream) => {
        const mine = myStream?.id === stream.id || stream.owner?.id === user?.id;
        return (
          <div className="channel-stream-banner" key={stream.id}>
            <span className="channel-stream-live">
              <Radio size={14} /> LIVE
            </span>
            <Avatar user={stream.owner} size={30} />
            <div className="channel-stream-text">
              <strong>{stream.title}</strong>
              <span>
                {stream.owner?.displayName || 'Стример'}
                {' · '}
                {sourceShortLabel(stream.source)}
                {' · '}
                {viewersLabel(stream.viewers)}
              </span>
            </div>
            <div className="channel-stream-actions">
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={() => setActive({ type: 'stream', id: stream.id })}
              >
                <Eye size={14} /> Смотреть
              </button>
              {stream.url ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => copyLink(stream)}
                  title="Скопировать публичную ссылку"
                >
                  {copiedId === stream.id ? <Copy size={14} /> : <Link2 size={14} />}
                  {copiedId === stream.id ? 'Готово' : 'Ссылка'}
                </button>
              ) : null}
              {mine ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-small channel-stream-stop"
                  onClick={() => stopStream(stream)}
                  title="Остановить эфир"
                >
                  <Square size={13} /> Остановить
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
