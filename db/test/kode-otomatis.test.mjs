// Migrasi 20261007000820 (kode karakter otomatis) pada rantai migrasi LENGKAP dan skema asli.
// Yang BELUM terbukti di sini: konkurensi sungguhan antar koneksi (PGlite satu koneksi); kunci per transaksi adalah mekanisme standar Postgres.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb, as, rejects, U } from './helpers.mjs';

const SQL = readFileSync(new URL('../../supabase/migrations/20261007000820_kode_karakter_otomatis.sql', import.meta.url), 'utf8');
const KODE_WEB = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;   // aturan yang sama dengan website (lib/karakter.js)
const POLA = /^C(\d{2,})-([0-9A-F]{8})$/;
const suara = n => ({ base_voice: `Suara${n}`, accent: 'indonesia_netral' });
// Menyisipkan karakter sebagai pengguna tertentu (RLS berlaku) TANPA kode; kolom wajib lain diisi seperti yang dikirim website.
const buat = (db, uid, nama, kode) => as(db, uid, async () => (await db.query(
  `insert into ugc_characters (${kode === undefined ? '' : 'code, '}name, gender, creation_mode, dna, identity_lock, flow_project_url, flow_account_name, voice, voice_base, status, created_by)
   values (${kode === undefined ? '' : '$5, '}$1, 'perempuan', 'reference', '{"gender":"perempuan"}'::jsonb, 'locked', 'https://flow.google.com/project/x', 'Akun', $2::jsonb, $3, 'draft', $4) returning id, code`,
  kode === undefined ? [nama, JSON.stringify(suara(nama)), `Suara-${nama}`, uid] : [nama, JSON.stringify(suara(nama)), `Suara-${nama}`, uid, kode])).rows[0]);

test('migrasi berjalan dalam rantai lengkap dan aman diulang; karakter yang sudah ada tidak berubah', async () => {
  const db = await makeDb(); await buat(db, U.staffA, 'Lama', 'C02_THE_SOFT_GIRL'); await db.exec(SQL); await db.exec(SQL);
  assert.equal((await db.query(`select code from ugc_characters`)).rows[0].code, 'C02_THE_SOFT_GIRL');
  assert.equal((await db.query(`select count(*)::int n from pg_trigger where tgname = 'ugc_characters_auto_code'`)).rows[0].n, 1, 'satu penjaga saja walau diulang');
});

test('tanpa kode: dibuat otomatis berbentuk C + nomor + - + 8 karakter dari id; lolos aturan website; berurutan; setiap staf', async () => {
  const db = await makeDb(); const hasil = [];
  for (const [uid, nama] of [[U.staffA, 'Satu'], [U.staffB, 'Dua'], [U.staffA, 'Tiga'], [U.admin, 'Empat']]) hasil.push(await buat(db, uid, nama));
  assert.deepEqual(hasil.map(h => Number(POLA.exec(h.code)[1])), [1, 2, 3, 4]); assert.deepEqual(hasil.map(h => h.code.slice(0, 3)), ['C01', 'C02', 'C03', 'C04']);
  for (const h of hasil) { assert.match(h.code, POLA); assert.ok(KODE_WEB.test(h.code), h.code); assert.ok(h.code.length <= 40); assert.equal(POLA.exec(h.code)[2], h.id.replace(/-/g, '').slice(0, 8).toUpperCase(), 'bagian belakang berasal dari id (kunci utama)'); }
  assert.equal(new Set(hasil.map(h => h.code)).size, 4);
});

test('kode lama ikut dihitung: nomor berikutnya = tertinggi + 1; kode yang tidak berpola, huruf kecil, dan angka sangat panjang ditangani', async () => {
  const db = await makeDb();
  await buat(db, U.staffA, 'A', 'C02_THE_SOFT_GIRL'); await buat(db, U.staffA, 'B', 'ABC'); await buat(db, U.staffA, 'C', 'c07_kecil'); await buat(db, U.staffA, 'D', 'C99999999999-X');
  const n = await buat(db, U.staffA, 'E'); assert.match(n.code, /^C08-[0-9A-F]{8}$/, 'c07 (huruf kecil) terhitung, C02 terhitung, ABC dan angka >9 digit diabaikan');
  const baru = await buat(db, U.staffB, 'F'); assert.match(baru.code, /^C09-/);
});

test('nomor di atas 99 tidak dipotong (C100, bukan C10)', async () => {
  const db = await makeDb(); await buat(db, U.staffA, 'X', 'C99_X'); const a = await buat(db, U.staffB, 'Y'); assert.match(a.code, /^C100-[0-9A-F]{8}$/); const b = await buat(db, U.staffA, 'Z'); assert.match(b.code, /^C101-/);
  assert.ok(a.code.length <= 40);
});

test('kode yang diisi dipakai apa adanya (alat laptop); kode kosong atau spasi saja dianggap tidak diisi; spasi di tepi dipangkas; kode kembar tetap ditolak', async () => {
  const db = await makeDb();
  assert.equal((await buat(db, U.staffA, 'K1', 'RUANG_LAPTOP_1')).code, 'RUANG_LAPTOP_1'); assert.equal((await buat(db, U.staffA, 'K2', '  RUANG_2  ')).code, 'RUANG_2');
  for (const kosong of ['', '   ']) assert.match((await buat(db, U.staffB, `K${kosong.length}`, kosong)).code, POLA);
  await rejects(buat(db, U.staffB, 'K9', 'RUANG_LAPTOP_1'), '23505');
});

test('banyak karakter dalam satu transaksi: nomor tidak bentrok dan semua kode unik', async () => {
  const db = await makeDb(); await buat(db, U.staffA, 'Awal');
  await db.exec('begin');
  const kode = []; try { for (let i = 0; i < 20; i++) kode.push((await db.query(
    `insert into ugc_characters (name, gender, creation_mode, dna, identity_lock, flow_project_url, flow_account_name, voice, voice_base, status, created_by)
     values ('N${i}', 'perempuan', 'reference', '{"gender":"perempuan"}'::jsonb, 'locked', 'https://flow.google.com/project/x', 'Akun', '{"base_voice":"S${i}"}'::jsonb, 'Vb${i}', 'draft', $1) returning code`, [U.admin])).rows[0].code); await db.exec('commit'); } catch (e) { await db.exec('rollback'); throw e; }
  assert.equal(new Set(kode).size, 20); assert.deepEqual(kode.map(c => Number(POLA.exec(c)[1])), Array.from({ length: 20 }, (_, i) => i + 2));
});

test('penghitungan melihat SEMUA karakter walau pemanggil hanya boleh membaca sebagian (security definer), dan penjaga tidak bisa dipanggil langsung', async () => {
  const db = await makeDb(); await db.query(`insert into ugc_characters (code, name, gender, creation_mode, dna, identity_lock, flow_project_url, flow_account_name, voice, voice_base, status, created_by) values ('C41_LAMA','Lama','perempuan','reference','{"gender":"perempuan"}'::jsonb,'locked','https://flow.google.com/project/x','Akun','{"base_voice":"V"}'::jsonb,'V0','draft',$1)`, [U.admin]);
  const a = await buat(db, U.staffB, 'Baru'); assert.match(a.code, /^C42-/);
  await rejects(as(db, U.staffA, () => db.query(`select ugc_characters_auto_code()`)), 'permission denied');
});
