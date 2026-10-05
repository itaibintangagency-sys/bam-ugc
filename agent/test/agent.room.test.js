'use strict';
// Tahap A: ruang karakter (identitas, DNA, suara, foto wajah, project, akun) diisi SEKALI; langkah 4 baru hanya menanyakan storyboard, JSON, resolusi.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bamugc-room-test-'));
const PORT = 9342;
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
const room = require('../src/room');
const wizard = require('../src/wizard');
const core = require('../../core/src');

const silent = { info() {}, warn() {}, error() {}, file: '' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = q => `${MOCK}?${q}&t=${Date.now()}${Math.floor(Math.random() * 1000)}`;
const APP = 'A young woman in her early twenties with long, wavy, light-brown hair with soft caramel highlights, parted in the middle, a soft oval face, a fair to light complexion, and a bright cheerful smile.';
const prof = { photos: [{ role: 'depan' }, { role: 'closeup' }], facts: ['Lengan pendek'], colors: [],
  details: ['detail_utama', 'motif_kain', 'lengan_bawahan_hem', 'siluet_panjang'].map(k => ({ slot_key: k, text: k, label: k, confidence: 0.9 })) };
const mkJson = appearance => core.buildVideoJson(core.buildPanelPlan({ archetypeId: 'A-01', productProfile: prof, settingId: 'S-01', seed: 3 }),
  { characterCode: 'C02', jobTag: 'PRODUCT-01', productProfile: prof, characterPhotoAttached: true, characterProfile: appearance ? { appearance_en: appearance } : undefined });
const VIDEO_JSON = mkJson(APP);

// Pada tes, alamat project apa pun diizinkan (halaman tiruan). Untuk menguji aturan alamat Flow, matikan sementara.
const strict = async fn => { const v = process.env.ALLOW_ANY_PROJECT_URL; delete process.env.ALLOW_ANY_PROJECT_URL; try { return await fn(); } finally { process.env.ALLOW_ANY_PROJECT_URL = v; } };
const file = (name, data) => { const f = path.join(TMP, name); fs.writeFileSync(f, data); return f; };
const FACE = file('wajah_C02.png', PNG), SB = file('storyboard.png', PNG), JS = file('video.json', VIDEO_JSON);
const VOICE = path.join(__dirname, '..', 'contoh', 'profil-suara.contoh.json');
const root = name => { const r = path.join(TMP, name); fs.mkdirSync(r, { recursive: true }); return r; };
const status = (r, id) => JSON.parse(fs.readFileSync(path.join(r, 'inbox', id, 'status.json'), 'utf8'));
const jobDirs = r => fs.readdirSync(path.join(r, 'inbox')).sort();
const dbg = st => JSON.stringify({ galat: st.last_error, status: st.status, akhir: (st.history || []).slice(-3).map(h => h.step + ': ' + String(h.message).slice(0, 80)) });
const fullRoom = (r, over = {}) => room.upsertRoom(r, { code: 'C02_THE_SOFT_GIRL', name: 'Nadia', face: FACE, appearance: APP, voiceFile: VOICE, project: url('delay=300&lang=en'), account: 'Uji Bintang', ...over }).room;

// Wizard: jawaban disuntik lewat aliran masukan, pertanyaan ditangkap dari aliran keluaran.
function io(lines) {
  let out = '';
  return { asker: wizard.makeAsker(Readable.from(lines.map(l => l + '\n')), { write: s => { out += s; } }), text: () => out };
}

let chromeProc, probe;
const pageNow = () => probe.contexts()[0].pages().find(p => p.url().includes('mockflow'));
const counters = () => pageNow().evaluate(() => ({ g: window.__generated, f: window.__forbidden, last: window.__lastGen }));

test.before(async () => {
  chromeProc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(TMP, 'profile')}`, MOCK], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { probe = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await sleep(300); } }
  assert.ok(probe, 'Chrome uji berjalan');
});
test.after(async () => { try { await probe.close(); } catch { /* abaikan */ } if (chromeProc) chromeProc.kill('SIGKILL'); });

// ───────────── Modul ruang ─────────────

test('ruang: tahap naik sesuai isi (draft → face_ready → dna_locked → voice_defined → project_ready), foto disalin sekali', () => {
  const r = root('r1');
  let x = room.upsertRoom(r, { code: 'C02_THE_SOFT_GIRL', name: 'Nadia' }).room; assert.equal(x.status, 'draft'); assert.equal(x.identity_lock, 'none');
  x = room.upsertRoom(r, { code: 'C02_THE_SOFT_GIRL', face: `"${FACE}"` }).room; assert.equal(x.status, 'face_ready'); assert.equal(x.identity_lock, 'reference');
  assert.ok(fs.existsSync(path.join(r, 'rooms', 'C02_THE_SOFT_GIRL', 'face.png')));
  x = room.upsertRoom(r, { code: 'C02_THE_SOFT_GIRL', appearance: APP }).room; assert.equal(x.status, 'dna_locked'); assert.equal(x.identity_lock, 'locked');
  x = room.upsertRoom(r, { code: 'C02_THE_SOFT_GIRL', voiceFile: VOICE }).room; assert.equal(x.status, 'voice_defined');
  assert.match(x.voice_performance_en, /^Woman who sounds young adult/); assert.ok(!('_catatan' in x.voice), 'baris catatan contoh diabaikan');
  x = room.upsertRoom(r, { code: 'C02_THE_SOFT_GIRL', project: 'https://flow.google.com/project/abc-123', account: 'Uji Bintang' }).room; assert.equal(x.status, 'project_ready');
  const same = room.upsertRoom(r, { code: 'C02_THE_SOFT_GIRL', project: 'https://flow.google.com/project/zzz-999' }).room;   // ganti project: data lain tidak hilang
  assert.equal(same.face_ref_path, 'face.png'); assert.equal(same.dna.appearance_en, APP); assert.equal(same.voice.base_voice, 'Achernar'); assert.equal(same.flow_account_name, 'Uji Bintang');
});

test('ruang: masukan salah ditolak dan TIDAK meninggalkan ruang setengah jadi', async () => {
  const r = root('r2');
  assert.throws(() => room.upsertRoom(r, { code: '../luar', name: 'X' }), /Kode karakter .* tidak valid/);
  assert.throws(() => room.upsertRoom(r, { code: 'C09', name: '' }), /Nama karakter wajib diisi/);
  assert.throws(() => room.upsertRoom(r, { code: 'C09', name: 'X', face: path.join(TMP, 'tidak-ada.png') }), /Foto wajah tidak ditemukan/);
  assert.throws(() => room.upsertRoom(r, { code: 'C09', name: 'X', face: file('x.gif', PNG) }), /Format foto ".gif" tidak didukung/);
  const bad = file('suara-salah.json', JSON.stringify({ base_voice: 'Achernar', gender: 'perempuan', usia: 'muda', nada: 'aneh', energi: 'sedang', tempo: 'normal', gaya: 'ramah_teman', aksen: 'indonesia_netral', bahasa: 'baku' }));
  assert.throws(() => room.upsertRoom(r, { code: 'C09', name: 'X', face: FACE, voiceFile: bad }), /Profil suara tidak valid: nada/);
  await strict(async () => assert.throws(() => room.upsertRoom(r, { code: 'C09', name: 'X', project: 'https://contoh.com/x' }), /Alamat project bukan alamat Flow/));
  assert.equal(room.listRooms(r).length, 0, 'tidak ada ruang tersimpan'); assert.ok(!fs.existsSync(path.join(r, 'rooms', 'C09')), 'foto tidak sempat tersalin');
});

test('ruang: deskripsi penampilan bisa dibaca dari JSON paket uji; JSON tanpa character.appearance ditolak dengan pesan jelas', () => {
  const r = root('r3');
  const x = room.upsertRoom(r, { code: 'C02', name: 'Nadia', appearanceFromJson: JS }).room;
  assert.equal(x.dna.appearance_en, APP);
  assert.throws(() => room.upsertRoom(r, { code: 'C03', name: 'Y', appearanceFromJson: file('tanpa.json', mkJson(null)) }), /tidak memuat character\.appearance/);
});

test('pemeriksaan job terhadap ruang: project dan akun harus cocok; selisih nomor akun hanya peringatan', () => {
  const rm = { code: 'C02', flow_project_url: 'https://flow.google.com/project/aaa', flow_account_name: 'Uji Bintang' };
  const job = (u, over = {}) => ({ room_code: 'C02', project_url: u, room: rm, ...over });
  assert.deepEqual(room.checkJobAgainstRoom({ project_url: 'x' }, ''), { problems: [], warnings: [] }, 'job tanpa ruang tidak diperiksa');
  assert.deepEqual(room.checkJobAgainstRoom(job('https://flow.google.com/project/aaa'), 'uji  bintang'), { problems: [], warnings: [] }, 'huruf besar dan spasi ganda tidak masalah');
  assert.match(room.checkJobAgainstRoom(job('https://flow.google.com/project/bbb'), 'Uji Bintang').problems[0], /berbeda dari project ruang/);
  assert.match(room.checkJobAgainstRoom(job('https://flow.google.com/project/aaa'), 'Akun Lama').problems[0], /Akun Google yang terbuka \("Akun Lama"\) berbeda/);
  assert.match(room.checkJobAgainstRoom(job('https://flow.google.com/u/1/project/aaa'), 'Uji Bintang').warnings[0], /Nomor akun/);
  assert.match(room.checkJobAgainstRoom(job('https://flow.google.com/project/aaa'), '').warnings[0], /tidak terbaca/);
  assert.match(room.checkJobAgainstRoom({ room_code: 'C99', room: { missing: true, code: 'C99' } }, '').problems[0], /tidak ditemukan/);
  assert.match(room.checkJobAgainstRoom(job('x', { room: { ...rm, flow_project_url: '' } }), '').problems[0], /belum punya alamat project/);
});

// ───────────── enqueue dari ruang ─────────────

test('enqueue --room: project dan foto wajah diambil dari ruang, job mencatat ruangnya; foto wajah ruang tidak berubah', () => {
  const r = root('e1'); process.env.LOCAL_DIR = r; fullRoom(r);
  const faceBefore = fs.statSync(path.join(r, 'rooms', 'C02_THE_SOFT_GIRL', 'face.png')).mtimeMs;
  enqueueLocal({ room: 'C02_THE_SOFT_GIRL', storyboard: SB, json: JS, res: '360p' });
  enqueueLocal({ room: 'C02_THE_SOFT_GIRL', storyboard: SB, json: JS, res: '360p' });
  const ids = jobDirs(r); assert.equal(ids.length, 2);
  const rm = room.loadRoom(r, 'C02_THE_SOFT_GIRL');
  for (const id of ids) {
    const spec = JSON.parse(fs.readFileSync(path.join(r, 'inbox', id, 'job.json'), 'utf8'));
    assert.equal(spec.project_url, rm.flow_project_url); assert.equal(spec.room_code, 'C02_THE_SOFT_GIRL'); assert.equal(spec.character_code, 'C02_THE_SOFT_GIRL');
    assert.deepEqual(spec.extra_files, ['extra1.png']); assert.ok(fs.existsSync(path.join(r, 'inbox', id, 'extra1.png')));
  }
  assert.equal(fs.statSync(path.join(r, 'rooms', 'C02_THE_SOFT_GIRL', 'face.png')).mtimeMs, faceBefore, 'foto di ruang tidak disalin ulang');
  delete process.env.LOCAL_DIR;
});

test('enqueue --room: ruang tidak ada, ruang belum siap, atau project berbeda ditolak dengan pesan yang menunjuk ke menu yang benar', () => {
  const r = root('e2'); process.env.LOCAL_DIR = r;
  assert.throws(() => enqueueLocal({ room: 'C77', storyboard: SB, json: JS }), /Ruang karakter "C77" tidak ditemukan/);
  room.upsertRoom(r, { code: 'C05', name: 'Belum', face: FACE });
  assert.throws(() => enqueueLocal({ room: 'C05', storyboard: SB, json: JS }), /belum siap \(tahap: face_ready\)/);
  fullRoom(r);
  assert.throws(() => enqueueLocal({ room: 'C02_THE_SOFT_GIRL', project: 'https://flow.google.com/project/lain', storyboard: SB, json: JS }), /menu 2/);
  assert.equal(fs.existsSync(path.join(r, 'inbox')) ? fs.readdirSync(path.join(r, 'inbox')).length : 0, 0, 'tidak ada job yang terbentuk');
  delete process.env.LOCAL_DIR;
});

test('enqueue --room: JSON dengan penampilan berbeda dari ruang memberi PERINGATAN (job tetap dibuat)', () => {
  const r = root('e3'); process.env.LOCAL_DIR = r; fullRoom(r);
  const lines = []; const orig = console.log; console.log = m => lines.push(String(m));
  try { enqueueLocal({ room: 'C02_THE_SOFT_GIRL', storyboard: SB, json: file('beda.json', mkJson('A woman with short black hair.')), res: '360p' }); } finally { console.log = orig; }
  assert.ok(lines.some(l => /PERINGATAN: character\.appearance pada JSON berbeda/.test(l)), lines.join('|'));
  assert.equal(jobDirs(r).length, 1);
  delete process.env.LOCAL_DIR;
});

// ───────────── Wizard ─────────────

test('wizard ruang: seluruh isian sekali jalan; deskripsi penampilan dan teks suara ditampilkan untuk diperiksa sebelum disimpan', async () => {
  const r = root('w1'); const x = io(['C02_THE_SOFT_GIRL', 'Nadia', `"${FACE}"`, JS, VOICE, url('delay=300&lang=en'), 'Uji Bintang', 'Y']);
  const res = await wizard.wizardRoom(r, x.asker);
  assert.equal(res.status, 'project_ready');
  assert.match(x.text(), /PERIKSA DULU/); assert.ok(x.text().includes(APP), 'deskripsi penampilan ditampilkan'); assert.match(x.text(), /Woman who sounds young adult/);
  assert.ok(room.facePath(r, room.loadRoom(r, 'C02_THE_SOFT_GIRL')) && fs.existsSync(room.facePath(r, res)));
});

test('wizard ruang: dibatalkan (bukan Y) atau masukan terputus tidak menyimpan apa pun', async () => {
  const r = root('w2');
  const x = io(['C02', 'Nadia', FACE, JS, '', '', '', 'n']);
  assert.equal(await wizard.wizardRoom(r, x.asker), null); assert.match(x.text(), /Dibatalkan/); assert.equal(room.listRooms(r).length, 0);
  const y = io(['C02', 'Nadia', FACE]);
  await assert.rejects(() => wizard.wizardRoom(r, y.asker), /Input berhenti sebelum selesai/); assert.equal(room.listRooms(r).length, 0);
  const z = io(['C02', 'Nadia', path.join(TMP, 'tidak-ada.png'), JS, '', '', '', 'Y']);
  await assert.rejects(() => wizard.wizardRoom(r, z.asker), /Foto wajah tidak ditemukan/); assert.equal(room.listRooms(r).length, 0);
});

test('wizard tambah produk: HANYA menanyakan storyboard, JSON, resolusi, jenis produk (tidak menanyakan foto wajah, project, atau akun)', async () => {
  const r = root('w3'); process.env.LOCAL_DIR = r; fullRoom(r);
  const x = io([SB, JS, '360p', '', 'Y']);
  const id = await wizard.wizardAdd(r, o => enqueueLocal(o), x.asker);
  assert.match(id, /^job-\d{14}$/);
  const prompts = x.text();
  assert.match(prompts, /Alamat file storyboard/); assert.match(prompts, /Alamat file JSON prompt/); assert.match(prompts, /Resolusi 360p atau 720p/);
  assert.ok(!/alamat project flow|alamat foto wajah|nama akun/i.test(prompts.replace(/Project\s+: \(dari ruang\)/, '')), 'tidak ada pertanyaan project, foto, atau akun: ' + prompts);
  const spec = JSON.parse(fs.readFileSync(path.join(r, 'inbox', id, 'job.json'), 'utf8'));
  assert.equal(spec.resolution, '360p'); assert.deepEqual(spec.extra_files, ['extra1.png']);
  assert.match(prompts, /Jenis produk/); assert.equal(spec.archetype_id, undefined, 'tanpa jawaban = bawaan A-01 ditentukan saat dikirim');
  const y = io([SB, JS, '', '', 'n']);
  assert.equal(await wizard.wizardAdd(r, o => enqueueLocal(o), y.asker), null, 'dibatalkan');
  assert.equal(jobDirs(r).length, 1, 'tidak ada job tambahan');
  delete process.env.LOCAL_DIR;
});

test('wizard tambah produk: ruang belum siap ditolak; dengan dua ruang pengguna memilih nomor', async () => {
  const r = root('w4'); process.env.LOCAL_DIR = r;
  await assert.rejects(() => wizard.wizardAdd(r, o => enqueueLocal(o), io([]).asker), /Belum ada ruang karakter/);
  room.upsertRoom(r, { code: 'C05', name: 'Belum', face: FACE });
  await assert.rejects(() => wizard.wizardAdd(r, o => enqueueLocal(o), io([SB, JS]).asker), /belum siap \(tahap: face_ready\)/);
  fullRoom(r);
  const x = io(['x', '2', SB, JS, '360p', '', 'Y']);   // "x" salah, lalu nomor 2 = C05? urutan abjad: C02..., C05
  await assert.rejects(() => wizard.wizardAdd(r, o => enqueueLocal(o), x.asker), /belum siap \(tahap: face_ready\)/);
  const y = io(['1', SB, JS, '360p', '', 'Y']);
  assert.match(await wizard.wizardAdd(r, o => enqueueLocal(o), y.asker), /^job-/);
  assert.match(x.text(), /Nomor tidak ada/);
  delete process.env.LOCAL_DIR;
});

test('wizard ganti project atau akun: hanya dua nilai itu berubah; foto, penampilan, dan suara tetap', async () => {
  const r = root('w5'); fullRoom(r);
  const x = io(['https://flow.google.com/project/baru-777', 'Akun Baru']);
  const res = await wizard.wizardSet(r, x.asker);
  assert.equal(res.flow_project_url, 'https://flow.google.com/project/baru-777'); assert.equal(res.flow_account_name, 'Akun Baru');
  assert.equal(res.face_ref_path, 'face.png'); assert.equal(res.dna.appearance_en, APP); assert.equal(res.voice.base_voice, 'Achernar'); assert.equal(res.status, 'project_ready');
  const bad = io(['https://contoh.com/x', '']);
  await strict(() => assert.rejects(() => wizard.wizardSet(r, bad.asker), /Alamat project bukan alamat Flow/));
  assert.equal(room.loadRoom(r, 'C02_THE_SOFT_GIRL').flow_project_url, 'https://flow.google.com/project/baru-777', 'alamat salah tidak menimpa');
  assert.match((await (async () => { const z = io(['', '']); await wizard.wizardSet(r, z.asker); return z.text(); })()), /Tidak ada yang diubah/);
});

// ───────────── Pengaman di Flow tiruan ─────────────

test('job dari ruang: lolos pemeriksaan, dua bahan terlampir (storyboard + foto wajah), video terunduh', async () => {
  const r = root('f1'); process.env.LOCAL_DIR = r; fullRoom(r);
  enqueueLocal({ room: 'C02_THE_SOFT_GIRL', storyboard: SB, json: JS, res: '360p' });
  const id = jobDirs(r)[0];
  await runLoop({ source: new LocalSource(r, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });
  const st = status(r, id), c = await counters();
  assert.equal(st.status, 'downloaded', dbg(st));
  assert.ok(st.history.some(h => h.step === 'room_check' && /cocok/.test(h.message)), 'pemeriksaan ruang tercatat');
  assert.equal(c.last.chips, 2, 'dua bahan terlampir');
  assert.ok(!st.history.some(h => h.step === 'room_check' && h.kind === 'warn'), 'tanpa peringatan');
  delete process.env.LOCAL_DIR;
});

test('job dari ruang: project berbeda dari ruang → gagal tetap SEBELUM menyentuh Flow (tidak ada generate, tidak ada percobaan ulang)', async () => {
  const r = root('f2'); process.env.LOCAL_DIR = r; fullRoom(r);
  enqueueLocal({ room: 'C02_THE_SOFT_GIRL', storyboard: SB, json: JS, res: '360p' });
  const id = jobDirs(r)[0]; const jf = path.join(r, 'inbox', id, 'job.json');
  const spec = JSON.parse(fs.readFileSync(jf, 'utf8')); spec.project_url = url('delay=300&lang=en'); fs.writeFileSync(jf, JSON.stringify(spec));   // alamat project lama / karakter lain
  const before = await counters();
  await runLoop({ source: new LocalSource(r, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });
  const st = status(r, id), after = await counters();
  assert.equal(st.status, 'failed', dbg(st)); assert.equal(st.error_kind, 'fatal'); assert.match(st.last_error, /berbeda dari project ruang C02_THE_SOFT_GIRL/);
  assert.ok(!st.history.some(h => ['project', 'attach', 'generate_start', 'generate'].includes(h.step)), 'Flow tidak disentuh');
  assert.equal(after.g, before.g, 'tidak ada video dibuat');
  delete process.env.LOCAL_DIR;
});

test('job dari ruang: akun Google yang terbuka berbeda dari akun ruang → gagal tetap sebelum menyentuh Flow', async () => {
  const r = root('f3'); process.env.LOCAL_DIR = r; fullRoom(r, { account: 'Akun Lama Kredit Habis' });
  enqueueLocal({ room: 'C02_THE_SOFT_GIRL', storyboard: SB, json: JS, res: '360p' });
  const id = jobDirs(r)[0]; const before = await counters();
  await runLoop({ source: new LocalSource(r, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });
  const st = status(r, id), after = await counters();
  assert.equal(st.status, 'failed', dbg(st)); assert.equal(st.error_kind, 'fatal');
  assert.match(st.last_error, /Akun Google yang terbuka \("Uji Bintang"\) berbeda dari akun ruang C02_THE_SOFT_GIRL \("Akun Lama Kredit Habis"\)/);
  assert.ok(!st.history.some(h => ['project', 'attach', 'generate_start', 'generate'].includes(h.step)), 'Flow tidak disentuh');
  assert.equal(after.g, before.g);
  delete process.env.LOCAL_DIR;
});

test('job dari ruang: ruang dihapus setelah job dibuat → gagal tetap dengan pesan jelas; ruang tanpa nama akun tetap jalan', async () => {
  const r = root('f4'); process.env.LOCAL_DIR = r; fullRoom(r, { account: '' });
  enqueueLocal({ room: 'C02_THE_SOFT_GIRL', storyboard: SB, json: JS, res: '360p' });
  const id = jobDirs(r)[0];
  assert.equal(room.loadRoom(r, 'C02_THE_SOFT_GIRL').flow_account_name, '');
  await runLoop({ source: new LocalSource(r, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });
  assert.equal(status(r, id).status, 'downloaded', dbg(status(r, id)));   // tanpa nama akun tercatat: pemeriksaan akun dilewati
  enqueueLocal({ room: 'C02_THE_SOFT_GIRL', storyboard: SB, json: JS, res: '360p' });
  const id2 = jobDirs(r).find(x => x !== id) || jobDirs(r)[1];
  fs.rmSync(path.join(r, 'rooms'), { recursive: true });
  await runLoop({ source: new LocalSource(r, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });
  const st = status(r, id2); assert.equal(st.status, 'failed', dbg(st)); assert.match(st.last_error, /Ruang karakter "C02_THE_SOFT_GIRL" tidak ditemukan/);
  delete process.env.LOCAL_DIR;
});

test('job dari ruang: penampilan pada JSON berbeda dari ruang → peringatan tercatat, job tetap jalan', async () => {
  const r = root('f5'); process.env.LOCAL_DIR = r; fullRoom(r);
  const orig = console.log; console.log = () => {};
  try { enqueueLocal({ room: 'C02_THE_SOFT_GIRL', storyboard: SB, json: file('beda2.json', mkJson('A woman with short black hair.')), res: '360p' }); } finally { console.log = orig; }
  const id = jobDirs(r)[0];
  await runLoop({ source: new LocalSource(r, { backoffMinutes: 0 }), log: silent, maxJobs: 1 });
  const st = status(r, id); assert.equal(st.status, 'downloaded', dbg(st));
  assert.ok(st.history.some(h => h.step === 'room_check' && h.kind === 'warn' && /berbeda dari deskripsi penampilan/.test(h.message)));
  delete process.env.LOCAL_DIR;
});

test('doctor: akun Flow dicocokkan dengan setiap ruang (cocok = lolos, beda = gagal dengan petunjuk)', async () => {
  const r = root('d1'); process.env.LOCAL_DIR = r;
  fullRoom(r); room.upsertRoom(r, { code: 'C09', name: 'Lain', account: 'Akun Lama' });
  await pageNow().goto(url('lang=en&delay=300'));
  const rows = await doctor();
  const ok = rows.find(x => x.name === 'Ruang C02_THE_SOFT_GIRL: akun Google cocok'), bad = rows.find(x => x.name === 'Ruang C09: akun Google cocok');
  assert.ok(ok && ok.pass, JSON.stringify(rows.filter(x => !x.pass)));
  assert.ok(bad && !bad.pass && /Flow memakai "Uji Bintang", ruang mencatat "Akun Lama"/.test(bad.note));
  delete process.env.LOCAL_DIR;
});

// ───────────── Berkas bat dan paket ─────────────

test('mulai.bat: menu 0-7 memanggil perintah yang benar, hanya ASCII dan CRLF; paket memuat contoh profil suara yang valid', () => {
  const b = fs.readFileSync(path.join(__dirname, '..', 'mulai.bat'), 'utf8');
  assert.ok(b.includes('\r\n') && !/[^\r\n]\n/.test(b.replace(/\r\n/g, '')) && [...b].every(c => c.charCodeAt(0) < 128));
  for (const cmd of ['wizard-room', 'wizard-set', 'wizard-add', 'index.js all', 'index.js rooms', 'index.js queue', 'index.js doctor', 'call start-chrome.bat']) assert.ok(b.includes(cmd), cmd);
  for (const n of ['1', '2', '3', '4', '5', '6', '7', '0']) assert.match(b, new RegExp(`if "%PILIH%"=="${n}" goto`));
  assert.match(b, /set "SOURCE=local"/);
  const v = JSON.parse(fs.readFileSync(VOICE, 'utf8')); delete v._catatan;
  assert.deepEqual(core.validateVoiceProfile(v), []);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'), /agent\.room\.test\.js/);
});

test('perintah baris: room-save, rooms, queue bekerja tanpa Chrome', () => {
  const r = root('c1'); process.env.LOCAL_DIR = r;
  const { execFileSync } = require('child_process');
  const run = (...a) => execFileSync(process.execPath, [path.join(__dirname, '..', 'src', 'index.js'), ...a], { env: { ...process.env, LOCAL_DIR: r }, encoding: 'utf8' });
  assert.match(run('room-save', '--code', 'C02', '--name', 'Nadia', '--face', FACE, '--appearance-json', JS, '--voice', VOICE, '--project', 'https://flow.google.com/project/abc'), /tahap: project_ready/);
  assert.match(run('rooms'), /C02 — Nadia[\s\S]*tahap project_ready · foto ya · penampilan ya · suara Achernar/);
  assert.match(run('queue'), /Antrean kosong/);
  run('enqueue-local', '--room', 'C02', '--storyboard', SB, '--json', JS, '--res', '360p');
  assert.match(run('queue'), /job-\d+ — queued/);
  delete process.env.LOCAL_DIR;
});
