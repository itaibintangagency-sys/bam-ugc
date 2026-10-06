'use strict';
// Empat skenario uji foto acuan, dan lembar penilaian yang diisi oleh manusia. Semua DNA divalidasi oleh core (hanya dewasa).
const core = require('../../../core/src');

const DNA_PEREMPUAN = { gender: 'perempuan', age_group: 'dewasa_muda', face_shape: 'oval', complexion: 'terang', expression: 'ceria', hair_length: 'panjang', hair_texture: 'bergelombang', hair_color: 'cokelat_muda_karamel', parting: 'tengah' };
const DNA_LAKI = { gender: 'laki-laki', age_group: 'dewasa', face_shape: 'persegi', complexion: 'sawo_matang', expression: 'kalem', hair_length: 'pendek', hair_texture: 'lurus', hair_color: 'hitam' };
const base = g => ({ ...(g === 'laki-laki' ? DNA_LAKI : DNA_PEREMPUAN) });

// g = jenis kelamin orang di foto acuan.
function skenarioAcuan(g = 'perempuan') {
  if (!['perempuan', 'laki-laki'].includes(g)) throw new Error('--gender-acuan harus perempuan atau laki-laki.');
  const lain = g === 'perempuan' ? 'laki-laki' : 'perempuan';
  const orangTua = g === 'perempuan'
    ? { relation: 'ibu', note: 'ibu dari orang di foto', dna: { ...DNA_PEREMPUAN, age_group: 'matang', hair_length: 'sebahu', hair_color: 'hitam', parting: undefined, expression: 'kalem' } }
    : { relation: 'ayah', note: 'ayah dari orang di foto', dna: { ...DNA_LAKI, age_group: 'matang', beard: 'janggut_tipis', expression: 'kalem' } };
  const lis = [
    { kode: 'S1', judul: 'Orang yang sama', relation: 'orang_sama', note: '', dna: base(g), harapan: 'Wajahnya dikenali sebagai orang di foto.' },
    { kode: 'S2', judul: `Kakak ${lain}`, relation: 'kakak', note: `kakak ${lain}`, dna: { ...base(lain), age_group: 'dewasa' }, harapan: `${lain === 'laki-laki' ? 'Laki-laki' : 'Perempuan'} dewasa dengan kemiripan keluarga, bukan orang di foto.` },
    { kode: 'S3', judul: 'Mirip, bukan orang yang sama', relation: 'mirip_bukan_sama', note: 'mirip tapi bukan orang yang sama', dna: { ...base(g), age_group: 'muda', face_shape: 'bulat', hair_length: 'sebahu', hair_color: g === 'perempuan' ? 'hitam' : 'cokelat_tua', parting: undefined }, harapan: 'Mirip secara umum, tetapi jelas orang lain.' },
    { kode: 'S4', judul: g === 'perempuan' ? 'Ibu' : 'Ayah', relation: orangTua.relation, note: orangTua.note, dna: orangTua.dna, harapan: 'Kemiripan keluarga dengan usia lebih tua.' }
  ];
  for (const s of lis) {
    for (const k of Object.keys(s.dna)) if (s.dna[k] === undefined) delete s.dna[k];
    const bad = [...core.validateDna(s.dna), ...core.validateReference({ relation: s.relation, note: s.note }, s.dna)];
    if (bad.length) throw new Error(`Skenario ${s.kode} tidak valid: ${bad.map(b => b.msg).join('; ')}`);
  }
  return lis;
}

// ───────────── Pilihan satu hubungan (layar pilihan menu 6) ─────────────
// gender: 'foto' = sama dengan orang di foto; 'perempuan' = ditentukan hubungan; null = WAJIB dipilih pengguna.
const MENU_HUBUNGAN = [
  { no: 1, kunci: 'orang_sama', label: 'Orang yang sama', kode: 'S1', gender: 'foto' },
  { no: 2, kunci: 'kakak', label: 'Kakak', kode: 'S2', gender: null },
  { no: 3, kunci: 'adik', label: 'Adik', kode: 'S5', gender: null },
  { no: 4, kunci: 'ibu', label: 'Ibu', kode: 'S4', gender: 'perempuan' },
  { no: 5, kunci: 'mirip_bukan_sama', label: 'Mirip saja (bukan orang yang sama)', kode: 'S3', gender: null }
];
const USIA = { dewasa_muda: '20-an awal', muda: '20-an akhir', dewasa: '30-an', matang: '40-an' };

// genderFoto = jenis kelamin orang di foto; genderHasil = jenis kelamin orang yang DIBUAT (wajib untuk kakak, adik, mirip).
function buatKarakter({ genderFoto, hubungan, genderHasil }) {
  if (!['perempuan', 'laki-laki'].includes(genderFoto)) throw new Error('Jenis kelamin orang di foto harus perempuan atau laki-laki.');
  const m = MENU_HUBUNGAN.find(x => x.kunci === hubungan); if (!m) throw new Error(`Hubungan "${hubungan}" tidak dikenal. Pilihan: ${MENU_HUBUNGAN.map(x => x.kunci).join(', ')}.`);
  const gh = m.gender === 'foto' ? genderFoto : m.gender === 'perempuan' ? 'perempuan' : genderHasil;
  if (!['perempuan', 'laki-laki'].includes(gh)) throw new Error(`Hubungan "${m.label}" butuh jenis kelamin hasil: pilih perempuan atau laki-laki.`);
  let dna, note = '', harapan, judul = m.label;
  if (hubungan === 'orang_sama') { dna = base(genderFoto); harapan = 'Wajahnya dikenali sebagai orang di foto.'; }
  else if (hubungan === 'kakak') { dna = { ...base(gh), age_group: 'dewasa' }; note = `kakak ${gh}`; judul = `Kakak ${gh}`; harapan = `${gh === 'laki-laki' ? 'Laki-laki' : 'Perempuan'} dewasa dengan kemiripan keluarga, bukan orang di foto.`; }
  else if (hubungan === 'adik') { dna = { ...base(gh), age_group: 'dewasa_muda' }; note = `adik ${gh}`; judul = `Adik ${gh}`; harapan = `${gh === 'laki-laki' ? 'Laki-laki' : 'Perempuan'} dewasa dengan kemiripan keluarga, tampak lebih muda, bukan orang di foto.`; }
  else if (hubungan === 'ibu') { dna = { ...DNA_PEREMPUAN, age_group: 'matang', hair_length: 'sebahu', hair_color: 'hitam', expression: 'kalem' }; delete dna.parting; note = 'ibu dari orang di foto'; harapan = 'Kemiripan keluarga dengan usia lebih tua.'; }
  else { dna = { ...base(gh), age_group: 'muda', face_shape: 'bulat', hair_length: gh === 'perempuan' ? 'sebahu' : 'pendek', hair_color: gh === 'perempuan' ? 'hitam' : 'cokelat_tua' }; delete dna.parting; note = 'mirip tapi bukan orang yang sama'; judul = 'Mirip, bukan orang yang sama'; harapan = 'Mirip secara umum, tetapi jelas orang lain.'; }
  const bad = [...core.validateDna(dna), ...core.validateReference({ relation: hubungan, note }, dna)];
  if (bad.length) throw new Error(`Pilihan tidak valid: ${bad.map(b => b.msg).join('; ')}`);
  return { kode: m.kode, judul, relation: hubungan, note, dna, harapan, genderHasil: gh, usia: USIA[dna.age_group] };
}

// Peringatan konflik catatan lawan DNA ada di core (dipakai juga oleh website).
const { peringatanKonflik } = core;

const PERTANYAAN = ['1 Sesuai DNA (kelamin, usia, rambut)', '2 Ada kemiripan dengan foto acuan', '3 Bukan salinan foto acuan', '4 Dewasa, tanpa tulisan atau cacat', '5 Wajah cukup jelas untuk dipakai'];
// Lembar penilaian: satu baris per gambar yang berhasil dibuat. Diisi dengan tanda x pada kolom yang YA.
function lembarPenilaian(rows, jumlahPerSkenario) {
  const ok = rows.filter(r => r.status === 'ok' && r.skenario);
  const satu = new Set(rows.filter(r => r.skenario).map(r => r.skenario)).size === 1;
  const baris = ok.map(r => `| ${r.skenario} | ${r.berkas} | ${r.harapan || ''} | ${PERTANYAAN.map(() => '[ ]').join(' | ')} | |`);
  return [
    '# Lembar penilaian uji foto acuan', '',
    'Buka tiap gambar di folder ini, lalu beri tanda **x** di dalam kurung untuk jawaban YA. Kolom 3 hanya relevan bila Anda tidak menguji skenario "Orang yang sama".', '',
    `| Skenario | Berkas | Yang diharapkan | ${PERTANYAAN.join(' | ')} | Catatan |`, `|---|---|---|${PERTANYAAN.map(() => '---').join('|')}|---|`, ...baris, '',
    '## Cara membaca hasilnya', '',
    ...(satu ? [
      `- Hanya satu skenario yang diuji (${jumlahPerSkenario} gambar). **Lulus** bila minimal satu gambar menjawab YA pada pertanyaan 1, 2, 4, dan 5 (dan 3 bila bukan "Orang yang sama").`,
      '- Satu skenario belum cukup untuk memutuskan rancangan website. Uji juga "Orang yang sama" dan "Mirip saja" dengan foto yang sama.'
    ] : [
      `- Tiap skenario dibuat ${jumlahPerSkenario} gambar. **Skenario lulus** bila minimal satu gambar menjawab YA pada pertanyaan 1, 2, 4, dan 5 (dan 3 untuk skenario selain "Orang yang sama").`,
      '- Semua skenario lulus: rancangan foto acuan layak dibangun penuh di website.',
      '- S2 (kakak lawan jenis) gagal, tetapi S1 dan S3 lulus: rancangan tetap jalan tanpa hubungan keluarga lintas jenis kelamin.',
      '- S1 dan S3 gagal: foto acuan tidak berguna sebagai bahan kemiripan. Rancangan diubah menjadi DNA saja.'
    ]), ''
  ].join('\n');
}
module.exports = { skenarioAcuan, lembarPenilaian, PERTANYAAN, DNA_PEREMPUAN, DNA_LAKI, MENU_HUBUNGAN, buatKarakter, peringatanKonflik };
