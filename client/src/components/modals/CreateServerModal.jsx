import React, { useRef, useState } from 'react';
import { Camera, Check, Loader2, Plus, Shield } from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../store';
import { SERVER_ACCENTS } from '../../constants';
import { cx } from '../../utils';
import Modal, { FormField, ModalHeader } from '../ui/Modal';
import { ServerIcon } from '../ui/Avatar';

export default function CreateServerModal() {
  const closeModal = useApp((state) => state.closeModal);
  const addServer = useApp((state) => state.addServer);
  const setActive = useApp((state) => state.setActive);
  const toast = useApp((state) => state.toast);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(null);
  const [accentColor, setAccentColor] = useState(SERVER_ACCENTS[0]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const pickIcon = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Выберите изображение', 'error');
    if (file.size > 500 * 1024) return toast('Иконка должна быть меньше 500 КБ', 'error');
    const reader = new FileReader();
    reader.onload = () => setIcon(String(reader.result));
    reader.readAsDataURL(file);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (name.trim().length < 2) return toast('Название сервера должно быть не короче 2 символов', 'error');
    setBusy(true);
    try {
      const data = await api('/api/servers', {
        method: 'POST',
        body: { name: name.trim(), icon, accentColor },
      });
      if (data?.server) {
        addServer(data.server, data.channels || []);
        const first = (data.channels || []).find((channel) => channel.type === 'text');
        if (first) setActive({ type: 'channel', id: first.id });
        toast(`Сервер «${data.server.name}» создан`, 'success');
      }
      closeModal();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={closeModal} className="create-server-modal" showClose>
      <ModalHeader
        title="Создайте свой сервер"
        subtitle="Это место для вашей стаи: каналы, голосовые комнаты, роли и мемы."
      />
      <form onSubmit={submit} className="modal-form">
        <div className="server-icon-editor">
          <ServerIcon server={{ name: name || 'Новый сервер', icon, accentColor }} size={84} />
          <div>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => fileRef.current?.click()}>
              <Camera size={15} /> Загрузить иконку
            </button>
            <p className="form-hint">PNG, JPG или GIF до 500 КБ. Необязательно.</p>
            {icon ? (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setIcon(null)}>Убрать</button>
            ) : null}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => { pickIcon(event.target.files?.[0]); event.target.value = ''; }} />
        </div>

        <FormField label="Название сервера">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Ночная банда" maxLength={64} autoFocus />
        </FormField>

        <div className="settings-label">Цвет сервера</div>
        <div className="color-palette">
          {SERVER_ACCENTS.map((color) => (
            <button
              type="button"
              key={color}
              className={cx('color-swatch', accentColor === color && 'active')}
              style={{ background: color }}
              onClick={() => setAccentColor(color)}
              aria-label={color}
            >
              {accentColor === color ? <Check size={15} /> : null}
            </button>
          ))}
        </div>

        <div className="create-server-perks">
          <span><Shield size={16} /> Владелец получает все права</span>
          <span><Plus size={16} /> Сразу создаются текстовый и голосовой каналы</span>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={closeModal}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
            {busy ? 'Создаём…' : 'Создать сервер'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
