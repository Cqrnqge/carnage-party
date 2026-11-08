export const cx = (...args) => args.filter(Boolean).join(' ');

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
const MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function formatDay(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  if (diff > 1 && diff < 7) return WEEKDAYS[d.getDay()].charAt(0).toUpperCase() + WEEKDAYS[d.getDay()].slice(1);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDayShort(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return formatTime(value);
  if (diff === 1) return 'вчера';
  if (diff < 7) return WEEKDAYS[d.getDay()].slice(0, 2);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
}

export function formatFullDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${formatTime(value)}`;
}

export function formatMembership(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS_NOM[d.getMonth()]} ${d.getFullYear()}`;
}

export function relativeTime(value) {
  if (!value) return '';
  const d = new Date(value);
  const diff = Date.now() - d.getTime();
  if (Number.isNaN(diff)) return '';
  if (diff < 45_000) return 'только что';
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))} мин назад`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} ч назад`;
  if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)} дн назад`;
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

export function initials(name) {
  const value = String(name || '?').replace(/^@/, '').trim();
  if (!value) return '?';
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return value.slice(0, 2).toUpperCase();
}

export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < String(str).length; i++) {
    hash = (hash << 5) - hash + String(str).charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function gradientStyle(user) {
  const accent = user?.accentColor || '#5865f2';
  const hue = (hashString(user?.username || user?.name || 'carnage') * 47) % 360;
  return {
    background: `linear-gradient(135deg, ${accent} 0%, hsl(${hue} 62% 46%) 100%)`,
  };
}

export function isImage(mime = '') {
  return String(mime).startsWith('image/');
}

export function isVideo(mime = '') {
  return String(mime).startsWith('video/');
}

export function isAudio(mime = '') {
  return String(mime).startsWith('audio/');
}

export function isPdf(mime = '', name = '') {
  return mime === 'application/pdf' || /\.pdf$/i.test(name);
}

export function fileExtension(name = '') {
  const match = String(name).match(/\.([a-z0-9]{1,8})$/i);
  return match ? match[1].toUpperCase() : 'FILE';
}

export function pluralRu(count, forms) {
  const n = Math.abs(Number(count) || 0) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function openExternal(url) {
  if (!url) return;
  if (window.desktop?.openExternal) {
    window.desktop.openExternal(url);
  } else if (window.CarnageAndroid?.openExternal) {
    try {
      window.CarnageAndroid.openExternal(url);
    } catch {}
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function pluralMembers(count) {
  return `${count} ${pluralRu(count, ['участник', 'участника', 'участников'])}`;
}

export function voiceChannelMembers(voiceStates, channelId) {
  return voiceStates?.[channelId] || [];
}

export function makeId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const KEY_LABELS = {
  Space: 'Пробел',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'Левый Shift',
  ShiftRight: 'Правый Shift',
  ControlLeft: 'Левый Ctrl',
  ControlRight: 'Правый Ctrl',
  AltLeft: 'Левый Alt',
  AltRight: 'Правый Alt',
  MetaLeft: 'Win',
  MetaRight: 'Win',
  CapsLock: 'Caps Lock',
};

export function keyLabel(code) {
  if (!code) return 'Не назначена';
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}

// Готовит фото к загрузке в профиль: уменьшает, обрезает и сжимает в JPEG,
// чтобы даже снимок с телефона на 10 МБ укладывался в лимит сервера.
export function readImageFile(file, options = {}) {
  const {
    maxSize = 512,
    maxBytes = 700_000,
    square = true,
    quality = 0.9,
    background = '#15121c',
  } = options;

  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Выберите изображение'));
    if (!String(file.type || '').startsWith('image/')) {
      return reject(new Error('Выберите изображение в формате JPG, PNG или WebP'));
    }
    if (file.size > 25 * 1024 * 1024) {
      return reject(new Error('Фото слишком большое — максимум 25 МБ'));
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    const finish = (dataUrl) => {
      URL.revokeObjectURL(objectUrl);
      resolve(dataUrl);
    };
    const failed = (message) => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(message));
    };

    image.onload = () => {
      try {
        let sx = 0;
        let sy = 0;
        let sw = image.naturalWidth || image.width;
        let sh = image.naturalHeight || image.height;
        if (!sw || !sh) {
          failed('Не удалось прочитать изображение');
          return;
        }
        if (square) {
          const side = Math.min(sw, sh);
          sx = Math.round((sw - side) / 2);
          sy = Math.round((sh - side) / 2);
          sw = side;
          sh = side;
        }
        const scale = Math.min(1, maxSize / Math.max(sw, sh));
        const width = Math.max(1, Math.round(sw * scale));
        const height = Math.max(1, Math.round(sh * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);

        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (dataUrl.length > maxBytes) dataUrl = canvas.toDataURL('image/jpeg', 0.76);
        if (dataUrl.length > maxBytes) dataUrl = canvas.toDataURL('image/jpeg', 0.62);
        if (dataUrl.length > maxBytes) {
          failed('Не удалось сжать фото — попробуйте другое изображение');
          return;
        }
        finish(dataUrl);
      } catch {
        failed('Не удалось обработать изображение');
      }
    };
    image.onerror = () => failed('Не удалось открыть фото. Попробуйте JPG или PNG.');
    image.src = objectUrl;
  });
}
