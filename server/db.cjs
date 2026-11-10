'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY = {
  meta: { version: 2, createdAt: 0, secret: '', seeded: false },
  users: [],
  servers: [],
  channels: [],
  messages: [],
  friendships: [],
  readStates: [],
  bans: [],
  bots: [],
  pushSubscriptions: [],
};

// Коллекции, которые хранятся в SQLite. Ключ — имя массива в db.data,
// table — имя таблицы, key — как получить уникальный ключ строки.
const COLLECTIONS = [
  { name: 'users', table: 'users', key: (item) => item.id },
  { name: 'servers', table: 'servers', key: (item) => item.id },
  { name: 'channels', table: 'channels', key: (item) => item.id },
  { name: 'messages', table: 'messages', key: (item) => item.id },
  { name: 'friendships', table: 'friendships', key: (item) => item.id },
  {
    name: 'readStates',
    table: 'read_states',
    key: (item) => `${item.userId}:${item.channelId}`,
  },
  { name: 'bans', table: 'bans', key: (item) => item.id },
  { name: 'bots', table: 'bots', key: (item) => item.id },
  { name: 'pushSubscriptions', table: 'push_subscriptions', key: (item) => item.id },
];

function buildFtsQuery(query) {
  const tokens = String(query || '')
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu);
  if (!tokens || !tokens.length) return '';
  return tokens
    .slice(0, 8)
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(' AND ');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class DB {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.sqliteFile = path.join(dir, 'carnage.db');
    this.data = null;
    this.sqlite = null;
    this.storage = 'json';
    this._saveTimer = null;
    this._cache = new Map();
    this._stmts = null;
    this._fts = false;
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    const legacy = this._readLegacyJson();
    this.data = legacy || clone(EMPTY);
    this._ensureShape();

    try {
      this._openSqlite();
      this._initSchema();
      const rows = this._sqliteRowCount();
      if (!rows && legacy && this._hasLegacyContent(legacy)) {
        console.log('[db] Перенос данных из db.json в SQLite…');
        this._migrateLegacy();
      } else {
        this._loadFromSqlite();
      }
      this.storage = 'sqlite';
      this._rebuildCache();
    } catch (err) {
      console.error('[db] SQLite недоступен, используется JSON:', err.message);
      this._closeSqlite();
      this.data = legacy || clone(EMPTY);
      this._ensureShape();
      this.storage = 'json';
    }

    if (!this.data.meta.secret) {
      this.data.meta.secret = crypto.randomBytes(48).toString('hex');
    }
    if (!this.data.meta.createdAt) this.data.meta.createdAt = Date.now();
    this.data.meta.version = 2;
    this.saveNow();
    return this;
  }

  _readLegacyJson() {
    if (!fs.existsSync(this.file)) return null;
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      console.error('[db] Не удалось прочитать db.json, создаю резервную копию:', err.message);
      try {
        fs.copyFileSync(this.file, this.file + '.broken-' + Date.now());
      } catch {}
      return null;
    }
  }

  _ensureShape() {
    if (!this.data || typeof this.data !== 'object') {
      this.data = clone(EMPTY);
    }
    for (const key of Object.keys(EMPTY)) {
      if (this.data[key] === undefined) this.data[key] = clone(EMPTY[key]);
    }
    if (!this.data.meta || typeof this.data.meta !== 'object') {
      this.data.meta = clone(EMPTY.meta);
    }
  }

  _hasLegacyContent(data) {
    return (
      (data.users || []).length > 0 ||
      (data.servers || []).length > 0 ||
      (data.messages || []).length > 0
    );
  }

  _openSqlite() {
    const { DatabaseSync } = require('node:sqlite');
    this.sqlite = new DatabaseSync(this.sqliteFile);
    this.sqlite.exec('PRAGMA journal_mode = WAL');
    this.sqlite.exec('PRAGMA synchronous = NORMAL');
    this.sqlite.exec('PRAGMA busy_timeout = 5000');
  }

  _closeSqlite() {
    try {
      this.sqlite?.close();
    } catch {}
    this.sqlite = null;
    this._stmts = null;
    this._fts = false;
  }

  _initSchema() {
    const sql = this.sqlite;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT,
        author_id TEXT,
        content TEXT,
        created_at TEXT,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages(channel_id, created_at);
      CREATE TABLE IF NOT EXISTS friendships (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS read_states (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bans (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bots (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS push_user_idx ON push_subscriptions(user_id);
    `);
    try {
      sql.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
        USING fts5(message_id UNINDEXED, content, tokenize = 'unicode61');
      `);
      this._fts = true;
    } catch (err) {
      console.warn('[db] FTS5 недоступен, поиск будет без индекса:', err.message);
      this._fts = false;
    }
    this._prepareStatements();
  }

  _prepareStatements() {
    const sql = this.sqlite;
    const stmts = {
      upsertMeta: sql.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      deleteMeta: sql.prepare('DELETE FROM meta WHERE key = ?'),
      insertMessage: sql.prepare(
        'INSERT INTO messages(id, channel_id, author_id, content, created_at, data) VALUES (?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, author_id = excluded.author_id, ' +
          'content = excluded.content, created_at = excluded.created_at, data = excluded.data'
      ),
      deleteMessage: sql.prepare('DELETE FROM messages WHERE id = ?'),
      insertPush: sql.prepare(
        'INSERT INTO push_subscriptions(id, user_id, data) VALUES (?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, data = excluded.data'
      ),
      deletePush: sql.prepare('DELETE FROM push_subscriptions WHERE id = ?'),
    };
    for (const collection of COLLECTIONS) {
      if (collection.name === 'messages' || collection.name === 'pushSubscriptions') continue;
      stmts[`upsert:${collection.table}`] = sql.prepare(
        `INSERT INTO ${collection.table}(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`
      );
      stmts[`delete:${collection.table}`] = sql.prepare(`DELETE FROM ${collection.table} WHERE id = ?`);
    }
    if (this._fts) {
      stmts.ftsDelete = sql.prepare('DELETE FROM messages_fts WHERE message_id = ?');
      stmts.ftsInsert = sql.prepare('INSERT INTO messages_fts(message_id, content) VALUES (?, ?)');
    }
    this._stmts = stmts;
  }

  _sqliteRowCount() {
    const count = (table) => {
      try {
        return Number(this.sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c) || 0;
      } catch {
        return 0;
      }
    };
    return count('users') + count('servers') + count('messages');
  }

  _migrateLegacy() {
    // Данные уже лежат в this.data из db.json. Save перенесёт их в SQLite.
    try {
      fs.copyFileSync(this.file, `${this.file}.migrated-${Date.now()}`);
    } catch {}
    this.saveNow();
  }

  _loadFromSqlite() {
    for (const collection of COLLECTIONS) {
      const rows = this.sqlite.prepare(`SELECT data FROM ${collection.table}`).all();
      this.data[collection.name] = rows.map((row) => JSON.parse(row.data));
    }
    const metaRows = this.sqlite.prepare('SELECT key, value FROM meta').all();
    const meta = { ...EMPTY.meta };
    for (const row of metaRows) {
      try {
        meta[row.key] = JSON.parse(row.value);
      } catch {}
    }
    this.data.meta = meta;
  }

  _rebuildCache() {
    this._cache = new Map();
    for (const collection of COLLECTIONS) {
      const map = new Map();
      for (const item of this.data[collection.name] || []) {
        map.set(String(collection.key(item)), JSON.stringify(item));
      }
      this._cache.set(collection.name, map);
    }
    const meta = new Map();
    for (const [key, value] of Object.entries(this.data.meta || {})) {
      meta.set(key, JSON.stringify(value));
    }
    this._cache.set('meta', meta);
  }

  _syncSqlite() {
    const sql = this.sqlite;
    sql.exec('BEGIN IMMEDIATE');
    try {
      for (const collection of COLLECTIONS) {
        const next = new Map();
        for (const item of this.data[collection.name] || []) {
          const key = String(collection.key(item));
          next.set(key, JSON.stringify(item));
        }
        const previous = this._cache.get(collection.name) || new Map();
        for (const [key, serialized] of next) {
          if (previous.get(key) === serialized) continue;
          const item = JSON.parse(serialized);
          if (collection.name === 'messages') {
            this._stmts.insertMessage.run(
              item.id,
              item.channelId || '',
              item.authorId || '',
              item.content || '',
              item.createdAt || '',
              serialized
            );
            if (this._fts) {
              this._stmts.ftsDelete.run(item.id);
              if (item.content) this._stmts.ftsInsert.run(item.id, item.content);
            }
          } else if (collection.name === 'pushSubscriptions') {
            this._stmts.insertPush.run(item.id, item.userId || '', serialized);
          } else {
            this._stmts[`upsert:${collection.table}`].run(key, serialized);
          }
        }
        for (const key of previous.keys()) {
          if (next.has(key)) continue;
          if (collection.name === 'messages') {
            this._stmts.deleteMessage.run(key);
            if (this._fts) this._stmts.ftsDelete.run(key);
          } else if (collection.name === 'pushSubscriptions') {
            this._stmts.deletePush.run(key);
          } else {
            this._stmts[`delete:${collection.table}`].run(key);
          }
        }
        this._cache.set(collection.name, next);
      }

      const meta = new Map();
      for (const [key, value] of Object.entries(this.data.meta || {})) {
        meta.set(key, JSON.stringify(value));
      }
      const previousMeta = this._cache.get('meta') || new Map();
      for (const [key, serialized] of meta) {
        if (previousMeta.get(key) !== serialized) this._stmts.upsertMeta.run(key, serialized);
      }
      for (const key of previousMeta.keys()) {
        if (!meta.has(key)) this._stmts.deleteMeta.run(key);
      }
      this._cache.set('meta', meta);
      sql.exec('COMMIT');
    } catch (err) {
      try { sql.exec('ROLLBACK'); } catch {}
      throw err;
    }
  }

  _syncJson() {
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

  saveNow() {
    if (!this.data) return;
    if (this.sqlite) {
      try {
        this._syncSqlite();
        return;
      } catch (err) {
        console.error('[db] Ошибка сохранения SQLite:', err.message);
        try { this._syncJson(); } catch {}
        return;
      }
    }
    this._syncJson();
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

  close() {
    this.flush();
    this._closeSqlite();
  }

  // Полнотекстовый поиск по сообщениям через SQLite FTS5.
  // Возвращает массив id или null, если SQLite/FTS недоступен.
  searchMessageIds(query, limit = 200) {
    if (!this.sqlite || !this._fts) return null;
    const match = buildFtsQuery(query);
    if (!match) return [];
    try {
      const rows = this.sqlite
        .prepare(
          'SELECT messages.id AS id FROM messages_fts ' +
            'JOIN messages ON messages.id = messages_fts.message_id ' +
            'WHERE messages_fts MATCH ? ORDER BY messages.created_at DESC LIMIT ?'
        )
        .all(match, Math.max(1, Math.min(500, Number(limit) || 200)));
      return rows.map((row) => row.id);
    } catch (err) {
      console.warn('[db] FTS-поиск не удался:', err.message);
      return null;
    }
  }

  stats() {
    return {
      storage: this.storage,
      file: this.storage === 'sqlite' ? this.sqliteFile : this.file,
      users: this.data?.users?.length || 0,
      messages: this.data?.messages?.length || 0,
    };
  }

  user(id) {
    return this.data.users.find((u) => u.id === id && !u.bot) || null;
  }

  bot(id) {
    return this.data.bots.find((b) => b.id === id) || null;
  }

  userByName(name) {
    const q = String(name || '').trim().toLowerCase();
    if (!q) return null;
    return (
      this.data.users.find(
        (u) =>
          !u.bot &&
          (u.username.toLowerCase() === q || (u.email || '').toLowerCase() === q)
      ) || null
    );
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
  const out = [];
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) out.push(alphabet[bytes[i] % alphabet.length]);
  return out.join('');
}

module.exports = { DB, makeId, randomCode, EMPTY, buildFtsQuery };
