// Gameplay: player controller, enemies, items, goal, HUD.
import * as THREE from 'three';
import { BLOCKS, ENEMY_TYPES } from '/shared/world.js';
import { VoxelWorld, moveAABB, raycastVoxels, touchingBlocks } from './voxel.js';
import { buildCharacter } from './rig.js';
import { makeCrystal, makeGoal, setGoalLocked, makeCheckpoint, setCheckpointActive, makeProjectile, makeBlobShadow, setupSky } from './props.js';
import { PlayInput } from './input.js';
import { sfx } from './sfx.js';
import { formatTime, el, esc } from './ui-util.js';
import { NetSession, RemotePlayers } from './net.js';

const HW = 0.3, PH = 1.7;
const GRAV = 32, JUMP_V = 12.4, WALK = 6, RUN = 9.5;
const BOSS_SCALE = 1.6;
const MAX_HP = 3;

export class Game {
  constructor(app, opts) {
    this.app = app;
    this.opts = opts;
    this.data = opts.world;
    app.current = this;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 500);
    const [W, , D] = this.data.size;
    setupSky(this.scene, this.data.sky, Math.max(90, Math.max(W, D) * 1.1));
    this.world = new VoxelWorld({ size: this.data.size, blocks: this.data.blocks });
    this.world.update();
    this.scene.add(this.world.group);
    this.input = new PlayInput(app.canvas);
    this.collectedBefore = new Set(opts.collected || []);
    this.cam = { yaw: -Math.PI / 2, pitch: 0.38, dist: 7.5 };
    this.buildHud();
    this.playerChar = buildCharacter(opts.avatar, 1.8);
    this.scene.add(this.playerChar.root);
    this.playerShadow = makeBlobShadow(0.9);
    this.scene.add(this.playerShadow);
    this.reset();
    if (opts.online) this.startOnline();
    this.last = performance.now();
    this.running = true;
    this.onLockChange = () => {
      if (!this.input.locked && this.state === 'play' && this.wasLocked && !this.chatting) this.setPaused(true);
      this.wasLocked = this.input.locked;
    };
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ setup
  reset() {
    for (const o of this.dynamic || []) this.scene.remove(o);
    for (const e of this.enemies || []) e.ch.dispose();
    this.dynamic = [];
    this.enemies = [];
    this.items = [];
    this.goals = [];
    this.checkpoints = [];
    this.projectiles = [];
    this.runItems = new Set();
    this.time = 0;
    this.deaths = 0;
    const start = this.data.entities.find((e) => e.type === 'start');
    this.spawn = new THREE.Vector3(start.x + 0.5, start.y, start.z + 0.5);
    this.spawnYaw = ((start.rot ?? 1) * Math.PI) / 2;
    for (const e of this.data.entities) {
      const p = new THREE.Vector3(e.x + 0.5, e.y, e.z + 0.5);
      if (e.type === 'item') {
        const m = makeCrystal(this.collectedBefore.has(e.id));
        m.position.copy(p).y += 0.6;
        this.add(m);
        this.items.push({ id: e.id, pos: m.position.clone(), mesh: m, taken: false });
      } else if (e.type === 'goal') {
        const m = makeGoal();
        m.position.copy(p);
        m.rotation.y = ((e.rot ?? 1) * Math.PI) / 2;
        this.add(m);
        this.goals.push({ pos: p, mesh: m });
      } else if (e.type === 'checkpoint') {
        const m = makeCheckpoint();
        m.position.copy(p);
        this.add(m);
        this.checkpoints.push({ pos: p, mesh: m, active: false });
      } else if (e.type === 'enemy') {
        this.spawnEnemy(e, p);
      }
    }
    this.respawnPoint = this.spawn.clone();
    this.player = {
      pos: this.spawn.clone(), vel: new THREE.Vector3(), yaw: this.spawnYaw, hp: MAX_HP, inv: 0,
      ground: false, coyote: 0, buffer: 0, groundId: 0, dead: 0, jumpCut: false,
    };
    this.cam.yaw = this.spawnYaw + Math.PI;
    this.state = 'ready';
    this.readyT = 1.4;
    this.hud.result.hidden = true;
    this.setPaused(false);
    this.updateHud();
  }

  add(o) {
    this.scene.add(o);
    this.dynamic.push(o);
  }

  spawnEnemy(e, p) {
    const def = ENEMY_TYPES[e.enemy];
    const scale = e.boss ? BOSS_SCALE : 1;
    const voxels = this.app.enemyVoxels(e.enemy, this.data.enemyModels);
    const ch = buildCharacter(voxels, def.h * scale, { ghostly: def.ghostly });
    ch.root.position.copy(p);
    this.add(ch.root);
    const shadow = makeBlobShadow(def.w * scale * 1.3);
    this.add(shadow);
    const hp = e.boss ? def.hp + 2 : def.hp;
    this.enemies.push({
      def, type: e.enemy, boss: !!e.boss, ch, shadow, pos: p.clone(), home: p.clone(), vel: new THREE.Vector3(),
      yaw: ((e.rot ?? 1) * Math.PI) / 2, hw: (def.w * scale) / 2, h: def.h * scale, hp, maxHp: hp, alive: true,
      dying: 0, inv: 0, timer: Math.random() * 1.5, state: 'walk', ground: false, t: Math.random() * 10,
    });
  }

  buildHud() {
    const root = this.app.hud;
    root.innerHTML = `
      <div class="hud-top">
        <div class="hud-box"><span class="hud-ico">⏱</span><span data-k="time">0:00.00</span></div>
        <div class="hud-box" data-k="hearts"></div>
        <div class="hud-box"><span class="hud-ico gem">◆</span><span data-k="items">0</span></div>
      </div>
      <div class="hud-boss" data-k="boss" hidden><div class="hud-boss-name" data-k="bossName"></div><div class="hud-boss-bar"><div data-k="bossFill"></div></div></div>
      <div class="hud-center" data-k="msg"></div>
      <div class="hud-help" data-k="help"></div>
      <div class="hud-online" data-k="online" hidden>
        <div class="hud-players"><span data-k="netStatus" class="net-dot"></span><span data-k="playerList"></span></div>
        <div class="hud-chat" data-k="chatLog"></div>
        <input class="hud-chat-input" data-k="chatInput" maxlength="80" placeholder="メッセージを入力して Enter（Escで閉じる）" hidden>
      </div>
      <div class="overlay" data-k="pause" hidden>
        <div class="panel small">
          <h2>ポーズ</h2>
          <button class="btn primary" data-a="resume">再開 <kbd>A</kbd></button>
          <button class="btn" data-a="restart">最初から <kbd>R</kbd> / <kbd>Back</kbd></button>
          <button class="btn" data-a="quit">やめる <kbd>B</kbd></button>
          <label class="check"><input type="checkbox" data-a="mute"> 効果音オフ</label>
        </div>
      </div>
      <div class="overlay" data-k="result" hidden><div class="panel small" data-k="resultBody"></div></div>`;
    const q = (k) => root.querySelector(`[data-k="${k}"]`);
    this.hud = {
      time: q('time'), hearts: q('hearts'), items: q('items'), boss: q('boss'), bossName: q('bossName'), bossFill: q('bossFill'),
      msg: q('msg'), help: q('help'), pause: q('pause'), result: q('result'), resultBody: q('resultBody'),
      online: q('online'), netStatus: q('netStatus'), playerList: q('playerList'), chatLog: q('chatLog'), chatInput: q('chatInput'),
    };
    root.hidden = false;
    root.querySelector('[data-a="resume"]').onclick = () => { this.setPaused(false); this.app.canvas.requestPointerLock?.(); };
    root.querySelector('[data-a="restart"]').onclick = () => this.reset();
    root.querySelector('[data-a="quit"]').onclick = () => this.exit(null);
    const mute = root.querySelector('[data-a="mute"]');
    mute.checked = sfx.muted;
    mute.onchange = () => sfx.setMuted(mute.checked);
    this.hud.help.innerHTML = 'クリックで視点ロック ・ WASD/左スティック:移動 ・ Space/A:ジャンプ ・ Shift/X:ダッシュ ・ マウス/右スティック:カメラ ・ ホイール/LB・LT:ズーム ・ Esc/Start:ポーズ';
  }

  setPaused(p) {
    this.paused = p;
    this.hud.pause.hidden = !p;
    if (p) this.input.unlock();
  }

  showMsg(text, ms = 1200) {
    this.hud.msg.textContent = text;
    this.hud.msg.classList.add('show');
    clearTimeout(this.msgT);
    if (ms) this.msgT = setTimeout(() => this.hud.msg.classList.remove('show'), ms);
  }

  // ------------------------------------------------------------------ loop
  loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const inp = this.input.poll();
    this.app.resize(this.camera);
    if (this.state === 'result') {
      if (inp.confirmPressed && this.resultReady) this.reset();
      else if (inp.backPressed && this.resultReady) this.exit(this.lastResult);
    } else if (this.paused) {
      if (inp.confirmPressed || inp.pausePressed) { this.setPaused(false); }
      else if (inp.restartPressed) this.reset();
      else if (inp.backPressed) this.exit(null);
    } else {
      if (inp.pausePressed) this.setPaused(true);
      else if (inp.restartPressed) this.reset();
      else this.update(dt, inp);
    }
    if (this.net) {
      this.remotes.update(dt, now / 1000, this.world);
      this.sendState(dt);
    }
    this.updateCamera(dt, this.paused || this.chatting ? { lookX: 0, lookY: 0, zoom: 0 } : inp);
    this.app.renderer.render(this.scene, this.camera);
  }

  update(dt, inp) {
    const P = this.player;
    const t = (this.elapsed = (this.elapsed || 0) + dt);
    if (this.state === 'ready') {
      this.readyT -= dt;
      this.showMsg(this.readyT > 0.5 ? 'READY?' : 'GO!', 0);
      if (this.readyT <= 0) { this.state = 'play'; this.hud.msg.classList.remove('show'); }
    } else if (this.state === 'play') {
      this.time += dt;
    }
    const controllable = this.state === 'play' && P.dead <= 0;

    // ---- player
    if (P.dead > 0) {
      P.dead -= dt;
      this.playerChar.root.rotation.z += dt * 8;
      if (P.dead <= 0) this.respawn();
    } else {
      this.updatePlayer(dt, controllable ? inp : { moveX: 0, moveY: 0, jump: false, jumpPressed: false, run: false });
    }

    // ---- enemies & projectiles
    let bossShown = null;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      this.updateEnemy(e, dt);
      if (e.boss && e.dying <= 0 && e.pos.distanceTo(P.pos) < 32) bossShown = e;
    }
    this.updateProjectiles(dt);
    this.hud.boss.hidden = !bossShown;
    if (bossShown) {
      this.hud.bossName.textContent = `BOSS ${bossShown.def.name}`;
      this.hud.bossFill.style.width = `${(bossShown.hp / bossShown.maxHp) * 100}%`;
    }

    // ---- items / checkpoints / goal
    const pc = P.pos.clone().add(new THREE.Vector3(0, PH / 2, 0));
    for (const it of this.items) {
      if (it.taken) continue;
      it.mesh.userData.spin.rotation.y += dt * 2.5;
      it.mesh.position.y = it.pos.y + Math.sin(t * 2 + it.pos.x) * 0.12;
      if (P.dead <= 0 && Math.abs(pc.x - it.pos.x) < 0.75 && Math.abs(pc.z - it.pos.z) < 0.75 && Math.abs(pc.y - it.pos.y) < 1.2) {
        it.taken = true;
        it.mesh.visible = false;
        this.runItems.add(it.id);
        sfx.item();
        this.showMsg(this.collectedBefore.has(it.id) ? 'クリスタル（取得済み）' : 'クリスタル ゲット！');
      }
    }
    for (const cp of this.checkpoints) {
      if (!cp.active && P.pos.distanceTo(cp.pos) < 1.2) {
        for (const o of this.checkpoints) { o.active = false; setCheckpointActive(o.mesh, false); }
        cp.active = true;
        setCheckpointActive(cp.mesh, true);
        this.respawnPoint = cp.pos.clone();
        sfx.checkpoint();
        this.showMsg('チェックポイント！');
      }
      cp.mesh.userData.flag.rotation.y = Math.sin(t * 3) * 0.3;
    }
    const locked = this.data.bossLocksGoal && this.enemies.some((e) => e.boss && e.alive && e.dying <= 0);
    for (const g of this.goals) {
      setGoalLocked(g.mesh, locked);
      g.mesh.userData.ring.rotation.z += dt * 2;
      if (this.state === 'play' && P.dead <= 0 && Math.abs(P.pos.x - g.pos.x) < 1.1 && Math.abs(P.pos.z - g.pos.z) < 1.1 && P.pos.y > g.pos.y - 0.5 && P.pos.y < g.pos.y + 3) {
        if (locked) {
          if (!this.lockWarned) this.showMsg('ボスを倒すとゴールが開く！', 1500);
          this.lockWarned = true;
        } else this.clear();
      } else this.lockWarned = false;
    }
    this.updateHud();
  }

  updatePlayer(dt, inp) {
    const P = this.player, w = this.world;
    const fwd = new THREE.Vector3(-Math.sin(this.cam.yaw), 0, -Math.cos(this.cam.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = fwd.multiplyScalar(inp.moveY).add(right.multiplyScalar(inp.moveX));
    const wl = Math.min(1, wish.length());
    const speed = inp.run ? RUN : WALK;
    const ice = P.ground && BLOCKS[P.groundId]?.slippery;
    const accel = P.ground ? (ice ? 5 : 45) : 18;
    const tx = wish.x * speed, tz = wish.z * speed;
    const k = Math.min(1, accel * dt / Math.max(1, speed) * (wl > 0 || !ice ? 1 : 0.3));
    P.vel.x += (tx - P.vel.x) * Math.min(1, k * 1.6);
    P.vel.z += (tz - P.vel.z) * Math.min(1, k * 1.6);
    if (wl > 0.1) {
      const target = Math.atan2(wish.x, wish.z);
      let d = target - P.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      P.yaw += d * Math.min(1, dt * 14);
    }

    // jumping with coyote time and input buffering
    P.coyote = P.ground ? 0.1 : P.coyote - dt;
    P.buffer = inp.jumpPressed ? 0.13 : P.buffer - dt;
    if (P.buffer > 0 && P.coyote > 0) {
      P.vel.y = JUMP_V + Math.min(1.5, Math.hypot(P.vel.x, P.vel.z) * 0.12);
      P.buffer = 0; P.coyote = 0; P.jumpCut = false;
      sfx.jump();
    }
    const g = P.vel.y > 0 && !inp.jump ? GRAV * 2.2 : GRAV;
    P.vel.y = Math.max(-34, P.vel.y - g * dt);

    P.prevY = P.pos.y;
    const res = moveAABB(w, P.pos, HW, PH, P.vel, dt);
    P.ground = res.ground;
    P.groundId = res.ground ? res.groundId : 0;
    if (res.ground && BLOCKS[res.groundId]?.bounce) {
      P.vel.y = 20;
      P.ground = false;
      sfx.bounce();
    }
    // hazards
    const touching = touchingBlocks(w, P.pos, HW, PH);
    for (const id of touching) if (BLOCKS[id]?.hazard) { this.hurt(null, true); break; }
    if (P.pos.y < -8) this.die();
    // other players' heads are bouncy
    if (this.remotes && P.vel.y <= 0) {
      for (const r of this.remotes.map.values()) {
        if (!r.seen || r.d) continue;
        if (Math.abs(P.pos.x - r.pos.x) < HW * 2 && Math.abs(P.pos.z - r.pos.z) < HW * 2 && P.pos.y < r.pos.y + PH && P.prevY >= r.pos.y + PH - 0.3) {
          P.pos.y = r.pos.y + PH;
          P.vel.y = this.lastJumpHeld ? 15 : 10;
          sfx.stomp();
        }
      }
    }
    if (P.inv > 0) P.inv -= dt;

    // visuals
    const ch = this.playerChar;
    ch.root.position.copy(P.pos);
    ch.root.rotation.set(0, P.yaw, 0);
    ch.root.visible = P.inv <= 0 || Math.floor(P.inv * 12) % 2 === 0;
    ch.animate({ speed: Math.hypot(P.vel.x, P.vel.z) / WALK, ground: P.ground, dt, t: this.elapsed });
    this.placeShadow(this.playerShadow, P.pos, 0.9);
  }

  placeShadow(mesh, pos, size) {
    const gy = this.world.groundBelow(pos.x, pos.y + 0.2, pos.z);
    if (!Number.isFinite(gy) || pos.y - gy > 30) { mesh.visible = false; return; }
    mesh.visible = true;
    mesh.position.set(pos.x, gy + 0.02, pos.z);
    const s = Math.max(0.3, 1 - (pos.y - gy) * 0.06);
    mesh.scale.set(s, s, s);
  }

  hurt(source, hazard = false) {
    const P = this.player;
    if (P.inv > 0 || P.dead > 0 || this.state !== 'play') {
      if (hazard && P.vel.y < 8) P.vel.y = 13;
      return;
    }
    P.hp -= 1;
    P.inv = 1.6;
    sfx.hurt();
    if (hazard) P.vel.y = 14;
    else if (source) {
      const d = P.pos.clone().sub(source.pos).setY(0).normalize();
      P.vel.x = d.x * 9; P.vel.z = d.z * 9; P.vel.y = 8;
    }
    if (P.hp <= 0) this.die();
  }

  die() {
    const P = this.player;
    if (P.dead > 0) return;
    P.dead = 1.0;
    P.vel.set(0, 0, 0);
    this.deaths++;
    sfx.die();
    this.showMsg('ミス！', 900);
  }

  respawn() {
    const P = this.player;
    P.pos.copy(this.respawnPoint);
    P.vel.set(0, 0, 0);
    P.hp = MAX_HP;
    P.inv = 1.5;
    this.playerChar.root.rotation.set(0, P.yaw, 0);
  }

  // ------------------------------------------------------------------ enemies
  updateEnemy(e, dt) {
    const P = this.player, w = this.world, d = e.def;
    e.t += dt;
    if (e.dying > 0) {
      e.dying -= dt;
      e.ch.root.scale.y = Math.max(0.05, e.dying / 0.4);
      if (e.dying <= 0) { e.alive = false; e.ch.root.visible = false; e.shadow.visible = false; }
      return;
    }
    if (e.inv > 0) e.inv -= dt;
    const to = P.pos.clone().sub(e.pos);
    const distXZ = Math.hypot(to.x, to.z);
    const face = () => { e.yaw = Math.atan2(to.x, to.z); };
    const dirX = () => Math.sin(e.yaw), dirZ = () => Math.cos(e.yaw);
    const edgeAhead = () => {
      const px = e.pos.x + dirX() * (e.hw + 0.2), pz = e.pos.z + dirZ() * (e.hw + 0.2);
      return !w.isSolid(Math.floor(px), Math.floor(e.pos.y - 0.5), Math.floor(pz)) && !w.isSolid(Math.floor(px), Math.floor(e.pos.y - 1.5), Math.floor(pz));
    };
    const playerAlive = P.dead <= 0;
    let gravity = !d.fly, collide = true, speed = 0;

    switch (d.behavior) {
      case 'patrol':
        speed = d.speed;
        if (e.ground && edgeAhead()) e.yaw += Math.PI;
        e.vel.x = dirX() * speed; e.vel.z = dirZ() * speed;
        break;
      case 'charger':
        if (e.state === 'walk') {
          speed = d.speed;
          const dot = distXZ > 0 ? (to.x * dirX() + to.z * dirZ()) / distXZ : 0;
          if (playerAlive && distXZ < 10 && Math.abs(to.y) < 2 && dot > 0.5) { face(); e.state = 'charge'; e.timer = 1.4; }
        } else if (e.state === 'charge') {
          speed = d.speed * 4;
          e.timer -= dt;
          if (e.timer <= 0) { e.state = 'rest'; e.timer = 0.9; }
        } else {
          speed = 0;
          e.timer -= dt;
          if (e.timer <= 0) e.state = 'walk';
        }
        if (e.ground && edgeAhead()) { e.yaw += Math.PI; if (e.state === 'charge') { e.state = 'rest'; e.timer = 0.6; } }
        e.vel.x = dirX() * speed; e.vel.z = dirZ() * speed;
        break;
      case 'jumper':
        if (e.ground) {
          e.vel.x *= 0.8; e.vel.z *= 0.8;
          e.timer -= dt;
          if (e.timer <= 0) {
            if (playerAlive && distXZ < 12) face(); else e.yaw += (Math.random() - 0.5) * 2.5;
            if (!edgeAhead() || distXZ < 4) {
              e.vel.y = 10;
              e.vel.x = dirX() * d.speed; e.vel.z = dirZ() * d.speed;
            } else e.yaw += Math.PI;
            e.timer = 1.1 + Math.random() * 0.8;
          }
        }
        speed = e.ground ? 0 : 1;
        break;
      case 'flyer': {
        gravity = false;
        let target;
        if (playerAlive && distXZ < 9 && Math.abs(to.y) < 7) target = P.pos.clone().add(new THREE.Vector3(0, 0.9, 0));
        else target = e.home.clone().add(new THREE.Vector3(Math.cos(e.t * 0.8) * 2.5, Math.sin(e.t * 1.7) * 0.6, Math.sin(e.t * 0.8) * 2.5));
        const v = target.sub(e.pos);
        if (v.length() > 0.05) v.normalize().multiplyScalar(d.speed);
        e.vel.lerp(v, Math.min(1, dt * 3));
        e.yaw = Math.atan2(e.vel.x, e.vel.z);
        speed = 1;
        break;
      }
      case 'ghost': {
        gravity = false; collide = false;
        const target = playerAlive && distXZ < 14 ? P.pos.clone().add(new THREE.Vector3(0, 0.5, 0)) : e.home.clone();
        const v = target.sub(e.pos);
        const len = v.length();
        if (len > 0.1) v.multiplyScalar(Math.min(d.speed, len) / len); else v.set(0, 0, 0);
        e.vel.lerp(v, Math.min(1, dt * 2));
        if (e.vel.lengthSq() > 0.01) e.yaw = Math.atan2(e.vel.x, e.vel.z);
        e.pos.y += Math.sin(e.t * 2) * 0.004;
        break;
      }
      case 'shooter':
        e.vel.x = e.vel.z = 0;
        if (playerAlive && distXZ < 18 && Math.abs(to.y) < 10) {
          face();
          e.timer -= dt;
          if (e.timer <= 0) { this.fire(e); e.timer = 2.2; }
        }
        break;
      case 'chaser':
      default:
        if (playerAlive && distXZ < 14 && Math.abs(to.y) < 6 && distXZ > 0.3) {
          face();
          speed = d.speed * (e.boss ? 1.15 : 1);
          if (e.ground && edgeAhead() && to.y > -0.5) speed = 0;
        } else {
          speed = d.speed * 0.35;
          e.timer -= dt;
          if (e.timer <= 0) { e.yaw += (Math.random() - 0.5) * 3; e.timer = 2 + Math.random() * 2; }
          if (e.ground && edgeAhead()) e.yaw += Math.PI;
        }
        e.vel.x = dirX() * speed; e.vel.z = dirZ() * speed;
        break;
    }

    if (gravity) e.vel.y = Math.max(-30, e.vel.y - GRAV * dt);
    if (collide) {
      const res = moveAABB(w, e.pos, e.hw, e.h, e.vel, dt);
      e.ground = res.ground;
      if ((res.wallX || res.wallZ) && d.behavior !== 'flyer') {
        if (d.behavior === 'chaser' && e.ground && !d.noJump && distXZ < 14) e.vel.y = 9;
        else if (d.behavior === 'patrol' || (d.behavior === 'charger' && e.state === 'walk')) e.yaw += Math.PI;
        else if (d.behavior === 'charger' && e.state === 'charge') { e.state = 'rest'; e.timer = 1; }
      }
      if (e.ground && BLOCKS[res.groundId]?.bounce) e.vel.y = 16;
    } else {
      e.pos.addScaledVector(e.vel, dt);
    }
    if (e.pos.y < -10) { e.alive = false; e.ch.root.visible = false; e.shadow.visible = false; return; }

    // player interaction
    if (playerAlive && this.state === 'play') {
      const overlap = Math.abs(P.pos.x - e.pos.x) < HW + e.hw && Math.abs(P.pos.z - e.pos.z) < HW + e.hw &&
        P.pos.y < e.pos.y + e.h && P.pos.y + PH > e.pos.y;
      if (overlap) {
        const fromAbove = P.vel.y <= 0 && P.prevY >= e.pos.y + e.h * 0.5;
        if (fromAbove && d.stompable) {
          if (e.inv <= 0) {
            e.hp -= 1;
            if (e.hp <= 0) { e.dying = 0.4; sfx.stomp(); }
            else { e.inv = 0.8; sfx.bossHit(); this.showMsg(`${e.def.name} 残り ${e.hp}`, 700); }
          }
          P.vel.y = this.lastJumpHeld ? 15 : 10;
          P.pos.y = Math.max(P.pos.y, e.pos.y + e.h);
        } else if (fromAbove && !d.stompable) {
          this.hurt(e);
          P.vel.y = 10;
        } else if (e.inv <= 0) {
          this.hurt(e);
        }
      }
    }

    // visuals
    const ch = e.ch;
    ch.root.position.copy(e.pos);
    ch.root.rotation.y = e.yaw;
    ch.root.visible = e.inv <= 0 || Math.floor(e.inv * 14) % 2 === 0;
    ch.animate({ speed: speed ? Math.min(1.5, speed / 2) : 0, ground: e.ground || d.fly, dt, t: e.t, flap: d.behavior === 'flyer' });
    this.placeShadow(e.shadow, e.pos, e.hw * 2);
  }

  fire(e) {
    const m = makeProjectile();
    const from = e.pos.clone().add(new THREE.Vector3(Math.sin(e.yaw) * (e.hw + 0.3), e.h * 0.55, Math.cos(e.yaw) * (e.hw + 0.3)));
    const target = this.player.pos.clone().add(new THREE.Vector3(0, PH * 0.5, 0));
    const vel = target.sub(from).normalize().multiplyScalar(7);
    m.position.copy(from);
    this.add(m);
    this.projectiles.push({ pos: from, vel, life: 4, mesh: m });
    if (e.pos.distanceTo(this.player.pos) < 20) sfx.shoot();
  }

  updateProjectiles(dt) {
    const P = this.player;
    for (const p of this.projectiles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      if (this.world.isSolid(Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z))) p.life = 0;
      if (P.dead <= 0 && Math.abs(p.pos.x - P.pos.x) < HW + 0.2 && Math.abs(p.pos.z - P.pos.z) < HW + 0.2 && p.pos.y > P.pos.y - 0.2 && p.pos.y < P.pos.y + PH + 0.2) {
        p.life = 0;
        this.hurt({ pos: p.pos.clone().sub(p.vel) });
      }
      if (p.life <= 0) p.mesh.visible = false;
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
  }

  // ------------------------------------------------------------------ camera
  updateCamera(dt, inp) {
    const c = this.cam;
    c.yaw -= inp.lookX || 0;
    c.pitch = Math.max(-0.35, Math.min(1.35, c.pitch + (inp.lookY || 0)));
    c.dist = Math.max(3, Math.min(16, c.dist + (inp.zoom || 0) * 0.8));
    this.lastJumpHeld = !!inp.jump;
    const target = this.player.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
    if (!this.camTarget) this.camTarget = target.clone();
    this.camTarget.lerp(target, Math.min(1, dt * 12));
    const off = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch));
    let dist = c.dist;
    const hit = raycastVoxels(this.camTarget, off, dist, (x, y, z) => this.world.isOpaque(x, y, z));
    if (hit) dist = Math.max(0.6, hit.t - 0.25);
    this.camera.position.copy(this.camTarget).addScaledVector(off, dist);
    this.camera.lookAt(this.camTarget);
  }

  updateHud() {
    const h = this.hud;
    h.time.textContent = formatTime(this.time * 1000);
    const hp = Math.max(0, this.player.hp);
    h.hearts.innerHTML = Array.from({ length: MAX_HP }, (_, i) => `<span class="heart ${i < hp ? '' : 'empty'}">♥</span>`).join('');
    h.items.textContent = `${this.runItems.size} / ${this.items.length}`;
  }

  // ------------------------------------------------------------------ finish
  async clear() {
    this.state = 'result';
    this.resultReady = false;
    this.input.unlock();
    sfx.clear();
    const timeMs = Math.round(this.time * 1000);
    const items = [...this.runItems];
    const newCount = items.filter((i) => !this.collectedBefore.has(i)).length;
    this.hud.result.hidden = false;
    this.hud.resultBody.innerHTML = `<h2>COURSE CLEAR!</h2><div class="big-time">${formatTime(timeMs)}</div><p>送信中…</p>`;
    let res = null, err = null;
    try {
      res = this.opts.onClear ? await this.opts.onClear(timeMs, items) : null;
    } catch (e) {
      err = e.message;
    }
    for (const i of items) this.collectedBefore.add(i);
    this.lastResult = res;
    const lines = [];
    lines.push(`<div class="result-row"><span>クリスタル</span><b>${items.length} 個（新規 ${newCount}）</b></div>`);
    lines.push(`<div class="result-row"><span>ミス</span><b>${this.deaths}</b></div>`);
    if (res) {
      lines.push(`<div class="result-row"><span>自己ベスト</span><b>${formatTime(res.best)}${res.newBest ? ' <em class="new">NEW!</em>' : ''}</b></div>`);
      lines.push(`<div class="result-row"><span>順位</span><b>${res.rank} 位</b></div>`);
      lines.push(`<div class="result-row"><span>所持クリスタル合計</span><b>◆ ${res.totalItems}</b></div>`);
    } else if (this.opts.testMode) {
      lines.push('<p class="muted">テストプレイのため記録されません</p>');
    } else if (err) {
      lines.push(`<p class="error">${esc(err)}</p>`);
    }
    this.hud.resultBody.innerHTML = `<h2>COURSE CLEAR!</h2><div class="big-time">${formatTime(timeMs)}</div>${lines.join('')}
      <div class="row"><button class="btn primary" data-a="again">もう一度 <kbd>A</kbd></button><button class="btn" data-a="back">${this.opts.testMode ? 'エディタへ' : 'ワールド一覧へ'} <kbd>B</kbd></button></div>`;
    this.hud.resultBody.querySelector('[data-a="again"]').onclick = () => this.reset();
    this.hud.resultBody.querySelector('[data-a="back"]').onclick = () => this.exit(res);
    this.resultReady = true;
  }

  // ------------------------------------------------------------------ online
  startOnline() {
    this.remotes = new RemotePlayers(this.scene, this.app);
    this.netTimer = 0;
    this.hud.online.hidden = false;
    this.hud.help.innerHTML += ' ・ T/Enter:チャット';
    this.net = new NetSession({ worldId: this.opts.worldId, avatar: this.opts.avatarId, onEvent: (m) => this.onNet(m) });
    const input = this.hud.chatInput;
    this.onChatKey = (e) => {
      if (this.chatting || this.paused || this.state === 'result') return;
      if (e.code === 'KeyT' || e.code === 'Enter') {
        e.preventDefault();
        this.chatting = true;
        this.input.keys.clear();
        input.hidden = false;
        input.value = '';
        input.focus();
      }
    };
    window.addEventListener('keydown', this.onChatKey);
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = input.value.trim();
        if (text) this.net.send({ t: 'chat', text });
      }
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        input.blur();
      }
    };
    input.onblur = () => {
      input.hidden = true;
      this.chatting = false;
    };
    this.updatePlayerList();
  }

  onNet(m) {
    const R = this.remotes;
    if (m.t === 'status') {
      this.hud.netStatus.classList.toggle('on', m.online);
      if (!m.online) { R.dispose(); this.chatLine('サーバーとの接続が切れました。再接続します…', 'sys'); }
    } else if (m.t === 'welcome') {
      R.dispose();
      for (const p of m.players) R.add(p);
      R.refreshMissing();
      this.chatLine(m.players.length ? `オンライン: ${m.players.length + 1} 人がこのワールドにいます` : 'オンラインに接続しました（ほかのプレイヤーを待っています）', 'sys');
    } else if (m.t === 'join') {
      R.add(m);
      R.refreshMissing();
      this.chatLine(`${m.name} が入ってきました`, 'sys');
    } else if (m.t === 'leave') {
      const r = R.map.get(m.id);
      if (r) this.chatLine(`${r.name} が出ていきました`, 'sys');
      R.remove(m.id);
    } else if (m.t === 'state') {
      R.state(m);
    } else if (m.t === 'chat') {
      this.chatLine(`${m.name}: ${m.text}`);
    } else if (m.t === 'clear') {
      this.chatLine(`🏁 ${m.name} がクリア！ ${formatTime(m.timeMs)}（${m.rank}位${m.newBest ? '・自己ベスト更新' : ''}）`, 'clear');
    }
    if (m.t !== 'state') this.updatePlayerList();
  }

  updatePlayerList() {
    const names = [this.app.user.name, ...[...this.remotes.map.values()].map((r) => r.name)];
    this.hud.playerList.textContent = `${names.length}人: ${names.join('、')}`;
  }

  chatLine(text, kind = '') {
    const log = this.hud.chatLog;
    const line = el(`<div class="chat-line ${kind}">${esc(text)}</div>`);
    log.appendChild(line);
    while (log.children.length > 8) log.firstChild.remove();
    setTimeout(() => line.classList.add('fade'), 12000);
  }

  sendState(dt) {
    this.netTimer -= dt;
    if (this.netTimer > 0) return;
    this.netTimer = 1 / 15;
    const P = this.player;
    this.net.send({
      t: 'state', p: [P.pos.x, P.pos.y, P.pos.z], yaw: P.yaw,
      sp: Math.hypot(P.vel.x, P.vel.z) / WALK, g: P.ground, d: P.dead > 0,
    });
  }

  exit(result) {
    this.dispose();
    this.opts.onExit?.(result);
  }

  dispose() {
    if (!this.running) return;
    this.running = false;
    document.removeEventListener('pointerlockchange', this.onLockChange);
    if (this.net) {
      this.net.close();
      this.remotes.dispose();
      window.removeEventListener('keydown', this.onChatKey);
    }
    this.input.dispose();
    clearTimeout(this.msgT);
    this.app.hud.hidden = true;
    this.app.hud.innerHTML = '';
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.world.disposeMeshes();
  }
}
