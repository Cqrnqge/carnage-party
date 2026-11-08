import React, { useState } from 'react';
import { Compass, Loader2 } from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../store';
import Modal, { FormField, ModalHeader } from '../ui/Modal';

export default function JoinServerModal() {
  const closeModal = useApp((state) => state.closeModal);
  const addServer = useApp((state) => state.addServer);
  const setActive = useApp((state) => state.setActive);
  const toast = useApp((state) => state.toast);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const value = code.trim().toUpperCase();
    if (!value) return;
    setBusy(true);
    try {
      const data = await api('/api/servers/join', { method: 'POST', body: { code: value } });
      if (data?.server) {
        addServer(data.server, data.channels || []);
        const first = (data.channels || []).find((channel) => channel.type === 'text');
        if (first) setActive({ type: 'channel', id: first.id });
        toast(`Добро пожаловать на «${data.server.name}»`, 'success');
      }
      closeModal();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={closeModal} className="join-server-modal" showClose>
      <ModalHeader
        title="Присоединиться к серверу"
        subtitle="Введите код приглашения, который вам прислали."
      />
      <form onSubmit={submit} className="modal-form">
        <FormField label="Код приглашения" hint="Код можно получить у владельца сервера.">
          <div className="input-with-icon">
            <Compass size={17} />
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="Введите код"
              maxLength={32}
              autoFocus
            />
          </div>
        </FormField>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={closeModal}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
            {busy ? <Loader2 size={16} className="spin" /> : <Compass size={16} />}
            {busy ? 'Ищем сервер…' : 'Присоединиться'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
