import React, { useEffect } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { useApp } from '../../store';
import { voiceManager } from '../../voice';
import { getSocket } from '../../socket';
import Avatar from '../ui/Avatar';
import Modal from '../ui/Modal';

export default function IncomingCallModal() {
  const incoming = useApp((state) => state.incomingCall);
  const addChannel = useApp((state) => state.addChannel);
  const setActive = useApp((state) => state.setActive);
  const clearIncomingCall = useApp((state) => state.clearIncomingCall);

  useEffect(() => {
    if (!incoming) return undefined;
    const timer = setTimeout(() => clearIncomingCall(), 45000);
    return () => clearTimeout(timer);
  }, [incoming?.channelId]);

  if (!incoming) return null;
  const { from, channel, channelId } = incoming;

  const accept = () => {
    clearIncomingCall();
    if (channel) addChannel(channel);
    setActive({ type: 'channel', id: channelId });
    voiceManager.join(channelId);
  };

  const decline = () => {
    clearIncomingCall();
    getSocket()?.emit('call:decline', { channelId });
  };

  return (
    <Modal onClose={decline} overlayClassName="incoming-overlay" className="incoming-call">
      <div className="incoming-pulse">
        <Avatar user={from} size={92} />
        <span className="incoming-ring" />
        <span className="incoming-ring delay" />
      </div>
      <h2>{from?.displayName || 'Пользователь'}</h2>
      <p>Входящий звонок · {channel?.name || 'Личный звонок'}</p>
      <div className="incoming-actions">
        <button className="incoming-btn decline" onClick={decline} title="Отклонить">
          <PhoneOff size={24} />
        </button>
        <button className="incoming-btn accept" onClick={accept} title="Принять">
          <Phone size={24} />
        </button>
      </div>
      <span className="incoming-hint">Нажмите зелёную кнопку, чтобы ответить</span>
    </Modal>
  );
}
