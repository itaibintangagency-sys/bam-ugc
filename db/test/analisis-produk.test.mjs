// Migrasi 20261006000810 (analisis foto produk) pada rantai migrasi LENGKAP dan skema asli.
// Yang BELUM terbukti di sini: konkurensi sungguhan (PGlite satu koneksi) dan Supabase sungguhan (peran service_role, Edge Function).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb, as, rejects, U } from './helpers.mjs';

const SQL = readFileSync(new URL('../../supabase/migrations/20261006000810_analisis_produk.sql', import.meta.url), 'utf8');
const SQL_0800 = readFileSync(new URL('../../supabase/migrations/20261006000800_generate_gambar.sql', import.meta.url), 'utf8');
const FROM = () => new Date(Date.now() - 86400000).toISOString(), TO = () => new Date(Date.now() + 86400000).toISOString();
const B = n => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-${n}${n}${n}${n}-${n}${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;
const servis = async (db, fn) => { await db.exec('reset role'); await db.exec('set role service_role'); try { return await fn(); } finally { await db.exec('reset role'); } };
const produk = async (db, nama = 'Daster', user = U.staffA) => (await db.query(`insert into ugc_products (name, created_by, archetype_id) values ($1, $2, 'A-01') returning id`, [nama, user])).rows[0].id;
const sisip = (db, o) => db.query(
  `insert into ugc_image_runs (batch_id, seq, created_by, kind, model, quality, status, cost_usd, kurs_idr, cost_idr, product_id) values ($1,$2,$3,$4,'m',$5,'ok',$6,16500,$7,$8)`,
  [o.batch, o.seq ?? 1, o.user, o.kind, o.quality ?? 'low', o.usd ?? null, o.idr ?? null, o.product ?? null]);
const reserve = (db, id, user, product, limit) => servis(db, async () => (await db.query(`select ugc_analysis_reserve($1,$2,$3,'google/gemini-2.5-flash',$4) r`, [id, user, product, limit])).rows[0].r);
const hitung = (db, user, kinds) => servis(db, async () => (await db.query(`select ugc_run_count_today($1,$2::text[]) n`, [user, kinds])).rows[0].n);

test('migrasi berjalan dalam rantai lengkap, aman diulang, menambah dua pengaturan, dan menerima jenis analisis dengan kualitas na (jenis dan kualitas asing tetap ditolak)', async () => {
  const db = await makeDb(); await db.exec(SQL);
  const set = (await db.query(`select key, value from ugc_settings where key like 'analisis_%' order by 1`)).rows;
  assert.deepEqual(set.map(r => r.key), ['analisis_limit_harian_staf', 'analisis_model']); assert.equal(set[0].value, 30); assert.equal(set[1].value, 'google/gemini-2.5-flash');
  const p = await produk(db); await sisip(db, { batch: B(1), user: U.staffA, kind: 'analisis_produk', quality: 'na', product: p });
  await sisip(db, { batch: B(2), user: U.staffA, kind: 'saran_kategori', quality: 'na', product: p });
  await rejects(sisip(db, { batch: B(3), user: U.staffA, kind: 'video' }), 'check'); await rejects(sisip(db, { batch: B(4), user: U.staffA, kind: 'wajah_dna', quality: 'ultra' }), 'check');
  await sisip(db, { batch: B(5), user: U.staffA, kind: 'wajah_dna', quality: 'high' });
  await db.query(`update ugc_settings set value = '12'::jsonb where key = 'analisis_limit_harian_staf'`); await db.exec(SQL);
  assert.equal((await db.query(`select value from ugc_settings where key = 'analisis_limit_harian_staf'`)).rows[0].value, 12, 'pengaturan yang sudah diubah admin tidak ditimpa saat migrasi diulang');
  // 0800 diulang setelah 0810 tidak boleh gagal; fungsi laporan kembali ke bentuk lama sampai 0810 dijalankan lagi.
  await db.exec(SQL_0800); const kolom = async () => (await as(db, U.admin, () => db.query(`select * from ugc_image_runs_list($1,$2)`, [FROM(), TO()]))).fields.map(f => f.name);
  assert.ok(!(await kolom()).includes('nama_produk')); await db.exec(SQL); assert.ok((await kolom()).includes('nama_produk'), 'menjalankan 0810 lagi memulihkan kolom nama_produk');
  await as(db, U.admin, () => db.query(`select * from ugc_image_runs_list($1,$2)`, [FROM(), TO()])); // hak akses ikut pulih (admin tetap bisa memanggil)
});

test('hitungan harian per jenis: analisis tidak memakan jatah gambar dan sebaliknya; hanya service_role boleh memanggil', async () => {
  const db = await makeDb(); const p = await produk(db);
  for (let i = 1; i <= 3; i++) await sisip(db, { batch: B(i), user: U.staffA, kind: 'analisis_produk', quality: 'na', product: p });
  await sisip(db, { batch: B(7), user: U.staffA, kind: 'wajah_dna', seq: 1 });
  assert.equal(await servis(db, async () => (await db.query(`select ugc_image_count_today($1) n`, [U.staffA])).rows[0].n), 1, 'jatah gambar hanya menghitung gambar');
  assert.equal(await hitung(db, U.staffA, ['analisis_produk']), 3); assert.equal(await hitung(db, U.staffA, ['analisis_produk', 'wajah_dna']), 4); assert.equal(await hitung(db, U.staffA, []), 0);
  const e = await rejects(as(db, U.staffA, () => db.query(`select ugc_run_count_today($1, array['wajah_dna'])`, [U.staffA])), 'permission denied'); assert.ok(e);
  await rejects(as(db, U.staffA, () => db.query(`select ugc_image_count_today($1)`, [U.staffA])), 'permission denied');
});

test('pemesanan jatah analisis: di bawah batas ok, tepat di batas ditolak tanpa baris, tanpa batas (admin) ok; baris berisi jenis, kualitas na, produk, dan batch sendiri; terpisah dari batas gambar; staf tidak bisa memanggil', async () => {
  const db = await makeDb(); const p = await produk(db); const R = i => `aaaaaaaa-0000-0000-0000-00000000000${i}`;
  assert.equal(await reserve(db, R(1), U.staffA, p, 2), 'ok'); assert.equal(await reserve(db, R(2), U.staffA, p, 2), 'ok');
  assert.equal(await reserve(db, R(3), U.staffA, p, 2), 'batas'); assert.equal((await db.query(`select count(*)::int n from ugc_image_runs where id = $1`, [R(3)])).rows[0].n, 0, 'penolakan tidak meninggalkan baris');
  const r = (await db.query(`select kind, quality, status, product_id, seq, created_by, batch_id from ugc_image_runs where id = $1`, [R(1)])).rows[0];
  assert.deepEqual({ kind: r.kind, quality: r.quality, status: r.status, product_id: r.product_id, seq: r.seq, created_by: r.created_by }, { kind: 'analisis_produk', quality: 'na', status: 'running', product_id: p, seq: 1, created_by: U.staffA });
  const batch = (await db.query(`select distinct batch_id from ugc_image_runs where kind = 'analisis_produk'`)).rows; assert.equal(batch.length, 2, 'tiap analisis punya batch sendiri');
  assert.equal(await reserve(db, R(4), U.staffA, p, null), 'ok', 'admin tanpa batas');
  assert.equal(await servis(db, async () => (await db.query(`select ugc_image_reserve($1,$2,1,$3,'wajah_dna','m','low','3:4',null,null,'{}'::jsonb,null,1) r`, ['bbbbbbbb-0000-0000-0000-000000000001', B(9), U.staffA])).rows[0].r), 'ok', 'jatah gambar tidak terpengaruh oleh analisis');
  assert.equal(await reserve(db, R(5), U.staffB, p, 2), 'ok', 'staf lain punya hitungan sendiri');
  await rejects(as(db, U.staffA, () => db.query(`select ugc_analysis_reserve(gen_random_uuid(), $1, $2, 'm', null)`, [U.staffA, p])), 'permission denied');
});

test('produk dihapus: riwayat biaya tetap ada (product_id jadi kosong); laporan menampilkan nama produk dan kode karakter; staf ditolak; ringkasan biaya mencakup analisis', async () => {
  const db = await makeDb(); const p1 = await produk(db, 'Daster floral'), p2 = await produk(db, 'Serum');
  await sisip(db, { batch: B(1), user: U.staffA, kind: 'analisis_produk', quality: 'na', product: p1, usd: 0.004, idr: 66 });
  await sisip(db, { batch: B(2), user: U.staffA, kind: 'analisis_produk', quality: 'na', product: p2, usd: 0.006, idr: 99 });
  await sisip(db, { batch: B(3), user: U.staffA, kind: 'wajah_dna', usd: 0.03, idr: 495 });
  let r = (await as(db, U.admin, () => db.query(`select jenis, kualitas, nama_produk, kode_karakter, total from ugc_image_runs_list($1,$2) order by nama_produk nulls last`, [FROM(), TO()]))).rows;
  assert.deepEqual(r.map(x => [x.jenis, x.kualitas, x.nama_produk]), [['analisis_produk', 'na', 'Daster floral'], ['analisis_produk', 'na', 'Serum'], ['wajah_dna', 'low', null]]); assert.equal(Number(r[0].total), 3);
  r = (await as(db, U.admin, () => db.query(`select jenis from ugc_image_runs_list($1,$2,null,'analisis_produk')`, [FROM(), TO()]))).rows; assert.equal(r.length, 2, 'filter jenis analisis');
  const s = (await as(db, U.admin, () => db.query(`select gambar, usd, idr from ugc_image_cost_summary($1,$2)`, [FROM(), TO()]))).rows[0]; assert.equal(Number(s.gambar), 3); assert.equal(Number(s.usd), 0.04); assert.equal(Number(s.idr), 660);
  await rejects(as(db, U.staffA, () => db.query(`select * from ugc_image_runs_list($1,$2)`, [FROM(), TO()])), 'khusus admin');
  await db.query(`delete from ugc_products where id = $1`, [p1]);
  r = (await as(db, U.admin, () => db.query(`select nama_produk from ugc_image_runs_list($1,$2,null,'analisis_produk') order by nama_produk nulls first`, [FROM(), TO()]))).rows;
  assert.deepEqual(r.map(x => x.nama_produk), [null, 'Serum']); assert.equal((await db.query(`select count(*)::int n from ugc_image_runs`)).rows[0].n, 3, 'riwayat biaya tidak ikut terhapus');
  assert.equal(Number((await as(db, U.staffA, () => db.query(`select count(*) from ugc_image_runs`))).rows[0].count), 0, 'staf tidak melihat satu baris riwayat pun');
});
