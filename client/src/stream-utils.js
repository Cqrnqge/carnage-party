export function viewersLabel(count) {
  const value = Math.max(0, Number(count) || 0);
  const mod10 = value % 10;
  const mod100 = value % 100;
  let word = 'зрителей';
  if (mod10 === 1 && mod100 !== 11) word = 'зритель';
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = 'зрителя';
  return `${value} ${word}`;
}

export function sourceLabel(source) {
  if (source === 'both') return 'Экран + камера';
  return source === 'screen' ? 'Демонстрация экрана' : 'Камера';
}

export function sourceShortLabel(source) {
  if (source === 'both') return 'Экран + камера';
  return source === 'screen' ? 'Экран' : 'Камера';
}

export function modeLabel(mode) {
  return mode === 'link' ? 'По ссылке' : 'В программе';
}

export function liveCountLabel(count) {
  return `${Math.max(0, Number(count) || 0)} в эфире`;
}

export function formatElapsed(value) {
  const start = new Date(value).getTime();
  if (!Number.isFinite(start) || start <= 0) return '0:00';
  const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export async function copyText(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      area.style.pointerEvents = 'none';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
