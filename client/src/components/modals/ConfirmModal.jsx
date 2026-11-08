import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useApp } from '../../store';
import Modal from '../ui/Modal';

export default function ConfirmModal({ title, text, confirmText = 'Подтвердить', cancelText = 'Отмена', danger = false, onConfirm }) {
  const closeModal = useApp((state) => state.closeModal);
  const toast = useApp((state) => state.toast);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm?.();
      closeModal();
    } catch (err) {
      toast(err.message || 'Не удалось выполнить действие', 'error');
      setBusy(false);
    }
  };

  return (
    <Modal onClose={closeModal} className="confirm-modal" showClose>
      <div className="confirm-icon" style={danger ? { background: 'rgba(242,63,67,.14)', color: '#f23f43' } : undefined}>
        <AlertTriangle size={28} />
      </div>
      <h2>{title || 'Подтвердите действие'}</h2>
      <p>{text}</p>
      <div className="confirm-actions">
        <button className="btn btn-secondary" onClick={closeModal} disabled={busy}>{cancelText}</button>
        <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={confirm} disabled={busy}>
          {busy ? 'Выполняем…' : confirmText}
        </button>
      </div>
    </Modal>
  );
}
