'use strict';

const os = require('os');

// Виртуальные адаптеры VPN, туннелей и виртуальных машин.
// Их адреса (например, 172.16.0.2 у AmneziaVPN) нельзя давать клиентам:
// снаружи VPN-туннеля они недоступны.
const VIRTUAL_INTERFACE = /(amnezia|wireguard|wintun|openvpn|\bvpn\b|\btun\b|\btap\b|tailscale|zerotier|radmin|hamachi|clash|outline|warp|nord|proton|virtual|vmware|virtualbox|hyper-v|docker|veth|loopback)/i;

function ipv4Of(items) {
  return (items || []).find(
    (item) =>
      item.family === 'IPv4' &&
      !item.internal &&
      !String(item.address).startsWith('127.') &&
      !String(item.address).startsWith('169.254.')
  );
}

/**
 * IPv4-адреса только физических сетевых адаптеров.
 * VPN-адаптеры (Amnezia, WireGuard и т.п.) отбрасываются по имени
 * и по пустому MAC-адресу.
 */
function lanAddresses() {
  const result = [];
  for (const [name, items] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    const ipv4 = ipv4Of(items);
    if (!ipv4) continue;
    if (!ipv4.mac || ipv4.mac === '00:00:00:00:00:00') continue;
    result.push({ address: ipv4.address, name, mac: ipv4.mac });
  }
  // Проводной Ethernet обычно стабильнее Wi-Fi — ставим его первым.
  return result.sort((a, b) => {
    const rank = (item) => (/wi-?fi|wireless|wlan/i.test(item.name) ? 1 : 0);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
}

function primaryLanAddress() {
  return lanAddresses()[0]?.address || '';
}

/**
 * Активные IPv4-адреса VPN/туннелей. Нужны только для предупреждения:
 * при включённом VPN Windows может отправлять ответы через туннель,
 * и физический IP перестаёт быть доступен снаружи.
 */
function vpnAddresses() {
  const result = [];
  for (const [name, items] of Object.entries(os.networkInterfaces())) {
    if (!VIRTUAL_INTERFACE.test(name) || /loopback/i.test(name)) continue;
    const ipv4 = ipv4Of(items);
    if (!ipv4) continue;
    result.push({ address: ipv4.address, name, mac: ipv4.mac });
  }
  return result;
}

module.exports = { lanAddresses, primaryLanAddress, vpnAddresses };
