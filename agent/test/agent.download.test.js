'use strict';
// Pengujian unduh lewat ikon toolbar (tampilan penyunting), pengaman tombol, dan pemulihan unduhan tanpa generate ulang.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bamugc-dl-'));
const PORT = 9339;
const MOCK = 'file://' + path.join(__dirname, 'mockflow.html');
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const baseCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'flow.labels.json'), 'utf8'));
baseCfg.timeouts = { generate_sec: 40, upload_sec: 20, poll_ms: 150, start_sec: 15 };
const cfgFile = path.join(TMP, 'flow.fast.json');
fs.writeFileSync(cfgFile, JSON.stringify(baseCfg));
Object.assign(process.env, {
  PAGE_MATCH: 'mockflow', CDP_URL: `http://127.0.0.1:${PORT}`, FLOW_CONFIG: cfgFile, SOURCE: 'local', ALLOW_ANY_PROJECT_URL: '1',
  HUMAN_POLL_MS: '300', HUMAN_WAIT_MS: '4000', IDLE_MS: '100', LOCAL_BACKOFF_MIN: '0', DOWNLOAD_WAIT_MS: '3000',
  MIN_VIDEO_BYTES: '1000', DOWNLOAD_DIR: path.join(TMP, 'downloads'), WORK_DIR: path.join(TMP, 'work'), POLICY_RETRIES: '2'
});
fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });

const { runLoop } = require('../src/index.js');
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
const statusFile = (root, id) => path.join(root, 'inbox', id, 'status.json');
const status = (root, id) => JSON.parse(fs.readFileSync(statusFile(root, id), 'utf8'));
const dbg = st => JSON.stringify({ galat: st.last_error, jenis: st.error_kind, status: st.status, akhir: (st.history || []).slice(-3).map(h => h.step + ': ' + h.message.slice(0, 60)) });
const runJob = async (root, id) => runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });

let chromeProc, probe;
const pageNow = () => probe.contexts()[0].pages().find(p => p.url().includes('mockflow'));
const counters = () => pageNow().evaluate(() => ({ g: window.__generated, f: window.__forbidden, d: window.__downloads }));

test.before(async () => {
  chromeProc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(TMP, 'profile')}`, MOCK], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { probe = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await sleep(300); } }
  assert.ok(probe, 'Chrome uji berjalan');
});
test.after(async () => { try { await probe.close(); } catch { /* abaikan */ } if (chromeProc) chromeProc.kill('SIGKILL'); });

for (const lang of ['en', 'id']) {
  test(`[${lang}] tampilan penyunting: unduh lewat ikon toolbar (bukan titik tiga, bukan sampah), video valid, tanpa klik terlarang`, async () => {
    const root = localRoot('baru-' + lang); const id = makeLocalJob(root, url(`delay=400&lang=${lang}&detail=new`));
    await runJob(root, id);
    const st = status(root, id);
    assert.equal(st.status, 'downloaded', dbg(st));
    const out = path.join(root, 'outbox', id, 'video.mp4');
    assert.ok(fs.existsSync(out) && fs.statSync(out).size >= 30000);
    assert.equal(fs.readFileSync(out).slice(4, 8).toString('latin1'), 'ftyp');
    const c = await counters();
    assert.equal(c.f, 0, 'tidak ada klik terlarang (sampah, Download project, Upgrade)'); assert.equal(c.d, 1); assert.equal(c.g, 1);
  });
}

test('ikon unduh dengan nama aksesibel ("Download") juga dikenali, dan titik tiga tidak dibuka', async () => {
  const root = localRoot('aria'); const id = makeLocalJob(root, url('delay=400&lang=en&detail=new&dlaria=1'));
  await runJob(root, id);
  assert.equal(status(root, id).status, 'downloaded', dbg(status(root, id)));
  assert.equal((await counters()).f, 0);
});

test('tampilan lama (titik tiga lalu Download media) tetap berfungsi sebagai cadangan', async () => {
  const root = localRoot('lama'); const id = makeLocalJob(root, url('delay=400&lang=id'));
  await runJob(root, id);
  assert.equal(status(root, id).status, 'downloaded', dbg(status(root, id)));
  assert.equal((await counters()).f, 0);
});

test('ikon unduh tidak ada: menu aplikasi ditutup, tidak ada klik terlarang, pesan memuat toolbar dan menu yang terlihat', async () => {
  const root = localRoot('nodl'); const id = makeLocalJob(root, url('delay=400&lang=en&detail=new&nodl=1'));
  await runJob(root, id);
  const st = status(root, id);
  assert.equal(st.status, 'queued', dbg(st));
  assert.match(st.last_error, /Menu unduh tidak ditemukan/);
  assert.match(st.last_error, /Tombol di toolbar: .*delete/);
  const c = await counters();
  assert.equal(c.f, 0, '"Download project" dan sampah tidak diklik');
  assert.equal(await pageNow().evaluate(() => document.getElementById('appmenu').style.display), 'none', 'menu aplikasi ditutup kembali');
});

test('pemulihan: unduhan gagal setelah video jadi, percobaan kedua hanya mengunduh (generate tetap satu kali)', async () => {
  const root = localRoot('pulih'); const id = makeLocalJob(root, url('delay=400&lang=en&detail=new&dlfail=1'));
  await runJob(root, id);
  let st = status(root, id);
  assert.equal(st.status, 'queued', dbg(st));
  assert.match(st.flow_asset_url || '', /#\/edit\//, 'alamat video tercatat');
  assert.ok(st.history.some(h => h.step === 'video_ready'));
  assert.equal((await counters()).g, 1);
  assert.ok(!fs.existsSync(path.join(root, 'outbox', id, 'video.mp4')));

  await runJob(root, id);   // percobaan kedua
  st = status(root, id);
  assert.equal(st.status, 'downloaded', dbg(st));
  assert.ok(st.history.some(h => h.step === 'recover'), 'jalur pemulihan dipakai');
  const c = await counters();
  assert.equal(c.g, 1, 'tidak ada generate kedua'); assert.equal(c.f, 0);
  const out = path.join(root, 'outbox', id, 'video.mp4');
  assert.ok(fs.existsSync(out) && fs.statSync(out).size >= 30000);
});

test('pemulihan: video yang tercatat sudah tidak ada: berhenti dengan pesan jelas dan TIDAK generate ulang', async () => {
  const root = localRoot('hilang'); const base = url('delay=300&lang=en&detail=new&novideo=1');
  const id = makeLocalJob(root, base);
  const st0 = { status: 'queued', attempts: 1, history: [], flow_asset_url: base + '#/edit/zzz' };
  fs.writeFileSync(statusFile(root, id), JSON.stringify(st0));
  await pageNow().goto(base);
  const g0 = (await counters()).g;
  await runJob(root, id);
  const st = status(root, id);
  assert.equal(st.status, 'failed', dbg(st)); assert.equal(st.error_kind, 'fatal');
  assert.match(st.last_error, /tidak ditemukan di alamat yang tercatat/);
  assert.equal((await counters()).g, g0, 'tidak ada generate baru');
});

test('pengaman: sampah, hapus, dan unduh project ditolak; ikon unduh dan Original size lolos', () => {
  const fd = new FlowDriver({ page: {}, cfg: baseCfg, log: silent });
  for (const l of ['Delete', 'delete', 'Hapus', 'Move to bin', 'Download project', 'Unduh project', 'Upgrade', 'Share media']) assert.throws(() => fd.assertSafe(l), /pengaman/, l);
  for (const l of ['Unduh (ikon toolbar)', 'Original size', 'Ukuran asli', 'Download media', 'More options']) assert.doesNotThrow(() => fd.assertSafe(l), l);
});
