'use strict';
// Pengujian keandalan: kode job pada prompt, pencarian video lewat kode, deteksi selesai berlapis, dan pemulihan setelah agent mati.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bamugc-rel-'));
const PORT = 9340;
const MOCK = 'file://' + path.join(__dirname, 'mockflow.html');
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const baseCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'flow.labels.json'), 'utf8'));
baseCfg.timeouts = { generate_sec: 40, upload_sec: 20, poll_ms: 150, start_sec: 15, settle_sec: 1, find_video_sec: 6 };
const cfgFile = path.join(TMP, 'flow.fast.json');
fs.writeFileSync(cfgFile, JSON.stringify(baseCfg));
Object.assign(process.env, {
  PAGE_MATCH: 'mockflow', CDP_URL: `http://127.0.0.1:${PORT}`, FLOW_CONFIG: cfgFile, SOURCE: 'local', ALLOW_ANY_PROJECT_URL: '1',
  HUMAN_POLL_MS: '300', HUMAN_WAIT_MS: '4000', IDLE_MS: '100', LOCAL_BACKOFF_MIN: '0', FIND_VIDEO_MS: '5000', TOKEN_CHECK_MS: '1500',
  FIND_RETRY_MS: '400', PROCESS_END_MS: '20000', DOWNLOAD_WAIT_MS: '3000',
  MIN_VIDEO_BYTES: '1000', DOWNLOAD_DIR: path.join(TMP, 'downloads'), WORK_DIR: path.join(TMP, 'work'), POLICY_RETRIES: '2'
});
fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });

const { runLoop } = require('../src/index.js');
const { LocalSource } = require('../src/sources/localSource');
const { makeJobToken, withToken } = require('../src/generation');
const core = require('../../core/src');

const silent = { info() {}, warn() {}, error() {}, file: '' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = q => `${MOCK}?${q}&t=${Date.now()}${Math.floor(Math.random() * 1000)}`;
const prof = { photos: [{ role: 'depan' }, { role: 'closeup' }], facts: ['Lengan pendek'], colors: [],
  details: ['detail_utama', 'motif_kain', 'lengan_bawahan_hem', 'siluet_panjang'].map(k => ({ slot_key: k, text: k, label: k, confidence: 0.9 })) };
const VIDEO_JSON = core.buildVideoJson(core.buildPanelPlan({ archetypeId: 'A-01', productProfile: prof, settingId: 'S-01', seed: 3 }), { characterCode: 'C02', jobTag: 'PRODUCT-01', productProfile: prof });
const localRoot = name => { const r = path.join(TMP, name); fs.mkdirSync(r, { recursive: true }); return r; };
function makeLocalJob(root, projectUrl, id = 'job1') {
  const dir = path.join(root, 'inbox', id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'storyboard.png'), PNG); fs.writeFileSync(path.join(dir, 'prompt.json'), VIDEO_JSON);
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ project_url: projectUrl, resolution: '360p', duration_sec: 10, storyboard_file: 'storyboard.png', video_json_file: 'prompt.json' }));
  return id;
}
const statusFile = (root, id) => path.join(root, 'inbox', id, 'status.json');
const status = (root, id) => JSON.parse(fs.readFileSync(statusFile(root, id), 'utf8'));
const dbg = st => JSON.stringify({ galat: st.last_error, jenis: st.error_kind, status: st.status, akhir: (st.history || []).slice(-4).map(h => h.step + ': ' + String(h.message).slice(0, 70)) });
const runOnce = (root) => runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });

let chromeProc, probe;
const pageNow = () => probe.contexts()[0].pages().find(p => p.url().includes('mockflow'));
const counters = () => pageNow().evaluate(() => ({ g: window.__generated, f: window.__forbidden, d: window.__downloads, last: window.__lastGen, dp: window.__downloadedPrompt }));

test.before(async () => {
  chromeProc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(TMP, 'profile')}`, MOCK], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { probe = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await sleep(300); } }
  assert.ok(probe, 'Chrome uji berjalan');
});
test.after(async () => { try { await probe.close(); } catch { /* abaikan */ } if (chromeProc) chromeProc.kill('SIGKILL'); });

test('kode job: stabil per job, berbeda antar job, dan sisipan pada judul prompt bersifat idempoten', () => {
  const a = makeJobToken('job-1'), b = makeJobToken('job-2');
  assert.match(a, /^J[0-9A-Z]{5}$/); assert.equal(a, makeJobToken('job-1')); assert.notEqual(a, b);
  const once = withToken(VIDEO_JSON, a);
  assert.equal(JSON.parse(once).project.title, `${a} | ${JSON.parse(VIDEO_JSON).project.title}`);
  assert.equal(withToken(once, a), once, 'tidak ganda');
  assert.equal(JSON.stringify(JSON.parse(once).timeline), JSON.stringify(JSON.parse(VIDEO_JSON).timeline), 'isi lain tidak berubah');
  assert.equal(JSON.parse(withToken('{"a":1}', a)).project.title, a, 'tanpa project: dibuat');
  assert.match(withToken('{"project": {"title": "X"  rusak', a), new RegExp(`"title": "${a} \\| X`), 'JSON rusak: sisip lewat teks');
  assert.equal(withToken('{"x":"@[Sari]"}', null), '{"x":"@[Sari]"}', 'tanpa kode: tidak diubah');
  assert.match(withToken('{"project":{"title":"T"},"r":"Use @[Sari] now"}', a), /@\[Sari\]/, 'penanda karakter tetap utuh');
});

test('alur normal: kode job tertulis di prompt, video ditemukan lewat kode, diunduh, dan alamat tercatat', async () => {
  const root = localRoot('normal'); const id = makeLocalJob(root, url('delay=400&lang=en&detail=new'));
  await runOnce(root);
  const st = status(root, id), token = makeJobToken(id), c = await counters();
  assert.equal(st.status, 'downloaded', dbg(st));
  assert.ok(c.last.prompt.includes(`"title": "${token} |`), 'kode job ada di judul prompt yang diketik');
  assert.ok(c.dp.includes(token), 'video yang diunduh adalah milik job ini');
  const ready = st.history.find(h => h.step === 'video_ready');
  assert.ok(ready && ready.data.tile_diperiksa >= 1 && /#\/edit\//.test(ready.data.url));
  assert.ok(st.history.some(h => h.step === 'generate_start') && st.history.some(h => h.step === 'generate'));
  assert.equal(c.g, 1); assert.equal(c.f, 0);
});

test('gambar mini video baru tidak pernah terbaca: jalur cadangan (penanda proses hilang) tetap menemukan videonya', async () => {
  const root = localRoot('lazy'); const id = makeLocalJob(root, url('delay=500&lang=id&lazythumbs=1'));
  await runOnce(root);
  const st = status(root, id), c = await counters();
  assert.equal(st.status, 'downloaded', dbg(st));
  assert.ok(st.history.some(h => h.step === 'wait' && /dicari lewat kode job/.test(h.message)), 'memakai jalur cadangan');
  assert.ok(c.dp.includes(makeJobToken(id)));
  assert.equal(c.g, 1);
});

test('video baru bukan tile pertama: tile lain dibuka dan diperiksa, yang diunduh tetap milik job ini', async () => {
  const root = localRoot('bukan-pertama'); const id = makeLocalJob(root, url('delay=500&lang=en&topisold=1'));
  await runOnce(root);
  const st = status(root, id), c = await counters();
  assert.equal(st.status, 'downloaded', dbg(st));
  const ready = st.history.find(h => h.step === 'video_ready');
  assert.ok(ready.data.tile_diperiksa >= 2, 'memeriksa lebih dari satu tile: ' + ready.data.tile_diperiksa);
  assert.ok(c.dp.includes(makeJobToken(id)), 'bukan video lama');
});

test('agent mati setelah generate ditekan: dijalankan lagi, video dicari lewat kode job dan TIDAK generate ulang', async () => {
  const root = localRoot('mati'); const id = makeLocalJob(root, url('delay=5000&lang=en'));
  const code = `
    const { runLoop } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'index.js'))});
    const { LocalSource } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'sources', 'localSource.js'))});
    runLoop({ source: new LocalSource(${JSON.stringify(root)}, { backoffMinutes: 0 }), log: { info() {}, warn() {}, error() {} }, maxJobs: 1 }).then(() => process.exit(0), e => { console.error(e); process.exit(1); });`;
  const child = spawn(process.execPath, ['-e', code], { env: process.env, stdio: 'ignore' });
  let sawGenerate = false;
  for (let i = 0; i < 150 && !sawGenerate; i++) {
    await sleep(200);
    try { sawGenerate = status(root, id).history.some(h => h.step === 'generate'); } catch { /* belum ada */ }
  }
  assert.ok(sawGenerate, 'generate sempat ditekan');
  child.kill('SIGKILL'); await new Promise(r => child.once('exit', r));
  assert.equal(status(root, id).status, 'running', 'job tersangkut berstatus running');
  assert.equal((await counters()).g, 0, 'video belum jadi saat agent mati');

  await runOnce(root);   // agent dijalankan lagi
  const st = status(root, id), c = await counters();
  assert.equal(st.status, 'downloaded', dbg(st));
  assert.ok(st.history.some(h => h.step === 'requeue' && /tanpa generate ulang/.test(h.message)));
  assert.ok(st.history.some(h => h.step === 'locate'), 'jalur pencarian dipakai');
  assert.equal(c.g, 1, 'tetap satu kali generate'); assert.ok(c.dp.includes(makeJobToken(id)));
});

test('generate pernah ditekan tetapi videonya tidak ada: gagal tetap dengan pesan jelas, tidak generate ulang', async () => {
  const root = localRoot('hilang'); const id = makeLocalJob(root, url('delay=300&lang=en'));
  fs.writeFileSync(statusFile(root, id), JSON.stringify({ status: 'running', attempts: 1, history: [{ at: new Date().toISOString(), kind: 'info', step: 'generate_start', message: 'x' }] }));
  await pageNow().goto(url('delay=300&lang=en'));
  const g0 = (await counters()).g;
  await runOnce(root);
  const st = status(root, id);
  assert.equal(st.status, 'failed', dbg(st)); assert.equal(st.error_kind, 'fatal');
  assert.match(st.last_error, /Video dengan kode job J[0-9A-Z]{5} tidak ditemukan/);
  assert.match(st.last_error, /TIDAK generate ulang/);
  assert.equal((await counters()).g, g0, 'tidak ada generate baru');
});

test('job tersangkut sebelum generate ditekan dikembalikan ke antrean biasa; yang sesudah generate ditandai', async () => {
  const root = localRoot('stale'); const a = makeLocalJob(root, 'https://flow.google.com/project/x', 'a'), b = makeLocalJob(root, 'https://flow.google.com/project/x', 'b'), c = makeLocalJob(root, 'https://flow.google.com/project/x', 'c');
  fs.writeFileSync(statusFile(root, a), JSON.stringify({ status: 'running', attempts: 1, history: [{ step: 'settings', message: 'x' }] }));
  fs.writeFileSync(statusFile(root, b), JSON.stringify({ status: 'running', attempts: 1, history: [{ step: 'generate', message: 'x' }] }));
  fs.writeFileSync(statusFile(root, c), JSON.stringify({ status: 'downloaded', attempts: 1, history: [] }));
  const src = new LocalSource(root, { backoffMinutes: 0 });
  assert.equal(await src.requeueStale(), 2, 'dua job running dikembalikan, yang selesai dibiarkan');
  assert.equal(status(root, a).status, 'queued'); assert.equal(status(root, b).status, 'queued'); assert.equal(status(root, c).status, 'downloaded');
  const ja = await src.claim(), jb = await src.claim();
  assert.deepEqual([ja.job_id, ja.generated, ja.flow_asset_url], ['a', false, null]);
  assert.deepEqual([jb.job_id, jb.generated, jb.flow_asset_url], ['b', true, null]);
  assert.match(status(root, b).history.find(h => h.step === 'requeue').message, /video akan dicari lewat kode job/);
});

test('start-chrome.bat: membawa opsi anti-penundaan saat jendela tertutup, dan tetap format Windows', () => {
  const bat = fs.readFileSync(path.join(__dirname, '..', 'start-chrome.bat'), 'utf8');
  assert.ok(bat.includes('\r\n'));
  for (const f of ['--remote-debugging-port=9222', '--user-data-dir="C:\\flow-agent-profile"', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']) assert.ok(bat.includes(f), f);
});

test('jalur cadangan tidak menyimpulkan selesai selama penanda proses masih menyala (mis. setelah klik ulang kartu gagal)', async () => {
  const root = localRoot('cadangan-aman'); const id = makeLocalJob(root, url('delay=2500&lang=id&fail=1'));
  const t0 = Date.now();
  await runOnce(root);
  const st = status(root, id), c = await counters();
  assert.equal(st.status, 'downloaded', dbg(st));
  assert.ok(st.history.some(h => h.step === 'wait' && /Video selesai dibuat/.test(h.message)), 'selesai lewat gambar mini, bukan cadangan');
  assert.equal(c.g, 1);
  assert.ok(Date.now() - t0 > 4000, 'menunggu dua putaran proses (gagal lalu diulang)');
});

test('kartu gagal (kebijakan) berarti tidak ada video: percobaan berikutnya generate seperti biasa, bukan mencari video', async () => {
  const root = localRoot('gagal-kebijakan');
  const id = makeLocalJob(root, 'https://flow.google.com/project/x', 'g1');
  const src = new LocalSource(root, { backoffMinutes: 0 });
  fs.writeFileSync(statusFile(root, id), JSON.stringify({ status: 'queued', attempts: 1, history: [
    { step: 'generate_start' }, { step: 'generate' }, { step: 'generate_failed', message: 'Gagal (policy)' }] }));
  assert.equal((await src.claim()).generated, false, 'sesudah kartu gagal: boleh generate lagi');
  fs.writeFileSync(statusFile(root, id), JSON.stringify({ status: 'queued', attempts: 2, history: [
    { step: 'generate_start' }, { step: 'generate' }, { step: 'generate_failed' }, { step: 'generate_start' }, { step: 'generate' }] }));
  assert.equal((await src.claim()).generated, true, 'generate lagi ditekan setelah gagal: kini mungkin ada video');
  fs.writeFileSync(statusFile(root, id), JSON.stringify({ status: 'queued', attempts: 2, history: [
    { step: 'generate_start' }, { step: 'generate' }, { step: 'generate_timeout' }] }));
  assert.equal((await src.claim()).generated, true, 'waktu tunggu habis: video masih bisa jadi, tanda dipertahankan');
});
