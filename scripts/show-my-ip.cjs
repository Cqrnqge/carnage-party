'use strict';

const { lanAddresses } = require('../server/network.cjs');

const port = Number(process.env.CARNAGE_PORT || 3001);
const addresses = lanAddresses();

if (!addresses.length) {
  console.error('');
  console.error('  Не найден физический сетевой адаптер с IPv4.');
  console.error('  Проверьте, что Ethernet или Wi-Fi подключён.');
  console.error('  VPN-адреса (Amnezia/WireGuard) для клиентов не подходят.');
  console.error('');
  process.exit(1);
}

const url = `http://${addresses[0].address}:${port}`;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ port, addresses, url }, null, 2));
} else {
  console.log('');
  console.log('  IP без VPN (физический адаптер):');
  for (const item of addresses) {
    console.log(`    ${item.address}  — ${item.name}`);
  }
  console.log('');
  console.log(`  Адрес сервера для клиентов: ${url}`);
  console.log('');
  console.log('  VPN-адреса (Amnezia/WireGuard) не используются:');
  console.log('  снаружи туннеля они недоступны.');
  console.log('');
}
