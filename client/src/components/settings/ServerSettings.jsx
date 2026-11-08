import React, { useEffect, useState } from 'react';
import { Info, Loader2, RefreshCw, Server, Smartphone } from 'lucide-react';
import { setServerBase } from '../../api';
import { useApp } from '../../store';
import { FormField } from '../ui/Modal';

export default function ServerSettings({ onDone }) {
  const toast = useApp((state) => state.toast);
  const [info, setInfo] = useState(null);
  const [url, setUrl] = useState(() => {
    try {
      return window.CarnageAndroid?.getServerUrl?.() || '';
    } catch {
      return '';
    }
  });
  const [busy, setBusy] = useState(false);

  const android = Boolean(window.CarnageAndroid?.getServerUrl);
  const available = Boolean(window.desktop?.getServerConfig && window.desktop?.setServer);

  useEffect(() => {
    if (!available) return undefined;
    let cancelled = false;
    window.desktop
      .getServerConfig()
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
        setUrl(data.mode === 'remote' ? data.current : data.defaultUrl || '');
      })
      .catch((err) => {
        if (!cancelled) toast(`Не удалось прочитать настройки сервера: ${err.message}`, 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [available, toast]);

  if (android) {
    const current = (() => {
      try {
        return window.CarnageAndroid.getServerUrl();
      } catch {
        return url;
      }
    })();

    const saveMobile = () => {
      const value = url.trim();
      if (!value) {
        toast('Введите адрес сервера', 'error');
        return;
      }
      setBusy(true);
      try {
        let normalized = value;
        if (window.CarnageAndroid.setServerUrl) {
          normalized = window.CarnageAndroid.setServerUrl(value) || value;
        }
        setServerBase(normalized);
        toast('Адрес сохранён. Перезапускаем приложение…', 'success');
        onDone?.();
        setTimeout(() => window.location.reload(), 350);
      } catch (err) {
        setBusy(false);
        toast(`Не удалось сохранить адрес: ${err.message}`, 'error');
      }
    };

    return (
      <div className="server-settings">
        <div className="settings-note">
          <Smartphone size={16} />
          <span>
            Android-клиент · сейчас: <b>{current}</b>
          </span>
        </div>

        <FormField
          label="Адрес сервера"
          hint="Например: http://188.234.161.207:3001. Телефон и сервер должны быть в одной сети или сервер должен быть доступен из интернета."
        >
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="http://188.234.161.207:3001"
            spellCheck={false}
            autoComplete="off"
            inputMode="url"
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveMobile();
            }}
          />
        </FormField>

        <div className="server-actions">
          <button type="button" className="btn btn-primary" onClick={saveMobile} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            Сохранить и перезапустить
          </button>
        </div>

        <div className="settings-note">
          <Info size={16} />
          <span>
            Адрес хранится на телефоне. После сохранения интерфейс перезагрузится и подключится
            к новому серверу. Сменить адрес можно и на экране входа.
          </span>
        </div>
      </div>
    );
  }

  if (!available) {
    return (
      <div className="settings-note">
        <Info size={16} />
        <span>В браузере адрес сервера задаётся при открытии страницы. В приложении Carnage Party его можно сменить здесь.</span>
      </div>
    );
  }

  const currentLabel = info?.current || 'подключение…';

  const connect = async () => {
    const value = url.trim();
    if (!value) {
      toast('Введите адрес сервера', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await window.desktop.setServer({ mode: 'remote', url: value });
      if (!result?.ok) {
        toast(result?.error || 'Не удалось подключиться к серверу', 'error');
        return;
      }
      if (result.restarted) {
        toast('Адрес сохранён. Приложение перезапустится, чтобы применить настройки…', 'info');
      } else {
        toast('Подключаюсь к серверу…', 'success');
        onDone?.();
      }
    } catch (err) {
      toast(`Ошибка подключения: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="server-settings">
      <div className="settings-note">
        <Server size={16} />
        <span>
          Сейчас: {currentLabel}
          {info?.portable ? ' · portable-версия' : ''}
        </span>
      </div>

      <FormField
        label="Адрес сервера"
        hint="Например: http://188.234.161.207:3001. Адрес должен быть доступен с этого компьютера."
      >
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={info?.defaultUrl || 'http://188.234.161.207:3001'}
          spellCheck={false}
          autoComplete="off"
          onKeyDown={(event) => {
            if (event.key === 'Enter') connect();
          }}
        />
      </FormField>

      <div className="server-actions">
        <button type="button" className="btn btn-primary" onClick={connect} disabled={busy}>
          {busy ? <Loader2 size={15} className="spin" /> : <Server size={15} />}
          Подключиться
        </button>
      </div>

      <div className="settings-note">
        <Info size={16} />
        <span>
          По умолчанию: {info?.defaultUrl || '—'}. Приложение не запускает локальный сервер:
          если сервер выключен, появится экран «Сервер выключен или недоступен». Для голоса
          и экрана по <b>http://</b> нужен Electron-клиент — в браузере требуется HTTPS.
        </span>
      </div>
    </div>
  );
}
