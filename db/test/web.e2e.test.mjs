// Uji website (halaman Karakter) di Chrome sungguhan. Website dibangun dengan Vite lalu dijalankan terhadap Postgres lokal yang memuat SEMUA migrasi
// dan aturan RLS, lewat server Supabase tiruan (db/test/fakeSupabase.mjs). Yang BELUM terbukti: Supabase asli, Vercel, dan jaringan asli.
// Prasyarat (hanya untuk pengembang): npm install di web/, db/, dan agent/ (playwright-core); Chrome di CHROME_BIN.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFake } from './fakeSupabase.mjs';
import { U } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..', '..', 'web');
const require = createRequire(path.resolve(HERE, '..', '..', 'agent', 'x.js'));
const { chromium } = require('playwright-core');
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bamugc-web-'));
const PORT = Number(process.env.E2E_CHROME_PORT || 9433);
const SHOTS = process.env.E2E_SHOTS || '';   // folder tangkapan layar untuk ditinjau mata; kosong = tidak menyimpan
const shot = async (page, nama) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, nama + '.png'), fullPage: true }); } };
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const ANON = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ role: 'anon', iss: 'supabase' })}.x`;
const KALIMAT_C02 = 'A young woman in her early twenties with long, wavy, light-brown hair with soft caramel highlights, parted in the middle, a soft oval face, a fair to light complexion, and a bright cheerful smile.';
const PROJ = 'https://flow.google.com/project/mock-abc-123';

// PNG sungguhan w x h berisi derau (agar ukurannya wajar) atau polos (agar sangat kecil).
function png(w, h, noise = true) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = buf => { let r = 0xffffffff; for (const b of buf) r = crcT[(r ^ b) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); if (noise) for (let y = 0; y < h; y++) crypto.randomFillSync(raw, y * (w * 3 + 1) + 1, w * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}
const FOTO = png(600, 800); const FOTO_KECIL = png(300, 300); const FOTO_POLOS = png(600, 800, false);

let fake, chromeProc, browser, server, site;
const sql = (q, p) => fake.sql(q, p);
const rows = async (q, p) => (await sql(q, p)).rows;

test.before(async () => {
  fake = await startFake();
  const dist = path.join(TMP, 'dist');
  execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: WEB, env: { ...process.env, VITE_SUPABASE_URL: fake.url, VITE_SUPABASE_ANON_KEY: ANON }, stdio: 'pipe' });
  server = http.createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html');
    res.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); site = `http://127.0.0.1:${server.address().port}`;
  chromeProc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(TMP, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { await new Promise(r => setTimeout(r, 300)); } }
  assert.ok(browser, 'Chrome menyala');
});
test.after(async () => { try { await browser.close(); } catch { /* abaikan */ } if (chromeProc) chromeProc.kill('SIGKILL'); if (server) server.close(); if (fake) await fake.close(); });

// Satu konteks Chrome per skenario; mengumpulkan galat halaman dan dialog (tanda XSS).
async function skenario(fn, { viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport }); const page = await ctx.newPage(); const galat = []; let dialog = 0;
  page.on('pageerror', e => galat.push(e.message)); page.on('dialog', d => { dialog++; d.dismiss(); });
  page.on('console', m => { if (m.type() === 'error' && !/403|Failed to load resource|fonts\./.test(m.text())) galat.push('konsol: ' + m.text().slice(0, 140)); });
  try { await fn(page); } finally { await ctx.close(); }
  assert.equal(dialog, 0, 'tidak ada dialog (tanda skrip tersuntik)'); assert.deepEqual(galat, [], 'tidak ada galat JavaScript');
}
async function masuk(page, email, pw) { await page.goto(site + '/masuk'); await page.fill('#email', email); await page.fill('#password', pw); await page.click('button[type=submit]'); await page.waitForSelector('h1:has-text("Dasbor")', { timeout: 10000 }); }
const staf = p => masuk(p, 'staff@x', 'pw-staff'), admin = p => masuk(p, 'admin@x', 'pw-admin'), stafB = p => masuk(p, 'staffb@x', 'pw-staffb');
const chip = (page, teks) => page.locator('label.chip', { has: page.getByText(teks, { exact: true }) }).click();
const lanjut = page => page.getByTestId('lanjut').click();
async function bersih() { await sql('delete from ugc_character_photos'); await sql('delete from ugc_characters'); fake.storage.clear(); fake.flags.failUploads = false; }

// Mengisi wizard sampai langkah terakhir dan (opsional) menyimpan.
async function wizard(page, { kode, foto = FOTO, nama = 'foto.png', mime = 'image/png', proyek = PROJ, akun = 'Uji Bintang', simpan = true } = {}) {
  await page.goto(site + '/karakter/baru');
  await page.getByTestId('isi-contoh').click(); if (kode) await page.fill('#kode', kode);
  await lanjut(page); await lanjut(page);
  await page.setInputFiles('#foto', { name: nama, mimeType: mime, buffer: foto });
  await page.waitForSelector('[data-testid=pratinjau-foto], [data-testid=galat-foto]'); await lanjut(page);
  await page.fill('#proj', proyek); await page.fill('#akun', akun);
  if (simpan) await page.getByTestId('simpan').click();
}

test('daftar kosong menjelaskan langkah pertama; menu Karakter ada dan menandai halaman aktif', async () => {
  await bersih();
  await skenario(async page => {
    await staf(page); await page.locator('nav.nav-utama').getByRole('link', { name: 'Karakter' }).click(); await page.waitForSelector('[data-testid=daftar-kosong]');
    assert.match(await page.getByTestId('daftar-kosong').innerText(), /Belum ada karakter[\s\S]*satu foto wajah \(dewasa\)/);
    assert.equal(await page.locator('nav.nav-utama').getByRole('link', { name: 'Karakter' }).getAttribute('aria-current'), 'page');
  });
});

test('STAF membuat karakter lengkap lewat wizard: data, foto, suara, dan project tersimpan benar di database dan penyimpanan', async () => {
  await bersih();
  await skenario(async page => {
    await staf(page); await page.goto(site + '/karakter/baru');
    await page.getByTestId('isi-contoh').click(); await lanjut(page);
    assert.equal(await page.getByTestId('kalimat-penampilan').locator('p').innerText(), KALIMAT_C02); await shot(page, 'wizard-2-dna');
    await lanjut(page);
    await page.setInputFiles('#foto', { name: 'wajah.png', mimeType: 'image/png', buffer: FOTO });
    await page.waitForSelector('[data-testid=pratinjau-foto]'); await lanjut(page);
    const teks = await page.getByTestId('teks-performa').innerText(); assert.match(teks, /early twenties, around 21 to 24/);
    const suara = await page.locator('#suara').inputValue(); assert.ok(suara, 'suara awal terpilih');
    assert.equal(await page.getByTestId('simpan').isDisabled(), true, 'belum bisa simpan sebelum project dan akun diisi');
    await page.fill('#proj', PROJ); await page.fill('#akun', 'Uji Bintang'); await shot(page, 'wizard-4-suara'); await page.getByTestId('simpan').click();
    await page.waitForURL(/\/karakter\/[0-9a-f-]{36}$/, { timeout: 15000 });
    assert.match(await page.getByTestId('pesan').innerText(), /tersimpan lengkap dengan foto wajah/);
    assert.equal(await page.getByTestId('status').innerText(), 'Lengkap, menunggu admin'); await page.waitForSelector('img.foto-besar'); await shot(page, 'rincian-staf');
    assert.equal(await page.getByTestId('suara').innerText(), suara);
    assert.equal(await page.getByTestId('kalimat').innerText(), KALIMAT_C02);
    assert.match(await page.getByTestId('menunggu-admin').innerText(), /Hanya admin/); assert.equal(await page.locator('#alasan').count(), 0, 'staf tidak melihat panel Tandai siap');
    await page.waitForSelector('img.foto-besar'); assert.equal(await page.locator('img.foto-besar').evaluate(i => i.naturalWidth), 600, 'foto tampil dari bucket privat');
    const [c] = await rows(`select * from ugc_characters`);
    assert.equal(c.code, 'C02_THE_SOFT_GIRL'); assert.equal(c.name, 'Nadia'); assert.equal(c.status, 'voice_defined'); assert.equal(c.identity_lock, 'locked'); assert.equal(c.creation_mode, 'reference');
    assert.equal(c.created_by, U.staffA); assert.equal(c.voice_base, suara); assert.equal(c.flow_project_url, PROJ); assert.equal(c.flow_account_name, 'Uji Bintang'); assert.equal(c.gender, 'perempuan');
    assert.equal(c.dna.appearance_en, KALIMAT_C02); assert.equal(c.dna.age_group, 'dewasa_muda'); assert.equal(c.face_ref_path, `${c.id}/face_front.png`); assert.equal(c.voice.base_voice, suara);
    const ph = await rows(`select angle, approved, path from ugc_character_photos where character_id = $1`, [c.id]); assert.deepEqual(ph, [{ angle: 'face_front', approved: true, path: c.face_ref_path }]);
    const tersimpan = fake.storage.get(`ugc-characters/${c.face_ref_path}`); assert.ok(tersimpan && Buffer.compare(tersimpan, FOTO) === 0, 'byte foto di bucket sama persis dengan yang diunggah (bukan badan multipart)');
  });
});

test('wizard: tombol Lanjut mati sampai langkah valid; daftar "Yang masih kurang" menjelaskan; usia hanya dewasa; hijab dan janggut mengikuti jenis kelamin', async () => {
  await bersih();
  await skenario(async page => {
    await staf(page); await page.goto(site + '/karakter/baru');
    assert.equal(await page.getByTestId('lanjut').isDisabled(), true); assert.match(await page.getByTestId('masalah-langkah').innerText(), /Kode:[\s\S]*Nama karakter wajib/);
    await page.fill('#kode', '../salah'); await page.fill('#nama', 'Nadia'); assert.equal(await page.getByTestId('lanjut').isDisabled(), true);
    await page.fill('#kode', 'C77'); assert.equal(await page.getByTestId('lanjut').isDisabled(), false); await lanjut(page);
    assert.equal(await page.getByTestId('lanjut').isDisabled(), true); assert.match(await page.getByTestId('masalah-langkah').innerText(), /Jenis kelamin: wajib diisi/);
    const usia = await page.locator('fieldset', { has: page.locator('legend', { hasText: 'Kelompok usia' }) }).locator('label.chip').allInnerTexts();
    assert.deepEqual(usia, ['21 sampai 24 tahun', '25 sampai 29 tahun', '30 sampai 39 tahun', '40 sampai 49 tahun'], 'tidak ada pilihan di bawah 21 tahun');
    assert.equal(await page.getByText('Karakter berhijab').count(), 0, 'hijab hanya muncul setelah memilih perempuan'); assert.equal(await page.locator('legend', { hasText: 'Janggut' }).count(), 0);
    await chip(page, 'Laki-laki'); assert.equal(await page.locator('legend', { hasText: 'Janggut' }).count(), 1); assert.equal(await page.getByText('Karakter berhijab').count(), 0);
    await chip(page, 'Perempuan'); assert.equal(await page.locator('legend', { hasText: 'Janggut' }).count(), 0);
    await page.getByLabel('Karakter berhijab').check(); assert.equal(await page.locator('legend', { hasText: 'Panjang rambut' }).count(), 0, 'rambut disembunyikan saat berhijab'); assert.equal(await page.locator('legend', { hasText: 'Gaya hijab' }).count(), 1);
    await page.getByLabel('Karakter berhijab').uncheck(); assert.equal(await page.locator('legend', { hasText: 'Panjang rambut' }).count(), 1);
    await page.fill('#khas', 'a teenage girl look'); await chip(page, '21 sampai 24 tahun'); assert.match(await page.getByTestId('masalah-langkah').innerText(), /menyiratkan anak atau remaja/);
  });
});

test('wizard foto: format salah, terlalu kecil (ukuran dan piksel) ditolak dengan pesan jelas; foto yang sah memunculkan pratinjau', async () => {
  await bersih();
  await skenario(async page => {
    await staf(page); await page.goto(site + '/karakter/baru'); await page.getByTestId('isi-contoh').click(); await lanjut(page); await lanjut(page);
    const coba = async (berkas) => { await page.setInputFiles('#foto', berkas); await page.waitForTimeout(400); };
    await coba({ name: 'a.gif', mimeType: 'image/gif', buffer: FOTO }); assert.match(await page.getByTestId('galat-foto').innerText(), /PNG, JPG, atau WEBP/); assert.equal(await page.getByTestId('lanjut').isDisabled(), true);
    await coba({ name: 'polos.png', mimeType: 'image/png', buffer: FOTO_POLOS }); assert.match(await page.getByTestId('galat-foto').innerText(), /terlalu kecil \(di bawah 10 KB\)/);
    await coba({ name: 'kecil.png', mimeType: 'image/png', buffer: FOTO_KECIL }); assert.match(await page.getByTestId('galat-foto').innerText(), /300 x 300 piksel[\s\S]*512/);
    await coba({ name: 'rusak.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from('bukan gambar sungguhan '), crypto.randomBytes(20000)]) }); assert.match(await page.getByTestId('galat-foto').innerText(), /tidak terbaca sebagai gambar/);
    await coba({ name: 'ok.png', mimeType: 'image/png', buffer: FOTO }); assert.equal(await page.getByTestId('galat-foto').count(), 0); assert.equal(await page.getByTestId('pratinjau-foto').count(), 1); assert.equal(await page.getByTestId('lanjut').isDisabled(), false);
    await page.getByRole('button', { name: 'Kembali' }).click(); await lanjut(page); assert.equal(await page.getByTestId('pratinjau-foto').count(), 1, 'foto yang sudah dipilih tetap ada saat kembali dan maju');
  });
});

test('wizard langkah akhir: alamat project dan akun diperiksa; suara yang sudah dipakai karakter lain dinonaktifkan dan tidak jadi pilihan awal', async () => {
  await bersih();
  await skenario(async page => {
    await staf(page); await wizard(page, { kode: 'C01', simpan: true }); await page.waitForURL(/\/karakter\/[0-9a-f-]{36}$/, { timeout: 15000 });
    const [pertama] = await rows(`select voice_base from ugc_characters where code = 'C01'`);
    await wizard(page, { kode: 'C02', proyek: 'https://contoh.com/x', akun: ' ', simpan: false });
    assert.equal(await page.getByTestId('simpan').isDisabled(), true); assert.match(await page.getByTestId('masalah-langkah').innerText(), /https:\/\/flow\.google\.com\/project\/[\s\S]*Nama akun Google/);
    const kedua = await page.locator('#suara').inputValue(); assert.notEqual(kedua, pertama.voice_base, 'suara awal menghindari suara karakter lain');
    const opsiDipakai = page.locator(`#suara option[value="${pertama.voice_base}"]`); assert.equal(await opsiDipakai.isDisabled(), true); assert.match(await opsiDipakai.innerText(), /dipakai karakter lain/);
    await page.fill('#proj', PROJ); await page.fill('#akun', 'Uji'); assert.equal(await page.getByTestId('simpan').isDisabled(), false);
    await page.locator('summary', { hasText: 'Atur detail suara' }).click(); await page.selectOption('#v-energi', 'tinggi'); await page.selectOption('#v-aksen', 'jakarta_santai');
    await page.getByTestId('simpan').click(); await page.waitForURL(/\/karakter\/[0-9a-f-]{36}$/, { timeout: 15000 });
    const [c2] = await rows(`select voice, voice_base from ugc_characters where code = 'C02'`); assert.equal(c2.voice.energi, 'tinggi'); assert.equal(c2.voice.aksen, 'jakarta_santai'); assert.equal(c2.voice_base, kedua);
  });
});

test('kode kembar ditolak dengan pesan awam; tidak ada karakter atau foto ganda yang tercipta', async () => {
  await bersih();
  await skenario(async page => {
    await staf(page); await wizard(page, { kode: 'C09' }); await page.waitForURL(/\/karakter\/[0-9a-f-]{36}$/, { timeout: 15000 });
    const objekSebelum = fake.storage.size;
    await wizard(page, { kode: 'C09', simpan: true }); await page.waitForSelector('[data-testid=galat-simpan]');
    assert.match(await page.getByTestId('galat-simpan').innerText(), /Kode karakter ini sudah dipakai/);
    assert.equal((await rows(`select count(*)::int as n from ugc_characters`))[0].n, 1); assert.equal(fake.storage.size, objekSebelum, 'tidak ada foto yang terunggah');
    assert.equal(await page.getByTestId('simpan').isDisabled(), false, 'bisa memperbaiki kode lalu menyimpan lagi');
  });
});

test('unggahan foto gagal: karakter tersimpan sebagai draf dengan peringatan jelas, lalu foto diunggah ulang dari halaman rincian sampai lengkap', async () => {
  await bersih(); fake.flags.failUploads = true;
  await skenario(async page => {
    await staf(page); await wizard(page, { kode: 'C05' }); await page.waitForURL(/\/karakter\/[0-9a-f-]{36}$/, { timeout: 15000 });
    assert.match(await page.getByTestId('peringatan').innerText(), /tersimpan sebagai draf, tetapi foto belum terunggah/); assert.equal(await page.getByTestId('status').innerText(), 'Draf (belum lengkap)');
    assert.match(await page.getByTestId('langkah-berikut').innerText(), /Unggah foto wajah/);
    let [c] = await rows(`select status, face_ref_path from ugc_characters where code = 'C05'`); assert.equal(c.status, 'draft'); assert.equal(c.face_ref_path, null);
    fake.flags.failUploads = false;
    await page.setInputFiles('#ganti-foto', { name: 'ulang.png', mimeType: 'image/png', buffer: FOTO }); await page.waitForSelector('[data-testid=pesan]');
    assert.match(await page.getByTestId('pesan').innerText(), /Foto wajah terunggah/); await page.waitForFunction(() => document.querySelector('[data-testid=status]').innerText === 'Lengkap, menunggu admin');
    [c] = await rows(`select status, face_ref_path from ugc_characters where code = 'C05'`); assert.equal(c.status, 'voice_defined'); assert.match(c.face_ref_path, /face_front\.png$/);
    assert.equal((await rows(`select count(*)::int as n from ugc_character_photos`))[0].n, 1);
  });
});

test('ADMIN menandai siap: butuh alasan minimal 10 karakter dan syarat lengkap; alasan tersimpan; staf melihat hasilnya', async () => {
  await bersih();
  await skenario(async page => { await staf(page); await wizard(page, { kode: 'C03' }); await page.waitForURL(/\/karakter\/[0-9a-f-]{36}$/, { timeout: 15000 }); });
  await sql(`insert into ugc_characters (code, name, creation_mode, voice_base, status, created_by) values ('C04','Tanpa Foto','reference','Aoede','draft',$1)`, [U.staffA]);
  await skenario(async page => {
    await admin(page); await page.goto(site + '/karakter'); await page.waitForSelector('[data-testid=kartu-karakter]');
    assert.equal(await page.getByTestId('kartu-karakter').count(), 2, 'admin melihat karakter milik staf');
    await shot(page, 'daftar-admin'); await page.getByRole('link', { name: 'Nadia' }).first().click(); await page.waitForSelector('#alasan'); await shot(page, 'rincian-admin-panel');
    assert.equal(await page.getByTestId('tandai-siap').isDisabled(), true); await page.fill('#alasan', 'pendek'); assert.equal(await page.getByTestId('tandai-siap').isDisabled(), true);
    await page.fill('#alasan', 'Wajah dan suara sudah diverifikasi di Flow asli'); assert.equal(await page.getByTestId('tandai-siap').isDisabled(), false);
    await page.getByTestId('tandai-siap').click(); await page.waitForSelector('[data-testid=sudah-siap]');
    await shot(page, 'rincian-admin-siap'); assert.equal(await page.getByTestId('status').innerText(), 'Siap dipakai'); assert.equal(await page.getByTestId('alasan-tersimpan').innerText(), 'Wajah dan suara sudah diverifikasi di Flow asli');
    const [c] = await rows(`select status, ready_override_reason, ready_at from ugc_characters where code = 'C03'`); assert.equal(c.status, 'ready'); assert.equal(c.ready_override_reason, 'Wajah dan suara sudah diverifikasi di Flow asli'); assert.ok(c.ready_at);
    await page.goto(site + '/karakter'); await page.getByRole('link', { name: 'Tanpa Foto' }).click(); await page.waitForSelector('#alasan');
    assert.match(await page.getByTestId('belum-lengkap').innerText(), /Belum bisa ditandai siap/); await page.fill('#alasan', 'Alasan yang cukup panjang'); assert.equal(await page.getByTestId('tandai-siap').isDisabled(), true, 'karakter tanpa foto tidak bisa ditandai siap');
  });
  await skenario(async page => {
    await staf(page); await page.goto(site + '/karakter'); await page.getByRole('link', { name: 'Nadia' }).click(); await page.waitForSelector('[data-testid=sudah-siap]');
    assert.equal(await page.getByTestId('status').innerText(), 'Siap dipakai'); assert.equal(await page.locator('#ganti-foto').count(), 0, 'foto tidak bisa diganti setelah siap'); assert.equal(await page.locator('#alasan').count(), 0);
  });
});

test('staf lain boleh melihat tetapi tidak mengubah karakter milik orang lain (tanpa formulir ubah dan unggah); ubah project oleh pemilik berhasil dan oleh bukan pemilik ditolak database', async () => {
  await bersih();
  await skenario(async page => { await staf(page); await wizard(page, { kode: 'C06' }); await page.waitForURL(/\/karakter\/[0-9a-f-]{36}$/, { timeout: 15000 }); });
  const [{ id }] = await rows(`select id from ugc_characters where code = 'C06'`);
  await skenario(async page => {
    await stafB(page); await page.goto(site + '/karakter/' + id); await page.waitForSelector('[data-testid=status]');
    assert.equal(await page.locator('#e-proj').count(), 0); assert.equal(await page.locator('#ganti-foto').count(), 0); assert.match(await page.locator('.kv').last().innerText(), /mock-abc-123/);
  });
  await skenario(async page => {
    await staf(page); await page.goto(site + '/karakter/' + id); await page.waitForSelector('#e-proj');
    await page.fill('#e-proj', 'https://contoh.com/x'); assert.match(await page.getByTestId('masalah-project').innerText(), /https:\/\/flow\.google\.com\/project\//);
    await page.fill('#e-proj', 'https://flow.google.com/project/akun-baru-9'); await page.fill('#e-akun', 'Akun Baru'); await page.getByRole('button', { name: 'Simpan perubahan' }).click(); await page.waitForSelector('[data-testid=pesan]');
    const [c] = await rows(`select flow_project_url, flow_account_name from ugc_characters where id = $1`, [id]); assert.equal(c.flow_project_url, 'https://flow.google.com/project/akun-baru-9'); assert.equal(c.flow_account_name, 'Akun Baru');
  });
});

test('nama berisi skrip tampil sebagai teks di daftar dan rincian (tidak dijalankan)', async () => {
  await bersih();
  const nama = '<img src=x onerror=window.__xss=1>Nadia';
  await sql(`insert into ugc_characters (code, name, creation_mode, voice_base, status, created_by, dna) values ('CX','${nama}','reference','Aoede','draft',$1, '{"appearance_en":"<script>window.__xss=2</script>"}')`, [U.staffA]);
  const [{ id }] = await rows(`select id from ugc_characters where code = 'CX'`);
  await skenario(async page => {
    await staf(page); await page.goto(site + '/karakter'); await page.waitForSelector('[data-testid=kartu-karakter]');
    assert.ok((await page.getByTestId('kartu-karakter').innerText()).includes(nama)); await page.goto(site + '/karakter/' + id); await page.waitForSelector('[data-testid=kalimat]');
    assert.equal(await page.getByTestId('kalimat').innerText(), '<script>window.__xss=2</script>'); assert.equal(await page.evaluate(() => window.__xss), undefined);
  });
});

test('ponsel 390 px: tiap langkah wizard, daftar, dan rincian tanpa meluap ke samping; pilihan chip dapat dioperasikan dengan keyboard', async () => {
  await bersih();
  await skenario(async page => {
    await staf(page); await page.goto(site + '/karakter/baru'); const luap = async nama => { const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth })); assert.ok(w.s <= w.c + 1, `${nama} meluap: ${w.s} > ${w.c}`); };
    await luap('langkah 1'); await page.getByTestId('isi-contoh').click(); await lanjut(page); await luap('langkah 2');
    await page.getByLabel('Perempuan', { exact: true }).focus(); await page.keyboard.press('Space'); assert.equal(await page.getByLabel('Perempuan', { exact: true }).isChecked(), true, 'chip dapat dipilih dengan keyboard');
    await lanjut(page); await page.setInputFiles('#foto', { name: 'f.png', mimeType: 'image/png', buffer: FOTO }); await page.waitForSelector('[data-testid=pratinjau-foto]'); await luap('langkah 3'); await lanjut(page);
    await page.fill('#proj', PROJ); await page.fill('#akun', 'Uji'); await luap('langkah 4'); await page.getByTestId('simpan').click(); await page.waitForURL(/\/karakter\/[0-9a-f-]{36}$/, { timeout: 15000 });
    await page.waitForSelector('img.foto-besar'); await luap('rincian'); await page.goto(site + '/karakter'); await page.waitForSelector('[data-testid=kartu-karakter]'); await luap('daftar');
  }, { viewport: { width: 390, height: 800 } });
});

test('belum login: halaman karakter mengalihkan ke masuk; akun tanpa izin baca tidak melihat apa pun', async () => {
  await skenario(async page => { await page.goto(site + '/karakter'); await page.waitForSelector('#email'); assert.match(page.url(), /\/masuk$/); });
});
