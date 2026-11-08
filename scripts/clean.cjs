'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const targets = [
  path.join(root, 'release'),
  path.join(root, 'client', 'dist'),
  path.join(root, 'dist'),
];

for (const target of targets) {
  if (!fs.existsSync(target)) {
    console.log(`[clean] нет папки: ${path.relative(root, target)}`);
    continue;
  }
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`[clean] удалено: ${path.relative(root, target)}`);
}

console.log('[clean] готово. Данные в data / data-dev не тронуты.');
