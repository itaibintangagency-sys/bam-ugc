'use strict';
// Layar pilihan uji foto acuan. Semua pertanyaan lewat satu fungsi `tanya(teks)` yang mengembalikan satu baris jawaban,
// atau null bila masukan sudah habis (mis. jendela ditutup atau input dialirkan dan selesai). Dengan begitu layar bisa diuji
// tanpa terminal sungguhan, dan tidak pernah berputar tanpa akhir.
const B = require('./berkas');
const Skenario = require('./skenario');

const BATAL = Symbol('batal');

// Antrean baris: aman untuk terminal sungguhan maupun input yang dialirkan (readline.question menghilangkan baris yang datang lebih awal).
function buatPenanya(rl, keluar = process.stdout) {
  const antre = []; let menunggu = null; let tutup = false;
  rl.on('line', l => { if (menunggu) { const m = menunggu; menunggu = null; m(l); } else antre.push(l); });
  rl.on('close', () => { tutup = true; if (menunggu) { const m = menunggu; menunggu = null; m(null); } });
  return q => new Promise(res => {
    if (antre.length) { keluar.write(q + '\n'); return res(antre.shift()); }
    if (tutup) return res(null);
    menunggu = res; rl.setPrompt(q); rl.prompt();
  });
}

const YA = /^(y|ya)$/i, TIDAK = /^(n|no|tidak|batal)$/i, UBAH = /^(u|ubah)$/i;

// Y atau N. Jawaban lain TIDAK membatalkan: ditanya ulang. Masukan habis dianggap batal.
async function konfirmasiYN(tanya, log, pertanyaan) {
  for (;;) {
    const a = await tanya(pertanyaan); if (a === null) return false;
    const t = B.clean(a); if (YA.test(t)) return true; if (TIDAK.test(t)) return false;
    log(t ? `Jawaban "${t}" tidak dikenal. Ketik Y untuk mulai atau N untuk batal.` : 'Ketik Y untuk mulai atau N untuk batal, lalu Enter.');
  }
}

async function sampaiBenar(tanya, log, q, baca, bawaan, salah, wajib) {
  for (;;) {
    const a = await tanya(q); if (a === null) return BATAL;
    const t = B.clean(a); if (/^batal$/i.test(t)) return BATAL;
    if (t === '') { if (bawaan !== undefined && bawaan !== '') return bawaan; log(wajib || 'Pilihan ini wajib diisi.'); continue; }
    const v = baca(t); if (v !== undefined) return v; log(salah);
  }
}

const bacaGender = t => /^(p|perempuan|wanita)$/i.test(t) ? 'perempuan' : /^(l|laki|laki-laki|lelaki|pria)$/i.test(t) ? 'laki-laki' : undefined;
const bacaAngka = (min, max) => t => { const n = /^\d+$/.test(t) ? Number(t) : NaN; return n >= min && n <= max ? n : undefined; };
const bacaKualitas = t => ({ 1: 'low', low: 'low', 2: 'medium', medium: 'medium', 3: 'high', high: 'high' })[t.toLowerCase()];

const SEMUA = 6;
function judulSkenario(gf) { return Skenario.skenarioAcuan(gf).map(s => `${s.kode} ${s.judul}`).join(', '); }

// Hasil: null bila dibatalkan, atau { foto, genderFoto, hub (kunci atau 'semua'), karakter (null bila semua), jumlah, kualitas, total }.
async function wizardAcuan({ tanya, log, maks = 12, kering = false, catatan = '' }) {
  log('UJI FOTO ACUAN. Anda akan menjawab beberapa pilihan; tekan Enter untuk memakai nilai dalam kurung siku.');
  log('Pakai HANYA foto orang dewasa yang izinnya sudah Anda urus. Foto acuan dikirim ke OpenRouter dan penyedia modelnya,');
  log('dan foto orang nyata dapat ditolak oleh penyaring isi model. Ketik "batal" kapan saja untuk berhenti.\n');
  const s = { foto: '', genderFoto: '', hub: 2, genderHasil: '', jumlah: 1, kualitas: 'low' };
  for (;;) {
    // 1. Foto acuan
    for (;;) {
      const a = await tanya(`1/6 Alamat foto acuan (contoh C:\\aset\\acuan.jpg)${s.foto ? ` [${s.foto}]` : ''}: `);
      if (a === null) return null; const t = B.clean(a); if (/^batal$/i.test(t)) return null;
      const f = t || s.foto; if (!f) { log('Alamat foto belum diisi. Ketik alamat lengkapnya, atau ketik batal.'); continue; }
      try { B.readImage(f); s.foto = f; break; } catch (e) { log(e.message); }
    }
    // 2. Orang DI FOTO
    let r = await sampaiBenar(tanya, log, `2/6 Orang yang ADA DI FOTO itu perempuan atau laki-laki? Ketik P atau L${s.genderFoto ? ` [${s.genderFoto === 'perempuan' ? 'P' : 'L'}]` : ''}: `, bacaGender, s.genderFoto, 'Ketik P untuk perempuan atau L untuk laki-laki.', 'Wajib diisi: ketik P atau L.');
    if (r === BATAL) return null; s.genderFoto = r;
    // 3. Hubungan
    log('\nOrang yang akan DIBUAT dari foto itu:');
    for (const m of Skenario.MENU_HUBUNGAN) log(`   ${m.no}  ${m.label}`);
    log(`   ${SEMUA}  Semua skenario sekaligus (cara lama: ${judulSkenario(s.genderFoto)})`);
    r = await sampaiBenar(tanya, log, `3/6 Pilih nomor hubungan [${s.hub}]: `, bacaAngka(1, SEMUA), s.hub, `Ketik angka 1 sampai ${SEMUA}.`);
    if (r === BATAL) return null; s.hub = r;
    const m = Skenario.MENU_HUBUNGAN.find(x => x.no === s.hub) || null;
    // 4. Jenis kelamin orang yang DIBUAT
    let gh = '';
    if (!m) log('4/6 Jenis kelamin hasil: mengikuti tiap skenario.');
    else if (m.gender === 'foto') { gh = s.genderFoto; log(`4/6 Jenis kelamin hasil: ${gh} (orang yang sama dengan foto).`); }
    else if (m.gender) { gh = m.gender; log(`4/6 Jenis kelamin hasil: ${gh} (ditentukan oleh hubungan ${m.label.toLowerCase()}).`); }
    else {
      r = await sampaiBenar(tanya, log, `4/6 Jenis kelamin orang yang DIBUAT (${m.label.toLowerCase()}): ketik P atau L${s.genderHasil ? ` [${s.genderHasil === 'perempuan' ? 'P' : 'L'}]` : ''}: `, bacaGender, s.genderHasil, 'Ketik P untuk perempuan atau L untuk laki-laki.', 'Wajib dipilih: hubungan ini tidak menentukan jenis kelamin. Ketik P atau L.');
      if (r === BATAL) return null; gh = s.genderHasil = r;
    }
    // 5. Jumlah gambar
    r = await sampaiBenar(tanya, log, `5/6 Jumlah gambar${m ? '' : ' per skenario'}, 1 sampai 4 [${s.jumlah}]: `, bacaAngka(1, 4), s.jumlah, 'Ketik angka 1 sampai 4.');
    if (r === BATAL) return null; s.jumlah = r;
    // 6. Kualitas
    r = await sampaiBenar(tanya, log, `6/6 Kualitas: 1 low (murah), 2 medium, 3 high (mahal) [${s.kualitas}]: `, bacaKualitas, s.kualitas, 'Ketik 1, 2, 3, atau low, medium, high.');
    if (r === BATAL) return null; s.kualitas = r;

    // 7. Ringkasan
    const karakter = m ? Skenario.buatKarakter({ genderFoto: s.genderFoto, hubungan: m.kunci, genderHasil: gh }) : null;
    const total = m ? s.jumlah : 4 * s.jumlah; const lewat = total > maks;
    const nama = B.clean(s.foto).split(/[\\/]/).pop();
    log('\n--- RINGKASAN ---');
    log(`Foto   : ${nama} (${s.genderFoto})`);
    log(karakter ? `Dibuat : ${karakter.judul.toLowerCase()}${karakter.judul.toLowerCase().includes(karakter.dna.gender) ? '' : ', ' + karakter.dna.gender}, usia ${karakter.usia}` : `Dibuat : semua skenario (${judulSkenario(s.genderFoto)})`);
    log(`Jumlah : ${total} gambar${m ? '' : ` (${s.jumlah} per skenario)`}, kualitas ${s.kualitas}`);
    if (karakter && catatan) { const w = Skenario.peringatanKonflik(catatan, karakter.dna); if (w) log(`PERINGATAN: ${w}`); }
    if (kering) log('MODE KERING: tidak ada yang dikirim dan tidak ada biaya.');
    if (lewat) log(`PERHATIAN: ${total} gambar melebihi batas pengaman ${maks}. Ketik U lalu kurangi jumlah gambar.`);
    for (;;) {
      const a = await tanya(lewat ? 'N = batal, U = ubah pilihan: ' : `${kering ? '' : 'Setiap gambar ditagih OpenRouter. '}Y = mulai, N = batal, U = ubah pilihan: `);
      if (a === null) return null; const t = B.clean(a);
      if (YA.test(t)) { if (lewat) { log('Belum bisa: jumlah gambar melebihi batas pengaman. Ketik U untuk mengubah.'); continue; } return { foto: s.foto, genderFoto: s.genderFoto, hub: m ? m.kunci : 'semua', karakter, jumlah: s.jumlah, kualitas: s.kualitas, total }; }
      if (TIDAK.test(t)) return null;
      if (UBAH.test(t)) { log('\nBaik, ubah pilihan. Tekan Enter untuk mempertahankan nilai sebelumnya.\n'); break; }
      log(t ? `Jawaban "${t}" tidak dikenal. Ketik ${lewat ? '' : 'Y, '}N, atau U lalu Enter.` : `Ketik ${lewat ? '' : 'Y, '}N, atau U lalu Enter.`);
    }
  }
}

module.exports = { buatPenanya, konfirmasiYN, wizardAcuan, bacaGender, bacaKualitas };
