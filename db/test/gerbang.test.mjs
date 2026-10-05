// Pengujian migrasi 20261005000700 (gerbang antrean dan risiko tinggi) dan 20261005000710 (risiko tingkat kategori).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb, as, rejects, U } from './helpers.mjs';

const mig = n => readFileSync(new URL(`../../supabase/migrations/${n}`, import.meta.url), 'utf8');
const SQL_0700 = mig('20261005000700_gerbang_risiko.sql'), SQL_0710 = mig('20261005000710_risiko_kategori.sql');
const URL_OK = 'https://flow.google.com/project/abc-123';
const BAYI_TINGGI = 'Ibu & Bayi > Kesehatan Bayi > Perawatan Kulit Bayi';          // A-09 sedang, dinaikkan oleh 0710
const BAYI_BIASA = 'Ibu & Bayi > Perlengkapan Makan Bayi > Peralatan Makan';        // A-09 sedang, tetap sedang

// Karakter siap (milik staf A, ditandai siap oleh admin).
async function ready(db) {
  const id = await as(db, U.staffA, async () => (await db.query(`insert into ugc_characters (code, name, creation_mode, flow_project_url, voice_base, status, created_by)
    values ('C02', 'N', 'reference', $1, 'Achernar', 'voice_defined', $2) returning id`, [URL_OK, U.staffA])).rows[0].id);
  await as(db, U.admin, async () => { await db.query(`select ugc_admin_mark_ready($1, 'uji gerbang risiko tinggi')`, [id]); });
  return id;
}
const batch = (db, cid, uid = U.staffA, status = 'approved') => as(db, uid, async () => (await db.query(
  `insert into ugc_batches (character_id, resolution, duration_sec, location_mode, status, created_by) values ($1, '360p', 10, 'auto', $2, $3) returning id`, [cid, status, uid])).rows[0].id);
// Produk dan job oleh staf A. arch/category menentukan risiko; panel mengisi panel_plan.
async function job(db, bid, { arch = 'A-01', category = null, panel = null, seq = 1, status = 'approved', extra = {} } = {}) {
  return as(db, U.staffA, async () => {
    const p = (await db.query(`insert into ugc_products (name, status, archetype_id, category_key, created_by) values ('P', 'draft', $1, $2, $3) returning id, archetype_id, risk_level`, [arch, category, U.staffA])).rows[0];
    const cols = ['batch_id', 'product_id', 'seq', 'status', 'storyboard_path', 'video_json', 'panel_plan', 'created_by', ...Object.keys(extra)];
    const vals = [bid, p.id, seq, status, 'x/y.png', '{}', panel === null ? null : JSON.stringify(panel), U.staffA, ...Object.values(extra)];
    const j = (await db.query(`insert into ugc_jobs (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning id`, vals)).rows[0].id;
    return { id: j, product: p };
  });
}
const enqueue = (db, bid, uid = U.staffA) => as(db, uid, async () => (await db.query(`select ugc_enqueue_batch($1) as n`, [bid])).rows[0].n);

// ───────────── 0700: antrean tidak bisa dilewati ─────────────
test('0700: batch baru oleh staf tidak boleh langsung queued/running; draft, storyboards_ready, approved boleh; admin boleh apa saja', async () => {
  const db = await makeDb(); const cid = await ready(db);
  for (const s of ['queued', 'running', 'done']) await rejects(batch(db, cid, U.staffA, s), '42501');
  for (const s of ['draft', 'storyboards_ready', 'approved']) await batch(db, cid, U.staffA, s);
  await batch(db, cid, U.admin, 'queued');
  await as(db, U.staffA, async () => { await rejects(db.query(`insert into ugc_batches (character_id, resolution, duration_sec, location_mode, status, created_by, started_at) values ($1,'360p',10,'auto','draft',$2, now())`, [cid, U.staffA]), '42501'); });
});

test('0700: job baru oleh staf tidak boleh queued/running, tanpa persetujuan palsu, tanpa kolom sistem; agent tidak bisa mengklaim job palsu', async () => {
  const db = await makeDb(); const cid = await ready(db); const b = await batch(db, cid);
  for (const s of ['queued', 'running', 'downloaded', 'done']) await rejects(job(db, b, { status: s }), '42501');
  await rejects(job(db, b, { extra: { risk_approved_by: U.admin } }), 'persetujuan risiko hanya oleh admin');
  await rejects(job(db, b, { extra: { flow_asset_url: 'https://contoh.com/x' } }), 'kolom sistem');
  await rejects(job(db, b, { extra: { attempts: 1 } }), 'kolom sistem');
  await rejects(job(db, b, { extra: { claimed_by: 'laptop-1' } }), 'kolom sistem');
  await job(db, b, { seq: 1 });                                         // job biasa tetap boleh
  await as(db, U.agent, async () => { assert.equal((await db.query(`select ugc_claim_next_job('laptop-1') as j`)).rows[0].j, null, 'tidak ada job yang bisa diklaim'); });
  // admin boleh menyisipkan job berstatus apa pun (jalur uji dan perbaikan)
  await as(db, U.admin, async () => {
    const p = (await db.query(`insert into ugc_products (name, status, archetype_id, created_by) values ('PA','draft','A-01',$1) returning id`, [U.admin])).rows[0].id;
    await db.query(`insert into ugc_jobs (batch_id, product_id, seq, status, storyboard_path, video_json, created_by) values ($1,$2,2,'queued','x.png','{}',$3)`, [b, p, U.admin]);
  });
});

test('0700: staf tidak bisa mengubah flow_asset_url, attempts, claimed_by, credits, not_before pada job; admin dan fungsi sistem bisa', async () => {
  const db = await makeDb(); const cid = await ready(db); const b = await batch(db, cid); const j = await job(db, b);
  for (const [col, val] of [['flow_asset_url', 'https://flow.google.com/x'], ['attempts', 5], ['claimed_by', 'laptop-1'], ['credits_observed', 7], ['not_before', '2030-01-01']]) {
    await as(db, U.staffA, async () => { await rejects(db.query(`update ugc_jobs set ${col} = $2 where id = $1`, [j.id, val]), '42501'); });
  }
  await as(db, U.staffA, async () => { await db.query(`update ugc_jobs set video_json = '{"a":1}' where id = $1`, [j.id]); });   // kolom biasa tetap boleh
  await as(db, U.admin, async () => { await db.query(`update ugc_jobs set flow_asset_url = 'https://flow.google.com/x' where id = $1`, [j.id]); });
  // fungsi sistem tetap jalan: enqueue → claim → progress (menulis flow_asset_url, attempts, claimed_by)
  assert.equal(await enqueue(db, b), 1);
  const c = await as(db, U.agent, async () => (await db.query(`select ugc_claim_next_job('laptop-1') as j`)).rows[0].j);
  assert.equal(c.job_id, j.id);
  await as(db, U.agent, async () => { await db.query(`select ugc_job_progress($1, 'running', '{"flow_asset_url":"https://flow.google.com/y"}'::jsonb, null)`, [j.id]); });
  await as(db, U.agent, async () => { assert.equal((await db.query(`select ugc_requeue_own('laptop-1') as n`)).rows[0].n, 1); });
});

test('0700: gerbang risiko tinggi membaca PRODUK, bukan panel_plan: menulis false atau mengosongkannya tidak membantu', async () => {
  const db = await makeDb(); const cid = await ready(db);
  for (const [arch, panel] of [['A-07', { needs_human_approval: false }], ['A-15', null], ['A-07', {}], ['A-15', { needs_human_approval: true }]]) {
    const b = await batch(db, cid); await job(db, b, { arch, panel });
    await rejects(enqueue(db, b), 'berisiko tinggi menunggu persetujuan admin');
  }
  const b2 = await batch(db, cid); await job(db, b2, { arch: 'A-01' });
  assert.equal(await enqueue(db, b2), 1, 'produk berisiko rendah tanpa persetujuan lolos');
  const b3 = await batch(db, cid); await job(db, b3, { arch: 'A-01', panel: { needs_human_approval: true } });
  await rejects(enqueue(db, b3), 'berisiko tinggi', 'penanda panel_plan tetap dihormati sebagai tambahan');
});

test('0700: persetujuan admin lewat ugc_approve_risk: hanya admin, hanya sebelum antrean, tercatat; sesudahnya batch boleh masuk', async () => {
  const db = await makeDb(); const cid = await ready(db); const b = await batch(db, cid); const j = await job(db, b, { arch: 'A-07' });
  await as(db, U.staffA, async () => { await rejects(db.query(`select ugc_approve_risk($1, 'saya sendiri')`, [j.id]), 'khusus admin'); });
  await as(db, U.staffA, async () => { await rejects(db.query(`update ugc_jobs set risk_approved_by = $2 where id = $1`, [j.id, U.staffA]), '42501'); });
  await rejects(enqueue(db, b), 'menunggu persetujuan admin');
  await as(db, U.admin, async () => { await db.query(`select ugc_approve_risk($1, 'dokumen izin edar sudah diperiksa')`, [j.id]); });
  await db.exec('reset role');
  assert.equal((await db.query(`select risk_approved_by from ugc_jobs where id = $1`, [j.id])).rows[0].risk_approved_by, U.admin);
  const ev = (await db.query(`select message from ugc_job_events where job_id = $1 and step = 'risk_approved'`, [j.id])).rows;
  assert.equal(ev.length, 1); assert.match(ev[0].message, /izin edar/);
  assert.equal(await enqueue(db, b), 1);
  await as(db, U.admin, async () => { await rejects(db.query(`select ugc_approve_risk($1)`, [j.id]), 'persetujuan risiko hanya sebelum masuk antrean'); });
});

test('0700: produk tanpa arketipe atau risiko ditolak di gerbang (tidak bisa menghindari gerbang dengan mengosongkan arketipe)', async () => {
  const db = await makeDb(); const cid = await ready(db); const b = await batch(db, cid);
  await job(db, b, { arch: null });
  await rejects(enqueue(db, b), 'produk tanpa arketipe atau risiko');
});

test('0700: kebijakan katalog tanpa tumpang tindih; admin boleh menulis, staf tidak', async () => {
  const db = await makeDb();
  const pol = (await db.query(`select tablename, cmd from pg_policies where schemaname = 'public' and tablename in ('ugc_archetypes','ugc_locations','ugc_category_map')`)).rows;
  for (const t of ['ugc_archetypes', 'ugc_locations', 'ugc_category_map']) {
    for (const act of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) assert.equal(pol.filter(p => p.tablename === t && (p.cmd === act || p.cmd === 'ALL')).length, 1, `${t}:${act}`);
  }
  await as(db, U.staffA, async () => {
    assert.equal((await db.query(`select count(*)::int as n from ugc_archetypes`)).rows[0].n, 15, 'staf boleh membaca');
    assert.equal((await db.query(`update ugc_archetypes set nama = 'x' where id = 'A-01' returning id`)).rows.length, 0, 'update oleh staf tidak mengenai baris apa pun (RLS)');
    assert.equal((await db.query(`delete from ugc_archetypes where id = 'A-02' returning id`)).rows.length, 0, 'delete oleh staf tidak mengenai baris apa pun (RLS)');
    await rejects(db.query(`insert into ugc_archetypes (id, nama, risk_level) values ('A-16', 'x', 'rendah')`), 'row-level security');
  });
  await as(db, U.admin, async () => { await db.query(`update ugc_archetypes set nama = 'Busana dipakai' where id = 'A-01'`); });
});

test('0700: berjalan ulang tanpa galat; ditolak dengan pesan jelas tanpa 0600', async () => {
  const db = await makeDb(); await db.exec(SQL_0700); await db.exec(SQL_0700);
  const lama = await makeDb({ upTo: '20261005000500' });
  await rejects(lama.exec(SQL_0700), 'URUTAN SALAH');
});

// ───────────── 0710: risiko tingkat kategori ─────────────
test('0710: tepat 5 kategori bayi dinaikkan; produknya berisiko tinggi, staf tidak bisa menurunkannya, kategori lain tetap sedang', async () => {
  const db = await makeDb(); const cid = await ready(db); const b = await batch(db, cid);
  const ov = (await db.query(`select category_key from ugc_category_map where risiko_override = 'tinggi' order by 1`)).rows.map(r => r.category_key);
  assert.equal(ov.length, 5); assert.ok(ov.includes(BAYI_TINGGI)); assert.ok(!ov.includes(BAYI_BIASA)); assert.ok(ov.every(k => k.startsWith('Ibu & Bayi >')));
  const a = await job(db, b, { arch: null, category: BAYI_TINGGI });
  assert.equal(a.product.archetype_id, 'A-09'); assert.equal(a.product.risk_level, 'tinggi');
  const n = await job(db, b, { arch: null, category: BAYI_BIASA, seq: 2 });
  assert.equal(n.product.archetype_id, 'A-09'); assert.equal(n.product.risk_level, 'sedang');
  await as(db, U.staffA, async () => {
    const lower = async (sql, args) => { await db.query(sql, args); return (await db.query(`select risk_level from ugc_products where id = $1`, [a.product.id])).rows[0].risk_level; };
    assert.equal(await lower(`update ugc_products set risk_level = 'rendah' where id = $1`, [a.product.id]), 'tinggi', 'menurunkan risiko langsung tidak berhasil');
    assert.equal(await lower(`update ugc_products set category_key = $2, risk_level = 'sedang' where id = $1`, [a.product.id, BAYI_BIASA]), 'tinggi', 'jalan memutar (ganti kategori lalu turunkan) tidak berhasil');
  });
  await as(db, U.admin, async () => { await db.query(`update ugc_products set risk_level = 'sedang' where id = $1`, [a.product.id]); });   // admin boleh
});

test('0710: gerbang mewajibkan persetujuan admin untuk kategori yang dinaikkan, tidak untuk kategori lain', async () => {
  const db = await makeDb(); const cid = await ready(db);
  const b1 = await batch(db, cid); const j1 = await job(db, b1, { arch: null, category: BAYI_TINGGI });
  await rejects(enqueue(db, b1), 'berisiko tinggi menunggu persetujuan admin');
  await as(db, U.admin, async () => { await db.query(`select ugc_approve_risk($1, 'diperiksa')`, [j1.id]); });
  assert.equal(await enqueue(db, b1), 1);
  const b2 = await batch(db, cid); await job(db, b2, { arch: null, category: BAYI_BIASA });
  assert.equal(await enqueue(db, b2), 1, 'kategori bayi biasa mengikuti arketipe (sedang)');
});

test('0710: tanpa 0710 kategori yang sama hanya berisiko sedang (kebijakan ini opsional dan terpisah)', async () => {
  const db = await makeDb({ upTo: '20261005000700' }); const cid = await ready(db); const b = await batch(db, cid);
  const a = await job(db, b, { arch: null, category: BAYI_TINGGI });
  assert.equal(a.product.risk_level, 'sedang');
  await db.exec(SQL_0710);          // dipasang kemudian: berlaku untuk produk baru
  const b2 = await batch(db, cid); const a2 = await job(db, b2, { arch: null, category: BAYI_TINGGI });
  assert.equal(a2.product.risk_level, 'tinggi');
});

test('0710: berjalan ulang tanpa galat; ditolak dengan pesan jelas tanpa 0700; gagal bila pemetaan kategori berbeda dari perkiraan', async () => {
  const db = await makeDb(); await db.exec(SQL_0710); await db.exec(SQL_0710);
  assert.equal((await db.query(`select count(*)::int as n from ugc_category_map where risiko_override = 'tinggi'`)).rows[0].n, 5);
  const tanpa0700 = await makeDb({ upTo: '20261005000600' });
  await rejects(tanpa0700.exec(SQL_0710), 'URUTAN SALAH');
  const beda = await makeDb({ upTo: '20261005000700' });
  await beda.exec(`delete from ugc_category_map where category_key = '${BAYI_TINGGI}'`);
  await rejects(beda.exec(SQL_0710), 'diharapkan 5 kategori');
});
