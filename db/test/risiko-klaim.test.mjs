// Pengujian migrasi 20261005000720 (Opsi B: 9 kategori klaim kesehatan berisiko tinggi, di atas 5 kategori bayi dari 0710).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb, as, rejects, U } from './helpers.mjs';

const SQL_0720 = readFileSync(new URL('../../supabase/migrations/20261005000720_risiko_klaim_kesehatan.sql', import.meta.url), 'utf8');
const URL_OK = 'https://flow.google.com/project/abc-123';
const K = {
  jerawat: 'Perawatan & Kecantikan > Perawatan Wajah > Treatment Jerawat',           // A-05 sedang, dinaikkan 0720
  purifier: 'Elektronik > Peralatan Listrik Kecil > Purifier & Humidifier',            // A-11 rendah, dinaikkan 0720
  bayi_kulit: 'Ibu & Bayi > Kesehatan Bayi > Perawatan Kulit Bayi',                     // dinaikkan sejak 0710
  pelembab: 'Perawatan & Kecantikan > Perawatan Wajah > Pelembab Wajah',                // A-05 sedang, tetap sedang
  anak_dress: 'Fashion Bayi & Anak > Pakaian Anak Perempuan > Dress',                   // A-09 sedang, SENGAJA tidak dinaikkan
  bayi_makan: 'Ibu & Bayi > Perlengkapan Makan Bayi > Peralatan Makan',                 // A-09 sedang, SENGAJA tidak dinaikkan
  bantal: 'Perlengkapan Rumah > Kamar Tidur > Bantal'                                   // A-12 rendah
};

async function ready(db) {
  const id = await as(db, U.staffA, async () => (await db.query(`insert into ugc_characters (code, name, creation_mode, flow_project_url, voice_base, status, created_by)
    values ('C02', 'N', 'reference', $1, 'Achernar', 'voice_defined', $2) returning id`, [URL_OK, U.staffA])).rows[0].id);
  await as(db, U.admin, async () => { await db.query(`select ugc_admin_mark_ready($1, 'uji opsi B')`, [id]); });
  return id;
}
const batch = (db, cid) => as(db, U.staffA, async () => (await db.query(
  `insert into ugc_batches (character_id, resolution, duration_sec, location_mode, status, created_by) values ($1, '360p', 10, 'auto', 'approved', $2) returning id`, [cid, U.staffA])).rows[0].id);
async function job(db, bid, category, seq = 1) {
  return as(db, U.staffA, async () => {
    const p = (await db.query(`insert into ugc_products (name, status, archetype_id, category_key, created_by) values ('P', 'draft', null, $1, $2) returning id, archetype_id, risk_level`, [category, U.staffA])).rows[0];
    const j = (await db.query(`insert into ugc_jobs (batch_id, product_id, seq, status, storyboard_path, video_json, panel_plan, created_by) values ($1,$2,$3,'approved','x/y.png','{}',null,$4) returning id`, [bid, p.id, seq, U.staffA])).rows[0].id;
    return { id: j, product: p };
  });
}
const enqueue = (db, bid) => as(db, U.staffA, async () => (await db.query(`select ugc_enqueue_batch($1) as n`, [bid])).rows[0].n);

test('0720: 14 kategori dinaikkan lewat override (5 dari 0710 dan 9 baru); berisiko tinggi efektif = 24', async () => {
  const db = await makeDb();
  assert.equal((await db.query(`select count(*)::int n from ugc_category_map where risiko_override = 'tinggi'`)).rows[0].n, 14);
  const efektif = (await db.query(`select count(*)::int n from ugc_category_map m join ugc_archetypes a on a.id = m.archetype_id where a.risk_level = 'tinggi' or m.risiko_override = 'tinggi'`)).rows[0].n;
  assert.equal(efektif, 24);
  const salah = (await db.query(`select count(*)::int n from ugc_category_map m join ugc_archetypes a on a.id = m.archetype_id where a.risk_level = 'tinggi' and m.risiko_override is not null`)).rows[0].n;
  assert.equal(salah, 0, 'override tidak dipakai pada kategori yang arketipenya sudah tinggi');
  const baru = (await db.query(`select category_key from ugc_category_map where risiko_override = 'tinggi' and category_key not like 'Ibu & Bayi >%'`)).rows.length;
  assert.equal(baru, 9, 'sembilan kategori baru semuanya di luar Ibu & Bayi');
});

test('0720: produk kategori klaim kesehatan berisiko tinggi dan tidak bisa diturunkan staf; kategori anak dan lainnya tidak berubah', async () => {
  const db = await makeDb(); const cid = await ready(db); const b = await batch(db, cid);
  const j = await job(db, b, K.jerawat);
  assert.equal(j.product.archetype_id, 'A-05'); assert.equal(j.product.risk_level, 'tinggi');
  assert.equal((await job(db, b, K.purifier, 2)).product.risk_level, 'tinggi');
  assert.equal((await job(db, b, K.bayi_kulit, 3)).product.risk_level, 'tinggi', 'dari 0710');
  assert.equal((await job(db, b, K.pelembab, 4)).product.risk_level, 'sedang');
  assert.equal((await job(db, b, K.anak_dress, 5)).product.risk_level, 'sedang', 'anak saja: sengaja tidak dinaikkan');
  assert.equal((await job(db, b, K.bayi_makan, 6)).product.risk_level, 'sedang', 'anak saja: sengaja tidak dinaikkan');
  assert.equal((await job(db, b, K.bantal, 7)).product.risk_level, 'rendah');
  await as(db, U.staffA, async () => {
    await db.query(`update ugc_products set risk_level = 'rendah' where id = $1`, [j.product.id]);
    assert.equal((await db.query(`select risk_level from ugc_products where id = $1`, [j.product.id])).rows[0].risk_level, 'tinggi');
    await db.query(`update ugc_products set category_key = $2, risk_level = 'sedang' where id = $1`, [j.product.id, K.pelembab]);
    assert.equal((await db.query(`select risk_level from ugc_products where id = $1`, [j.product.id])).rows[0].risk_level, 'tinggi', 'jalan memutar (ganti kategori lalu turunkan) tidak berhasil');
  });
});

test('0720: gerbang antrean menahan kategori klaim kesehatan sampai admin menyetujui; kategori anak dan biasa lolos', async () => {
  const db = await makeDb(); const cid = await ready(db);
  const b1 = await batch(db, cid); const j1 = await job(db, b1, K.jerawat);
  await rejects(enqueue(db, b1), 'berisiko tinggi menunggu persetujuan admin');
  await as(db, U.admin, async () => { await db.query(`select ugc_approve_risk($1, 'diperiksa')`, [j1.id]); });
  assert.equal(await enqueue(db, b1), 1);
  const b2 = await batch(db, cid); await job(db, b2, K.pelembab);
  assert.equal(await enqueue(db, b2), 1, 'kategori biasa tidak butuh persetujuan');
  const b3 = await batch(db, cid); await job(db, b3, K.anak_dress);
  assert.equal(await enqueue(db, b3), 1, 'produk anak saja tidak butuh persetujuan pada Opsi B');
  const b4 = await batch(db, cid); await job(db, b4, K.purifier);
  await rejects(enqueue(db, b4), 'berisiko tinggi menunggu persetujuan admin');
});

test('0720: berjalan ulang tanpa galat; ditolak dengan pesan jelas tanpa 0710', async () => {
  const db = await makeDb(); await db.exec(SQL_0720); await db.exec(SQL_0720);
  assert.equal((await db.query(`select count(*)::int n from ugc_category_map where risiko_override = 'tinggi'`)).rows[0].n, 14);
  const lama = await makeDb({ upTo: '20261005000700' });
  await rejects(lama.exec(SQL_0720), 'URUTAN SALAH');
});

test('0720: bila pemetaan kategori berbeda dari perkiraan, berhenti dengan pesan jelas (tidak menaikkan sebagian)', async () => {
  const db = await makeDb({ upTo: '20261005000710' });
  await db.query(`delete from ugc_category_map where category_key = $1`, [K.jerawat]);
  await rejects(db.exec(SQL_0720), 'diharapkan 9 kategori');
});

test('0720: pencabutan kebijakan (override dikosongkan) mengembalikan kategori ke risiko arketipe', async () => {
  const db = await makeDb();
  await as(db, U.admin, async () => { await db.query(`update ugc_category_map set risiko_override = null where category_key = $1`, [K.jerawat]); });
  const cid = await ready(db); const b = await batch(db, cid);
  assert.equal((await job(db, b, K.jerawat)).product.risk_level, 'sedang');
});
