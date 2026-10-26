// Renders world / model thumbnails with a shared off-screen renderer.
import * as THREE from 'three';
import { VoxelWorld } from './voxel.js';
import { buildCharacter } from './rig.js';
import { setupSky, makeGoal, makeCrystal } from './props.js';

let renderer = null;
function getRenderer(w, h) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  }
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  return renderer;
}

export function worldThumbnail(data, w = 320, h = 200) {
  const scene = new THREE.Scene();
  setupSky(scene, data.sky, 1000);
  scene.fog = null;
  const world = new VoxelWorld({ size: data.size, blocks: data.blocks });
  world.update();
  scene.add(world.group);
  for (const e of data.entities) {
    if (e.type === 'goal') { const g = makeGoal(); g.position.set(e.x + 0.5, e.y, e.z + 0.5); g.rotation.y = ((e.rot ?? 1) * Math.PI) / 2; scene.add(g); }
    if (e.type === 'item') { const g = makeCrystal(); g.position.set(e.x + 0.5, e.y + 0.6, e.z + 0.5); scene.add(g); }
  }
  // frame the non-empty part of the world
  const box = new THREE.Box3();
  world.group.children.forEach((m) => { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); });
  if (box.isEmpty()) box.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(...data.size));
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const cam = new THREE.PerspectiveCamera(40, w / h, 0.1, 2000);
  cam.position.set(c.x - size * 0.35, c.y + size * 0.55, c.z + size * 0.75);
  cam.lookAt(c);
  const r = getRenderer(w, h);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/jpeg', 0.8);
  world.disposeMeshes();
  scene.traverse((o) => o.geometry && o.geometry.dispose());
  return url;
}

const modelCache = new Map();
export function modelThumbnail(model, size = 128) {
  const key = model.id + ':' + (model.updatedAt || '') + ':' + model.data.voxels.length;
  if (modelCache.has(key)) return modelCache.get(key);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.6, 1, 0.8);
  scene.add(sun);
  const ch = buildCharacter(model.data.voxels, 2);
  ch.root.rotation.y = -0.5;
  scene.add(ch.root);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const ext = Math.max(2, ch.width, ch.depth);
  cam.position.set(0, 1.2, ext * 2.4 + 2.2);
  cam.lookAt(0, 1, 0);
  const r = getRenderer(size, size);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  ch.dispose();
  modelCache.set(key, url);
  return url;
}
