// Геометрия перетаскиваемых окон трансляции. Вынесено из компонента,
// чтобы одинаково считать движение и растягивание за любую сторону.

export const PIP_MIN_WIDTH = 0.12;
export const PIP_MAX_WIDTH = 0.6;
export const CHAT_MIN_WIDTH = 0.16;
export const CHAT_MIN_HEIGHT = 0.18;
export const CHAT_MAX_WIDTH = 0.85;
export const CHAT_MAX_HEIGHT = 0.88;

const EDGE = 0.005;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function movePipLayout(start, dx, dy, heightPerWidth) {
  const ratio = Number.isFinite(heightPerWidth) && heightPerWidth > 0 ? heightPerWidth : 9 / 16;
  const height = start.w * ratio;
  return {
    x: clamp(start.x + dx, EDGE, 0.995 - start.w),
    y: clamp(start.y + dy, EDGE, 0.995 - height),
    w: start.w,
  };
}

export function resizePipLayout(start, dx, dy, direction, heightPerWidth) {
  const dir = String(direction || 'se');
  const ratio = Number.isFinite(heightPerWidth) && heightPerWidth > 0 ? heightPerWidth : 9 / 16;
  const right = start.x + start.w;
  const bottom = start.y + start.w * ratio;
  const candidates = [];
  if (dir.includes('e')) candidates.push(start.w + dx);
  if (dir.includes('w')) candidates.push(start.w - dx);
  if (dir.includes('s')) candidates.push(start.w + dy / ratio);
  if (dir.includes('n')) candidates.push(start.w - dy / ratio);

  // Для углов берём более заметное изменение из двух осей — так камера
  // одинаково хорошо слушается и горизонтального, и вертикального движения.
  let width = candidates.length
    ? candidates.reduce(
        (best, value) =>
          Math.abs(value - start.w) > Math.abs(best - start.w) ? value : best,
        start.w
      )
    : start.w;

  let maxWidth = PIP_MAX_WIDTH;
  if (dir.includes('e')) maxWidth = Math.min(maxWidth, 0.995 - start.x);
  if (dir.includes('w')) maxWidth = Math.min(maxWidth, right - EDGE);
  if (dir.includes('n')) maxWidth = Math.min(maxWidth, (bottom - EDGE) / ratio);
  if (dir.includes('s')) maxWidth = Math.min(maxWidth, (0.995 - start.y) / ratio);
  // При растягивании только сверху/снизу окно не должно вылезти вправо,
  // а при растягивании только по горизонтали — вниз.
  if (!dir.includes('e') && !dir.includes('w')) {
    maxWidth = Math.min(maxWidth, 0.995 - start.x);
  }
  if (!dir.includes('n') && !dir.includes('s')) {
    maxWidth = Math.min(maxWidth, (0.995 - start.y) / ratio);
  }
  maxWidth = Math.max(PIP_MIN_WIDTH, maxWidth);

  width = clamp(width, PIP_MIN_WIDTH, maxWidth);
  let x = dir.includes('w') ? right - width : start.x;
  let y = dir.includes('n') ? bottom - width * ratio : start.y;
  x = clamp(x, EDGE, 0.995 - width);
  y = clamp(y, EDGE, 0.995 - width * ratio);
  return { x, y, w: width };
}

export function moveChatLayout(start, dx, dy) {
  return {
    x: clamp(start.x + dx, EDGE, 0.995 - start.w),
    y: clamp(start.y + dy, EDGE, 0.995 - start.h),
    w: start.w,
    h: start.h,
  };
}

export function resizeChatLayout(start, dx, dy, direction) {
  const dir = String(direction || 'se');
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  let x = start.x;
  let y = start.y;
  let w = start.w;
  let h = start.h;

  if (dir.includes('e')) w = start.w + dx;
  if (dir.includes('s')) h = start.h + dy;
  if (dir.includes('w')) {
    w = start.w - dx;
    x = right - w;
  }
  if (dir.includes('n')) {
    h = start.h - dy;
    y = bottom - h;
  }

  let maxWidth = CHAT_MAX_WIDTH;
  let maxHeight = CHAT_MAX_HEIGHT;
  if (dir.includes('e')) maxWidth = Math.min(maxWidth, 0.995 - start.x);
  if (dir.includes('w')) maxWidth = Math.min(maxWidth, right - EDGE);
  if (dir.includes('s')) maxHeight = Math.min(maxHeight, 0.995 - start.y);
  if (dir.includes('n')) maxHeight = Math.min(maxHeight, bottom - EDGE);
  maxWidth = Math.max(CHAT_MIN_WIDTH, maxWidth);
  maxHeight = Math.max(CHAT_MIN_HEIGHT, maxHeight);

  w = clamp(w, CHAT_MIN_WIDTH, maxWidth);
  h = clamp(h, CHAT_MIN_HEIGHT, maxHeight);
  if (dir.includes('w')) x = right - w;
  if (dir.includes('n')) y = bottom - h;
  x = clamp(x, EDGE, 0.995 - w);
  y = clamp(y, EDGE, 0.995 - h);
  return { x, y, w, h };
}
