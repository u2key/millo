import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate } from './db.js';
import { seedWorlds } from './seed.js';
import { attachRealtime } from './realtime.js';
import { validateWorld, validateModel } from '../shared/world.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 25830;
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'millo.sqlite3');

const db = openDb(DB_FILE);
await migrate(db);
await seedWorlds(db);

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three', 'build')));

const now = () => Date.now();
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(500).json({ error: 'サーバーエラー' });
});
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// ---------- auth ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

async function userFromReq(req) {
  const m = /^Bearer (\w+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  return db.get('SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', [m[1]]);
}

const auth = (required) => async (req, res, next) => {
  try {
    req.user = await userFromReq(req);
    if (required && !req.user) return fail(res, 401, 'ログインが必要です');
    next();
  } catch (e) {
    next(e);
  }
};

async function newSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  await db.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', [token, userId, now()]);
  return token;
}

const totalItems = async (userId) =>
  (await db.get('SELECT COUNT(*) AS n FROM collected WHERE user_id = ?', [userId])).n;

app.post('/api/register', wrap(async (req, res) => {
  const { name, password } = req.body || {};
  if (typeof name !== 'string' || !/^[\w\-ぁ-んァ-ヶー一-龠々]{2,16}$/.test(name))
    return fail(res, 400, '名前は2〜16文字（英数字・かな・漢字・_-）にしてください');
  if (typeof password !== 'string' || password.length < 4) return fail(res, 400, 'パスワードは4文字以上にしてください');
  if (await db.get('SELECT id FROM users WHERE name = ?', [name])) return fail(res, 409, 'その名前は使われています');
  const salt = crypto.randomBytes(16).toString('hex');
  const r = await db.run('INSERT INTO users (name, pass_hash, salt, created_at) VALUES (?, ?, ?, ?)', [
    name, hashPassword(password, salt), salt, now(),
  ]);
  res.json({ token: await newSession(r.lastID), user: { id: r.lastID, name, totalItems: 0 } });
}));

app.post('/api/login', wrap(async (req, res) => {
  const { name, password } = req.body || {};
  const u = await db.get('SELECT * FROM users WHERE name = ?', [String(name || '')]);
  if (!u || !u.pass_hash) return fail(res, 401, '名前かパスワードが違います');
  const h = hashPassword(String(password || ''), u.salt);
  if (!crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(u.pass_hash, 'hex')))
    return fail(res, 401, '名前かパスワードが違います');
  res.json({ token: await newSession(u.id), user: { id: u.id, name: u.name, totalItems: await totalItems(u.id) } });
}));

app.post('/api/logout', auth(true), wrap(async (req, res) => {
  const m = /^Bearer (\w+)$/.exec(req.headers.authorization || '');
  await db.run('DELETE FROM sessions WHERE token = ?', [m[1]]);
  res.json({ ok: true });
}));

app.get('/api/me', auth(true), wrap(async (req, res) => {
  res.json({ user: { ...req.user, totalItems: await totalItems(req.user.id) } });
}));

// ---------- worlds ----------
async function topRanking(worldId, limit) {
  return db.all(
    `SELECT u.name, c.time_ms AS timeMs, c.created_at AS at FROM clears c JOIN users u ON u.id = c.user_id
     WHERE c.world_id = ? ORDER BY c.time_ms ASC, c.created_at ASC LIMIT ?`,
    [worldId, limit]
  );
}

function worldSummary(w) {
  return {
    id: w.id, name: w.name, description: w.description, owner: w.owner, ownerId: w.user_id,
    requiredItems: w.required_items, itemCount: w.item_count, hasBoss: !!w.has_boss,
    thumbnail: w.thumbnail, plays: w.plays, updatedAt: w.updated_at,
  };
}

app.get('/api/worlds', auth(false), wrap(async (req, res) => {
  const rows = await db.all(
    `SELECT w.id, w.user_id, w.name, w.description, w.required_items, w.item_count, w.has_boss, w.thumbnail,
            w.plays, w.updated_at, u.name AS owner
     FROM worlds w JOIN users u ON u.id = w.user_id ORDER BY w.required_items ASC, w.id ASC`
  );
  const worlds = [];
  for (const w of rows) {
    const s = worldSummary(w);
    s.ranking = await topRanking(w.id, 5);
    s.online = realtime.online(w.id);
    s.clearCount = (await db.get('SELECT COUNT(*) AS n FROM clears WHERE world_id = ?', [w.id])).n;
    if (req.user) {
      const mine = await db.get('SELECT time_ms FROM clears WHERE world_id = ? AND user_id = ?', [w.id, req.user.id]);
      s.myBest = mine ? mine.time_ms : null;
      s.myItems = (await db.get('SELECT COUNT(*) AS n FROM collected WHERE world_id = ? AND user_id = ?', [w.id, req.user.id])).n;
    }
    worlds.push(s);
  }
  res.json({ worlds });
}));

app.get('/api/worlds/:id', auth(false), wrap(async (req, res) => {
  const w = await db.get('SELECT w.*, u.name AS owner FROM worlds w JOIN users u ON u.id = w.user_id WHERE w.id = ?', [req.params.id]);
  if (!w) return fail(res, 404, 'ワールドが見つかりません');
  const out = worldSummary(w);
  out.data = JSON.parse(w.data);
  out.collected = req.user
    ? (await db.all('SELECT item_id FROM collected WHERE world_id = ? AND user_id = ?', [w.id, req.user.id])).map((r) => r.item_id)
    : [];
  res.json({ world: out });
}));

app.get('/api/worlds/:id/ranking', wrap(async (req, res) => {
  res.json({ ranking: await topRanking(req.params.id, 100) });
}));

function worldMeta(data) {
  return {
    items: data.entities.filter((e) => e.type === 'item').length,
    boss: data.entities.some((e) => e.type === 'enemy' && e.boss),
  };
}

function cleanWorldBody(body) {
  const data = body && body.data;
  const err = validateWorld(data);
  if (err) return { err };
  const name = String(body.name || '').trim().slice(0, 40);
  if (!name) return { err: 'ワールド名を入力してください' };
  const requiredItems = Math.max(0, Math.min(1e6, parseInt(body.requiredItems, 10) || 0));
  let thumbnail = typeof body.thumbnail === 'string' && body.thumbnail.startsWith('data:image/') ? body.thumbnail : null;
  if (thumbnail && thumbnail.length > 400000) thumbnail = null;
  return { name, requiredItems, thumbnail, description: String(body.description || '').slice(0, 300), data };
}

app.post('/api/worlds', auth(true), wrap(async (req, res) => {
  const c = cleanWorldBody(req.body);
  if (c.err) return fail(res, 400, c.err);
  const meta = worldMeta(c.data);
  const r = await db.run(
    `INSERT INTO worlds (user_id, name, description, required_items, item_count, has_boss, data, thumbnail, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, c.name, c.description, c.requiredItems, meta.items, meta.boss ? 1 : 0, JSON.stringify(c.data), c.thumbnail, now(), now()]
  );
  res.json({ id: r.lastID });
}));

app.put('/api/worlds/:id', auth(true), wrap(async (req, res) => {
  const w = await db.get('SELECT * FROM worlds WHERE id = ?', [req.params.id]);
  if (!w) return fail(res, 404, 'ワールドが見つかりません');
  if (w.user_id !== req.user.id) return fail(res, 403, '自分のワールドのみ編集できます');
  const c = cleanWorldBody(req.body);
  if (c.err) return fail(res, 400, c.err);
  const meta = worldMeta(c.data);
  const json = JSON.stringify(c.data);
  await db.run(
    `UPDATE worlds SET name = ?, description = ?, required_items = ?, item_count = ?, has_boss = ?, data = ?,
       thumbnail = COALESCE(?, thumbnail), updated_at = ? WHERE id = ?`,
    [c.name, c.description, c.requiredItems, meta.items, meta.boss ? 1 : 0, json, c.thumbnail, now(), w.id]
  );
  res.json({ id: w.id });
}));

app.delete('/api/worlds/:id', auth(true), wrap(async (req, res) => {
  const w = await db.get('SELECT user_id FROM worlds WHERE id = ?', [req.params.id]);
  if (!w) return fail(res, 404, 'ワールドが見つかりません');
  if (w.user_id !== req.user.id) return fail(res, 403, '自分のワールドのみ削除できます');
  await db.run('DELETE FROM worlds WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/worlds/:id/play', wrap(async (req, res) => {
  await db.run('UPDATE worlds SET plays = plays + 1 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/worlds/:id/clear', auth(true), wrap(async (req, res) => {
  const w = await db.get('SELECT * FROM worlds WHERE id = ?', [req.params.id]);
  if (!w) return fail(res, 404, 'ワールドが見つかりません');
  const before = await totalItems(req.user.id);
  if (w.user_id !== req.user.id && before < w.required_items) return fail(res, 403, 'このワールドはまだ開放されていません');
  const timeMs = Math.round(Number(req.body.timeMs));
  if (!Number.isFinite(timeMs) || timeMs < 500 || timeMs > 24 * 3600 * 1000) return fail(res, 400, 'タイムが不正です');
  const data = JSON.parse(w.data);
  const validItems = new Set(data.entities.filter((e) => e.type === 'item').map((e) => e.id));
  const items = Array.isArray(req.body.items) ? [...new Set(req.body.items)].filter((i) => validItems.has(i)) : [];
  for (const it of items)
    await db.run('INSERT OR IGNORE INTO collected (user_id, world_id, item_id, created_at) VALUES (?, ?, ?, ?)', [req.user.id, w.id, it, now()]);
  const prev = await db.get('SELECT time_ms FROM clears WHERE world_id = ? AND user_id = ?', [w.id, req.user.id]);
  const newBest = !prev || timeMs < prev.time_ms;
  if (newBest)
    await db.run('INSERT OR REPLACE INTO clears (world_id, user_id, time_ms, created_at) VALUES (?, ?, ?, ?)', [w.id, req.user.id, timeMs, now()]);
  const best = newBest ? timeMs : prev.time_ms;
  const rank = (await db.get('SELECT COUNT(*) AS n FROM clears WHERE world_id = ? AND time_ms < ?', [w.id, best])).n + 1;
  const after = await totalItems(req.user.id);
  realtime.announceClear(w.id, req.user.name, timeMs, rank, newBest);
  res.json({ newBest, best, rank, totalItems: after, newItems: after - before });
}));

// ---------- models ----------
app.get('/api/models', wrap(async (req, res) => {
  const rows = await db.all(
    `SELECT m.id, m.name, m.kind, m.data, m.user_id AS ownerId, u.name AS owner, m.updated_at AS updatedAt
     FROM models m JOIN users u ON u.id = m.user_id ORDER BY m.updated_at DESC`
  );
  res.json({ models: rows.map((r) => ({ ...r, id: 'u' + r.id, data: JSON.parse(r.data) })) });
}));

function cleanModelBody(body) {
  const data = body && body.data;
  const err = validateModel(data);
  if (err) return { err };
  const name = String(body.name || '').trim().slice(0, 30);
  if (!name) return { err: 'モデル名を入力してください' };
  const kind = ['player', 'enemy', 'any'].includes(body.kind) ? body.kind : 'any';
  return { name, kind, data: { voxels: data.voxels } };
}

app.post('/api/models', auth(true), wrap(async (req, res) => {
  const c = cleanModelBody(req.body);
  if (c.err) return fail(res, 400, c.err);
  const r = await db.run('INSERT INTO models (user_id, name, kind, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
    req.user.id, c.name, c.kind, JSON.stringify(c.data), now(), now(),
  ]);
  res.json({ id: 'u' + r.lastID });
}));

const modelRowId = (id) => parseInt(String(id).replace(/^u/, ''), 10);

app.put('/api/models/:id', auth(true), wrap(async (req, res) => {
  const m = await db.get('SELECT user_id FROM models WHERE id = ?', [modelRowId(req.params.id)]);
  if (!m) return fail(res, 404, 'モデルが見つかりません');
  if (m.user_id !== req.user.id) return fail(res, 403, '自分のモデルのみ編集できます');
  const c = cleanModelBody(req.body);
  if (c.err) return fail(res, 400, c.err);
  await db.run('UPDATE models SET name = ?, kind = ?, data = ?, updated_at = ? WHERE id = ?', [
    c.name, c.kind, JSON.stringify(c.data), now(), modelRowId(req.params.id),
  ]);
  res.json({ id: req.params.id });
}));

app.delete('/api/models/:id', auth(true), wrap(async (req, res) => {
  const m = await db.get('SELECT user_id FROM models WHERE id = ?', [modelRowId(req.params.id)]);
  if (!m) return fail(res, 404, 'モデルが見つかりません');
  if (m.user_id !== req.user.id) return fail(res, 403, '自分のモデルのみ削除できます');
  await db.run('DELETE FROM models WHERE id = ?', [modelRowId(req.params.id)]);
  res.json({ ok: true });
}));

app.use('/api', (req, res) => fail(res, 404, 'Not found'));

const server = app.listen(PORT, () => console.log(`Millo server running on http://localhost:${PORT}`));
const realtime = attachRealtime(server, db);

