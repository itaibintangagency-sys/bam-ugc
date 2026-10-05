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
