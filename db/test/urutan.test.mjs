// Pengujian urutan migrasi: pesan jelas bila urutan salah, dan berkas gabungan identik dengan sumbernya.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { makeDb, as, rejects, U } from './helpers.mjs';

const P = p => fileURLToPath(new URL(p, import.meta.url));
const mig = f => readFileSync(P('../../supabase/migrations/' + f), 'utf8').replace(/^create extension.*$/gm, '');
const RUN_ALL = readFileSync(P('../../supabase/run_all/20261002_JALANKAN_SEMUA.sql'), 'utf8');

async function bareDb() {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
    alter table storage.objects enable row level security;
    create role authenticated nologin; create role anon nologin;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  await db.exec(readFileSync(P('../../supabase/baseline/20261002000000_baseline_legacy.sql'), 'utf8').replace(/^create extension.*$/gm, ''));
  return db;
}

test('urutan salah: 0300 sebelum 0200 berhenti dengan pesan yang menyebut berkas yang harus dijalankan lebih dulu', async () => {
  const db = await bareDb();
  const e = await rejects(db.exec(mig('20261002000300_ugc_character_voice.sql')));
  assert.match(String(e.message), /URUTAN SALAH/);
  assert.match(String(e.message), /20261002000200_ugc_v2\.sql/);
  assert.equal((await db.query(`select to_regclass('public.ugc_character_tasks') as r`)).rows[0].r, null, 'tidak ada setengah jalan');
});

test('berkas gabungan: berjalan pada database lama (baseline), dapat diulang, dan hasilnya lengkap', async () => {
  const db = await bareDb();
  await db.exec(RUN_ALL);
  await db.exec(RUN_ALL);
  for (const t of ['ugc_characters', 'ugc_jobs', 'ugc_character_photos', 'ugc_character_tasks']) assert.equal((await db.query(`select to_regclass('public.${t}') as r`)).rows[0].r, t);
  for (const f of ['ugc_claim_next_job', 'ugc_claim_next_char_task', 'ugc_review_intro', 'ugc_enqueue_batch']) {
    assert.equal((await db.query(`select count(*)::int as n from pg_proc where proname = $1`, [f])).rows[0].n, 1, f);
  }
  const rls = (await db.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`)).rows;
  assert.deepEqual(rls, [], 'RLS aktif di semua tabel');
  assert.match((await db.query(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'user_profiles_role_check'`)).rows[0].d, /agent/);
});

test('berkas gabungan: tidak melenceng dari berkas sumber (empat bagian, urutan benar, isi sama)', async () => {
  const order = ['20261002000100_fix_legacy_rls_grants.sql', '20261002000200_ugc_v2.sql', '20261002000300_ugc_character_voice.sql', '20261002000400_hardening.sql'];
  let pos = -1;
  for (const f of order) {
    const i = RUN_ALL.indexOf('BAGIAN: ' + f); assert.ok(i > pos, 'urutan ' + f); pos = i;
    const src = readFileSync(P('../../supabase/migrations/' + f), 'utf8').trim();
    assert.ok(RUN_ALL.includes(src), 'isi ' + f + ' sama persis');
  }
  assert.ok(!RUN_ALL.includes('BAGIAN: 20261002000150'), '0150 sengaja tidak ikut');
  assert.ok(!RUN_ALL.includes('BAGIAN: 20261002000000'), 'baseline tidak ikut');
});

test('berkas gabungan: sistem yang dihasilkan lolos satu siklus karakter sampai batch masuk antrean', async () => {
  const db = await bareDb();
  await db.exec(RUN_ALL);
  await db.exec(`grant usage on schema public, auth, storage to authenticated, anon; grant select on storage.buckets to authenticated;`);
  for (const [id, role] of [[U.staffA, 'staff'], [U.agent, 'agent']]) {
    await db.query('insert into auth.users (id) values ($1)', [id]);
    await db.query('insert into user_profiles (id, email, name, role) values ($1, $2, $2, $3)', [id, role + '@x', role]);
  }
  let id;
  await as(db, U.staffA, async () => {
    id = (await db.query(`insert into ugc_characters (code, name, created_by, voice_base, flow_project_url, status) values ('C1', 'Satu', $1, 'Aoede', 'https://flow.google.com/project/p', 'sheet_ready') returning id`, [U.staffA])).rows[0].id;
    await db.query(`insert into ugc_character_photos (character_id, angle, path, approved, created_by) values ($1, 'face_front', 'a.png', true, $2)`, [id, U.staffA]);
    await db.query(`select ugc_request_char_task($1, 'upload_photos')`, [id]);
  });
  await as(db, U.agent, async () => {
    await db.query(`select ugc_agent_heartbeat('l')`);
    const t = (await db.query(`select ugc_claim_next_char_task('l') as t`)).rows[0].t;
    await db.query(`select ugc_char_task_progress($1, 'done')`, [t.task_id]);
  });
  assert.equal((await db.query(`select status from ugc_characters where id = $1`, [id])).rows[0].status, 'project_ready');
});
