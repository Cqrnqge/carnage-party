/* Carnage Party — service worker для Web Push. */
'use strict';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Carnage Party';
  const options = {
    body: payload.body || 'Новое уведомление',
    icon: payload.icon || '/favicon.png',
    badge: payload.icon || '/favicon.png',
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
    data: {
      ...(payload.data || {}),
      url: payload.url || payload.data?.url || '/',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || '/', self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (!client.url.startsWith(self.location.origin)) continue;
        try {
          await client.focus();
          client.postMessage({ type: 'carnage:notification-click', data });
          return;
        } catch {}
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })()
  );
});
