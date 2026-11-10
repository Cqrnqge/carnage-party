// Версия клиента: сначала собственная версия приложения (desktop/Android),
// затем версия собранного клиента. Это не даёт серверной сборке клиента
// подменить версию установленного приложения при проверке обновлений.
export function appVersion() {
  try {
    const desktop = String(window.desktop?.version || '').trim();
    if (desktop) return desktop;
  } catch {}
  try {
    const native = String(window.CarnageAndroid?.getVersion?.() || '').trim();
    if (native) return native;
  } catch {}
  try {
    if (typeof __CARNAGE_VERSION__ === 'string' && __CARNAGE_VERSION__) {
      return __CARNAGE_VERSION__;
    }
  } catch {}
  return '1.2.1';
}
