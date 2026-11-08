import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 820px)';

export function isAndroidApp() {
  return typeof window !== 'undefined' && Boolean(window.CarnageAndroid);
}

export function isMobileClient() {
  if (typeof window === 'undefined') return false;
  if (isAndroidApp()) return true;
  try {
    return Boolean(window.matchMedia?.(MOBILE_QUERY).matches);
  } catch {
    return false;
  }
}

export function useMobileClient() {
  const [mobile, setMobile] = useState(isMobileClient);

  useEffect(() => {
    let query = null;
    try {
      query = window.matchMedia(MOBILE_QUERY);
    } catch {}
    const update = () => setMobile(isMobileClient());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    query?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      query?.removeEventListener?.('change', update);
    };
  }, []);

  return mobile;
}

export function openNativeServerSettings() {
  try {
    if (window.CarnageAndroid?.openServerSettings) {
      window.CarnageAndroid.openServerSettings();
      return true;
    }
  } catch {}
  return false;
}
