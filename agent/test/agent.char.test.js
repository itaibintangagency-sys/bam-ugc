'use strict';
// Pengujian tahap karakter terhadap halaman Flow tiruan (test/mockflow.html).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { PassThrough } = require('stream');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bamugc-char-'));
const PORT = 9335;
const MOCK = 'file://' + path.join(__dirname, 'mockflow.html');
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const baseCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'flow.labels.json'), 'utf8'));
baseCfg.timeouts = { generate_sec: 40, upload_sec: 20, poll_ms: 150, start_sec: 15 };
const cfgFile = path.join(TMP, 'flow.fast.json');
fs.writeFileSync(cfgFile, JSON.stringify(baseCfg));
Object.assign(process.env, {
  PAGE_MATCH: 'mockflow', CDP_URL: `http://127.0.0.1:${PORT}`, FLOW_CONFIG: cfgFile, FLOW_HOME_URL: MOCK + '#/home',
  HUMAN_POLL_MS: '300', HUMAN_WAIT_MS: '2500', IDLE_MS: '100',
  MIN_VIDEO_BYTES: '1000', DOWNLOAD_DIR: path.join(TMP, 'downloads'), WORK_DIR: path.join(TMP, 'work'), POLICY_RETRIES: '2'
});
fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });

const { runLoop } = require('../src/index.js');
const { SupabaseSource } = require('../src/sources/supabaseSource');
const { Supa } = require('../src/supabaseRest');
const { FlowDriver, connectFlow } = require('../src/flowDriver');
const { runRecon } = require('../src/recon');
const core = require('../../core/src');

const silent = { info() {}, warn() {}, error() {}, file: '' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = q => `${MOCK}?${q}&t=${Date.now()}${Math.floor(Math.random() * 1000)}`;

const voice = { base_voice: 'Aoede', gender: 'perempuan', usia: 'muda', nada: 'hangat', energi: 'sedang', tempo: 'normal', gaya: 'ramah_teman', aksen: 'indonesia_netral', bahasa: 'semi_santai' };
const INTRO_JSON = core.buildIntroJson({ name: 'Sari', code: 'C02', flowCharacterName: 'Sari', voiceProfile: voice, settingId: 'S-20' });

// Sumber data dalam memori: meniru antarmuka SupabaseSource.
class MemorySource {
  constructor({ tasks = [], root }) { this.tasks = tasks; this.root = root; this.progressLog = []; this.kind = 'memory'; fs.mkdirSync(root, { recursive: true }); }
  async heartbeat() { return { paused: false }; }
  async claim() { return null; }
  async claimCharTask() { return this.tasks.shift() || null; }
  async charTaskProgress(id, status, patch, event) { this.progressLog.push({ id, status, patch, event }); return status; }
  async progress() { return 'x'; } async log() {} async setPause() {} async requeueStale() { return 0; }
  async fetchCharPhoto(photo, dir) { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, photo.angle + '.png'); fs.writeFileSync(f, PNG); return f; }
  async uploadCharVideo(task, file) { const d = path.join(this.root, task.character_id); fs.mkdirSync(d, { recursive: true }); const dst = path.join(d, `intro-${task.attempt}.mp4`); fs.copyFileSync(file, dst); return dst; }
}
const finalOf = (src) => src.progressLog[src.progressLog.length - 1];

let chromeProc, probe;
const pageNow = () => probe.contexts()[0].pages().find(p => p.url().includes('mockflow'));

test.before(async () => {
  chromeProc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(TMP, 'profile')}`, MOCK], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { probe = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await sleep(300); } }
  assert.ok(probe, 'Chrome uji berjalan');
});
test.after(async () => { try { await probe.close(); } catch { /* abaikan */ } if (chromeProc) chromeProc.kill('SIGKILL'); });

test('penanda: teks dipecah menjadi potongan teks dan satu penanda', () => {
  const parts = FlowDriver.splitMentions('awal @[Sari Dewi] akhir');
  assert.deepEqual(parts, [{ text: 'awal ' }, { mention: 'Sari Dewi' }, { text: ' akhir' }]);
  assert.deepEqual(FlowDriver.splitMentions('tanpa penanda'), [{ text: 'tanpa penanda' }]);
});

test('perkenalan: video 720p 4 detik dibuat dengan karakter dipanggil lewat daftar @, lalu diunduh dan dilaporkan', async () => {
  const src = new MemorySource({ root: path.join(TMP, 'out1'), tasks: [{
    task_id: 'T1', kind: 'intro_video', attempt: 1, max_attempts: 3, character_id: 'CH1', character_code: 'C02',
    project_url: url('delay=400&nochips=1&chars=Sari,Dewi'), flow_character_name: 'Sari', payload: { video_json: INTRO_JSON }, photos: [] }] });
  await runLoop({ source: src, log: silent, maxJobs: 1 });
  const fin = finalOf(src);
  assert.equal(fin.status, 'done', JSON.stringify(fin).slice(0, 400));
  const out = src.root + '/CH1/intro-1.mp4';
  assert.ok(fs.existsSync(out) && fs.statSync(out).size >= 30000);
  assert.equal(fin.patch.video_path, out);
  assert.ok(/\/edit\//.test(fin.patch.flow_asset_url));
  const pg = pageNow();
  const g = await pg.evaluate(() => ({ mentions: window.__mentions, last: window.__lastGen, forbidden: window.__forbidden, generated: window.__generated }));
  assert.deepEqual(g.mentions, ['Sari'], 'karakter dipilih lewat daftar @');
  assert.match(g.last.chip, /720p/); assert.match(g.last.chip, /4 dtk/); assert.match(g.last.chip, /x1/);
  assert.match(g.last.prompt, /@Sari/); assert.match(g.last.prompt, /Hai, aku Sari\. Senang kenalan sama kamu!/);
  assert.ok(!g.last.prompt.includes('@['), 'penanda mentah tidak masuk ke prompt');
  assert.equal(g.last.chips, 0, 'tanpa bahan terlampir');
  assert.equal(g.forbidden, 0); assert.equal(g.generated, 1);
});

test('perkenalan: karakter tidak ada di daftar @ gagal tetap (fatal) tanpa menekan generate', async () => {
  const src = new MemorySource({ root: path.join(TMP, 'out2'), tasks: [{
    task_id: 'T2', kind: 'intro_video', attempt: 1, max_attempts: 3, character_id: 'CH2', character_code: 'C03',
    project_url: url('delay=300&nochips=1&chars=Dewi'), flow_character_name: 'Sari',
    payload: { video_json: core.buildIntroJson({ name: 'Sari', flowCharacterName: 'Sari', voiceProfile: voice }) }, photos: [] }] });
  await runLoop({ source: src, log: silent, maxJobs: 1 });
  const fin = finalOf(src);
  assert.equal(fin.status, 'failed'); assert.equal(fin.patch.error_kind, 'fatal'); assert.match(fin.patch.last_error, /Sari/);
  assert.equal(await pageNow().evaluate(() => window.__generated), 0, 'tidak ada generate');
});

test('upload foto: setiap foto diunggah ke aset project tanpa dilampirkan ke prompt', async () => {
  const src = new MemorySource({ root: path.join(TMP, 'out3'), tasks: [{
    task_id: 'T3', kind: 'upload_photos', attempt: 1, max_attempts: 3, character_id: 'CH3', character_code: 'C02',
    project_url: url('delay=300'), photos: [{ angle: 'face_front', bucket: 'ugc-characters', path: 'x/face_front.png' }, { angle: 'full_front', bucket: 'ugc-characters', path: 'x/full_front.png' }] }] });
  await runLoop({ source: src, log: silent, maxJobs: 1 });
  const fin = finalOf(src);
  assert.equal(fin.status, 'done', JSON.stringify(fin).slice(0, 300)); assert.equal(fin.patch.uploaded, 2);
  const state = await pageNow().evaluate(() => ({ assets: [...document.querySelectorAll('.asset-item')].map(b => b.innerText), chips: document.querySelectorAll('.chip-container').length }));
  assert.equal(state.chips, 0);
  assert.equal(await pageNow().evaluate(() => (typeof assets !== 'undefined' ? assets.length : -1)), 2);
});

test('upload foto: tanpa foto yang disetujui gagal tetap', async () => {
  const src = new MemorySource({ root: path.join(TMP, 'out4'), tasks: [{
    task_id: 'T4', kind: 'upload_photos', attempt: 1, max_attempts: 3, character_id: 'CH4', character_code: 'C05', project_url: url('delay=300'), photos: [] }] });
  await runLoop({ source: src, log: silent, maxJobs: 1 });
  assert.equal(finalOf(src).status, 'failed'); assert.equal(finalOf(src).patch.error_kind, 'fatal');
});

test('project baru: tombol "Project baru" diklik, project terbuka dan diberi nama kode karakter', async () => {
  const conn = await connectFlow(baseCfg, silent);
  const flow = new FlowDriver({ page: conn.page, ctx: conn.ctx, cfg: baseCfg, log: silent });
  const u = await flow.createProject('C02_THE_SOFT_GIRL');
  assert.match(u, /\/project\/new-\d+/);
  const title = await conn.page.locator('input[aria-label="Teks yang dapat diedit"]').inputValue();
  assert.equal(title, 'C02_THE_SOFT_GIRL');
  assert.ok((await conn.page.evaluate(() => window.__projectsCreated)) >= 1);
});

test('mode Agen: dimatikan bila menyala, dibiarkan bila sudah mati', async () => {
  const pg = pageNow(); await pg.goto(url('delay=100'));
  const flow = new FlowDriver({ page: pg, ctx: pg.context(), cfg: baseCfg, log: silent });
  assert.equal(await flow.ensureAgentOff(), 'mati');
  await pg.evaluate(() => document.getElementById('agentbtn').setAttribute('aria-pressed', 'true'));
  assert.equal(await flow.ensureAgentOff(), 'dimatikan');
  assert.equal(await pg.getAttribute('#agentbtn', 'aria-pressed'), 'false');
});

test('perekam layar: tiap Enter menyimpan JSON dan PNG, "s" melewati, "q" berhenti', async () => {
  const pg = pageNow(); await pg.goto(url('delay=100'));
  const input = new PassThrough(); const out = new PassThrough(); const chunks = []; out.on('data', c => chunks.push(c.toString()));
  const dir = path.join(TMP, 'recon');
  const p = runRecon({ page: pg, input, output: out, dir, only: ['beranda-flow', 'project-baru', 'halaman-karakter', 'form-karakter-baru'] });
  input.write('\n'); await sleep(300); input.write('s\n'); await sleep(300); input.write('\n'); await sleep(300); input.write('q\n');
  const done = await p;
  assert.equal(done.length, 2);
  const files = fs.readdirSync(dir).sort();
  assert.ok(files.includes('01-beranda-flow.json') && files.includes('01-beranda-flow.png'));
  assert.ok(files.includes('03-halaman-karakter.json') && !files.some(f => f.startsWith('02-')), 'langkah yang dilewati tidak tersimpan');
  assert.ok(files.includes('RINGKASAN.md'));
  const j = JSON.parse(fs.readFileSync(path.join(dir, '01-beranda-flow.json'), 'utf8'));
  assert.ok(Array.isArray(j.items) && j.items.some(i => i.tag === 'button'));
  assert.ok(chunks.join('').includes('Tekan Enter'));
});

// ── REST Supabase tiruan untuk tugas karakter ───────────────
function startStub(task) {
  const state = { progress: [], uploads: new Map(), downloads: [] };
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks); const u = new URL(req.url, 'http://x');
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (u.pathname === '/auth/v1/token') return json(200, { access_token: 'tok', refresh_token: 'r', expires_in: 3600 });
      const m = u.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/);
      if (m) {
        const args = body.length ? JSON.parse(body) : {};
        if (m[1] === 'ugc_agent_heartbeat') return json(200, { paused: false });
        if (m[1] === 'ugc_requeue_stale') return json(200, 0);
        if (m[1] === 'ugc_claim_next_char_task') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(task.shift() || null)); }
        if (m[1] === 'ugc_char_task_progress') { state.progress.push(args); return json(200, args.p_status); }
        if (m[1] === 'ugc_claim_next_job') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('null'); }
        return json(404, { message: 'rpc?' });
      }
      const dl = u.pathname.match(/^\/storage\/v1\/object\/authenticated\/ugc-characters\/(.+)$/);
      if (dl) { state.downloads.push(decodeURIComponent(dl[1])); res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
      const up = u.pathname.match(/^\/storage\/v1\/object\/ugc-videos\/(.+)$/);
      if (up && req.method === 'POST') { state.uploads.set(decodeURIComponent(up[1]), body); return json(200, { Key: up[1] }); }
      json(404, { message: 'tidak ada' });
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, state, port: server.address().port })));
}

test('Supabase: tugas perkenalan lewat REST (klaim, unduh foto, unggah video, laporan selesai)', async () => {
  const task = [{ task_id: 'TT1', kind: 'intro_video', attempt: 2, max_attempts: 3, character_id: 'CHX', character_code: 'C07',
    project_url: url('delay=300&nochips=1&chars=Sari'), flow_character_name: 'Sari', payload: { video_json: INTRO_JSON }, photos: [] }];
  const { server, state, port } = await startStub(task);
  try {
    const src = new SupabaseSource(new Supa({ url: `http://127.0.0.1:${port}`, anonKey: 'anon', email: 'a@x', password: 'p' }), { agentName: 'uji', version: '0.0.0' });
    await runLoop({ source: src, log: silent, maxJobs: 1 });
    const fin = state.progress.find(p => p.p_status === 'done');
    assert.ok(fin, JSON.stringify(state.progress).slice(0, 300));
    assert.equal(fin.p_patch.video_path, 'characters/CHX/intro-2.mp4');
    assert.ok(state.uploads.get('characters/CHX/intro-2.mp4').length >= 30000);
    assert.equal(fin.p_event.agent, 'uji');
  } finally { server.close(); }
});
