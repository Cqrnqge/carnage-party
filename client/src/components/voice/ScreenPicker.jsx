import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Monitor, X } from 'lucide-react';
import { useApp } from '../../store';

export default function ScreenPicker() {
  const picker = useApp((state) => state.screenPicker);
  const resolve = useApp((state) => state.resolveScreenSource);

  useEffect(() => {
    if (!picker) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') resolve('');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [picker, resolve]);

  if (!picker) return null;

  return createPortal(
    <div
      className="screen-picker-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) resolve('');
      }}
    >
      <div className="screen-picker" role="dialog" aria-modal="true" aria-label="Выбор монитора для трансляции">
        <div className="screen-picker-header">
          <div>
            <h2>Что показываем?</h2>
            <p>Выберите монитор — зрители увидят его целиком.</p>
          </div>
          <button className="screen-picker-close" onClick={() => resolve('')} title="Отмена">
            <X size={19} />
          </button>
        </div>

        <div className="screen-picker-grid">
          {picker.sources.map((source, index) => (
            <button
              key={source.id}
              className="screen-source"
              onClick={() => resolve(source.id)}
              title={`Показать «${source.name || `Монитор ${index + 1}`}»`}
            >
              <span className="screen-source-preview">
                {source.thumbnail ? (
                  <img src={source.thumbnail} alt="" draggable={false} />
                ) : (
                  <Monitor size={44} />
                )}
                <span className="screen-source-action">Показать</span>
              </span>
              <span className="screen-source-meta">
                <span className="screen-source-name">Монитор {index + 1}</span>
                {source.name ? <span className="screen-source-sub">{source.name}</span> : null}
              </span>
            </button>
          ))}
        </div>

        <div className="screen-picker-footer">
          <span>Трансляция начнётся сразу после выбора монитора.</span>
          <button className="btn btn-ghost" onClick={() => resolve('')}>Отмена</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
