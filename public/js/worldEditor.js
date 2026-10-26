// World editor: voxel building, entity placement, world settings, test play.
import * as THREE from 'three';
import { BLOCKS, ENEMY_TYPES, SKIES, LIMITS, randomId, validateWorld, encodeBlocks } from '../shared/world.js';
import { VoxelWorld, raycastVoxels } from './voxel.js';
import { buildCharacter } from './rig.js';
import { OrbitCam } from './orbit.js';
import { makeCrystal, makeGoal, makeCheckpoint, makeStartMarker, setupSky } from './props.js';
import { worldThumbnail } from './thumbs.js';
import { Game } from './game.js';
import { el, esc, toast, confirmDialog } from './ui-util.js';

const BOSS_SCALE = 1.6;
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export function blankWorld(W = 64, H = 32, D = 64) {
  const blocks = new Uint8Array(W * H * D);
  for (let y = 0; y < 3; y++)
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) blocks[x + z * W + y * W * D] = y === 2 ? 1 : 2;
  return {
    size: [W, H, D], blocks: encodeBlocks(blocks), sky: 'day', bossLocksGoal: false, enemyModels: {},
    entities: [{ id: randomId(), type: 'start', x: 4, y: 3, z: Math.floor(D / 2), rot: 1 }],
  };
}

export class WorldEditor {
  /** opts: { world: {id?, ownerId?, name, description, requiredItems, data} | null, onExit() } */
  constructor(app, opts) {
    this.app = app;
    this.opts = opts;
    const w = opts.world;
    app.current = this;
    this.worldId = w && w.id && w.ownerId === app.user.id ? w.id : null;
    this.meta = {
      name: w ? (this.worldId ? w.name : `${w.name}のコピー`) : '新しいワールド',
      description: w?.description || '',
      requiredItems: w?.requiredItems || 0,
    };
    const data = w ? structuredClone(w.data) : blankWorld();
    if (w && !this.worldId) for (const e of data.entities) e.id = randomId();
    this.settings = { sky: data.sky || 'day', bossLocksGoal: !!data.bossLocksGoal, enemyModels: { ...(data.enemyModels || {}) } };
    this.entities = data.entities;
    this.tool = 'place';
    this.blockId = 1;
    this.enemyType = 'slime';
    this.boss = false;
    this.rot = 1;
    this.undoStack = [];
    this.redoStack = [];

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    this.lights = setupSky(this.scene, this.settings.sky, 1e9);
    this.scene.fog = null;
    this.world = new VoxelWorld({ size: data.size, blocks: data.blocks });
    this.scene.add(this.world.group);
    this.entGroup = new THREE.Group();
    this.scene.add(this.entGroup);
    this.helpers = new THREE.Group();
    this.scene.add(this.helpers);
    this.cursor = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffffff }));
    this.cursor.scale.setScalar(1.02);
    this.scene.add(this.cursor);
    this.boxPreview = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.3, depthWrite: false }));
    this.scene.add(this.boxPreview);
    const start = this.entities.find((e) => e.type === 'start');
    this.orbit = new OrbitCam(this.camera, app.canvas, {
      target: start ? new THREE.Vector3(start.x, start.y, start.z) : new THREE.Vector3(data.size[0] / 2, 4, data.size[2] / 2),
      dist: 28, yaw: -0.9, pitch: 0.7, maxDist: 400,
    });
    this.buildHelpers();
    this.rebuildEntities();
    this.buildUI();
    this.bindMouse();
    this.start();
  }

  start() {
    this.running = true;
    this.ui.hidden = false;
    this.last = performance.now();
    this.loop = this.loop || this.tick.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- scene helpers
  buildHelpers() {
    for (const c of [...this.helpers.children]) { this.helpers.remove(c); c.geometry.dispose(); }
    const { W, H, D } = this.world;
    const pts = [];
    for (let x = 0; x <= W; x += 4) pts.push(x, 0.01, 0, x, 0.01, D);
    for (let z = 0; z <= D; z += 4) pts.push(0, 0.01, z, W, 0.01, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.helpers.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.15 })));
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
    box.position.set(W / 2, H / 2, D / 2);
    this.helpers.add(box);
  }

  entityMesh(e) {
    let m;
    if (e.type === 'start') {
      m = new THREE.Group();
      const ch = buildCharacter(this.app.avatarVoxels(), 1.8, { ghostly: true });
      ch.root.rotation.y = ((e.rot ?? 1) * Math.PI) / 2;
      m.add(ch.root, makeStartMarker());
    } else if (e.type === 'goal') {
      m = makeGoal();
      m.rotation.y = ((e.rot ?? 1) * Math.PI) / 2;
    } else if (e.type === 'item') {
      m = makeCrystal();
      m.position.y = 0.6;
      const w = new THREE.Group();
      w.add(m);
      m = w;
    } else if (e.type === 'checkpoint') {
      m = makeCheckpoint();
    } else {
      const def = ENEMY_TYPES[e.enemy];
      const s = e.boss ? BOSS_SCALE : 1;
      const ch = buildCharacter(this.app.enemyVoxels(e.enemy, this.settings.enemyModels), def.h * s, { ghostly: def.ghostly });
      ch.root.rotation.y = ((e.rot ?? 1) * Math.PI) / 2;
      m = new THREE.Group();
      m.add(ch.root);
      if (e.boss) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(def.w * s * 0.8, 0.07, 6, 24), new THREE.MeshBasicMaterial({ color: 0xff3355 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.05;
        m.add(ring);
      }
    }
    m.position.add(new THREE.Vector3(e.x + 0.5, e.y, e.z + 0.5));
    m.traverse((o) => (o.userData.entId = e.id));
    return m;
  }

  rebuildEntities() {
    for (const c of [...this.entGroup.children]) {
      this.entGroup.remove(c);
      c.traverse((o) => o.geometry && o.geometry.dispose());
    }
    for (const e of this.entities) this.entGroup.add(this.entityMesh(e));
    this.updateCounts?.();
  }

  // ---------------------------------------------------------------- UI
  buildUI() {
    const blockBtns = BLOCKS.filter(Boolean).map((b) =>
      `<button class="swatch" data-block="${b.id}" title="${esc(b.name)}" style="background:linear-gradient(${hex(b.top)} 0 35%, ${hex(b.side)} 35%)"></button>`).join('');
    const enemyOpts = Object.entries(ENEMY_TYPES).map(([k, d]) => `<option value="${k}">${esc(d.name)}</option>`).join('');
    const ui = el(`<div class="editor-ui">
      <div class="topbar">
        <button class="btn" data-a="back">← 戻る</button>
        <input class="name" data-k="name" maxlength="40" value="${esc(this.meta.name)}">
        <button class="btn" data-a="settings">⚙ 設定</button>
        <span class="grow"></span>
        <span class="muted" data-k="counts"></span>
        <button class="btn" data-a="test">▶ テストプレイ</button>
        <button class="btn primary" data-a="save">保存</button>
      </div>
      <div class="sidebar">
        <h4>ブロック</h4>
        <div class="toolgrid">
          <button class="tool" data-tool="place">置く<small>B</small></button>
          <button class="tool" data-tool="erase">消す<small>X</small></button>
          <button class="tool" data-tool="paint">塗替え<small>P</small></button>
          <button class="tool" data-tool="box">範囲<small>G</small></button>
        </div>
        <div class="swatches">${blockBtns}<button class="swatch air" data-block="0" title="空気（範囲ツールで削除）">✕</button></div>
        <div class="muted small" data-k="blockName"></div>
        <h4>配置</h4>
        <div class="toolgrid">
          <button class="tool" data-tool="start">スタート</button>
          <button class="tool" data-tool="goal">ゴール</button>
          <button class="tool" data-tool="item">クリスタル</button>
          <button class="tool" data-tool="checkpoint">中間旗</button>
          <button class="tool" data-tool="enemy">敵</button>
          <button class="tool" data-tool="delent">配置物削除</button>
        </div>
        <div class="enemy-opts">
          <select data-k="enemy">${enemyOpts}</select>
          <label class="check"><input type="checkbox" data-k="boss"> ボスにする（大きく・体力UP）</label>
        </div>
        <div class="muted small">向き: <b data-k="rot"></b>（R で回転）</div>
        <div class="btnrow"><button class="btn sm" data-a="undo">元に戻す</button><button class="btn sm" data-a="redo">やり直し</button></div>
        <div class="help small">左クリック: ツール実行（Alt+クリックでブロック取得）<br>右ドラッグ: 回転 / 中ドラッグ・Shift+右: 移動<br>ホイール: ズーム / WASD QE: 視点移動<br>範囲ツール: 2点クリックで直方体を埋める（✕で削除）<br>Ctrl+Z / Ctrl+Y</div>
        <div class="muted small" data-k="pos"></div>
      </div>
    </div>`);
    this.app.ui.appendChild(ui);
    this.ui = ui;
    const q = (k) => ui.querySelector(`[data-k="${k}"]`);
    this.q = q;
    q('name').oninput = () => (this.meta.name = q('name').value);
    q('enemy').onchange = () => { this.enemyType = q('enemy').value; this.setTool('enemy'); };
    q('boss').onchange = () => { this.boss = q('boss').checked; this.setTool('enemy'); };
    ui.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => this.setTool(b.dataset.tool)));
    ui.querySelectorAll('[data-block]').forEach((b) => (b.onclick = () => this.setBlock(+b.dataset.block)));
    ui.querySelector('[data-a="back"]').onclick = async () => {
      if (await confirmDialog('エディタを終了しますか？（未保存の変更は失われます）', '終了')) this.exit();
    };
    ui.querySelector('[data-a="save"]').onclick = () => this.save();
    ui.querySelector('[data-a="test"]').onclick = () => this.testPlay();
    ui.querySelector('[data-a="settings"]').onclick = () => this.settingsDialog();
    ui.querySelector('[data-a="undo"]').onclick = () => this.undo();
    ui.querySelector('[data-a="redo"]').onclick = () => this.redo();
    this.updateCounts = () => {
      const c = (t) => this.entities.filter((e) => e.type === t).length;
      q('counts').textContent = `ゴール ${c('goal')} ・ クリスタル ${c('item')} ・ 敵 ${c('enemy')}（ボス ${this.entities.filter((e) => e.boss).length}）`;
    };
    this.updateCounts();
    this.onKey = (e) => {
      if (!this.running) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); this.redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); this.save(); return; }
      if (e.ctrlKey || e.metaKey) return;
      const map = { KeyB: 'place', KeyX: 'erase', KeyP: 'paint', KeyG: 'box' };
      if (map[e.code]) this.setTool(map[e.code]);
      if (e.code === 'KeyR') { this.rot = (this.rot + 1) % 4; this.updateRot(); }
      if (e.code === 'Escape') { this.boxStart = null; }
    };
    window.addEventListener('keydown', this.onKey);
    this.setTool('place');
    this.setBlock(1);
    this.updateRot();
  }

  updateRot() {
    this.q('rot').textContent = ['−Z（奥）', '+X（右）', '+Z（手前）', '−X（左）'][this.rot];
  }

  setTool(t) {
    this.tool = t;
    this.boxStart = null;
    this.ui.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  }

  setBlock(id) {
    this.blockId = id;
    this.ui.querySelectorAll('[data-block]').forEach((b) => b.classList.toggle('active', +b.dataset.block === id));
    this.q('blockName').textContent = id ? BLOCKS[id].name : '空気（範囲ツールで使うと削除）';
    if (!['place', 'paint', 'box'].includes(this.tool)) this.setTool(id ? 'place' : 'box');
    if (id === 0 && this.tool !== 'box') this.setTool('box');
  }

  settingsDialog() {
    const { W, H, D } = this.world;
    const models = this.app.models;
    const enemyRows = Object.entries(ENEMY_TYPES).map(([k, d]) => {
      const opts = [`<option value="">デフォルト（${esc(d.name)}）</option>`]
        .concat(models.filter((m) => m.id !== 'b:' + k).map((m) => `<option value="${m.id}" ${this.settings.enemyModels[k] === m.id ? 'selected' : ''}>${esc(m.name)}${m.builtin ? '' : '（' + esc(m.owner) + '）'}</option>`));
      return `<label class="field">${esc(d.name)} <select data-em="${k}">${opts.join('')}</select></label>`;
    }).join('');
    const o = el(`<div class="overlay modal-layer"><div class="panel">
      <h3>ワールド設定</h3>
      <div class="cols">
        <div>
          <label class="field">名前 <input data-k="n" maxlength="40" value="${esc(this.meta.name)}"></label>
          <label class="field">説明 <textarea data-k="d" maxlength="300" rows="3">${esc(this.meta.description)}</textarea></label>
          <label class="field">開放に必要なクリスタル数 <input type="number" min="0" data-k="req" value="${this.meta.requiredItems}"></label>
          <p class="muted small">プレイヤーの所持クリスタル合計がこの数以上で遊べます（消費されません）。</p>
          <label class="field">空 <select data-k="sky">${Object.entries(SKIES).map(([k, v]) => `<option value="${k}" ${this.settings.sky === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" data-k="lock" ${this.settings.bossLocksGoal ? 'checked' : ''}> ボスを全員倒すまでゴールを閉じる</label>
          <h4>サイズ（X×高さ×Z）</h4>
          <div class="row">
            <input type="number" data-k="W" min="${LIMITS.minXZ}" max="${LIMITS.maxXZ}" value="${W}">
            <input type="number" data-k="H" min="${LIMITS.minY}" max="${LIMITS.maxY}" value="${H}">
            <input type="number" data-k="D" min="${LIMITS.minXZ}" max="${LIMITS.maxXZ}" value="${D}">
          </div>
          <p class="muted small">縮小するとはみ出た部分は削除されます。</p>
        </div>
        <div>
          <h4>敵キャラのモデル</h4>
          <p class="muted small">敵の種類ごとに見た目を差し替えられます（動き・当たり判定は種類ごとに固定）。</p>
          ${enemyRows}
        </div>
      </div>
      <div class="row"><button class="btn primary" data-a="ok">適用</button><button class="btn" data-a="cancel">キャンセル</button></div>
    </div></div>`);
    document.body.appendChild(o);
    const g = (k) => o.querySelector(`[data-k="${k}"]`);
    o.querySelector('[data-a="cancel"]').onclick = () => o.remove();
    o.querySelector('[data-a="ok"]').onclick = () => {
      this.meta.name = g('n').value;
      this.q('name').value = this.meta.name;
      this.meta.description = g('d').value;
      this.meta.requiredItems = Math.max(0, parseInt(g('req').value, 10) || 0);
      if (g('sky').value !== this.settings.sky) {
        this.settings.sky = g('sky').value;
        this.scene.remove(this.lights.hemi, this.lights.sun);
        this.lights = setupSky(this.scene, this.settings.sky, 1e9);
        this.scene.fog = null;
      }
      this.settings.bossLocksGoal = g('lock').checked;
      const em = {};
      o.querySelectorAll('[data-em]').forEach((s) => { if (s.value) em[s.dataset.em] = s.value; });
      this.settings.enemyModels = em;
      const clamp = (v, a, b) => Math.max(a, Math.min(b, parseInt(v, 10) || a));
      const nW = clamp(g('W').value, LIMITS.minXZ, LIMITS.maxXZ), nH = clamp(g('H').value, LIMITS.minY, LIMITS.maxY), nD = clamp(g('D').value, LIMITS.minXZ, LIMITS.maxXZ);
      if (nW !== W || nH !== H || nD !== D) this.resize(nW, nH, nD);
      this.rebuildEntities();
      o.remove();
    };
  }

  resize(nW, nH, nD) {
    const old = this.world;
    const blocks = new Uint8Array(nW * nH * nD);
    for (let y = 0; y < Math.min(nH, old.H); y++)
      for (let z = 0; z < Math.min(nD, old.D); z++)
        for (let x = 0; x < Math.min(nW, old.W); x++) blocks[x + z * nW + y * nW * nD] = old.get(x, y, z);
    old.disposeMeshes();
    old.load({ size: [nW, nH, nD], blocks });
    this.entities = this.entities.filter((e) => e.x < nW && e.y < nH && e.z < nD);
    this.undoStack = [];
    this.redoStack = [];
    this.buildHelpers();
  }

  // ---------------------------------------------------------------- picking & editing
  pick(e) {
    const r = this.app.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    const res = {};
    const vh = raycastVoxels(o, d, 600, (x, y, z) => this.world.get(x, y, z) !== 0);
    if (vh) Object.assign(res, { cell: [vh.x, vh.y, vh.z], add: [vh.x + vh.n[0], vh.y + vh.n[1], vh.z + vh.n[2]], t: vh.t });
    else if (d.y < 0) {
      const t = -o.y / d.y;
      const p = o.clone().addScaledVector(d, t);
      const x = Math.floor(p.x), z = Math.floor(p.z);
      if (this.world.inBounds(x, 0, z)) Object.assign(res, { cell: null, add: [x, 0, z], t });
    }
    const hits = ray.intersectObjects(this.entGroup.children, true);
    if (hits.length && (res.t === undefined || hits[0].distance < res.t + 0.5)) res.ent = hits[0].object.userData.entId;
    return res.add || res.ent ? res : null;
  }

  // record a change set for undo
  commit(blockChanges, entsBefore) {
    const entsAfter = JSON.stringify(this.entities);
    if (!blockChanges.length && entsBefore === entsAfter) return;
    this.undoStack.push({ blocks: blockChanges, entsBefore, entsAfter });
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
    if (entsBefore !== entsAfter) this.rebuildEntities();
  }

  undo() {
    const a = this.undoStack.pop();
    if (!a) return;
    for (let i = a.blocks.length - 1; i >= 0; i--) { const [x, y, z, o] = a.blocks[i]; this.world.set(x, y, z, o); }
    if (a.entsBefore !== a.entsAfter) { this.entities = JSON.parse(a.entsBefore); this.rebuildEntities(); }
    this.redoStack.push(a);
  }

  redo() {
    const a = this.redoStack.pop();
    if (!a) return;
    for (const [x, y, z, , n] of a.blocks) this.world.set(x, y, z, n);
    if (a.entsBefore !== a.entsAfter) { this.entities = JSON.parse(a.entsAfter); this.rebuildEntities(); }
    this.undoStack.push(a);
  }

  setBlockAt(changes, x, y, z, id) {
    const old = this.world.get(x, y, z);
    if (!this.world.inBounds(x, y, z) || old === id) return;
    this.world.set(x, y, z, id);
    changes.push([x, y, z, old, id]);
  }

  entityAt(x, y, z) {
    return this.entities.find((e) => e.x === x && e.y === y && e.z === z);
  }

  apply(h, changes) {
    if (!h) return;
    const t = this.tool;
    const w = this.world;
    if (t === 'place') {
      if (h.add && w.inBounds(...h.add) && !this.entityAt(...h.add)) this.setBlockAt(changes, ...h.add, this.blockId || 1);
    } else if (t === 'erase' || t === 'delent') {
      if (h.ent) this.entities = this.entities.filter((e) => e.id !== h.ent);
      else if (t === 'erase' && h.cell) this.setBlockAt(changes, ...h.cell, 0);
    } else if (t === 'paint') {
      if (h.cell && this.blockId) this.setBlockAt(changes, ...h.cell, this.blockId);
    } else if (t === 'box') {
      const p = this.blockId ? h.add : h.cell || h.add;
      if (!p) return;
      if (!this.boxStart) { this.boxStart = p.slice(); return; }
      const a = this.boxStart, b = p;
      this.boxStart = null;
      const vol = (Math.abs(a[0] - b[0]) + 1) * (Math.abs(a[1] - b[1]) + 1) * (Math.abs(a[2] - b[2]) + 1);
      if (vol > 400000) return toast('範囲が大きすぎます', 'error');
      for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++)
        for (let z = Math.min(a[2], b[2]); z <= Math.max(a[2], b[2]); z++)
          for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) this.setBlockAt(changes, x, y, z, this.blockId);
    } else {
      // entity tools
      if (!h.add || !w.inBounds(...h.add)) return;
      const [x, y, z] = h.add;
      if (this.entityAt(x, y, z)) return;
      if (t === 'start') {
        const s = this.entities.find((e) => e.type === 'start');
        if (s) Object.assign(s, { x, y, z, rot: this.rot });
        else this.entities.push({ id: randomId(), type: 'start', x, y, z, rot: this.rot });
      } else if (t === 'enemy') {
        this.entities.push({ id: randomId(), type: 'enemy', enemy: this.enemyType, boss: this.boss, x, y, z, rot: this.rot });
      } else {
        this.entities.push({ id: randomId(), type: t, x, y, z, rot: this.rot });
      }
    }
  }

  bindMouse() {
    const c = this.app.canvas;
    this.onDown = (e) => {
      if (!this.running || e.button !== 0) return;
      const h = this.pick(e);
      if (e.altKey && h && h.cell) { this.setBlock(this.world.get(...h.cell)); return; }
      this.stroke = { changes: [], ents: JSON.stringify(this.entities), last: null };
      this.apply(h, this.stroke.changes);
      if (h && h.cell) this.stroke.last = h.cell.join(',');
    };
    this.onMove = (e) => {
      if (!this.running) return;
      this.hover = this.pick(e);
      if (this.stroke && (e.buttons & 1) && ['erase', 'paint'].includes(this.tool) && this.hover && this.hover.cell) {
        const k = this.hover.cell.join(',');
        if (k !== this.stroke.last) { this.stroke.last = k; this.apply(this.hover, this.stroke.changes); }
      }
    };
    this.onUp = () => {
      if (!this.stroke) return;
      this.commit(this.stroke.changes, this.stroke.ents);
      this.stroke = null;
    };
    c.addEventListener('mousedown', this.onDown);
    c.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
  }

  // ---------------------------------------------------------------- save / test
  collect() {
    return {
      size: [this.world.W, this.world.H, this.world.D],
      blocks: this.world.encode(),
      entities: this.entities.map((e) => ({ ...e })),
      sky: this.settings.sky,
      bossLocksGoal: this.settings.bossLocksGoal,
      enemyModels: { ...this.settings.enemyModels },
    };
  }

  async save() {
    const data = this.collect();
    const err = validateWorld(data);
    if (err) return toast(err, 'error');
    const name = this.meta.name.trim();
    if (!name) return toast('ワールド名を入力してください', 'error');
    const body = { name, description: this.meta.description, requiredItems: this.meta.requiredItems, data, thumbnail: worldThumbnail(data) };
    try {
      if (this.worldId) await this.app.api.updateWorld(this.worldId, body);
      else this.worldId = (await this.app.api.createWorld(body)).id;
      toast('保存しました', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  testPlay() {
    const data = this.collect();
    const err = validateWorld(data);
    if (err) return toast(err, 'error');
    this.running = false;
    this.ui.hidden = true;
    this.hover = null;
    new Game(this.app, {
      world: data, avatar: this.app.avatarVoxels(), testMode: true,
      onExit: () => this.start(),
    });
  }

  // ---------------------------------------------------------------- loop
  tick(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.app.resize(this.camera);
    this.orbit.update(dt);
    this.world.update();
    const h = this.hover;
    this.cursor.visible = false;
    this.boxPreview.visible = false;
    if (h) {
      const isEntTool = ['start', 'goal', 'item', 'checkpoint', 'enemy'].includes(this.tool);
      const useAdd = this.tool === 'place' || isEntTool || (this.tool === 'box' && this.blockId);
      const p = useAdd ? h.add : h.cell || (this.tool === 'box' ? h.add : null);
      if (p && !(h.ent && ['erase', 'delent'].includes(this.tool))) {
        this.cursor.visible = true;
        this.cursor.position.set(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5);
        this.cursor.material.color.set(useAdd ? 0xffffff : 0xff5555);
        this.q('pos').textContent = `座標 x:${p[0]} y:${p[1]} z:${p[2]}`;
        if (this.tool === 'box' && this.boxStart) {
          const a = this.boxStart;
          const min = [0, 1, 2].map((i) => Math.min(a[i], p[i])), max = [0, 1, 2].map((i) => Math.max(a[i], p[i]) + 1);
          this.boxPreview.visible = true;
          this.boxPreview.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
          this.boxPreview.scale.set(max[0] - min[0] + 0.02, max[1] - min[1] + 0.02, max[2] - min[2] + 0.02);
          this.boxPreview.material.color.set(this.blockId ? 0x66ccff : 0xff5555);
        }
      }
    }
    this.app.renderer.render(this.scene, this.camera);
  }

  exit() {
    this.running = false;
    this.orbit.dispose();
    window.removeEventListener('keydown', this.onKey);
    const c = this.app.canvas;
    c.removeEventListener('mousedown', this.onDown);
    c.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mouseup', this.onUp);
    this.world.disposeMeshes();
    this.scene.traverse((o) => o.geometry && o.geometry.dispose());
    this.ui.remove();
    this.opts.onExit?.();
  }
}
