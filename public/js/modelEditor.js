// Voxel character editor (place / erase / paint), with image & STL import and joint preview.
import * as THREE from 'three';
import { MODEL_GRID } from '../shared/world.js';
import { meshCells, raycastVoxels } from './voxel.js';
import { buildCharacter, detectJoints } from './rig.js';
import { OrbitCam } from './orbit.js';
import { imageToVoxels, stlToVoxels } from './importers.js';
import { BUILTIN_MODELS } from './models.js';
import { el, esc, toast, confirmDialog } from './ui-util.js';

const [GX, GY, GZ] = MODEL_GRID;
const K = (x, y, z) => `${x},${y},${z}`;
const PALETTE = [
  0x000000, 0x3a3a3a, 0x7a7a7a, 0xc0c0c0, 0xffffff, 0x5b3a22, 0x8d6238, 0xc98a45, 0xf2c391, 0xffe0bd,
  0xd0312d, 0xff7f2a, 0xffc83d, 0xfff36b, 0x58b947, 0x2c6e35, 0x3ddc84, 0x2ec4b6, 0x4cf2ff, 0x2e86de,
  0x1d3b8f, 0x7b4fd6, 0xd94fd0, 0xff8fa3,
];
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class ModelEditor {
  /** opts: { model: {id?, name, kind, data:{voxels}} | null, onExit(savedModel|null) } */
  constructor(app, opts) {
    this.app = app;
    this.opts = opts;
    const m = opts.model;
    app.current = this;
    this.modelId = m && !m.builtin && m.ownerId === app.user.id ? m.id : null;
    this.name = m ? (this.modelId ? m.name : `${m.name}のコピー`) : '新しいモデル';
    if (!m) this.name = '新しいモデル';
    this.kind = m?.kind || 'player';
    this.vox = new Map();
    if (m) for (const [x, y, z, c] of m.data.voxels) this.vox.set(K(x, y, z), c);
    this.tool = 'add';
    this.color = 0xd0312d;
    this.brush = 1;
    this.mirror = true;
    this.view = 'edit';
    this.undoStack = [];
    this.redoStack = [];

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a2f3a);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x555566, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(0.5, 1, 0.8);
    this.scene.add(sun);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    this.orbit = new OrbitCam(this.camera, app.canvas, { target: new THREE.Vector3(GX / 2, GY / 2 - 2, GZ / 2), dist: 52, yaw: 0.6, pitch: 0.35 });
    const grid = new THREE.GridHelper(GX, GX, 0x666f80, 0x444b58);
    grid.position.set(GX / 2, 0.001, GZ / 2);
    this.scene.add(grid);
    const bounds = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(GX, GY, GZ)), new THREE.LineBasicMaterial({ color: 0x556070, transparent: true, opacity: 0.5 }));
    bounds.position.set(GX / 2, GY / 2, GZ / 2);
    this.scene.add(bounds);
    const front = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2, 4), new THREE.MeshBasicMaterial({ color: 0x3d8bff }));
    front.rotation.x = Math.PI / 2;
    front.position.set(GX / 2, 0.5, GZ + 2);
    this.scene.add(front);
    this.cursor = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)), new THREE.LineBasicMaterial({ color: 0xffffff }));
    this.scene.add(this.cursor);
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
    this.scene.add(this.ghost);
    this.mesh = null;
    this.preview = null;
    this.dirty = true;

    this.buildUI();
    this.bindMouse();
    this.running = true;
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- UI
  buildUI() {
    const tools = [['add', '置く', 'B'], ['erase', '消す', 'X'], ['paint', '塗る', 'P'], ['fill', '塗りつぶし', 'F'], ['pick', 'スポイト', 'I']];
    const ui = el(`<div class="editor-ui">
      <div class="topbar">
        <button class="btn" data-a="back">← 戻る</button>
        <input class="name" data-k="name" maxlength="30" value="${esc(this.name)}">
        <select data-k="kind">
          <option value="player">プレイヤー用</option><option value="enemy">敵キャラ用</option><option value="any">どちらでも</option>
        </select>
        <span class="grow"></span>
        <span class="muted" data-k="count"></span>
        <button class="btn primary" data-a="save">保存</button>
      </div>
      <div class="sidebar">
        <h4>ツール</h4>
        <div class="toolgrid">${tools.map(([k, n, h]) => `<button class="tool" data-tool="${k}">${n}<small>${h}</small></button>`).join('')}</div>
        <label class="check"><input type="checkbox" data-k="mirror" checked> 左右対称 (M)</label>
        <label class="field">ブラシ <input type="range" min="1" max="4" value="1" data-k="brush"> <span data-k="brushv">1</span></label>
        <h4>色</h4>
        <div class="colorrow"><input type="color" data-k="color" value="${hex(this.color)}"><span class="muted">Alt+クリックでスポイト</span></div>
        <div class="palette">${PALETTE.map((c) => `<button style="background:${hex(c)}" data-c="${c}"></button>`).join('')}</div>
        <h4>表示</h4>
        <div class="btnrow">
          <button class="tool" data-view="edit">編集</button>
          <button class="tool" data-view="joints">関節</button>
          <button class="tool" data-view="anim">動き</button>
        </div>
        <div class="muted small" data-k="jointInfo"></div>
        <h4>読み込み</h4>
        <div class="btnrow wrap">
          <select data-k="template"><option value="">テンプレートから…</option>${BUILTIN_MODELS.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
          <button class="btn sm" data-a="image">画像</button>
          <button class="btn sm" data-a="stl">STL</button>
          <button class="btn sm danger" data-a="clear">白紙</button>
        </div>
        <div class="btnrow"><button class="btn sm" data-a="undo">元に戻す</button><button class="btn sm" data-a="redo">やり直し</button></div>
        <div class="help small">左クリック: ツール実行<br>右ドラッグ: 回転 / 中ドラッグ・Shift+右: 移動<br>ホイール: ズーム / WASD QE: 視点移動<br>Ctrl+Z / Ctrl+Y: 元に戻す / やり直し<br>正面は青い矢印の方向です</div>
      </div>
      <input type="file" accept="image/*" data-k="imgFile" hidden>
      <input type="file" accept=".stl" data-k="stlFile" hidden>
    </div>`);
    this.app.ui.appendChild(ui);
    this.ui = ui;
    const q = (k) => ui.querySelector(`[data-k="${k}"]`);
    q('kind').value = this.kind;
    q('kind').onchange = () => (this.kind = q('kind').value);
    q('name').oninput = () => (this.name = q('name').value);
    q('mirror').onchange = () => (this.mirror = q('mirror').checked);
    q('brush').oninput = () => { this.brush = +q('brush').value; q('brushv').textContent = this.brush; };
    q('color').oninput = () => this.setColor(parseInt(q('color').value.slice(1), 16));
    ui.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => this.setColor(+b.dataset.c)));
    ui.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => this.setTool(b.dataset.tool)));
    ui.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => this.setView(b.dataset.view)));
    ui.querySelector('[data-a="back"]').onclick = () => this.exit(null);
    ui.querySelector('[data-a="save"]').onclick = () => this.save();
    ui.querySelector('[data-a="undo"]').onclick = () => this.undo();
    ui.querySelector('[data-a="redo"]').onclick = () => this.redo();
    ui.querySelector('[data-a="clear"]').onclick = async () => {
      if (await confirmDialog('モデルを白紙にしますか？', '白紙にする')) { this.snapshot(); this.vox.clear(); this.dirty = true; }
    };
    q('template').onchange = async () => {
      const m = BUILTIN_MODELS.find((b) => b.id === q('template').value);
      q('template').value = '';
      if (!m) return;
      if (this.vox.size && !(await confirmDialog(`「${m.name}」を読み込みます。現在のモデルは置き換えられます。`, '読み込む'))) return;
      this.loadVoxels(m.data.voxels);
    };
    ui.querySelector('[data-a="image"]').onclick = () => this.importDialog('image');
    ui.querySelector('[data-a="stl"]').onclick = () => this.importDialog('stl');
    this.q = q;
    this.setTool('add');
    this.setView('edit');
    this.onKey = (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); this.redo(); return; }
      if (e.ctrlKey || e.metaKey) return;
      const map = { KeyB: 'add', KeyX: 'erase', KeyP: 'paint', KeyF: 'fill', KeyI: 'pick' };
      if (map[e.code]) this.setTool(map[e.code]);
      if (e.code === 'KeyM') { this.mirror = !this.mirror; q('mirror').checked = this.mirror; }
    };
    window.addEventListener('keydown', this.onKey);
  }

  importDialog(kind) {
    const o = el(`<div class="overlay modal-layer"><div class="panel small">
      <h3>${kind === 'image' ? '画像から作成' : 'STLから作成'}</h3>
      ${kind === 'image'
        ? `<p class="muted">正面から見た絵として読み込み、奥行き方向に押し出します。透過PNG推奨（透過がない場合は左上の色を背景として除去）。</p>
           <label class="field">奥行き <input type="number" min="1" max="${GZ}" value="4" data-k="depth"></label>
           <label class="field">高さ(最大) <input type="number" min="4" max="${GY}" value="${GY}" data-k="height"></label>`
        : `<p class="muted">3Dモデルを ${GX}×${GY}×${GZ} のボクセルに変換します。読み込み後に「塗る」ツールで色付けできます。</p>
           <label class="field">高さ <input type="number" min="4" max="${GY}" value="${GY}" data-k="height"></label>
           <label class="check"><input type="checkbox" data-k="zup" checked> Z軸が上（一般的なCAD/3Dプリンタ形式）</label>
           <label class="field">色 <input type="color" value="${hex(this.color)}" data-k="col"></label>`}
      <div class="row"><button class="btn primary" data-a="pick">ファイルを選ぶ</button><button class="btn" data-a="cancel">キャンセル</button></div>
    </div></div>`);
    document.body.appendChild(o);
    const g = (k) => o.querySelector(`[data-k="${k}"]`);
    o.querySelector('[data-a="cancel"]').onclick = () => o.remove();
    o.querySelector('[data-a="pick"]').onclick = () => {
      const input = this.q(kind === 'image' ? 'imgFile' : 'stlFile');
      input.value = '';
      input.onchange = async () => {
        const f = input.files[0];
        if (!f) return;
        try {
          const vox = kind === 'image'
            ? await imageToVoxels(f, { depth: Math.max(1, Math.min(GZ, +g('depth').value || 4)), maxHeight: Math.max(4, Math.min(GY, +g('height').value || GY)) })
            : await stlToVoxels(f, { height: Math.max(4, Math.min(GY, +g('height').value || GY)), zUp: g('zup').checked, color: parseInt(g('col').value.slice(1), 16) });
          this.loadVoxels(vox);
          o.remove();
          toast(`${vox.length} ボクセルを読み込みました`);
        } catch (e) {
          toast(e.message, 'error');
        }
      };
      input.click();
    };
  }

  loadVoxels(voxels) {
    this.snapshot();
    this.vox.clear();
    for (const [x, y, z, c] of voxels) this.vox.set(K(x, y, z), c);
    this.dirty = true;
  }

  setColor(c) {
    this.color = c;
    this.q('color').value = hex(c);
    if (this.tool === 'pick' || this.tool === 'erase') this.setTool(this.prevPaintTool || 'add');
  }

  setTool(t) {
    if (t !== 'pick' && t !== 'erase') this.prevPaintTool = t;
    this.tool = t;
    this.ui.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  }

  setView(v) {
    this.view = v;
    this.ui.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    this.dirty = true;
  }

  // ---------------------------------------------------------------- editing
  snapshot() {
    this.undoStack.push(new Map(this.vox));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.vox);
    this.vox = this.undoStack.pop();
    this.dirty = true;
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.vox);
    this.vox = this.redoStack.pop();
    this.dirty = true;
  }

  inGrid(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < GX && y < GY && z < GZ;
  }

  pick(e) {
    const r = this.app.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    const hit = raycastVoxels(o, d, 400, (x, y, z) => this.vox.has(K(x, y, z)));
    if (hit) return { cell: [hit.x, hit.y, hit.z], add: [hit.x + hit.n[0], hit.y + hit.n[1], hit.z + hit.n[2]] };
    // floor plane
    if (d.y < 0) {
      const t = -o.y / d.y;
      const p = o.clone().addScaledVector(d, t);
      const x = Math.floor(p.x), z = Math.floor(p.z);
      if (x >= 0 && z >= 0 && x < GX && z < GZ) return { cell: null, add: [x, 0, z] };
    }
    return null;
  }

  mirrored(x, y, z) {
    const out = [[x, y, z]];
    if (this.mirror) {
      const mx = GX - 1 - x;
      if (mx !== x) out.push([mx, y, z]);
    }
    return out;
  }

  apply(h) {
    if (!h) return false;
    let changed = false;
    const t = this.tool;
    if (t === 'add') {
      const [x, y, z] = h.add;
      for (const p of this.mirrored(x, y, z)) if (this.inGrid(...p)) { this.vox.set(K(...p), this.color); changed = true; }
    } else if (!h.cell) {
      return false;
    } else if (t === 'erase') {
      const r = this.brush - 1;
      for (const [cx, cy, cz] of this.mirrored(...h.cell))
        for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++)
          if (dx * dx + dy * dy + dz * dz <= r * r + 0.5 && this.vox.delete(K(cx + dx, cy + dy, cz + dz))) changed = true;
    } else if (t === 'paint') {
      const r = this.brush - 1;
      for (const [cx, cy, cz] of this.mirrored(...h.cell))
        for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
          const k = K(cx + dx, cy + dy, cz + dz);
          if (dx * dx + dy * dy + dz * dz <= r * r + 0.5 && this.vox.has(k) && this.vox.get(k) !== this.color) { this.vox.set(k, this.color); changed = true; }
        }
    } else if (t === 'fill') {
      for (const start of this.mirrored(...h.cell)) {
        const from = this.vox.get(K(...start));
        if (from === undefined || from === this.color) continue;
        const stack = [start];
        while (stack.length) {
          const [x, y, z] = stack.pop();
          const k = K(x, y, z);
          if (this.vox.get(k) !== from) continue;
          this.vox.set(k, this.color);
          changed = true;
          stack.push([x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]);
        }
      }
    } else if (t === 'pick') {
      this.setColor(this.vox.get(K(...h.cell)));
    }
    if (changed) this.dirty = true;
    return changed;
  }

  bindMouse() {
    const c = this.app.canvas;
    this.onDown = (e) => {
      if (e.button !== 0 || this.view !== 'edit') return;
      const h = this.pick(e);
      if (e.altKey && h && h.cell) { this.setColor(this.vox.get(K(...h.cell))); return; }
      this.snapshot();
      this.stroke = { changed: this.apply(h), last: h && h.cell ? K(...h.cell) : null };
    };
    this.onMove = (e) => {
      this.hover = this.view === 'edit' ? this.pick(e) : null;
      if (this.stroke && (e.buttons & 1) && ['erase', 'paint'].includes(this.tool) && this.hover && this.hover.cell) {
        const k = K(...this.hover.cell);
        if (k !== this.stroke.last) { this.stroke.last = k; if (this.apply(this.hover)) this.stroke.changed = true; }
      }
    };
    this.onUp = () => {
      if (this.stroke && !this.stroke.changed) this.undoStack.pop();
      this.stroke = null;
    };
    c.addEventListener('mousedown', this.onDown);
    c.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
  }

  voxelArray() {
    return [...this.vox].map(([k, c]) => [...k.split(',').map(Number), c]);
  }

  rebuild() {
    this.dirty = false;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (this.preview) { this.scene.remove(this.preview.root); this.preview.dispose(); this.preview = null; }
    this.q('count').textContent = `${this.vox.size} ボクセル`;
    const arr = this.voxelArray();
    if (this.view === 'edit' || !arr.length) {
      const vox = this.vox;
      const g = meshCells({
        bounds: [0, 0, 0, GX, GY, GZ],
        colorAt: (x, y, z) => { const c = vox.get(K(x, y, z)); return c === undefined ? -1 : c; },
        occludes: (x, y, z) => vox.has(K(x, y, z)),
        noise: 0.02,
      });
      this.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
      this.scene.add(this.mesh);
      this.q('jointInfo').textContent = '';
    } else {
      const rig = detectJoints(arr);
      const H = rig.bbox.max[1] - rig.bbox.min[1] + 1;
      this.preview = buildCharacter(arr, H, { tintParts: this.view === 'joints' });
      const cx = (rig.bbox.min[0] + rig.bbox.max[0] + 1) / 2, cz = (rig.bbox.min[2] + rig.bbox.max[2] + 1) / 2;
      this.preview.root.position.set(cx, rig.bbox.min[1], cz);
      this.scene.add(this.preview.root);
      const names = { body: '胴体', legL: '左脚', legR: '右脚', armL: '左腕', armR: '右腕', head: '頭' };
      const kinds = { humanoid: '人型', legged: '脚つき', blob: '一体型（ぷにぷに動作）' };
      this.q('jointInfo').innerHTML = `自動認識: <b>${kinds[rig.type]}</b><br>${rig.parts.filter((p) => p.voxels.length).map((p) => names[p.name]).join(' / ')}<br>${this.view === 'joints' ? '赤い点が関節の位置です' : ''}`;
    }
  }

  async save() {
    const voxels = this.voxelArray();
    if (!voxels.length) return toast('ボクセルが1つもありません', 'error');
    const body = { name: this.name.trim() || '名無しモデル', kind: this.kind, data: { voxels } };
    try {
      if (this.modelId) await this.app.api.updateModel(this.modelId, body);
      else this.modelId = (await this.app.api.createModel(body)).id;
      await this.app.reloadModels();
      toast('モデルを保存しました', 'ok');
      this.saved = this.app.getModel(this.modelId);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ---------------------------------------------------------------- loop
  loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.app.resize(this.camera);
    this.orbit.update(dt);
    if (this.dirty) this.rebuild();
    if (this.preview && this.view === 'anim') this.preview.animate({ speed: 1, ground: Math.sin(now / 1500) > -0.7, dt, t: now / 1000 });
    const h = this.view === 'edit' ? this.hover : null;
    this.cursor.visible = this.ghost.visible = false;
    if (h) {
      const target = this.tool === 'add' ? h.add : h.cell;
      if (target && this.inGrid(...target)) {
        this.cursor.visible = true;
        this.cursor.position.set(target[0] + 0.5, target[1] + 0.5, target[2] + 0.5);
        if (this.tool === 'add') {
          this.ghost.visible = true;
          this.ghost.position.copy(this.cursor.position);
          this.ghost.material.color.setHex(this.color);
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
    this.scene.traverse((o) => o.geometry && o.geometry.dispose());
    this.ui.remove();
    this.opts.onExit?.(this.saved || null);
  }
}
