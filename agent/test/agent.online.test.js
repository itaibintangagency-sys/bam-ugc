'use strict';
// Sumber data online (SupabaseSource) dengan klien Supabase tiruan sederhana: kompatibilitas dengan database yang belum menjalankan 0500, pemanggilan RPC, dan foto wajah.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SupabaseSource } = require('../src/sources/supabaseSource');
const { processJob } = require('../src/jobRunner');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bamugc-online-'));
const mkSupa = (handlers = {}, files = {}) => {
  const calls = [];
  return { calls,
    async rpc(fn, args) { calls.push([fn, args]); if (!(fn in handlers)) return null; const h = handlers[fn]; if (h instanceof Error) throw h; return typeof h === 'function' ? h(args) : h; },
    async download(bucket, p, dest) { calls.push(['download', bucket, p]); if (files[bucket + '/' + p] === undefined) throw new Error(`Unduh ${bucket}/${p} gagal (404)`); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, files[bucket + '/' + p]); return dest; }
  };
};
const src = supa => new SupabaseSource(supa, { agentName: 'laptop-1', version: 't' });

test('requeueStale: memanggil ugc_requeue_own dengan nama agent, lalu ugc_requeue_stale; jumlah dijumlahkan', async () => {
  const supa = mkSupa({ ugc_requeue_own: 2, ugc_requeue_stale: 1 });
  assert.equal(await src(supa).requeueStale(), 3);
  assert.deepEqual(supa.calls, [['ugc_requeue_own', { p_agent: 'laptop-1' }], ['ugc_requeue_stale', {}]]);
});

test('requeueStale: database belum menjalankan 0500 (fungsi tidak ada) tidak menggagalkan agent; galat lain tetap dilempar', async () => {
  const hilang = mkSupa({ ugc_requeue_own: new Error('RPC ugc_requeue_own gagal (404): Could not find the function public.ugc_requeue_own'), ugc_requeue_stale: 1 });
  assert.equal(await src(hilang).requeueStale(), 1);
  const rusak = mkSupa({ ugc_requeue_own: new Error('RPC ugc_requeue_own gagal (403): khusus agent') });
  await assert.rejects(() => src(rusak).requeueStale(), /khusus agent/);
});

test('claim: jawaban database lama (tanpa "generated") ditandai schema_outdated; jawaban baru tidak; antrean kosong tetap null', async () => {
  assert.equal((await src(mkSupa({ ugc_claim_next_job: { job_id: 'a', project_url: 'x' } })).claim()).schema_outdated, true);
  assert.equal((await src(mkSupa({ ugc_claim_next_job: { job_id: 'a', generated: false } })).claim()).schema_outdated, undefined);
  assert.equal(await src(mkSupa({ ugc_claim_next_job: null })).claim(), null);
});

test('fetchExtras: foto wajah diunduh dari bucket privat ke folder kerja dengan ekstensi aslinya; tanpa foto = daftar kosong; gagal unduh = galat jelas', async () => {
  const supa = mkSupa({}, { 'ugc-characters/c1/face_front.jpg': Buffer.from('foto') });
  const out = await src(supa).fetchExtras({ extra_photos: [{ angle: 'face_front', bucket: 'ugc-characters', path: 'c1/face_front.jpg' }] }, path.join(TMP, 'w'));
  assert.deepEqual(out.map(f => path.basename(f)), ['extra1.jpg']); assert.equal(fs.readFileSync(out[0], 'utf8'), 'foto');
  assert.deepEqual(await src(supa).fetchExtras({}, path.join(TMP, 'w2')), []);
  assert.deepEqual(await src(supa).fetchExtras({ extra_photos: [] }, path.join(TMP, 'w3')), []);
  await assert.rejects(() => src(supa).fetchExtras({ extra_photos: [{ bucket: 'ugc-characters', path: 'tidak/ada.png' }] }, path.join(TMP, 'w4')), /Unduh ugc-characters\/tidak\/ada\.png gagal \(404\)/);
});

test('job dari database lama: agent memperingatkan di log dan mencatat peristiwa, lalu tetap berjalan (di sini berhenti sengaja di langkah awal)', async () => {
  const logs = [], events = [];
  const source = { log: async (id, ev) => { events.push(ev); }, progress: async () => 'failed', fetchStoryboard: async () => { throw new Error('berhenti sengaja'); } };
  const flow = { debugSnap: async () => null };
  const log = { info() {}, error() {}, warn: m => logs.push(m) };
  await processJob({ job: { job_id: 'j1', attempt: 1, max_attempts: 3, schema_outdated: true }, source, flow, cfg: {}, log, workDir: path.join(TMP, 'wk') });
  assert.ok(logs.some(m => /migrasi 20261005000500/.test(m)));
  assert.ok(events.some(e => e.step === 'schema_outdated'));
});

test('SOURCE dengan spasi di ujung (jebakan cmd: "set SOURCE=local & ...") tetap dikenali sebagai offline', () => {
  const { makeSource } = require('../src/index.js');
  const old = { S: process.env.SOURCE, L: process.env.LOCAL_DIR };
  process.env.SOURCE = 'local '; process.env.LOCAL_DIR = path.join(TMP, 'lokal');
  try { assert.equal(makeSource({ info() {} }).kind, 'local'); } finally { process.env.SOURCE = old.S; process.env.LOCAL_DIR = old.L; if (old.S === undefined) delete process.env.SOURCE; if (old.L === undefined) delete process.env.LOCAL_DIR; }
});

test('mulai.bat: menu 8 (database a-e) dan 9 (agent online) memanggil perintah yang benar; SOURCE selalu ditulis dengan tanda kutip supaya tanpa spasi tersisa', () => {
  const b = fs.readFileSync(path.join(__dirname, '..', 'mulai.bat'), 'utf8');
  assert.ok(b.includes('\r\n') && [...b].every(c => c.charCodeAt(0) < 128));
  for (const cmd of ['staff push-char', 'staff push-batch', 'staff queue', 'staff videos', 'index.js start']) assert.ok(b.includes(cmd), cmd);
  assert.match(b, /if "%PILIH%"=="8" goto db/); assert.match(b, /if "%PILIH%"=="9" goto online/);
  assert.ok(!/set SOURCE=/.test(b), 'tidak ada set SOURCE= tanpa kutip');
  assert.ok(b.includes('set "SOURCE=supabase"') && b.includes('set "SOURCE=local"'));
  const online = b.slice(b.indexOf(':online'), b.indexOf(':selesai'));
  assert.ok(online.indexOf('set "SOURCE=supabase"') < online.indexOf('index.js start') && online.indexOf('index.js start') < online.indexOf('set "SOURCE=local"'), 'kembali ke offline setelah agent online berhenti');
});
