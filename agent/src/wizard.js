'use strict';
// Tanya-jawab di jendela hitam untuk operator (bahasa awam). Semua logika ada di room.js dan index.js;
// berkas ini hanya mengumpulkan jawaban lalu memanggil fungsi yang sama dengan perintah bergaris-strip.
const readline = require('readline');
const room = require('./room');

function makeAsker(input = process.stdin, output = process.stdout) {
  const rl = readline.createInterface({ input, terminal: false });
  const it = rl[Symbol.asyncIterator]();
  const ask = async (q, def = '') => {
    output.write(q + (def ? ` [${def}]` : '') + ': ');
    const { value, done } = await it.next();
    if (done) { output.write('\n'); throw new Error('Input berhenti sebelum selesai. Dibatalkan, tidak ada yang disimpan.'); }
    const a = room.clean(value);
    return a || def;
  };
  const yes = async q => /^(y|ya)$/i.test(await ask(q + ' Ketik Y lalu Enter (selain itu dibatalkan)'));
  return { ask, yes, close: () => rl.close(), out: s => output.write(s + '\n') };
}

function line(out, k, v) { out(`  ${k.padEnd(14)}: ${v}`); }

function showRoom(out, r) {
  const s = room.summarize(r);
  out(`Ruang ${s.code} — ${s.name}`);
  line(out, 'Tahap', s.status); line(out, 'Foto wajah', s.foto); line(out, 'Penampilan', s.penampilan);
  line(out, 'Suara', s.suara); line(out, 'Project Flow', s.project); line(out, 'Akun Google', s.akun);
}

async function pickRoom(a, localRoot) {
  const all = room.listRooms(localRoot);
  if (!all.length) throw new Error('Belum ada ruang karakter. Buat dulu lewat menu 1 (Siapkan ruang karakter).');
  if (all.length === 1) { a.out(`Ruang yang dipakai: ${all[0].code} — ${all[0].name}`); return all[0]; }
  all.forEach((r, i) => a.out(`  ${i + 1}. ${r.code} — ${r.name} (${r.status})`));
  for (;;) {
    const x = await a.ask('Pilih nomor ruang');
    const r = all[Number(x) - 1] || all.find(y => y.code.toLowerCase() === x.toLowerCase());
    if (r) return r;
    a.out('Nomor tidak ada. Coba lagi.');
  }
}

// Menu 1: siapkan ruang karakter (sekali per project Flow).
async function wizardRoom(localRoot, io = makeAsker()) {
  const a = io;
  try {
    a.out('=== SIAPKAN RUANG KARAKTER ===');
    a.out('Bagian yang sudah terisi tidak perlu diketik ulang: tekan Enter untuk membiarkannya.');
    const code = await a.ask('Kode karakter (contoh C02_THE_SOFT_GIRL)');
    const old = room.CODE_RE.test(code) ? room.loadRoom(localRoot, code) : null;
    if (old) { a.out('Ruang ini sudah ada:'); showRoom(a.out, old); }
    const input = { code };
    input.name = await a.ask('Nama karakter', old ? old.name : '');
    input.face = await a.ask(old && old.face_ref_path ? 'Foto wajah (Enter = tetap pakai yang tersimpan)' : 'Alamat foto wajah (contoh C:\\aset\\wajah_C02.png)');
    const jsonSrc = await a.ask('Alamat video.json dari paket uji v2.3 untuk menyalin deskripsi penampilan (Enter = ketik sendiri atau biarkan)');
    if (jsonSrc) input.appearanceFromJson = jsonSrc;
    else if (!(old && old.dna && old.dna.appearance_en)) input.appearance = await a.ask('Ketik deskripsi penampilan dalam bahasa Inggris (rambut, wajah, kulit)');
    input.voiceFile = await a.ask('Alamat berkas profil suara (JSON; Enter = lewati atau biarkan)');
    input.project = await a.ask('Alamat project Flow (Ctrl+L lalu Ctrl+C di tab Flow; Enter = isi nanti atau biarkan)');
    input.account = await a.ask('Nama akun Google seperti tampil di 1-doctor (Enter = isi nanti atau biarkan)');
    const staged = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'bamugc-room-'));
    // Simulasikan dulu pada salinan supaya galat (foto salah, suara tidak valid) tidak menyimpan setengah-setengah.
    if (old) require('fs').cpSync(room.roomDir(localRoot, code), room.roomDir(staged, code), { recursive: true });
    let dry;
    try { dry = room.upsertRoom(staged, input); } finally { setTimeout(() => require('fs').rmSync(staged, { recursive: true, force: true }), 0); }
    a.out(''); a.out('===== PERIKSA DULU =====');
    showRoom(a.out, dry.room);
    a.out('Deskripsi penampilan:'); a.out('  ' + (dry.room.dna.appearance_en || '(belum ada)'));
    if (dry.room.voice_performance_en) { a.out('Teks suara untuk kolom "Sesuaikan performa" di Flow (tempel SEKALI di Flow):'); a.out('  ' + dry.room.voice_performance_en); }
    dry.notes.forEach(n => a.out('  • ' + n));
    if (!(await a.yes('Deskripsi penampilan dan data di atas sudah benar?'))) { a.out('Dibatalkan. Tidak ada yang disimpan.'); return null; }
    const res = room.upsertRoom(localRoot, input);
    a.out(''); a.out(`Ruang ${res.room.code} tersimpan (tahap: ${res.room.status}).`);
    if (res.room.status !== 'project_ready') a.out('Belum siap dipakai untuk job. Lengkapi lewat menu 1 atau 2 sampai tahap project_ready.');
    return res.room;
  } finally { a.close(); }
}

// Menu 2: setelah berganti akun Google, cukup ganti project dan akun. Foto, penampilan, dan suara tidak disentuh.
async function wizardSet(localRoot, io = makeAsker()) {
  const a = io;
  try {
    a.out('=== GANTI PROJECT ATAU AKUN ===');
    const r = await pickRoom(a, localRoot);
    showRoom(a.out, r);
    const project = await a.ask('Alamat project Flow yang BARU (Enter = tidak diubah)');
    const account = await a.ask('Nama akun Google yang BARU (Enter = tidak diubah)');
    if (!project && !account) { a.out('Tidak ada yang diubah.'); return r; }
    const res = room.upsertRoom(localRoot, { code: r.code, project, account });
    a.out(`Ruang ${res.room.code} diperbarui.`);
    a.out('Job yang SUDAH ada di antrean masih membawa alamat project lama dan akan ditolak oleh pemeriksaan. Buat ulang lewat menu 3 bila perlu.');
    return res.room;
  } finally { a.close(); }
}

// Menu 3: tambah produk = hanya storyboard, JSON, dan resolusi. Project dan foto wajah diambil dari ruang.
async function wizardAdd(localRoot, enqueue, io = makeAsker()) {
  const a = io;
  try {
    a.out('=== TAMBAH PRODUK (JOB BARU) ===');
    const r = await pickRoom(a, localRoot);
    if (r.status !== 'project_ready') throw new Error(`Ruang ${r.code} belum siap (tahap: ${r.status}). Lengkapi lewat menu 1: foto wajah, deskripsi penampilan, suara, dan alamat project.`);
    const storyboard = await a.ask('Alamat file storyboard (contoh C:\\aset\\03_daster-terracotta\\download.png)');
    const json = await a.ask('Alamat file JSON prompt (contoh C:\\aset\\03_daster-terracotta\\video.json)');
    const res = await a.ask('Resolusi 360p atau 720p', '720p');
    const jenis = await a.ask('Jenis produk (Enter = A-01 busana; atau ketik A-05 dst; atau salin kunci kategori dari CSV)');
    const isArch = /^A-\d{2}$/i.test(jenis);
    a.out(''); a.out('===== PERIKSA DULU =====');
    line(a.out, 'Karakter', `${r.code} — ${r.name}`); line(a.out, 'Project', '(dari ruang)'); line(a.out, 'Foto wajah', '(dari ruang)');
    line(a.out, 'Storyboard', storyboard); line(a.out, 'JSON', json); line(a.out, 'Resolusi', res);
    line(a.out, 'Jenis produk', !jenis ? 'A-01 (busana, bawaan)' : isArch ? jenis.toUpperCase() : `kategori: ${jenis}`);
    if (!(await a.yes('Sudah benar?'))) { a.out('Dibatalkan. Tidak ada job yang dibuat.'); return null; }
    return enqueue({ room: r.code, storyboard, json, res, ...(isArch ? { archetype: jenis.toUpperCase() } : jenis ? { category: jenis } : {}) });
  } finally { a.close(); }
}

module.exports = { makeAsker, wizardRoom, wizardSet, wizardAdd, showRoom };
