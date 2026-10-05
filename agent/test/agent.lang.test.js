'use strict';
// Pengujian dua bahasa (Inggris dan Indonesia) terhadap halaman Flow tiruan (test/mockflow.html?lang=en|id).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bamugc-lang-'));
const PORT = 9336;
const MOCK = 'file://' + path.join(__dirname, 'mockflow.html');
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const baseCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'flow.labels.json'), 'utf8'));
baseCfg.timeouts = { generate_sec: 40, upload_sec: 20, poll_ms: 150, start_sec: 15 };
const cfgFile = path.join(TMP, 'flow.fast.json');
fs.writeFileSync(cfgFile, JSON.stringify(baseCfg));
Object.assign(process.env, {
  PAGE_MATCH: 'mockflow', CDP_URL: `http://127.0.0.1:${PORT}`, FLOW_CONFIG: cfgFile, ALLOW_ANY_PROJECT_URL: '1', SOURCE: 'local',
  HUMAN_POLL_MS: '300', HUMAN_WAIT_MS: '2500', IDLE_MS: '100', LOCAL_BACKOFF_MIN: '0',
  MIN_VIDEO_BYTES: '1000', DOWNLOAD_DIR: path.join(TMP, 'downloads'), WORK_DIR: path.join(TMP, 'work'), POLICY_RETRIES: '2'
});
fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });

const { runLoop, doctor, supabaseCheck } = require('../src/index.js');
const { LocalSource } = require('../src/sources/localSource');
const { FlowDriver, connectFlow } = require('../src/flowDriver');
const { Labels } = require('../src/labels');
const core = require('../../core/src');

const silent = { info() {}, warn() {}, error() {}, file: '' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = q => `${MOCK}?${q}&t=${Date.now()}${Math.floor(Math.random() * 1000)}`;

const prof = { photos: [{ role: 'depan' }, { role: 'belakang' }, { role: 'closeup' }], facts: ['Lengan pendek'], colors: [],
  details: ['detail_utama', 'motif_kain', 'lengan_bawahan_hem', 'siluet_panjang'].map(k => ({ slot_key: k, text: k, label: k, confidence: 0.9 })) };
const VIDEO_JSON = core.buildVideoJson(core.buildPanelPlan({ archetypeId: 'A-01', productProfile: prof, settingId: 'S-01', seed: 3 }), { characterCode: 'C02', jobTag: 'uji', productProfile: prof });

function localRoot(name) { const r = path.join(TMP, name); fs.mkdirSync(r, { recursive: true }); return r; }
function makeLocalJob(root, projectUrl, id = 'job1') {
  const dir = path.join(root, 'inbox', id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'storyboard.png'), PNG); fs.writeFileSync(path.join(dir, 'prompt.json'), VIDEO_JSON);
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ project_url: projectUrl, resolution: '360p', duration_sec: 10, storyboard_file: 'storyboard.png', video_json_file: 'prompt.json' }));
  return id;
}
const status = (root, id) => JSON.parse(fs.readFileSync(path.join(root, 'inbox', id, 'status.json'), 'utf8'));

let chromeProc, probe;
const pageNow = () => probe.contexts()[0].pages().find(p => p.url().includes('mockflow'));
const counters = () => pageNow().evaluate(() => ({ f: window.__forbidden, g: window.__generated, d: window.__downloads }));

test.before(async () => {
  chromeProc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(TMP, 'profile')}`, MOCK], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { probe = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await sleep(300); } }
  assert.ok(probe, 'Chrome uji berjalan');
});
test.after(async () => { try { await probe.close(); } catch { /* abaikan */ } if (chromeProc) chromeProc.kill('SIGKILL'); });

// ── unit: label dan pengaman ────────────────────────────────
test('label: selektor, nama, durasi, kredit, dan kegagalan cocok untuk kedua bahasa', () => {
  const L = new Labels(baseCfg);
  assert.deepEqual(L.codes.sort(), ['en', 'id']);
  assert.match(L.aria('settingsChip'), /Settings trigger.*Pemicu setelan/);
  for (const t of ['Start generation', 'Mulai pembuatan']) assert.ok(L.nameRe('generate').test(t), t);
  assert.ok(!L.nameRe('generate').test('Start generation now'));
  for (const t of ['More options', 'Opsi lainnya']) assert.ok(L.nameRe('moreOptions').test(t), t);
  assert.ok(!L.nameRe('moreOptions').test('More options for the project'), 'tombol tingkat project tidak tertukar');
  assert.ok(L.durRe(8).test('8s') && L.durRe(8).test('8 dtk') && !L.durRe(4).test('10s') && L.durRe(10).test('10s') && L.durRe(4).test('4 dtk'));
  assert.equal(L.creditsRe().exec('12 credits')[1], '12'); assert.equal(L.creditsRe().exec('12 kredit')[1], '12');
  assert.equal(L.classify('This prompt may violate our policy'), 'policy');
  assert.equal(L.classify('Perintah ini mungkin melanggar kebijakan'), 'policy');
  assert.deepEqual(L.failureWords().sort(), ['Failed', 'Gagal']);
  assert.ok(L.partialRe('menus', 'downloadOriginal').test('360p Original size') && L.partialRe('menus', 'downloadOriginal').test('360p Ukuran asli'));
  assert.ok(L.unverified().length >= 1);
});

test('pengaman: tombol terlarang ditolak di kedua bahasa dan kedua ejaan, tombol aman lolos', () => {
  const fd = new FlowDriver({ page: {}, cfg: baseCfg, log: silent });
  for (const l of ['Move to bin', 'Move to trash', 'Pindahkan ke sampah', 'Upgrade', 'Upscaled', 'Resolusi ditingkatkan', 'Share media', 'Bagikan media', 'Favourite', 'Favorite', 'Favorit']) {
    assert.throws(() => fd.assertSafe(l), /pengaman/, l);
  }
  for (const l of ['Original size', 'Ukuran asli', 'Download media', 'Start generation', 'More options']) assert.doesNotThrow(() => fd.assertSafe(l), l);
});

// ── per bahasa ──────────────────────────────────────────────
for (const [lang, nama] of [['id', 'Indonesia'], ['en', 'English']]) {
  test(`[${lang}] doctor lolos, mendeteksi bahasa, dan menampilkan tab`, async () => {
    const pg = pageNow(); await pg.goto(url(`delay=100&lang=${lang}`));
    const rows = await doctor();
    const bad = rows.filter(r => !r.pass);
    assert.deepEqual(bad, [], JSON.stringify(bad));
    const l = rows.find(r => r.name.startsWith('Bahasa antarmuka'));
    assert.equal(l.note, nama);
    assert.ok(rows.some(r => r.name === 'Tab Flow yang diperiksa' && /mockflow/.test(r.note)));
    assert.ok(rows.some(r => /Angka kredit terbaca/.test(r.name) && /^\d+ kredit/.test(r.note)), 'kredit terbaca ("credits" atau "kredit")');
  });

  test(`[${lang}] satu job penuh: setelan, upload bahan, prompt, generate, tunggu, unduh, tanpa klik terlarang`, async () => {
    const root = localRoot('job-' + lang);
    const id = makeLocalJob(root, url(`delay=500&lang=${lang}`));
    await runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });
    const st = status(root, id);
    assert.equal(st.status, 'downloaded', JSON.stringify(st).slice(0, 400));
    const out = path.join(root, 'outbox', id, 'video.mp4');
    assert.ok(fs.existsSync(out) && fs.statSync(out).size >= 30000);
    assert.equal(fs.readFileSync(out).slice(4, 8).toString('latin1'), 'ftyp');
    assert.ok(st.credits_observed > 0, 'kredit tercatat');
    const c = await counters(); assert.equal(c.f, 0, 'tidak ada klik terlarang'); assert.equal(c.g, 1);
  });

  test(`[${lang}] kegagalan kebijakan diulang otomatis lalu berhasil`, async () => {
    const root = localRoot('retry-' + lang);
    const id = makeLocalJob(root, url(`delay=400&fail=1&lang=${lang}`));
    await runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });
    const st = status(root, id);
    assert.equal(st.status, 'downloaded');
    assert.ok(st.history.some(h => h.kind === 'warn' && /policy/.test(h.message)), 'kegagalan tercatat sebagai policy');
  });
}

test('bahasa berganti antar job (akun berbeda): kedua job selesai', async () => {
  const root = localRoot('ganti');
  makeLocalJob(root, url('delay=300&lang=id'), 'a-job');
  makeLocalJob(root, url('delay=300&lang=en'), 'b-job');
  await runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 2 });
  assert.equal(status(root, 'a-job').status, 'downloaded');
  assert.equal(status(root, 'b-job').status, 'downloaded');
});

test('tab: bila ada beberapa tab Flow, dipilih halaman project, bukan beranda', async () => {
  const ctx = probe.contexts()[0];
  const first = pageNow(); await first.goto(url('lang=en') + '#/home');
  const second = await ctx.newPage(); await second.goto(url('lang=en&x=2') + '#/project/p-uji');
  try {
    await second.bringToFront();
    const conn = await connectFlow(baseCfg, silent);
    assert.match(conn.page.url(), /#\/project\/p-uji/);
    const warns = []; await connectFlow(baseCfg, { info() {}, warn: m => warns.push(m), error() {} });
    assert.ok(warns.some(w => /Ada 2 tab Flow/.test(w)), 'peringatan dua tab');
  } finally { await second.close(); await first.goto(url('lang=en')); }
});

test('doctor: bila kapsul tidak ketemu, pesan memuat tab, nama kedua bahasa, dan daftar tombol yang terlihat', async () => {
  const pg = pageNow(); await pg.goto(url('delay=100&lang=en&nochip=1'));
  const rows = await doctor();
  const fail = rows.find(r => !r.pass && /Pemeriksaan berhenti/.test(r.name));
  assert.ok(fail, JSON.stringify(rows.filter(r => !r.pass)));
  assert.match(fail.note, /Settings trigger \/ Pemicu setelan/);
  assert.match(fail.note, /Tab: .*mockflow/);
  assert.match(fail.note, /Tombol yang terlihat: .*Start generation/);
});

// ── Supabase pada doctor ────────────────────────────────────
function startStub({ goodPassword = 'benar', role = 'agent' } = {}) {
  const state = { logins: 0, beats: 0 };
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString(); const u = new URL(req.url, 'http://x');
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (u.pathname === '/auth/v1/token') {
        state.logins++;
        const b = JSON.parse(body || '{}');
        return b.password === goodPassword ? json(200, { access_token: 'tok', refresh_token: 'r', expires_in: 3600 }) : json(400, { error_description: 'Invalid login credentials' });
      }
      if (u.pathname === '/rest/v1/rpc/ugc_agent_heartbeat') {
        state.beats++;
        return role === 'agent' ? json(200, { paused: false, reason: null }) : json(403, { message: 'khusus agent' });
      }
      json(404, { message: 'tidak ada' });
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, state, port: server.address().port })));
}
const collect = async (fn) => { const rows = []; await fn((name, pass, note = '') => rows.push({ name, pass, note })); return rows; };
const withEnv = async (env, fn) => { const old = {}; for (const k of Object.keys(env)) { old[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; } try { return await fn(); } finally { for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } } };

test('doctor Supabase: login dan satu detak berhasil, tanpa mengambil tugas', async () => {
  const { server, state, port } = await startStub();
  try {
    const rows = await withEnv({ SOURCE: 'supabase', SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_ANON_KEY: 'anon', AGENT_EMAIL: 'a@x', AGENT_PASSWORD: 'benar' }, () => collect(supabaseCheck));
    assert.deepEqual(rows.filter(r => !r.pass), []);
    assert.deepEqual(rows.map(r => r.name), ['Berkas .env lengkap', 'Login Supabase sebagai akun agent', 'Detak agent diterima database']);
    assert.equal(state.beats, 1);
  } finally { server.close(); }
});

test('doctor Supabase: kata sandi salah, role bukan agent, dan .env belum lengkap memberi pesan yang jelas', async () => {
  const a = await startStub();
  try {
    const rows = await withEnv({ SOURCE: 'supabase', SUPABASE_URL: `http://127.0.0.1:${a.port}`, SUPABASE_ANON_KEY: 'anon', AGENT_EMAIL: 'a@x', AGENT_PASSWORD: 'salah' }, () => collect(supabaseCheck));
    const f = rows.find(r => !r.pass); assert.match(f.name, /Login Supabase/); assert.match(f.note, /AGENT_EMAIL, AGENT_PASSWORD/); assert.equal(a.state.beats, 0, 'tidak melanjutkan ke detak');
  } finally { a.server.close(); }
  const b = await startStub({ role: 'staff' });
  try {
    const rows = await withEnv({ SOURCE: 'supabase', SUPABASE_URL: `http://127.0.0.1:${b.port}`, SUPABASE_ANON_KEY: 'anon', AGENT_EMAIL: 'a@x', AGENT_PASSWORD: 'benar' }, () => collect(supabaseCheck));
    const f = rows.find(r => !r.pass); assert.match(f.name, /Detak agent/); assert.match(f.note, /berole agent/);
  } finally { b.server.close(); }
  const rows = await withEnv({ SOURCE: 'supabase', SUPABASE_URL: undefined, SUPABASE_ANON_KEY: undefined, AGENT_EMAIL: undefined, AGENT_PASSWORD: undefined }, () => collect(supabaseCheck));
  assert.equal(rows.length, 1); assert.match(rows[0].note, /SUPABASE_URL, SUPABASE_ANON_KEY, AGENT_EMAIL, AGENT_PASSWORD/);
  const off = await withEnv({ SOURCE: 'local' }, () => collect(supabaseCheck));
  assert.equal(off.length, 1); assert.ok(off[0].pass);
});
