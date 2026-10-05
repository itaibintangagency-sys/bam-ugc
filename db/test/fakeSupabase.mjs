// Supabase tiruan untuk pengujian: HTTP (auth, PostgREST, storage) di atas Postgres lokal yang menjalankan SEMUA migrasi asli.
// Setiap permintaan dijalankan sebagai pengguna yang login (role authenticated + klaim sub), sehingga RLS dan penjaga trigger berlaku.
// Yang TIDAK ditiru: JWT sungguhan, batas ukuran, dan seluruh fitur PostgREST (hanya filter eq, is.null, not.is.null, in).
import http from 'node:http';
import { makeDb, as, U } from './helpers.mjs';

export const USERS = [
  { id: U.admin, email: 'admin@x', password: 'pw-admin' },
  { id: U.staffA, email: 'staff@x', password: 'pw-staff' },
  { id: U.agent, email: 'agent@x', password: 'pw-agent' }
];

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

export async function startFake({ omitFunctions = [] } = {}) {
  const db = await makeDb();
  const storage = new Map();
  const stats = { rpc: {}, requests: 0 };
  let tail = Promise.resolve();
  const lock = async fn => { const prev = tail; let rel; tail = new Promise(r => { rel = r; }); await prev; try { return await fn(); } finally { rel(); } };

  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks); const u = new URL(req.url, 'http://x'); stats.requests++;
    const send = (code, body, type = 'application/json') => {
      const b = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      res.writeHead(code, { 'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : type }); res.end(b);
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
        return send(200, { access_token: 'tok:' + user.id, refresh_token: 'ref:' + user.id, expires_in: 3600, user: { id: user.id, email: user.email } });
      }
      const bearer = /^Bearer tok:(.+)$/.exec(req.headers.authorization || '');
      if (!bearer || !USERS.some(x => x.id === bearer[1])) return send(401, { message: 'JWT tidak valid' });
      const uid = bearer[1];

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
      if ((m = /^\/rest\/v1\/(ugc_[a-z_]+)$/.exec(p))) {
        const t = m[1];
        if (req.method === 'GET') {
          const sel = (u.searchParams.get('select') || '*'); const cols = /^[a-z_*,]+$/.test(sel) ? sel : '*';
          const { where, vals } = parseFilters(u.searchParams);
          const ord = /^([a-z_]+)\.(asc|desc)$/.exec(u.searchParams.get('order') || '');
          const lim = Number(u.searchParams.get('limit') || 0);
          const sql = `select ${cols} from ${t}${where.length ? ' where ' + where.join(' and ') : ''}${ord ? ` order by ${ord[1]} ${ord[2]}` : ''}${lim ? ` limit ${lim | 0}` : ''}`;
          const out = await lock(() => as(db, uid, () => db.query(sql, vals)));
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
      if ((m = /^\/storage\/v1\/object\/authenticated\/([a-z-]+)\/(.+)$/.exec(p)) && req.method === 'GET') {
        const bucket = m[1], name = decodeURIComponent(m[2]);
        const out = await lock(() => as(db, uid, () => db.query(`select id from storage.objects where bucket_id = $1 and name = $2`, [bucket, name])));
        const data = storage.get(bucket + '/' + name);
        if (!out.rows.length || !data) return send(404, { message: 'Object not found' });
        return send(200, data);
      }
      if ((m = /^\/storage\/v1\/object\/([a-z-]+)\/(.+)$/.exec(p)) && req.method === 'POST') {
        const bucket = m[1], name = decodeURIComponent(m[2]);
        await lock(() => as(db, uid, async () => {
          const ex = await db.query(`select id from storage.objects where bucket_id = $1 and name = $2`, [bucket, name]);
          if (ex.rows.length) { const r = await db.query(`update storage.objects set name = name where id = $1 returning id`, [ex.rows[0].id]); if (!r.rows.length) throw Object.assign(new Error('new row violates row-level security policy'), { code: '42501' }); }
          else await db.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name]);
        }));
        storage.set(bucket + '/' + name, raw);
        return send(200, { Key: bucket + '/' + name });
      }
      return send(404, { message: 'rute tidak dikenal: ' + req.method + ' ' + p });
    } catch (e) { fail(e); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    db, storage, stats, url: `http://127.0.0.1:${port}`, port,
    sql: async (q, params = []) => lock(async () => { await db.exec('reset role'); return db.query(q, params); }),
    close: () => new Promise(r => server.close(r))
  };
}
