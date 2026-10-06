#!/usr/bin/env node
'use strict';
// Alat uji gambar (5.3b): memeriksa kemampuan model gambar OpenRouter dan membuat wajah, lembar sudut, dan storyboard bersih
// dari data kita, lalu mencatat waktu, biaya, ukuran, dan hasilnya. Dijalankan di laptop Anda dengan kunci Anda sendiri.
//   node uji-gambar.js models
//   node uji-gambar.js wajah      [--dna FILE] [--jumlah 4]
//   node uji-gambar.js lembar     --wajah FILE [--dna FILE] [--cara per-sudut|satu-gambar|keduanya]
//   node uji-gambar.js storyboard --wajah FILE [--dna FILE] [--produk FILE ...] [--rasio 21:9,4:1]
//   node uji-gambar.js wajah      --acuan FOTO --hubungan KUNCI [--catatan "teks"]     (wajah dibuat dari foto acuan)
//   node uji-gambar.js acuan      --acuan FOTO [--gender-acuan perempuan|laki-laki] [--jumlah 2]   (4 skenario siap pakai + lembar penilaian)
//   node uji-gambar.js acuan      --tanya   (layar pilihan: foto, hubungan, jenis kelamin hasil, jumlah, kualitas, lalu Y/N/U)
// Opsi umum: --kualitas low|medium|high  --model SLUG  --maks-gambar N  --kering  --ya  --keluar FOLDER
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const core = require('../../core/src');
const { OpenRouter, ApiError } = require('./lib/openrouter');
const B = require('./lib/berkas');
const Laporan = require('./lib/laporan');
const Skenario = require('./lib/skenario');
const Versi = require('./lib/versi');
const Tanya = require('./lib/tanya');
const { Writable } = require('stream');

const HERE = __dirname;
const DEFAULT_RATIOS = ['21:9', '4:1'];

function parseArgs(argv) {
  const pos = [], o = { produk: [] }; const flags = new Set(['kering', 'ya', 'bantuan', 'tanya']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (flags.has(k)) { o[k] = true; continue; }
    const v = argv[++i]; if (v === undefined) throw new Error(`Opsi --${k} butuh nilai.`);
    if (k === 'produk') o.produk.push(v); else o[k] = v;
  }
  return { cmd: pos[0], o };
}

function loadEnvFile(file) {
  const out = {}; if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  return out;
}

// Meminta rahasia (kunci) di terminal: tiap karakter yang diterima tampil sebagai "*", sehingga jelas bahwa ketikan atau tempelan masuk,
// tetapi isinya tidak terbaca di layar. Tanpa readline supaya tidak bentrok dengan pertanyaan lain. Bila stdin bukan terminal
// (mis. input dialirkan), jatuh ke pertanyaan biasa lewat `cadangan`.
function mintaRahasia(q, cadangan, { masuk = process.stdin, keluar = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    if (!masuk.isTTY || typeof masuk.setRawMode !== 'function') { cadangan(q).then(resolve, reject); return; }
    keluar.write(q);
    let buf = '', esc = false;
    const selesai = (nilai, galat) => { masuk.removeListener('data', onData); try { masuk.setRawMode(false); } catch { /* abaikan */ } masuk.pause(); keluar.write('\n'); galat ? reject(galat) : resolve(nilai); };
    const onData = chunk => {
      for (const c of String(chunk)) {
        if (esc) { if (/[A-Za-z~]/.test(c)) esc = false; continue; }            // urutan tombol panah dan sejenisnya diabaikan
        if (c === '\u001b') { esc = true; continue; }
        if (c === '\r' || c === '\n') return selesai(buf);
        if (c === '\u0003') return selesai('', new Error('Dibatalkan (Ctrl+C).'));
        if (c === '\u007f' || c === '\b') { if (buf.length) { buf = buf.slice(0, -1); keluar.write('\b \b'); } continue; }
        if (c < ' ') continue;
        buf += c; keluar.write('*');
      }
    };
    masuk.setRawMode(true); masuk.resume(); masuk.setEncoding('utf8'); masuk.on('data', onData);
  });
}
// Bentuk kunci OpenRouter: diawali sk-or-. Awalan "Bearer", tanda kutip, dan spasi hasil salinan dibuang.
function rapikanKunci(teks) { let k = String(teks == null ? '' : teks); const tanpaKutip = x => x.trim().replace(/^["'`]+|["'`]+$/g, '').trim(); k = tanpaKutip(k); k = k.replace(/^bearer\s+/i, ''); return tanpaKutip(k); }
function cekBentukKunci(k) { return /^sk-or-\S{12,}$/.test(k) ? '' : 'Kunci OpenRouter diawali "sk-or-" dan berupa satu deretan huruf, angka, dan tanda hubung. Salin ulang dari halaman Keys di OpenRouter.'; }

// ───────────── Data masukan ─────────────
function loadDna(file) {
  const f = B.clean(file || path.join(HERE, 'contoh', 'dna-C02.json'));
  if (!fs.existsSync(f)) throw new Error(`Berkas DNA tidak ditemukan: "${f}".`);
  let dna; try { dna = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error(`Berkas DNA bukan JSON yang valid (${e.message}).`); }
  for (const k of Object.keys(dna)) if (k.startsWith('_')) delete dna[k];
  const issues = core.validateDna(dna);
  if (issues.length) throw new Error('DNA tidak valid:\n' + issues.map(i => `  - ${i.field}: ${i.msg}`).join('\n'));
  return dna;
}
function loadProduct(file) {
  const f = B.clean(file);
  if (!fs.existsSync(f)) throw new Error(`Berkas produk tidak ditemukan: "${f}".`);
  let p; try { p = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error(`Berkas produk "${path.basename(f)}" bukan JSON yang valid (${e.message}).`); }
  const photos = [];
  const files = p.foto_folder ? B.listImages(p.foto_folder) : (p.foto || []).map(x => B.clean(x));
  if (!files.length) throw new Error(`Produk "${p.nama}" tidak punya foto. Isi "foto_folder" atau "foto".`);
  if (files.length > 6) throw new Error(`Produk "${p.nama}" punya ${files.length} foto; maksimal 6.`);
  const used = new Set();
  files.forEach((fp, i) => { const img = B.readImage(fp); let role = B.roleOf(path.basename(fp), i); while (used.has(role) && role !== 'tekstur') role = ['depan', 'closeup', 'tekstur', 'samping', 'belakang', 'label'].find(r => !used.has(r)) || 'tekstur'; used.add(role); photos.push({ role, url: img.url, name: img.name, bytes: img.bytes, sha: img.sha }); });
  const profile = { photos: photos.map(x => ({ role: x.role })), facts: p.fakta_id || [], facts_en: p.fakta_en || [], colors: p.warna || [],
    details: (p.detail || []).map(d => ({ slot_key: d.slot, text: d.teks_id || d.teks_en, text_en: d.teks_en, label: d.label || d.slot, confidence: d.keyakinan ?? 0.9 })) };
  return { nama: p.nama || path.basename(f, '.json'), archetype: p.arketipe || 'A-01', setting: p.lokasi || 'S-01', seed: p.seed ?? 9, gesture: p.gestur || 'open_palm', photos, profile, file: f };
}

// ───────────── Tugas ─────────────
function planTasks(cmd, o, ctx) {
  const quality = o.kualitas || 'medium'; const model = o.model || core.DEFAULT_MODEL; const tasks = [];
  if (cmd === 'wajah') {
    const n = Number(o.jumlah || 4); if (!(n >= 1 && n <= 8)) throw new Error('--jumlah harus 1 sampai 8.');
    let ref = null, acuan = null;
    if (o.acuan) {
      if (!o.hubungan) throw new Error(`Foto acuan butuh --hubungan. Pilihan: ${Object.keys(core.HUBUNGAN).join(', ')}.`);
      ref = { relation: o.hubungan, note: o.catatan || '' };
      const bad = core.validateReference(ref, ctx.dna); if (bad.length) throw new Error('Foto acuan tidak valid:\n' + bad.map(b => `  - ${b.field}: ${b.msg}`).join('\n'));
      acuan = B.readImage(o.acuan);
    } else if (o.hubungan || o.catatan) throw new Error('--hubungan dan --catatan hanya dipakai bersama --acuan FOTO.');
    for (let i = 1; i <= n; i++) tasks.push({ nama: ref ? `wajah-acuan-${i}` : `wajah-${i}`, jenis: ref ? 'wajah-acuan' : 'wajah', body: core.buildImageRequest({ model, quality, aspectRatio: o.rasio || '3:4', prompt: core.buildFacePrompt(ctx.dna, i, ref), references: acuan ? [acuan.url] : [] }), refs: acuan ? [acuan] : [] });
  }
  if (cmd === 'acuan') {
    if (!o.acuan) throw new Error('Perintah acuan butuh --acuan FOTO (foto orang dewasa yang izinnya sudah Anda urus).');
    const acuan = B.readImage(o.acuan); const jml = Number(o.jumlah || 2); if (!(jml >= 1 && jml <= 4)) throw new Error('--jumlah harus 1 sampai 4 gambar per skenario.');
    ctx.skenario = ctx.pilihan && ctx.pilihan.karakter ? [ctx.pilihan.karakter] : Skenario.skenarioAcuan(o['gender-acuan'] || 'perempuan'); ctx.jumlahAcuan = jml;
    for (const sk of ctx.skenario) for (let i = 1; i <= jml; i++) {
      tasks.push({ nama: `acuan-${sk.kode}-${slug(sk.judul)}-${i}`, jenis: 'wajah-acuan', skenario: `${sk.kode} ${sk.judul}`, harapan: sk.harapan,
        body: core.buildImageRequest({ model, quality, aspectRatio: o.rasio || '3:4', prompt: core.buildFacePrompt(sk.dna, i, { relation: sk.relation, note: sk.note }), references: [acuan.url] }), refs: [acuan] });
    }
  }
  if (cmd === 'lembar') {
    const face = B.readImage(o.wajah); const cara = o.cara || 'keduanya';
    if (!['per-sudut', 'satu-gambar', 'keduanya'].includes(cara)) throw new Error('--cara harus per-sudut, satu-gambar, atau keduanya.');
    if (cara !== 'satu-gambar') for (const a of Object.keys(core.ANGLES)) tasks.push({ nama: `sudut-${a}`, jenis: 'lembar-sudut', body: core.buildImageRequest({ model, quality, aspectRatio: o.rasio || (a.startsWith('face') ? '3:4' : '2:3'), prompt: core.buildSheetPrompt(ctx.dna, a), references: [face.url] }), refs: [face] });
    if (cara !== 'per-sudut') tasks.push({ nama: 'lembar-satu-gambar', jenis: 'lembar-kisi', body: core.buildImageRequest({ model, quality, aspectRatio: o.rasio || '16:9', prompt: core.buildSheetGridPrompt(ctx.dna), references: [face.url] }), refs: [face] });
  }
  if (cmd === 'storyboard') {
    const face = B.readImage(o.wajah); const ratios = (o.rasio || DEFAULT_RATIOS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
    const cp = core.dnaToProfile(ctx.dna);
    ctx.products.forEach((p, pi) => {
      const plan = core.buildPanelPlan({ archetypeId: p.archetype, productProfile: p.profile, settingId: p.setting, seed: p.seed, gestureVariant: p.gesture });
      if (plan.error || plan.habis) throw new Error(`Produk "${p.nama}": rencana panel gagal (${plan.error || 'slot habis; tambah foto atau detail'}).`);
      const sbPrompt = core.buildStoryboardPrompt(plan, { variant: 'clean', characterCode: ctx.code, productProfile: p.profile, images: p.photos.map(x => ({ role: x.role })) });
      const json = core.buildVideoJson(plan, { characterCode: ctx.code, jobTag: `PRODUCT-${String(pi + 1).padStart(2, '0')}`, productProfile: p.profile, characterProfile: cp, characterPhotoAttached: true, storyboardVariant: 'clean' });
      const chk = core.checkPromptSet({ plan, storyboardPrompt: sbPrompt, json, variant: 'clean', characterProfile: cp, characterPhotoAttached: true });
      ctx.extras.push({ produk: p, plan, json, chk });
      for (const r of ratios) {
        const { body } = core.storyboardImageRequest(plan, { variant: 'clean', characterCode: ctx.code, productProfile: p.profile, characterRef: face.url, productRefs: p.photos.map(x => ({ role: x.role, url: x.url })), aspectRatio: r, quality, model });
        tasks.push({ nama: `storyboard-${pi + 1}-${slug(p.nama)}-${r.replace(':', 'x')}`, jenis: 'storyboard-bersih', body, refs: [face, ...p.photos] });
      }
    });
  }
  return tasks;
}
const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'x';

// Salinan permintaan untuk disimpan: gambar rujukan diganti ringkasan; kunci tidak pernah ikut.
function redacted(task) {
  const b = JSON.parse(JSON.stringify(task.body));
  if (b.input_references) b.input_references = task.refs.map(r => ({ berkas: r.name, ukuran_byte: r.bytes, sha256_awal: r.sha, peran: r.role || undefined }));
  return b;
}

// ───────────── Perintah ─────────────
async function cmdModels(client, outDir, log) {
  const model = core.DEFAULT_MODEL; const res = {};
  const list = await client.get('/images/models').catch(e => { if (e instanceof ApiError && e.status === 404) return null; throw e; });
  if (list) res.list = list.json;
  const mine = list && list.json && Array.isArray(list.json.data) ? list.json.data.find(m => m.id === model) : null;
  const ep = await client.get(`/images/models/${model}/endpoints`).catch(e => { if (e instanceof ApiError && e.status === 404) return null; throw e; });
  if (ep) res.endpoints = ep.json;
  fs.writeFileSync(path.join(outDir, 'models.json'), JSON.stringify(res, null, 1));
  const lines = [`Model: ${model}`];
  if (!mine && !ep) lines.push('  (OpenRouter tidak mengenali model ini lewat Image API; periksa nama model.)');
  const sp = (mine && mine.supported_parameters) || (ep && ep.json.endpoints && ep.json.endpoints[0] && ep.json.endpoints[0].supported_parameters) || {};
  const show = (k, d) => d ? (d.type === 'enum' ? d.values.join(', ') : d.type === 'range' ? `${d.min} sampai ${d.max}` : 'didukung') : '(tidak didukung / tidak disebut)';
  for (const k of ['aspect_ratio', 'resolution', 'quality', 'n', 'output_format', 'seed']) lines.push(`  ${k.padEnd(14)}: ${show(k, sp[k])}`);
  lines.push(`  input gambar  : ${mine && mine.architecture ? (mine.architecture.input_modalities || []).join(', ') : '(tidak disebut)'}`);
  for (const e of (ep && ep.json.endpoints) || []) { lines.push(`  penyedia ${e.provider_name || e.provider_slug}:`); for (const pr of e.pricing || []) lines.push(`     harga ${pr.billable}: US$${pr.cost_usd} per ${pr.unit}${pr.variant ? ' (' + pr.variant + ')' : ''}`); }
  const ratioOk = sp.aspect_ratio && sp.aspect_ratio.type === 'enum' ? DEFAULT_RATIOS.filter(r => sp.aspect_ratio.values.includes(r)) : null;
  lines.push('', ratioOk ? `Rasio uji bawaan yang didukung: ${ratioOk.join(', ') || '(tidak ada; pakai --rasio dari daftar di atas)'}` : 'Daftar rasio tidak tersedia; uji rasio langsung dengan perintah storyboard.');
  const text = lines.join('\n'); fs.writeFileSync(path.join(outDir, 'kemampuan-model.txt'), text + '\n'); log(text);
  return { ratioOk };
}

async function run(argv, env = process.env, io = { out: s => console.log(s), rl: null }) {
  const { cmd, o } = parseArgs(argv); const log = io.out;
  if (!cmd || o.bantuan || !['models', 'wajah', 'lembar', 'storyboard', 'acuan', 'periksa', 'kunci'].includes(cmd)) { log('Perintah: models | wajah | lembar | storyboard | acuan | periksa | kunci. Lihat BACA-DULU-UJI-GAMBAR.md dan BACA-DULU-UJI-ACUAN.md'); return cmd ? 1 : 0; }
  const fileEnv = loadEnvFile(path.join(HERE, '.env'));
  const base = env.OPENROUTER_BASE || fileEnv.OPENROUTER_BASE || 'https://openrouter.ai/api/v1';
  const outRoot = o.keluar || env.UJI_HASIL || path.join(HERE, 'hasil');
  let outDir = path.join(outRoot, `${B.stamp()}-${cmd}`); for (let n = 2; fs.existsSync(outDir); n++) outDir = path.join(outRoot, `${B.stamp()}-${cmd}-${n}`);
  const dry = !!o.kering;
  const versi = Versi.cekCore(core);

  // Kunci: lingkungan, lalu .env di folder alat ini (tidak ikut ke GitHub), lalu ditanya. Tidak pernah disimpan.
  let key = env.OPENROUTER_API_KEY || fileEnv.OPENROUTER_API_KEY || '';

  let rl = io.rl || null; const ownRl = !io.rl;
  const getRl = () => rl || (rl = readline.createInterface({ input: process.stdin, output: process.stdout }));
  let penanya = null; const tanya = q => (penanya || (penanya = Tanya.buatPenanya(getRl())))(q);   // satu antrean baris untuk semua pertanyaan
  const buatFolder = () => fs.mkdirSync(outDir, { recursive: true });                                // folder hasil baru dibuat setelah pengguna setuju
  try {
  if (cmd === 'periksa') {
    const nodeOk = Number(process.versions.node.split('.')[0]) >= 18;
    log(`Node.js ${process.versions.node}: ${nodeOk ? 'sesuai' : 'TERLALU LAMA (butuh 18 atau lebih baru)'}`);
    log(`Folder core: ${path.resolve(HERE, '..', '..', 'core')}`);
    for (const [berkas, fungsi] of Object.entries(Versi.PERLU)) { const hilang = (versi.kurang.find(k => k.berkas === berkas) || { fungsi: [] }).fungsi; log(`  ${hilang.length ? 'KURANG' : 'ok    '} ${berkas}${hilang.length ? ': ' + hilang.join(', ') : ''}`); }
    log(Versi.pesanCore(versi)); return versi.ok && nodeOk ? 0 : 1;
  }
  if (cmd === 'kunci') {
    const k = rapikanKunci(await mintaRahasia('Tempel kunci OpenRouter lalu tekan Enter (tiap karakter tampil sebagai *): ', q => tanya(q)));
    const bentuk = cekBentukKunci(k); if (bentuk) throw new Error(bentuk);
    const f = path.join(HERE, '.env'); const lama = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(l => l.trim() && !/^\s*OPENROUTER_API_KEY\s*=/.test(l)) : [];
    fs.writeFileSync(f, [...lama, `OPENROUTER_API_KEY=${k}`].join('\r\n') + '\r\n', { mode: 0o600 });
    log(`Kunci tersimpan di ${f}\nBerkas itu tidak ikut ke GitHub. Hapus berkas .env bila uji sudah selesai, dan jangan memotret atau mengirimnya.`); return 0;
  }
    if (!versi.ok) throw new Error(Versi.pesanCore(versi));
    if (!key && !dry && !['periksa', 'kunci'].includes(cmd)) key = rapikanKunci(await mintaRahasia('Tempel kunci OpenRouter lalu tekan Enter (tiap karakter tampil sebagai *, isinya tidak terlihat; tidak disimpan): ', q => tanya(q)));
    if (!dry && !['periksa', 'kunci'].includes(cmd) && !key) throw new Error('Kunci OpenRouter kosong.');
    if (!dry && !['periksa', 'kunci'].includes(cmd)) { const bentuk = cekBentukKunci(key); if (bentuk) throw new Error(bentuk); }
    const client = new OpenRouter({ key, base, timeoutMs: Number(env.UJI_TIMEOUT_MS || 300000), retryWaitMs: Number(env.UJI_RETRY_MS || 4000) });

    if (cmd === 'models') { if (dry) { log('Mode kering: perintah models tidak memanggil jaringan.'); return 0; } buatFolder(); await cmdModels(client, outDir, log); log(`\nBerkas: ${outDir}`); return 0; }

    let pilihan = null;
    if (cmd === 'acuan' && o.tanya) {
      pilihan = await Tanya.wizardAcuan({ tanya, log, maks: Number(o['maks-gambar'] || 12), kering: dry, catatan: o.catatan || '' });
      if (!pilihan) { log('Dibatalkan. Tidak ada yang dikirim.'); return 1; }
      o.acuan = pilihan.foto; o.jumlah = String(pilihan.jumlah); o.kualitas = pilihan.kualitas; o['gender-acuan'] = pilihan.genderFoto;
    }
    const ctx = { dna: cmd === 'acuan' ? null : loadDna(o.dna), products: [], extras: [], code: o.kode || 'C02_THE_SOFT_GIRL', pilihan };
    if (cmd === 'storyboard') {
      const files = o.produk.length ? o.produk : fs.readdirSync(path.join(HERE, 'contoh')).filter(n => /^produk-.*\.json$/.test(n)).sort().map(n => path.join(HERE, 'contoh', n));
      ctx.products = files.map(loadProduct);
    }
    const tasks = planTasks(cmd, o, ctx);
    const cap = Number(o['maks-gambar'] || 12);
    log(`Perintah: ${cmd} | model ${o.model || core.DEFAULT_MODEL} | kualitas ${o.kualitas || 'medium'}${dry ? ' | MODE KERING (tidak ada yang dikirim)' : ''}`);
    log(`Akan membuat ${tasks.length} gambar (batas pengaman ${cap}).`);
    if (tasks.length > cap) throw new Error(`Rencana ${tasks.length} gambar melebihi batas pengaman ${cap}. Tambah --maks-gambar ${tasks.length} bila memang disengaja. Tidak ada yang dikirim.`);
    tasks.forEach(t => log(`   - ${t.nama}  (rasio ${t.body.aspect_ratio || '-'}, rujukan ${t.refs.length})`));   // tanpa nomor: daftar ini informasi, bukan menu
    for (const x of ctx.extras) { const e = x.chk; log(`  JSON "${x.produk.nama}": ${e.errors.length ? e.errors.length + ' GALAT kesesuaian' : 'lolos pemeriksaan kesesuaian'}${e.warnings.length ? `, ${e.warnings.length} peringatan` : ''}`); }
    if (!pilihan && o.acuan && ctx.dna) { const w = Skenario.peringatanKonflik(o.catatan, ctx.dna); if (w) log(`\nPERINGATAN: ${w}`); }
    if (!pilihan && (cmd === 'acuan' || o.acuan)) log('\nPERHATIAN: foto acuan dikirim ke OpenRouter dan penyedia modelnya. Pakai hanya foto orang dewasa yang izinnya sudah Anda urus. Foto orang nyata dapat ditolak oleh penyaring isi model.');
    // Layar pilihan sudah meminta Y. Selain itu: jawaban selain Y/N tidak membatalkan, ditanya ulang; N atau masukan habis membatalkan.
    if (!dry && !o.ya && !pilihan) { if (!await Tanya.konfirmasiYN(tanya, log, 'Setiap gambar ditagih OpenRouter. Ketik Y lalu Enter untuk mulai, N untuk batal: ')) { log('Dibatalkan. Tidak ada yang dikirim.'); return 1; } }
    buatFolder();

    // Simpan prompt, JSON Flow, dan hasil pemeriksaan sebelum memanggil jaringan
    for (const [i, t] of tasks.entries()) fs.writeFileSync(path.join(outDir, `permintaan-${String(i + 1).padStart(2, '0')}-${t.nama}.json`), JSON.stringify(redacted(t), null, 1));
    for (const [i, x] of ctx.extras.entries()) {
      const n = `${String(i + 1).padStart(2, '0')}-${slug(x.produk.nama)}`;
      fs.writeFileSync(path.join(outDir, `video-${n}.json`), x.json);
      fs.writeFileSync(path.join(outDir, `periksa-${n}.txt`), [`Urutan panel 2-4: ${x.chk.stats.order}`, `Panjang JSON: ${x.chk.stats.json_chars} karakter`, '', x.chk.errors.length ? 'GALAT:\n' + x.chk.errors.map(e => ' - ' + e).join('\n') : 'Tanpa galat.', x.chk.warnings.length ? '\nPERINGATAN:\n' + x.chk.warnings.map(e => ' - ' + e).join('\n') : ''].join('\n'));
    }

    const rows = []; let aborted = null;
    for (const [i, t] of tasks.entries()) {
      const row = { no: i + 1, nama: t.nama, jenis: t.jenis, model: t.body.model, kualitas: t.body.quality, rasio: t.body.aspect_ratio || '', rujukan: t.refs.length, status: 'kering', detik: null, biaya_usd: null, ukuran_px: '', berkas: '', catatan: '', skenario: t.skenario || '', harapan: t.harapan || '' };
      if (!dry && !aborted) {
        log(`[${i + 1}/${tasks.length}] ${t.nama} ...`);
        try {
          const r = await client.post('/images', t.body); const parsed = core.parseImageResponse(r.json);
          const img = parsed.images[0]; const buf = img.b64 ? Buffer.from(img.b64, 'base64') : null;
          const file = `${String(i + 1).padStart(2, '0')}-${t.nama}.${img.ext}`;
          if (buf) fs.writeFileSync(path.join(outDir, file), buf); else row.catatan = 'server memberi alamat, bukan data: ' + String(img.url).slice(0, 80);
          const d = buf && B.dimsOf(buf);
          Object.assign(row, { status: 'ok', detik: Number((r.ms / 1000).toFixed(1)), biaya_usd: parsed.cost, ukuran_px: d ? `${d.w}x${d.h}` : '', berkas: buf ? file : '' });
          if (r.tries > 1) row.catatan = 'berhasil pada percobaan ke-2';
          if (parsed.images.length > 1) row.catatan = (row.catatan ? row.catatan + '; ' : '') + `server mengirim ${parsed.images.length} gambar, hanya yang pertama disimpan`;
          log(`    selesai ${row.detik} detik${row.ukuran_px ? ', ' + row.ukuran_px + ' px' : ''}${row.biaya_usd != null ? ', US$' + row.biaya_usd : ''}`);
        } catch (e) {
          row.status = 'gagal'; row.catatan = e.message.replace(/\s+/g, ' ').slice(0, 300);
          log(`    GAGAL: ${e.message}`);
          if (e instanceof ApiError && [401, 402, 403].includes(e.status)) { aborted = e.message; log('    Dihentikan: masalah kunci atau saldo berlaku untuk semua gambar.'); }
        }
      } else if (aborted) { row.status = 'gagal'; row.catatan = 'dilewati: ' + aborted.slice(0, 80); }
      rows.push(row);
    }
    const extra = ctx.extras.length ? ['## Pemeriksaan kesesuaian JSON Flow (tanpa kredit)', '', ...ctx.extras.map(x => `- ${x.produk.nama}: ${x.chk.errors.length ? x.chk.errors.length + ' galat' : 'lolos'}, urutan panel ${x.chk.stats.order}, ${x.chk.stats.json_chars} karakter`)] : [];
    const s = Laporan.write(outDir, cmd, rows, extra);
    if (cmd === 'acuan') fs.writeFileSync(path.join(outDir, 'lembar-penilaian.md'), Skenario.lembarPenilaian(rows, ctx.jumlahAcuan));
    log(`\nSelesai: ${s.sukses} sukses, ${s.gagal} gagal${s.biaya_usd != null ? `, biaya tercatat US$${s.biaya_usd}` : ''}${s.detik_rata2 != null ? `, rata-rata ${s.detik_rata2} detik` : ''}.\nHasil dan laporan: ${outDir}`);
    return aborted || s.gagal ? 2 : 0;
  } finally { if (ownRl && rl) rl.close(); }
}

if (require.main === module) {
  run(process.argv.slice(2)).then(c => process.exit(c)).catch(e => { console.error('GAGAL: ' + e.message); process.exit(1); });
}
module.exports = { run, parseArgs, loadDna, loadProduct, planTasks, redacted };
