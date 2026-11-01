// Tilley Woodworks backend: inventory, photos and staff logins.
// Storage is one KV namespace (binding DATA):
//   inventory          {version, updatedAt, updatedBy, data}
//   img:<name>         photo bytes (JPEG)
//   user:<email>       {email, name, role: 'owner'|'staff', salt, hash, createdAt}
//   session:<token>    {email}            (expires after SESSION_DAYS)
//   fail:<ip>          failed-login count (expires after 15 minutes)

const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000; // Workers' maximum
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_INVENTORY_BYTES = 2 * 1024 * 1024;
const MAX_FAILS = 10;

const EMPTY_DATA = {
  settings: { storeName: 'Tilley Woodworks', tagline: '', heroEyebrow: '', heroHeading: '', heroText: '', heroImage: '', aboutHeading: '', aboutText: '', contactEmail: '', contactPhone: '', customOrdersText: '' },
  categories: [],
  items: []
};

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res;
    try {
      res = await route(request, env);
    } catch (e) {
      if (e instanceof HttpError) res = json({ error: e.message }, e.status);
      else { console.error(e && e.stack || e); res = json({ error: 'Server error. Please try again.' }, 500); }
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  }
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match',
    'Access-Control-Expose-Headers': 'X-Version',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {})
  });
}

async function readJson(request, limit) {
  const text = await request.text();
  if (text.length > (limit || 64 * 1024)) throw new HttpError(413, 'That is too large to save.');
  try { return JSON.parse(text || '{}'); } catch (e) { throw new HttpError(400, 'Bad request.'); }
}

async function route(request, env) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = request.method;

  if (p === '/' && m === 'GET') return json({ ok: true, service: 'tilley-woodworks' });

  // ---- public ----
  if (p === '/api/inventory' && m === 'GET') return getInventory(env);
  if (p.startsWith('/img/') && m === 'GET') return getImage(env, p.slice(5));
  if (p === '/api/status' && m === 'GET') return json({ needsSetup: !(await hasAnyUser(env)) });

  // ---- sign in ----
  if (p === '/api/setup' && m === 'POST') return setup(request, env);
  if (p === '/api/login' && m === 'POST') return login(request, env);

  // ---- signed in ----
  const me = await requireUser(request, env);
  if (p === '/api/logout' && m === 'POST') { await env.DATA.delete('session:' + me.token); return json({ ok: true }); }
  if (p === '/api/me' && m === 'GET') return json(publicUser(me.user));
  if (p === '/api/password' && m === 'POST') return changePassword(request, env, me);
  if (p === '/api/inventory' && m === 'PUT') return putInventory(request, env, me);
  if (p === '/api/images' && m === 'POST') return putImage(request, env, url);

  // ---- owner only ----
  if (p === '/api/users' || p.startsWith('/api/users/')) {
    if (me.user.role !== 'owner') throw new HttpError(403, 'Only the owner can manage staff.');
    if (p === '/api/users' && m === 'GET') return listUsers(env);
    if (p === '/api/users' && m === 'POST') return saveUser(request, env, me);
    if (m === 'DELETE') return deleteUser(env, me, decodeURIComponent(p.slice('/api/users/'.length)));
  }

  throw new HttpError(404, 'Not found.');
}

// ---------- inventory ----------
async function loadInventory(env) {
  const rec = await env.DATA.get('inventory', 'json');
  return rec || { version: 0, updatedAt: null, updatedBy: null, data: EMPTY_DATA };
}

async function getInventory(env) {
  const rec = await loadInventory(env);
  return json(rec.data, 200, { 'Cache-Control': 'public, max-age=15', 'X-Version': String(rec.version) });
}

async function putInventory(request, env, me) {
  const body = await readJson(request, MAX_INVENTORY_BYTES);
  const data = body.data;
  if (!data || typeof data !== 'object' || !Array.isArray(data.items) || !Array.isArray(data.categories) || typeof data.settings !== 'object') {
    throw new HttpError(400, 'That inventory is not in the right shape.');
  }
  const current = await loadInventory(env);
  if (Number(body.baseVersion) !== current.version) {
    return json({ error: 'Someone else published changes since you opened the inventory. Reload to see them, then make your edits again.', version: current.version }, 409);
  }

  // Remove photos the inventory no longer uses.
  const before = imageNames(current.data);
  const after = imageNames(data);
  await Promise.all([...before].filter((n) => !after.has(n)).map((n) => env.DATA.delete('img:' + n)));

  const rec = { version: current.version + 1, updatedAt: new Date().toISOString(), updatedBy: me.user.email, data };
  await env.DATA.put('inventory', JSON.stringify(rec));
  return json({ ok: true, version: rec.version }, 200, { 'X-Version': String(rec.version) });
}

function imageNames(data) {
  const s = new Set();
  const add = (ref) => { const m = /^img\/([a-z0-9-]+\.jpg)$/.exec(String(ref || '')); if (m) s.add(m[1]); };
  (data.items || []).forEach((i) => (i.images || []).forEach(add));
  add(data.settings && data.settings.heroImage);
  return s;
}

// ---------- images ----------
async function getImage(env, name) {
  if (!/^[a-z0-9-]+\.jpg$/.test(name)) throw new HttpError(404, 'Not found.');
  const buf = await env.DATA.get('img:' + name, 'arrayBuffer');
  if (!buf) throw new HttpError(404, 'Not found.');
  return new Response(buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } });
}

async function putImage(request, env, url) {
  const base = String(url.searchParams.get('name') || 'photo').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'photo';
  const buf = await request.arrayBuffer();
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, 'That photo is too large (5 MB max).');
  const b = new Uint8Array(buf, 0, Math.min(3, buf.byteLength));
  if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) throw new HttpError(415, 'Photos must be JPEG.');
  const name = base + '-' + randomHex(6) + '.jpg';
  await env.DATA.put('img:' + name, buf);
  return json({ path: 'img/' + name });
}

// ---------- accounts ----------
const normEmail = (e) => String(e || '').trim().toLowerCase();
const publicUser = (u) => ({ email: u.email, name: u.name || '', role: u.role, createdAt: u.createdAt });

async function hasAnyUser(env) {
  const list = await env.DATA.list({ prefix: 'user:', limit: 1 });
  return list.keys.length > 0;
}

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Passwords need at least 8 characters.');
  if (pw.length > 200) throw new HttpError(400, 'That password is too long.');
}
function checkEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new HttpError(400, 'Enter a valid email address.');
}

async function hashPassword(pw, saltHex) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return { salt: bytesToHex(salt), hash: bytesToHex(new Uint8Array(bits)) };
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

async function newSession(env, email) {
  const token = randomHex(32);
  await env.DATA.put('session:' + token, JSON.stringify({ email }), { expirationTtl: SESSION_DAYS * 86400 });
  return token;
}

async function setup(request, env) {
  if (await hasAnyUser(env)) throw new HttpError(409, 'The owner account already exists. Sign in instead.');
  if (!env.SETUP_CODE) throw new HttpError(503, 'The setup code has not been configured on the server yet.');
  const body = await readJson(request);
  await throttle(request, env);
  if (!safeEqual(String(body.code || '').trim(), String(env.SETUP_CODE).trim())) {
    await recordFail(request, env);
    throw new HttpError(403, 'That setup code is not right.');
  }
  const email = normEmail(body.email);
  checkEmail(email);
  checkPassword(body.password);
  const { salt, hash } = await hashPassword(body.password);
  const user = { email, name: String(body.name || '').trim().slice(0, 80), role: 'owner', salt, hash, createdAt: new Date().toISOString() };
  await env.DATA.put('user:' + email, JSON.stringify(user));
  return json({ token: await newSession(env, email), user: publicUser(user) });
}

async function login(request, env) {
  const body = await readJson(request);
  await throttle(request, env);
  const email = normEmail(body.email);
  const user = email ? await env.DATA.get('user:' + email, 'json') : null;
  // Hash even when the user doesn't exist so timing doesn't reveal which emails have accounts.
  const { hash } = await hashPassword(String(body.password || ''), user ? user.salt : '00000000000000000000000000000000');
  if (!user || !safeEqual(hash, user.hash)) {
    await recordFail(request, env);
    throw new HttpError(401, 'That email and password don\'t match.');
  }
  return json({ token: await newSession(env, email), user: publicUser(user) });
}

async function requireUser(request, env) {
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(request.headers.get('Authorization') || '');
  if (!m) throw new HttpError(401, 'Please sign in.');
  const token = m[1].toLowerCase();
  const session = await env.DATA.get('session:' + token, 'json');
  if (!session) throw new HttpError(401, 'Your sign-in has expired. Please sign in again.');
  const user = await env.DATA.get('user:' + session.email, 'json');
  if (!user) { await env.DATA.delete('session:' + token); throw new HttpError(401, 'This account no longer has access.'); }
  return { token, user };
}

async function changePassword(request, env, me) {
  const body = await readJson(request);
  const { hash } = await hashPassword(String(body.current || ''), me.user.salt);
  if (!safeEqual(hash, me.user.hash)) throw new HttpError(403, 'Your current password isn\'t right.');
  checkPassword(body.password);
  Object.assign(me.user, await hashPassword(body.password));
  await env.DATA.put('user:' + me.user.email, JSON.stringify(me.user));
  return json({ ok: true });
}

async function listUsers(env) {
  const keys = [];
  let cursor;
  do {
    const page = await env.DATA.list({ prefix: 'user:', cursor });
    keys.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const users = (await Promise.all(keys.map((k) => env.DATA.get(k, 'json')))).filter(Boolean).map(publicUser);
  users.sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || a.email.localeCompare(b.email));
  return json({ users });
}

// Add a staff member, or set a new password for an existing one.
async function saveUser(request, env, me) {
  const body = await readJson(request);
  const email = normEmail(body.email);
  checkEmail(email);
  checkPassword(body.password);
  const existing = await env.DATA.get('user:' + email, 'json');
  if (existing && existing.role === 'owner' && email !== me.user.email) throw new HttpError(403, 'That account belongs to an owner.');
  const { salt, hash } = await hashPassword(body.password);
  const user = {
    email,
    name: String(body.name != null ? body.name : (existing && existing.name) || '').trim().slice(0, 80),
    role: existing ? existing.role : 'staff',
    salt, hash,
    createdAt: existing ? existing.createdAt : new Date().toISOString()
  };
  await env.DATA.put('user:' + email, JSON.stringify(user));
  return json({ user: publicUser(user), created: !existing });
}

async function deleteUser(env, me, email) {
  email = normEmail(email);
  if (email === me.user.email) throw new HttpError(400, 'You can\'t remove your own account.');
  const existing = await env.DATA.get('user:' + email, 'json');
  if (!existing) throw new HttpError(404, 'No one with that email has access.');
  if (existing.role === 'owner') throw new HttpError(403, 'Owner accounts can\'t be removed here.');
  await env.DATA.delete('user:' + email); // their sessions stop working on the next request
  return json({ ok: true });
}

// ---------- login throttling ----------
const clientIp = (request) => request.headers.get('CF-Connecting-IP') || 'local';
async function throttle(request, env) {
  const n = Number(await env.DATA.get('fail:' + clientIp(request))) || 0;
  if (n >= MAX_FAILS) throw new HttpError(429, 'Too many tries. Wait 15 minutes and try again.');
}
async function recordFail(request, env) {
  const key = 'fail:' + clientIp(request);
  const n = Number(await env.DATA.get(key)) || 0;
  await env.DATA.put(key, String(n + 1), { expirationTtl: 900 });
}

// ---------- bytes ----------
function randomHex(nBytes) { return bytesToHex(crypto.getRandomValues(new Uint8Array(nBytes))); }
function bytesToHex(b) { return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); }
function hexToBytes(h) { const out = new Uint8Array(h.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16); return out; }
