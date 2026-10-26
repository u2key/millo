// Thin wrapper around the REST API.
let token = null;
try { token = localStorage.getItem('millo.token'); } catch {}

export function setToken(t) {
  token = t;
  try { t ? localStorage.setItem('millo.token', t) : localStorage.removeItem('millo.token'); } catch {}
}
export const hasToken = () => !!token;
export const getToken = () => token;

async function req(method, url, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    const err = new Error((data && data.error) || `通信エラー (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return data;
}

export const api = {
  register: (name, password) => req('POST', 'api/register', { name, password }),
  login: (name, password) => req('POST', 'api/login', { name, password }),
  logout: () => req('POST', 'api/logout', {}),
  me: () => req('GET', 'api/me'),
  worlds: () => req('GET', 'api/worlds'),
  world: (id) => req('GET', `api/worlds/${id}`),
  ranking: (id) => req('GET', `api/worlds/${id}/ranking`),
  createWorld: (w) => req('POST', 'api/worlds', w),
  updateWorld: (id, w) => req('PUT', `api/worlds/${id}`, w),
  deleteWorld: (id) => req('DELETE', `api/worlds/${id}`),
  play: (id) => req('POST', `api/worlds/${id}/play`, {}),
  clear: (id, timeMs, items) => req('POST', `api/worlds/${id}/clear`, { timeMs, items }),
  models: () => req('GET', 'api/models'),
  createModel: (m) => req('POST', 'api/models', m),
  updateModel: (id, m) => req('PUT', `api/models/${id}`, m),
  deleteModel: (id) => req('DELETE', `api/models/${id}`),
};
