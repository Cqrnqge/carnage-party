'use strict';

const crypto = require('crypto');

const DEFAULT_STUN = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

function splitUrls(value) {
  return String(value || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function makeIceConfig(userId = 'guest') {
  const stunUrls = splitUrls(process.env.CARNAGE_STUN_URLS);
  const turnUrls = splitUrls(process.env.CARNAGE_TURN_URLS);
  const iceServers = [{ urls: stunUrls.length ? stunUrls : DEFAULT_STUN }];
  let ttl = 0;

  if (turnUrls.length) {
    const secret = String(process.env.CARNAGE_TURN_SECRET || '').trim();
    const staticUser = String(process.env.CARNAGE_TURN_USERNAME || '').trim();
    const staticPassword = String(process.env.CARNAGE_TURN_PASSWORD || '').trim();
    const configuredTtl = Math.max(60, Math.min(86400, Number(process.env.CARNAGE_TURN_TTL) || 3600));

    if (secret) {
      ttl = configuredTtl;
      const expires = Math.floor(Date.now() / 1000) + ttl;
      const username = `${expires}:${String(userId || 'guest').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 48) || 'guest'}`;
      const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
      iceServers.push({ urls: turnUrls, username, credential });
    } else if (staticUser && staticPassword) {
      iceServers.push({ urls: turnUrls, username: staticUser, credential: staticPassword });
    }
  }

  return { iceServers, ttl, turn: turnUrls.length > 0 };
}

module.exports = { makeIceConfig, DEFAULT_STUN };
