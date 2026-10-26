// Shared definitions used by both the browser client and the Node.js server.
// Everything here must stay free of DOM / Node specific APIs.

export const MODEL_GRID = [24, 32, 24]; // voxel model editor grid (x, y, z)

// Block palette. Colors are plain hex numbers; no external textures are used.
export const BLOCKS = [
  null, // 0 = air
  { id: 1, key: 'grass', name: '草', top: 0x6cc644, side: 0x8d6238, bottom: 0x7a5230, solid: true },
  { id: 2, key: 'dirt', name: '土', top: 0x8d6238, side: 0x8d6238, bottom: 0x7a5230, solid: true },
  { id: 3, key: 'stone', name: '石', top: 0x8a8f96, side: 0x7d8289, bottom: 0x6f747a, solid: true },
  { id: 4, key: 'plank', name: '木材', top: 0xc29a5b, side: 0xb38a4d, bottom: 0xa07a42, solid: true },
  { id: 5, key: 'brick', name: 'レンガ', top: 0xb5523b, side: 0xa84a35, bottom: 0x8f3e2c, solid: true },
  { id: 6, key: 'sand', name: '砂', top: 0xe8d9a0, side: 0xdccc91, bottom: 0xcdbd83, solid: true },
  { id: 7, key: 'ice', name: '氷（すべる）', top: 0xb8e6f5, side: 0x9fd6ea, bottom: 0x8cc6dc, solid: true, slippery: true },
  { id: 8, key: 'lava', name: '溶岩（ダメージ）', top: 0xff7a1a, side: 0xf25c05, bottom: 0xd94a00, solid: true, hazard: true, glow: true },
  { id: 9, key: 'bounce', name: 'ジャンプ台', top: 0xff4fa3, side: 0x7a3b8f, bottom: 0x5e2c6e, solid: true, bounce: true },
  { id: 10, key: 'glass', name: 'ガラス', top: 0xd8f3ff, side: 0xd8f3ff, bottom: 0xd8f3ff, solid: true, transparent: true },
  { id: 11, key: 'leaves', name: '葉', top: 0x3f9a3a, side: 0x378a33, bottom: 0x2f7a2c, solid: true },
  { id: 12, key: 'log', name: '原木', top: 0xb08850, side: 0x6b4a2b, bottom: 0xb08850, solid: true },
  { id: 13, key: 'cloud', name: '雲', top: 0xffffff, side: 0xf0f4fa, bottom: 0xdfe6f0, solid: true },
  { id: 14, key: 'gold', name: '金', top: 0xffd84a, side: 0xf2c230, bottom: 0xd9a820, solid: true },
  { id: 15, key: 'darkstone', name: '黒石', top: 0x4a4a58, side: 0x40404d, bottom: 0x353540, solid: true },
  { id: 16, key: 'snow', name: '雪', top: 0xf7fbff, side: 0xe3edf5, bottom: 0xcfdbe6, solid: true },
];

export const ENEMY_TYPES = {
  slime: { name: 'スライム', behavior: 'patrol', speed: 1.4, w: 0.9, h: 0.8, hp: 1, stompable: true },
  acorn: { name: 'ドングリン', behavior: 'patrol', speed: 2.0, w: 0.8, h: 0.95, hp: 1, stompable: true },
  bat: { name: 'コウモリ', behavior: 'flyer', speed: 2.6, w: 0.8, h: 0.6, hp: 1, stompable: true, fly: true },
  spike: { name: 'トゲボール', behavior: 'patrol', speed: 1.6, w: 1.0, h: 1.0, hp: 1, stompable: false },
  frog: { name: 'ピョンガエル', behavior: 'jumper', speed: 3.5, w: 0.9, h: 0.7, hp: 1, stompable: true },
  ghost: { name: 'ユーレイ', behavior: 'ghost', speed: 1.6, w: 0.9, h: 1.1, hp: 1, stompable: true, fly: true, ghostly: true },
  turret: { name: 'ほうだい', behavior: 'shooter', speed: 0, w: 1.0, h: 1.0, hp: 1, stompable: true },
  boar: { name: 'イノシシ', behavior: 'charger', speed: 1.8, w: 1.1, h: 1.0, hp: 1, stompable: true },
  knight: { name: 'ヨロイ騎士', behavior: 'chaser', speed: 2.6, w: 0.7, h: 1.8, hp: 2, stompable: true },
  golem: { name: 'ゴーレム', behavior: 'chaser', speed: 1.6, w: 1.2, h: 2.4, hp: 3, stompable: true, noJump: true },
};

export const ENTITY_TYPES = ['start', 'goal', 'item', 'checkpoint', 'enemy'];
export const SKIES = { day: '昼', sunset: '夕焼け', night: '夜' };

export const LIMITS = { minXZ: 16, maxXZ: 160, minY: 16, maxY: 80, maxEnemies: 500 };

export const blockIndex = (W, D, x, y, z) => x + z * W + y * W * D;

// Run-length encoding: [value, count, value, count, ...]
export function encodeBlocks(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}

export function decodeBlocks(rle, total) {
  const arr = new Uint8Array(total);
  let p = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const v = rle[i] | 0, n = rle[i + 1] | 0;
    if (n < 0 || p + n > total) throw new Error('bad block data');
    arr.fill(v, p, p + n);
    p += n;
  }
  if (p !== total) throw new Error('bad block data length');
  return arr;
}

export function randomId(len = 10) {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

// Validates a world payload. Returns an error message (Japanese) or null.
export function validateWorld(w) {
  if (!w || typeof w !== 'object') return 'ワールドデータが不正です';
  const [W, H, D] = w.size || [];
  if (![W, H, D].every(Number.isInteger)) return 'サイズが不正です';
  if (W < LIMITS.minXZ || W > LIMITS.maxXZ || D < LIMITS.minXZ || D > LIMITS.maxXZ || H < LIMITS.minY || H > LIMITS.maxY)
    return 'サイズが範囲外です';
  if (!Array.isArray(w.blocks)) return 'ブロックデータがありません';
  try {
    const arr = decodeBlocks(w.blocks, W * H * D);
    for (let i = 0; i < arr.length; i++) if (arr[i] >= BLOCKS.length) return '未知のブロックがあります';
  } catch (e) {
    return 'ブロックデータが壊れています';
  }
  if (!Array.isArray(w.entities)) return 'エンティティデータがありません';
  let starts = 0, goals = 0, enemies = 0;
  const ids = new Set();
  for (const e of w.entities) {
    if (!e || !ENTITY_TYPES.includes(e.type)) return '未知のエンティティがあります';
    if (![e.x, e.y, e.z].every(Number.isFinite)) return 'エンティティ座標が不正です';
    if (typeof e.id !== 'string' || !e.id || ids.has(e.id)) return 'エンティティIDが不正です';
    ids.add(e.id);
    if (e.type === 'start') starts++;
    if (e.type === 'goal') goals++;
    if (e.type === 'enemy') {
      enemies++;
      if (!ENEMY_TYPES[e.enemy]) return '未知の敵タイプがあります';
    }
  }
  if (starts !== 1) return 'スタート地点はちょうど1つ必要です';
  if (goals < 1) return 'ゴールが最低1つ必要です';
  if (enemies > LIMITS.maxEnemies) return `敵は${LIMITS.maxEnemies}体までです`;
  return null;
}

export function validateModel(m) {
  if (!m || !Array.isArray(m.voxels)) return 'モデルデータが不正です';
  if (m.voxels.length === 0) return 'ボクセルが1つもありません';
  const [GX, GY, GZ] = MODEL_GRID;
  for (const v of m.voxels) {
    if (!Array.isArray(v) || v.length !== 4) return 'ボクセルが不正です';
    const [x, y, z, c] = v;
    if (![x, y, z, c].every(Number.isInteger)) return 'ボクセルが不正です';
    if (x < 0 || y < 0 || z < 0 || x >= GX || y >= GY || z >= GZ) return 'ボクセルが範囲外です';
    if (c < 0 || c > 0xffffff) return '色が不正です';
  }
  return null;
}
