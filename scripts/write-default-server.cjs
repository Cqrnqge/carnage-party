'use strict';

const fs = require('fs');
const path = require('path');
const { primaryLanAddress } = require('../server/network.cjs');

const port = Number(process.env.CARNAGE_PORT || 3001);
let url = String(process.env.CARNAGE_DEFAULT_SERVER || '').trim();

if (!url) {
  const address = primaryLanAddress();
  if (!address) {
    console.error('');
    console.error('  [default-server] Не найден физический IP без VPN.');
    console.error('  Подключите Ethernet/Wi-Fi или задайте CARNAGE_DEFAULT_SERVER.');
    console.error('');
    process.exit(1);
  }
  url = `http://${address}:${port}`;
}

if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
url = url.replace(/\/+$/, '');

const file = path.join(__dirname, '..', 'electron', 'default-server.txt');
fs.writeFileSync(file, `${url}\r\n`, 'utf8');
console.log(`[default-server] Адрес по умолчанию: ${url}`);
console.log(`[default-server] Записан: ${file}`);
