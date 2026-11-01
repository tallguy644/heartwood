// Runs the Worker against an in-memory KV and checks each endpoint.
import nodeCrypto from 'node:crypto';
import worker from '../src/index.js';
if (!crypto.subtle.timingSafeEqual) crypto.subtle.timingSafeEqual = (a, b) => nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const store = new Map();
const KV = {
  async get(k, type) { const v = store.get(k); if (v == null) return null; if (type === 'json') return JSON.parse(v); if (type === 'arrayBuffer') return v; return v; },
  async put(k, v) { store.set(k, v); },
  async delete(k) { store.delete(k); },
  async list({ prefix, limit }) { const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit || 1000).map((name) => ({ name })); return { keys, list_complete: true }; }
};
const env = { DATA: KV, SETUP_CODE: 'oak-and-walnut-42', ALLOWED_ORIGINS: 'https://tilleywoodworks.com' };
const ORIGIN = 'https://tilleywoodworks.com';
let failures = 0;
async function call(method, path, body, token, raw) {
  const headers = { Origin: ORIGIN };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body && !raw) headers['Content-Type'] = 'application/json';
  const r = await worker.fetch(new Request('https://api.test' + path, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined }), env);
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : await r.arrayBuffer() };
}
function check(name, cond, extra) { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(extra))); if (!cond) failures++; }

let r = await call('GET', '/api/status');
check('status says setup needed', r.body.needsSetup === true, r.body);
check('CORS allows the shop', r.headers.get('access-control-allow-origin') === ORIGIN);
r = await call('GET', '/api/inventory');
check('empty inventory is public', r.status === 200 && Array.isArray(r.body.items) && r.headers.get('x-version') === '0', r);
r = await call('POST', '/api/setup', { code: 'wrong', email: 'owner@example.com', password: 'longenough1' });
check('setup rejects wrong code', r.status === 403, r.body);
r = await call('POST', '/api/setup', { code: 'oak-and-walnut-42', email: 'Owner@Example.com', name: 'Chris', password: 'short' });
check('setup rejects short password', r.status === 400, r.body);
r = await call('POST', '/api/setup', { code: 'oak-and-walnut-42', email: 'Owner@Example.com', name: 'Chris', password: 'longenough1' });
check('setup creates owner', r.status === 200 && r.body.user.role === 'owner' && r.body.user.email === 'owner@example.com', r.body);
const owner = r.body.token;
r = await call('POST', '/api/setup', { code: 'oak-and-walnut-42', email: 'x@example.com', password: 'longenough1' });
check('setup cannot run twice', r.status === 409, r.body);
check('password not stored in plain text', ![...store.values()].some((v) => typeof v === 'string' && v.includes('longenough1')));

r = await call('PUT', '/api/inventory', { baseVersion: 0, data: { settings: {}, categories: [], items: [] } });
check('publishing needs sign-in', r.status === 401, r.body);
r = await call('POST', '/api/login', { email: 'owner@example.com', password: 'nope-nope' });
check('login rejects bad password', r.status === 401, r.body);
r = await call('POST', '/api/login', { email: ' OWNER@example.com ', password: 'longenough1' });
check('login works (email case-insensitive)', r.status === 200 && r.body.token, r.body);

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
r = await call('POST', '/api/images?name=Walnut Board!', jpeg, owner, true);
check('owner uploads photo', r.status === 200 && /^img\/walnut-board-[a-f0-9]{12}\.jpg$/.test(r.body.path), r.body);
const photo = r.body.path;
r = await call('POST', '/api/images?name=x', new Uint8Array([1, 2, 3, 4]), owner, true);
check('non-JPEG upload refused', r.status === 415, r.body);
r = await call('GET', '/' + photo);
check('photo is public', r.status === 200 && r.headers.get('content-type') === 'image/jpeg' && new Uint8Array(r.body)[0] === 0xff);

const inv = { settings: { storeName: 'Tilley Woodworks', heroImage: '' }, categories: [{ id: 'boards', name: 'Boards' }], items: [{ id: 'walnut-board', name: 'Walnut Board', status: 'available', images: [photo] }] };
r = await call('PUT', '/api/inventory', { baseVersion: 0, data: inv }, owner);
check('owner publishes', r.status === 200 && r.body.version === 1, r.body);
r = await call('GET', '/api/inventory');
check('shop sees published piece', r.body.items[0].name === 'Walnut Board' && r.headers.get('x-version') === '1');

r = await call('POST', '/api/users', { email: 'helper@example.com', name: 'Sam', password: 'helperpass1' }, owner);
check('owner adds staff', r.status === 200 && r.body.user.role === 'staff' && r.body.created === true, r.body);
r = await call('POST', '/api/login', { email: 'helper@example.com', password: 'helperpass1' });
const staff = r.body.token;
check('staff can sign in', r.status === 200 && staff);
r = await call('GET', '/api/users', null, staff);
check('staff cannot manage staff', r.status === 403, r.body);
r = await call('POST', '/api/users', { email: 'owner@example.com', password: 'hijacked123' }, staff);
check('staff cannot reset owner', r.status === 403, r.body);

r = await call('PUT', '/api/inventory', { baseVersion: 0, data: inv }, staff);
check('stale publish is refused (409)', r.status === 409 && r.body.version === 1, r.body);
const inv2 = JSON.parse(JSON.stringify(inv)); inv2.items[0].status = 'sold'; inv2.items[0].images = [];
r = await call('PUT', '/api/inventory', { baseVersion: 1, data: inv2 }, staff);
check('staff publishes', r.status === 200 && r.body.version === 2, r.body);
r = await call('GET', '/' + photo);
check('removed photo is cleaned up', r.status === 404);
check('version tracks who published', JSON.parse(store.get('inventory')).updatedBy === 'helper@example.com');

r = await call('GET', '/api/users', null, owner);
check('owner lists staff (owner first)', r.status === 200 && r.body.users.length === 2 && r.body.users[0].role === 'owner' && !('hash' in r.body.users[1]), r.body);
r = await call('DELETE', '/api/users/owner%40example.com', null, owner);
check('owner cannot remove self', r.status === 400, r.body);
r = await call('DELETE', '/api/users/helper%40example.com', null, owner);
check('owner removes staff', r.status === 200, r.body);
r = await call('GET', '/api/me', null, staff);
check('removed staff is signed out immediately', r.status === 401, r.body);

r = await call('POST', '/api/password', { current: 'wrong', password: 'brandnewpass1' }, owner);
check('password change needs current password', r.status === 403, r.body);
r = await call('POST', '/api/password', { current: 'longenough1', password: 'brandnewpass1' }, owner);
check('owner changes password', r.status === 200, r.body);
r = await call('POST', '/api/login', { email: 'owner@example.com', password: 'brandnewpass1' });
check('new password works', r.status === 200);
r = await call('POST', '/api/logout', null, owner);
r = await call('GET', '/api/me', null, owner);
check('logout ends the session', r.status === 401);

for (let i = 0; i < 12; i++) r = await call('POST', '/api/login', { email: 'owner@example.com', password: 'guess' + i });
check('repeated wrong guesses get locked out', r.status === 429, r.body);

console.log(failures ? '\n' + failures + ' FAILED' : '\nall passed');
process.exit(failures ? 1 : 0);
