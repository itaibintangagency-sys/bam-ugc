'use strict';
// Perekam layar berpemandu: staff membuka tiap layar Flow, menekan Enter, lalu agent memotret
// daftar elemen dan screenshot. Tidak mengklik apa pun dan tidak menekan generate.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const inventory = require('./inventory');

const STEPS = [
  { slug: 'beranda-flow', judul: 'Beranda Flow', cara: 'Buka beranda Flow sampai tombol "Project baru" terlihat.' },
  { slug: 'project-baru', judul: 'Project baru terbuka', cara: 'Klik "Project baru". Setelah project terbuka, kembali ke sini.' },
  { slug: 'halaman-karakter', judul: 'Halaman Karakter', cara: 'Klik menu "Karakter" di sisi kiri.' },
  { slug: 'form-karakter-baru', judul: 'Form Karakter baru', cara: 'Klik tombol untuk membuat karakter baru sampai form "Karakter baru" terlihat.' },
  { slug: 'setelah-upload-foto', judul: 'Setelah upload 1 foto', cara: 'Klik "Upload" dan pilih 1 foto wajah. PERHATIAN: jangan menekan tombol panah/generate bila tertulis kredit lebih dari 0.' },
  { slug: 'layar-nama-suara', judul: 'Layar nama dan suara', cara: 'Lanjutkan sampai layar untuk mengisi nama dan memilih suara terlihat.' },
  { slug: 'daftar-suara', judul: 'Daftar suara', cara: 'Klik pilihan suara sampai daftar suara terbuka.' },
  { slug: 'daftar-suara-bawah', judul: 'Daftar suara (bagian bawah)', cara: 'Gulir daftar suara sampai ujung bawah.' },
  { slug: 'formulir-suara-kustom', judul: 'Formulir suara kustom', cara: 'Buka formulir untuk membuat suara baru/kustom. Jangan simpan.' },
  { slug: 'karakter-tersimpan', judul: 'Karakter tersimpan', cara: 'Selesaikan karakter ujimu (Selesai) sampai muncul di daftar Karakter.' },
  { slug: 'prompt-at-karakter', judul: 'Kotak prompt: @ lalu Karakter', cara: 'Di kotak prompt ketik @ lalu pilih kategori "Karakter".' },
  { slug: 'prompt-setelah-pilih', judul: 'Kotak prompt setelah memilih karakter', cara: 'Pilih karakter ujimu. Jangan tekan tombol generate.' },
  { slug: 'ganti-nama-project', judul: 'Ganti nama project', cara: 'Di beranda Flow, klik "Edit project" pada tile (lalu batalkan).' }
];

async function runRecon({ page, input = process.stdin, output = process.stdout, dir, only }) {
  fs.mkdirSync(dir, { recursive: true });
  const rl = readline.createInterface({ input, output, terminal: false });
  const lines = []; let waiting = null;
  rl.on('line', l => { if (waiting) { const w = waiting; waiting = null; w(l); } else lines.push(l); });
  const next = () => new Promise(r => { if (lines.length) r(lines.shift()); else waiting = r; });
  const say = m => output.write(m + '\n');

  const steps = STEPS.filter(s => !only || only.includes(s.slug));
  const done = [];
  say(`\nPerekam layar Flow: ${steps.length} langkah. Ketik "s" lalu Enter untuk melewati, "q" untuk berhenti.\n`);
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    say(`[${i + 1}/${steps.length}] ${st.judul}\n   ${st.cara}\n   Tekan Enter bila layarnya sudah seperti itu...`);
    const ans = (await next()).trim().toLowerCase();
    if (ans === 'q') break;
    if (ans === 's') { say('   (dilewati)'); continue; }
    const base = path.join(dir, `${String(i + 1).padStart(2, '0')}-${st.slug}`);
    const items = await inventory.collectDeep(page);
    fs.writeFileSync(base + '.json', JSON.stringify({ langkah: st.judul, url: page.url().replace(/\/project\/[0-9a-f-]+/i, '/project/<id>'), items }, null, 1));
    await page.screenshot({ path: base + '.png' });
    done.push({ ...st, file: path.basename(base), elemen: items.filter(x => x.visible).length });
    say(`   ✔ Tersimpan (${items.filter(x => x.visible).length} elemen terlihat)`);
  }
  rl.close();
  const md = ['# Rekaman layar Flow', '', `Dibuat: ${new Date().toISOString()}`, '', '| # | Layar | Berkas | Elemen terlihat |', '|---|---|---|---|',
    ...done.map((d, i) => `| ${i + 1} | ${d.judul} | ${d.file} | ${d.elemen} |`), '',
    'Kirim berkas .json (dan .png bila perlu) ke Claude. Periksa .png sebelum dikirim: bisa memperlihatkan namamu atau judul project.'].join('\n');
  fs.writeFileSync(path.join(dir, 'RINGKASAN.md'), md);
  say(`\nSelesai. Folder: ${dir}`);
  return done;
}
module.exports = { runRecon, STEPS };
