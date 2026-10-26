// Small DOM helpers shared by the UI modules.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function formatTime(ms) {
  if (ms == null) return '--:--.--';
  const t = Math.max(0, Math.round(ms / 10));
  const cs = t % 100, s = Math.floor(t / 100) % 60, m = Math.floor(t / 6000);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(msg, kind = 'info', ms = 2600) {
  let box = document.getElementById('toasts');
  const n = el(`<div class="toast ${kind}">${esc(msg)}</div>`);
  box.appendChild(n);
  setTimeout(() => n.classList.add('hide'), ms);
  setTimeout(() => n.remove(), ms + 400);
}

// Promise based in-page confirm dialog (native confirm() is not always available).
export function confirmDialog(message, okLabel = 'OK') {
  return new Promise((resolve) => {
    const o = el(`<div class="overlay modal-layer"><div class="panel small"><p>${esc(message)}</p>
      <div class="row"><button class="btn danger" data-a="ok">${esc(okLabel)}</button><button class="btn" data-a="no">キャンセル</button></div></div></div>`);
    document.body.appendChild(o);
    const done = (v) => { o.remove(); resolve(v); };
    o.querySelector('[data-a="ok"]').onclick = () => done(true);
    o.querySelector('[data-a="no"]').onclick = () => done(false);
  });
}
