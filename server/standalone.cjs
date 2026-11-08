'use strict';

const path = require('path');
const { startServer } = require('./app.cjs');
const { lanAddresses, vpnAddresses } = require('./network.cjs');

const dataDir = process.env.CARNAGE_DATA_DIR || path.join(__dirname, '..', 'data');
const port = Number(process.env.PORT || process.env.CARNAGE_PORT || 3001);
// 127.0.0.1 — только этот компьютер. 0.0.0.0 — доступ с других ПК в локальной сети.
const host = process.env.CARNAGE_HOST || '127.0.0.1';

startServer({ dataDir, port, host, serveClient: true })
  .then((handle) => {
    console.log('');
    console.log('  Carnage Party server запущен');
    console.log(`  Локально: http://127.0.0.1:${handle.port}`);
    if (host === '0.0.0.0') {
      const addresses = lanAddresses();
      if (addresses.length) {
        console.log('  Для других ПК (IP без VPN):');
        for (const item of addresses) {
          console.log(`    http://${item.address}:${handle.port}  (${item.name})`);
        }
        if (addresses.length > 1) {
          console.log('  Используйте адрес того адаптера, через который клиенты видят этот ПК.');
        }
      } else {
        console.log('  Внешние адреса не найдены — проверьте сетевое подключение.');
        console.log('  VPN-адреса (Amnezia/WireGuard) клиентам не подходят.');
      }
      const vpns = vpnAddresses();
      if (vpns.length) {
        console.log('');
        console.log('  [ВНИМАНИЕ] Активен VPN:');
        for (const item of vpns) {
          console.log(`    ${item.address}  (${item.name})`);
        }
        console.log('  Выключите AmneziaVPN перед запуском сервера, иначе Windows');
        console.log('  может отправить ответы через туннель и физический IP станет недоступен.');
      }
      console.log('  Не забудьте разрешить Node.js в брандмауэре Windows.');
    } else {
      console.log('  Доступ только с этого компьютера.');
      console.log('  Для локальной сети: set CARNAGE_HOST=0.0.0.0 или carnage.bat, пункт 5');
    }
    if (process.env.CARNAGE_SEED_DEMO === '1') {
      console.log('  Демо-данные: CARNAGE_SEED_DEMO=1 (demo / demo1234)');
    }
    console.log('  Остановка: Ctrl+C');
    console.log('');
    const shutdown = async () => {
      await handle.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })
  .catch((err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Порт ${port} уже занят. Задайте другой: set CARNAGE_PORT=3002`);
    } else {
      console.error('Не удалось запустить сервер:', err);
    }
    process.exit(1);
  });
