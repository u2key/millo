import sqlite3 from 'sqlite3';
import path from 'node:path';
import fs from 'node:fs';

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new sqlite3.Database(file);
  const db = {
    raw,
    run: (sql, params = []) =>
      new Promise((res, rej) =>
        raw.run(sql, params, function (err) {
          if (err) rej(err);
          else res({ lastID: this.lastID, changes: this.changes });
        })
      ),
    get: (sql, params = []) => new Promise((res, rej) => raw.get(sql, params, (e, r) => (e ? rej(e) : res(r)))),
    all: (sql, params = []) => new Promise((res, rej) => raw.all(sql, params, (e, r) => (e ? rej(e) : res(r)))),
    exec: (sql) => new Promise((res, rej) => raw.exec(sql, (e) => (e ? rej(e) : res()))),
  };
  return db;
}

export async function migrate(db) {
  await db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass_hash TEXT,
      salt TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'any',
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      required_items INTEGER NOT NULL DEFAULT 0,
      item_count INTEGER NOT NULL DEFAULT 0,
      has_boss INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL,
      thumbnail TEXT,
      plays INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clears (
      world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      time_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (world_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS clears_rank ON clears(world_id, time_ms);
    -- Collected items are never removed (even when the world is edited or deleted),
    -- so a user's item total can only grow.
    CREATE TABLE IF NOT EXISTS collected (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      world_id INTEGER NOT NULL,
      item_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, world_id, item_id)
    );
  `);
}
