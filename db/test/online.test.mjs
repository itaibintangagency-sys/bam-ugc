// Pengujian migrasi 20261005000500 (agent online setara agent offline) dan baris yang dikirim alat staf, pada Postgres lokal dengan RLS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { makeDb, as, rejects, U } from './helpers.mjs';

const require = createRequire(import.meta.url);
const T = require('../../agent/src/staffTool.js');
const SQL = readFileSync(new URL('../../supabase/migrations/20261005000500_agent_online_parity.sql', import.meta.url), 'utf8');
const URL_OK = 'https://flow.google.com/project/abc-123';
const ROOM = { code: 'C02_THE_SOFT_GIRL', name: 'Nadia', gender: 'perempuan', flow_project_url: URL_OK, flow_account_name: 'Uji Bintang', flow_voice_name: '',
  dna: { appearance_en: 'A young woman with long, wavy, light-brown hair.' }, voice: { base_voice: 'Achernar', gender: 'perempuan', usia: 'muda' } };

// Karakter siap + batch + job approved, dibuat persis seperti alat staf membuatnya (baris dari staffTool.js), lalu masuk antrean.
async function seed(db, { jobs = 1, account = 'Uji Bintang', face = 'chr/face_front.png' } = {}) {
  const room = { ...ROOM, flow_account_name: account };
  const out = { jobs: [] };
  await as(db, U.admin, async () => {
    out.char = (await db.query(`insert into ugc_characters (code, name, gender, creation_mode, dna, identity_lock, flow_project_url, flow_account_name, voice, voice_base, flow_voice_name, status, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      Object.values((r => [r.code, r.name, r.gender, r.creation_mode, JSON.stringify(r.dna), r.identity_lock, r.flow_project_url, r.flow_account_name, JSON.stringify(r.voice), r.voice_base, r.flow_voice_name, r.status, r.created_by])(T.characterRow(room, U.admin))))).rows[0].id;
    if (face) await db.query(`update ugc_characters set face_ref_path = $2 where id = $1`, [out.char, face]);
    await db.query(`select ugc_admin_mark_ready($1, 'Uji manual: karakter diverifikasi di Flow asli')`, [out.char]);
    const b = T.batchRow(out.char, '360p', U.admin);
    out.batch = (await db.query(`insert into ugc_batches (character_id, resolution, duration_sec, location_mode, status, note, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`, [b.character_id, b.resolution, b.duration_sec, b.location_mode, b.status, b.note, b.created_by])).rows[0].id;
    for (let i = 1; i <= jobs; i++) {
      const p = T.productRow('Produk ' + i, U.admin);
      const prod = (await db.query(`insert into ugc_products (name, status, photos, profile, created_by, confirmed_by, confirmed_at) values ($1,$2,$3,$4,$5,$6,$7) returning id`, [p.name, p.status, JSON.stringify(p.photos), JSON.stringify(p.profile), p.created_by, p.confirmed_by, p.confirmed_at])).rows[0].id;
      const j = T.jobRow({ id: '10000000-0000-0000-0000-00000000000' + i, batchId: out.batch, productId: prod, seq: i, storyboardPath: `${out.batch}/j${i}.png`, videoJson: '{"project":{"title":"x"},"character":{"appearance":"A young woman with long, wavy, light-brown hair."}}', userId: U.admin });
      await db.query(`insert into ugc_jobs (id, batch_id, product_id, seq, status, storyboard_variant, storyboard_path, video_json, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [j.id, j.batch_id, j.product_id, j.seq, j.status, j.storyboard_variant, j.storyboard_path, j.video_json, j.created_by]);
      out.jobs.push(j.id);
    }
    assert.equal((await db.query(`select ugc_enqueue_batch($1) as n`, [out.batch])).rows[0].n, jobs);
  });
  return out;
}
const claim = async (db, agent = 'laptop-1', as_ = U.agent) => as(db, as_, async () => (await db.query(`select ugc_claim_next_job($1) as j`, [agent])).rows[0].j);
const progress = (db, job, status, patch = {}, ev = null) => as(db, U.agent, async () => (await db.query(`select ugc_job_progress($1,$2,$3,$4) as s`, [job, status, JSON.stringify(patch), ev ? JSON.stringify(ev) : null])).rows[0].s);
const logEv = (db, job, step, extra = {}) => as(db, U.agent, async () => db.query(`select ugc_log_event($1,$2)`, [job, JSON.stringify({ kind: 'info', step, message: step, agent: 'laptop-1', ...extra })]));
const row = async (db, id) => { await db.exec('reset role'); return (await db.query(`select * from ugc_jobs where id = $1`, [id])).rows[0]; };

test('migrasi 0500: berjalan, dapat diulang, kolom akun ada; fungsi internal tidak terbuka untuk klien', async () => {
  const db = await makeDb();
  await db.exec(SQL);   // makeDb() sudah menjalankannya sekali; jalankan lagi = idempoten
  const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'ugc_characters'`)).rows.map(r => r.column_name);
  assert.ok(cols.includes('flow_account_name'));
  await as(db, U.agent, async () => {
    await rejects(db.query(`select ugc_job_was_generated('10000000-0000-0000-0000-000000000001')`), '42501');   // tidak boleh dipanggil langsung
  });
});

test('migrasi 0500: urutan salah (tanpa 0200/0300) ditolak dengan pesan jelas', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const bare = new PGlite();
  await rejects(bare.exec(SQL), 'URUTAN SALAH');
});

test('ugc_job_progress: status running dengan flow_asset_url diterima, job tetap milik agent, peristiwa tercatat', async () => {
  const db = await makeDb(); const s = await seed(db);
  const c = await claim(db); assert.equal(c.job_id, s.jobs[0]);
  assert.equal(await progress(db, c.job_id, 'running', { flow_asset_url: 'https://flow.google.com/project/abc-123/edit/zzz' },
    { kind: 'info', step: 'video_ready', message: 'alamat dicatat', agent: 'laptop-1' }), 'running');
  const j = await row(db, c.job_id);
  assert.equal(j.status, 'running'); assert.equal(j.claimed_by, 'laptop-1'); assert.equal(j.flow_asset_url, 'https://flow.google.com/project/abc-123/edit/zzz');
  assert.equal((await db.query(`select count(*)::int as n from ugc_job_events where job_id = $1 and step = 'video_ready'`, [c.job_id])).rows[0].n, 1);
});

test('klaim: semua kunci lama tetap ada, ditambah flow_asset_url, generated, room_code, room, extra_photos', async () => {
  const db = await makeDb(); const s = await seed(db);
  const c = await claim(db);
  for (const k of ['job_id', 'batch_id', 'seq', 'attempt', 'max_attempts', 'project_url', 'character_code', 'flow_character_name', 'flow_voice_name', 'resolution', 'duration_sec', 'storyboard', 'video_json', 'storyboard_variant', 'setting_id', 'gesture_variant']) assert.ok(k in c, 'kunci lama hilang: ' + k);
  assert.equal(c.flow_asset_url, null); assert.equal(c.generated, false);
  assert.equal(c.room_code, 'C02_THE_SOFT_GIRL'); assert.equal(c.project_url, URL_OK);
  assert.deepEqual(c.room, { code: 'C02_THE_SOFT_GIRL', name: 'Nadia', flow_project_url: URL_OK, flow_account_name: 'Uji Bintang', dna: { appearance_en: 'A young woman with long, wavy, light-brown hair.' } });
  assert.deepEqual(c.extra_photos, [{ angle: 'face_front', bucket: 'ugc-characters', path: 'chr/face_front.png' }]);
  assert.deepEqual(c.storyboard, { bucket: 'ugc-storyboards', path: `${s.batch}/j1.png` });
});

test('klaim: karakter tanpa foto wajah atau tanpa nama akun menghasilkan extra_photos kosong dan akun null', async () => {
  const db = await makeDb(); await seed(db, { face: null, account: '' });
  const c = await claim(db);
  assert.deepEqual(c.extra_photos, []); assert.ok(c.room.flow_account_name === '' || c.room.flow_account_name === null);
});

test('penanda generate: mengikuti peristiwa terakhir (generate_start/generate = mungkin jadi, generate_failed = tidak ada video)', async () => {
  const db = await makeDb(); const s = await seed(db);
  const id = s.jobs[0]; await claim(db);
  const gen = async () => { await progress(db, id, 'queued'); return (await claim(db)).generated; };
  assert.equal(await gen(), false, 'belum ada peristiwa generate');
  await logEv(db, id, 'attach'); assert.equal(await gen(), false, 'lampiran saja bukan generate');
  await logEv(db, id, 'generate_start'); assert.equal(await gen(), true);
  await logEv(db, id, 'generate_failed'); assert.equal(await gen(), false, 'kartu gagal menghapus tanda');
  await logEv(db, id, 'generate'); assert.equal(await gen(), true, 'generate ulang otomatis menandai lagi');
  await logEv(db, id, 'generate_timeout'); assert.equal(await gen(), true, 'waktu habis tidak menghapus tanda');
});

test('ugc_requeue_own: job running milik agent yang baru mulai kembali ke antrean; asset url dan penanda tetap; milik agent lain tidak disentuh', async () => {
  const db = await makeDb(); const s = await seed(db, { jobs: 2 });
  const a = await claim(db, 'laptop-1'), b = await claim(db, 'laptop-2'); assert.notEqual(a.job_id, b.job_id);
  await logEv(db, a.job_id, 'generate_start'); await progress(db, a.job_id, 'running', { flow_asset_url: 'https://flow.google.com/project/abc-123/edit/q' });
  const n = await as(db, U.agent, async () => (await db.query(`select ugc_requeue_own('laptop-1') as n`)).rows[0].n);
  assert.equal(n, 1);
  const ja = await row(db, a.job_id), jb = await row(db, b.job_id);
  assert.equal(ja.status, 'queued'); assert.equal(ja.claimed_by, null); assert.equal(ja.not_before, null); assert.equal(ja.flow_asset_url, 'https://flow.google.com/project/abc-123/edit/q'); assert.equal(ja.error_kind, 'stale');
  assert.equal(jb.status, 'running'); assert.equal(jb.claimed_by, 'laptop-2');
  const ev = (await db.query(`select message, agent from ugc_job_events where job_id = $1 and step = 'requeue'`, [a.job_id])).rows;
  assert.equal(ev.length, 1); assert.match(ev[0].message, /generate ditekan.*tanpa generate ulang/); assert.equal(ev[0].agent, 'laptop-1');
  const again = await claim(db, 'laptop-1');
  assert.equal(again.job_id, a.job_id); assert.equal(again.generated, true); assert.equal(again.flow_asset_url, 'https://flow.google.com/project/abc-123/edit/q'); assert.equal(again.attempt, 2);
});

test('mengapa ugc_requeue_own diperlukan: agent yang sama sudah berdetak lagi, jadi ugc_requeue_stale tidak mengembalikan job-nya', async () => {
  const db = await makeDb(); await seed(db);
  const c = await claim(db, 'laptop-1');
  await db.exec(`reset role; update ugc_jobs set claimed_at = now() - interval '45 minutes' where id = '${c.job_id}'`);
  await as(db, U.agent, async () => { await db.query(`select ugc_agent_heartbeat('laptop-1', '{}'::jsonb)`); });
  const stale = await as(db, U.agent, async () => (await db.query(`select ugc_requeue_stale() as n`)).rows[0].n);
  assert.equal(stale, 0, 'dibuktikan: cara lama tidak menolong');
  assert.equal((await row(db, c.job_id)).status, 'running');
  const own = await as(db, U.agent, async () => (await db.query(`select ugc_requeue_own('laptop-1') as n`)).rows[0].n);
  assert.equal(own, 1); assert.equal((await row(db, c.job_id)).status, 'queued');
});

test('ugc_requeue_own: hanya agent atau admin; nama kosong ditolak; tanpa job running mengembalikan 0', async () => {
  const db = await makeDb(); await seed(db);
  await as(db, U.staffA, async () => { await rejects(db.query(`select ugc_requeue_own('laptop-1')`), '42501'); });
  await as(db, U.agent, async () => {
    await rejects(db.query(`select ugc_requeue_own('  ')`), '22023');
    assert.equal((await db.query(`select ugc_requeue_own('laptop-1') as n`)).rows[0].n, 0);
  });
});

test('klaim: staf tetap tidak boleh mengklaim job; antrean kosong menghasilkan null', async () => {
  const db = await makeDb();
  await as(db, U.staffA, async () => { await rejects(db.query(`select ugc_claim_next_job('x')`), '42501'); });
  assert.equal(await claim(db), null);
});

// ───────────── Baris yang dikirim alat staf harus diterima database di bawah RLS ─────────────
test('alat staf: staf (bukan admin) boleh membuat karakter, foto, produk, batch, job; tidak boleh menandai siap', async () => {
  const db = await makeDb();
  await as(db, U.staffA, async () => {
    const r = T.characterRow(ROOM, U.staffA);
    const id = (await db.query(`insert into ugc_characters (code, name, gender, creation_mode, dna, identity_lock, flow_project_url, flow_account_name, voice, voice_base, flow_voice_name, status, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`, [r.code, r.name, r.gender, r.creation_mode, JSON.stringify(r.dna), r.identity_lock, r.flow_project_url, r.flow_account_name, JSON.stringify(r.voice), r.voice_base, r.flow_voice_name, r.status, r.created_by])).rows[0].id;
    const ph = T.photoRow(id, T.facePath(id, '.png'), U.staffA);
    await db.query(`insert into ugc_character_photos (character_id, angle, path, approved, created_by) values ($1,$2,$3,$4,$5)`, [ph.character_id, ph.angle, ph.path, ph.approved, ph.created_by]);
    await db.query(`update ugc_characters set face_ref_path = $2 where id = $1`, [id, ph.path]);
    const patch = T.characterPatch({ ...ROOM, name: 'Nadia Baru' });
    assert.ok(!('code' in patch) && !('created_by' in patch) && !('status' in patch));
    await db.query(`update ugc_characters set name = $2, flow_account_name = $3, dna = $4 where id = $1`, [id, patch.name, patch.flow_account_name, JSON.stringify(patch.dna)]);
    await rejects(db.query(`select ugc_admin_mark_ready($1, 'alasan yang cukup panjang')`, [id]), 'khusus admin');
    assert.equal((await db.query(`select status from ugc_characters where id = $1`, [id])).rows[0].status, 'voice_defined');
  });
});

test('alat staf: suara dasar yang sama dengan karakter lain ditolak, dan pesannya diterjemahkan ke bahasa awam', async () => {
  const db = await makeDb(); await seed(db);
  let err;
  await as(db, U.staffA, async () => {
    const r = T.characterRow({ ...ROOM, code: 'C09' }, U.staffA);
    err = await rejects(db.query(`insert into ugc_characters (code, name, creation_mode, dna, identity_lock, flow_project_url, voice, voice_base, status, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [r.code, r.name, r.creation_mode, JSON.stringify(r.dna), r.identity_lock, r.flow_project_url, JSON.stringify(r.voice), r.voice_base, r.status, r.created_by]), 'ugc_characters_voice_base_uq');
  });
  assert.match(T.friendly(err).message, /Satu karakter satu suara/);
});

test('alat staf: staf lain tidak melihat job dan tidak bisa mengantrekan batch milik orang lain; admin melihat semuanya', async () => {
  const db = await makeDb(); const s = await seed(db);
  await as(db, U.staffB, async () => {
    assert.equal((await db.query(`select count(*)::int as n from ugc_jobs`)).rows[0].n, 0, 'job staf lain tidak terlihat');
    await rejects(db.query(`select ugc_enqueue_batch($1)`, [s.batch]), '42501');
  });
  await as(db, U.admin, async () => {
    assert.equal((await db.query(`select count(*)::int as n from ugc_jobs`)).rows[0].n, 1, 'admin melihat job staf');
  });
});

test('alat staf: batch setengah jadi bisa dibatalkan staf pemiliknya (tidak menghabiskan batas harian)', async () => {
  const db = await makeDb();
  const id = await as(db, U.staffA, async () => {
    const r = T.characterRow(ROOM, U.staffA);
    const cid = (await db.query(`insert into ugc_characters (code, name, creation_mode, dna, identity_lock, flow_project_url, voice, voice_base, status, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [r.code, r.name, r.creation_mode, JSON.stringify(r.dna), r.identity_lock, r.flow_project_url, JSON.stringify(r.voice), r.voice_base, r.status, r.created_by])).rows[0].id;
    const b = T.batchRow(cid, '360p', U.staffA);
    const bid = (await db.query(`insert into ugc_batches (character_id, resolution, duration_sec, location_mode, status, note, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`, [b.character_id, b.resolution, b.duration_sec, b.location_mode, b.status, b.note, b.created_by])).rows[0].id;
    await db.query(`update ugc_batches set status = 'canceled' where id = $1`, [bid]);
    return bid;
  });
  await db.exec('reset role');
  assert.equal((await db.query(`select status from ugc_batches where id = $1`, [id])).rows[0].status, 'canceled');
});
