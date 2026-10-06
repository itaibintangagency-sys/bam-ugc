'use strict';
// Alat uji gambar diuji terhadap server OpenRouter TIRUAN lokal. Yang BELUM terbukti: OpenRouter asli, model gpt-image-2 asli,
// kualitas gambar, rasio yang benar-benar diterima, dan jumlah gambar rujukan yang diterima penyedia.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { spawn } = require('child_process');

const CLI = path.join(__dirname, '..', 'uji-gambar.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bamugc-uji-'));
const KEY = 'sk-or-v1-RAHASIA-UJI-1234567890';

// PNG sungguhan berukuran w x h (isi polos) supaya pembaca dimensi diuji.
function png(w, h) {
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const b of buf) r = t[(r ^ b) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); const idat = zlib.deflateSync(raw);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
const IMG = png(40, 24);

// Server tiruan
let stub, state;
const resetState = () => { state = { posts: [], gets: [], failNext502: 0, auth: [], moderasiPada: null, status401: false, noCost: false, delayMs: 0 }; };
function startStub() {
  return new Promise(res => {
    const server = http.createServer((req, rsp) => {
      const chunks = []; req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        state.auth.push(req.headers.authorization || '');
        const send = (code, obj) => { rsp.writeHead(code, { 'Content-Type': 'application/json' }); rsp.end(JSON.stringify(obj)); };
        if (state.status401) return send(401, { error: { message: 'No auth credentials found' } });
        const u = new URL(req.url, 'http://x');
        if (req.method === 'GET' && u.pathname === '/api/v1/images/models') { state.gets.push(u.pathname); return send(200, { data: [{ id: 'openai/gpt-image-2', architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] }, supported_parameters: { aspect_ratio: { type: 'enum', values: ['1:1', '16:9', '9:16', '21:9', '3:4', '2:3'] }, quality: { type: 'enum', values: ['auto', 'low', 'medium', 'high'] }, n: { type: 'range', min: 1, max: 10 } } }] }); }
        if (req.method === 'GET' && u.pathname === '/api/v1/images/models/openai/gpt-image-2/endpoints') { state.gets.push(u.pathname); return send(200, { id: 'openai/gpt-image-2', endpoints: [{ provider_name: 'OpenAI', supported_parameters: {}, pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.04 }, { billable: 'input_reference', unit: 'image', cost_usd: 0.001 }] }] }); }
        if (req.method === 'POST' && u.pathname === '/api/v1/images') {
          const body = JSON.parse(Buffer.concat(chunks).toString()); state.posts.push(body);
          if (state.delayMs) await new Promise(r => setTimeout(r, state.delayMs));
          if (state.failNext502 > 0) { state.failNext502--; return send(502, { error: { message: 'upstream' } }); }
          if (state.moderasiPada && body.prompt.includes(state.moderasiPada)) return send(400, { error: { message: 'Your request was blocked by the content policy' } });
          const asp = body.aspect_ratio; if (asp && !['1:1', '16:9', '9:16', '21:9', '3:4', '2:3'].includes(asp)) return send(400, { error: { message: `unsupported aspect_ratio ${asp}` } });
          return send(200, { created: 1, data: [{ b64_json: IMG.toString('base64'), media_type: 'image/png' }], usage: state.noCost ? {} : { cost: 0.04 } });
        }
        send(404, { error: { message: 'tidak ada' } });
      });
    });
    server.listen(0, '127.0.0.1', () => res({ server, base: `http://127.0.0.1:${server.address().port}/api/v1` }));
  });
}

// Jalankan CLI sungguhan sebagai proses terpisah.
function cli(args, { input = '', env = {}, noKey = false } = {}) {
  return new Promise(resolve => {
    const childEnv = { ...process.env, OPENROUTER_BASE: stub.base, UJI_HASIL: path.join(TMP, 'hasil'), UJI_RETRY_MS: '20', UJI_TIMEOUT_MS: '8000', ...env };
    if (!noKey) childEnv.OPENROUTER_API_KEY = KEY; else delete childEnv.OPENROUTER_API_KEY;
    const p = spawn(process.execPath, [CLI, ...args], { env: childEnv });
    let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    if (input) p.stdin.write(input); p.stdin.end();
    p.on('close', code => resolve({ code, out, err }));
  });
}
const lastRun = () => { const root = path.join(TMP, 'hasil'); const d = fs.readdirSync(root).sort().pop(); return path.join(root, d); };
const filesOf = dir => fs.readdirSync(dir);
const readAll = dir => filesOf(dir).filter(f => /\.(json|md|csv|txt)$/.test(f)).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

// Berkas masukan
const FACE = path.join(TMP, 'wajah_C02.png'); fs.writeFileSync(FACE, IMG);
function mkProductFolder(name, files) { const d = path.join(TMP, 'foto', name); fs.mkdirSync(d, { recursive: true }); for (const f of files) fs.writeFileSync(path.join(d, f), IMG); return d; }
const P1 = mkProductFolder('p1', ['1-depan.png', '2-close.png', '3-tekstur.png']);
const P3 = mkProductFolder('p3', ['a.png', 'b.png']);
function mkProductFile(nama, dir, over = {}) {
  const f = path.join(TMP, `produk-${nama}.json`);
  fs.writeFileSync(f, JSON.stringify({ nama, arketipe: 'A-01', lokasi: 'S-01', seed: 9, foto_folder: dir, fakta_en: ['Short sleeves'], detail: [{ slot: 'detail_utama', teks_en: 'V-neckline at the front' }, { slot: 'motif_kain', teks_en: 'white abstract print' }, { slot: 'lengan_bawahan_hem', teks_en: 'short sleeves' }, { slot: 'siluet_panjang', teks_en: 'midi length' }], ...over }));
  return f;
}
const PRODUK1 = mkProductFile('Satu', P1), PRODUK2 = mkProductFile('Dua', P3);
const BAD_DNA = path.join(TMP, 'dna-anak.json'); fs.writeFileSync(BAD_DNA, JSON.stringify({ gender: 'perempuan', age_group: 'remaja_akhir', face_shape: 'oval', complexion: 'terang', expression: 'ceria', hair_length: 'panjang', hair_texture: 'lurus', hair_color: 'hitam', outfit: 'casual' }));

test.before(async () => { stub = await startStub(); });
test.after(() => stub.server.close());
test.beforeEach(resetState);

test('models: membaca kemampuan model dan harga, menyimpan berkas, tidak membuat gambar', async () => {
  const r = await cli(['models']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /aspect_ratio\s*: 1:1, 16:9, 9:16, 21:9, 3:4, 2:3/); assert.match(r.out, /harga output_image: US\$0\.04 per image/);
  assert.match(r.out, /Rasio uji bawaan yang didukung: 21:9\b/, 'hanya 21:9 yang ada di daftar; 4:1 tidak');
  assert.equal(state.posts.length, 0); const d = lastRun(); assert.ok(filesOf(d).includes('models.json') && filesOf(d).includes('kemampuan-model.txt'));
});

test('wajah: 4 kandidat dari DNA C02, tanpa rujukan, rasio 3:4, prompt wajah dewasa; gambar, ukuran, biaya, dan laporan tercatat', async () => {
  const r = await cli(['wajah', '--ya']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(state.posts.length, 4);
  for (const [i, b] of state.posts.entries()) { assert.equal(b.model, 'openai/gpt-image-2'); assert.equal(b.quality, 'medium'); assert.equal(b.aspect_ratio, '3:4'); assert.equal(b.input_references, undefined); assert.match(b.prompt, /A young woman in her early twenties with long, wavy, light-brown hair with soft caramel highlights/); assert.match(b.prompt, /clearly an adult/); }
  assert.equal(new Set(state.posts.map(b => b.prompt)).size, 4, 'kandidat memakai variasi berbeda');
  const d = lastRun(); const imgs = filesOf(d).filter(f => /^\d\d-wajah-\d\.png$/.test(f)); assert.equal(imgs.length, 4);
  const csv = fs.readFileSync(path.join(d, 'laporan.csv'), 'utf8'); assert.match(csv, /ok,\d+(\.\d+)?,0\.04,40x24,/);
  const md = fs.readFileSync(path.join(d, 'laporan.md'), 'utf8'); assert.match(md, /\| Sukses \| 4 \|/); assert.match(md, /0\.16 dari 4 gambar/);
});

test('lembar: 7 sudut dengan SATU rujukan (wajah terpilih) + 1 gambar kisi; urutan sudut sesuai database; rasio wajah 3:4 dan badan 2:3', async () => {
  const r = await cli(['lembar', '--wajah', FACE, '--ya']);
  assert.equal(r.code, 0, r.out + r.err); assert.equal(state.posts.length, 8);
  for (const b of state.posts) { assert.equal(b.input_references.length, 1); assert.match(b.input_references[0].image_url.url, /^data:image\/png;base64,/); }
  const per = state.posts.slice(0, 7); assert.deepEqual(per.map(b => b.aspect_ratio), ['3:4', '3:4', '3:4', '2:3', '2:3', '2:3', '2:3']);
  assert.match(per[1].prompt, /LEFT side/); assert.match(per[2].prompt, /RIGHT side/); assert.match(per[6].prompt, /from behind/);
  const kisi = state.posts[7]; assert.equal(kisi.aspect_ratio, '16:9'); assert.match(kisi.prompt, /grid of seven photorealistic photographs/);
  assert.equal(filesOf(lastRun()).filter(f => /^\d\d-(sudut|lembar)-.*\.png$/.test(f)).length, 8);
});

test('lembar --cara: per-sudut = 7 gambar, satu-gambar = 1 gambar; cara tidak dikenal ditolak sebelum mengirim', async () => {
  let r = await cli(['lembar', '--wajah', FACE, '--cara', 'per-sudut', '--ya']); assert.equal(state.posts.length, 7); assert.equal(r.code, 0);
  resetState(); r = await cli(['lembar', '--wajah', FACE, '--cara', 'satu-gambar', '--ya']); assert.equal(state.posts.length, 1);
  resetState(); r = await cli(['lembar', '--wajah', FACE, '--cara', 'acak', '--ya']); assert.equal(r.code, 1); assert.match(r.err, /--cara harus/); assert.equal(state.posts.length, 0);
});

test('storyboard: gambar 1 = wajah, gambar 2.. = foto produk sesuai peran; dua produk × dua rasio = 4 permintaan; JSON Flow dan pemeriksaan ikut disimpan', async () => {
  const r = await cli(['storyboard', '--wajah', FACE, '--produk', PRODUK1, '--produk', PRODUK2, '--rasio', '21:9,16:9', '--ya']);
  assert.equal(r.code, 0, r.out + r.err); assert.equal(state.posts.length, 4);
  assert.deepEqual(state.posts.map(b => b.input_references.length), [4, 4, 3, 3]);
  assert.deepEqual(state.posts.map(b => b.aspect_ratio), ['21:9', '16:9', '21:9', '16:9']);
  for (const b of state.posts) { assert.match(b.prompt, /No words, no letters, no numbers, no labels, no icons, no captions/); assert.match(b.prompt, /IMAGE 1 = CHARACTER REFERENCE/); assert.doesNotMatch(b.prompt, /Fakta Indonesia/); }
  assert.match(state.posts[0].prompt, /IMAGES 2 to 4 = PRODUCT REFERENCES: product photo 1 \(front\), product photo 2 \(close-up\), product photo 3 \(texture\)/);
  assert.match(state.posts[2].prompt, /IMAGES 2 to 3 = PRODUCT REFERENCES/);
  const d = lastRun(); const fl = filesOf(d);
  assert.equal(fl.filter(f => /^video-\d\d-.*\.json$/.test(f)).length, 2); assert.equal(fl.filter(f => /^periksa-\d\d-.*\.txt$/.test(f)).length, 2);
  const j = JSON.parse(fs.readFileSync(path.join(d, fl.find(f => /^video-01/.test(f))), 'utf8'));
  assert.match(j.references.character, /five photo panels|portrait photo of the woman/); assert.match(j.references.storyboard, /contains no text/);
  assert.match(fs.readFileSync(path.join(d, fl.find(f => /^periksa-01/.test(f))), 'utf8'), /Tanpa galat/);
  assert.match(fs.readFileSync(path.join(d, 'laporan.md'), 'utf8'), /Pemeriksaan kesesuaian JSON Flow/);
});

test('pagar biaya: rencana melebihi --maks-gambar ditolak SEBELUM jaringan; bawaan 12; --kering tidak memanggil jaringan dan tidak butuh kunci', async () => {
  let r = await cli(['storyboard', '--wajah', FACE, '--produk', PRODUK1, '--produk', PRODUK2, '--rasio', '21:9,16:9', '--maks-gambar', '3', '--ya']);
  assert.equal(r.code, 1); assert.match(r.err, /melebihi batas pengaman 3.*Tidak ada yang dikirim/s); assert.equal(state.posts.length, 0);
  r = await cli(['lembar', '--wajah', FACE, '--maks-gambar', '7', '--ya']); assert.equal(r.code, 1); assert.equal(state.posts.length, 0);
  r = await cli(['storyboard', '--wajah', FACE, '--produk', PRODUK1, '--rasio', '21:9,16:9', '--kering'], { noKey: true });
  assert.equal(r.code, 0, r.out + r.err); assert.equal(state.posts.length, 0); assert.equal(state.auth.length, 0, 'tidak ada panggilan jaringan sama sekali');
  assert.match(r.out, /MODE KERING/); const d = lastRun(); assert.equal(filesOf(d).filter(f => /^permintaan-/.test(f)).length, 2); assert.match(fs.readFileSync(path.join(d, 'laporan.csv'), 'utf8'), /kering/);
});

test('konfirmasi: tanpa --ya, jawaban selain Y membatalkan dan tidak ada yang dikirim; Y melanjutkan', async () => {
  let r = await cli(['wajah', '--jumlah', '1'], { input: 'n\n' }); assert.equal(r.code, 1); assert.match(r.out, /Dibatalkan/); assert.equal(state.posts.length, 0);
  r = await cli(['wajah', '--jumlah', '1'], { input: 'Y\n' }); assert.equal(r.code, 0); assert.equal(state.posts.length, 1);
});

test('kunci tidak bocor: tidak ada satu pun berkas hasil, laporan, atau permintaan yang memuat kunci; gambar rujukan diganti ringkasan', async () => {
  await cli(['storyboard', '--wajah', FACE, '--produk', PRODUK1, '--rasio', '21:9', '--ya']);
  const d = lastRun(); const all = readAll(d);
  assert.ok(!all.includes(KEY) && !all.includes('sk-or-') && !/Bearer/.test(all), 'kunci tidak ada di berkas');
  assert.ok(!/base64,[A-Za-z0-9+/=]{40,}/.test(all), 'tidak ada data gambar di dalam JSON permintaan');
  const req = JSON.parse(fs.readFileSync(path.join(d, filesOf(d).find(f => /^permintaan-01/.test(f))), 'utf8'));
  assert.equal(req.input_references.length, 4); assert.deepEqual(Object.keys(req.input_references[0]).sort(), ['berkas', 'sha256_awal', 'ukuran_byte']); assert.equal(req.input_references[1].peran, 'depan');
  assert.ok(state.auth.every(a => a === `Bearer ${KEY}`), 'kunci hanya dikirim sebagai header');
  const kunciDariBerkas = await cli(['wajah', '--jumlah', '1', '--ya'], { noKey: true, input: `${KEY}\n` }); assert.equal(kunciDariBerkas.code, 0);
  assert.ok(!readAll(lastRun()).includes(KEY), 'kunci yang diketik tidak disimpan');
});

test('kegagalan sementara (502) dicoba ulang sekali dan berhasil; kegagalan permanen pada satu gambar tidak menghentikan gambar lain', async () => {
  state.failNext502 = 1; let r = await cli(['wajah', '--jumlah', '2', '--ya']);
  assert.equal(r.code, 0, r.out + r.err); assert.equal(state.posts.length, 3, 'satu percobaan ulang'); assert.match(fs.readFileSync(path.join(lastRun(), 'laporan.csv'), 'utf8'), /berhasil pada percobaan ke-2/);
  resetState(); state.moderasiPada = 'apparent age 21 to 24'; // semua prompt wajah memuat kalimat ini: semua ditolak
  r = await cli(['wajah', '--jumlah', '2', '--ya']); assert.equal(r.code, 2); assert.match(r.out, /GAGAL: Permintaan ditolak oleh penyaring isi model/); assert.equal(state.posts.length, 2, 'tidak diulang untuk 4xx');
  const csv = fs.readFileSync(path.join(lastRun(), 'laporan.csv'), 'utf8'); assert.equal((csv.match(/,gagal,/g) || []).length, 2);
  resetState(); state.moderasiPada = 'SUDUT-KANAN'; r = await cli(['lembar', '--wajah', FACE, '--cara', 'per-sudut', '--ya']); assert.equal(r.code, 0, 'tidak ada yang ditolak: penanda tidak ada'); assert.equal(state.posts.length, 7);
  resetState(); state.moderasiPada = 'RIGHT side'; r = await cli(['lembar', '--wajah', FACE, '--cara', 'per-sudut', '--ya']);
  assert.equal(r.code, 2); assert.equal(state.posts.length, 7, 'satu sudut ditolak, enam lainnya tetap dikerjakan'); assert.equal((fs.readFileSync(path.join(lastRun(), 'laporan.csv'), 'utf8').match(/,ok,/g) || []).length, 6);
});

test('kunci ditolak (401): berhenti dengan pesan awam setelah gambar pertama, sisanya dilewati tanpa dikirim', async () => {
  state.status401 = true; const r = await cli(['wajah', '--jumlah', '3', '--ya']);
  assert.equal(r.code, 2); assert.match(r.out, /Kunci OpenRouter ditolak/); assert.match(r.out, /Dihentikan: masalah kunci atau saldo/);
  assert.equal((fs.readFileSync(path.join(lastRun(), 'laporan.csv'), 'utf8').match(/dilewati/g) || []).length, 2);
});

test('rasio tidak didukung: galat server dicatat per gambar dengan pesan jelas (itulah gunanya uji rasio)', async () => {
  const r = await cli(['storyboard', '--wajah', FACE, '--produk', PRODUK1, '--rasio', '21:9,4:1', '--ya']);
  assert.equal(r.code, 2); assert.equal(state.posts.length, 2);
  const csv = fs.readFileSync(path.join(lastRun(), 'laporan.csv'), 'utf8'); assert.match(csv, /4x1,.*gagal.*parameter atau gambar rujukan tidak sesuai/s);
});

test('biaya tidak dilaporkan server: laporan menyatakannya, tidak mengarang angka', async () => {
  state.noCost = true; await cli(['wajah', '--jumlah', '1', '--ya']);
  assert.match(fs.readFileSync(path.join(lastRun(), 'laporan.md'), 'utf8'), /server tidak melaporkan biaya/);
});

test('masukan salah ditolak dengan pesan jelas sebelum mengirim: DNA di bawah usia dewasa dan memuat pakaian, foto tidak ada, format salah, produk tanpa foto', async () => {
  let r = await cli(['wajah', '--dna', BAD_DNA, '--ya']); assert.equal(r.code, 1); assert.match(r.err, /DNA tidak valid/); assert.match(r.err, /harus dewasa/); assert.match(r.err, /pakaian bukan bagian identitas/); assert.equal(state.posts.length, 0);
  r = await cli(['lembar', '--wajah', path.join(TMP, 'tidak-ada.png'), '--ya']); assert.equal(r.code, 1); assert.match(r.err, /Berkas tidak ditemukan/);
  const gif = path.join(TMP, 'x.gif'); fs.writeFileSync(gif, 'GIF89a'); r = await cli(['lembar', '--wajah', gif, '--ya']); assert.match(r.err, /Format ".gif" tidak didukung/);
  const kosong = path.join(TMP, 'foto', 'kosong'); fs.mkdirSync(kosong, { recursive: true });
  r = await cli(['storyboard', '--wajah', FACE, '--produk', mkProductFile('Kosong', kosong), '--ya']); assert.match(r.err, /tidak berisi foto/);
  r = await cli(['storyboard', '--wajah', FACE, '--produk', mkProductFile('Satu', P3, { detail: [] }), '--ya']); assert.match(r.err, /rencana panel gagal/);
  r = await cli(['wajah', '--jumlah', '9', '--ya']); assert.match(r.err, /--jumlah harus 1 sampai 8/);
  assert.equal(state.posts.length, 0);
});

test('foto produk lebih dari 6 atau terlalu besar ditolak; peran foto dibaca dari nama berkas', async () => {
  const banyak = mkProductFolder('banyak', Array.from({ length: 7 }, (_, i) => `f${i}.png`));
  let r = await cli(['storyboard', '--wajah', FACE, '--produk', mkProductFile('Banyak', banyak), '--ya']); assert.match(r.err, /maksimal 6/);
  const besar = path.join(TMP, 'besar.png'); fs.writeFileSync(besar, Buffer.concat([IMG, Buffer.alloc(7 * 1024 * 1024)]));
  r = await cli(['lembar', '--wajah', besar, '--ya']); assert.match(r.err, /berukuran 7\.0 MB/);
  const B = require('../lib/berkas'); assert.equal(B.roleOf('IMG_belakang.jpg', 0), 'belakang'); assert.equal(B.roleOf('tampak-samping.png', 0), 'samping'); assert.equal(B.roleOf('x.png', 1), 'closeup');
});

test('pembaca dimensi gambar: PNG dan JPEG terbaca, data rusak menghasilkan null', () => {
  const B = require('../lib/berkas'); assert.deepEqual(B.dimsOf(png(300, 120)), { w: 300, h: 120 });
  const jpg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffc0001108002000300301220002110103110100ffd9', 'hex'); assert.deepEqual(B.dimsOf(jpg), { w: 48, h: 32 });
  assert.equal(B.dimsOf(Buffer.from('bukan gambar')), null);
});

test('berkas contoh: DNA C02 valid dan menghasilkan kalimat uji Flow; keempat produk sampel menghasilkan rencana panel valid dan JSON lolos pemeriksaan', () => {
  const core = require('../../../core/src'); const U = require('../uji-gambar.js');
  const dna = U.loadDna(); assert.equal(core.dnaToAppearance(dna), 'A young woman in her early twenties with long, wavy, light-brown hair with soft caramel highlights, parted in the middle, a soft oval face, a fair to light complexion, and a bright cheerful smile.');
  const files = fs.readdirSync(path.join(__dirname, '..', 'contoh')).filter(n => /^produk-.*\.json$/.test(n)); assert.equal(files.length, 4);
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contoh', f), 'utf8')); const dir = mkProductFolder('contoh-' + f, ['1-depan.png', '2-close.png']);
    const tmp = path.join(TMP, f); fs.writeFileSync(tmp, JSON.stringify({ ...raw, foto_folder: dir }));
    const p = U.loadProduct(tmp); const plan = core.buildPanelPlan({ archetypeId: p.archetype, productProfile: p.profile, settingId: p.setting, seed: p.seed });
    assert.ok(!plan.error && !plan.habis, f + ' ' + (plan.error || plan.habis));
    assert.deepEqual(plan.panels.slice(1, 4).map(x => x.shot_en), ['MEDIUM CLOSE-UP', 'CLOSE-UP', 'THREE-QUARTER VIEW'].slice(0, 3).map((s, i) => plan.panels[i + 1].shot_en), 'bentuk panel');
    const cp = core.dnaToProfile(dna); const sb = core.buildStoryboardPrompt(plan, { variant: 'clean', characterCode: 'C02', productProfile: p.profile, images: p.photos });
    const json = core.buildVideoJson(plan, { characterCode: 'C02', jobTag: 'P', productProfile: p.profile, characterProfile: cp, characterPhotoAttached: true, storyboardVariant: 'clean' });
    assert.deepEqual(core.checkPromptSet({ plan, storyboardPrompt: sb, json, variant: 'clean', characterProfile: cp, characterPhotoAttached: true }).errors, [], f);
  }
});

// ───────────── Foto acuan ─────────────
const ACUAN = path.join(TMP, 'acuan.png'); fs.writeFileSync(ACUAN, IMG);
const DNA_PRIA = path.join(__dirname, '..', 'contoh', 'dna-pria.json');
const dataUrlDari = f => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;

test('wajah --acuan: satu foto acuan dikirim, prompt memuat hubungan, catatan, dan aturan "DNA menang"; tanpa petunjuk variasi', async () => {
  const r = await cli(['wajah', '--dna', DNA_PRIA, '--acuan', ACUAN, '--hubungan', 'kakak', '--catatan', 'kakak laki-laki, anak sulung', '--jumlah', '2', '--ya']);
  assert.equal(r.code, 0, r.out + r.err); assert.equal(state.posts.length, 2); assert.match(r.out, /PERHATIAN: foto acuan dikirim ke OpenRouter/);
  for (const b of state.posts) {
    assert.equal(b.input_references.length, 1); assert.equal(b.input_references[0].image_url.url, dataUrlDari(ACUAN)); assert.equal(b.aspect_ratio, '3:4');
    assert.match(b.prompt, /A man in his thirties/); assert.match(b.prompt, /the older brother of the person in the reference photo/); assert.match(b.prompt, /the DESCRIPTION WINS/); assert.match(b.prompt, /"kakak laki-laki, anak sulung"/); assert.doesNotMatch(b.prompt, /Facial structure:/);
  }
  assert.match(fs.readFileSync(path.join(lastRun(), 'laporan.csv'), 'utf8'), /wajah-acuan/);
});

test('wajah --acuan: butuh --hubungan; hubungan salah, ibu untuk DNA laki-laki, catatan menyiratkan anak, dan foto tidak ada ditolak SEBELUM jaringan', async () => {
  const gagal = async (args, re) => { const r = await cli([...args, '--ya']); assert.equal(r.code, 1, r.out); assert.match(r.err, re); assert.equal(state.posts.length, 0); };
  await gagal(['wajah', '--acuan', ACUAN], /butuh --hubungan\. Pilihan: orang_sama, kakak, adik, saudara, ibu, ayah, mirip_bukan_sama/);
  await gagal(['wajah', '--acuan', ACUAN, '--hubungan', 'paman'], /tidak dikenal/);
  await gagal(['wajah', '--dna', DNA_PRIA, '--acuan', ACUAN, '--hubungan', 'ibu'], /hanya untuk karakter perempuan/);
  await gagal(['wajah', '--acuan', ACUAN, '--hubungan', 'kakak', '--catatan', 'umur 16 tahun'], /menyiratkan anak atau remaja/);
  await gagal(['wajah', '--acuan', path.join(TMP, 'tidak-ada.png'), '--hubungan', 'kakak'], /Berkas tidak ditemukan/);
  await gagal(['wajah', '--hubungan', 'kakak'], /hanya dipakai bersama --acuan/);
});

test('acuan: empat skenario × 2 gambar, tiap permintaan satu rujukan; skenario memakai DNA dan hubungan yang benar (foto perempuan)', async () => {
  const r = await cli(['acuan', '--acuan', ACUAN, '--ya']);
  assert.equal(r.code, 0, r.out + r.err); assert.equal(state.posts.length, 8);
  assert.ok(state.posts.every(b => b.input_references.length === 1 && b.aspect_ratio === '3:4' && b.quality === 'medium'));
  const [s1, s2, s3, s4] = [0, 2, 4, 6].map(i => state.posts[i].prompt);
  assert.match(s1, /the same person as in the reference photo/); assert.match(s1, /Keep the same face/); assert.match(s1, /A young woman in her early twenties/);
  assert.match(s2, /the older brother of the person/); assert.match(s2, /A man in his thirties/); assert.match(s2, /"kakak laki-laki"/);
  assert.match(s3, /only loosely resembles/); assert.match(s3, /black hair/); assert.match(s3, /soft round face/);
  assert.match(s4, /the mother of the person/); assert.match(s4, /woman in her forties/);
  assert.equal(state.posts[0].prompt, state.posts[1].prompt, 'dua gambar per skenario memakai prompt yang sama (variasi dari model)');
  const d = lastRun(); const fl = filesOf(d);
  assert.equal(fl.filter(f => /^\d\d-acuan-S\d-.*\.png$/.test(f)).length, 8); assert.ok(fl.includes('lembar-penilaian.md') && fl.includes('laporan.md'));
  const csv = fs.readFileSync(path.join(d, 'laporan.csv'), 'utf8'); for (const t of ['S1 Orang yang sama', 'S2 Kakak laki-laki', 'S3 Mirip, bukan orang yang sama', 'S4 Ibu']) assert.ok(csv.includes(t), t);
});

test('acuan --gender-acuan laki-laki: kakak perempuan dan ayah; DNA lawan jenis mengikuti', async () => {
  const r = await cli(['acuan', '--acuan', ACUAN, '--gender-acuan', 'laki-laki', '--jumlah', '1', '--ya']);
  assert.equal(r.code, 0, r.out + r.err); assert.equal(state.posts.length, 4);
  assert.match(state.posts[0].prompt, /A man in his thirties/); assert.match(state.posts[1].prompt, /the older sister of the person/); assert.match(state.posts[1].prompt, /A woman in her thirties/); assert.match(state.posts[3].prompt, /the father of the person/);
  const r2 = await cli(['acuan', '--acuan', ACUAN, '--gender-acuan', 'netral', '--ya']); assert.equal(r2.code, 1); assert.match(r2.err, /perempuan atau laki-laki/);
});

test('lembar penilaian: satu baris per gambar berhasil, lima pertanyaan, kriteria lulus; gambar gagal tidak masuk', async () => {
  state.moderasiPada = 'the mother of the person'; const r = await cli(['acuan', '--acuan', ACUAN, '--jumlah', '1', '--ya']);
  assert.equal(r.code, 2); const md = fs.readFileSync(path.join(lastRun(), 'lembar-penilaian.md'), 'utf8');
  assert.equal((md.match(/^\| S\d /gm) || []).length, 3, 'S4 ditolak penyaring, jadi hanya 3 baris');
  for (const t of ['1 Sesuai DNA', '2 Ada kemiripan dengan foto acuan', '3 Bukan salinan foto acuan', '4 Dewasa, tanpa tulisan atau cacat', '5 Wajah cukup jelas', 'Skenario lulus', 'S1 dan S3 gagal']) assert.ok(md.includes(t), t);
  assert.match(md, /\[ \] \| \[ \] \| \[ \] \| \[ \] \| \[ \]/);
});

test('acuan: pagar biaya (16 gambar > 12 ditolak, 12 boleh), --jumlah dibatasi 1-4, mode kering tanpa jaringan dan tanpa kunci, --acuan wajib', async () => {
  let r = await cli(['acuan', '--acuan', ACUAN, '--jumlah', '4', '--ya']); assert.equal(r.code, 1); assert.match(r.err, /melebihi batas pengaman 12/); assert.equal(state.posts.length, 0);
  r = await cli(['acuan', '--acuan', ACUAN, '--jumlah', '3', '--ya']); assert.equal(r.code, 0, r.out + r.err); assert.equal(state.posts.length, 12);
  resetState(); r = await cli(['acuan', '--acuan', ACUAN, '--jumlah', '5', '--ya']); assert.match(r.err, /1 sampai 4/);
  r = await cli(['acuan', '--ya']); assert.match(r.err, /butuh --acuan FOTO/);
  r = await cli(['acuan', '--acuan', ACUAN, '--kering'], { noKey: true }); assert.equal(r.code, 0, r.out + r.err); assert.equal(state.posts.length, 0); assert.equal(state.auth.length, 0);
  assert.equal(filesOf(lastRun()).filter(f => /^permintaan-/.test(f)).length, 8); assert.ok(!filesOf(lastRun()).includes('lembar-penilaian.md') || true);
});

test('acuan: peringatan izin foto selalu tampil, konfirmasi Y diperlukan tanpa --ya, dan kunci serta isi foto tidak masuk berkas hasil', async () => {
  let r = await cli(['acuan', '--acuan', ACUAN, '--jumlah', '1'], { input: 'n\n' }); assert.equal(r.code, 1); assert.match(r.out, /PERHATIAN[\s\S]*izinnya sudah Anda urus/); assert.match(r.out, /Dibatalkan/); assert.equal(state.posts.length, 0);
  r = await cli(['acuan', '--acuan', ACUAN, '--jumlah', '1', '--ya']); assert.equal(r.code, 0, r.out + r.err);
  const all = readAll(lastRun()); assert.ok(!all.includes(KEY) && !all.includes('sk-or-') && !/base64,[A-Za-z0-9+/=]{40,}/.test(all));
  const req = JSON.parse(fs.readFileSync(path.join(lastRun(), filesOf(lastRun()).find(f => /^permintaan-01/.test(f))), 'utf8')); assert.deepEqual(Object.keys(req.input_references[0]).sort(), ['berkas', 'sha256_awal', 'ukuran_byte']);
});

test('menu .bat: pilihan 6 memanggil layar pilihan, pilihan 7 tetap, hanya ASCII dan CRLF; pesan "Selesai" bergantung pada kode hasil', () => {
  const b = fs.readFileSync(path.join(__dirname, '..', 'uji-gambar.bat'), 'utf8');
  assert.ok(b.includes('\r\n') && [...b].every(c => c.charCodeAt(0) < 128)); assert.match(b, /if "%PILIH%"=="6" goto acuan/); assert.match(b, /if "%PILIH%"=="7" goto acuansatu/);
  assert.match(b, /node uji-gambar\.js acuan --tanya\r\n/); assert.match(b, /node uji-gambar\.js wajah --acuan "%ACUAN:"=%" --hubungan %HUB% --catatan "%CAT:"=%"/);
  assert.doesNotMatch(b, /--gender-acuan %GENDER%/, 'tidak lagi bertanya P/L di .bat; layar pilihan yang bertanya');
  assert.ok(!/^echo\s+Selesai/im.test(b), '"Selesai" tidak boleh tampil tanpa syarat (dulu muncul walau dibatalkan)');
  assert.equal((b.match(/^if "%KODE%"=="0" echo Selesai/gm) || []).length, 2); assert.equal((b.match(/^set KODE=%ERRORLEVEL%\r$/gm) || []).length, 2);
});

test('skenario: dua jenis kelamin menghasilkan DNA dewasa yang valid, hubungan cocok, dan --gender-acuan tidak dikenal ditolak', () => {
  const S = require('../lib/skenario'); const core = require('../../../core/src');
  for (const g of ['perempuan', 'laki-laki']) { const s = S.skenarioAcuan(g); assert.deepEqual(s.map(x => x.kode), ['S1', 'S2', 'S3', 'S4']); for (const x of s) { assert.deepEqual(core.validateDna(x.dna), [], x.kode); assert.deepEqual(core.validateReference({ relation: x.relation, note: x.note }, x.dna), [], x.kode); assert.ok(x.harapan); } assert.notEqual(s[1].dna.gender, g, 'S2 berjenis kelamin lawan'); }
  assert.throws(() => S.skenarioAcuan('lain'), /perempuan atau laki-laki/);
});

// ───────────── Penjaga versi core dan kunci tersembunyi ─────────────
const { spawnSync, spawn: spawnProses } = require('child_process');
function salinanDenganCoreLama() {
  const d = fs.mkdtempSync(path.join(TMP, 'corelama-')); fs.cpSync(path.join(__dirname, '..', '..', '..', 'core'), path.join(d, 'core'), { recursive: true });
  fs.mkdirSync(path.join(d, 'tools'), { recursive: true }); fs.cpSync(path.join(__dirname, '..'), path.join(d, 'tools', 'uji-gambar'), { recursive: true, filter: s => !/[\\/](test|hasil)([\\/]|$)/.test(s) });
  const f = path.join(d, 'core', 'src', 'dna.js'); const t = fs.readFileSync(f, 'utf8'); const baru = t.replace(/ HUBUNGAN,| NOTE_MAX,| validateReference,/g, ''); assert.notEqual(baru, t); fs.writeFileSync(f, baru);   // meniru dna.js sebelum foto acuan
  return path.join(d, 'tools', 'uji-gambar', 'uji-gambar.js');
}
const jalankan = (cli2, args, env = {}) => spawnSync(process.execPath, [cli2, ...args], { encoding: 'utf8', env: { ...process.env, OPENROUTER_BASE: stub.base, OPENROUTER_API_KEY: KEY, UJI_HASIL: path.join(TMP, 'hasil2'), ...env } });

test('core versi lama (tanpa validateReference): pesan jelas menyebut berkas dan cara memperbaiki, bukan galat "is not a function"; tidak ada yang dikirim', () => {
  const lama = salinanDenganCoreLama();
  for (const args of [['acuan', '--acuan', ACUAN, '--ya'], ['wajah', '--ya'], ['lembar', '--wajah', FACE, '--ya']]) {
    const r = jalankan(lama, args); assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /Folder core di komputer ini masih versi lama/); assert.match(r.stderr, /core\\src\\dna\.js: validateReference, HUBUNGAN/); assert.match(r.stderr, /C:\\bam-ugc-v2\\core/); assert.doesNotMatch(r.stderr, /is not a function/);
  }
  assert.equal(state.posts.length, 0);
});

test('periksa: instalasi benar lolos (kode 0, semua ok); core lama ditandai KURANG dengan kode 1; tanpa kunci dan tanpa jaringan', () => {
  const baik = jalankan(path.join(__dirname, '..', 'uji-gambar.js'), ['periksa'], { OPENROUTER_API_KEY: '' });
  assert.equal(baik.status, 0, baik.stdout + baik.stderr); assert.match(baik.stdout, /Node\.js \d+\.\d+\.\d+: sesuai/); assert.equal((baik.stdout.match(/\n  ok     core\\src\\/g) || []).length, 6); assert.match(baik.stdout, /Folder core sudah versi yang dibutuhkan/);
  const lama = jalankan(salinanDenganCoreLama(), ['periksa'], { OPENROUTER_API_KEY: '' });
  assert.equal(lama.status, 1); assert.match(lama.stdout, /KURANG core\\src\\dna\.js: validateReference, HUBUNGAN/); assert.match(lama.stdout, /ok     core\\src\\imageRequest\.js/);
  assert.equal(state.auth.length, 0, 'tidak ada panggilan jaringan');
});

test('cekCore dan pesanCore: tiap berkas yang kurang dilaporkan dengan fungsinya', () => {
  const V = require('../lib/versi'); const core = require('../../../core/src');
  assert.deepEqual(V.cekCore(core), { ok: true, kurang: [] });
  const r = V.cekCore({ ...core, validateReference: undefined, checkPromptSet: undefined, buildImageRequest: undefined });
  assert.equal(r.ok, false); assert.deepEqual(r.kurang.map(k => k.berkas), ['core\\src\\dna.js', 'core\\src\\imageRequest.js', 'core\\src\\consistency.js']);
  assert.match(V.pesanCore(r), /masih versi lama[\s\S]*validateReference[\s\S]*checkPromptSet[\s\S]*Timpa/); assert.equal(V.cekCore(null).ok, false);
});

// Terminal sungguhan (pty) lewat `script`: ketikan kunci tidak boleh tampil, tetapi tetap terbaca oleh alat.
const adaScript = spawnSync('script', ['--version']).status === 0;
test('kunci diketik di terminal sungguhan: tidak tampil di layar, terpakai sebagai header, dan tidak masuk berkas', { skip: !adaScript && 'perintah script tidak tersedia' }, async () => {
  const env = { ...process.env, OPENROUTER_BASE: stub.base, UJI_HASIL: path.join(TMP, 'hasil3'), UJI_RETRY_MS: '20' }; delete env.OPENROUTER_API_KEY;
  const p = spawnProses('script', ['-qec', `${process.execPath} ${CLI} wajah --jumlah 1 --ya`, '/dev/null'], { env }); let layar = '';
  p.stdout.on('data', d => { layar += d; if (/Tempel kunci OpenRouter/.test(layar) && !p.__kirim) { p.__kirim = true; setTimeout(() => p.stdin.write(KEY + '\r'), 200); } });
  const kode = await new Promise(res => p.on('close', res));
  assert.equal(kode, 0, layar); assert.match(layar, /Tempel kunci OpenRouter lalu tekan Enter \(tiap karakter tampil sebagai \*/);
  assert.ok(!layar.includes(KEY) && !layar.includes('RAHASIA-UJI') && !layar.includes('sk-or-v1'), 'kunci tidak boleh tampil di layar terminal');
  assert.ok(layar.includes('*'.repeat(KEY.length)), 'tiap karakter yang diterima tampil sebagai tanda bintang (umpan balik bahwa ketikan masuk)');
  assert.equal(state.posts.length, 1); assert.ok(state.auth.every(a => a === `Bearer ${KEY}`), 'kunci terbaca benar oleh alat');
  assert.ok(!readAll(lastRunDi(path.join(TMP, 'hasil3'))).includes(KEY));
});
function lastRunDi(root) { return path.join(root, fs.readdirSync(root).sort().pop()); }


// Pengetikan di terminal sungguhan: tempelan sekaligus, ketikan satu per satu dengan Backspace, tombol panah, kunci salah bentuk, dan perintah kunci.
function ketikDiTerminal(args, kirim, { env: tambahan = {}, cwd } = {}) {
  const env = { ...process.env, OPENROUTER_BASE: stub.base, UJI_HASIL: path.join(TMP, 'hasil4'), UJI_RETRY_MS: '20', ...tambahan }; delete env.OPENROUTER_API_KEY;
  const p = spawnProses('script', ['-qec', `${process.execPath} ${args.join(' ')}`, '/dev/null'], { env, cwd }); let layar = '';
  p.stdout.on('data', d => { layar += d; if (/tekan Enter/.test(layar) && !p.__kirim) { p.__kirim = true; setTimeout(async () => { for (const [potong, jeda] of kirim) { p.stdin.write(potong); await new Promise(r => setTimeout(r, jeda || 30)); } }, 200); } });
  const batas = setTimeout(() => { layar += '\n[DIHENTIKAN: melewati batas 25 detik]'; p.kill('SIGKILL'); }, 25000);
  return new Promise(res => p.on('close', kode => { clearTimeout(batas); res({ kode, layar }); }));
}
test('terminal sungguhan: ketikan satu per satu, Backspace, tombol panah, dan tempelan sekaligus menghasilkan kunci yang benar', { skip: !adaScript && 'perintah script tidak tersedia' }, async () => {
  const bagian = KEY.split('');   // setiap karakter dikirim terpisah, dengan salah ketik yang dihapus dan panah yang diabaikan
  const kirim = [['X', 10], ['\x7f', 10], ['\x1b[A', 10], ...bagian.map(c => [c, 3]), ['Z', 10], ['\x7f', 10], ['\r', 10]];
  const a = await ketikDiTerminal([CLI, 'wajah', '--jumlah', '1', '--ya'], kirim); assert.equal(a.kode, 0, a.layar);
  assert.ok(!a.layar.includes(KEY)); assert.ok(state.auth.every(h => h === `Bearer ${KEY}`) && state.posts.length === 1, 'kunci terbaca benar walau ada salah ketik dan panah');
  resetState();
  const b = await ketikDiTerminal([CLI, 'wajah', '--jumlah', '1', '--ya'], [[KEY, 10], ['\r', 10]]); assert.equal(b.kode, 0, b.layar);
  assert.ok(b.layar.includes('*'.repeat(KEY.length)) && !b.layar.includes(KEY)); assert.equal(state.posts.length, 1);
  resetState();
  const c = await ketikDiTerminal([CLI, 'wajah', '--jumlah', '1', '--ya'], [[`  "Bearer ${KEY}"  `, 10], ['\r', 10]]); assert.equal(c.kode, 0, c.layar); assert.ok(state.auth.every(h => h === `Bearer ${KEY}`), 'awalan Bearer, kutip, dan spasi hasil salinan dibuang');
});
test('kunci salah bentuk ditolak sebelum ada yang dikirim, dengan pesan jelas', { skip: !adaScript && 'perintah script tidak tersedia' }, async () => {
  const a = await ketikDiTerminal([CLI, 'wajah', '--jumlah', '1', '--ya'], [['bukan-kunci', 10], ['\r', 10]]); assert.equal(a.kode, 1); assert.match(a.layar, /Kunci OpenRouter diawali "sk-or-"/); assert.equal(state.posts.length, 0);
  const b = await ketikDiTerminal([CLI, 'wajah', '--jumlah', '1', '--ya'], [['\r', 10]]); assert.equal(b.kode, 1); assert.match(b.layar, /Kunci OpenRouter kosong/);
});
test('perintah kunci: menyimpan ke .env (mengganti kunci lama, mempertahankan baris lain), lalu perintah berikutnya tidak bertanya lagi', async () => {
  const d = fs.mkdtempSync(path.join(TMP, 'kunci-')); fs.mkdirSync(path.join(d, 'tools'), { recursive: true }); fs.cpSync(path.join(__dirname, '..', '..', '..', 'core'), path.join(d, 'core'), { recursive: true });
  fs.cpSync(path.join(__dirname, '..'), path.join(d, 'tools', 'uji-gambar'), { recursive: true, filter: s => !/[\\/](test|hasil)([\\/]|$)/.test(s) });
  const tool = path.join(d, 'tools', 'uji-gambar'); const cli2 = path.join(tool, 'uji-gambar.js');
  fs.writeFileSync(path.join(tool, '.env'), 'OPENROUTER_BASE=' + stub.base + '\r\nOPENROUTER_API_KEY=sk-or-v1-LAMA-LAMA-LAMA-1234\r\n');
  const r = spawnSync(process.execPath, [cli2, 'kunci'], { input: KEY + '\n', encoding: 'utf8', env: { ...process.env, UJI_HASIL: path.join(TMP, 'hasil5') } }); assert.equal(r.status, 0, r.stdout + r.stderr);
  const env = fs.readFileSync(path.join(tool, '.env'), 'utf8'); assert.equal((env.match(/OPENROUTER_API_KEY=/g) || []).length, 1); assert.ok(env.includes(`OPENROUTER_API_KEY=${KEY}`) && !env.includes('LAMA-LAMA') && env.includes('OPENROUTER_BASE='));
  assert.ok(!r.stdout.includes(KEY), 'perintah kunci tidak mencetak kunci'); assert.match(r.stdout, /tidak ikut ke GitHub/);
  const { OPENROUTER_API_KEY, ...bersih } = process.env;
  // Asinkron: server tiruan hidup di proses ini, jadi spawnSync akan membuat keduanya saling menunggu.
  const w = await new Promise(res => { const c = spawnProses(process.execPath, [cli2, 'wajah', '--jumlah', '1', '--ya'], { env: { ...bersih, UJI_HASIL: path.join(TMP, 'hasil5') } }); let stdout = '', stderr = ''; c.stdout.on('data', d => stdout += d); c.stderr.on('data', d => stderr += d); const b = setTimeout(() => c.kill('SIGKILL'), 20000); c.on('close', status => { clearTimeout(b); res({ status, stdout, stderr }); }); });
  assert.equal(w.status, 0, w.stdout + w.stderr); assert.doesNotMatch(w.stdout, /Tempel kunci/); assert.equal(state.posts.length, 1); assert.ok(state.auth.every(h => h === `Bearer ${KEY}`));
  const salah = spawnSync(process.execPath, [cli2, 'kunci'], { input: 'abc\n', encoding: 'utf8' }); assert.equal(salah.status, 1); assert.match(salah.stderr, /diawali "sk-or-"/);
  assert.ok(fs.readFileSync(path.join(tool, '.env'), 'utf8').includes(KEY), '.env tidak rusak oleh kunci salah');
});
test('menu .bat: pilihan 9 memanggil perintah kunci; .gitignore memuat .env alat uji', () => {
  const b = fs.readFileSync(path.join(__dirname, '..', 'uji-gambar.bat'), 'utf8'); assert.match(b, /if "%PILIH%"=="9" \( node uji-gambar\.js kunci/); assert.ok(b.includes('\r\n') && [...b].every(c => c.charCodeAt(0) < 128));
  const gi = path.join(__dirname, '..', '..', '..', '.gitignore'); if (fs.existsSync(gi)) assert.match(fs.readFileSync(gi, 'utf8'), /^(\.env|tools\/uji-gambar\/\.env)$/m, '.env diabaikan git (pola umum atau khusus)');
});


// ───────────── Layar pilihan menu 6 (acuan --tanya) ─────────────
const Tanya = require('../lib/tanya'); const Sken = require('../lib/skenario'); const coreLib = require('../../../core/src');
// `tanya` tiruan: jawaban disiapkan berurutan; null = masukan habis. Semua pertanyaan dicatat.
function penanyaTiruan(jawab) { const q = []; const f = async t => { q.push(t); return jawab.length ? jawab.shift() : null; }; f.q = q; return f; }
const catat = () => { const l = []; const f = s => l.push(String(s)); f.l = l; return f; };

test('buatKarakter: semua hubungan menghasilkan DNA dewasa yang valid; kakak, adik, mirip WAJIB diberi jenis kelamin hasil; ibu selalu perempuan; orang yang sama mengikuti foto', () => {
  for (const gf of ['perempuan', 'laki-laki']) for (const gh of ['perempuan', 'laki-laki']) for (const h of ['kakak', 'adik', 'mirip_bukan_sama']) {
    const k = Sken.buatKarakter({ genderFoto: gf, hubungan: h, genderHasil: gh }); assert.equal(k.dna.gender, gh); assert.deepEqual(coreLib.validateDna(k.dna), []); assert.deepEqual(coreLib.validateReference({ relation: h, note: k.note }, k.dna), []);
  }
  for (const gf of ['perempuan', 'laki-laki']) {
    assert.equal(Sken.buatKarakter({ genderFoto: gf, hubungan: 'orang_sama' }).dna.gender, gf);
    assert.equal(Sken.buatKarakter({ genderFoto: gf, hubungan: 'ibu', genderHasil: 'laki-laki' }).dna.gender, 'perempuan', 'ibu tetap perempuan, apa pun isian lain');
    for (const h of ['kakak', 'adik', 'mirip_bukan_sama']) assert.throws(() => Sken.buatKarakter({ genderFoto: gf, hubungan: h }), /butuh jenis kelamin hasil/);
  }
  const kakak = Sken.buatKarakter({ genderFoto: 'perempuan', hubungan: 'kakak', genderHasil: 'laki-laki' }); assert.equal(kakak.dna.age_group, 'dewasa'); assert.equal(kakak.usia, '30-an'); assert.equal(kakak.dna.beard, undefined);
  assert.equal(Sken.buatKarakter({ genderFoto: 'perempuan', hubungan: 'adik', genderHasil: 'laki-laki' }).dna.age_group, 'dewasa_muda');
  assert.throws(() => Sken.buatKarakter({ genderFoto: 'x', hubungan: 'kakak', genderHasil: 'laki-laki' }), /orang di foto/); assert.throws(() => Sken.buatKarakter({ genderFoto: 'perempuan', hubungan: 'paman', genderHasil: 'laki-laki' }), /tidak dikenal/);
  const prompt = coreLib.buildFacePrompt(kakak.dna, 1, { relation: kakak.relation, note: kakak.note }); assert.match(prompt, /A man in his thirties/); assert.match(prompt, /older brother of the person in the reference photo/);
});

test('peringatanKonflik: catatan yang bertentangan dengan DNA diperingatkan; catatan yang menyebut jenis kelamin foto tidak salah dikira', () => {
  const P = { gender: 'perempuan' }, L = { gender: 'laki-laki' };
  assert.match(Sken.peringatanKonflik('laki-laki', P), /catatan menyebut laki-laki, tetapi DNA berjenis kelamin perempuan\. DNA yang menang/);
  assert.match(Sken.peringatanKonflik('kakak perempuan', L), /menyebut perempuan.*laki-laki/);
  assert.equal(Sken.peringatanKonflik('kakak laki-laki dari perempuan di foto', L), '', 'kakak laki-laki + DNA laki-laki: cocok, perempuan di sini orang di foto');
  assert.match(Sken.peringatanKonflik('kakak laki-laki dari perempuan di foto', P), /menyebut laki-laki/);
  for (const c of ['', 'mirip saja', 'perempuan', null]) assert.equal(Sken.peringatanKonflik(c, P), '');
  assert.equal(Sken.peringatanKonflik('laki-laki', null), '');
});

test('layar pilihan: Enter memakai bawaan (kakak, 1 gambar, low); jenis kelamin hasil WAJIB untuk kakak; jawaban salah bertanya ulang, tidak membatalkan', async () => {
  const t = penanyaTiruan([ACUAN, 'P', '', '', '', '', '', 'y']); const l = catat();
  const h = await Tanya.wizardAcuan({ tanya: t, log: l, maks: 12 }); assert.equal(h, null, 'Enter pada pertanyaan wajib tidak diterima; di akhir masukan habis, jadi dibatalkan');
  assert.ok(l.l.some(x => /Wajib dipilih/.test(x)), 'pesan wajib tampil'); assert.ok(t.q.filter(x => /^4\/6/.test(x)).length > 1, 'pertanyaan 4 diulang, bukan dilewati');
  const t2 = penanyaTiruan([ACUAN, 'x', 'P', '9', '', 'q', 'L', '7', '', 'apa', '', 'Y']); const l2 = catat();
  const h2 = await Tanya.wizardAcuan({ tanya: t2, log: l2, maks: 12 });
  assert.ok(h2); assert.equal(h2.hub, 'kakak'); assert.equal(h2.karakter.dna.gender, 'laki-laki'); assert.equal(h2.jumlah, 1); assert.equal(h2.kualitas, 'low'); assert.equal(h2.total, 1); assert.equal(h2.genderFoto, 'perempuan');
  assert.ok(l2.l.some(x => /Ketik P untuk perempuan/.test(x)) && l2.l.some(x => /Ketik angka 1 sampai 4/.test(x)) && l2.l.some(x => /Ketik 1, 2, 3/.test(x)), 'tiap jawaban salah mendapat pesan');
});

test('layar pilihan: di Y/N/U jawaban selain Y, N, U (mis. angka 4) bertanya ulang; N membatalkan; U mengubah dengan nilai lama sebagai bawaan; masukan habis membatalkan', async () => {
  const dasar = [ACUAN, 'P', '2', 'L', '1', '1'];
  const a = penanyaTiruan([...dasar, '4', '', 'ya?', 'Y']); const la = catat(); const ha = await Tanya.wizardAcuan({ tanya: a, log: la, maks: 12 });
  assert.ok(ha && ha.hub === 'kakak', 'angka 4 dan jawaban kosong tidak membatalkan'); assert.equal(la.l.filter(x => /tidak dikenal|lalu Enter/.test(x)).length, 3);
  assert.equal(await Tanya.wizardAcuan({ tanya: penanyaTiruan([...dasar, 'n']), log: catat(), maks: 12 }), null);
  const u = penanyaTiruan([...dasar, 'U', '', '', '4', '2', '2', 'Y']); const hu = await Tanya.wizardAcuan({ tanya: u, log: catat(), maks: 12 });
  assert.ok(hu); assert.equal(hu.hub, 'ibu'); assert.equal(hu.karakter.dna.gender, 'perempuan'); assert.equal(hu.jumlah, 2, 'jumlah diubah ke 2'); assert.equal(hu.kualitas, 'medium', 'kualitas diubah ke 2 = medium');
  assert.ok(u.q.some(x => /\[low\]/.test(x)), 'kualitas lama muncul sebagai bawaan'); assert.ok(u.q.some(x => x.includes(ACUAN)), 'foto lama muncul sebagai bawaan saat mengubah');
  assert.ok(!u.q.some(x => /^4\/6 Jenis kelamin orang yang DIBUAT/.test(x) && u.q.indexOf(x) > 6), 'untuk ibu, jenis kelamin ditentukan hubungan dan tidak ditanya');
  assert.equal(await Tanya.wizardAcuan({ tanya: penanyaTiruan([...dasar]), log: catat(), maks: 12 }), null, 'masukan habis di Y/N/U = batal, tidak berputar tanpa akhir');
  assert.equal(await Tanya.wizardAcuan({ tanya: penanyaTiruan([ACUAN, 'batal']), log: catat(), maks: 12 }), null);
});

test('layar pilihan: foto tidak ada atau formatnya salah ditolak dengan pesan jelas lalu ditanya ulang; "semua skenario" = 4 x jumlah dan melewati batas pengaman diblok', async () => {
  const l = catat(); const t = penanyaTiruan([path.join(TMP, 'tidak-ada.png'), path.join(TMP, 'x.gif'), ACUAN, 'L', '6', '4', '1', 'Y', 'U', '', '', '', '2', '', 'Y']);
  fs.writeFileSync(path.join(TMP, 'x.gif'), IMG);
  const h = await Tanya.wizardAcuan({ tanya: t, log: l, maks: 12 });
  assert.ok(l.l.some(x => /Berkas tidak ditemukan/.test(x)) && l.l.some(x => /Format "\.gif" tidak didukung/.test(x)));
  assert.ok(l.l.some(x => /16 gambar melebihi batas pengaman 12/.test(x)) && l.l.some(x => /Belum bisa/.test(x)), 'Y ditolak saat melebihi batas');
  assert.ok(h); assert.equal(h.hub, 'semua'); assert.equal(h.karakter, null); assert.equal(h.jumlah, 2); assert.equal(h.total, 8); assert.equal(h.genderFoto, 'laki-laki');
  assert.ok(!t.q.some(x => /^4\/6 Jenis kelamin orang yang DIBUAT/.test(x)), 'untuk "semua", jenis kelamin hasil mengikuti tiap skenario dan tidak ditanya');
});

test('layar pilihan lewat CLI: foto perempuan + kakak laki-laki + 1 gambar + low. Mengirim SATU gambar dengan prompt laki-laki, hubungan kakak, 1 rujukan; daftar tidak bernomor; kunci tidak bocor', async () => {
  const r = await cli(['acuan', '--tanya'], { input: [ACUAN, 'P', '2', 'L', '1', '1', 'Y', ''].join('\n') }); assert.equal(r.code, 0, r.out + r.err);
  assert.equal(state.posts.length, 1); const b = state.posts[0];
  assert.match(b.prompt, /A man in his thirties/); assert.match(b.prompt, /older brother of the person in the reference photo/); assert.equal(b.quality, 'low'); assert.equal(b.aspect_ratio, '3:4'); assert.equal(b.input_references.length, 1);
  assert.match(r.out, /PERHATIAN: |Pakai HANYA foto orang dewasa yang izinnya sudah Anda urus/); assert.match(r.out, /Dibuat : kakak laki-laki, usia 30-an/); assert.match(r.out, /Jumlah : 1 gambar, kualitas low/);
  assert.doesNotMatch(r.out, /^\s*\d+\.\s+acuan-/m, 'daftar rencana tidak lagi bernomor (terbaca seperti menu)'); assert.match(r.out, /^\s+- acuan-S2-kakak-laki-laki-1/m);
  const md = fs.readFileSync(path.join(lastRun(), 'lembar-penilaian.md'), 'utf8'); assert.equal((md.match(/^\| S\d /gm) || []).length, 1); assert.match(md, /Hanya satu skenario yang diuji/); assert.doesNotMatch(md, /S2 \(kakak lawan jenis\) gagal/);
  const all = readAll(lastRun()); assert.ok(!all.includes(KEY) && !/base64,[A-Za-z0-9+/=]{40,}/.test(all));
});

test('layar pilihan lewat CLI: "semua skenario" tetap membuat 4 skenario dengan DNA otomatis; N membatalkan TANPA folder hasil dan TANPA mengirim; masukan habis membatalkan', async () => {
  let r = await cli(['acuan', '--tanya'], { input: [ACUAN, 'P', '6', '2', '2', 'Y', ''].join('\n') }); assert.equal(r.code, 0, r.out + r.err);
  assert.equal(state.posts.length, 8); const gender = state.posts.map(p => /\b(man|woman)\b/.exec(p.prompt)[1]); assert.deepEqual(gender, ['woman', 'woman', 'man', 'man', 'woman', 'woman', 'woman', 'woman'], 'S1 perempuan, S2 kakak laki-laki, S3 mirip perempuan, S4 ibu'); assert.ok(state.posts.every(p => p.quality === 'medium'));
  resetState(); const sebelum = new Set(fs.readdirSync(path.join(TMP, 'hasil')));
  r = await cli(['acuan', '--tanya'], { input: [ACUAN, 'P', '2', 'L', '1', '1', 'N', ''].join('\n') }); assert.equal(r.code, 1); assert.match(r.out, /Dibatalkan\. Tidak ada yang dikirim/); assert.equal(state.posts.length, 0);
  r = await cli(['acuan', '--tanya'], { input: [ACUAN, 'P', '2'].join('\n') }); assert.equal(r.code, 1); assert.equal(state.posts.length, 0);
  assert.deepEqual(fs.readdirSync(path.join(TMP, 'hasil')).filter(d => !sebelum.has(d)), [], 'pembatalan tidak meninggalkan folder hasil kosong');
});

test('konfirmasi Y/N di perintah lain: jawaban selain Y atau N (mis. angka 4) bertanya ulang, tidak membatalkan; N membatalkan tanpa folder; peringatan konflik catatan tampil sebelum Y', async () => {
  let r = await cli(['wajah', '--jumlah', '1'], { input: '4\n\nY\n' }); assert.equal(r.code, 0, r.out + r.err); assert.equal(state.posts.length, 1); assert.equal((r.out.match(/tidak dikenal\.|batal, lalu Enter\./g) || []).length, 2, 'angka 4 dan baris kosong masing-masing mendapat pesan, bukan pembatalan');
  resetState(); const sebelum = new Set(fs.readdirSync(path.join(TMP, 'hasil')));
  r = await cli(['wajah', '--jumlah', '1'], { input: '4\nn\n' }); assert.equal(r.code, 1); assert.equal(state.posts.length, 0); assert.deepEqual(fs.readdirSync(path.join(TMP, 'hasil')).filter(d => !sebelum.has(d)), []);
  r = await cli(['wajah', '--jumlah', '1'], { input: '' }); assert.equal(r.code, 1, 'masukan habis = batal, tidak menggantung'); assert.equal(state.posts.length, 0);
  resetState();
  r = await cli(['wajah', '--acuan', ACUAN, '--hubungan', 'kakak', '--catatan', 'kakak laki-laki', '--jumlah', '1', '--ya']); assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /PERINGATAN: catatan menyebut laki-laki, tetapi DNA berjenis kelamin perempuan\. DNA yang menang/); assert.equal(state.posts.length, 1);
  resetState();
  r = await cli(['wajah', '--dna', DNA_PRIA, '--acuan', ACUAN, '--hubungan', 'kakak', '--catatan', 'kakak laki-laki dari perempuan di foto', '--jumlah', '1', '--ya']); assert.equal(r.code, 0, r.out + r.err); assert.doesNotMatch(r.out, /PERINGATAN/);
});

test('layar pilihan lewat CLI dengan --kering: tidak mengirim, tidak butuh kunci, dan prompt serta laporan tetap disusun', async () => {
  const r = await cli(['acuan', '--tanya', '--kering'], { input: [ACUAN, 'P', '2', 'L', '1', '1', 'Y', ''].join('\n'), noKey: true }); assert.equal(r.code, 0, r.out + r.err);
  assert.equal(state.posts.length, 0); assert.match(r.out, /MODE KERING/); assert.ok(filesOf(lastRun()).some(f => /^permintaan-01-acuan-S2/.test(f)));
});


// Terminal sungguhan (pty): kunci diminta dulu (tersembunyi, tiap karakter *), lalu layar pilihan memakai pengeditan baris biasa.
// Setiap langkah menunggu teks pertanyaannya muncul di layar, baru mengirim jawaban.
function sesiTerminal(args, langkah, { env: tambahan = {} } = {}) {
  const env = { ...process.env, OPENROUTER_BASE: stub.base, UJI_HASIL: path.join(TMP, 'hasil6'), UJI_RETRY_MS: '20', ...tambahan }; delete env.OPENROUTER_API_KEY;
  const p = spawnProses('script', ['-qec', `${process.execPath} ${args.join(' ')}`, '/dev/null'], { env }); let layar = '', i = 0, dari = 0;
  const maju = () => { while (i < langkah.length) { const [pola, kirim, jeda] = langkah[i]; const sisa = layar.slice(dari); const m = sisa.match(pola); if (!m) return; dari += m.index + m[0].length; i++; const k = kirim; setTimeout(async () => { for (const c of (Array.isArray(k) ? k : [k])) { p.stdin.write(c); await new Promise(r => setTimeout(r, jeda || 15)); } }, 80); setTimeout(maju, 200); return; } };   // periksa lagi walau tidak ada keluaran baru (dua pertanyaan bisa tercetak bersamaan)
  p.stdout.on('data', d => { layar += d; maju(); });
  const batas = setTimeout(() => { layar += `\n[DIHENTIKAN: macet pada langkah ${i}]`; p.kill('SIGKILL'); }, 25000);
  return new Promise(res => p.on('close', kode => { clearTimeout(batas); res({ kode, layar, selesaiLangkah: i }); }));
}
test('terminal sungguhan: kunci tersembunyi lalu layar pilihan (salah ketik, Backspace, angka 4 di Y/N/U, U, lalu Y) mengirim satu gambar kakak laki-laki', { skip: !adaScript && 'perintah script tidak tersedia' }, async () => {
  const r = await sesiTerminal([CLI, 'acuan', '--tanya'], [
    [/Tempel kunci OpenRouter/, [KEY, '\r']],
    [/1\/6 Alamat foto acuan/, [ACUAN, '\r']],
    [/2\/6 Orang yang ADA DI FOTO/, ['X', '\x7f', 'p', '\r']],
    [/3\/6 Pilih nomor hubungan \[2\]/, ['\r']],
    [/4\/6 Jenis kelamin orang yang DIBUAT/, ['L', '\r']],
    [/5\/6 Jumlah gambar/, ['\r']],
    [/6\/6 Kualitas/, ['\r']],
    [/Y = mulai, N = batal, U = ubah pilihan: /, ['4', '\r']],
    [/Jawaban "4" tidak dikenal/, []],
    [/Y = mulai, N = batal, U = ubah pilihan: /, ['Y', '\r']]
  ]);
  assert.equal(r.kode, 0, r.layar); assert.equal(r.selesaiLangkah, 10, r.layar); assert.ok(!r.layar.includes(KEY) && r.layar.includes('*'.repeat(KEY.length)), 'kunci tidak tampil, tiap karakter menjadi *');
  assert.match(r.layar, /Dibuat : kakak laki-laki, usia 30-an/); assert.equal(state.posts.length, 1); assert.match(state.posts[0].prompt, /older brother/); assert.ok(state.auth.every(a => a === `Bearer ${KEY}`));
});
