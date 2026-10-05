'use strict';
// Pengujian pembukaan pop-up pengaturan yang sabar, galat yang informatif, dan mode once yang mengulang job.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bamugc-popup-'));
const PORT = 9338;
const MOCK = 'file://' + path.join(__dirname, 'mockflow.html');
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const baseCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'flow.labels.json'), 'utf8'));
baseCfg.timeouts = { generate_sec: 40, upload_sec: 20, poll_ms: 150, start_sec: 15 };
const cfgFile = path.join(TMP, 'flow.fast.json');
fs.writeFileSync(cfgFile, JSON.stringify(baseCfg));
Object.assign(process.env, {
  PAGE_MATCH: 'mockflow', CDP_URL: `http://127.0.0.1:${PORT}`, FLOW_CONFIG: cfgFile, SOURCE: 'local', ALLOW_ANY_PROJECT_URL: '1',
  HUMAN_POLL_MS: '300', HUMAN_WAIT_MS: '4000', IDLE_MS: '100', LOCAL_BACKOFF_MIN: '0', POPUP_WAIT_MS: '8000',
  MIN_VIDEO_BYTES: '1000', DOWNLOAD_DIR: path.join(TMP, 'downloads'), WORK_DIR: path.join(TMP, 'work'), POLICY_RETRIES: '2'
});
fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });

const { runLoop, doctor } = require('../src/index.js');
const { LocalSource } = require('../src/sources/localSource');
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
const status = (root, id) => JSON.parse(fs.readFileSync(path.join(root, 'inbox', id, 'status.json'), 'utf8'));
const withEnv = async (env, fn) => { const old = {}; for (const k of Object.keys(env)) { old[k] = process.env[k]; process.env[k] = env[k]; } try { return await fn(); } finally { for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } } };
const runOne = async (root, q, opts = { maxJobs: 1 }) => { const id = makeLocalJob(root, url(q)); const done = await runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, ...opts }); return { id, st: status(root, id), done }; };

let chromeProc, probe;
const pageNow = () => probe.contexts()[0].pages().find(p => p.url().includes('mockflow'));
const counters = () => pageNow().evaluate(() => ({ g: window.__generated, clicks: window.__chipClicks, f: window.__forbidden }));

test.before(async () => {
  chromeProc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(TMP, 'profile')}`, MOCK], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { probe = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await sleep(300); } }
  assert.ok(probe, 'Chrome uji berjalan');
});
test.after(async () => { try { await probe.close(); } catch { /* abaikan */ } if (chromeProc) chromeProc.kill('SIGKILL'); });

test('pop-up lambat (2,5 detik): agent menunggu sampai terbuka lalu melanjutkan sampai video terunduh', async () => {
  const { st } = await runOne(localRoot('lambat'), 'delay=400&lang=en&slowpopup=2500');
  assert.equal(st.status, 'downloaded', JSON.stringify({ e: st.last_error, h: st.history.slice(-2) }));
  assert.equal((await counters()).g, 1);
});

test('klik pertama pada kapsul diabaikan Flow: agent mengulang klik dan berhasil', async () => {
  const { st } = await runOne(localRoot('flaky'), 'delay=400&lang=id&flakypopup=1');
  assert.equal(st.status, 'downloaded', JSON.stringify({ e: st.last_error }));
  assert.ok((await counters()).clicks >= 2, 'kapsul diklik lebih dari sekali');
});

test('pop-up tidak pernah terbuka: berhenti dengan pesan lengkap (tab, kapsul, pilihan, tombol) dan tanpa generate', async () => {
  await withEnv({ POPUP_WAIT_MS: '1800' }, async () => {
    const root = localRoot('tak-terbuka');
    const { st } = await runOne(root, 'delay=300&lang=en&slowpopup=600000');
    const err = st.history.find(h => h.step === 'human');
    assert.ok(err, JSON.stringify(st.history.map(h => h.step)));
    assert.match(err.message, /Pop-up pengaturan tidak terbuka setelah 3 klik/);
    assert.match(err.message, /Kapsul: "Video · 360p/);
    assert.match(err.message, /Pilihan yang terlihat: /);
    assert.match(err.message, /Tombol yang terlihat: .*Start generation/);
    assert.equal((await counters()).g, 0);
  });
});

test('pop-up terbuka tetapi tanpa pilihan "Video": tetap dikenali terbuka, galatnya menyebut pilihan yang hilang', async () => {
  const { st } = await runOne(localRoot('tanpavideo'), 'delay=300&lang=en&onlyimage=1');
  assert.equal(st.status, 'failed'); assert.equal(st.error_kind, 'fatal');
  assert.match(st.last_error, /Pilihan "Video" tidak ditemukan di pop-up pengaturan/);
  assert.equal((await counters()).g, 0);
});

for (const lang of ['en', 'id']) {
  test(`[${lang}] doctor mencetak berapa milidetik pop-up pengaturan butuh untuk terbuka`, async () => {
    await pageNow().goto(url(`delay=100&lang=${lang}&slowpopup=700`));
    const rows = await doctor();
    assert.deepEqual(rows.filter(r => !r.pass), []);
    const r = rows.find(x => x.name === 'Pop-up pengaturan terbuka');
    assert.ok(r, 'baris pop-up ada');
    const ms = Number(r.note.replace(/\D/g, ''));
    assert.ok(ms >= 600 && ms < 3000, 'lama terbuka tercatat (' + r.note + ')');
  });
}

test('mode once: captcha muncul sebelum generate lalu hilang: job yang sama diulang otomatis dan selesai', async () => {
  const { st, done } = await runOne(localRoot('once-ulang'), 'delay=300&lang=en&capload=1500', { maxJobs: 1, idleExit: true, noRetryConnect: true, repeatOnResume: true });
  assert.equal(st.status, 'downloaded', JSON.stringify({ e: st.last_error, h: st.history.map(h => h.step + ':' + h.message.slice(0, 30)) }));
  assert.equal(st.attempts, 2, 'percobaan kedua berhasil');
  assert.ok(st.history.some(h => h.step === 'resume'));
  assert.equal(done, 1);
  assert.equal((await counters()).g, 1, 'hanya satu kali generate');
});

test('tanpa repeatOnResume (perilaku lama): job dikembalikan ke antrean dan tidak diulang', async () => {
  const { st } = await runOne(localRoot('tanpa-ulang'), 'delay=300&lang=en&capload=1500', { maxJobs: 1 });
  assert.equal(st.status, 'queued');
});

test('mode once: berhenti setelah generate ditekan TIDAK diulang (mencegah video ganda dan kredit terbuang)', async () => {
  const root = localRoot('once-sesudah-generate');
  const id = makeLocalJob(root, url('delay=300&lang=en&captcha=1'));
  const human = (async () => {
    for (let i = 0; i < 80; i++) {
      await sleep(150);
      const pg = pageNow(); if (!pg) continue;
      const has = await pg.evaluate(() => !!document.getElementById('cap')).catch(() => false);
      if (has) { await sleep(700); await pg.evaluate(() => document.getElementById('cap').remove()); return; }
    }
  })();
  const done = await runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 1, idleExit: true, noRetryConnect: true, repeatOnResume: true });
  await human;
  const st = status(root, id);
  assert.equal(done, 1);
  assert.equal(st.status, 'queued', 'dikembalikan ke antrean, tidak dijalankan lagi');
  assert.equal(st.attempts, 1);
  assert.equal((await counters()).g, 1, 'generate tepat satu kali');
});
