// Supabase tiruan untuk pengujian: HTTP (auth, PostgREST, storage) di atas Postgres lokal yang menjalankan SEMUA migrasi asli.
// Setiap permintaan dijalankan sebagai pengguna yang login (role authenticated + klaim sub), sehingga RLS dan penjaga trigger berlaku.
// Yang TIDAK ditiru: JWT sungguhan, batas ukuran, dan seluruh fitur PostgREST (hanya filter eq, is.null, not.is.null, in).
import http from 'node:http';
import { makeDb, as, U } from './helpers.mjs';

export const USERS = [
  { id: U.admin, email: 'admin@x', password: 'pw-admin' },
  { id: U.staffA, email: 'staff@x', password: 'pw-staff' },
  { id: U.agent, email: 'agent@x', password: 'pw-agent' },
  { id: U.staffB, email: 'staffb@x', password: 'pw-staffb' },
  { id: '00000000-0000-0000-0000-0000000000f9', email: 'tanpaprofil@x', password: 'pw-tanpa' }
];
const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const fakeJwt = (u, ttl = 3600) => { const now = Math.floor(Date.now() / 1000); return `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ aud: 'authenticated', role: 'authenticated', sub: u.id, email: u.email, iat: now, exp: now + ttl, session_id: 'sess-' + u.id })}.fake-signature`; };
const userOf = u => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' });
// Pengenal pemilik token: format lama "tok:<id>" (agent) atau JWT sungguhan (website).
function uidFromBearer(h) {
  const m = /^Bearer (.+)$/.exec(h || ''); if (!m) return null; const t = m[1];
  if (t.startsWith('tok:')) return t.slice(4);
  const parts = t.split('.'); if (parts.length !== 3) return null;
  try { const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); if (p.role !== 'authenticated' || !p.sub || p.exp < Date.now() / 1000) return null; return p.sub; } catch { return null; }
}

const IDENT = /^[a-z][a-z0-9_]*$/;
const jsonish = v => (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;

function parseFilters(params) {
  const where = [], vals = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    if (!IDENT.test(k)) throw Object.assign(new Error('kolom tidak valid: ' + k), { code: 'PGRST100' });
    let m;
    if ((m = /^eq\.(.*)$/.exec(v))) { vals.push(m[1]); where.push(`${k}::text = $${vals.length}`); }
    else if (v === 'is.null') where.push(`${k} is null`);
    else if (v === 'not.is.null') where.push(`${k} is not null`);
    else if ((m = /^in\.\((.*)\)$/.exec(v))) { const parts = m[1].split(','); where.push(`${k}::text in (${parts.map(p => { vals.push(p); return '$' + vals.length; }).join(',')})`); }
    else throw Object.assign(new Error('operator tidak didukung: ' + v), { code: 'PGRST100' });
  }
  return { where, vals };
}

// Mengambil isi berkas dari badan multipart/form-data (supabase-js mengunggah Blob sebagai FormData).
function multipartFile(raw, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType || ''); if (!m) return raw;
  const b = Buffer.from('--' + (m[1] || m[2])); let pos = raw.indexOf(b);
  while (pos >= 0) {
    const next = raw.indexOf(b, pos + b.length); if (next < 0) break;
    const part = raw.subarray(pos + b.length + 2, next - 2);           // buang CRLF di awal dan akhir bagian
    const sep = part.indexOf('\r\n\r\n'); const head = part.subarray(0, sep).toString();
    if (/filename=|name=""/.test(head)) return part.subarray(sep + 4);
    pos = next;
  }
  return raw;
}

export async function startFake({ omitFunctions = [] } = {}) {
  const flags = { failUploads: false };
  const db = await makeDb();
  const storage = new Map();
  const stats = { rpc: {}, requests: 0 };
  let tail = Promise.resolve();
  const lock = async fn => { const prev = tail; let rel; tail = new Promise(r => { rel = r; }); await prev; try { return await fn(); } finally { rel(); } };

  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks); const u = new URL(req.url, 'http://x'); stats.requests++;
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, prefer, range, accept-profile, content-profile, x-supabase-api-version, x-upsert, cache-control, accept', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS', 'Access-Control-Expose-Headers': 'content-range' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const send = (code, body, type = 'application/json') => {
      const b = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      res.writeHead(code, { ...cors, 'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : type }); res.end(b);
    };
    const fail = e => {
      const code = e.code === '42501' ? 403 : e.code === '23505' ? 409 : e.code === '42883' || e.code === 'PGRST202' ? 404 : e.code === 'PGRST100' ? 400 : 400;
      send(code, { code: e.code === '42883' ? 'PGRST202' : e.code, message: e.code === '42883' ? `Could not find the function public.${e.fn || ''}` : e.message, details: null });
    };
    try {
      const p = u.pathname;
      if (p === '/auth/v1/token') {
        const body = JSON.parse(raw.toString() || '{}'); const grant = u.searchParams.get('grant_type');
        let user;
        if (grant === 'password') user = USERS.find(x => x.email === body.email && x.password === body.password);
        else if (grant === 'refresh_token') user = USERS.find(x => 'ref:' + x.id === body.refresh_token);
        if (!user) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        const legacy = !req.headers['x-client-info'];   // agent memakai klien sendiri; website (supabase-js) mengirim x-client-info
        const ttl = Number(process.env.FAKE_TOKEN_TTL || 3600);
        return send(200, { access_token: legacy ? 'tok:' + user.id : fakeJwt(user, ttl), token_type: 'bearer', expires_in: ttl, expires_at: Math.floor(Date.now() / 1000) + ttl, refresh_token: 'ref:' + user.id, user: userOf(user) });
      }
      if (p === '/auth/v1/logout') return send(204, '');
      const uid = uidFromBearer(req.headers.authorization);
      if (!uid || !USERS.some(x => x.id === uid)) return send(401, { code: 'PGRST301', message: 'JWT tidak valid' });
      if (p === '/auth/v1/user') return send(200, userOf(USERS.find(x => x.id === uid)));

      let m;
      if ((m = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(p))) {
        const fn = m[1]; stats.rpc[fn] = (stats.rpc[fn] || 0) + 1;
        if (omitFunctions.includes(fn)) return fail(Object.assign(new Error('x'), { code: 'PGRST202', fn }));
        const args = JSON.parse(raw.toString() || '{}'); const keys = Object.keys(args);
        if (!keys.every(k => IDENT.test(k))) throw new Error('argumen tidak valid');
        const sql = `select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
        const out = await lock(() => as(db, uid, () => db.query(sql, keys.map(k => jsonish(args[k])))));
        let r = out.rows[0] ? out.rows[0].r : null; if (r === '' || r === undefined) r = null;
        return send(200, JSON.stringify(r === null ? null : r));
      }
      if ((m = /^\/rest\/v1\/([a-z][a-z0-9_]*)$/.exec(p))) {
        const t = m[1];
        if (req.method === 'GET') {
          const sel = (u.searchParams.get('select') || '*'); const cols = /^[a-z_*,]+$/.test(sel) ? sel : '*';
          const { where, vals } = parseFilters(u.searchParams);
          const ord = /^([a-z_]+)\.(asc|desc)$/.exec(u.searchParams.get('order') || '');
          const lim = Number(u.searchParams.get('limit') || 0);
          const sql = `select ${cols} from ${t}${where.length ? ' where ' + where.join(' and ') : ''}${ord ? ` order by ${ord[1]} ${ord[2]}` : ''}${lim ? ` limit ${lim | 0}` : ''}`;
          const out = await lock(() => as(db, uid, () => db.query(sql, vals)));
          if (/vnd\.pgrst\.object\+json/.test(req.headers.accept || '')) return out.rows.length === 1 ? send(200, out.rows[0]) : send(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
          return send(200, out.rows);
        }
        if (req.method === 'POST') {
          const body = JSON.parse(raw.toString()); const keys = Object.keys(body);
          if (!keys.every(k => IDENT.test(k))) throw new Error('kolom tidak valid');
          const sql = `insert into ${t} (${keys.join(', ')}) values (${keys.map((_, i) => '$' + (i + 1)).join(', ')}) returning *`;
          const out = await lock(() => as(db, uid, () => db.query(sql, keys.map(k => jsonish(body[k])))));
          return send(201, out.rows);
        }
        if (req.method === 'PATCH') {
          const body = JSON.parse(raw.toString()); const keys = Object.keys(body);
          const { where, vals } = parseFilters(u.searchParams);
          if (!where.length) throw Object.assign(new Error('PATCH tanpa filter ditolak'), { code: 'PGRST100' });
          const base = vals.length;
          const sql = `update ${t} set ${keys.map((k, i) => `${k} = $${base + i + 1}`).join(', ')} where ${where.join(' and ')} returning *`;
          const out = await lock(() => as(db, uid, () => db.query(sql, [...vals, ...keys.map(k => jsonish(body[k]))])));
          return send(200, out.rows);
        }
      }
      if ((m = /^\/storage\/v1\/object\/(?:authenticated\/)?([a-z-]+)\/(.+)$/.exec(p)) && req.method === 'GET') {
        const bucket = m[1], name = decodeURIComponent(m[2]);
        const out = await lock(() => as(db, uid, () => db.query(`select id from storage.objects where bucket_id = $1 and name = $2`, [bucket, name])));
        const data = storage.get(bucket + '/' + name);
        if (!out.rows.length || !data) return send(404, { message: 'Object not found' });
        return send(200, data);
      }
      if ((m = /^\/storage\/v1\/object\/([a-z-]+)\/(.+)$/.exec(p)) && req.method === 'POST') {
        if (flags.failUploads) return send(500, { statusCode: '500', error: 'Internal Server Error', message: 'Internal Server Error' });
        const bucket = m[1], name = decodeURIComponent(m[2]);
        await lock(() => as(db, uid, async () => {
          const ex = await db.query(`select id from storage.objects where bucket_id = $1 and name = $2`, [bucket, name]);
          if (ex.rows.length) { const r = await db.query(`update storage.objects set name = name where id = $1 returning id`, [ex.rows[0].id]); if (!r.rows.length) throw Object.assign(new Error('new row violates row-level security policy'), { code: '42501' }); }
          else await db.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name]);
        }));
        storage.set(bucket + '/' + name, multipartFile(raw, req.headers['content-type']));
        return send(200, { Key: bucket + '/' + name, Id: 'obj-' + name });
      }
      return send(404, { message: 'rute tidak dikenal: ' + req.method + ' ' + p });
    } catch (e) { fail(e); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    db, storage, stats, flags, url: `http://127.0.0.1:${port}`, port,
    sql: async (q, params = []) => lock(async () => { await db.exec('reset role'); return db.query(q, params); }),
    close: () => new Promise(r => server.close(r))
  };
}
