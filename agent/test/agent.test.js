'use strict';
// Pengujian agent terhadap halaman Flow tiruan (test/mockflow.html) di Chromium headless.
// Jalankan: CHROME_BIN=/path/chrome node --test test/agent.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bamugc-agent-'));
const PORT = 9333;
const MOCK = 'file://' + path.join(__dirname, 'mockflow.html');
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// konfigurasi cepat untuk uji
const baseCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'flow.labels.json'), 'utf8'));
baseCfg.timeouts = { generate_sec: 40, upload_sec: 20, poll_ms: 150, start_sec: 15 };
const cfgFile = path.join(TMP, 'flow.fast.json');
fs.writeFileSync(cfgFile, JSON.stringify(baseCfg));
Object.assign(process.env, {
  PAGE_MATCH: 'mockflow', CDP_URL: `http://127.0.0.1:${PORT}`, FLOW_CONFIG: cfgFile, SOURCE: 'local',
  HUMAN_POLL_MS: '300', HUMAN_WAIT_MS: '2500', IDLE_MS: '100', LOCAL_BACKOFF_MIN: '0',
  MIN_VIDEO_BYTES: '1000', DOWNLOAD_DIR: path.join(TMP, 'downloads'), WORK_DIR: path.join(TMP, 'work'), POLICY_RETRIES: '2'
});
fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });

const { runLoop, doctor, analyze, enqueueLocal } = require('../src/index.js');
const { LocalSource } = require('../src/sources/localSource');
const { SupabaseSource } = require('../src/sources/supabaseSource');
const { Supa } = require('../src/supabaseRest');
const { FlowDriver } = require('../src/flowDriver');
const core = require('../../core/src');

const silent = { info() {}, warn() {}, error() {}, file: '' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const profile = {
  photos: [{ role: 'depan' }, { role: 'belakang' }, { role: 'closeup' }], facts: ['Leher bulat dengan resleting depan', 'Lengan pendek'], colors: ['#1f3a8a'],
  details: [
    { slot_key: 'detail_utama', text: 'leher bulat dengan resleting depan', label: 'Leher', confidence: 0.9 },
    { slot_key: 'motif_kain', text: 'motif daun putih', label: 'Motif', confidence: 0.9 },
    { slot_key: 'lengan_bawahan_hem', text: 'lengan pendek', label: 'Lengan', confidence: 0.9 },
    { slot_key: 'siluet_panjang', text: 'siluet longgar', label: 'Samping', confidence: 0.9 }]
};
const plan = core.buildPanelPlan({ archetypeId: 'A-01', productProfile: profile, settingId: 'S-01', seed: 3 });
const VIDEO_JSON = core.buildVideoJson(plan, { characterCode: 'C02', jobTag: 'uji', productProfile: profile });

let chromeProc, probe;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = q => `${MOCK}?${q}&t=${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function counters() { const pg = probe.contexts()[0].pages().find(p => p.url().includes('mockflow')); return pg.evaluate(() => ({ d: window.__downloads, f: window.__forbidden, g: window.__generated })); }

function localRoot(name) { const r = path.join(TMP, name); fs.mkdirSync(r, { recursive: true }); return r; }
function makeLocalJob(root, projectUrl, id = 'job1') {
  const dir = path.join(root, 'inbox', id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'storyboard.png'), PNG); fs.writeFileSync(path.join(dir, 'prompt.json'), VIDEO_JSON);
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ project_url: projectUrl, resolution: '360p', duration_sec: 10, storyboard_file: 'storyboard.png', video_json_file: 'prompt.json' }));
  return id;
}
const status = (root, id) => JSON.parse(fs.readFileSync(path.join(root, 'inbox', id, 'status.json'), 'utf8'));

test.before(async () => {
  chromeProc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(TMP, 'profile')}`, MOCK], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { probe = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await sleep(300); } }
  assert.ok(probe, 'Chrome uji berjalan');
});
test.after(async () => { try { await probe.close(); } catch { /* abaikan */ } if (chromeProc) chromeProc.kill('SIGKILL'); });

test('offline: satu job penuh sampai video terunduh, tanpa klik terlarang', async () => {
  const root = localRoot('happy');
  const id = makeLocalJob(root, url('delay=500'));
  const src = new LocalSource(root, { backoffMinutes: 0 });
  const n = await runLoop({ source: src, log: silent, maxJobs: 1 });
  assert.equal(n, 1);
  const st = status(root, id);
  assert.equal(st.status, 'downloaded', JSON.stringify(st).slice(0, 300));
  const out = path.join(root, 'outbox', id, 'video.mp4');
  assert.ok(fs.existsSync(out) && fs.statSync(out).size >= 30000);
  assert.equal(fs.readFileSync(out).slice(4, 8).toString('latin1'), 'ftyp');
  assert.ok(st.flow_asset_url && /\/edit\//.test(st.flow_asset_url));
  assert.ok(st.credits_observed > 0);
  const steps = st.history.map(h => h.step);
  for (const s of ['prepare', 'project', 'settings', 'attach', 'prompt', 'generate', 'wait', 'download', 'done']) assert.ok(steps.includes(s), 'langkah ' + s);
  const c = await counters(); assert.equal(c.f, 0, 'tidak ada klik terlarang'); assert.equal(c.g, 1);
});

test('offline: kartu gagal (kebijakan) diulang otomatis lalu berhasil', async () => {
  const root = localRoot('retry');
  const id = makeLocalJob(root, url('delay=400&fail=1'));
  await runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });
  const st = status(root, id);
  assert.equal(st.status, 'downloaded');
  assert.equal(st.attempts, 1, 'ulang otomatis di dalam satu percobaan');
  assert.ok(st.history.some(h => h.kind === 'warn' && /policy/.test(h.message)), 'kegagalan tercatat sebagai telemetri');
});

test('offline: kegagalan kebijakan terus-menerus berakhir gagal setelah 3 percobaan', async () => {
  const root = localRoot('fail');
  const id = makeLocalJob(root, url('delay=250&fail=99'));
  await runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 3 });
  const st = status(root, id);
  assert.equal(st.status, 'failed'); assert.equal(st.attempts, 3); assert.equal(st.error_kind, 'policy');
});

test('offline: captcha menjeda, manusia menyelesaikan, antrean lanjut', async () => {
  const root = localRoot('captcha');
  const id = makeLocalJob(root, url('delay=300&captcha=1'));
  const src = new LocalSource(root, { backoffMinutes: 0 });
  const human = (async () => { // meniru manusia menyelesaikan captcha
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      const pg = probe.contexts()[0].pages().find(p => p.url().includes('mockflow')); if (!pg) continue;
      const has = await pg.evaluate(() => !!document.getElementById('cap')).catch(() => false);
      if (has) { await sleep(900); await pg.evaluate(() => document.getElementById('cap').remove()); return; }
    }
  })();
  await runLoop({ source: src, log: silent, maxJobs: 2 });
  await human;
  const st = status(root, id);
  assert.equal(st.status, 'downloaded', JSON.stringify(st).slice(0, 400));
  assert.ok(st.history.some(h => h.step === 'human' && h.result === 'captcha'), 'tercatat butuh manusia');
  assert.ok(st.history.some(h => h.step === 'resume'));
});

test('offline: tampilan berubah (kapsul pengaturan hilang) berhenti dengan needs_human', async () => {
  const root = localRoot('layout');
  const id = makeLocalJob(root, url('nochip=1'));
  await runLoop({ source: new LocalSource(root, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });
  const st = status(root, id);
  assert.equal(st.status, 'needs_human'); assert.equal(st.error_kind, 'layout');
});

test('pengaman: klik pada tombol terlarang ditolak', async () => {
  const fd = new FlowDriver({ page: {}, cfg: baseCfg, log: silent });
  for (const l of ['Pindahkan ke sampah', 'Upgrade', 'Resolusi ditingkatkan', 'Bagikan media', 'Favorit']) assert.throws(() => fd.assertSafe(l), /pengaman/);
  assert.doesNotThrow(() => fd.assertSafe('Ukuran asli'));
});

// ── Supabase tiruan ─────────────────────────────────────────
function startStub(jobs) {
  const state = { claims: 0, progress: [], events: [], uploads: new Map(), auth: 0, badAuth: 0, heartbeats: 0 };
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks); const u = new URL(req.url, 'http://x');
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (u.pathname === '/auth/v1/token') { state.auth++; return json(200, { access_token: 'tok', refresh_token: 'r', expires_in: 3600 }); }
      if (req.headers.authorization !== 'Bearer tok' || req.headers.apikey !== 'anon') { state.badAuth++; return json(401, { message: 'unauthorized' }); }
      const m = u.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/);
      if (m) {
        const args = body.length ? JSON.parse(body) : {};
        if (m[1] === 'ugc_agent_heartbeat') { state.heartbeats++; return json(200, { paused: false, reason: null }); }
        if (m[1] === 'ugc_requeue_stale') return json(200, 0);
        if (m[1] === 'ugc_claim_next_job') { state.claims++; const j = jobs.shift(); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(j || null)); }
        if (m[1] === 'ugc_job_progress') { state.progress.push(args); return json(200, args.p_status); }
        if (m[1] === 'ugc_log_event') { state.events.push(args); res.writeHead(204); return res.end(); }
        if (m[1] === 'ugc_set_pause') { res.writeHead(204); return res.end(); }
        return json(404, { message: 'rpc?' });
      }
      const dl = u.pathname.match(/^\/storage\/v1\/object\/authenticated\/ugc-storyboards\/(.+)$/);
      if (dl) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
      const up = u.pathname.match(/^\/storage\/v1\/object\/ugc-videos\/(.+)$/);
      if (up && req.method === 'POST') { state.uploads.set(decodeURIComponent(up[1]), body); return json(200, { Key: up[1] }); }
      json(404, { message: 'tidak ada' });
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, state, port: server.address().port })));
}

test('Supabase: klaim, kemajuan, telemetri, dan unggah video lewat REST', async () => {
  const job = { job_id: 'j-1', batch_id: 'b-1', seq: 1, attempt: 1, max_attempts: 3, project_url: url('delay=300'), character_code: 'C02', resolution: '360p', duration_sec: 10,
    storyboard: { bucket: 'ugc-storyboards', path: 'b-1/1.png' }, video_json: VIDEO_JSON };
  const { server, state, port } = await startStub([job]);
  try {
    const supa = new Supa({ url: `http://127.0.0.1:${port}`, anonKey: 'anon', email: 'a@x', password: 'p' });
    const src = new SupabaseSource(supa, { agentName: 'uji', version: '0.0.0' });
    const n = await runLoop({ source: src, log: silent, maxJobs: 1 });
    assert.equal(n, 1);
    assert.equal(state.badAuth, 0); assert.ok(state.auth >= 1); assert.ok(state.heartbeats >= 1);
    const fin = state.progress.find(p => p.p_status === 'downloaded');
    assert.ok(fin, 'status downloaded dilaporkan');
    assert.equal(fin.p_patch.video_path, 'b-1/j-1.mp4');
    assert.ok(fin.p_patch.credits_observed > 0);
    const vid = state.uploads.get('b-1/j-1.mp4'); assert.ok(vid && vid.length >= 30000, 'video terunggah');
    assert.ok(state.events.length >= 6, 'telemetri langkah terkirim');
    assert.ok(state.events.every(e => e.p_job === 'j-1' && e.p_event.agent === 'uji'));
  } finally { server.close(); }
});

test('Supabase: kesalahan login menghasilkan pesan jelas', async () => {
  const supa = new Supa({ url: 'http://127.0.0.1:9', anonKey: 'x', email: 'a', password: 'b' });
  await assert.rejects(() => supa.rpc('ugc_agent_heartbeat', {}), /Koneksi ke Supabase gagal/);
});

// ── doctor dan Analisa Flow ─────────────────────────────────
test('doctor: semua pemeriksaan lolos pada tampilan yang dikenal, gagal bila tampilan berubah', async () => {
  const pg = probe.contexts()[0].pages().find(p => p.url().includes('mockflow'));
  await pg.goto(url('delay=100'));
  const ok = await doctor();
  assert.ok(ok.length >= 10 && ok.every(r => r.pass), JSON.stringify(ok.filter(r => !r.pass)));
  await pg.goto(url('nochip=1'));
  const bad = await doctor();
  assert.ok(bad.some(r => !r.pass));
});

test('Analisa Flow: baseline tersimpan lalu perubahan terdeteksi', async () => {
  const pg = probe.contexts()[0].pages().find(p => p.url().includes('mockflow'));
  const root = path.join(__dirname, '..');
  fs.rmSync(path.join(root, 'baseline'), { recursive: true, force: true });
  await pg.goto(url('delay=100'));
  await analyze(true);
  assert.ok(fs.existsSync(path.join(root, 'baseline', 'inventory.json')));
  await pg.goto(url('extra=1'));
  const { report } = await analyze(false);
  const md = fs.readFileSync(report, 'utf8');
  assert.match(md, /BARU: .*Tombol baru/);
  assert.match(md, /perubahan terdeteksi/);
  fs.rmSync(path.join(root, 'baseline'), { recursive: true, force: true });
  fs.rmSync(path.join(root, 'reports'), { recursive: true, force: true });
});

test('enqueue-local membuat folder job yang valid', async () => {
  const root = localRoot('enq'); process.env.LOCAL_DIR = root;
  const sbf = path.join(TMP, 'sb.png'); const jf = path.join(TMP, 'p.json'); fs.writeFileSync(sbf, PNG); fs.writeFileSync(jf, VIDEO_JSON);
  const id = enqueueLocal({ project: 'https://flow.google.com/project/abc', storyboard: sbf, json: jf, res: '720p' });
  const spec = JSON.parse(fs.readFileSync(path.join(root, 'inbox', id, 'job.json'), 'utf8'));
  assert.equal(spec.resolution, '720p'); assert.ok(fs.existsSync(path.join(root, 'inbox', id, 'prompt.json')));
  delete process.env.LOCAL_DIR;
});
