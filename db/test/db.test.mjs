// Pengujian skema 001_schema.sql dengan Postgres lokal (PGlite).
// Jalankan: node --test db/test/db.test.mjs   (butuh: npm i @electric-sql/pglite)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SCHEMA = readFileSync(new URL('../../supabase/migrations/20261002000200_ugc_v2.sql', import.meta.url), 'utf8');
const U = {
  admin: '00000000-0000-0000-0000-0000000000a1',
  staffA: '00000000-0000-0000-0000-0000000000b1',
  staffB: '00000000-0000-0000-0000-0000000000b2',
  agent: '00000000-0000-0000-0000-0000000000c1'
};

async function makeDb() {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create role authenticated nologin; create role anon nologin;
    create table user_profiles (id uuid primary key references auth.users (id), email text, name text,
      role text not null default 'staff' check (role in ('admin', 'staff')));
  `);
  for (const [k, id] of Object.entries(U)) {
    await db.query('insert into auth.users (id) values ($1)', [id]);
  }
  await db.exec(SCHEMA);
  await db.exec(`
    grant usage on schema public, auth, storage to authenticated;
    grant all on all tables in schema public to authenticated;
    grant all on all sequences in schema public to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    grant select on storage.buckets to authenticated;
  `);
  const prof = [[U.admin, 'admin'], [U.staffA, 'staff'], [U.staffB, 'staff'], [U.agent, 'agent']];
  for (const [id, role] of prof) await db.query('insert into user_profiles (id, email, name, role) values ($1, $2, $2, $3)', [id, role + '@x', role]);
  return db;
}

// Menjalankan perintah sebagai pengguna tertentu (meniru JWT Supabase).
async function as(db, uid, fn) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.exec('set role authenticated');
  try { return await fn(); } finally { await db.exec('reset role'); }
}
async function rejects(promise, code) {
  try { await promise; } catch (e) {
    if (code) assert.ok(String(e.code ?? '') === code || String(e.message).includes(code), `diharapkan ${code}, dapat: ${e.code} ${e.message}`);
    return e;
  }
  assert.fail('diharapkan error, tetapi berhasil');
}

// Membuat 1 karakter, N produk, 1 batch dengan N job berstatus approved (sebagai staffA).
async function seed(db, { n = 3, risky = false, projectUrl = 'https://flow.google.com/project/abc' } = {}) {
  const ids = { products: [], jobs: [] };
  await as(db, U.staffA, async () => {
    const c = await db.query(`insert into ugc_characters (code, name, created_by, flow_project_url) values ('C02', 'Karakter 2', $1, $2) returning id`, [U.staffA, projectUrl]);
    ids.char = c.rows[0].id;
    const b = await db.query(`insert into ugc_batches (character_id, resolution, created_by) values ($1, '360p', $2) returning id`, [ids.char, U.staffA]);
    ids.batch = b.rows[0].id;
    for (let i = 1; i <= n; i++) {
      const p = await db.query(`insert into ugc_products (name, created_by) values ($1, $2) returning id`, ['Produk ' + i, U.staffA]);
      ids.products.push(p.rows[0].id);
      const plan = JSON.stringify({ archetype_id: 'A-01', needs_human_approval: risky && i === 1 });
      const j = await db.query(
        `insert into ugc_jobs (batch_id, product_id, seq, status, panel_plan, storyboard_path, video_json, setting_id, created_by)
         values ($1, $2, $3, 'approved', $4::jsonb, $5, '{"x":1}', 'S-01', $6) returning id`,
        [ids.batch, p.rows[0].id, i, plan, `b/${i}.png`, U.staffA]);
      ids.jobs.push(j.rows[0].id);
    }
  });
  return ids;
}

test('skema: dapat dijalankan dua kali dan role agent diizinkan', async () => {
  const db = await makeDb();
  await db.exec(SCHEMA);
  const r = await db.query(`select count(*)::int as n from ugc_settings`);
  assert.ok(r.rows[0].n >= 7);
  const p = await db.query(`select role from user_profiles where id = $1`, [U.agent]);
  assert.equal(p.rows[0].role, 'agent');
});

test('batas: maksimal 10 video per batch dan 10 batch per hari', async () => {
  const db = await makeDb();
  const ids = await seed(db, { n: 10 });
  await as(db, U.staffA, async () => {
    const p = await db.query(`insert into ugc_products (name, created_by) values ('Lebih', $1) returning id`, [U.staffA]);
    await rejects(db.query(`insert into ugc_jobs (batch_id, product_id, seq, created_by) values ($1, $2, 9, $3)`, [ids.batch, p.rows[0].id, U.staffA]), 'job_limit_per_batch');
  });
  await db.query(`update ugc_settings set value = '2'::jsonb where key = 'max_batches_per_day'`);
  await as(db, U.staffA, async () => {
    await db.query(`insert into ugc_batches (character_id, created_by) values ($1, $2)`, [ids.char, U.staffA]);
    await rejects(db.query(`insert into ugc_batches (character_id, created_by) values ($1, $2)`, [ids.char, U.staffA]), 'batch_limit_per_day');
  });
});

test('produk: maksimal 6 foto', async () => {
  const db = await makeDb();
  await as(db, U.staffA, async () => {
    const photos = JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ path: `p${i}.jpg`, role: 'depan' })));
    await rejects(db.query(`insert into ugc_products (name, photos, created_by) values ('X', $1::jsonb, $2)`, [photos, U.staffA]), 'ugc_products_max_photos');
  });
});

test('staff tidak bisa melompati pemeriksaan status', async () => {
  const db = await makeDb();
  const ids = await seed(db);
  await as(db, U.staffA, async () => {
    await rejects(db.query(`update ugc_jobs set status = 'queued' where id = $1`, [ids.jobs[0]]), '42501');
    await rejects(db.query(`update ugc_jobs set risk_approved_by = $2 where id = $1`, [ids.jobs[0], U.staffA]), '42501');
    await db.query(`update ugc_jobs set status = 'canceled' where id = $1`, [ids.jobs[0]]);
  });
});

test('enqueue: syarat project Flow, persetujuan, dan risiko tinggi', async () => {
  const db = await makeDb();
  const noUrl = await seed(db, { projectUrl: 'https://contoh.com/x' });
  await as(db, U.staffA, async () => {
    await rejects(db.query(`select ugc_enqueue_batch($1)`, [noUrl.batch]), 'project Flow');
  });
  const db2 = await makeDb();
  const ids = await seed(db2, { n: 3, risky: true });
  await as(db2, U.staffA, async () => {
    await rejects(db2.query(`select ugc_enqueue_batch($1)`, [ids.batch]), 'berisiko tinggi');
  });
  await as(db2, U.staffB, async () => {
    await rejects(db2.query(`select ugc_enqueue_batch($1)`, [ids.batch]), '42501');
  });
  await as(db2, U.admin, async () => {
    await db2.query(`update ugc_jobs set risk_approved_by = $2 where id = $1`, [ids.jobs[0], U.admin]);
  });
  await as(db2, U.staffA, async () => {
    const r = await db2.query(`select ugc_enqueue_batch($1) as n`, [ids.batch]);
    assert.equal(r.rows[0].n, 3);
  });
  const st = await db2.query(`select status from ugc_batches where id = $1`, [ids.batch]);
  assert.equal(st.rows[0].status, 'queued');
});

test('agent: klaim berurutan tanpa duplikat, jeda, dan hak akses', async () => {
  const db = await makeDb();
  const ids = await seed(db, { n: 3 });
  await as(db, U.staffA, async () => { await db.query(`select ugc_enqueue_batch($1)`, [ids.batch]); });

  await as(db, U.staffA, async () => { await rejects(db.query(`select ugc_claim_next_job('x')`), '42501'); });

  await as(db, U.agent, async () => {
    await db.query(`select ugc_agent_heartbeat('laptop-1', '{"version":"0.1.0"}'::jsonb)`);
    const a = (await db.query(`select ugc_claim_next_job('laptop-1') as j`)).rows[0].j;
    const b = (await db.query(`select ugc_claim_next_job('laptop-1') as j`)).rows[0].j;
    assert.equal(a.seq, 1); assert.equal(b.seq, 2);
    assert.notEqual(a.job_id, b.job_id);
    assert.equal(a.project_url, 'https://flow.google.com/project/abc');
    assert.equal(a.resolution, '360p');
    assert.equal(a.attempt, 1);
    assert.equal(a.storyboard.path, 'b/1.png');

    await db.query(`select ugc_set_pause(true, 'uji')`);
    const c = (await db.query(`select ugc_claim_next_job('laptop-1') as j`)).rows[0].j;
    assert.equal(c, null, 'saat dijeda tidak ada job');
    await db.query(`select ugc_set_pause(false)`);
    const d = (await db.query(`select ugc_claim_next_job('laptop-1') as j`)).rows[0].j;
    assert.equal(d.seq, 3);
    const e = (await db.query(`select ugc_claim_next_job('laptop-1') as j`)).rows[0].j;
    assert.equal(e, null, 'antrean habis');
  });
});

test('agent: kemajuan, ulang otomatis, batas percobaan, dan rollup batch', async () => {
  const db = await makeDb();
  const ids = await seed(db, { n: 2 });
  await as(db, U.staffA, async () => { await db.query(`select ugc_enqueue_batch($1)`, [ids.batch]); });

  await as(db, U.agent, async () => {
    await db.query(`select ugc_agent_heartbeat('laptop-1')`);
    const j1 = (await db.query(`select ugc_claim_next_job('laptop-1') as j`)).rows[0].j;

    // gagal karena kebijakan -> kembali ke antrean dengan jeda
    const s1 = (await db.query(`select ugc_job_progress($1, 'failed', '{"error_kind":"policy","last_error":"ditolak"}'::jsonb, '{"step":"generate","kind":"error","message":"ditolak"}'::jsonb) as s`, [j1.job_id])).rows[0].s;
    assert.equal(s1, 'queued');
    await db.exec('reset role');
    const nb = (await db.query(`select not_before > now() as ok from ugc_jobs where id = $1`, [j1.job_id])).rows[0].ok;
    assert.ok(nb, 'ada jeda sebelum percobaan berikut');
    await db.exec('set role authenticated');

    // job 2 jalan terus sampai selesai
    const j2 = (await db.query(`select ugc_claim_next_job('laptop-1') as j`)).rows[0].j;
    assert.equal(j2.seq, 2);
    const s2 = (await db.query(`select ugc_job_progress($1, 'downloaded', '{"video_path":"b/2.mp4","credits_observed":7}'::jsonb) as s`, [j2.job_id])).rows[0].s;
    assert.equal(s2, 'downloaded');

    // job 1 belum boleh diambil karena jeda
    assert.equal((await db.query(`select ugc_claim_next_job('laptop-1') as j`)).rows[0].j, null);
  });

  await db.exec(`update ugc_jobs set not_before = now() - interval '1 minute' where status = 'queued'`);
  await as(db, U.agent, async () => {
    for (let i = 2; i <= 3; i++) {
      const j = (await db.query(`select ugc_claim_next_job('laptop-1') as j`)).rows[0].j;
      assert.equal(j.attempt, i);
      const s = (await db.query(`select ugc_job_progress($1, 'failed', '{"error_kind":"policy","last_error":"ditolak lagi"}'::jsonb) as s`, [j.job_id])).rows[0].s;
      if (i < 3) { assert.equal(s, 'queued'); await db.exec('reset role'); await db.exec(`update ugc_jobs set not_before = null where id = '${j.job_id}'`); await db.exec('set role authenticated'); }
      else assert.equal(s, 'failed', 'percobaan ke-3 gagal permanen');
    }
  });
  const b = (await db.query(`select status from ugc_batches where id = $1`, [ids.batch])).rows[0].status;
  assert.equal(b, 'done');
  const ev = (await db.query(`select count(*)::int as n, bool_or(archetype_id = 'A-01') as arch from ugc_job_events`)).rows[0];
  assert.ok(ev.n >= 1 && ev.arch, 'telemetri tercatat dengan arketipe');
});

test('agent: needs_human menjeda antrean', async () => {
  const db = await makeDb();
  const ids = await seed(db, { n: 2 });
  await as(db, U.staffA, async () => { await db.query(`select ugc_enqueue_batch($1)`, [ids.batch]); });
  await as(db, U.agent, async () => {
    await db.query(`select ugc_agent_heartbeat('laptop-1')`);
    const j = (await db.query(`select ugc_claim_next_job('laptop-1') as j`)).rows[0].j;
    await db.query(`select ugc_job_progress($1, 'needs_human', '{"last_error":"captcha"}'::jsonb)`, [j.job_id]);
    const hb = (await db.query(`select ugc_agent_heartbeat('laptop-1') as h`)).rows[0].h;
    assert.equal(hb.paused, true);
    assert.equal((await db.query(`select ugc_claim_next_job('laptop-1') as j`)).rows[0].j, null);
  });
});

test('agent: job tersangkut dikembalikan ke antrean', async () => {
  const db = await makeDb();
  const ids = await seed(db, { n: 1 });
  await as(db, U.staffA, async () => { await db.query(`select ugc_enqueue_batch($1)`, [ids.batch]); });
  await as(db, U.agent, async () => {
    await db.query(`select ugc_agent_heartbeat('laptop-1')`);
    await db.query(`select ugc_claim_next_job('laptop-1')`);
  });
  await db.exec(`update ugc_jobs set claimed_at = now() - interval '30 minutes'; update ugc_agents set last_seen = now() - interval '10 minutes';`);
  await as(db, U.agent, async () => {
    const n = (await db.query(`select ugc_requeue_stale() as n`)).rows[0].n;
    assert.equal(n, 1);
  });
  assert.equal((await db.query(`select status from ugc_jobs`)).rows[0].status, 'queued');
});

test('QA: staff pemilik menyetujui video yang sudah diunduh', async () => {
  const db = await makeDb();
  const ids = await seed(db, { n: 1 });
  await as(db, U.staffA, async () => { await db.query(`select ugc_enqueue_batch($1)`, [ids.batch]); });
  await as(db, U.agent, async () => {
    await db.query(`select ugc_agent_heartbeat('laptop-1')`);
    const j = (await db.query(`select ugc_claim_next_job('laptop-1') as j`)).rows[0].j;
    await db.query(`select ugc_job_progress($1, 'downloaded', '{"video_path":"b/1.mp4"}'::jsonb)`, [j.job_id]);
  });
  await as(db, U.staffB, async () => { await rejects(db.query(`select ugc_review_job($1, true)`, [ids.jobs[0]]), '42501'); });
  await as(db, U.staffA, async () => {
    await db.query(`select ugc_review_job($1, true, 'bersih')`, [ids.jobs[0]]);
    const upd = await db.query(`update ugc_jobs set video_path = 'lain.mp4' where id = $1`, [ids.jobs[0]]);
    assert.equal(upd.affectedRows, 0, 'staff tidak dapat mengubah job yang sudah diproses');
  });
  assert.equal((await db.query(`select status from ugc_jobs`)).rows[0].status, 'done');
});

test('RLS: staff hanya melihat miliknya, admin melihat semua, agent tidak membaca tabel', async () => {
  const db = await makeDb();
  await seed(db, { n: 2 });
  await as(db, U.staffB, async () => {
    assert.equal((await db.query(`select count(*)::int as n from ugc_jobs`)).rows[0].n, 0);
    assert.equal((await db.query(`select count(*)::int as n from ugc_batches`)).rows[0].n, 0);
    assert.equal((await db.query(`select count(*)::int as n from ugc_characters`)).rows[0].n, 1, 'pustaka karakter dibagi');
    await rejects(db.query(`insert into ugc_settings (key, value) values ('x', '1'::jsonb)`), 'row-level security');
  });
  await as(db, U.staffA, async () => { assert.equal((await db.query(`select count(*)::int as n from ugc_jobs`)).rows[0].n, 2); });
  await as(db, U.admin, async () => {
    assert.equal((await db.query(`select count(*)::int as n from ugc_jobs`)).rows[0].n, 2);
    await db.query(`update ugc_settings set value = '5'::jsonb where key = 'max_batches_per_day'`);
  });
  await as(db, U.agent, async () => {
    assert.equal((await db.query(`select count(*)::int as n from ugc_jobs`)).rows[0].n, 0);
    assert.equal((await db.query(`select count(*)::int as n from ugc_characters`)).rows[0].n, 0);
  });
});

test('penyimpanan: agent hanya menulis video, staff hanya menulis aset', async () => {
  const db = await makeDb();
  await as(db, U.agent, async () => {
    await db.query(`insert into storage.objects (bucket_id, name) values ('ugc-videos', 'b/1.mp4')`);
    await rejects(db.query(`insert into storage.objects (bucket_id, name) values ('ugc-storyboards', 'b/1.png')`), 'row-level security');
  });
  await as(db, U.staffA, async () => {
    await db.query(`insert into storage.objects (bucket_id, name) values ('ugc-storyboards', 'b/1.png')`);
    await rejects(db.query(`insert into storage.objects (bucket_id, name) values ('ugc-videos', 'x.mp4')`), 'row-level security');
    assert.equal((await db.query(`select count(*)::int as n from storage.objects`)).rows[0].n, 2, 'staff membaca semua bucket ugc');
  });
});
