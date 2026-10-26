// App shell: login, world list (with rankings), avatar selection and screen switching.
import * as THREE from 'three';
import { api, setToken, hasToken } from './api.js';
import { BUILTIN_MODELS, DEFAULT_PLAYER, defaultEnemyModelId } from './models.js';
import { buildCharacter } from './rig.js';
import { worldThumbnail, modelThumbnail } from './thumbs.js';
import { Game } from './game.js';
import { WorldEditor } from './worldEditor.js';
import { ModelEditor } from './modelEditor.js';
import { sfx } from './sfx.js';
import { el, esc, formatTime, toast, confirmDialog } from './ui-util.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

const app = {
  canvas, renderer, api,
  hud: $('#hud'),
  ui: $('#screen-ui'),
  user: null,
  models: [...BUILTIN_MODELS],
  avatarId: store.get('millo.avatar', DEFAULT_PLAYER),
  resize(camera) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio()))
      renderer.setSize(w, h, false);
    if (camera.aspect !== w / h) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  },
  getModel(id) {
    return app.models.find((m) => m.id === id) || null;
  },
  async reloadModels() {
    try {
      const { models } = await api.models();
      app.models = [...BUILTIN_MODELS, ...models];
    } catch (e) {
      toast(e.message, 'error');
    }
  },
  avatarVoxels() {
    return (app.getModel(app.avatarId) || app.getModel(DEFAULT_PLAYER)).data.voxels;
  },
  enemyVoxels(type, overrides = {}) {
    const m = (overrides && overrides[type] && app.getModel(overrides[type])) || app.getModel(defaultEnemyModelId(type));
    return m.data.voxels;
  },
};
window.millo = app; // handy for debugging from the console

function setMode(mode) {
  // mode: 'menu' (HTML screens) or 'canvas' (game/editors)
  document.body.dataset.mode = mode;
  for (const s of document.querySelectorAll('.screen')) s.hidden = true;
}

function showScreen(id) {
  setMode('menu');
  $(id).hidden = false;
}

// ------------------------------------------------------------------ auth
function showAuth() {
  showScreen('#auth');
  const form = $('#auth-form');
  let mode = 'login';
  const setMode2 = (m) => {
    mode = m;
    $('#auth-title').textContent = m === 'login' ? 'ログイン' : '新規登録';
    $('#auth-submit').textContent = m === 'login' ? 'ログイン' : '登録してはじめる';
    $('#auth-switch').textContent = m === 'login' ? 'はじめての方はこちら（新規登録）' : 'アカウントをお持ちの方（ログイン）';
    $('#auth-error').textContent = '';
  };
  setMode2('login');
  $('#auth-switch').onclick = (e) => { e.preventDefault(); setMode2(mode === 'login' ? 'register' : 'login'); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = form.name.value.trim(), password = form.password.value;
    try {
      const r = mode === 'login' ? await api.login(name, password) : await api.register(name, password);
      setToken(r.token);
      app.user = r.user;
      await enterHub();
    } catch (err) {
      $('#auth-error').textContent = err.message;
    }
  };
}

// ------------------------------------------------------------------ hub
const thumbCache = new Map();
let worldList = [];

async function enterHub() {
  showScreen('#hub');
  $('#hub-user').textContent = app.user.name;
  await Promise.all([refreshUser(), app.reloadModels()]);
  await loadWorlds();
}

async function refreshUser() {
  try {
    app.user = (await api.me()).user;
  } catch {}
  $('#hub-items').textContent = app.user.totalItems;
}

async function loadWorlds() {
  const grid = $('#world-grid');
  try {
    worldList = (await api.worlds()).worlds;
  } catch (e) {
    grid.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    return;
  }
  grid.innerHTML = '';
  for (const w of worldList) {
    const locked = app.user.totalItems < w.requiredItems && w.ownerId !== app.user.id;
    const card = el(`<div class="world-card ${locked ? 'locked' : ''}" tabindex="0">
      <div class="thumb"><img alt=""><div class="lock">${locked ? `🔒<br>◆ ${w.requiredItems} 個で開放` : ''}</div>
        ${w.requiredItems ? `<span class="req">◆${w.requiredItems}</span>` : ''}${w.hasBoss ? '<span class="boss-tag">BOSS</span>' : ''}
        ${w.online ? `<span class="online-badge">🌐 ${w.online}人プレイ中</span>` : ''}</div>
      <div class="info"><b>${esc(w.name)}</b><span class="muted small">by ${esc(w.owner)}</span>
        <span class="small">◆ ${w.myItems || 0}/${w.itemCount} ・ ベスト ${formatTime(w.myBest)}</span></div>
    </div>`);
    const img = card.querySelector('img');
    if (w.thumbnail) img.src = w.thumbnail;
    else lazyThumb(w.id, img);
    card.onmouseenter = (e) => showTooltip(w, card);
    card.onmouseleave = hideTooltip;
    card.onclick = () => { hideTooltip(); openWorldModal(w); };
    card.onkeydown = (e) => { if (e.key === 'Enter') card.onclick(); };
    grid.appendChild(card);
  }
  if (!worldList.length) grid.innerHTML = '<p class="muted">まだワールドがありません。</p>';
}

async function lazyThumb(id, img) {
  if (thumbCache.has(id)) { img.src = thumbCache.get(id); return; }
  try {
    const { world } = await api.world(id);
    const url = worldThumbnail(world.data);
    thumbCache.set(id, url);
    img.src = url;
  } catch {}
}

function rankingTable(list, limit) {
  if (!list.length) return '<p class="muted small">まだクリアした人はいません</p>';
  return `<ol class="ranking">${list.slice(0, limit).map((r, i) =>
    `<li class="${r.name === app.user.name ? 'me' : ''}"><span class="rk rk${i + 1}">${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="tm">${formatTime(r.timeMs)}</span></li>`).join('')}</ol>`;
}

function showTooltip(w, card) {
  const tip = $('#tooltip');
  tip.innerHTML = `<b>${esc(w.name)}</b><div class="muted small">クリア ${w.clearCount} 人 ・ プレイ ${w.plays} 回${w.online ? ` ・ 🌐 ${w.online}人がオンライン` : ''}</div><h5>ランキング TOP5</h5>${rankingTable(w.ranking, 5)}`;
  tip.hidden = false;
  const r = card.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = r.right + 10, y = r.top;
  if (x + tw > window.innerWidth - 8) x = r.left - tw - 10;
  if (x < 8) x = Math.min(window.innerWidth - tw - 8, r.left);
  if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
  tip.style.left = x + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}
function hideTooltip() {
  $('#tooltip').hidden = true;
}

async function openWorldModal(w) {
  const locked = app.user.totalItems < w.requiredItems && w.ownerId !== app.user.id;
  const mine = w.ownerId === app.user.id;
  const o = el(`<div class="overlay modal-layer"><div class="panel world-modal">
    <button class="close" data-a="close">✕</button>
    <div class="cols">
      <div>
        <img class="modal-thumb" src="${w.thumbnail || thumbCache.get(w.id) || ''}" alt="">
        <h2>${esc(w.name)}</h2>
        <p class="muted small">作者: ${esc(w.owner)} ・ プレイ ${w.plays} 回 ・ クリア ${w.clearCount} 人</p>
        <p>${esc(w.description) || '<span class="muted">説明なし</span>'}</p>
        <div class="stats">
          <div><span>開放条件</span><b>◆ ${w.requiredItems}</b></div>
          <div><span>クリスタル</span><b>${w.myItems || 0} / ${w.itemCount}</b></div>
          <div><span>自己ベスト</span><b>${formatTime(w.myBest)}</b></div>
          <div><span>ボス</span><b>${w.hasBoss ? 'あり' : 'なし'}</b></div>
        </div>
        ${locked ? `<p class="lock-msg">🔒 クリスタルをあと ${w.requiredItems - app.user.totalItems} 個集めると開放されます</p>` : ''}
        <div class="row wrap">
          <button class="btn primary big" data-a="play" ${locked ? 'disabled' : ''}>▶ ソロでプレイ</button>
          <button class="btn big" data-a="online" ${locked ? 'disabled' : ''} title="同じワールドにいる他のプレイヤーがリアルタイムで見えます">🌐 オンラインでプレイ${w.online ? `（${w.online}人）` : ''}</button>
          ${mine ? '<button class="btn" data-a="edit">✎ 編集</button>' : ''}
          <button class="btn" data-a="copy">複製して編集</button>
          ${mine ? '<button class="btn danger" data-a="del">削除</button>' : ''}
        </div>
      </div>
      <div>
        <h3>クリアタイム ランキング</h3>
        <div data-k="rank"><p class="muted">読み込み中…</p></div>
      </div>
    </div>
  </div></div>`);
  document.body.appendChild(o);
  const close = () => { o.remove(); window.removeEventListener('keydown', onEsc); };
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', onEsc);
  o.onclick = (e) => { if (e.target === o) close(); };
  o.querySelector('[data-a="close"]').onclick = close;
  api.ranking(w.id).then(({ ranking }) => (o.querySelector('[data-k="rank"]').innerHTML = rankingTable(ranking, 100))).catch(() => {});
  o.querySelector('[data-a="play"]').onclick = () => { close(); showAvatarSelect({ mode: 'play', world: w, online: false }); };
  o.querySelector('[data-a="online"]').onclick = () => { close(); showAvatarSelect({ mode: 'play', world: w, online: true }); };
  const edit = async (copy) => {
    try {
      const { world } = await api.world(w.id);
      close();
      openWorldEditor(copy ? { ...world, id: null, ownerId: null } : world);
    } catch (e) { toast(e.message, 'error'); }
  };
  o.querySelector('[data-a="copy"]').onclick = () => edit(true);
  if (mine) {
    o.querySelector('[data-a="edit"]').onclick = () => edit(false);
    o.querySelector('[data-a="del"]').onclick = async () => {
      if (!(await confirmDialog(`「${w.name}」を削除しますか？`, '削除'))) return;
      try { await api.deleteWorld(w.id); close(); loadWorlds(); } catch (e) { toast(e.message, 'error'); }
    };
  }
}

// ------------------------------------------------------------------ avatar select / model workshop
let preview = null;

function showAvatarSelect({ mode, world, selectId, online = false }) {
  showScreen('#avatar');
  const root = $('#avatar');
  let selected = selectId || app.avatarId;
  if (mode === 'play' && !app.getModel(selected)) selected = DEFAULT_PLAYER;
  let filter = mode === 'play' ? 'player' : 'all';
  root.innerHTML = `
    <div class="avatar-head">
      <button class="btn" data-a="back">← 戻る</button>
      <h2>${mode === 'play' ? `アバターを選んでスタート <small class="muted">${esc(world.name)}${online ? ' ・ 🌐 オンライン' : ' ・ ソロ'}</small>` : 'モデル工房'}</h2>
      <span class="grow"></span>
      <div class="tabs"><button data-f="player">プレイヤー用</button><button data-f="enemy">敵キャラ用</button><button data-f="all">すべて</button></div>
    </div>
    <div class="avatar-body">
      <div class="avatar-preview">
        <canvas data-k="pv"></canvas>
        <div class="pv-name" data-k="pvname"></div>
        <div class="col">
          ${mode === 'play' ? '<button class="btn primary big" data-a="start">このアバターでスタート ▶</button>' : ''}
          <div class="row wrap">
            <button class="btn" data-a="new">＋ 白紙から作る</button>
            <button class="btn" data-a="edit">選択中を元に作る / 編集</button>
          </div>
          <div class="row wrap">
            <button class="btn" data-a="img">画像から作る</button>
            <button class="btn" data-a="stl">STLから作る</button>
            <button class="btn danger" data-a="del">削除</button>
          </div>
          <p class="muted small">関節（頭・腕・脚）は形から自動で認識されます。</p>
        </div>
      </div>
      <div class="model-grid" data-k="grid"></div>
    </div>`;
  const q = (k) => root.querySelector(`[data-k="${k}"]`);
  const pv = q('pv');
  if (preview) preview.dispose();
  preview = createPreview(pv);

  const render = () => {
    root.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('active', b.dataset.f === filter));
    const list = app.models.filter((m) => filter === 'all' || m.kind === filter || m.kind === 'any');
    q('grid').innerHTML = '';
    for (const m of list) {
      const card = el(`<button class="model-card ${m.id === selected ? 'active' : ''}"><img alt=""><span>${esc(m.name)}</span><small class="muted">${m.builtin ? 'デフォルト' : esc(m.owner)}</small></button>`);
      card.querySelector('img').src = modelThumbnail(m);
      card.onclick = () => { selected = m.id; sfx.click(); render(); };
      card.ondblclick = () => mode === 'play' && start();
      q('grid').appendChild(card);
    }
    const m = app.getModel(selected);
    if (m) preview.set(m.data.voxels);
    q('pvname').textContent = m ? m.name : '';
    const own = m && !m.builtin && m.ownerId === app.user.id;
    root.querySelector('[data-a="del"]').hidden = !own;
    root.querySelector('[data-a="edit"]').textContent = own ? '選択中を編集' : '選択中を元に作る';
  };
  root.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { filter = b.dataset.f; render(); }));
  render();

  const leave = () => { preview.dispose(); preview = null; };
  const start = async () => {
    const m = app.getModel(selected);
    if (!m) return;
    app.avatarId = selected;
    store.set('millo.avatar', selected);
    leave();
    await playWorld(world, online);
  };
  const openEditor = (model, importKind) => {
    leave();
    setMode('canvas');
    const ed = new ModelEditor(app, {
      model,
      onExit: (saved) => showAvatarSelect({ mode, world, online, selectId: saved ? saved.id : selected }),
    });
    if (importKind) ed.importDialog(importKind);
  };
  root.querySelector('[data-a="back"]').onclick = () => { leave(); enterHub(); };
  if (mode === 'play') root.querySelector('[data-a="start"]').onclick = start;
  root.querySelector('[data-a="new"]').onclick = () => openEditor(null);
  root.querySelector('[data-a="edit"]').onclick = () => openEditor(app.getModel(selected));
  root.querySelector('[data-a="img"]').onclick = () => openEditor(null, 'image');
  root.querySelector('[data-a="stl"]').onclick = () => openEditor(null, 'stl');
  root.querySelector('[data-a="del"]').onclick = async () => {
    const m = app.getModel(selected);
    if (!m || !(await confirmDialog(`モデル「${m.name}」を削除しますか？`, '削除'))) return;
    try {
      await api.deleteModel(m.id);
      await app.reloadModels();
      selected = DEFAULT_PLAYER;
      render();
    } catch (e) { toast(e.message, 'error'); }
  };

  // gamepad: A to start, B to go back, d-pad/stick to cycle
  let prev = [];
  const poll = () => {
    if (!preview) return;
    requestAnimationFrame(poll);
    const p = [...(navigator.getGamepads?.() || [])].find((g) => g && g.connected);
    if (!p) return;
    const b = p.buttons.map((x) => x.pressed);
    const edge = (i) => b[i] && !prev[i];
    const list = app.models.filter((m) => filter === 'all' || m.kind === filter || m.kind === 'any');
    const i = list.findIndex((m) => m.id === selected);
    if (edge(15) || edge(13)) { selected = list[(i + 1) % list.length].id; render(); }
    if (edge(14) || edge(12)) { selected = list[(i - 1 + list.length) % list.length].id; render(); }
    if (edge(0) && mode === 'play') start();
    else if (edge(1)) { leave(); enterHub(); }
    prev = b;
  };
  requestAnimationFrame(poll);
}

function createPreview(cv) {
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.5, 1, 0.8);
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 32), new THREE.MeshLambertMaterial({ color: 0x3b4b63 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  cam.position.set(0, 1.6, 6.2);
  cam.lookAt(0, 0.95, 0);
  let ch = null, running = true, last = performance.now();
  const loop = (now) => {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (w && h && (cv.width !== Math.floor(w * r.getPixelRatio()) || cv.height !== Math.floor(h * r.getPixelRatio()))) {
      r.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    if (ch) {
      ch.root.rotation.y += dt * 0.8;
      ch.animate({ speed: 0.8, ground: true, dt, t: now / 1000 });
    }
    r.render(scene, cam);
  };
  requestAnimationFrame(loop);
  return {
    set(voxels) {
      if (ch) { scene.remove(ch.root); ch.dispose(); }
      ch = buildCharacter(voxels, 1.8);
      scene.add(ch.root);
    },
    dispose() {
      running = false;
      if (ch) ch.dispose();
      r.dispose();
      r.forceContextLoss();
    },
  };
}

// ------------------------------------------------------------------ play / edit
async function playWorld(w, online = false) {
  let world;
  try {
    world = (await api.world(w.id)).world;
  } catch (e) {
    toast(e.message, 'error');
    return enterHub();
  }
  api.play(w.id).catch(() => {});
  setMode('canvas');
  new Game(app, {
    world: world.data, collected: world.collected, avatar: app.avatarVoxels(),
    online, worldId: w.id, avatarId: app.avatarId,
    onClear: async (timeMs, items) => {
      const before = app.user.totalItems;
      const res = await api.clear(w.id, timeMs, items);
      app.user.totalItems = res.totalItems;
      const nowOpen = worldList.filter((x) => x.requiredItems > before && x.requiredItems <= res.totalItems);
      if (nowOpen.length) {
        setTimeout(() => { sfx.unlock(); toast(`新しいワールドが開放されました: ${nowOpen.map((x) => x.name).join('、')}`, 'ok', 4500); }, 900);
      }
      return res;
    },
    onExit: () => enterHub(),
  });
}

function openWorldEditor(world) {
  setMode('canvas');
  new WorldEditor(app, { world, onExit: () => enterHub() });
}

// ------------------------------------------------------------------ boot
$('#btn-new-world').onclick = () => openWorldEditor(null);
$('#btn-models').onclick = () => showAvatarSelect({ mode: 'manage' });
$('#btn-logout').onclick = async () => {
  try { await api.logout(); } catch {}
  setToken(null);
  app.user = null;
  showAuth();
};
$('#btn-mute').onclick = () => { sfx.setMuted(!sfx.muted); $('#btn-mute').textContent = sfx.muted ? '🔇' : '🔊'; };
$('#btn-mute').textContent = sfx.muted ? '🔇' : '🔊';
$('#btn-help').onclick = () => { $('#help-modal').hidden = false; };
$('#help-modal').onclick = (e) => { if (e.target.id === 'help-modal' || e.target.dataset.a === 'close') $('#help-modal').hidden = true; };

(async () => {
  if (hasToken()) {
    try {
      app.user = (await api.me()).user;
      return enterHub();
    } catch {
      setToken(null);
    }
  }
  showAuth();
})();
