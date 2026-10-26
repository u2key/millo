// Built-in voxel characters. All designs are original to this project.
import { MODEL_GRID } from '../shared/world.js';

function V() {
  const map = new Map();
  const [GX, GY, GZ] = MODEL_GRID;
  const api = {
    set(x, y, z, c) {
      if (x < 0 || y < 0 || z < 0 || x >= GX || y >= GY || z >= GZ) return api;
      map.set(`${x},${y},${z}`, c);
      return api;
    },
    del(x, y, z) { map.delete(`${x},${y},${z}`); return api; },
    box(x0, y0, z0, x1, y1, z1, c) {
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) api.set(x, y, z, c);
      return api;
    },
    ellipsoid(cx, cy, cz, rx, ry, rz, c, pred) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
          for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
            if (d <= 1 && (!pred || pred(x, y, z))) api.set(x, y, z, c);
          }
      return api;
    },
    // recolor existing voxels on a face plane
    paint(pred, c) {
      for (const k of map.keys()) {
        const [x, y, z] = k.split(',').map(Number);
        if (pred(x, y, z)) map.set(k, c);
      }
      return api;
    },
    out() {
      return [...map].map(([k, c]) => {
        const [x, y, z] = k.split(',').map(Number);
        return [x, y, z, c];
      });
    },
  };
  return api;
}

// Humanoid helper: classic 4-8-4 proportions centred in the 24-wide grid.
function humanoid({ skin, shirt, sleeve, pants, shoes, head }) {
  const v = V();
  v.box(8, 0, 10, 11, 11, 13, pants).box(12, 0, 10, 15, 11, 13, pants);
  v.box(8, 0, 10, 11, 1, 13, shoes).box(12, 0, 10, 15, 1, 13, shoes);
  v.box(8, 12, 10, 15, 23, 13, shirt);
  v.box(4, 12, 10, 7, 23, 13, skin).box(16, 12, 10, 19, 23, 13, skin);
  v.box(4, 18, 10, 7, 23, 13, sleeve).box(16, 18, 10, 19, 23, 13, sleeve);
  v.box(8, 24, 8, 15, 31, 15, head || skin);
  return v;
}

function leafHero() {
  const green = 0x3f9e4a, dark = 0x2c6e35;
  const v = humanoid({ skin: 0xf2c391, shirt: green, sleeve: green, pants: 0x6b4a2e, shoes: 0x3a2a1c });
  v.box(8, 12, 10, 15, 13, 13, 0x7a5228); // belt
  v.set(11, 12, 13, 0xe8c547).set(12, 12, 13, 0xe8c547);
  // hood
  v.box(8, 29, 8, 15, 31, 15, green).box(8, 24, 8, 15, 31, 9, green);
  v.box(8, 24, 8, 8, 31, 15, dark).box(15, 24, 8, 15, 31, 15, dark);
  v.box(9, 28, 15, 14, 28, 15, 0x5b3a22); // hair fringe
  v.set(10, 26, 15, 0x1d2b4a).set(13, 26, 15, 0x1d2b4a);
  v.set(10, 27, 15, 0xffffff).set(13, 27, 15, 0xffffff);
  v.box(11, 25, 15, 12, 25, 15, 0xc9776a);
  v.box(10, 14, 9, 13, 21, 9, 0x8a5a2b); // backpack
  return { name: 'リーフ', kind: 'player', voxels: v.out() };
}

function boltBot() {
  const metal = 0xb7c2cc, dark = 0x55606b;
  const v = humanoid({ skin: metal, shirt: metal, sleeve: dark, pants: dark, shoes: 0x2f353b, head: metal });
  v.box(10, 16, 13, 13, 21, 13, 0x2e86de);
  v.set(11, 19, 13, 0x7fd3ff).set(12, 19, 13, 0x7fd3ff);
  v.box(4, 12, 10, 7, 13, 13, 0xf5a623).box(16, 12, 10, 19, 13, 13, 0xf5a623);
  v.box(9, 26, 15, 14, 28, 15, 0x1b2a38); // visor
  v.box(10, 27, 15, 10, 27, 15, 0x4cf2ff).box(13, 27, 15, 13, 27, 15, 0x4cf2ff);
  v.box(7, 26, 11, 7, 28, 12, dark).box(16, 26, 11, 16, 28, 12, dark);
  v.del(8, 31, 8).del(15, 31, 8).del(8, 31, 15).del(15, 31, 15);
  return { name: 'ボルト', kind: 'player', voxels: v.out() };
}

function catMimi() {
  const fur = 0xf2a654, white = 0xfff4e6;
  const v = humanoid({ skin: fur, shirt: 0xd94f70, sleeve: 0xd94f70, pants: 0x3b4a8c, shoes: 0xfafafa });
  v.box(8, 24, 8, 15, 29, 15, fur);
  v.box(8, 30, 9, 9, 31, 11, fur).box(14, 30, 9, 15, 31, 11, fur);
  v.set(9, 30, 11, 0xffb6c1).set(14, 30, 11, 0xffb6c1);
  v.box(9, 24, 15, 14, 25, 15, white);
  v.set(10, 27, 15, 0x2a7d2e).set(13, 27, 15, 0x2a7d2e).set(10, 26, 15, 0x111111).set(13, 26, 15, 0x111111);
  v.set(11, 25, 15, 0xff8fa3).set(12, 25, 15, 0xff8fa3);
  v.box(11, 12, 7, 12, 13, 9, fur).box(11, 13, 5, 12, 14, 6, fur).box(11, 15, 4, 12, 17, 4, fur); // tail
  v.box(10, 14, 13, 13, 17, 13, white);
  return { name: 'ミミ', kind: 'player', voxels: v.out() };
}

function slime() {
  const v = V();
  v.ellipsoid(11.5, 4.5, 11.5, 6.5, 5.2, 6.5, 0x4ccf6a, (x, y) => y >= 0);
  v.box(5, 0, 5, 18, 0, 18, 0x3aa856);
  v.paint((x, y, z) => y <= 1, 0x34a050);
  v.box(8, 5, 17, 9, 7, 17, 0x111111).box(14, 5, 17, 15, 7, 17, 0x111111);
  v.set(8, 7, 17, 0xffffff).set(14, 7, 17, 0xffffff);
  v.box(10, 3, 17, 13, 3, 17, 0x1f6e33);
  return { name: 'スライム', kind: 'enemy', voxels: v.out() };
}

function acorn() {
  const v = V();
  v.box(8, 0, 11, 10, 1, 13, 0x5a3a20).box(13, 0, 11, 15, 1, 13, 0x5a3a20);
  v.ellipsoid(11.5, 7, 12, 6, 6, 5.5, 0xc98a45, (x, y) => y >= 2);
  v.ellipsoid(11.5, 11, 12, 6.8, 4, 6.3, 0x6e4422, (x, y) => y >= 10);
  v.box(11, 15, 11, 12, 17, 12, 0x4a2e16);
  v.box(9, 7, 17, 10, 8, 17, 0x111111).box(13, 7, 17, 14, 8, 17, 0x111111);
  v.box(8, 9, 17, 10, 9, 17, 0x3b2410).box(13, 9, 17, 15, 9, 17, 0x3b2410); // angry brows
  v.box(10, 5, 17, 13, 5, 17, 0x6b3d1a);
  return { name: 'ドングリン', kind: 'enemy', voxels: v.out() };
}

function bat() {
  const v = V(), body = 0x5a3d7a, wing = 0x3b2754;
  v.ellipsoid(11.5, 8, 11.5, 3.5, 4, 3.5, body);
  v.box(10, 12, 11, 10, 13, 11, body).box(13, 12, 11, 13, 13, 11, body);
  v.box(1, 8, 11, 8, 10, 12, wing).box(15, 8, 11, 22, 10, 12, wing);
  v.box(1, 7, 11, 2, 7, 12, wing).box(5, 7, 11, 6, 7, 12, wing).box(17, 7, 11, 18, 7, 12, wing).box(21, 7, 11, 22, 7, 12, wing);
  v.box(0, 10, 11, 0, 11, 12, wing).box(23, 10, 11, 23, 11, 12, wing);
  v.set(10, 9, 15, 0xffe14d).set(13, 9, 15, 0xffe14d);
  v.set(11, 7, 15, 0xffffff).set(12, 7, 15, 0xffffff);
  return { name: 'コウモリ', kind: 'enemy', voxels: v.out() };
}

function spikeBall() {
  const v = V(), c = 11.5;
  v.ellipsoid(c, 9, c, 6, 6, 6, 0x6c6f78);
  const spikes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7], [0.7, 0, 0.7], [-0.7, 0, 0.7], [0.7, 0, -0.7], [-0.7, 0, -0.7], [0.6, -0.6, 0.5], [-0.6, -0.6, -0.5]];
  for (const [dx, dy, dz] of spikes)
    for (let r = 6; r <= 9; r++) v.set(Math.round(c + dx * r), Math.round(9 + dy * r), Math.round(c + dz * r), r === 9 ? 0xffffff : 0xd8d8e0);
  v.box(9, 3, 9, 14, 3, 14, 0x6c6f78);
  v.box(9, 9, 17, 10, 10, 17, 0xff3b30).box(13, 9, 17, 14, 10, 17, 0xff3b30);
  v.box(9, 6, 17, 14, 6, 17, 0x222222);
  return { name: 'トゲボール', kind: 'enemy', voxels: v.out() };
}

function frog() {
  const v = V(), g = 0x58b947;
  v.box(5, 0, 6, 8, 2, 13, g).box(15, 0, 6, 18, 2, 13, g); // big back legs
  v.ellipsoid(11.5, 5, 12, 6.5, 4.2, 6.5, g, (x, y) => y >= 1);
  v.box(8, 1, 13, 15, 3, 17, 0xd8f0b0);
  v.box(6, 8, 14, 9, 11, 17, g).box(14, 8, 14, 17, 11, 17, g);
  v.box(7, 9, 17, 8, 10, 17, 0xffffff).box(15, 9, 17, 16, 10, 17, 0xffffff);
  v.set(7, 9, 17, 0x111111).set(16, 9, 17, 0x111111);
  v.box(8, 4, 18, 15, 4, 18, 0xb03050);
  return { name: 'ピョンガエル', kind: 'enemy', voxels: v.out() };
}

function ghost() {
  const v = V(), w = 0xf1f3ff;
  v.ellipsoid(11.5, 12, 11.5, 7, 8, 7, w, (x, y) => y >= 4);
  for (let x = 5; x <= 18; x++) for (let z = 5; z <= 18; z++) {
    const d = (x - 11.5) ** 2 + (z - 11.5) ** 2;
    if (d <= 30 || (d <= 42 && (x + z) % 2 === 0)) v.box(x, 1, z, x, 4, z, w);
  }
  v.box(8, 13, 18, 10, 16, 18, 0x1a1a2e).box(13, 13, 18, 15, 16, 18, 0x1a1a2e);
  v.box(10, 9, 18, 13, 10, 18, 0x2a1a3e);
  v.box(5, 9, 10, 5, 11, 13, w).box(18, 9, 10, 18, 11, 13, w);
  return { name: 'ユーレイ', kind: 'enemy', voxels: v.out() };
}

function turret() {
  const v = V();
  v.box(5, 0, 5, 18, 3, 18, 0x4a4f57);
  v.box(6, 4, 6, 17, 12, 17, 0x6b717a);
  v.box(6, 12, 6, 17, 12, 17, 0x8a2b2b);
  v.box(9, 6, 18, 14, 11, 23, 0x2b2f35);
  v.box(10, 7, 23, 13, 10, 23, 0x0d0d0d);
  v.box(7, 9, 17, 8, 10, 17, 0xff5a3c).box(15, 9, 17, 16, 10, 17, 0xff5a3c);
  return { name: 'ほうだい', kind: 'enemy', voxels: v.out() };
}

function boar() {
  const v = V(), fur = 0x7a5232;
  v.box(6, 0, 5, 8, 4, 7, 0x4a301c).box(15, 0, 5, 17, 4, 7, 0x4a301c);
  v.box(6, 0, 15, 8, 4, 17, 0x4a301c).box(15, 0, 15, 17, 4, 17, 0x4a301c);
  v.box(6, 5, 4, 17, 13, 19, fur);
  v.box(9, 14, 4, 14, 15, 15, 0x5a3a22); // mane
  v.box(8, 7, 20, 15, 13, 22, fur);
  v.box(10, 7, 23, 13, 9, 23, 0xe39a9a);
  v.set(11, 8, 23, 0x5a2a2a).set(12, 8, 23, 0x5a2a2a);
  v.box(8, 6, 22, 8, 9, 23, 0xfffbe6).box(15, 6, 22, 15, 9, 23, 0xfffbe6);
  v.set(9, 11, 23, 0x111111).set(14, 11, 23, 0x111111);
  v.box(7, 13, 19, 8, 15, 20, fur).box(15, 13, 19, 16, 15, 20, fur);
  return { name: 'イノシシ', kind: 'enemy', voxels: v.out() };
}

function knight() {
  const armor = 0x9aa3ad, dark = 0x5d6670;
  const v = humanoid({ skin: armor, shirt: armor, sleeve: dark, pants: dark, shoes: 0x3a3f45, head: armor });
  v.box(9, 26, 15, 14, 27, 15, 0x111111);
  v.box(11, 24, 15, 12, 29, 15, dark);
  v.box(11, 31, 10, 12, 31, 14, 0xd0312d).box(11, 30, 8, 12, 30, 9, 0xd0312d);
  v.box(10, 15, 13, 13, 20, 13, 0x2a4fa0);
  v.box(17, 10, 14, 18, 13, 15, 0x6b4a2e); // hilt
  v.box(17, 13, 16, 18, 24, 16, 0xdfe6ee); // blade
  v.box(2, 13, 9, 3, 22, 14, 0x2a4fa0); // shield
  return { name: 'ヨロイ騎士', kind: 'enemy', voxels: v.out() };
}

function golem() {
  const v = V(), stone = 0x8c8f87, moss = 0x5f8a3a;
  v.box(6, 0, 8, 10, 9, 14, stone).box(13, 0, 8, 17, 9, 14, stone);
  v.box(5, 10, 7, 18, 22, 15, stone);
  v.box(1, 9, 8, 4, 22, 14, stone).box(19, 9, 8, 22, 22, 14, stone);
  v.box(0, 9, 8, 4, 12, 14, 0x6f726b).box(19, 9, 8, 23, 12, 14, 0x6f726b); // fists
  v.box(8, 23, 8, 15, 30, 15, stone);
  v.box(9, 26, 16, 10, 27, 16, 0xff9a1f).box(13, 26, 16, 14, 27, 16, 0xff9a1f);
  v.box(9, 24, 16, 14, 24, 16, 0x5b5d57);
  v.box(5, 21, 7, 18, 22, 15, moss).box(8, 30, 8, 15, 31, 15, moss);
  v.box(10, 14, 16, 13, 17, 16, 0xff9a1f);
  return { name: 'ゴーレム', kind: 'enemy', voxels: v.out() };
}

const make = {
  leaf: leafHero, bolt: boltBot, mimi: catMimi,
  slime, acorn, bat, spike: spikeBall, frog, ghost, turret, boar, knight, golem,
};

export const BUILTIN_MODELS = Object.entries(make).map(([key, fn]) => {
  const m = fn();
  return { id: 'b:' + key, builtin: true, owner: 'デフォルト', name: m.name, kind: m.kind, data: { voxels: m.voxels } };
});

export const DEFAULT_PLAYER = 'b:leaf';
export const defaultEnemyModelId = (type) => 'b:' + type;
