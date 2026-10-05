// Menjalankan seluruh rantai migrasi berurutan di Postgres lokal yang meniru Supabase
// (termasuk hak bawaan Supabase yang memberi ALL ke anon/authenticated pada tabel baru).
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { fileURLToPath } from 'node:url';
const DIR = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const BASELINE = fileURLToPath(new URL('../../supabase/baseline/20261002000000_baseline_legacy.sql', import.meta.url));
const migs = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
const files = ['BASELINE', ...migs];
console.log('urutan:', files.map(f => f.slice(0, 18)).join(' → '));

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
const run = async (f) => { const path = f === 'BASELINE' ? BASELINE : DIR + f; await db.exec(readFileSync(path, 'utf8').replace(/^create extension.*$/gm, '')); console.log('  ✔', (f === 'BASELINE' ? 'baseline' : f).slice(0, 40)); };

// kondisi "produksi sekarang": baseline sudah ada
await run(files[0]);
const priv = async (role, table, p) => (await db.query(`select has_table_privilege('${role}', 'public.${table}', '${p}') as v`)).rows[0].v;
const rls = async (t) => (await db.query(`select relrowsecurity as v from pg_class where relname = '${t}' and relnamespace = 'public'::regnamespace`)).rows[0].v;
const pol = async (n) => (await db.query(`select count(*)::int as n from pg_policies where policyname = $1`, [n])).rows[0].n;

assert.equal(await rls('frames'), false); assert.equal(await priv('anon', 'frames', 'truncate'), true);
assert.equal(await pol('Allow anon uploads to product-assets'), 1);
console.log('  sebelum perbaikan: frames tanpa RLS, anon memegang TRUNCATE, ada policy unggah anon ✔ (sesuai ekspor)');

await run(files[1]); await run(files[2]); await run(files[3]); await run(files[4]);

// legacy setelah perbaikan
for (const t of ['backgrounds', 'frames', 'products', 'character_photos', 'characters', 'user_profiles', 'video_jobs']) assert.equal(await rls(t), true, 'RLS ' + t);
for (const t of ['backgrounds', 'frames', 'products', 'character_photos', 'characters', 'user_profiles', 'video_jobs']) {
  assert.equal(await priv('anon', t, 'truncate'), false, 'anon truncate ' + t);
  assert.equal(await priv('authenticated', t, 'truncate'), false, 'auth truncate ' + t);
}
assert.equal(await priv('authenticated', 'video_jobs', 'insert'), true, 'DML yang dipakai tetap ada');
assert.equal(await priv('authenticated', 'products', 'insert'), false, 'products tetap hanya baca');
assert.equal(await pol('Allow anon uploads to product-assets'), 0);
assert.equal(await pol('authenticated upload product-assets'), 1, 'unggahan staff tidak ikut terhapus');
console.log('  legacy: RLS aktif di 7 tabel, TRUNCATE dicabut, unggahan anon ditutup, hak DML yang dipakai tetap ✔');

// v2
for (const t of ['ugc_settings', 'ugc_agent_control', 'ugc_agents', 'ugc_characters', 'ugc_products', 'ugc_batches', 'ugc_jobs', 'ugc_job_events', 'ugc_flow_snapshots']) {
  for (const p of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) assert.equal(await priv('anon', t, p), false, `anon ${p} ${t}`);
  assert.equal(await priv('authenticated', t, 'truncate'), false, `authenticated truncate ${t}`);
  assert.equal(await priv('authenticated', t, 'select'), true, `authenticated select ${t}`);
  assert.equal(await rls(t), true, 'RLS ' + t);
}
const role = (await db.query(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'user_profiles_role_check'`)).rows[0].d;
assert.match(role, /agent/);
console.log('  v2: tabel ugc_* tanpa hak untuk anon, tanpa TRUNCATE, RLS aktif, role agent diizinkan ✔');

// idempotent
for (const f of migs) await db.exec(readFileSync(DIR + f, 'utf8'));
console.log('  rantai migrasi dapat diulang tanpa error ✔');

// fungsi lama tetap bekerja dan search_path terkunci
const cfg = (await db.query(`select proconfig from pg_proc where proname = 'is_admin'`)).rows[0].proconfig;
assert.ok(cfg && cfg.some(x => x.startsWith('search_path')));
console.log('  is_admin(): search_path terkunci ✔');
console.log('\nHASIL: seluruh rantai migrasi lolos.');
