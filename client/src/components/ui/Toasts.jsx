import React from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useApp } from '../../store';
import { cx } from '../../utils';

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export default function Toasts() {
  const toasts = useApp((state) => state.toasts);
  const dismiss = useApp((state) => state.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type] || Info;
        return (
          <div key={toast.id} className={cx('toast', toast.type)}>
            <Icon size={18} />
            <span>{toast.message}</span>
            <button className="icon-btn" onClick={() => dismiss(toast.id)} aria-label="Закрыть">
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
