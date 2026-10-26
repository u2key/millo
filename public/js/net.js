// Online mode: WebSocket session and rendering of other players.
import * as THREE from 'three';
import { getToken } from './api.js';
import { buildCharacter } from './rig.js';
import { makeBlobShadow } from './props.js';

export class NetSession {
  /** onEvent(msg) receives every server message plus {t:'status', online:boolean} */
  constructor({ worldId, avatar, onEvent }) {
    Object.assign(this, { worldId, avatar, onEvent });
    this.closed = false;
    this.connect();
  }

  connect() {
    // relative to the page so it also works behind a reverse proxy sub path
    const url = new URL('ws', document.baseURI);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', getToken() || '');
    const ws = (this.ws = new WebSocket(url));
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'join', worldId: this.worldId, avatar: this.avatar }));
      this.onEvent({ t: 'status', online: true });
    };
    ws.onmessage = (e) => {
      try { this.onEvent(JSON.parse(e.data)); } catch {}
    };
    ws.onclose = (e) => {
      if (this.closed) return;
      this.onEvent({ t: 'status', online: false });
      if (e.code !== 4001) this.retry = setTimeout(() => this.connect(), 3000);
    };
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closed = true;
    clearTimeout(this.retry);
    try { this.ws.close(); } catch {}
  }
}

function nameSprite(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = 'bold 40px system-ui, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + 28;
  c.width = w; c.height = 56;
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 56, 16);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 14, 30);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set((w / 56) * 0.32, 0.32, 1);
  s.renderOrder = 20;
  return s;
}

/** Other players in the same world, smoothly interpolated between network updates. */
export class RemotePlayers {
  constructor(scene, app) {
    this.scene = scene;
    this.app = app;
    this.map = new Map();
  }

  add({ id, name, avatar, state }) {
    this.remove(id);
    const r = { id, name, avatar, group: new THREE.Group(), pos: new THREE.Vector3(), target: new THREE.Vector3(), yaw: 0, tyaw: 0, sp: 0, g: true, d: false, seen: false };
    r.label = nameSprite(name);
    r.label.position.y = 2.15;
    r.shadow = makeBlobShadow(0.9);
    r.group.add(r.label);
    this.scene.add(r.group, r.shadow);
    this.setModel(r);
    this.map.set(id, r);
    if (state) this.state({ id, ...state });
    return r;
  }

  setModel(r) {
    if (r.ch) { r.group.remove(r.ch.root); r.ch.dispose(); }
    const m = this.app.getModel(r.avatar);
    r.missingModel = !m;
    r.ch = buildCharacter((m || this.app.getModel('b:leaf')).data.voxels, 1.8);
    r.group.add(r.ch.root);
  }

  // models created after we loaded the list: refresh once and rebuild
  async refreshMissing() {
    if (this.refreshing || ![...this.map.values()].some((r) => r.missingModel)) return;
    this.refreshing = true;
    await this.app.reloadModels();
    for (const r of this.map.values()) if (r.missingModel && this.app.getModel(r.avatar)) this.setModel(r);
  }

  state({ id, p, yaw, sp, g, d }) {
    const r = this.map.get(id);
    if (!r) return;
    r.target.set(p[0], p[1], p[2]);
    if (!r.seen || r.pos.distanceTo(r.target) > 8) r.pos.copy(r.target);
    r.seen = true;
    r.tyaw = yaw; r.sp = sp; r.g = g; r.d = d;
  }

  remove(id) {
    const r = this.map.get(id);
    if (!r) return;
    this.scene.remove(r.group, r.shadow);
    r.ch.dispose();
    r.label.material.map.dispose();
    this.map.delete(id);
  }

  update(dt, t, world) {
    for (const r of this.map.values()) {
      r.group.visible = r.seen;
      r.shadow.visible = false;
      if (!r.seen) continue;
      r.pos.lerp(r.target, Math.min(1, dt * 12));
      let dy = r.tyaw - r.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      r.yaw += dy * Math.min(1, dt * 12);
      r.group.position.copy(r.pos);
      r.ch.root.rotation.set(0, r.yaw, r.d ? Math.PI / 2 : 0);
      r.ch.animate({ speed: r.sp, ground: r.g, dt, t });
      const gy = world.groundBelow(r.pos.x, r.pos.y + 0.2, r.pos.z);
      if (Number.isFinite(gy) && r.pos.y - gy < 30) {
        r.shadow.visible = true;
        r.shadow.position.set(r.pos.x, gy + 0.02, r.pos.z);
      }
    }
  }

  get count() {
    return this.map.size;
  }

  dispose() {
    for (const id of [...this.map.keys()]) this.remove(id);
  }
}
