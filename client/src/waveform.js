const WAVEFORM_BARS = 56;
const MAX_LEVEL_BARS = 4000;

const waveformCache = new Map();
let sharedContext = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedContext || sharedContext.state === 'closed') sharedContext = new Ctx();
  if (sharedContext.state === 'suspended') sharedContext.resume().catch(() => {});
  return sharedContext;
}

function normalizePeaks(peaks) {
  let max = 0;
  for (const peak of peaks) {
    if (peak > max) max = peak;
  }
  if (!max) return peaks.map(() => 0);
  return peaks.map((peak) => {
    const value = Math.min(1, Math.max(0, peak / max));
    return Math.round(Math.pow(value, 0.72) * 1000) / 1000;
  });
}

// Приводит сохранённую волну к нужному числу столбиков без потери формы.
export function fitWaveform(values, bars = WAVEFORM_BARS) {
  const source = Array.isArray(values)
    ? values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.min(1, Math.max(0, value)))
    : [];
  if (!source.length) return [];
  const count = Math.max(1, Math.min(96, Math.round(bars) || WAVEFORM_BARS));
  if (source.length === count) return source;
  if (source.length === 1) return new Array(count).fill(source[0]);
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const position = (index / (count - 1)) * (source.length - 1);
    const low = Math.floor(position);
    const high = Math.min(source.length - 1, low + 1);
    const ratio = position - low;
    const value = source[low] * (1 - ratio) + source[high] * ratio;
    result.push(Math.round(value * 1000) / 1000);
  }
  return result;
}

// Сжимает поток уровней (0..1) в удобное число столбиков волны.
export function downsampleLevels(levels, bars = WAVEFORM_BARS) {
  const source = Array.isArray(levels) ? levels.filter((value) => Number.isFinite(value)) : [];
  if (!source.length) return [];
  const count = Math.max(1, Math.min(96, Math.round(bars) || WAVEFORM_BARS));
  const bucket = source.length / count;
  const averages = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor(index * bucket);
    const end = Math.min(source.length, Math.max(start + 1, Math.floor((index + 1) * bucket)));
    let sum = 0;
    let total = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      sum += source[cursor];
      total += 1;
    }
    averages.push(total ? sum / total : 0);
  }
  return normalizePeaks(averages);
}

// Достаёт реальную волну из аудиофайла. Результат кэшируется по URL.
export function decodeWaveform(url, bars = WAVEFORM_BARS) {
  if (!url) return Promise.resolve(null);
  if (!waveformCache.has(url)) {
    waveformCache.set(
      url,
      (async () => {
        try {
          const response = await fetch(url);
          if (!response.ok) return null;
          const buffer = await response.arrayBuffer();
          const ctx = getAudioContext();
          if (!ctx) return null;
          const decoded = await ctx.decodeAudioData(buffer.slice(0));
          const data = decoded.getChannelData(0);
          const count = Math.max(1, Math.min(96, Math.round(bars) || WAVEFORM_BARS));
          const bucket = data.length / count;
          const peaks = [];
          for (let index = 0; index < count; index += 1) {
            const start = Math.floor(index * bucket);
            const end = Math.min(data.length, Math.max(start + 1, Math.floor((index + 1) * bucket)));
            const stride = Math.max(1, Math.floor((end - start) / 2000));
            let peak = 0;
            for (let cursor = start; cursor < end; cursor += stride) {
              const value = Math.abs(data[cursor]);
              if (value > peak) peak = value;
            }
            peaks.push(peak);
          }
          return normalizePeaks(peaks);
        } catch {
          return null;
        }
      })()
    );
  }
  return waveformCache.get(url);
}

export { WAVEFORM_BARS, MAX_LEVEL_BARS };
