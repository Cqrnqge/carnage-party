'use strict';

const fs = require('fs');
const path = require('path');

// Имена файлов обновлений фиксированы, чтобы сервер мог автоматически
// определить платформу и версию. Достаточно положить файл в папку updates.
const PLATFORM_FILES = [
  {
    platform: 'windows',
    pattern: /^Carnage-Party-Setup-(\d+\.\d+\.\d+)\.exe$/i,
  },
  {
    platform: 'portable',
    pattern: /^Carnage-Party-Portable-(\d+\.\d+\.\d+)\.(zip|exe)$/i,
  },
  {
    platform: 'android',
    pattern: /^Carnage-Party-Mobile-(\d+\.\d+\.\d+)\.apk$/i,
  },
];

function parseVersion(value) {
  const match = String(value || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

function readNotes(dir) {
  try {
    const text = fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8').trim();
    return text.slice(0, 4000);
  } catch {
    return '';
  }
}

// Необязательный changelog.json: { "1.1.1": ["Пункт 1", "Пункт 2"] }.
// Показывается в окне обновления для конкретной версии.
function readChangelog(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'changelog.json'), 'utf8'));
    const result = {};
    for (const [version, value] of Object.entries(parsed || {})) {
      if (!parseVersion(version)) continue;
      const lines = (Array.isArray(value) ? value : [value])
        .map((item) => String(item ?? '').trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((item) => item.slice(0, 300));
      if (lines.length) result[version] = lines;
    }
    return result;
  } catch {
    return {};
  }
}

// Сканирует папку при каждом запросе: новый файл начинает раздаваться
// сразу, без перезапуска сервера.
function scanReleases(dir) {
  const releases = {};
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return releases;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    for (const { platform, pattern } of PLATFORM_FILES) {
      const match = entry.name.match(pattern);
      if (!match) continue;
      const version = match[1];
      const isZip = platform === 'portable' && String(match[2] || '').toLowerCase() === 'zip';
      const candidate = {
        version,
        file: entry.name,
        url: `/updates/${encodeURIComponent(entry.name)}`,
        size: 0,
        archive: isZip,
      };
      try {
        candidate.size = fs.statSync(path.join(dir, entry.name)).size;
      } catch {}
      const current = releases[platform];
      if (!current) {
        releases[platform] = candidate;
        break;
      }
      const byVersion = compareVersions(candidate.version, current.version);
      // При равной версии ZIP портативной сборки предпочтительнее EXE:
      // его проще распаковать поверх старой папки.
      if (byVersion > 0 || (byVersion === 0 && isZip && !current.archive)) {
        releases[platform] = candidate;
      }
      break;
    }
  }

  for (const release of Object.values(releases)) {
    delete release.archive;
  }
  return releases;
}

function updateInfo(dir, appVersion) {
  const releases = scanReleases(dir);
  const changelog = readChangelog(dir);
  let latest = appVersion;
  for (const release of Object.values(releases)) {
    if (compareVersions(release.version, latest) > 0) latest = release.version;
    release.notes = changelog[release.version] || [];
  }
  return {
    app: 'Carnage Party',
    version: appVersion,
    latest,
    notes: readNotes(dir),
    changelog,
    releases,
  };
}

module.exports = {
  compareVersions,
  parseVersion,
  scanReleases,
  updateInfo,
};
