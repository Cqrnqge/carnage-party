import React, { useEffect, useState } from 'react';
import { Loader2, Pin, PinOff, RefreshCw } from 'lucide-react';
import { api } from '../../api';
import { useApp, channelTitle } from '../../store';
import { formatFullDate } from '../../utils';
import Avatar from '../ui/Avatar';
import Modal, { ModalHeader } from '../ui/Modal';

export default function PinsModal({ channelId }) {
  const channels = useApp((state) => state.channels);
  const dms = useApp((state) => state.dms);
  const user = useApp((state) => state.user);
  const closeModal = useApp((state) => state.closeModal);
  const setPendingJump = useApp((state) => state.setPendingJump);
  const updateMessage = useApp((state) => state.updateMessage);
  const toast = useApp((state) => state.toast);
  const channel = [...channels, ...dms].find((item) => item.id === channelId);
  const [messages, setMessages] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api(`/api/channels/${channelId}/pins`);
      setMessages(data.messages || []);
    } catch (err) {
      toast(err.message, 'error');
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [channelId]);

  const unpin = async (message) => {
    try {
      const data = await api(`/api/messages/${message.id}/pin`, { method: 'PATCH', body: { pinned: false } });
      if (data?.message) updateMessage({ message: data.message });
      setMessages((current) => (current || []).filter((item) => item.id !== message.id));
      toast('Сообщение откреплено', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const jump = (message) => {
    closeModal();
    setPendingJump(message.channelId, message.id);
  };

  return (
    <Modal onClose={closeModal} className="pins-modal" showClose>
      <ModalHeader
        title="Закреплённые сообщения"
        subtitle={channel ? channelTitle({ user }, channel) : ''}
      >
        <button className="icon-btn" onClick={load} title="Обновить"><RefreshCw size={17} /></button>
      </ModalHeader>
      {loading ? (
        <div className="modal-loading"><Loader2 size={22} className="spin" /> Загружаем…</div>
      ) : (messages || []).length === 0 ? (
        <div className="pins-empty">
          <Pin size={38} />
          <h3>Пока нет закреплённых сообщений</h3>
          <p>Нажмите «Закрепить» в меню сообщения — оно появится здесь.</p>
        </div>
      ) : (
        <div className="pins-list">
          {messages.map((message) => (
            <div className="pin-row" key={message.id}>
              <button className="pin-main" onClick={() => jump(message)}>
                <Avatar user={message.author} size={32} />
                <div>
                  <div className="pin-head">
                    <strong>{message.author?.displayName}</strong>
                    <span>{formatFullDate(message.createdAt)}</span>
                  </div>
                  <p>{message.content || 'Вложение'}</p>
                  {message.attachments?.length ? (
                    <span className="pin-attachment">Вложений: {message.attachments.length}</span>
                  ) : null}
                </div>
              </button>
              <button className="icon-btn" onClick={() => unpin(message)} title="Открепить">
                <PinOff size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
