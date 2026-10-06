// Pengujian migrasi 20261006000800 (riwayat generate gambar) terhadap rantai migrasi LENGKAP dan skema asli (ugc_role, ugc_is_admin, RLS).
// Yang BELUM terbukti di sini: konkurensi sungguhan (PGlite satu koneksi) dan Supabase sungguhan (peran service_role, Edge Function).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb, as, rejects, U } from './helpers.mjs';

const SQL = readFileSync(new URL('../../supabase/migrations/20261006000800_generate_gambar.sql', import.meta.url), 'utf8');
const B = { 1: '11111111-1111-1111-1111-111111111111', 2: '22222222-2222-2222-2222-222222222222', 3: '33333333-3333-3333-3333-333333333333', 4: '44444444-4444-4444-4444-444444444444' };
const R = i => `aaaaaaaa-0000-0000-0000-00000000000${i}`;
const FROM = () => new Date(Date.now() - 86400000).toISOString(), TO = () => new Date(Date.now() + 86400000).toISOString();

// service_role melewati RLS di Supabase; di sini meniru dengan peran yang punya BYPASSRLS.
async function servis(db, fn) { await db.exec('reset role'); await db.exec('set role service_role'); try { return await fn(); } finally { await db.exec('reset role'); } }
const sisip = (db, id, batch, seq, user, kind, status, usd, idr, ago = '0 minutes') => db.query(
  `insert into ugc_image_runs (id, batch_id, seq, created_by, kind, model, quality, status, cost_usd, kurs_idr, cost_idr, created_at)
   values ($1,$2,$3,$4,$5,'openai/gpt-image-2','low',$6,$7,16500,$8, now() - $9::interval)`, [id, batch, seq, user, kind, status, usd, idr, ago]);
const reserve = (db, id, batch, seq, user, limit) => servis(db, async () => (await db.query(
  `select ugc_image_reserve($1,$2,$3,$4,'wajah_dna','openai/gpt-image-2','low','3:4',null,null,'{"gender":"perempuan"}'::jsonb,null,$5) r`, [id, batch, seq, user, limit])).rows[0].r);

async function siap() {
  const db = await makeDb();
  await sisip(db, R(1), B[1], 1, U.staffA, 'wajah_dna', 'ok', 0.03, 495);
  await sisip(db, R(2), B[1], 2, U.staffA, 'wajah_dna', 'ok', 0.03, 495);
  await sisip(db, R(3), B[1], 3, U.staffA, 'wajah_dna', 'gagal', null, null);
  await sisip(db, R(4), B[2], 1, U.staffB, 'wajah_acuan', 'ok', null, null);                       // biaya tidak dilaporkan
  await sisip(db, R(5), B[2], 2, U.staffB, 'wajah_acuan', 'running', null, null, '30 minutes');   // tersangkut
  return db;
}

test('migrasi berjalan dalam rantai lengkap, aman diulang, dan menambah tiga pengaturan bawaan', async () => {
  const db = await makeDb();
  await db.exec(SQL);   // kedua kalinya
  const k = (await db.query(`select key from ugc_settings where key like 'gen_%' order by 1`)).rows.map(r => r.key);
  assert.deepEqual(k, ['gen_daily_limit_staff', 'gen_max_per_click', 'gen_model']);
  const t = (await db.query(`select to_regclass('public.ugc_image_runs') as t`)).rows[0].t; assert.ok(t);
});

test('hak akses: HANYA admin membaca; tidak ada yang bisa menulis dari browser; anon tidak bisa apa pun', async () => {
  const db = await siap();
  assert.equal((await as(db, U.admin, () => db.query('select count(*)::int n from ugc_image_runs'))).rows[0].n, 5);
  for (const u of [U.staffA, U.staffB, U.agent]) assert.equal((await as(db, u, () => db.query('select count(*)::int n from ugc_image_runs'))).rows[0].n, 0, 'selain admin tidak melihat satu baris pun');
  for (const u of [U.staffA, U.admin]) {
    await rejects(as(db, u, () => db.query(`insert into ugc_image_runs (batch_id, created_by, kind, model, quality) values ('${B[1]}', '${u}', 'wajah_dna', 'm', 'low')`)), 'permission denied');
    await rejects(as(db, u, () => db.query(`update ugc_image_runs set cost_usd = 0`)), 'permission denied');
    await rejects(as(db, u, () => db.query(`delete from ugc_image_runs`)), 'permission denied');
  }
  await db.exec('reset role'); await db.exec('set role anon'); await rejects(db.query('select * from ugc_image_runs'), 'permission denied'); await db.exec('reset role');
});

test('ringkasan biaya per orang: hanya admin, hitungan benar, baris running lama dihitung gagal, biaya tak terlapor terhitung, urut biaya terbesar', async () => {
  const db = await siap();
  const r = await as(db, U.admin, () => db.query('select * from ugc_image_cost_summary($1,$2)', [FROM(), TO()]));
  const per = Object.fromEntries(r.rows.map(x => [x.uid, x]));
  const a = per[U.staffA], b = per[U.staffB];
  assert.deepEqual([Number(a.gambar), Number(a.gagal), Number(a.usd), Number(a.idr), Number(a.tanpa_biaya)], [2, 1, 0.06, 990, 0]);
  assert.deepEqual([Number(b.gambar), Number(b.gagal), Number(b.usd), Number(b.idr), Number(b.tanpa_biaya)], [1, 1, 0, 0, 1], 'satu ok tanpa biaya, satu running >10 menit = gagal');
  assert.equal(r.rows[0].uid, U.staffA, 'diurut biaya terbesar dulu');
  assert.equal((await as(db, U.admin, () => db.query('select * from ugc_image_cost_summary($1,$2)', [new Date(Date.now() + 3600000).toISOString(), TO()]))).rows.length, 0);
  for (const u of [U.staffA, U.agent]) await rejects(as(db, u, () => db.query('select * from ugc_image_cost_summary($1,$2)', [FROM(), TO()])), 'khusus admin');
});

test('daftar riwayat: hanya admin; total, filter orang dan jenis, halaman, dan batas baris; baris running lama tampil gagal dengan penjelasan', async () => {
  const db = await siap(); const q = (sql, p) => as(db, U.admin, () => db.query(sql, p));
  let r = await q('select * from ugc_image_runs_list($1,$2)', [FROM(), TO()]); assert.equal(r.rows.length, 5); assert.equal(Number(r.rows[0].total), 5);
  const lama = r.rows.find(x => x.id === R(5)); assert.equal(lama.status, 'gagal'); assert.match(lama.galat, /Tidak selesai/);
  r = await q('select * from ugc_image_runs_list($1,$2,$3)', [FROM(), TO(), U.staffA]); assert.equal(r.rows.length, 3); assert.ok(r.rows.every(x => x.uid === U.staffA));
  r = await q('select * from ugc_image_runs_list($1,$2,null,$3)', [FROM(), TO(), 'wajah_acuan']); assert.equal(r.rows.length, 2);
  r = await q('select * from ugc_image_runs_list($1,$2,null,null,2,0)', [FROM(), TO()]); assert.equal(r.rows.length, 2); assert.equal(Number(r.rows[0].total), 5);
  r = await q('select * from ugc_image_runs_list($1,$2,null,null,2,4)', [FROM(), TO()]); assert.equal(r.rows.length, 1, 'offset 4 dari 5 baris');
  r = await q('select * from ugc_image_runs_list($1,$2,null,null,100000,0)', [FROM(), TO()]); assert.equal(r.rows.length, 5);
  for (const u of [U.staffA, U.agent]) await rejects(as(db, u, () => db.query('select * from ugc_image_runs_list($1,$2)', [FROM(), TO()])), 'khusus admin');
});

test('hitungan harian (service_role): hanya ok dan running baru yang dihitung; kemarin dan running lama tidak; staf tidak bisa memanggilnya', async () => {
  const db = await siap(); const n = u => servis(db, async () => (await db.query('select ugc_image_count_today($1) n', [u])).rows[0].n);
  assert.equal(await n(U.staffA), 2, 'gagal tidak dihitung'); assert.equal(await n(U.staffB), 1, 'running >10 menit tidak dihitung; ok tanpa biaya dihitung');
  await sisip(db, R(6), B[2], 3, U.staffB, 'wajah_acuan', 'running', null, null, '1 minutes'); assert.equal(await n(U.staffB), 2, 'running baru dihitung');
  await sisip(db, R(7), B[2], 4, U.staffB, 'wajah_acuan', 'ok', 0.01, 100, '30 hours'); assert.equal(await n(U.staffB), 2, 'kemarin tidak dihitung');
  await rejects(as(db, U.staffA, () => db.query('select ugc_image_count_today($1)', [U.staffA])), 'permission denied');
});

test('pemesanan atomik: di bawah batas ok, tepat di batas ditolak tanpa baris, nomor kembar duplikat, tanpa batas (admin) ok; staf tidak bisa memanggil langsung', async () => {
  const db = await siap();   // staffB sudah punya 1 gambar hari ini
  assert.equal(await reserve(db, 'bbbbbbbb-0000-0000-0000-000000000001', B[3], 1, U.staffB, 2), 'ok');
  assert.equal(await reserve(db, 'bbbbbbbb-0000-0000-0000-000000000002', B[3], 2, U.staffB, 2), 'batas');
  assert.equal((await db.query('select count(*)::int n from ugc_image_runs where batch_id = $1', [B[3]])).rows[0].n, 1, 'penolakan tidak meninggalkan baris');
  assert.equal(await reserve(db, 'bbbbbbbb-0000-0000-0000-000000000003', B[3], 1, U.staffB, null), 'duplikat');
  assert.equal(await reserve(db, 'bbbbbbbb-0000-0000-0000-000000000004', B[3], 3, U.staffB, null), 'ok', 'batas kosong = tanpa batas');
  const paralel = await Promise.all([1, 2, 3, 4].map(i => reserve(db, `cccccccc-0000-0000-0000-00000000000${i}`, B[4], i, U.staffA, 4)));
  assert.equal(paralel.filter(x => x === 'ok').length, 2, 'staffA sudah 2 gambar, batas 4 -> tepat 2 dari 4 permintaan lolos');
  await rejects(as(db, U.staffA, () => db.query(`select ugc_image_reserve(gen_random_uuid(), gen_random_uuid(), 1, '${U.staffA}', 'wajah_dna','m','low',null,null,null,null,null,null)`)), 'permission denied');
});

test('menautkan ke karakter: hanya pemilik atau admin, hanya gambar berhasil, karakter harus ada; seluruh kelompok ditautkan, hanya yang dipilih bertanda; hapus karakter tidak menghapus riwayat', async () => {
  const db = await siap();
  const char = (await db.query(`insert into ugc_characters (code, name, created_by) values ('C02', 'Nadia', $1) returning id`, [U.staffA])).rows[0].id;   // data uji disisipkan sebagai superuser
  await rejects(as(db, U.staffB, () => db.query('select ugc_image_link($1,$2)', [R(1), char])), 'Bukan gambar milik Anda');
  await rejects(as(db, U.staffA, () => db.query('select ugc_image_link($1,$2)', [R(3), char])), 'berhasil');
  await rejects(as(db, U.staffA, () => db.query('select ugc_image_link($1,$2)', [R(1), '99999999-9999-9999-9999-999999999999'])), 'Karakter tidak ditemukan');
  await rejects(as(db, U.staffA, () => db.query('select ugc_image_link($1,$2)', ['99999999-9999-9999-9999-999999999999', char])), 'tidak ditemukan');
  await as(db, U.staffA, () => db.query('select ugc_image_link($1,$2)', [R(2), char]));
  const r = await db.query('select character_id, chosen from ugc_image_runs where batch_id = $1 order by seq', [B[1]]);
  assert.ok(r.rows.every(x => x.character_id === char)); assert.deepEqual(r.rows.map(x => x.chosen), [false, true, false]);
  const l = await as(db, U.admin, () => db.query('select kode_karakter, dipilih from ugc_image_runs_list($1,$2,$3) where id = $4', [FROM(), TO(), U.staffA, R(2)])); assert.deepEqual([l.rows[0].kode_karakter, l.rows[0].dipilih], ['C02', true]);
  await as(db, U.admin, () => db.query('select ugc_image_link($1,$2)', [R(1), char]));   // admin boleh menautkan gambar milik staf
  await rejects(as(db, U.agent, () => db.query('select ugc_image_link($1,$2)', [R(1), char])), 'Bukan gambar milik Anda');   // agent bukan pemilik dan bukan admin
  await db.exec(`delete from ugc_characters where id = '${char}'`);
  assert.equal((await db.query('select count(*)::int n from ugc_image_runs')).rows[0].n, 5, 'riwayat biaya tetap ada'); assert.equal((await db.query('select count(*)::int n from ugc_image_runs where character_id is not null')).rows[0].n, 0);
});

test('batasan data: jenis dan kualitas tidak dikenal ditolak; nomor 9 ditolak', async () => {
  const db = await makeDb();
  const ins = (kind, quality, seq = 1) => db.query(`insert into ugc_image_runs (batch_id, seq, created_by, kind, model, quality) values ('${B[1]}', ${seq}, '${U.staffA}', '${kind}', 'm', '${quality}')`);
  await rejects(ins('video', 'low'), 'check'); await rejects(ins('wajah_dna', 'ultra'), 'check'); await rejects(ins('wajah_dna', 'low', 9), 'check'); await ins('wajah_dna', 'high');
});
