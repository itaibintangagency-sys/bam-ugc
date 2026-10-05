// Pengujian migrasi 0400: celah kenaikan role, hak fungsi, policy, dan indeks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb, as, rejects, U } from './helpers.mjs';

const priv = async (db, role, fn, p = 'execute') => (await db.query(`select has_function_privilege('${role}', '${fn}', '${p}') as v`)).rows[0].v;

test('KRITIS: staff tidak bisa menaikkan role atau mengganti email profilnya; nama tetap bisa diubah', async () => {
  const db = await makeDb();
  await as(db, U.staffA, async () => {
    await rejects(db.query(`update user_profiles set role = 'admin' where id = $1`, [U.staffA]), 'permission denied');
    await rejects(db.query(`update user_profiles set email = 'x@y' where id = $1`, [U.staffA]), 'permission denied');
    const ok = await db.query(`update user_profiles set name = 'Nama Baru', avatar_path = 'a.png' where id = $1`, [U.staffA]);
    assert.equal(ok.affectedRows, 1);
    const other = await db.query(`update user_profiles set name = 'Curang' where id = $1`, [U.staffB]);
    assert.equal(other.affectedRows, 0, 'tidak bisa mengubah profil orang lain');
  });
  await as(db, U.admin, async () => { await rejects(db.query(`update user_profiles set role = 'staff' where id = $1`, [U.staffA]), 'permission denied'); });
  assert.equal((await db.query(`select role from user_profiles where id = $1`, [U.staffA])).rows[0].role, 'staff');
  assert.equal((await db.query(`select has_column_privilege('anon', 'public.user_profiles', 'role', 'update') as v`)).rows[0].v, false);
});

test('profil: baca milik sendiri, admin membaca semua', async () => {
  const db = await makeDb();
  await as(db, U.staffA, async () => { assert.equal((await db.query(`select count(*)::int as n from user_profiles`)).rows[0].n, 1); });
  await as(db, U.admin, async () => { assert.equal((await db.query(`select count(*)::int as n from user_profiles`)).rows[0].n, 4); });
});

test('hak fungsi: anon tidak bisa menjalankan fungsi sistem; authenticated hanya yang dibutuhkan policy dan RPC', async () => {
  const db = await makeDb();
  const helpers = ['public.ugc_role()', 'public.ugc_is_admin()', 'public.is_admin()'];
  const internal = ['public.ugc_setting_int(text,integer)', 'public.ugc_touch()', 'public.ugc_check_batch_limit()', 'public.ugc_check_job_limit()',
    'public.ugc_guard_job_update()', 'public.ugc_guard_character_insert()', 'public.ugc_guard_character_update()', 'public.ugc_guard_photo_update()', 'public.ugc_rollup_batch()'];
  const rpc = ['public.ugc_enqueue_batch(uuid)', 'public.ugc_claim_next_job(text)', 'public.ugc_review_intro(uuid,boolean,text,text)', 'public.ugc_request_char_task(uuid,text,jsonb)'];
  for (const f of [...helpers, ...internal, ...rpc]) assert.equal(await priv(db, 'anon', f), false, 'anon ' + f);
  for (const f of helpers) assert.equal(await priv(db, 'authenticated', f), true, 'authenticated ' + f);
  for (const f of internal) assert.equal(await priv(db, 'authenticated', f), false, 'authenticated ' + f);
  for (const f of rpc) assert.equal(await priv(db, 'authenticated', f), true, 'authenticated ' + f);
});

test('trigger tetap berjalan untuk pengguna biasa walau hak EXECUTE dicabut', async () => {
  const db = await makeDb();
  let id;
  await as(db, U.staffA, async () => {
    id = (await db.query(`insert into ugc_characters (code, name, created_by) values ('T1', 'Satu', $1) returning id`, [U.staffA])).rows[0].id;
    const before = (await db.query(`select updated_at from ugc_characters where id = $1`, [id])).rows[0].updated_at;
    await new Promise(r => setTimeout(r, 15));
    await db.query(`update ugc_characters set name = 'Satu Baru' where id = $1`, [id]);
    const after = (await db.query(`select updated_at from ugc_characters where id = $1`, [id])).rows[0].updated_at;
    assert.ok(after > before, 'ugc_touch berjalan');
    const e = await rejects(db.query(`update ugc_characters set status = 'ready' where id = $1`, [id]));
    assert.match(String(e.message), /hanya boleh diubah lewat fungsi sistem/, 'penjaga berjalan (bukan "permission denied")');
    const b = await db.query(`insert into ugc_batches (character_id, created_by) values ($1, $2) returning id`, [id, U.staffA]);
    assert.ok(b.rows[0].id, 'trigger batas batch berjalan');
  });
});

test('policy tabel lama: perilaku sama (karakter baca semua/tulis admin, video_jobs milik sendiri atau admin)', async () => {
  const db = await makeDb();
  await as(db, U.staffA, async () => { await rejects(db.query(`insert into characters (name, created_by) values ('X', $1)`, [U.staffA]), 'row-level security'); });
  await as(db, U.admin, async () => { await db.query(`insert into characters (name, created_by) values ('Admin Char', $1)`, [U.admin]); });
  await as(db, U.staffB, async () => { assert.equal((await db.query(`select count(*)::int as n from characters`)).rows[0].n, 1); });
  await as(db, U.staffA, async () => { await db.query(`insert into video_jobs (created_by) values ($1)`, [U.staffA]); });
  await as(db, U.staffB, async () => {
    assert.equal((await db.query(`select count(*)::int as n from video_jobs`)).rows[0].n, 0);
    await rejects(db.query(`insert into video_jobs (created_by) values ($1)`, [U.staffA]), 'row-level security');
  });
  await as(db, U.admin, async () => { assert.equal((await db.query(`select count(*)::int as n from video_jobs`)).rows[0].n, 1); });
  await as(db, U.staffA, async () => { await db.query(`delete from video_jobs where created_by = $1`, [U.staffA]); });
});

test('policy: semua memakai peran authenticated, tanpa tumpang tindih, dan tanpa auth.uid() langsung', async () => {
  const db = await makeDb();
  const pol = (await db.query(`select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public'`)).rows;
  for (const p of pol) {
    assert.deepEqual(p.roles, ['authenticated'], `${p.tablename}.${p.policyname} roles ${p.roles}`);
    for (const expr of [p.qual, p.with_check]) if (expr) assert.ok(!/(?<!select )auth\.uid\(\)/.test(expr.replace(/\( SELECT auth\.uid\(\) AS uid\)/gi, '')), `${p.policyname}: ${expr}`);
  }
  const overlaps = [];
  for (const t of [...new Set(pol.map(p => p.tablename))]) for (const act of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    const n = pol.filter(p => p.tablename === t && (p.cmd === act || p.cmd === 'ALL')).length;
    if (n > 1) overlaps.push(`${t}:${act}=${n}`);
  }
  assert.deepEqual(overlaps, []);
});

test('indeks kunci asing, search_path ugc_touch, dan migrasi dapat diulang', async () => {
  const db = await makeDb();
  const idx = (await db.query(`select indexname from pg_indexes where schemaname = 'public'`)).rows.map(r => r.indexname);
  for (const i of ['ugc_batches_character_idx', 'ugc_batches_created_by_idx', 'ugc_character_photos_created_by_idx', 'ugc_character_tasks_created_by_idx',
    'ugc_characters_created_by_idx', 'ugc_jobs_created_by_idx', 'ugc_jobs_product_idx', 'ugc_products_created_by_idx']) assert.ok(idx.includes(i), i);
  const cfg = (await db.query(`select proconfig from pg_proc where proname = 'ugc_touch'`)).rows[0].proconfig;
  assert.ok(cfg && cfg.some(x => x.startsWith('search_path')));
  const sql = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20261002000400_hardening.sql', import.meta.url)), 'utf8');
  await db.exec(sql); await db.exec(sql);
});

test('pengaman urutan: 0400 tanpa 0300 berhenti dengan pesan jelas', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const sql = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20261002000400_hardening.sql', import.meta.url)), 'utf8');
  await assert.rejects(() => db.exec(sql), /URUTAN SALAH: jalankan 20261002000300/);
});
