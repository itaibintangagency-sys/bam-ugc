// Menguji verify_setup.sql: setelah seluruh migrasi, semua pemeriksaan OK kecuali akun agent (langkah manual).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb, U } from './helpers.mjs';
import { PGlite } from '@electric-sql/pglite';

const SQL = readFileSync(fileURLToPath(new URL('../verify_setup.sql', import.meta.url)), 'utf8').replace(/^--.*$/gm, '');

test('verifikasi: semua OK setelah rantai migrasi, akun agent berstatus OK hanya bila role agent ada', async () => {
  const db = await makeDb();   // makeDb membuat akun agent uji
  const rows = (await db.query(SQL)).rows;
  assert.equal(rows.length, 18);
  const bad = rows.filter(r => !['OK', 'INFO'].includes(r.status));
  assert.deepEqual(bad, [], JSON.stringify(bad));
});

test('verifikasi: tanpa akun agent berstatus BELUM, dan kegagalan terdeteksi sebagai PERIKSA', async () => {
  const db = await makeDb();
  await db.exec(`delete from user_profiles where role = 'agent'`);
  let rows = (await db.query(SQL)).rows;
  assert.equal(rows.find(r => r.no === 15).status, 'BELUM');
  await db.exec(`alter table frames disable row level security; drop policy "own or admin frames" on frames;`);
  rows = (await db.query(SQL)).rows;
  assert.equal(rows.find(r => r.no === 1).status, 'PERIKSA');
  assert.equal(rows.find(r => r.no === 4).status, 'PERIKSA');
});

test('pengaman: 0200 tanpa tabel lama dan baseline di database lama memberi pesan jelas', async () => {
  const f = n => readFileSync(fileURLToPath(new URL(`../../supabase/migrations/${n}`, import.meta.url)), 'utf8');
  const db2 = new PGlite();
  await assert.rejects(() => db2.exec(f('20261002000200_ugc_v2.sql')), /Tabel user_profiles tidak ditemukan/);
  const base = readFileSync(fileURLToPath(new URL('../../supabase/baseline/20261002000000_baseline_legacy.sql', import.meta.url)), 'utf8').replace(/^create extension.*$/gm, '');
  const db3 = new PGlite();
  await db3.exec(`create schema auth; create table auth.users (id uuid primary key); create table backgrounds (id uuid primary key);`);
  await assert.rejects(() => db3.exec(base), /SUDAH memiliki tabel lama/);
});
