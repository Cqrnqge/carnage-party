import React, { useEffect, useRef } from 'react';
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
  const modalRef = useRef(null);

  useEffect(() => {
    const node = modalRef.current;
    if (!node) return;
    const active = document.activeElement;
    // Модалка открывается поверх чата: если фокус остался в поле под
    // оверлеем, клавиши (в том числе рация) продолжают уходить туда.
    // Забираем фокус себе, но не мешаем autoFocus внутри самой модалки.
    if (active && node.contains(active)) return;
    try {
      active?.blur?.();
    } catch {}
    try {
      node.focus({ preventScroll: true });
    } catch {}
  }, []);

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
      <div ref={modalRef} tabIndex={-1} className={cx('modal', className)} role="dialog" aria-modal="true">
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
