// Unified keyboard/mouse + gamepad input for gameplay.
const DEAD = 0.18;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

export class PlayInput {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0 };
    this.padPrev = [];
    this.lastDevice = 'keyboard';
    this.on = [];
    const add = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); this.on.push([t, ev, fn, o]); };
    add(window, 'keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    add(window, 'keyup', (e) => this.keys.delete(e.code));
    add(window, 'blur', () => this.keys.clear());
    add(canvas, 'mousedown', () => {
      if (document.pointerLockElement !== canvas && this.lockEnabled) canvas.requestPointerLock?.();
    });
    add(document, 'mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
        this.lastDevice = 'keyboard';
      }
    });
    add(canvas, 'wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    this.lockEnabled = true;
  }

  get locked() {
    return document.pointerLockElement === this.canvas;
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  poll() {
    const k = this.keys;
    const s = {
      moveX: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      moveY: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
      lookX: this.mouse.dx * 0.0032 + ((k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0)) * 0.045,
      lookY: this.mouse.dy * 0.0032,
      zoom: this.mouse.wheel,
      jump: k.has('Space'),
      jumpPressed: this.pressed.has('Space'),
      run: k.has('ShiftLeft') || k.has('ShiftRight'),
      pausePressed: this.pressed.has('Escape') || this.pressed.has('KeyP'),
      restartPressed: this.pressed.has('KeyR'),
      confirmPressed: this.pressed.has('Enter') || this.pressed.has('Space'),
      backPressed: this.pressed.has('Escape') || this.pressed.has('Backspace'),
    };
    const len = Math.hypot(s.moveX, s.moveY);
    if (len > 1) { s.moveX /= len; s.moveY /= len; }
    this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0;
    this.pressed.clear();

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const prev = this.padPrev[p.index] || [];
      const btn = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      const edge = (i) => btn(i) && !prev[i];
      const lx = dz(p.axes[0] || 0), ly = dz(p.axes[1] || 0), rx = dz(p.axes[2] || 0), ry = dz(p.axes[3] || 0);
      let mx = lx, my = -ly;
      if (btn(14)) mx = -1;
      if (btn(15)) mx = 1;
      if (btn(12)) my = 1;
      if (btn(13)) my = -1;
      if (Math.abs(mx) + Math.abs(my) > 0) { s.moveX = mx; s.moveY = my; this.lastDevice = 'gamepad'; }
      s.lookX += rx * 0.05;
      s.lookY += ry * 0.035;
      if (btn(0) || btn(1)) s.jump = true;
      if (edge(0) || edge(1)) { s.jumpPressed = true; this.lastDevice = 'gamepad'; }
      if (btn(2) || btn(5) || btn(7)) s.run = true;
      if (edge(4)) s.zoom -= 1;
      if (edge(6)) s.zoom += 1;
      if (edge(9)) s.pausePressed = true;
      if (edge(8)) s.restartPressed = true;
      if (edge(0)) s.confirmPressed = true;
      if (edge(1)) s.backPressed = true;
      this.padPrev[p.index] = p.buttons.map((b) => b.pressed);
    }
    return s;
  }

  dispose() {
    for (const [t, ev, fn, o] of this.on) t.removeEventListener(ev, fn, o);
    this.unlock();
  }
}
