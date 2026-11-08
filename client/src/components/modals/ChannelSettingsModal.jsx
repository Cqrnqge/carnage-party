import React, { useMemo, useState } from 'react';
import { Hash, Loader2, Save, Trash2, Volume2 } from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../store';
import { cx } from '../../utils';
import Modal, { FormField, ModalHeader } from '../ui/Modal';

export default function ChannelSettingsModal({ serverId, channelId = null, create = false, category = '' }) {
  const channels = useApp((state) => state.channels);
  const addChannel = useApp((state) => state.addChannel);
  const removeChannel = useApp((state) => state.removeChannel);
  const setActive = useApp((state) => state.setActive);
  const closeModal = useApp((state) => state.closeModal);
  const toast = useApp((state) => state.toast);
  const channel = channels.find((item) => item.id === channelId);
  const isNew = create || !channel;

  const [name, setName] = useState(channel?.name || '');
  const [type, setType] = useState(channel?.type || 'text');
  const [categoryValue, setCategoryValue] = useState(channel?.category || category || 'Текстовые каналы');
  const [topic, setTopic] = useState(channel?.topic || '');
  const [userLimit, setUserLimit] = useState(channel?.userLimit || 0);
  const [busy, setBusy] = useState(false);

  const categories = useMemo(() => {
    const set = new Set(channels.map((item) => item.category).filter(Boolean));
    set.add('Текстовые каналы');
    set.add('Голосовые каналы');
    return [...set];
  }, [channels]);

  const save = async (event) => {
    event.preventDefault();
    if (!name.trim()) return toast('Введите название канала', 'error');
    setBusy(true);
    try {
      if (isNew) {
        const data = await api(`/api/servers/${serverId}/channels`, {
          method: 'POST',
          body: {
            name: name.trim(),
            type,
            category: categoryValue.trim(),
            topic,
            userLimit,
          },
        });
        if (data?.channel) {
          addChannel(data.channel);
          setActive({ type: 'channel', id: data.channel.id });
        }
        toast('Канал создан', 'success');
      } else {
        const data = await api(`/api/channels/${channel.id}`, {
          method: 'PATCH',
          body: { name: name.trim(), category: categoryValue.trim(), topic, userLimit },
        });
        if (data?.channel) addChannel(data.channel);
        toast('Канал обновлён', 'success');
      }
      closeModal();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    useApp.getState().openModal('confirm', {
      title: 'Удалить канал?',
      text: `Канал «${channel.name}» и вся его история будут удалены без возможности восстановления.`,
      confirmText: 'Удалить',
      danger: true,
      onConfirm: async () => {
        await api(`/api/channels/${channel.id}`, { method: 'DELETE' });
        removeChannel(channel.id);
        useApp.getState().closeModal();
      },
    });
  };

  return (
    <Modal onClose={closeModal} className="channel-settings-modal" showClose>
      <ModalHeader
        title={isNew ? 'Создать канал' : `Настройки канала`}
        subtitle={isNew ? 'Текстовые каналы — для общения, голосовые — для созвонов.' : `#${channel?.name || ''}`}
      />
      <form onSubmit={save} className="modal-form">
        {isNew ? (
          <div className="channel-type-select">
            <button type="button" className={cx('channel-type-card', type === 'text' && 'active')} onClick={() => { setType('text'); setCategoryValue('Текстовые каналы'); }}>
              <Hash size={22} />
              <div><strong>Текстовый</strong><span>Сообщения, файлы, реакции</span></div>
            </button>
            <button type="button" className={cx('channel-type-card', type === 'voice' && 'active')} onClick={() => { setType('voice'); setCategoryValue('Голосовые каналы'); }}>
              <Volume2 size={22} />
              <div><strong>Голосовой</strong><span>Голос, видео и экран</span></div>
            </button>
          </div>
        ) : null}

        <FormField label="Название" hint={type === 'text' && isNew ? 'Пробелы заменятся на дефисы' : undefined}>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} autoFocus />
        </FormField>

        <div className="settings-form-grid">
          <FormField label="Категория">
            <input list="channel-categories" value={categoryValue} onChange={(event) => setCategoryValue(event.target.value)} maxLength={40} />
            <datalist id="channel-categories">
              {categories.map((item) => <option key={item} value={item} />)}
            </datalist>
          </FormField>
          {type === 'voice' ? (
            <FormField label="Лимит участников" hint="0 — без ограничений">
              <input type="number" min="0" max="99" value={userLimit} onChange={(event) => setUserLimit(Number(event.target.value))} />
            </FormField>
          ) : null}
        </div>

        <FormField label="Описание канала" hint={`${topic.length}/1024`}>
          <textarea value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={1024} rows={3} placeholder="О чём этот канал?" />
        </FormField>

        <div className="modal-actions split">
          {!isNew ? (
            <button type="button" className="btn btn-danger" onClick={remove}>
              <Trash2 size={16} /> Удалить канал
            </button>
          ) : <span />}
          <div className="modal-actions-right">
            <button type="button" className="btn btn-ghost" onClick={closeModal}>Отмена</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
              {busy ? 'Сохраняем…' : isNew ? 'Создать канал' : 'Сохранить'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
