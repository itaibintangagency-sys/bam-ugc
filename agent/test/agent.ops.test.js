'use strict';
// Pengujian operasional: kunci agent tunggal, perintah "jalankan semua", foto wajah karakter (bahan kedua), nama akun pada doctor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bamugc-ops-'));
const PORT = 9341;
const MOCK = 'file://' + path.join(__dirname, 'mockflow.html');
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const baseCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'flow.labels.json'), 'utf8'));
baseCfg.timeouts = { generate_sec: 40, upload_sec: 20, poll_ms: 150, start_sec: 15, settle_sec: 1, find_video_sec: 6 };
const cfgFile = path.join(TMP, 'flow.fast.json');
fs.writeFileSync(cfgFile, JSON.stringify(baseCfg));
Object.assign(process.env, {
  PAGE_MATCH: 'mockflow', CDP_URL: `http://127.0.0.1:${PORT}`, FLOW_CONFIG: cfgFile, SOURCE: 'local', ALLOW_ANY_PROJECT_URL: '1',
  HUMAN_POLL_MS: '300', HUMAN_WAIT_MS: '4000', IDLE_MS: '100', LOCAL_BACKOFF_MIN: '0', FIND_VIDEO_MS: '5000', TOKEN_CHECK_MS: '1500', FIND_RETRY_MS: '400',
  DOWNLOAD_WAIT_MS: '3000', MIN_VIDEO_BYTES: '1000', DOWNLOAD_DIR: path.join(TMP, 'downloads'), WORK_DIR: path.join(TMP, 'work'), POLICY_RETRIES: '2',
  AGENT_LOCK_DIR: path.join(TMP, 'locks')
});
fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true }); fs.mkdirSync(process.env.AGENT_LOCK_DIR, { recursive: true });

const { runLoop, enqueueLocal, doctor } = require('../src/index.js');
const { LocalSource } = require('../src/sources/localSource');
const { acquireAgentLock, lockFile } = require('../src/lock');
const core = require('../../core/src');

const silent = { info() {}, warn() {}, error() {}, file: '' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = q => `${MOCK}?${q}&t=${Date.now()}${Math.floor(Math.random() * 1000)}`;
const prof = { photos: [{ role: 'depan' }, { role: 'closeup' }], facts: ['Lengan pendek'], colors: [],
  details: ['detail_utama', 'motif_kain', 'lengan_bawahan_hem', 'siluet_panjang'].map(k => ({ slot_key: k, text: k, label: k, confidence: 0.9 })) };
const VIDEO_JSON = core.buildVideoJson(core.buildPanelPlan({ archetypeId: 'A-01', productProfile: prof, settingId: 'S-01', seed: 3 }), { characterCode: 'C02', jobTag: 'PRODUCT-01', productProfile: prof, characterPhotoAttached: true });
const localRoot = name => { const r = path.join(TMP, name); fs.mkdirSync(r, { recursive: true }); return r; };
function makeLocalJob(root, projectUrl, id, extra = false) {
  const dir = path.join(root, 'inbox', id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'storyboard.png'), PNG); fs.writeFileSync(path.join(dir, 'prompt.json'), VIDEO_JSON);
  if (extra) fs.writeFileSync(path.join(dir, 'extra1.png'), PNG);
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ project_url: projectUrl, resolution: '360p', duration_sec: 10, storyboard_file: 'storyboard.png', video_json_file: 'prompt.json', ...(extra ? { extra_files: ['extra1.png'] } : {}) }));
  return id;
}
const status = (root, id) => JSON.parse(fs.readFileSync(path.join(root, 'inbox', id, 'status.json'), 'utf8'));
const dbg = st => JSON.stringify({ galat: st.last_error, status: st.status, akhir: (st.history || []).slice(-3).map(h => h.step + ': ' + String(h.message).slice(0, 60)) });

let chromeProc, probe;
const pageNow = () => probe.contexts()[0].pages().find(p => p.url().includes('mockflow'));
const counters = () => pageNow().evaluate(() => ({ g: window.__generated, f: window.__forbidden, d: window.__downloads, last: window.__lastGen }));

test.before(async () => {
  chromeProc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(TMP, 'profile')}`, MOCK], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { probe = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await sleep(300); } }
  assert.ok(probe, 'Chrome uji berjalan');
});
test.after(async () => { try { await probe.close(); } catch { /* abaikan */ } if (chromeProc) chromeProc.kill('SIGKILL'); });

test('kunci agent: agent kedua pada Chrome yang sama ditolak dengan pesan jelas, dan tidak menyentuh job', async () => {
  const root = localRoot('kunci'); const id = makeLocalJob(root, url('delay=300&lang=en'), 'k1');
  const file = lockFile(root, process.env.CDP_URL);
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });   // "agent lain" yang hidup
  fs.writeFileSync(file, JSON.stringify({ pid: child.pid, started: '2026-10-04T00:00:00.000Z', host: 'x' }));
  await assert.rejects(() => runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 1 }), /Agent lain sedang berjalan pada Chrome yang sama \(PID \d+/);
  assert.ok(!fs.existsSync(path.join(root, 'inbox', id, 'status.json')), 'job tidak disentuh');
  assert.ok(fs.existsSync(file), 'kunci milik agent lain tidak dihapus');
  child.kill('SIGKILL'); await new Promise(r => child.once('exit', r));
  await runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });   // pemilik sudah mati: kunci basi diambil alih
  assert.equal(status(root, id).status, 'downloaded', dbg(status(root, id)));
  assert.ok(!fs.existsSync(file), 'kunci dilepas setelah selesai');
});

test('kunci agent: dilepas juga bila agent gagal tersambung, dan kunci dalam proses yang sama tidak menghalangi dirinya sendiri', async () => {
  const f = path.join(TMP, 'sendiri.lock');
  const a = acquireAgentLock(f); assert.ok(a.ok);
  const b = acquireAgentLock(f); assert.ok(b.ok, 'proses yang sama boleh mengambil ulang (bukan agent lain)');
  b.release(); assert.ok(!fs.existsSync(f));
  const old = process.env.CDP_URL; process.env.CDP_URL = 'http://127.0.0.1:1';
  const root = localRoot('gagal-sambung');
  await assert.rejects(() => runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 1, noRetryConnect: true }));
  assert.ok(!fs.existsSync(lockFile(root, 'http://127.0.0.1:1')), 'kunci terlepas setelah galat');
  process.env.CDP_URL = old;
});

test('jalankan semua: tiga job diproses berurutan sampai antrean kosong, lalu berhenti sendiri dengan ringkasan', async () => {
  const root = localRoot('semua');
  const p = url('delay=300&lang=id');
  makeLocalJob(root, p, 'job-a'); makeLocalJob(root, p, 'job-b'); makeLocalJob(root, p, 'job-c');
  const lines = []; const log = { info: m => lines.push(m), warn: m => lines.push(m), error: m => lines.push(m), file: '' };
  const src = new LocalSource(root, { backoffMinutes: 0 });
  const n = await runLoop({ source: src, log, idleExit: true, noRetryConnect: true, repeatOnResume: true });
  assert.equal(n, 3);
  for (const id of ['job-a', 'job-b', 'job-c']) assert.equal(status(root, id).status, 'downloaded', id);
  const rows = src.summary();
  assert.deepEqual(rows.map(r => r.status), ['downloaded', 'downloaded', 'downloaded']);
  assert.ok(rows.every(r => /video\.mp4$/.test(r.video)), 'jalur video tercatat');
  const c = await counters(); assert.equal(c.g >= 3, true); assert.equal(c.f, 0);
});

test('foto wajah karakter: dilampirkan sebagai bahan kedua, generate berjalan dengan dua bahan, JSON tidak berubah selain kode job', async () => {
  const root = localRoot('foto'); const id = makeLocalJob(root, url('delay=300&lang=en'), 'job-foto', true);
  await runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });
  const st = status(root, id), c = await counters();
  assert.equal(st.status, 'downloaded', dbg(st));
  assert.ok(st.history.some(h => h.step === 'attach') && st.history.some(h => h.step === 'attach_extra'), 'kedua lampiran tercatat');
  assert.equal(c.last.chips, 2, 'dua bahan terlampir saat generate');
  assert.match(c.last.prompt, /separate close-up portrait photo of the woman is attached/);
});

test('foto wajah karakter: bila bahan kedua gagal terlampir, job berhenti sebelum generate (kredit aman)', async () => {
  const root = localRoot('foto-gagal'); const id = makeLocalJob(root, url('delay=300&lang=en&maxchips=1'), 'job-foto2', true);
  await runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });
  const st = status(root, id), c = await counters();
  assert.notEqual(st.status, 'downloaded');
  assert.match(String(st.last_error), /Bahan tidak terlampir \(diharapkan 2, terlihat: 1\)/);
  assert.ok(st.history.some(h => h.step === 'attach'), 'storyboard sempat terlampir');
  assert.ok(!st.history.some(h => h.step === 'generate_start' || h.step === 'generate'), 'generate tidak ditekan');
  assert.equal(c.g, 0, 'tidak ada video dibuat (halaman baru, penghitung nol)');
});

test('enqueue-local --extra: foto disalin ke folder job dan dicatat; berkas yang tidak ada ditolak dengan pesan jelas', () => {
  const root = localRoot('enq'); process.env.LOCAL_DIR = root;
  const sb = path.join(TMP, 'sb.png'), js = path.join(TMP, 'v.json'), ex = path.join(TMP, 'wajah.jpg');
  fs.writeFileSync(sb, PNG); fs.writeFileSync(js, VIDEO_JSON); fs.writeFileSync(ex, PNG);
  enqueueLocal({ project: 'https://flow.google.com/project/abc', storyboard: sb, json: js, res: '360p', extra: ex });
  const id = fs.readdirSync(path.join(root, 'inbox'))[0];
  const spec = JSON.parse(fs.readFileSync(path.join(root, 'inbox', id, 'job.json'), 'utf8'));
  assert.deepEqual(spec.extra_files, ['extra1.jpg']); assert.ok(fs.existsSync(path.join(root, 'inbox', id, 'extra1.jpg')));
  assert.throws(() => enqueueLocal({ project: 'https://flow.google.com/project/abc', storyboard: sb, json: js, extra: path.join(TMP, 'tidak-ada.png') }), /Foto tambahan tidak ditemukan/);
  delete process.env.LOCAL_DIR;
});

test('doctor: menampilkan nama akun Google tanpa email', async () => {
  await pageNow().goto(url('lang=en&delay=300'));
  const rows = await doctor();
  const r = rows.find(x => x.name === 'Akun Google yang dipakai Flow');
  assert.ok(r && r.pass, JSON.stringify(rows.filter(x => !x.pass)));
  assert.equal(r.note, 'Uji Bintang'); assert.ok(!/@/.test(r.note));
});

test('berkas bat: 4 menanyakan foto wajah (opsional) dan 5b memanggil perintah "all"', () => {
  const b4 = fs.readFileSync(path.join(__dirname, '..', '4-buat-job-offline.bat'), 'utf8');
  const b5 = fs.readFileSync(path.join(__dirname, '..', '5b-jalankan-semua-job-offline.bat'), 'utf8');
  assert.ok(b4.includes('\r\n') && b5.includes('\r\n'));
  assert.match(b4, /Foto wajah karakter \(disarankan; Enter untuk melewati\)/); assert.match(b4, /--extra "%EXTRA%"/);
  assert.match(b5, /node src\/index\.js all/);
});
