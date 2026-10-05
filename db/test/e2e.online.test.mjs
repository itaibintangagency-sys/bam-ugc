// Ujung ke ujung mode online: alat staf mengirim ruang dan job ke "Supabase" (Postgres lokal + semua migrasi + RLS), agent online memprosesnya
// di halaman Flow tiruan. Yang BELUM terbukti oleh tes ini: Supabase asli, JWT asli, dan Flow asli.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFake } from './fakeSupabase.mjs';

const require = createRequire(import.meta.url);
const AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'agent');
const { chromium } = require(path.join(AGENT, 'node_modules', 'playwright-core'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bamugc-e2e-'));
const PORT = 9356;
const MOCK = 'file://' + path.join(AGENT, 'test', 'mockflow.html');
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const LOCAL = path.join(TMP, 'local'); fs.mkdirSync(LOCAL, { recursive: true });

const baseCfg = JSON.parse(fs.readFileSync(path.join(AGENT, 'config', 'flow.labels.json'), 'utf8'));
baseCfg.timeouts = { generate_sec: 40, upload_sec: 20, poll_ms: 150, start_sec: 15, settle_sec: 1, find_video_sec: 6 };
const cfgFile = path.join(TMP, 'flow.fast.json'); fs.writeFileSync(cfgFile, JSON.stringify(baseCfg));
Object.assign(process.env, {
  PAGE_MATCH: 'mockflow', CDP_URL: `http://127.0.0.1:${PORT}`, FLOW_CONFIG: cfgFile, ALLOW_ANY_PROJECT_URL: '1', LOCAL_DIR: LOCAL,
  HUMAN_POLL_MS: '300', HUMAN_WAIT_MS: '4000', IDLE_MS: '100', FIND_VIDEO_MS: '5000', TOKEN_CHECK_MS: '1500', FIND_RETRY_MS: '400',
  DOWNLOAD_WAIT_MS: '3000', MIN_VIDEO_BYTES: '1000', DOWNLOAD_DIR: path.join(TMP, 'downloads'), WORK_DIR: path.join(TMP, 'work'), POLICY_RETRIES: '2',
  AGENT_LOCK_DIR: path.join(TMP, 'locks'), SUPABASE_ANON_KEY: 'anon'
});
delete process.env.SOURCE;
fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true }); fs.mkdirSync(process.env.AGENT_LOCK_DIR, { recursive: true });

const { runLoop, enqueueLocal, staffCmd } = require(path.join(AGENT, 'src', 'index.js'));
const { Supa } = require(path.join(AGENT, 'src', 'supabaseRest.js'));
const { SupabaseSource } = require(path.join(AGENT, 'src', 'sources', 'supabaseSource.js'));
const { LocalSource } = require(path.join(AGENT, 'src', 'sources', 'localSource.js'));
const T = require(path.join(AGENT, 'src', 'staffTool.js'));
const room = require(path.join(AGENT, 'src', 'room.js'));
const core = require(path.join(AGENT, '..', 'core', 'src'));

const silent = { info() {}, warn() {}, error() {}, file: '' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mockUrl = q => `${MOCK}?${q}&t=${Date.now()}${Math.floor(Math.random() * 1000)}`;
const REAL = 'https://flow.google.com/project/mock-1';
const CODE = 'C02_THE_SOFT_GIRL';
const APP = 'A young woman in her early twenties with long, wavy, light-brown hair with soft caramel highlights, parted in the middle, a soft oval face, a fair to light complexion, and a bright cheerful smile.';
const prof = { photos: [{ role: 'depan' }, { role: 'closeup' }], facts: ['Lengan pendek'], colors: [],
  details: ['detail_utama', 'motif_kain', 'lengan_bawahan_hem', 'siluet_panjang'].map(k => ({ slot_key: k, text: k, label: k, confidence: 0.9 })) };
const VIDEO_JSON = core.buildVideoJson(core.buildPanelPlan({ archetypeId: 'A-01', productProfile: prof, settingId: 'S-01', seed: 3 }),
  { characterCode: 'C02', jobTag: 'PRODUCT-01', productProfile: prof, characterPhotoAttached: true, characterProfile: { appearance_en: APP } });
const file = (name, data) => { const f = path.join(TMP, name); fs.writeFileSync(f, data); return f; };
const FACE = file('wajah_C02.png', PNG), SB = file('storyboard.png', PNG), JS = file('video.json', VIDEO_JSON);
const VOICE = path.join(AGENT, 'contoh', 'profil-suara.contoh.json');

let fake, chromeProc, probe;
const pageNow = () => probe.contexts()[0].pages().find(p => p.url().includes('mockflow'));
const counters = () => pageNow().evaluate(() => ({ g: window.__generated, f: window.__forbidden, last: window.__lastGen }));
const asUser = (who) => { const u = { admin: ['admin@x', 'pw-admin'], staff: ['staff@x', 'pw-staff'] }[who]; return T.login({ SUPABASE_URL: fake.url, SUPABASE_ANON_KEY: 'anon', STAFF_EMAIL: u[0], STAFF_PASSWORD: u[1] }); };
const agentSource = () => new SupabaseSource(new Supa({ url: fake.url, anonKey: 'anon', email: 'agent@x', password: 'pw-agent' }), { agentName: 'laptop-1', version: 't' });
const agentRun = maxJobs => runLoop({ source: agentSource(), log: silent, maxJobs });
const jobs = async (where = 'true') => (await fake.sql(`select id, seq, status, attempts, error_kind, last_error, video_path, flow_asset_url from ugc_jobs where ${where} order by created_at, seq`)).rows;
const events = async id => (await fake.sql(`select step, kind, message from ugc_job_events where job_id = $1 order by id`, [id])).rows;
const setDbUrl = u => fake.sql(`update ugc_characters set flow_project_url = $2 where code = $1`, [CODE, u]);
const fastRetry = () => fake.sql(`insert into ugc_settings (key, value) values ('retry_backoff_minutes', '0') on conflict (key) do update set value = excluded.value`);

// Membuat n job lokal dari ruang, mengirimnya sebagai satu batch (karakter harus bernilai alamat Flow asli saat dikirim), lalu mengarahkan ke halaman tiruan.
async function pushJobs(n, mockQuery, { names = [] } = {}) {
  for (let i = 0; i < n; i++) {
    const dir = path.join(TMP, `produk-${Date.now()}-${i}-${names[i] || i}`); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'download.png'), PNG); fs.writeFileSync(path.join(dir, 'video.json'), VIDEO_JSON);
    enqueueLocal({ room: CODE, storyboard: path.join(dir, 'download.png'), json: path.join(dir, 'video.json'), res: '360p' });
    await sleep(1100);   // id job lokal bergantung pada detik
  }
  await setDbUrl(REAL);
  const r = await T.pushBatch(await asUser('admin'), LOCAL, { room: CODE }, () => {});
  await setDbUrl(mockUrl(mockQuery));
  return r;
}

test.before(async () => {
  fake = await startFake();
  process.env.SUPABASE_URL = fake.url;
  chromeProc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(TMP, 'profile')}`, MOCK], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { probe = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await sleep(300); } }
  assert.ok(probe, 'Chrome uji berjalan');
  room.upsertRoom(LOCAL, { code: CODE, name: 'Nadia', gender: 'perempuan', face: FACE, appearanceFromJson: JS, voiceFile: VOICE, project: REAL, account: 'Uji Bintang' });
});
test.after(async () => { try { await probe.close(); } catch { /* abaikan */ } if (chromeProc) chromeProc.kill('SIGKILL'); if (fake) await fake.close(); });

test('login: kata sandi salah ditolak dengan pesan jelas, tanpa menyimpan apa pun', async () => {
  await assert.rejects(() => T.login({ SUPABASE_URL: fake.url, SUPABASE_ANON_KEY: 'anon', STAFF_EMAIL: 'admin@x', STAFF_PASSWORD: 'salah' }), /Login Supabase gagal: Invalid login credentials/);
  await assert.rejects(() => T.login({ SUPABASE_URL: fake.url, SUPABASE_ANON_KEY: 'anon' }), /STAFF_EMAIL dan STAFF_PASSWORD belum diisi/);
});

test('kirim karakter oleh STAF dengan alasan siap: ditolak dengan pesan awam (hanya admin), karakter tetap terbentuk sebagai voice_defined', async () => {
  const staff = await asUser('staff');
  await assert.rejects(() => T.pushChar(staff, LOCAL, { room: CODE, ready: 'Uji manual: karakter diverifikasi di Flow asli' }, () => {}), /Hanya akun admin yang boleh menandai karakter siap/);
  const c = (await fake.sql(`select status, created_by from ugc_characters where code = $1`, [CODE])).rows[0];
  assert.equal(c.status, 'voice_defined'); assert.equal(c.created_by, '00000000-0000-0000-0000-0000000000b1');
});

test('kirim karakter oleh ADMIN: data, foto wajah, dan alasan siap tersimpan; foto ada di bucket privat; pengiriman ulang tidak menggandakan', async () => {
  const admin = await asUser('admin');
  await assert.rejects(() => T.pushChar(admin, LOCAL, { room: CODE, ready: 'pendek' }, () => {}), /minimal 10 karakter/);
  const r = await T.pushChar(admin, LOCAL, { room: CODE, ready: 'Uji manual: karakter diverifikasi di Flow asli' }, () => {});
  assert.equal(r.status, 'ready'); assert.equal(r.ready, true);
  const c = (await fake.sql(`select * from ugc_characters where code = $1`, [CODE])).rows[0];
  assert.equal(c.flow_account_name, 'Uji Bintang'); assert.equal(c.flow_project_url, REAL); assert.equal(c.voice_base, 'Achernar'); assert.equal(c.identity_lock, 'locked');
  assert.equal(c.dna.appearance_en, APP); assert.equal(c.face_ref_path, `${c.id}/face_front.png`); assert.match(c.ready_override_reason, /Uji manual/);
  assert.ok(fake.storage.has(`ugc-characters/${c.id}/face_front.png`), 'foto wajah di bucket');
  const ph = (await fake.sql(`select angle, approved, path from ugc_character_photos where character_id = $1`, [c.id])).rows;
  assert.deepEqual(ph, [{ angle: 'face_front', approved: true, path: c.face_ref_path }]);
  await T.pushChar(admin, LOCAL, { room: CODE }, () => {});   // ulang tanpa alasan: memperbarui, bukan menggandakan
  assert.equal((await fake.sql(`select count(*)::int as n from ugc_characters where code = $1`, [CODE])).rows[0].n, 1);
  assert.equal((await fake.sql(`select count(*)::int as n from ugc_character_photos where character_id = $1`, [c.id])).rows[0].n, 1);
});

test('kirim batch: dua job lokal menjadi satu batch di antrean dengan storyboard di bucket; job lokal ditandai terkirim dan tidak dijalankan lokal', async () => {
  const r = await pushJobs(2, 'delay=300&lang=en', { names: ['terracotta', 'hitamputih'] });
  assert.equal(r.queued, 2); assert.equal(r.jobs.length, 2);
  const rows = await jobs(`batch_id = '${r.batchId}'`);
  assert.deepEqual(rows.map(x => [x.seq, x.status]), [[1, 'queued'], [2, 'queued']]);
  const full = (await fake.sql(`select storyboard_path, video_json, product_id from ugc_jobs where batch_id = $1 order by seq`, [r.batchId])).rows;
  for (const j of full) { assert.ok(fake.storage.has(`ugc-storyboards/${j.storyboard_path}`), 'storyboard di bucket'); assert.match(j.video_json, /"appearance"/); }
  assert.equal((await fake.sql(`select count(*)::int as n from ugc_products where status = 'confirmed'`)).rows[0].n, 2);
  assert.equal((await fake.sql(`select status, resolution from ugc_batches where id = $1`, [r.batchId])).rows[0].status, 'queued');
  const src = new LocalSource(LOCAL, {}); assert.equal(await src.claim(), null, 'job lokal yang terkirim tidak dijalankan lagi secara lokal');
  assert.ok(src.summary().every(x => x.status === 'pushed'));
  const adminSupa = await asUser('admin');
  await assert.rejects(() => T.pushBatch(adminSupa, LOCAL, { room: CODE }, () => {}), /Tidak ada job lokal baru/);
});

test('agent online: dua job diproses dari database sampai video terunggah; dua bahan terlampir (storyboard + foto wajah dari bucket); ruang cocok', async () => {
  const before = (await fake.sql(`select count(*)::int as n from ugc_job_events where step = 'room_check'`)).rows[0].n;
  await agentRun(2);
  const rows = await jobs(); assert.deepEqual(rows.map(x => x.status), ['downloaded', 'downloaded']);
  for (const j of rows) {
    assert.match(j.video_path, /\.mp4$/); assert.ok(fake.storage.has(`ugc-videos/${j.video_path}`), 'video di bucket'); assert.ok(fake.storage.get(`ugc-videos/${j.video_path}`).length >= 30000);
    const ev = await events(j.id); const steps = ev.map(e => e.step);
    for (const s of ['room_check', 'attach', 'attach_extra', 'generate_start', 'generate', 'video_ready', 'download', 'done']) assert.ok(steps.includes(s), `${s} tercatat: ${steps}`);
    assert.ok(!ev.some(e => e.kind === 'warn'), 'tanpa peringatan');
    assert.match(j.flow_asset_url, /#\/edit\//);
  }
  const c = await counters(); assert.equal(c.last.chips, 2, 'dua bahan saat generate'); assert.equal(c.f, 0);
  assert.equal((await fake.sql(`select count(*)::int as n from ugc_job_events where step = 'room_check'`)).rows[0].n, before + 2);
});

test('unduh video lewat alat staf: tersimpan di local\\outbox\\online, dan pengunduhan ulang tidak menggandakan', async () => {
  const lines = []; const got = await T.videos(await asUser('admin'), LOCAL, m => lines.push(m));
  assert.equal(got.length, 2); for (const f of got) assert.ok(fs.statSync(f).size >= 30000);
  assert.deepEqual(await T.videos(await asUser('admin'), LOCAL, () => {}), []);
});

test('pemulihan online: unduhan gagal setelah video jadi → percobaan kedua hanya mengunduh memakai flow_asset_url dari database (generate tetap satu kali)', async () => {
  await fastRetry();
  const r = await pushJobs(1, 'delay=400&lang=en&detail=new&dlfail=1');
  await agentRun(2);
  const [j] = await jobs(`batch_id = '${r.batchId}'`);
  assert.equal(j.status, 'downloaded', JSON.stringify(j)); assert.equal(j.attempts, 2);
  const ev = await events(j.id);
  assert.equal(ev.filter(e => e.step === 'generate').length, 1, 'generate hanya sekali');
  assert.ok(ev.some(e => e.step === 'recover'), 'jalur pemulihan dipakai');
  assert.ok(fake.storage.has(`ugc-videos/${j.video_path}`));
  assert.equal((await counters()).g, 1);
});

test('agent mati sesudah generate: saat agent mulai lagi, job running miliknya kembali ke antrean dan video DICARI (tanpa generate ulang); tidak ketemu → gagal tetap jelas', async () => {
  const r = await pushJobs(1, 'delay=300&lang=en');
  const [j] = await jobs(`batch_id = '${r.batchId}'`);
  await fake.sql(`update ugc_jobs set status = 'running', claimed_by = 'laptop-1', claimed_at = now(), attempts = 1 where id = $1`, [j.id]);
  await fake.sql(`insert into ugc_job_events (job_id, kind, step, message, agent) values ($1, 'info', 'generate_start', 'Akan menekan generate', 'laptop-1')`, [j.id]);
  await agentRun(1);
  const [after] = await jobs(`id = '${j.id}'`);
  assert.equal(after.status, 'failed', JSON.stringify(after)); assert.equal(after.error_kind, 'fatal'); assert.equal(after.attempts, 2);
  const ev = await events(j.id); const steps = ev.map(e => e.step);
  assert.ok(steps.includes('requeue') && steps.includes('locate'), `requeue dan locate tercatat: ${steps}`);
  assert.equal(steps.filter(s => s === 'generate_start').length, 1, 'tidak ada generate_start baru');
  assert.ok(!steps.includes('attach') && !steps.includes('generate'), 'tidak melampirkan dan tidak generate');
});

test('pengaman akun online: akun Google yang terbuka berbeda dari akun karakter di database → gagal tetap SEBELUM menyentuh Flow', async () => {
  const r = await pushJobs(1, 'delay=300&lang=en');   // dikirim dengan akun yang benar (alat kirim menolak bila database berbeda dari ruang)
  await fake.sql(`update ugc_characters set flow_account_name = 'Akun Lama Kredit Habis' where code = $1`, [CODE]);   // lalu akun karakter di database berubah
  try { await agentRun(1); } finally { await fake.sql(`update ugc_characters set flow_account_name = 'Uji Bintang' where code = $1`, [CODE]); }
  const [j] = await jobs(`batch_id = '${r.batchId}'`);
  assert.equal(j.status, 'failed', JSON.stringify(j)); assert.equal(j.error_kind, 'fatal');
  assert.match(j.last_error, /Akun Google yang terbuka \("Uji Bintang"\) berbeda dari akun ruang C02_THE_SOFT_GIRL \("Akun Lama Kredit Habis"\)/);
  const steps = (await events(j.id)).map(e => e.step);
  assert.ok(!steps.some(s => ['project', 'attach', 'generate_start', 'generate'].includes(s)), `Flow tidak disentuh: ${steps}`);
});

test('alat kirim: menolak mengirim bila akun atau project di database berbeda dari ruang lokal', async () => {
  const dir = path.join(TMP, 'produk-beda'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'download.png'), PNG); fs.writeFileSync(path.join(dir, 'video.json'), VIDEO_JSON);
  enqueueLocal({ room: CODE, storyboard: path.join(dir, 'download.png'), json: path.join(dir, 'video.json'), res: '360p' });
  await setDbUrl(REAL);
  await fake.sql(`update ugc_characters set flow_account_name = 'Akun Lama' where code = $1`, [CODE]);
  const admin = await asUser('admin');
  try { await assert.rejects(() => T.pushBatch(admin, LOCAL, { room: CODE }, () => {}), /Project atau akun di database berbeda dari ruang lokal/); }
  finally { await fake.sql(`update ugc_characters set flow_account_name = 'Uji Bintang' where code = $1`, [CODE]); }
  assert.equal(T.localPending(LOCAL, CODE).length, 1, 'job lokal tetap menunggu');
  const r = await T.pushBatch(admin, LOCAL, { room: CODE }, () => {});
  assert.equal(r.queued, 1); await fake.sql(`update ugc_jobs set status = 'canceled' where id = $1`, [r.jobs[0].job_id]);
});

test('perintah staff lewat CLI: antrean dan push-batch memakai login dari lingkungan; password salah tidak membocorkan apa pun', async () => {
  const lines = []; const orig = console.log; console.log = m => lines.push(String(m));
  process.env.STAFF_EMAIL = 'admin@x'; process.env.STAFF_PASSWORD = 'pw-admin';
  try { const rows = await staffCmd('queue', {}); assert.ok(rows.length >= 4); } finally { console.log = orig; }
  assert.ok(lines.some(l => /✔ .* — downloaded/.test(l)) && lines.some(l => /✖ .* — failed \(percobaan \d\) — .*Akun Google/.test(l)), lines.join('\n'));
  process.env.STAFF_PASSWORD = 'salah';
  await assert.rejects(() => staffCmd('queue', {}), e => /Login Supabase gagal/.test(e.message) && !/salah/.test(e.message));
  delete process.env.STAFF_EMAIL; delete process.env.STAFF_PASSWORD;
});

test('pengiriman gagal di tengah jalan: batch dibatalkan, job lokal tetap bisa dikirim ulang', async () => {
  await fake.sql(`update ugc_settings set value = '1' where key = 'max_jobs_per_batch'`).catch(() => {});
  const dir = path.join(TMP, 'produk-gagal'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'download.png'), PNG); fs.writeFileSync(path.join(dir, 'video.json'), VIDEO_JSON);
  for (let i = 0; i < 2; i++) { enqueueLocal({ room: CODE, storyboard: path.join(dir, 'download.png'), json: path.join(dir, 'video.json'), res: '360p' }); await sleep(1100); }
  await setDbUrl(REAL);
  await assert.rejects(() => T.pushBatch(null, LOCAL, { room: 'TIDAK-ADA' }, () => {}), /tidak ditemukan/);
  const admin = await asUser('admin');
  await assert.rejects(() => T.pushBatch(admin, LOCAL, { room: CODE }, () => {}), /maksimal 10 video/);
  const b = (await fake.sql(`select status from ugc_batches order by created_at desc limit 1`)).rows[0];
  assert.equal(b.status, 'canceled', 'batch setengah jadi dibatalkan');
  assert.equal(T.localPending(LOCAL, CODE).length, 2, 'job lokal belum ditandai terkirim');
  await fake.sql(`update ugc_settings set value = '10' where key = 'max_jobs_per_batch'`);
  const r = await T.pushBatch(admin, LOCAL, { room: CODE }, () => {});
  assert.equal(r.queued, 2, 'kirim ulang berhasil'); assert.equal(T.localPending(LOCAL, CODE).length, 0);
});

test('doctor online: login agent, detak, dan migrasi 0500 terbaca LOLOS pada database yang sudah dimigrasi', async () => {
  const { supabaseCheck } = require(path.join(AGENT, 'src', 'index.js'));
  Object.assign(process.env, { AGENT_EMAIL: 'agent@x', AGENT_PASSWORD: 'pw-agent', AGENT_NAME: 'laptop-1' });
  const rows = []; await supabaseCheck((name, pass, note) => rows.push({ name, pass, note }));
  assert.ok(rows.every(r => r.pass), JSON.stringify(rows.filter(r => !r.pass)));
  assert.ok(rows.some(r => /Migrasi 20261005000500 terpasang/.test(r.name)));
  assert.ok(rows.some(r => r.name === 'Login Supabase sebagai akun agent'));
  const stuck = (await fake.sql(`select count(*)::int as n from ugc_jobs where claimed_by = '__doctor__'`)).rows[0].n; assert.equal(stuck, 0, 'doctor tidak mengubah job apa pun');
});

test('doctor online: database yang BELUM menjalankan 0500 → pemeriksaan gagal dengan petunjuk berkas SQL; login agent salah → gagal dengan pesan jelas', async () => {
  const { supabaseCheck } = require(path.join(AGENT, 'src', 'index.js'));
  const old = fake; const lama = await startFake({ omitFunctions: ['ugc_requeue_own'] });
  const url0 = process.env.SUPABASE_URL; process.env.SUPABASE_URL = lama.url;
  try {
    const rows = []; await supabaseCheck((name, pass, note) => rows.push({ name, pass, note }));
    const m = rows.find(r => /Migrasi 20261005000500/.test(r.name));
    assert.ok(m && !m.pass && /JALANKAN-0500\.sql/.test(m.note), JSON.stringify(rows));
    process.env.AGENT_PASSWORD = 'salah';
    const bad = []; await supabaseCheck((name, pass, note) => bad.push({ name, pass, note }));
    assert.ok(bad.some(r => r.name === 'Login Supabase sebagai akun agent' && !r.pass && /Login Supabase gagal/.test(r.note)));
  } finally { process.env.AGENT_PASSWORD = 'pw-agent'; process.env.SUPABASE_URL = url0; await lama.close(); void old; }
});

async function oneLocalJob(opts = {}) {
  const dir = path.join(TMP, `produk-${Date.now()}-${Math.floor(Math.random() * 1e6)}`); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'download.png'), PNG); fs.writeFileSync(path.join(dir, 'video.json'), VIDEO_JSON);
  const id = enqueueLocal({ room: CODE, storyboard: path.join(dir, 'download.png'), json: path.join(dir, 'video.json'), res: '360p', ...opts });
  await sleep(1100); return id;
}

test('arketipe dan kategori pada job lokal: --archetype dibatasi A-01..A-15, tercatat di job.json, dan menjadi arketipe produk di database', async () => {
  assert.throws(() => enqueueLocal({ room: CODE, storyboard: SB, json: JS, res: '360p', archetype: 'A-99' }), /Arketipe "A-99" tidak dikenal/);
  assert.equal(T.localPending(LOCAL, CODE).length, 0, 'penolakan tidak meninggalkan job');
  await oneLocalJob({ archetype: 'A-05' });
  const spec = JSON.parse(fs.readFileSync(path.join(T.localPending(LOCAL, CODE)[0].dir, 'job.json'), 'utf8')); assert.equal(spec.archetype_id, 'A-05');
  await setDbUrl(REAL);
  const r = await T.pushBatch(await asUser('admin'), LOCAL, { room: CODE }, () => {});
  const prod = (await fake.sql(`select p.archetype_id, p.risk_level from ugc_jobs j join ugc_products p on p.id = j.product_id where j.id = $1`, [r.jobs[0].job_id])).rows[0];
  assert.deepEqual(prod, { archetype_id: 'A-05', risk_level: 'sedang' });
  await fake.sql(`update ugc_jobs set status = 'canceled' where id = $1`, [r.jobs[0].job_id]);
});

test('produk berisiko tinggi: pengiriman berhenti dengan petunjuk SQL untuk admin, batch TIDAK dibatalkan, job lokal ditandai terkirim; setelah admin menyetujui job masuk antrean', async () => {
  await oneLocalJob({ archetype: 'A-07' });
  await setDbUrl(REAL);
  const admin = await asUser('admin');
  const err = await T.pushBatch(admin, LOCAL, { room: CODE }, () => {}).then(() => null, e => e);
  assert.ok(err && err.needsApproval, String(err && err.message));
  assert.match(err.message, /berisiko tinggi/); assert.match(err.message, /select ugc_approve_risk\('[0-9a-f-]{36}'/); assert.match(err.message, /select ugc_enqueue_batch\('[0-9a-f-]{36}'\)/);
  assert.equal((await fake.sql(`select status from ugc_batches where id = $1`, [err.batchId])).rows[0].status, 'approved', 'batch tidak dibatalkan');
  assert.equal(T.localPending(LOCAL, CODE).length, 0, 'job lokal ditandai terkirim, tidak terkirim dua kali');
  const [j] = (await fake.sql(`select id, status from ugc_jobs where batch_id = $1`, [err.batchId])).rows; assert.equal(j.status, 'approved');
  await admin.rpc('ugc_approve_risk', { p_job: j.id, p_note: 'izin edar sudah diperiksa' });
  assert.equal(await admin.rpc('ugc_enqueue_batch', { p_batch: err.batchId }), 1);
  assert.equal((await fake.sql(`select status from ugc_jobs where id = $1`, [j.id])).rows[0].status, 'queued');
  await fake.sql(`update ugc_jobs set status = 'canceled' where id = $1`, [j.id]);
});

test('kategori yang salah ketik ditolak SEBELUM mengirim apa pun, dengan pesan awam; kategori yang benar menurunkan arketipe dari peta', async () => {
  await oneLocalJob({ category: 'Pakaian Wanita > Piyama Ngawur' });
  await setDbUrl(REAL);
  const admin = await asUser('admin');
  const batchesBefore = (await fake.sql(`select count(*)::int as n from ugc_batches`)).rows[0].n;
  await assert.rejects(() => T.pushBatch(admin, LOCAL, { room: CODE }, () => {}), /Kategori produk tidak dikenal: "Pakaian Wanita > Piyama Ngawur"\. Salin kunci kategori persis dari kolom Kunci_Lookup.*Tidak ada yang dikirim/);
  assert.equal((await fake.sql(`select count(*)::int as n from ugc_batches`)).rows[0].n, batchesBefore, 'tidak ada batch atau produk yang dibuat (diperiksa sebelum mengirim)');
  assert.equal(T.localPending(LOCAL, CODE).length, 1, 'job lokal belum ditandai terkirim, bisa dikirim ulang');
  fs.rmSync(T.localPending(LOCAL, CODE)[0].dir, { recursive: true, force: true });
  await oneLocalJob({ category: 'Pakaian Wanita > Pakaian Tidur & Piyama > Daster' });
  const r = await T.pushBatch(admin, LOCAL, { room: CODE }, () => {});
  const prod = (await fake.sql(`select p.archetype_id, p.category_key, p.risk_level from ugc_jobs j join ugc_products p on p.id = j.product_id where j.id = $1`, [r.jobs[0].job_id])).rows[0];
  assert.deepEqual(prod, { archetype_id: 'A-01', category_key: 'Pakaian Wanita > Pakaian Tidur & Piyama > Daster', risk_level: 'rendah' });
  await fake.sql(`update ugc_jobs set status = 'canceled' where id = $1`, [r.jobs[0].job_id]);
});
