// Simple procedural meshes for items, goals, checkpoints and markers.
import * as THREE from 'three';

export function makeCrystal(collected = false) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({
    color: collected ? 0x7aa6ff : 0xffd23f,
    emissive: collected ? 0x1a2a66 : 0x7a5200,
    transparent: collected,
    opacity: collected ? 0.55 : 1,
    flatShading: true,
  });
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), mat);
  gem.scale.set(0.8, 1.25, 0.8);
  g.add(gem);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.035, 6, 24), new THREE.MeshBasicMaterial({ color: collected ? 0xaecbff : 0xfff3b0 }));
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  g.userData.spin = gem;
  return g;
}

export function makeGoal() {
  const g = new THREE.Group();
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  for (const x of [-1.1, 1.1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3, 0.35), pillarMat);
    p.position.set(x, 1.5, 0);
    g.add(p);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.35, 0.45), new THREE.MeshLambertMaterial({ color: 0xffc83d }));
  top.position.y = 3.1;
  g.add(top);
  const portalMat = new THREE.MeshBasicMaterial({ color: 0x7af0ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 2.9), portalMat);
  portal.position.y = 1.45;
  g.add(portal);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 8, 24), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  ring.position.y = 1.6;
  g.add(ring);
  g.userData.portal = portal;
  g.userData.ring = ring;
  return g;
}

export function setGoalLocked(goal, locked) {
  goal.userData.portal.material.color.set(locked ? 0x444455 : 0x7af0ff);
  goal.userData.portal.material.opacity = locked ? 0.25 : 0.45;
  goal.userData.ring.visible = !locked;
}

export function makeCheckpoint() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
  pole.position.y = 1.1;
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshLambertMaterial({ color: 0x888888, side: THREE.DoubleSide }));
  flag.position.set(0.42, 1.9, 0);
  g.add(flag);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.12, 12), new THREE.MeshLambertMaterial({ color: 0x666666 }));
  base.position.y = 0.06;
  g.add(base);
  g.userData.flag = flag;
  return g;
}

export function setCheckpointActive(cp, active) {
  cp.userData.flag.material.color.set(active ? 0x3ddc84 : 0x888888);
}

export function makeStartMarker() {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 20), new THREE.MeshBasicMaterial({ color: 0x3d8bff, transparent: true, opacity: 0.8 }));
  disc.position.y = 0.03;
  g.add(disc);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 4), new THREE.MeshBasicMaterial({ color: 0x3d8bff }));
  arrow.position.y = 2.4;
  arrow.rotation.x = Math.PI;
  g.add(arrow);
  return g;
}

export function makeProjectile() {
  return new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5522 }));
}

const shadowTex = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

export function makeBlobShadow(size = 1) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

export const SKY_PRESETS = {
  day: { bg: 0x8fd3ff, fog: 0xbfe6ff, hemiSky: 0xffffff, hemiGround: 0x6a7a55, sun: 0xffffff, sunI: 1.6, hemiI: 1.1 },
  sunset: { bg: 0xf7a072, fog: 0xf9c39a, hemiSky: 0xffe1c4, hemiGround: 0x5a3a40, sun: 0xffc48a, sunI: 1.4, hemiI: 1.0 },
  night: { bg: 0x101a3a, fog: 0x18244a, hemiSky: 0x8899ff, hemiGround: 0x202030, sun: 0xaabbff, sunI: 0.7, hemiI: 0.8 },
};

export function setupSky(scene, sky = 'day', fogFar = 140) {
  const p = SKY_PRESETS[sky] || SKY_PRESETS.day;
  scene.background = new THREE.Color(p.bg);
  scene.fog = new THREE.Fog(p.fog, fogFar * 0.45, fogFar);
  const hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemiI);
  const sun = new THREE.DirectionalLight(p.sun, p.sunI);
  sun.position.set(0.5, 1, 0.3);
  scene.add(hemi, sun);
  return { hemi, sun };
}
