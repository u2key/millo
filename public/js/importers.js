// Converts uploaded images / STL files into voxel models.
import { MODEL_GRID } from '../shared/world.js';

const [GX, GY, GZ] = MODEL_GRID;

function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}

/**
 * Image -> voxels. The picture is treated as a front view: it is scaled to fit
 * the grid (nearest neighbour), transparent / background pixels are dropped and
 * each pixel is extruded `depth` voxels deep.
 */
export async function imageToVoxels(file, { depth = 4, maxHeight = GY, removeBg = true } = {}) {
  const img = await loadImage(file);
  const scale = Math.min(GX / img.width, maxHeight / img.height);
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  // background = colour of the corner pixel when the image has no transparency
  const hasAlpha = (() => { for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return true; return false; })();
  const bg = [px[0], px[1], px[2]];
  const isBg = (i) => {
    if (px[i + 3] < 128) return true;
    if (hasAlpha || !removeBg) return false;
    return Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) < 40;
  };
  const x0 = Math.floor((GX - w) / 2);
  const z0 = Math.floor((GZ - depth) / 2);
  const voxels = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isBg(i)) continue;
      const col = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
      for (let z = 0; z < depth; z++) voxels.push([x0 + x, h - 1 - y, z0 + z, col]);
    }
  if (!voxels.length) throw new Error('不透明なピクセルが見つかりませんでした');
  return voxels;
}

function parseSTL(buf) {
  const dv = new DataView(buf);
  const tris = [];
  const isBinary = buf.byteLength >= 84 && 84 + dv.getUint32(80, true) * 50 === buf.byteLength;
  if (isBinary) {
    const n = dv.getUint32(80, true);
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      const t = [];
      for (let k = 0; k < 3; k++) t.push([dv.getFloat32(o + k * 12, true), dv.getFloat32(o + k * 12 + 4, true), dv.getFloat32(o + k * 12 + 8, true)]);
      tris.push(t);
    }
  } else {
    const text = new TextDecoder().decode(buf);
    const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    let m, cur = [];
    while ((m = re.exec(text))) {
      cur.push([+m[1], +m[2], +m[3]]);
      if (cur.length === 3) { tris.push(cur); cur = []; }
    }
  }
  if (!tris.length) throw new Error('STLから三角形を読み取れませんでした');
  return tris;
}

/**
 * STL -> voxels: surface sampling followed by an exterior flood fill so the
 * inside becomes solid.
 */
export async function stlToVoxels(file, { height = GY, zUp = true, color = 0xb0b0b0 } = {}) {
  let tris = parseSTL(await file.arrayBuffer());
  if (zUp) tris = tris.map((t) => t.map(([x, y, z]) => [x, z, -y]));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const s = Math.min((height - 0.01) / (ext[1] || 1), (GX - 0.01) / (ext[0] || 1), (GZ - 0.01) / (ext[2] || 1));
  const off = [(GX - ext[0] * s) / 2, 0, (GZ - ext[2] * s) / 2];
  const toGrid = (p) => [(p[0] - min[0]) * s + off[0], (p[1] - min[1]) * s, (p[2] - min[2]) * s + off[2]];
  const grid = new Uint8Array(GX * GY * GZ);
  const idx = (x, y, z) => x + z * GX + y * GX * GZ;
  const mark = (p) => {
    const x = Math.floor(p[0]), y = Math.floor(p[1]), z = Math.floor(p[2]);
    if (x >= 0 && y >= 0 && z >= 0 && x < GX && y < GY && z < GZ) grid[idx(x, y, z)] = 1;
  };
  for (const t of tris) {
    const [a, b, c] = t.map(toGrid);
    const len = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]));
    const n = Math.max(1, Math.ceil(len * 2));
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n - i; j++) {
        const u = i / n, v = j / n, w = 1 - u - v;
        mark([a[0] * w + b[0] * u + c[0] * v, a[1] * w + b[1] * u + c[1] * v, a[2] * w + b[2] * u + c[2] * v]);
      }
  }
  // flood fill outside air from the grid boundary; anything unreached is interior
  const outside = new Uint8Array(grid.length);
  const stack = [];
  for (let y = 0; y < GY; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++)
    if ((x === 0 || y === 0 || z === 0 || x === GX - 1 || y === GY - 1 || z === GZ - 1) && !grid[idx(x, y, z)]) { outside[idx(x, y, z)] = 1; stack.push(x, y, z); }
  while (stack.length) {
    const z = stack.pop(), y = stack.pop(), x = stack.pop();
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= GX || ny >= GY || nz >= GZ) continue;
      const i = idx(nx, ny, nz);
      if (grid[i] || outside[i]) continue;
      outside[i] = 1;
      stack.push(nx, ny, nz);
    }
  }
  const voxels = [];
  for (let y = 0; y < GY; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++)
    if (!outside[idx(x, y, z)]) voxels.push([x, y, z, color]);
  if (!voxels.length) throw new Error('ボクセル化に失敗しました');
  return voxels;
}
