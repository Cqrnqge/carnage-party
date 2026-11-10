import { api, serverUrl } from './api';

// Web Push: подписка браузера через service worker и VAPID-ключ сервера.
// В Electron и обычном браузере работает при secure context (https или localhost).

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function pushSupported() {
  return Boolean(
    typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
  );
}

export async function getPushKey() {
  try {
    const data = await api('/api/push/key');
    return {
      enabled: Boolean(data?.enabled),
      publicKey: String(data?.publicKey || ''),
    };
  } catch {
    return { enabled: false, publicKey: '' };
  }
}

async function registerWorker() {
  const scope = serverUrl('/');
  const registration = await navigator.serviceWorker.register(serverUrl('/sw.js'), {
    scope,
  });
  await navigator.serviceWorker.ready;
  return registration;
}

export async function getPushSubscription() {
  if (!pushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration(serverUrl('/'));
    return (await registration?.pushManager?.getSubscription?.()) || null;
  } catch {
    return null;
  }
}

export async function enablePush({ notifyAll = false } = {}) {
  if (!pushSupported()) {
    throw new Error('Push не поддерживается этим клиентом');
  }
  if (!window.isSecureContext) {
    throw new Error('Push работает только по HTTPS или на localhost');
  }
  const key = await getPushKey();
  if (!key.enabled || !key.publicKey) {
    throw new Error('Push-уведомления на сервере не настроены');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Разрешение на уведомления не выдано');
  }

  const registration = await registerWorker();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key.publicKey),
    });
  }

  await api('/api/push/subscribe', {
    method: 'POST',
    body: { subscription: subscription.toJSON(), notifyAll },
  });
  return subscription;
}

export async function disablePush() {
  const subscription = await getPushSubscription();
  if (subscription) {
    try {
      await api('/api/push/unsubscribe', {
        method: 'POST',
        body: { endpoint: subscription.endpoint },
      });
    } catch {}
    try {
      await subscription.unsubscribe();
    } catch {}
  }
}

// Обновляет флаг «уведомлять обо всех сообщениях» у уже созданной подписки.
export async function syncPushPreferences({ notifyAll = false } = {}) {
  const subscription = await getPushSubscription();
  if (!subscription) return false;
  try {
    await api('/api/push/subscribe', {
      method: 'POST',
      body: { subscription: subscription.toJSON(), notifyAll },
    });
    return true;
  } catch {
    return false;
  }
}

export async function sendTestPush() {
  return api('/api/push/test', { method: 'POST' });
}

export async function pushState() {
  const supported = pushSupported();
  const key = supported ? await getPushKey() : { enabled: false, publicKey: '' };
  const subscription = supported ? await getPushSubscription() : null;
  return {
    supported,
    secure: typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false,
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
    serverEnabled: Boolean(key.enabled),
    subscribed: Boolean(subscription),
  };
}
