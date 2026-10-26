// Voxel meshing, voxel world container, ray casting and AABB collision.
import * as THREE from 'three';
import { BLOCKS, decodeBlocks, encodeBlocks } from '/shared/world.js';

// ---- face tables -------------------------------------------------------
// Each face: normal, two tangent axes and the 4 corners (unit cube coords).
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];
// Make every quad counter-clockwise when seen from outside and precompute AO offsets.
for (const f of FACES) {
  const [a, b, c] = f.c.map((p) => new THREE.Vector3(...p));
  const cr = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  if (cr.dot(new THREE.Vector3(...f.n)) < 0) f.c.reverse();
  const axis = f.n.findIndex((v) => v !== 0);
  const tang = [0, 1, 2].filter((i) => i !== axis);
  f.ao = f.c.map((corner) => {
    const s1 = [...f.n], s2 = [...f.n];
    s1[tang[0]] += corner[tang[0]] ? 1 : -1;
    s2[tang[1]] += corner[tang[1]] ? 1 : -1;
    const cc = [...f.n];
    cc[tang[0]] += corner[tang[0]] ? 1 : -1;
    cc[tang[1]] += corner[tang[1]] ? 1 : -1;
    return [s1, s2, cc];
  });
}
const AO_CURVE = [0.55, 0.72, 0.86, 1.0];
const FACE_SHADE = [0.86, 0.86, 1.0, 0.6, 0.93, 0.93];

function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const tmpColor = new THREE.Color();

/**
 * Generic culled mesher.
 *  - bounds: [x0,y0,z0,x1,y1,z1) cells to emit
 *  - colorAt(x,y,z,face) -> hex color or -1 (skip cell)
 *  - occludes(x,y,z) -> neighbour hides faces / darkens AO
 */
export function meshCells({ bounds, colorAt, occludes, sameKind, scale = 1, offset = [0, 0, 0], noise = 0.06, ao = true }) {
  const pos = [], col = [], nor = [], idx = [];
  const [x0, y0, z0, x1, y1, z1] = bounds;
  for (let y = y0; y < y1; y++)
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++) {
        for (let fi = 0; fi < 6; fi++) {
          const f = FACES[fi];
          const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
          const c = colorAt(x, y, z, fi);
          if (c < 0) break;
          if (occludes(nx, ny, nz) || (sameKind && sameKind(x, y, z, nx, ny, nz))) continue;
          tmpColor.setHex(c);
          const v = 1 + (hash3(x, y, z) - 0.5) * 2 * noise;
          const base = pos.length / 3;
          const aos = [];
          for (let k = 0; k < 4; k++) {
            const p = f.c[k];
            pos.push((x + p[0]) * scale + offset[0], (y + p[1]) * scale + offset[1], (z + p[2]) * scale + offset[2]);
            nor.push(...f.n);
            let a = 3;
            if (ao) {
              const [s1, s2, cc] = f.ao[k];
              const o1 = occludes(x + s1[0], y + s1[1], z + s1[2]) ? 1 : 0;
              const o2 = occludes(x + s2[0], y + s2[1], z + s2[2]) ? 1 : 0;
              const o3 = occludes(x + cc[0], y + cc[1], z + cc[2]) ? 1 : 0;
              a = o1 && o2 ? 0 : 3 - (o1 + o2 + o3);
            }
            aos.push(a);
            const s = AO_CURVE[a] * FACE_SHADE[fi] * v;
            col.push(tmpColor.r * s, tmpColor.g * s, tmpColor.b * s);
          }
          if (aos[0] + aos[2] < aos[1] + aos[3]) idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---- world -----------------------------------------------------------------
export const worldMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
export const glassMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false });
export const lavaMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });

const CH = 16;

export class VoxelWorld {
  constructor(data) {
    this.load(data);
  }

  load(data) {
    const [W, H, D] = data.size;
    this.W = W; this.H = H; this.D = D;
    this.blocks = data.blocks instanceof Uint8Array ? data.blocks : decodeBlocks(data.blocks, W * H * D);
    if (this.group) this.disposeMeshes();
    this.group = this.group || new THREE.Group();
    this.chunks = new Map();
    this.dirty = new Set();
    for (let cy = 0; cy < Math.ceil(H / CH); cy++)
      for (let cz = 0; cz < Math.ceil(D / CH); cz++)
        for (let cx = 0; cx < Math.ceil(W / CH); cx++) this.dirty.add(`${cx},${cy},${cz}`);
  }

  encode() {
    return encodeBlocks(this.blocks);
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.W && y < this.H && z < this.D;
  }
  get(x, y, z) {
    if (!this.inBounds(x, y, z)) return 0;
    return this.blocks[x + z * this.W + y * this.W * this.D];
  }
  set(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return false;
    const i = x + z * this.W + y * this.W * this.D;
    if (this.blocks[i] === id) return false;
    this.blocks[i] = id;
    const cx = Math.floor(x / CH), cy = Math.floor(y / CH), cz = Math.floor(z / CH);
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const ax = Math.floor((x + dx) / CH), ay = Math.floor((y + dy) / CH), az = Math.floor((z + dz) / CH);
          if (ax >= 0 && ay >= 0 && az >= 0) this.dirty.add(`${ax},${ay},${az}`);
        }
    this.dirty.add(`${cx},${cy},${cz}`);
    return true;
  }
  block(x, y, z) {
    return BLOCKS[this.get(Math.floor(x), Math.floor(y), Math.floor(z))];
  }
  isSolid(x, y, z) {
    const b = this.get(x, y, z);
    return b !== 0 && BLOCKS[b].solid;
  }
  isOpaque(x, y, z) {
    const b = this.get(x, y, z);
    return b !== 0 && !BLOCKS[b].transparent;
  }

  update() {
    for (const key of this.dirty) this.buildChunk(key);
    this.dirty.clear();
  }

  buildChunk(key) {
    const [cx, cy, cz] = key.split(',').map(Number);
    if (cx * CH >= this.W || cy * CH >= this.H || cz * CH >= this.D) return;
    const old = this.chunks.get(key);
    if (old) for (const m of old) { this.group.remove(m); m.geometry.dispose(); }
    const bounds = [cx * CH, cy * CH, cz * CH, Math.min(this.W, cx * CH + CH), Math.min(this.H, cy * CH + CH), Math.min(this.D, cz * CH + CH)];
    const meshes = [];
    const passes = [
      [worldMaterial, (b) => !b.transparent && !b.glow],
      [lavaMaterial, (b) => b.glow],
      [glassMaterial, (b) => b.transparent],
    ];
    for (const [mat, accept] of passes) {
      const g = meshCells({
        bounds,
        colorAt: (x, y, z, f) => {
          const id = this.get(x, y, z);
          if (!id || !accept(BLOCKS[id])) return -1;
          const b = BLOCKS[id];
          return f === 2 ? b.top : f === 3 ? b.bottom : b.side;
        },
        occludes: (x, y, z) => this.isOpaque(x, y, z),
        sameKind: (x, y, z, nx, ny, nz) => this.get(x, y, z) === this.get(nx, ny, nz),
        ao: mat !== lavaMaterial,
      });
      if (g.index.count === 0) { g.dispose(); continue; }
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false;
      m.userData.world = true;
      this.group.add(m);
      meshes.push(m);
    }
    this.chunks.set(key, meshes);
  }

  disposeMeshes() {
    for (const ms of this.chunks.values()) for (const m of ms) { this.group.remove(m); m.geometry.dispose(); }
    this.chunks.clear();
  }

  // Highest solid block top at column (x,z) below y; returns -Infinity if none.
  groundBelow(x, y, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    for (let iy = Math.min(this.H - 1, Math.floor(y)); iy >= 0; iy--) if (this.isSolid(ix, iy, iz)) return iy + 1;
    return -Infinity;
  }
}

// ---- ray casting (Amanatides & Woo) -------------------------------------------
export function raycastVoxels(origin, dir, maxDist, isHit) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
  const tdx = sx ? Math.abs(1 / dir.x) : Infinity, tdy = sy ? Math.abs(1 / dir.y) : Infinity, tdz = sz ? Math.abs(1 / dir.z) : Infinity;
  let tx = sx ? (sx > 0 ? x + 1 - origin.x : origin.x - x) * tdx : Infinity;
  let ty = sy ? (sy > 0 ? y + 1 - origin.y : origin.y - y) * tdy : Infinity;
  let tz = sz ? (sz > 0 ? z + 1 - origin.z : origin.z - z) * tdz : Infinity;
  let n = [0, 0, 0], t = 0;
  for (let i = 0; i < 1024 && t <= maxDist; i++) {
    if (isHit(x, y, z)) return { x, y, z, n, t };
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; n = [-sx, 0, 0]; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; n = [0, -sy, 0]; }
    else { z += sz; t = tz; tz += tdz; n = [0, 0, -sz]; }
  }
  return null;
}

// ---- AABB vs voxel collision -------------------------------------------------
// p: bottom-centre position (Vector3), hw: half width, h: height, v: velocity.
const EPS = 1e-4;
export function moveAABB(world, p, hw, h, v, dt) {
  const res = { ground: false, ceil: false, wallX: false, wallZ: false, groundId: 0 };
  const maxMove = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt;
  const steps = Math.max(1, Math.ceil(maxMove / 0.35));
  const sdt = dt / steps;
  for (let s = 0; s < steps; s++) {
    for (const axis of ['y', 'x', 'z']) {
      const d = v[axis] * sdt;
      if (d === 0) continue;
      p[axis] += d;
      const minX = Math.floor(p.x - hw + EPS), maxX = Math.floor(p.x + hw - EPS);
      const minY = Math.floor(p.y + EPS), maxY = Math.floor(p.y + h - EPS);
      const minZ = Math.floor(p.z - hw + EPS), maxZ = Math.floor(p.z + hw - EPS);
      let hit = false, hitCell = 0;
      outer: for (let y = minY; y <= maxY; y++)
        for (let z = minZ; z <= maxZ; z++)
          for (let x = minX; x <= maxX; x++)
            if (world.isSolid(x, y, z)) {
              hit = true;
              hitCell = axis === 'x' ? x : axis === 'y' ? y : z;
              if (axis === 'y' && d < 0) {
                // pick the highest blocking cell for the ground
                hitCell = Math.max(hitCell, y);
                res.groundId = world.get(x, y, z);
              }
              if (d > 0) break outer;
            }
      if (!hit) continue;
      if (axis === 'y') {
        if (d < 0) { p.y = minY + 1; res.ground = true; }
        else { p.y = maxY - h; res.ceil = true; }
      } else if (axis === 'x') {
        p.x = d > 0 ? maxX - hw : minX + 1 + hw;
        res.wallX = true;
      } else {
        p.z = d > 0 ? maxZ - hw : minZ + 1 + hw;
        res.wallZ = true;
      }
      v[axis] = 0;
    }
  }
  return res;
}

// Returns block ids overlapping an AABB (used for hazards).
export function touchingBlocks(world, p, hw, h, pad = 0.05) {
  const ids = new Set();
  for (let y = Math.floor(p.y - pad); y <= Math.floor(p.y + h); y++)
    for (let z = Math.floor(p.z - hw - pad); z <= Math.floor(p.z + hw + pad); z++)
      for (let x = Math.floor(p.x - hw - pad); x <= Math.floor(p.x + hw + pad); x++) {
        const b = world.get(x, y, z);
        if (b) ids.add(b);
      }
  return ids;
}
