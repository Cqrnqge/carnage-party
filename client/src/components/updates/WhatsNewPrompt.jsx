import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import Modal from '../ui/Modal';
import { serverUrl } from '../../api';
import { compareVersions } from '../../updates';
import { appVersion } from '../../version';
import localChangelog from '../../changelog.json';

const SEEN_KEY = 'carnage_seen_version';
const PENDING_KEY = 'carnage_pending_version';
const CHECK_DELAY = 1200;

function hasAppHistory() {
  try {
    return Boolean(
      localStorage.getItem('carnage_token') ||
        localStorage.getItem('carnage_settings') ||
        localStorage.getItem('carnage_last_user')
    );
  } catch {
    return false;
  }
}

// Показывает список изменений один раз после установки новой версии.
export default function WhatsNewPrompt() {
  const [info, setInfo] = useState(null);
  const shown = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (shown.current) return;
      const current = appVersion();
      let seen = '';
      let pending = '';
      try {
        seen = localStorage.getItem(SEEN_KEY) || '';
        pending = localStorage.getItem(PENDING_KEY) || '';
      } catch {}

      const installedByUpdate =
        pending && compareVersions(current, pending) === 0;
      const versionChanged = seen ? compareVersions(current, seen) > 0 : hasAppHistory();
      const updated = Boolean(installedByUpdate || versionChanged);

      try {
        localStorage.setItem(SEEN_KEY, current);
        localStorage.removeItem(PENDING_KEY);
      } catch {}

      if (!updated || cancelled) return;
      shown.current = true;

      let notes = Array.isArray(localChangelog[current]) ? localChangelog[current] : [];
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const response = await fetch(serverUrl('/api/version'), {
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (response.ok) {
          const data = await response.json();
          const remote = data?.changelog?.[current];
          if (Array.isArray(remote) && remote.length) {
            notes = remote.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20);
          }
        }
      } catch {}

      if (!cancelled) {
        setInfo({
          version: current,
          from: seen && compareVersions(current, seen) > 0 ? seen : '',
          notes,
        });
      }
    }, CHECK_DELAY);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (!info) return null;

  const close = () => setInfo(null);

  return (
    <Modal
      onClose={close}
      className="update-modal whats-new-modal"
      overlayClassName="update-overlay"
      showClose
      closeOnOverlay
      closeOnEscape
    >
      <div className="update-hero">
        <div className="update-icon">
          <CheckCircle2 size={30} />
        </div>
        <div>
          <span className="update-kicker">Carnage Party</span>
          <h2>Обновление установлено</h2>
        </div>
      </div>

      <div className="update-versions">
        {info.from ? (
          <>
            <span className="update-version old">v{info.from}</span>
            <ArrowRight size={17} />
          </>
        ) : null}
        <span className="update-version new">v{info.version}</span>
      </div>

      <div className="update-changelog">
        <h3>Что нового в v{info.version}</h3>
        {info.notes.length ? (
          <ul>
            {info.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        ) : (
          <p>Улучшения и исправления.</p>
        )}
      </div>

      <div className="update-actions">
        <button type="button" className="btn btn-primary" onClick={close}>
          Отлично
        </button>
      </div>
    </Modal>
  );
}
