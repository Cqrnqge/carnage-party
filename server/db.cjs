'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY = {
  meta: { version: 1, createdAt: 0, secret: '', seeded: false },
  users: [],
  servers: [],
  channels: [],
  messages: [],
  friendships: [],
  readStates: [],
  bans: [],
};

class DB {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.data = null;
    this._saveTimer = null;
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        const raw = fs.readFileSync(this.file, 'utf8');
        this.data = JSON.parse(raw);
      } catch (err) {
        console.error('[db] Не удалось прочитать базу, создаю резервную копию:', err.message);
        try {
          fs.copyFileSync(this.file, this.file + '.broken-' + Date.now());
        } catch {}
        this.data = null;
      }
    }
    if (!this.data || typeof this.data !== 'object') {
      this.data = JSON.parse(JSON.stringify(EMPTY));
    }
    for (const key of Object.keys(EMPTY)) {
      if (this.data[key] === undefined) {
        this.data[key] = JSON.parse(JSON.stringify(EMPTY[key]));
      }
    }
    if (!this.data.meta.secret) {
      this.data.meta.secret = crypto.randomBytes(48).toString('hex');
    }
    if (!this.data.meta.createdAt) this.data.meta.createdAt = Date.now();
    this.data.meta.version = 1;
    this.saveNow();
    return this;
  }

  saveNow() {
    if (!this.data) return;
    const tmp = this.file + '.tmp';
    const json = JSON.stringify(this.data);
    fs.writeFileSync(tmp, json, 'utf8');
    try {
      fs.renameSync(tmp, this.file);
    } catch {
      // На Windows rename иногда не может заменить файл — используем копирование.
      fs.copyFileSync(tmp, this.file);
      try { fs.unlinkSync(tmp); } catch {}
    }
  }

  // Отложенная запись, чтобы не блокировать цикл на каждом изменении.
  save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try {
        this.saveNow();
      } catch (err) {
        console.error('[db] Ошибка сохранения:', err.message);
      }
    }, 120);
  }

  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this.saveNow();
  }

  user(id) {
    return this.data.users.find((u) => u.id === id) || null;
  }

  userByName(name) {
    const q = String(name || '').trim().toLowerCase();
    if (!q) return null;
    return this.data.users.find((u) => u.username.toLowerCase() === q || (u.email || '').toLowerCase() === q) || null;
  }

  server(id) {
    return this.data.servers.find((s) => s.id === id) || null;
  }

  channel(id) {
    return this.data.channels.find((c) => c.id === id) || null;
  }

  message(id) {
    return this.data.messages.find((m) => m.id === id) || null;
  }

  messageCount() {
    return this.data.messages.length;
  }
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function randomCode(length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

module.exports = { DB, makeId, randomCode };
