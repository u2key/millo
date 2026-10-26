// Tiny synthesized sound effects (no audio files needed).
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('millo.muted') === '1'; } catch {}

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freqs, { type = 'square', dur = 0.12, vol = 0.12, slide = 0 } = {}) {
  if (muted) return;
  const a = ac();
  const t0 = a.currentTime;
  freqs.forEach((f, i) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    const st = t0 + i * dur * 0.8;
    o.frequency.setValueAtTime(f, st);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), st + dur);
    g.gain.setValueAtTime(vol, st);
    g.gain.exponentialRampToValueAtTime(0.001, st + dur);
    o.connect(g).connect(a.destination);
    o.start(st);
    o.stop(st + dur + 0.02);
  });
}

export const sfx = {
  jump: () => tone([420], { dur: 0.12, slide: 1.8, vol: 0.07 }),
  bounce: () => tone([300], { dur: 0.25, slide: 3, vol: 0.09, type: 'triangle' }),
  stomp: () => tone([220, 160], { dur: 0.08, vol: 0.12 }),
  hurt: () => tone([300], { dur: 0.3, slide: 0.3, vol: 0.12, type: 'sawtooth' }),
  item: () => tone([880, 1175, 1568], { dur: 0.09, vol: 0.08, type: 'triangle' }),
  checkpoint: () => tone([523, 659, 784], { dur: 0.1, vol: 0.08, type: 'triangle' }),
  shoot: () => tone([160], { dur: 0.15, slide: 0.5, vol: 0.06, type: 'sawtooth' }),
  bossHit: () => tone([120, 90], { dur: 0.18, vol: 0.14, type: 'sawtooth' }),
  unlock: () => tone([392, 523, 659, 1046], { dur: 0.12, vol: 0.09, type: 'triangle' }),
  clear: () => tone([523, 659, 784, 1046, 784, 1046], { dur: 0.13, vol: 0.09, type: 'triangle' }),
  die: () => tone([400, 300, 200, 120], { dur: 0.14, vol: 0.1, type: 'square' }),
  click: () => tone([660], { dur: 0.04, vol: 0.04, type: 'triangle' }),
  get muted() { return muted; },
  setMuted(v) { muted = v; try { localStorage.setItem('millo.muted', v ? '1' : '0'); } catch {} },
};
