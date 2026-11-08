import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../utils';

export default function ContextMenu({ x, y, items = [], onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, visible: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    setPos({ left, top, visible: true });
  }, [x, y, items.length]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onClose || (() => {}));
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onClose || (() => {}));
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.left, top: pos.top, opacity: pos.visible ? 1 : 0 }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (item === 'separator') return <div className="context-separator" key={`sep-${index}`} />;
        if (!item) return null;
        return (
          <button
            key={item.key || `${item.label}-${index}`}
            className={cx('context-item', item.danger && 'danger', item.className)}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose?.();
              item.onClick?.();
            }}
          >
            <span className="context-icon">{item.icon}</span>
            <span className="context-label">{item.label}</span>
            {item.hint ? <span className="context-hint">{item.hint}</span> : null}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
