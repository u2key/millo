// Generates the default worlds the first time the server starts.
import { encodeBlocks, randomId, validateWorld, BLOCKS } from '../shared/world.js';

const B = Object.fromEntries(BLOCKS.filter(Boolean).map((b) => [b.key, b.id]));

function builder(W, H, D) {
  const blocks = new Uint8Array(W * H * D);
  const entities = [];
  const set = (x, y, z, id) => {
    if (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) return;
    blocks[x + z * W + y * W * D] = id;
  };
  const fill = (x0, y0, z0, x1, y1, z1, id) => {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) set(x, y, z, id);
  };
  const ent = (type, x, y, z, extra = {}) => entities.push({ id: randomId(), type, x, y, z, ...extra });
  const enemy = (kind, x, y, z, extra = {}) => ent('enemy', x, y, z, { enemy: kind, boss: false, rot: 1, ...extra });
  // Ground strip whose walkable surface is at height `top`.
  const ground = (x0, x1, z0, z1, top, surface = B.grass, under = B.dirt) => {
    fill(x0, 0, z0, x1, top - 2, z1, under);
    fill(x0, top - 1, z0, x1, top - 1, z1, surface);
  };
  const tree = (x, y, z, h = 4) => {
    fill(x - 2, y + h - 1, z - 2, x + 2, y + h, z + 2, B.leaves);
    fill(x - 1, y + h + 1, z - 1, x + 1, y + h + 1, z + 1, B.leaves);
    fill(x, y, z, x, y + h, z, B.log);
  };
  const finish = (opts) => ({ size: [W, H, D], blocks: encodeBlocks(blocks), entities, ...opts });
  return { set, fill, ent, enemy, ground, tree, finish };
}

function meadow() {
  const w = builder(110, 32, 20);
  w.ground(0, 24, 4, 15, 4);
  w.ent('start', 3, 4, 10);
  w.tree(8, 4, 5);
  w.tree(20, 4, 14);
  w.enemy('slime', 16, 4, 10);
  w.fill(12, 4, 9, 14, 4, 11, B.brick);
  w.ent('item', 13, 7, 10);

  w.ground(28, 45, 4, 15, 5);
  w.enemy('acorn', 34, 5, 8);
  w.enemy('acorn', 39, 5, 12, { rot: 3 });
  w.fill(41, 5, 14, 41, 5, 14, B.brick);
  w.fill(42, 5, 14, 42, 6, 14, B.brick);
  w.ent('item', 42, 7, 14);
  w.fill(47, 4, 8, 48, 4, 11, B.cloud);

  w.ground(50, 70, 4, 15, 5);
  w.ent('checkpoint', 52, 5, 10);
  w.enemy('slime', 56, 5, 6);
  w.enemy('frog', 60, 5, 10);
  w.enemy('slime', 65, 5, 13, { rot: 3 });
  w.tree(58, 5, 14);
  w.set(67, 4, 10, B.bounce);
  w.fill(70, 9, 8, 72, 9, 12, B.brick);
  w.ent('item', 71, 10, 10);

  for (let i = 0; i < 4; i++) w.ground(73 + i * 2, 74 + i * 2, 4, 15, 6 + i);
  w.ground(81, 102, 4, 15, 9);
  w.enemy('acorn', 86, 9, 7);
  w.enemy('slime', 90, 9, 12, { rot: 3 });
  w.enemy('frog', 93, 9, 9);
  w.tree(84, 9, 14);
  w.fill(97, 9, 7, 99, 9, 13, B.gold);
  w.ent('goal', 98, 10, 10);
  return w.finish({ sky: 'day', bossLocksGoal: false, enemyModels: {} });
}

function skyGarden() {
  const w = builder(92, 40, 40);
  const plat = (x0, z0, top, size = 4, id = B.cloud) => w.fill(x0, top - 1, z0, x0 + size - 1, top - 1, z0 + size - 1, id);
  w.fill(2, 9, 15, 10, 10, 24, B.cloud);
  w.ent('start', 5, 11, 20);
  plat(13, 18, 11);
  plat(19, 18, 12);
  plat(25, 22, 13);
  w.enemy('bat', 27, 15, 24);
  plat(31, 18, 12);
  w.ent('item', 32, 15, 19);
  plat(37, 14, 13);
  plat(43, 14, 12);
  w.set(44, 11, 15, B.bounce);
  w.enemy('bat', 40, 16, 16);
  // high island reached with the jump pad
  w.fill(45, 16, 20, 49, 16, 24, B.cloud);
  w.ent('item', 47, 17, 22);
  plat(48, 14, 13, 3);

  // garden island
  w.fill(51, 10, 11, 63, 12, 29, B.dirt);
  w.fill(51, 13, 11, 63, 13, 29, B.grass);
  w.ent('checkpoint', 53, 14, 16);
  w.tree(60, 14, 26, 5);
  w.tree(54, 14, 26, 4);
  w.enemy('frog', 57, 14, 15);
  w.enemy('frog', 60, 14, 20);
  w.enemy('slime', 55, 14, 21);
  w.fill(57, 14, 24, 57, 14, 24, B.glass);
  w.fill(58, 14, 23, 58, 15, 23, B.glass);
  w.fill(59, 14, 22, 59, 16, 22, B.glass);
  w.ent('item', 59, 18, 22);

  // ghost bridge
  w.fill(64, 13, 19, 81, 13, 21, B.cloud);
  w.enemy('ghost', 70, 15, 24);
  w.enemy('ghost', 77, 15, 16);
  plat(70, 25, 14, 3);
  w.ent('item', 71, 14, 26);
  w.enemy('bat', 74, 17, 20);

  w.fill(82, 13, 15, 90, 14, 25, B.cloud);
  w.fill(85, 15, 18, 87, 15, 22, B.gold);
  w.ent('goal', 86, 16, 20);
  return w.finish({ sky: 'sunset', bossLocksGoal: false, enemyModels: {} });
}

function lavaFort() {
  const w = builder(100, 40, 30);
  w.fill(0, 0, 0, 99, 0, 29, B.lava);
  const walk = (x0, x1, z0, z1, top = 5, id = B.stone) => {
    w.fill(x0, 1, z0, x1, top - 2, z1, B.darkstone);
    w.fill(x0, top - 1, z0, x1, top - 1, z1, id);
  };
  walk(1, 8, 10, 19);
  w.ent('start', 3, 5, 15);
  walk(9, 30, 12, 17);
  w.enemy('spike', 17, 5, 14);
  w.enemy('spike', 25, 5, 16, { rot: 3 });
  walk(20, 20, 19, 20, 5, B.brick);
  w.ent('item', 20, 5, 20);
  for (const x of [32, 36, 40]) walk(x, x + 1, 14, 15);
  w.fill(34, 1, 9, 35, 7, 10, B.brick);
  w.enemy('turret', 34, 8, 9, { rot: 0 });

  // courtyard
  walk(43, 65, 8, 22, 5, B.brick);
  w.fill(43, 5, 8, 65, 6, 8, B.brick);
  w.fill(43, 5, 22, 65, 6, 22, B.brick);
  w.ent('checkpoint', 45, 5, 15);
  w.enemy('boar', 50, 5, 11);
  w.enemy('boar', 58, 5, 19, { rot: 3 });
  w.enemy('knight', 60, 5, 13);
  w.fill(47, 5, 20, 48, 6, 21, B.darkstone);
  w.enemy('turret', 47, 7, 20, { rot: 1 });
  w.fill(51, 5, 15, 51, 5, 15, B.darkstone);
  w.fill(52, 5, 15, 52, 6, 15, B.darkstone);
  w.fill(53, 5, 15, 53, 7, 15, B.darkstone);
  w.fill(54, 5, 14, 55, 8, 15, B.brick);
  w.ent('item', 54, 9, 14);

  walk(66, 72, 14, 16);
  // boss arena
  walk(73, 97, 5, 25, 5, B.darkstone);
  w.fill(73, 5, 5, 97, 7, 5, B.brick);
  w.fill(73, 5, 25, 97, 7, 25, B.brick);
  w.fill(97, 5, 5, 97, 7, 25, B.brick);
  w.ent('checkpoint', 75, 5, 15);
  // stepped pillars so the player can drop onto the boss
  for (const [px, pz] of [[80, 9], [80, 20], [89, 9], [89, 20]]) {
    w.fill(px, 5, pz, px + 1, 8, pz + 1, B.stone);
    w.fill(px - 1, 5, pz, px - 1, 5, pz + 1, B.stone);
    w.fill(px - 2, 5, pz, px - 2, 6, pz + 1, B.stone);
    w.fill(px - 3, 5, pz, px - 3, 7, pz + 1, B.stone);
  }
  w.enemy('golem', 86, 5, 15, { boss: true, rot: 3 });
  w.ent('item', 95, 5, 7);
  w.fill(93, 5, 14, 95, 5, 16, B.gold);
  w.ent('goal', 94, 6, 15);
  return w.finish({ sky: 'sunset', bossLocksGoal: true, enemyModels: {} });
}

const DEFAULTS = [
  { name: 'はじまりの草原', description: '基本操作を覚えよう。ジャンプで敵をふみつけ、ゴールゲートを目指せ！', requiredItems: 0, make: meadow },
  { name: '空中庭園', description: '雲の足場を渡る空のステージ。ジャンプ台で高い島へ！', requiredItems: 2, make: skyGarden },
  { name: '溶岩の砦', description: '溶岩に囲まれた砦。最奥のゴーレムを倒すとゴールが開く。', requiredItems: 5, make: lavaFort },
];

export async function seedWorlds(db) {
  const n = (await db.get('SELECT COUNT(*) AS n FROM worlds')).n;
  if (n > 0) return;
  let sys = await db.get("SELECT id FROM users WHERE name = 'system'");
  if (!sys) {
    const r = await db.run("INSERT INTO users (name, pass_hash, salt, created_at) VALUES ('system', NULL, NULL, ?)", [Date.now()]);
    sys = { id: r.lastID };
  }
  for (const d of DEFAULTS) {
    const data = d.make();
    const err = validateWorld(data);
    if (err) throw new Error(`default world "${d.name}": ${err}`);
    const items = data.entities.filter((e) => e.type === 'item').length;
    const boss = data.entities.some((e) => e.type === 'enemy' && e.boss) ? 1 : 0;
    await db.run(
      `INSERT INTO worlds (user_id, name, description, required_items, item_count, has_boss, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sys.id, d.name, d.description, d.requiredItems, items, boss, JSON.stringify(data), Date.now(), Date.now()]
    );
  }
  console.log(`Seeded ${DEFAULTS.length} default worlds`);
}
