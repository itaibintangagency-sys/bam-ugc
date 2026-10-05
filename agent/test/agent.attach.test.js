'use strict';
// Pengujian pelampiran bahan (klik item, lalu "Add to prompt"), periksa ulang pengaturan, dan validasi alamat project.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bamugc-attach-'));
const PORT = 9337;
const MOCK = 'file://' + path.join(__dirname, 'mockflow.html');
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const baseCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'flow.labels.json'), 'utf8'));
baseCfg.timeouts = { generate_sec: 40, upload_sec: 20, poll_ms: 150, start_sec: 15 };
const cfgFile = path.join(TMP, 'flow.fast.json');
fs.writeFileSync(cfgFile, JSON.stringify(baseCfg));
Object.assign(process.env, {
  PAGE_MATCH: 'mockflow', CDP_URL: `http://127.0.0.1:${PORT}`, FLOW_CONFIG: cfgFile, SOURCE: 'local', ALLOW_ANY_PROJECT_URL: '1',
  HUMAN_POLL_MS: '300', HUMAN_WAIT_MS: '2500', IDLE_MS: '100', LOCAL_BACKOFF_MIN: '0',
  MIN_VIDEO_BYTES: '1000', DOWNLOAD_DIR: path.join(TMP, 'downloads'), WORK_DIR: path.join(TMP, 'work'), POLICY_RETRIES: '2'
});
fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });

const { runLoop, enqueueLocal } = require('../src/index.js');
const { LocalSource } = require('../src/sources/localSource');
const { FlowDriver } = require('../src/flowDriver');
const core = require('../../core/src');

const silent = { info() {}, warn() {}, error() {}, file: '' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = q => `${MOCK}?${q}&t=${Date.now()}${Math.floor(Math.random() * 1000)}`;

const prof = { photos: [{ role: 'depan' }, { role: 'belakang' }, { role: 'closeup' }], facts: ['Lengan pendek'], colors: [],
  details: ['detail_utama', 'motif_kain', 'lengan_bawahan_hem', 'siluet_panjang'].map(k => ({ slot_key: k, text: k, label: k, confidence: 0.9 })) };
const VIDEO_JSON = core.buildVideoJson(core.buildPanelPlan({ archetypeId: 'A-01', productProfile: prof, settingId: 'S-01', seed: 3 }), { characterCode: 'C02', jobTag: 'uji', productProfile: prof });

const localRoot = name => { const r = path.join(TMP, name); fs.mkdirSync(r, { recursive: true }); return r; };
function makeLocalJob(root, projectUrl, id = 'job1') {
  const dir = path.join(root, 'inbox', id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'storyboard.png'), PNG); fs.writeFileSync(path.join(dir, 'prompt.json'), VIDEO_JSON);
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ project_url: projectUrl, resolution: '360p', duration_sec: 10, storyboard_file: 'storyboard.png', video_json_file: 'prompt.json' }));
  return id;
}
const dbg = st => JSON.stringify({ galat: st.last_error, jenis: st.error_kind, akhir: (st.history || []).slice(-3).map(h => h.step + ': ' + h.message) });
const status = (root, id) => JSON.parse(fs.readFileSync(path.join(root, 'inbox', id, 'status.json'), 'utf8'));
const runOne = async (root, q) => { const id = makeLocalJob(root, url(q)); await runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 1 }); return { id, st: status(root, id) }; };
const withEnv = async (env, fn) => { const old = {}; for (const k of Object.keys(env)) { old[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; } try { return await fn(); } finally { for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } } };

let chromeProc, probe;
const pageNow = () => probe.contexts()[0].pages().find(p => p.url().includes('mockflow'));
const counters = () => pageNow().evaluate(() => ({ f: window.__forbidden, g: window.__generated, last: window.__lastGen }));

test.before(async () => {
  chromeProc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(TMP, 'profile')}`, MOCK], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { probe = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await sleep(300); } }
  assert.ok(probe, 'Chrome uji berjalan');
});
test.after(async () => { try { await probe.close(); } catch { /* abaikan */ } if (chromeProc) chromeProc.kill('SIGKILL'); });

for (const lang of ['en', 'id']) {
  test(`[${lang}] tampilan baru: klik item membuka pratinjau, "Add to prompt" melampirkan (gambar kecil di komposer), lalu generate`, async () => {
    const root = localRoot('baru-' + lang);
    const { st } = await runOne(root, `delay=400&lang=${lang}`);
    assert.equal(st.status, 'downloaded', dbg(st));
    const c = await counters();
    assert.equal(c.last.chips, 1); assert.equal(c.g, 1); assert.equal(c.f, 0);
    assert.match(c.last.chip, lang === 'en' ? /10s/ : /10 dtk/);
    assert.ok(st.history.some(h => h.step === 'attach'), 'langkah lampir tercatat');
    assert.ok(st.history.some(h => h.step === 'settings_check' && /360p/.test(h.message)), 'pengaturan diperiksa ulang sebelum generate');
  });

  test(`[${lang}] pengaturan berubah setelah melampirkan (durasi jadi 8): diperbaiki sebelum generate`, async () => {
    const root = localRoot('reset-' + lang);
    const { st } = await runOne(root, `delay=400&lang=${lang}&resetsettings=1`);
    assert.equal(st.status, 'downloaded', dbg(st));
    const c = await counters();
    assert.match(c.last.chip, lang === 'en' ? /360p · 10s/ : /360p · 10 dtk/, 'generate memakai 10 detik, bukan 8');
    assert.equal(c.g, 1);
  });
}

test('tampilan lama (klik item langsung melampirkan, tombol bahan lama) tetap berfungsi', async () => {
  const root = localRoot('lama');
  const { st } = await runOne(root, 'delay=400&lang=id&legacy=1');
  assert.equal(st.status, 'downloaded', dbg(st));
  assert.equal((await counters()).last.chips, 1);
});

test('tampilan baru dengan tombol bahan lama (chip-container) tetap terhitung satu', async () => {
  const root = localRoot('campur');
  const { st } = await runOne(root, 'delay=400&lang=en&oldchips=1');
  assert.equal(st.status, 'downloaded', dbg(st));
});

test('lampiran gagal (tombol Add to prompt tidak ada): berhenti sebelum generate, pesan memuat daftar tombol', async () => {
  const root = localRoot('gagal');
  const { st } = await runOne(root, 'delay=300&lang=en&noadd=1');
  assert.equal(st.status, 'queued', 'dijadwalkan ulang, belum gagal permanen');
  assert.match(st.last_error, /Bahan tidak terlampir \(diharapkan 1, terlihat: 0\)/);
  assert.match(st.last_error, /Tombol yang terlihat: /);
  assert.equal((await counters()).g, 0, 'tidak ada generate');
});

test('alamat project: bukan alamat Flow ditolak sebelum browser dibuka ke mana pun', async () => {
  await withEnv({ ALLOW_ANY_PROJECT_URL: undefined }, async () => {
    const fd = new FlowDriver({ page: {}, cfg: baseCfg, log: silent });
    for (const bad of ['C:\\aset', 'file:///C:/aset/', 'https://example.com/project/abc', 'https://flow.google.com/project/', 'https://flow.google.com/', '']) {
      await assert.rejects(() => fd.openProject(bad), e => /bukan alamat Flow/.test(e.message) && e.kind === 'fatal', JSON.stringify(bad));
    }
    for (const good of ['https://flow.google.com/project/4c35f151-5466-4c3a-826c-d888f15cf7c0', 'https://flow.google.com/u/1/project/4c35f151']) assert.doesNotThrow(() => fd.assertProjectUrl(good), good);
  });
});

test('alamat project lokal yang salah membuat job gagal tetap dengan pesan jelas, tanpa mengubah halaman Chrome', async () => {
  await withEnv({ ALLOW_ANY_PROJECT_URL: undefined }, async () => {
    const before = pageNow().url();
    const root = localRoot('urlsalah');
    const id = makeLocalJob(root, 'file:///C:/aset/');
    await runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });
    const st = status(root, id);
    assert.equal(st.status, 'failed'); assert.equal(st.error_kind, 'fatal'); assert.match(st.last_error, /Alamat project bukan alamat Flow/);
    assert.equal(pageNow().url(), before, 'Chrome tidak dinavigasi ke alamat salah');
  });
});

test('enqueue-local: memeriksa alamat project, berkas, JSON valid, dan penanda {{...}}', async () => {
  const d = localRoot('enq'); const sb = path.join(d, 's.png'), js = path.join(d, 'p.json');
  fs.writeFileSync(sb, PNG); fs.writeFileSync(js, '{"a":1}');
  await withEnv({ ALLOW_ANY_PROJECT_URL: undefined, LOCAL_DIR: path.join(d, 'local') }, async () => {
    const ok = 'https://flow.google.com/project/4c35f151-5466-4c3a-826c-d888f15cf7c0';
    assert.throws(() => enqueueLocal({ project: 'C:\\aset', storyboard: sb, json: js }), /bukan alamat Flow/);
    assert.throws(() => enqueueLocal({ project: 'https://flow.google.com/project/', storyboard: sb, json: js }), /bukan alamat Flow/);
    assert.throws(() => enqueueLocal({ project: ok, storyboard: path.join(d, 'tidak-ada.png'), json: js }), /Storyboard tidak ditemukan/);
    assert.throws(() => enqueueLocal({ project: ok, storyboard: sb, json: path.join(d, 'tidak-ada.json') }), /JSON prompt tidak ditemukan/);
    fs.writeFileSync(js, '{rusak'); assert.throws(() => enqueueLocal({ project: ok, storyboard: sb, json: js }), /bukan JSON yang valid/);
    fs.writeFileSync(js, '{"lokasi":"{{LOKASI}}"}'); assert.throws(() => enqueueLocal({ project: ok, storyboard: sb, json: js }), /penanda \{\{/);
    fs.writeFileSync(js, '{"a":1}');
    const id = enqueueLocal({ project: ok, storyboard: sb, json: js, res: '360p' });
    assert.ok(fs.existsSync(path.join(d, 'local', 'inbox', id, 'job.json')));
  });
});

test('pintasan 4: menampilkan isian untuk konfirmasi dan membuang tanda kutip', () => {
  const bat = fs.readFileSync(path.join(__dirname, '..', '4-buat-job-offline.bat'), 'utf8');
  assert.ok(bat.includes('\r\n'), 'akhir baris Windows (CRLF)');
  for (const frag of ['PERIKSA DULU', 'set PROJECT=%PROJECT:"=%', 'set SB=%SB:"=%', 'set JS=%JS:"=%', 'if /i not "%OK%"=="Y"', 'enqueue-local']) assert.ok(bat.includes(frag), frag);
});
