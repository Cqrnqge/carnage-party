import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppWindow, Monitor, Search, X } from 'lucide-react';
import { useApp } from '../../store';

const EMPTY_SOURCES = [];

function isScreenSource(source) {
  return source?.type === 'screen' || String(source?.id || '').startsWith('screen:');
}

export default function ScreenPicker() {
  const picker = useApp((state) => state.screenPicker);
  const resolve = useApp((state) => state.resolveScreenSource);
  const [tab, setTab] = useState('screen');
  const [query, setQuery] = useState('');

  const sources = picker?.sources || EMPTY_SOURCES;
  const screens = useMemo(() => sources.filter(isScreenSource), [sources]);
  const windows = useMemo(() => sources.filter((source) => !isScreenSource(source)), [sources]);

  useEffect(() => {
    if (!picker) return;
    setQuery('');
    setTab(screens.length || !windows.length ? 'screen' : 'window');
    // Состав источников приходит вместе с новым запросом выбора.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker]);

  useEffect(() => {
    if (!picker) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') resolve('');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [picker, resolve]);

  if (!picker) return null;

  const activeList = tab === 'screen' ? screens : windows;
  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery
    ? activeList.filter((source) => String(source.name || '').toLowerCase().includes(normalizedQuery))
    : activeList;

  return createPortal(
    <div
      className="screen-picker-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) resolve('');
      }}
    >
      <div
        className="screen-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Выбор источника для демонстрации"
      >
        <div className="screen-picker-header">
          <div>
            <h2>Что показываем?</h2>
            <p>Выберите монитор или открытое приложение — зрители увидят его целиком.</p>
          </div>
          <button className="screen-picker-close" onClick={() => resolve('')} title="Отмена">
            <X size={19} />
          </button>
        </div>

        <div className="screen-picker-toolbar">
          <div className="screen-picker-tabs" role="tablist" aria-label="Тип источника">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'screen'}
              className={`screen-picker-tab${tab === 'screen' ? ' active' : ''}`}
              onClick={() => setTab('screen')}
            >
              <Monitor size={15} />
              Экраны
              <span>{screens.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'window'}
              className={`screen-picker-tab${tab === 'window' ? ' active' : ''}`}
              onClick={() => setTab('window')}
            >
              <AppWindow size={15} />
              Приложения
              <span>{windows.length}</span>
            </button>
          </div>

          {sources.length > 6 ? (
            <label className="screen-picker-search">
              <Search size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Найти приложение"
                aria-label="Поиск источника"
              />
            </label>
          ) : null}
        </div>

        <div className="screen-picker-grid">
          {visible.length ? (
            visible.map((source) => {
              const screen = isScreenSource(source);
              const screenIndex = screens.indexOf(source);
              const name = source.name || (screen ? `Монитор ${screenIndex + 1}` : 'Приложение');
              return (
                <button
                  key={source.id}
                  className="screen-source"
                  onClick={() => resolve(source.id)}
                  title={`Показать «${name}»`}
                >
                  <span className="screen-source-preview">
                    {source.thumbnail ? (
                      <img src={source.thumbnail} alt="" draggable={false} />
                    ) : screen ? (
                      <Monitor size={44} />
                    ) : (
                      <AppWindow size={44} />
                    )}
                    {!screen && source.icon ? (
                      <img className="screen-source-appicon" src={source.icon} alt="" draggable={false} />
                    ) : null}
                    <span className="screen-source-action">Показать</span>
                  </span>
                  <span className="screen-source-meta">
                    <span className="screen-source-name">
                      {screen ? `Монитор ${screenIndex + 1}` : name}
                    </span>
                    <span className="screen-source-sub">
                      {screen ? name : 'Открытое приложение'}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="screen-picker-empty">
              {normalizedQuery
                ? 'Ничего не найдено — попробуйте другое название.'
                : tab === 'window'
                  ? 'Открытых приложений не найдено. Запустите нужную программу и попробуйте снова.'
                  : 'Мониторы не найдены.'}
            </div>
          )}
        </div>

        <div className="screen-picker-footer">
          <span>Показ начнётся сразу после выбора источника.</span>
          <button className="btn btn-ghost" onClick={() => resolve('')}>Отмена</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
