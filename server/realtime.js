// Real-time online mode: players in the same world see each other via WebSocket.
// The server only relays positions / chat; enemies and items stay local to each client.
import { WebSocketServer } from 'ws';

const STATE_INTERVAL_MS = 40; // max ~25 state updates per second per client
const CHAT_INTERVAL_MS = 700;
const num = (v) => typeof v === 'number' && Number.isFinite(v);

export function attachRealtime(server, db) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  const rooms = new Map(); // worldId -> Set<client>
  let nextId = 1;

  const send = (c, msg) => {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const broadcast = (worldId, msg, except = null) => {
    const room = rooms.get(worldId);
    if (!room) return;
    const data = JSON.stringify(msg);
    for (const c of room) if (c !== except && c.ws.readyState === c.ws.OPEN) c.ws.send(data);
  };
  const info = (c) => ({ id: c.id, name: c.name, avatar: c.avatar, state: c.state });

  function leave(c) {
    if (c.room == null) return;
    const room = rooms.get(c.room);
    if (room) {
      room.delete(c);
      if (!room.size) rooms.delete(c.room);
    }
    broadcast(c.room, { t: 'leave', id: c.id });
    c.room = null;
    c.state = null;
  }

  async function join(c, msg) {
    const worldId = parseInt(msg.worldId, 10);
    if (!worldId || !(await db.get('SELECT id FROM worlds WHERE id = ?', [worldId]))) return send(c, { t: 'error', error: 'ワールドが見つかりません' });
    leave(c);
    c.room = worldId;
    c.avatar = typeof msg.avatar === 'string' ? msg.avatar.slice(0, 40) : null;
    if (!rooms.has(worldId)) rooms.set(worldId, new Set());
    const room = rooms.get(worldId);
    send(c, { t: 'welcome', id: c.id, players: [...room].map(info) });
    room.add(c);
    broadcast(worldId, { t: 'join', ...info(c) }, c);
  }

  wss.on('connection', async (ws, req) => {
    const token = new URL(req.url, 'http://localhost').searchParams.get('token') || '';
    let user = null;
    try {
      user = await db.get('SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', [token]);
    } catch {}
    if (!user) return ws.close(4001, 'unauthorized');
    const c = { ws, id: nextId++, userId: user.id, name: user.name, room: null, avatar: null, state: null, lastState: 0, lastChat: 0 };
    ws.on('pong', () => (ws.isAliveFlag = true));
    ws.on('close', () => leave(c));
    ws.on('error', () => {});
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      const now = Date.now();
      if (msg.t === 'join') join(c, msg).catch(() => {});
      else if (msg.t === 'leave') leave(c);
      else if (msg.t === 'state' && c.room != null) {
        if (now - c.lastState < STATE_INTERVAL_MS) return;
        const p = msg.p;
        if (!Array.isArray(p) || p.length !== 3 || !p.every(num) || !num(msg.yaw)) return;
        c.lastState = now;
        c.state = { p: p.map((v) => Math.round(v * 100) / 100), yaw: Math.round(msg.yaw * 100) / 100, sp: num(msg.sp) ? Math.min(3, Math.max(0, msg.sp)) : 0, g: !!msg.g, d: !!msg.d };
        broadcast(c.room, { t: 'state', id: c.id, ...c.state }, c);
      } else if (msg.t === 'chat' && c.room != null) {
        if (now - c.lastChat < CHAT_INTERVAL_MS) return;
        const text = String(msg.text || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
        if (!text) return;
        c.lastChat = now;
        broadcast(c.room, { t: 'chat', id: c.id, name: c.name, text });
      }
    });
  });

  // drop dead connections
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAliveFlag === false) { ws.terminate(); continue; }
      ws.isAliveFlag = false;
      ws.ping();
    }
  }, 30000);
  wss.on('close', () => clearInterval(timer));

  return {
    online: (worldId) => rooms.get(worldId)?.size || 0,
    // called by the REST API after a verified clear
    announceClear: (worldId, name, timeMs, rank, newBest) => broadcast(worldId, { t: 'clear', name, timeMs, rank, newBest }),
  };
}
