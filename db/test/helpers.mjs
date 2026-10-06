// Pembantu pengujian database: Postgres lokal yang meniru Supabase (auth, storage, role).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

export const U = {
  admin: '00000000-0000-0000-0000-0000000000a1',
  staffA: '00000000-0000-0000-0000-0000000000b1',
  staffB: '00000000-0000-0000-0000-0000000000b2',
  agent: '00000000-0000-0000-0000-0000000000c1'
};
const DIR = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const BASELINE = fileURLToPath(new URL('../../supabase/baseline/20261002000000_baseline_legacy.sql', import.meta.url));

// upTo: awalan nama berkas terakhir yang dijalankan (mis. '20261002000300')
export async function makeDb({ upTo = '99999999999999' } = {}) {
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
    create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  for (const id of Object.values(U)) await db.query('insert into auth.users (id) values ($1)', [id]);
  const base = readFileSync(BASELINE, 'utf8').replace(/^create extension.*$/gm, '');
  await db.exec(base); await db.exec(`grant all on all tables in schema public to authenticated;`);
  const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort().filter(f => f.slice(0, 14) <= upTo);
  for (const f of files) await db.exec(readFileSync(DIR + f, 'utf8').replace(/^create extension.*$/gm, ''));
  await db.exec(`grant usage on schema public, auth, storage to authenticated, anon; grant usage on schema public to service_role; grant select on storage.buckets to authenticated;
                 grant select, insert, update, delete on storage.objects to authenticated;`);
  for (const [id, role] of [[U.admin, 'admin'], [U.staffA, 'staff'], [U.staffB, 'staff'], [U.agent, 'agent']]) {
    await db.query('insert into user_profiles (id, email, name, role) values ($1, $2, $2, $3)', [id, role + '@x', role]);
  }
  return db;
}

export async function as(db, uid, fn) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.exec('set role authenticated');
  try { return await fn(); } finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', '', false)"); }
}
export async function rejects(promise, code) {
  try { await promise; } catch (e) {
    if (code) assert.ok(String(e.code ?? '') === code || String(e.message).includes(code), `diharapkan ${code}, dapat: ${e.code} ${e.message}`);
    return e;
  }
  assert.fail('diharapkan error, tetapi berhasil');
}
