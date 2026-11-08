import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from '../../utils';

export default function Modal({
  children,
  onClose,
  className = '',
  overlayClassName = '',
  closeOnOverlay = true,
  closeOnEscape = true,
  showClose = false,
  hideHeader = false,
}) {
  useEffect(() => {
    if (!closeOnEscape) return undefined;
    const handler = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closeOnEscape, onClose]);

  return createPortal(
    <div
      className={cx('modal-overlay', overlayClassName)}
      onMouseDown={(event) => {
        if (closeOnOverlay && event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className={cx('modal', className)} role="dialog" aria-modal="true">
        {showClose ? (
          <button className="modal-close icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        ) : null}
        {children}
      </div>
    </div>,
    document.body
  );
}

export function ModalHeader({ title, subtitle, children }) {
  return (
    <div className="modal-header">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function FormField({ label, hint, error, children }) {
  return (
    <label className="form-field">
      {label ? <span className="form-label">{label}</span> : null}
      {children}
      {hint && !error ? <span className="form-hint">{hint}</span> : null}
      {error ? <span className="form-error">{error}</span> : null}
    </label>
  );
}
