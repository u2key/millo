// Automatic joint detection for voxel characters and rigged mesh building.
import * as THREE from 'three';
import { meshCells } from './voxel.js';

const key = (x, y, z) => `${x},${y},${z}`;

function components2D(cells) {
  // cells: array of [x,z]; returns array of arrays
  const set = new Set(cells.map(([x, z]) => x + ',' + z));
  const seen = new Set();
  const comps = [];
  for (const [x, z] of cells) {
    const k = x + ',' + z;
    if (seen.has(k)) continue;
    const comp = [];
    const stack = [[x, z]];
    seen.add(k);
    while (stack.length) {
      const [cx, cz] = stack.pop();
      comp.push([cx, cz]);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = cx + dx + ',' + (cz + dz);
        if (set.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push([cx + dx, cz + dz]); }
      }
    }
    comps.push(comp);
  }
  return comps;
}

function components3D(voxels) {
  const map = new Map(voxels.map((v) => [key(v[0], v[1], v[2]), v]));
  const seen = new Set();
  const comps = [];
  for (const v of voxels) {
    const k = key(v[0], v[1], v[2]);
    if (seen.has(k)) continue;
    seen.add(k);
    const comp = [];
    const stack = [v];
    while (stack.length) {
      const c = stack.pop();
      comp.push(c);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const nk = key(c[0] + dx, c[1] + dy, c[2] + dz);
        const n = map.get(nk);
        if (n && !seen.has(nk)) { seen.add(nk); stack.push(n); }
      }
    }
    comps.push(comp);
  }
  return comps;
}

const center = (vs, i) => vs.reduce((s, v) => s + v[i], 0) / vs.length + 0.5;
const minOf = (vs, i) => Math.min(...vs.map((v) => v[i]));
const maxOf = (vs, i) => Math.max(...vs.map((v) => v[i]));

/**
 * Detects legs / arms / head of a voxel model.
 * Returns { type: 'humanoid' | 'legged' | 'blob', parts: [{ name, voxels, pivot:[x,y,z] }], bbox }
 */
export function detectJoints(voxels) {
  const bbox = {
    min: [minOf(voxels, 0), minOf(voxels, 1), minOf(voxels, 2)],
    max: [maxOf(voxels, 0), maxOf(voxels, 1), maxOf(voxels, 2)],
  };
  const blob = { type: 'blob', parts: [{ name: 'body', voxels, pivot: [center(voxels, 0), bbox.min[1], center(voxels, 2)] }], bbox };
  const H = bbox.max[1] - bbox.min[1] + 1;
  if (voxels.length < 8 || H < 6) return blob;

  const layers = new Map();
  for (const v of voxels) {
    if (!layers.has(v[1])) layers.set(v[1], []);
    layers.get(v[1]).push([v[0], v[2]]);
  }

  const widthAt = (y) => {
    const c = layers.get(y);
    if (!c) return 0;
    let a = Infinity, b = -Infinity;
    for (const [x] of c) { if (x < a) a = x; if (x > b) b = x; }
    return b - a + 1;
  };

  // 1a) legs: bottom layers that split into 2+ separate footprints
  let hipY = null;
  for (let y = bbox.min[1]; y <= bbox.max[1]; y++) {
    const cells = layers.get(y) || [];
    // ignore specks so a ragged hem is not mistaken for legs
    const n = cells.length ? components2D(cells).filter((c) => c.length >= Math.max(2, cells.length * 0.05)).length : 0;
    if (y === bbox.min[1] && n < 2) break;
    if (n < 2) { hipY = y; break; }
  }
  // 1b) touching legs (e.g. classic block characters): the silhouette suddenly
  //     widens where the arms begin; everything below that is treated as legs.
  if (hipY === null || hipY - bbox.min[1] < 2) {
    hipY = null;
    const w0 = widthAt(bbox.min[1]);
    for (let y = bbox.min[1] + 1; y <= bbox.max[1]; y++) {
      const w = widthAt(y);
      if (w >= w0 + 4) { hipY = y; break; }
      if (w === 0) break;
    }
    if (hipY !== null && (hipY - bbox.min[1] < 3 || w0 < 2)) hipY = null;
  }
  const legH = hipY === null ? 0 : hipY - bbox.min[1];
  if (hipY === null || legH > H * 0.65) return blob;

  // leg columns = x range of the footprint on the ground
  const foot = voxels.filter((v) => v[1] <= bbox.min[1] + 1);
  const tx0 = minOf(foot, 0), tx1 = maxOf(foot, 0);
  const cx = (tx0 + tx1 + 1) / 2;
  const legVox = voxels.filter((v) => v[1] < hipY && v[0] >= tx0 && v[0] <= tx1);
  const legL = legVox.filter((v) => v[0] + 0.5 < cx);
  const legR = legVox.filter((v) => v[0] + 0.5 >= cx);
  if (!legL.length || !legR.length) return blob;
  const legSet = new Set(legVox.map((v) => key(v[0], v[1], v[2])));
  const upper = voxels.filter((v) => !legSet.has(key(v[0], v[1], v[2])));

  // 2) arms: side protrusions outside the leg span that do not reach the top,
  //    with a narrower part (neck/head) right above them.
  const side = upper.filter((v) => v[0] < tx0 || v[0] > tx1);
  const fill = (c) => {
    const vol = (maxOf(c, 0) - minOf(c, 0) + 1) * (maxOf(c, 1) - minOf(c, 1) + 1) * (maxOf(c, 2) - minOf(c, 2) + 1);
    return c.length / vol;
  };
  // per side keep the biggest limb-like (box-ish, hanging) component
  const pickArm = (cands) => cands
    .filter((c) => maxOf(c, 1) < bbox.max[1] - 1 && maxOf(c, 1) - minOf(c, 1) >= 2 && fill(c) >= 0.5)
    .sort((a, b) => b.length - a.length)[0];
  const sideComps = components3D(side);
  let armComps = [pickArm(sideComps.filter((c) => c[0][0] < tx0)), pickArm(sideComps.filter((c) => c[0][0] > tx1))].filter(Boolean);
  if (armComps.length) {
    const all = armComps.flat();
    const top = maxOf(all, 1);
    const span = maxOf(all, 0) - minOf(all, 0) + 1;
    if (widthAt(top + 1) > span - 4) armComps = [];
  }
  const armSet = new Set();
  const armL = [], armR = [];
  for (const c of armComps) {
    for (const v of c) {
      armSet.add(key(v[0], v[1], v[2]));
      (v[0] < tx0 ? armL : armR).push(v);
    }
  }

  // 3) head: everything above the shoulders
  const parts = [];
  let headBottom = null;
  if (armL.length || armR.length) {
    headBottom = Math.max(...[...armL, ...armR].map((v) => v[1])) + 1;
    if (bbox.max[1] - headBottom + 1 < 2) headBottom = null;
  }
  const head = headBottom === null ? [] : upper.filter((v) => v[1] >= headBottom && !armSet.has(key(v[0], v[1], v[2])));
  const headSet = new Set(head.map((v) => key(v[0], v[1], v[2])));
  const body = upper.filter((v) => !armSet.has(key(v[0], v[1], v[2])) && !headSet.has(key(v[0], v[1], v[2])));

  parts.push({ name: 'body', voxels: body, pivot: [cx, hipY, body.length ? center(body, 2) : center(voxels, 2)] });
  parts.push({ name: 'legL', voxels: legL, pivot: [center(legL, 0), hipY, center(legL, 2)] });
  parts.push({ name: 'legR', voxels: legR, pivot: [center(legR, 0), hipY, center(legR, 2)] });
  if (armL.length) parts.push({ name: 'armL', voxels: armL, pivot: [tx0, maxOf(armL, 1) - 0.5, center(armL, 2)] });
  if (armR.length) parts.push({ name: 'armR', voxels: armR, pivot: [tx1 + 1, maxOf(armR, 1) - 0.5, center(armR, 2)] });
  if (head.length) parts.push({ name: 'head', voxels: head, pivot: [center(head, 0), headBottom, center(head, 2)] });
  return { type: armL.length || armR.length ? 'humanoid' : 'legged', parts, bbox };
}

export const PART_TINT = { body: 0xffffff, legL: 0x4da3ff, legR: 0x2f6fd6, armL: 0xffb347, armR: 0xff7f2a, head: 0x7ee081 };

function partGeometry(vs, scale, offset, tint) {
  const map = new Map(vs.map((v) => [key(v[0], v[1], v[2]), v[3]]));
  const xs = vs.map((v) => v[0]), ys = vs.map((v) => v[1]), zs = vs.map((v) => v[2]);
  const bounds = [Math.min(...xs), Math.min(...ys), Math.min(...zs), Math.max(...xs) + 1, Math.max(...ys) + 1, Math.max(...zs) + 1];
  const tc = tint != null ? new THREE.Color(tint) : null;
  return meshCells({
    bounds,
    colorAt: (x, y, z) => {
      const c = map.get(key(x, y, z));
      if (c === undefined) return -1;
      if (!tc) return c;
      const col = new THREE.Color(c).lerp(tc, 0.55);
      return col.getHex();
    },
    occludes: (x, y, z) => map.has(key(x, y, z)),
    scale,
    offset,
    noise: 0.03,
  });
}

const charMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
const ghostMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.72 });

/**
 * Builds an animated character from a voxel model.
 * The model's feet are placed at y=0 and it is centred on x/z; it faces +z.
 */
export function buildCharacter(voxels, targetHeight, { tintParts = false, ghostly = false } = {}) {
  const rig = detectJoints(voxels);
  const { bbox } = rig;
  const hVox = bbox.max[1] - bbox.min[1] + 1;
  const s = targetHeight / hVox;
  const cx = (bbox.min[0] + bbox.max[0] + 1) / 2, cz = (bbox.min[2] + bbox.max[2] + 1) / 2;
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  const parts = {};
  const mat = ghostly ? ghostMaterial : charMaterial;
  for (const p of rig.parts) {
    if (!p.voxels.length) continue;
    const g = new THREE.Group();
    const [px, py, pz] = p.pivot;
    g.position.set((px - cx) * s, (py - bbox.min[1]) * s, (pz - cz) * s);
    const geo = partGeometry(p.voxels, s, [-px * s, -py * s, -pz * s], tintParts ? PART_TINT[p.name] : null);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    g.add(mesh);
    inner.add(g);
    parts[p.name] = g;
    if (tintParts) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.03, s * 0.9)), new THREE.MeshBasicMaterial({ color: 0xff2266, depthTest: false }));
      dot.renderOrder = 10;
      g.add(dot);
    }
  }
  const width = (bbox.max[0] - bbox.min[0] + 1) * s, depth = (bbox.max[2] - bbox.min[2] + 1) * s;
  const ch = {
    root, inner, parts, type: rig.type, height: targetHeight, width, depth, phase: 0,
    rig,
    /** state: { speed (0..1+), ground, t, dt, squash } */
    animate({ speed = 0, ground = true, dt = 0.016, t = 0, flap = false }) {
      ch.phase += dt * (4 + speed * 8) * (speed > 0.05 ? 1 : 0);
      const sw = Math.sin(ch.phase) * Math.min(1, speed) * 0.9;
      if (parts.legL) {
        const air = ground ? 0 : 1;
        parts.legL.rotation.x = ground ? sw : 0.5;
        parts.legR.rotation.x = ground ? -sw : -0.3;
        if (parts.armL) { parts.armL.rotation.x = air ? -2.6 : -sw; parts.armL.rotation.z = air ? -0.2 : 0; }
        if (parts.armR) { parts.armR.rotation.x = air ? -2.6 : sw; parts.armR.rotation.z = air ? 0.2 : 0; }
        if (parts.head) parts.head.rotation.y = Math.sin(t * 0.7) * 0.15 * (1 - Math.min(1, speed));
        inner.position.y = ground ? Math.abs(Math.sin(ch.phase)) * 0.04 * Math.min(1, speed) * targetHeight : 0;
        inner.scale.set(1, 1, 1);
      } else {
        // blob: squash & stretch / flapping bob
        const k = flap ? Math.sin(t * 14) * 0.08 : Math.sin(t * 6 + ch.phase) * (0.05 + speed * 0.06);
        inner.scale.set(1 - k * 0.6, 1 + k, 1 - k * 0.6);
        inner.position.y = flap ? Math.sin(t * 3) * 0.1 : 0;
      }
    },
    dispose() {
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    },
  };
  return ch;
}
