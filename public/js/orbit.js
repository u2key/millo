// Orbit camera used by the world and model editors.
// Right drag: rotate / Middle drag or Shift+Right drag: pan / Wheel: zoom / WASD+QE: move target.
import * as THREE from 'three';

export class OrbitCam {
  constructor(camera, dom, { target = new THREE.Vector3(), dist = 20, yaw = 0.8, pitch = 0.7, minDist = 2, maxDist = 300 } = {}) {
    this.camera = camera;
    this.dom = dom;
    this.target = target.clone();
    Object.assign(this, { dist, yaw, pitch, minDist, maxDist });
    this.keys = new Set();
    this.drag = null;
    this.handlers = [];
    const on = (t, e, f, o) => { t.addEventListener(e, f, o); this.handlers.push([t, e, f, o]); };
    on(dom, 'contextmenu', (e) => e.preventDefault());
    on(dom, 'mousedown', (e) => {
      if (e.button === 2 || e.button === 1) {
        this.drag = { mode: e.button === 1 || e.shiftKey ? 'pan' : 'rot', x: e.clientX, y: e.clientY, moved: 0 };
        e.preventDefault();
      }
    });
    on(window, 'mousemove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      if (this.drag.mode === 'rot') {
        this.yaw -= dx * 0.008;
        this.pitch = Math.max(-1.45, Math.min(1.5, this.pitch + dy * 0.008));
      } else {
        const s = this.dist * 0.0018;
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
        this.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
      }
    });
    on(window, 'mouseup', () => { this.drag = null; });
    on(dom, 'wheel', (e) => {
      this.dist = Math.max(this.minDist, Math.min(this.maxDist, this.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
      e.preventDefault();
    }, { passive: false });
    on(window, 'keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.ctrlKey || e.metaKey) return;
      this.keys.add(e.code);
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
  }

  update(dt) {
    const k = this.keys;
    const sp = Math.max(4, this.dist * 0.9) * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    if (k.has('KeyW')) this.target.addScaledVector(fwd, sp);
    if (k.has('KeyS')) this.target.addScaledVector(fwd, -sp);
    if (k.has('KeyD')) this.target.addScaledVector(right, sp);
    if (k.has('KeyA')) this.target.addScaledVector(right, -sp);
    if (k.has('KeyE')) this.target.y += sp;
    if (k.has('KeyQ')) this.target.y -= sp;
    const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    this.camera.position.copy(this.target).addScaledVector(off, this.dist);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  dispose() {
    for (const [t, e, f, o] of this.handlers) t.removeEventListener(e, f, o);
  }
}
