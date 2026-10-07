'use strict';
// Profil produk: slot per arketipe, validasi (aturan planner dan lint), prompt analisis AI, normalisasi hasil AI, dan keterpaduan dengan planner sungguhan.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src');
const KATA = require('../data/kata_terlarang.json');
const lint = require('../src/lint');

const DETAIL_A01 = [
  { slot_key: 'detail_utama', text: 'kerah bulat dengan resleting depan', text_en: 'round neckline with a front zipper', label: 'kerah', confidence: 0.9 },
  { slot_key: 'motif_kain', text: 'motif bunga pastel', text_en: 'gray base with a soft pastel floral print', label: 'motif', confidence: 0.85 },
  { slot_key: 'lengan_bawahan_hem', text: 'lengan pendek', text_en: 'short sleeves', label: 'lengan', confidence: 0.8 },
  { slot_key: 'siluet_panjang', text: 'panjang midi', text_en: 'midi length', label: 'panjang', confidence: 0.75 }
];
const PROFIL = (over = {}) => ({ facts: ['Warna dasar abu'], facts_en: ['Gray base with a pastel floral print'], colors: ['light gray'], details: DETAIL_A01.map(d => ({ ...d })), ...over });
const msgs = (v, a = 'A-01', roles = ['depan']) => v.issues.filter(i => i.level === 'error').map(i => `${i.field}: ${i.msg}`);

test('daftar kata terlarang: lint dan profil produk membaca satu sumber yang sama', () => {
  assert.deepEqual(lint.CLAIM_WORDS, KATA.claim_words); assert.deepEqual(lint.BANNED_ALWAYS, KATA.banned_always); assert.deepEqual(lint.INDO_HINT, KATA.indo_hint);
  for (const w of KATA.claim_words) assert.ok(core.masalahTeksId(`produk ${w} sekali`).length, w);
  assert.ok(lint.lintStoryboardText('kain nyaman').some(i => i.word === 'nyaman'));
});

test('slot per arketipe: 15 arketipe, tiap arketipe punya minimal 3 slot, hasil berupa salinan, kunci prototipe ditolak', () => {
  for (let i = 1; i <= 15; i++) { const id = `A-${String(i).padStart(2, '0')}`; const s = core.slotsFor(id); assert.ok(s && s.length >= 3, id); for (const x of s) assert.ok(x.key && x.nama, id); }
  assert.deepEqual(core.slotsFor('A-01').map(s => s.key), ['detail_utama', 'motif_kain', 'lengan_bawahan_hem', 'siluet_panjang']);
  for (const bad of ['A-99', 'constructor', '__proto__', '', null, undefined]) assert.equal(core.slotsFor(bad), null, String(bad));
  const a = core.slotsFor('A-05'); a[0].key = 'rusak'; a.pop(); assert.equal(core.slotsFor('A-05')[0].key, 'kemasan_label'); assert.equal(core.slotsFor('A-05').length, 4);
});

test('peran foto: 12 peran bernama; peran tambahan hanya muncul untuk arketipe yang menuntutnya; setiap peran yang dituntut slot ada di daftar', () => {
  assert.equal(core.ROLES.length, 12); for (const r of core.ROLES) assert.ok(core.LABEL_ROLE[r], r);
  assert.deepEqual(core.peranUntuk('A-01'), core.ROLES_DASAR); assert.ok(core.peranUntuk('A-03').includes('sol')); assert.ok(!core.peranUntuk('A-01').includes('sol'));
  assert.ok(core.peranUntuk('A-08').includes('izin_klien')); assert.ok(core.ROLES_BUKAN_PRODUK.includes('izin_klien'));
  for (let i = 1; i <= 15; i++) { const id = `A-${String(i).padStart(2, '0')}`; for (const s of core.slotsFor(id)) for (const r of s.butuh_foto) assert.ok(core.peranUntuk(id).includes(r), `${id}.${s.key} butuh ${r}`); }
  assert.equal(core.peranUntuk('nope'), null);
});

test('validateProfile: profil lengkap A-01 siap; tiap pelanggaran aturan planner dan lint dilaporkan sebagai galat dengan pesan awam', () => {
  const ok = core.validateProfile(PROFIL(), 'A-01', ['depan', 'closeup']); assert.equal(ok.ready, true, JSON.stringify(ok.issues)); assert.equal(ok.usable.length, 4); assert.deepEqual(msgs(ok), []);
  assert.deepEqual(ok.slots.map(s => [s.key, s.terisi, s.dipakai]), [['detail_utama', true, true], ['motif_kain', true, true], ['lengan_bawahan_hem', true, true], ['siluet_panjang', true, true]]);
  const kasus = [
    ['kurang dari 3 slot', PROFIL({ details: DETAIL_A01.slice(0, 2) }), /Baru 2 slot.*minimal 3/],
    ['tanpa foto', PROFIL(), /Belum ada foto/, []],
    ['slot bukan milik arketipe', PROFIL({ details: [...DETAIL_A01, { slot_key: 'sol', text: 'a', text_en: 'b' }] }), /bukan milik arketipe A-01/],
    ['slot ganda', PROFIL({ details: [...DETAIL_A01, { ...DETAIL_A01[0] }] }), /terisi dua kali/],
    ['teks Inggris kosong', PROFIL({ details: [{ ...DETAIL_A01[0], text_en: '' }, ...DETAIL_A01.slice(1)] }), /teks Inggris wajib/],
    ['teks Indonesia kosong', PROFIL({ details: [{ ...DETAIL_A01[0], text: '  ' }, ...DETAIL_A01.slice(1)] }), /teks Indonesia kosong/],
    ['kata Indonesia di teks Inggris', PROFIL({ details: [{ ...DETAIL_A01[0], text_en: 'kerah bulat dengan resleting' }, ...DETAIL_A01.slice(1)] }), /memuat kata Indonesia/],
    ['kata klaim di teks Indonesia', PROFIL({ details: [{ ...DETAIL_A01[0], text: 'kain nyaman dan premium' }, ...DETAIL_A01.slice(1)] }), /kata klaim.*nyaman, premium/],
    ['kata pemicu di teks Inggris', PROFIL({ details: [{ ...DETAIL_A01[0], text_en: 'big promo print' }, ...DETAIL_A01.slice(1)] }), /kata pemicu: promo/],
    ['keyakinan di luar 0 sampai 1', PROFIL({ details: [{ ...DETAIL_A01[0], confidence: 1.5 }, ...DETAIL_A01.slice(1)] }), /keyakinan harus 0 sampai 1/],
    ['fakta Inggris berbahasa Indonesia', PROFIL({ facts_en: ['Warna dasar abu dengan motif'] }), /facts_en\[0\]: memuat kata Indonesia|memuat kata Indonesia/],
    ['warna berbahasa Indonesia', PROFIL({ colors: ['warna abu yang cerah'] }), /memuat kata Indonesia/],
    ['fakta Indonesia berklaim', PROFIL({ facts: ['Bahan adem dan awet'] }), /kata klaim/],
    ['terlalu banyak fakta', PROFIL({ facts_en: Array(9).fill('gray') }), /maksimal 8 butir/],
    ['details bukan daftar', PROFIL({ details: 'x' }), /harus berupa daftar/]
  ];
  for (const [nama, p, pola, roles = ['depan']] of kasus) { const v = core.validateProfile(p, 'A-01', roles); assert.equal(v.ready, false, nama); assert.match(msgs(v).join(' | '), pola, nama); }
  assert.match(msgs(core.validateProfile(PROFIL(), 'A-01', ['depan', 'aneh'])).join(), /peran foto "aneh" tidak dikenal/);
  assert.match(msgs(core.validateProfile(PROFIL(), 'A-01', Array(7).fill('depan'))).join(), /maksimal 6 foto/);
  assert.match(msgs(core.validateProfile(PROFIL(), 'A-99', ['depan'])).join(), /arketipe "A-99" tidak dikenal/);
  for (const bad of [null, undefined, 5, 'x', []]) assert.doesNotThrow(() => core.validateProfile(bad, 'A-01', ['depan']));
});

test('validateProfile: keyakinan di bawah 0,6 hanya peringatan dan tidak dihitung; slot yang butuh peran foto tidak dihitung tanpa foto itu', () => {
  const rendah = PROFIL({ details: DETAIL_A01.map((d, i) => (i === 0 ? { ...d, confidence: 0.5 } : d)) });
  let v = core.validateProfile(rendah, 'A-01', ['depan']); assert.equal(v.usable.length, 3); assert.equal(v.ready, true); assert.ok(v.issues.some(i => i.level === 'warn' && /di bawah 0.6/.test(i.msg)));
  v = core.validateProfile(PROFIL({ details: DETAIL_A01.slice(0, 2).map(d => ({ ...d, confidence: 0.4 })).concat(DETAIL_A01.slice(2, 3)) }), 'A-01', ['depan']); assert.equal(v.ready, false);
  const A05 = { facts: [], facts_en: [], colors: [], details: [
    { slot_key: 'kemasan_label', text: 'kemasan botol putih', text_en: 'white bottle packaging', confidence: 0.9 },
    { slot_key: 'tekstur_warna', text: 'warna krem', text_en: 'cream colored product', confidence: 0.9 },
    { slot_key: 'cara_pakai', text: 'dituang ke telapak', text_en: 'poured into the palm', confidence: 0.9 }
  ] };
  v = core.validateProfile(A05, 'A-05', ['depan']); assert.equal(v.ready, false); assert.deepEqual(v.usable, ['kemasan_label', 'cara_pakai']); assert.ok(v.issues.some(i => i.level === 'warn' && /butuh foto berperan Tekstur/.test(i.msg)));
  assert.deepEqual(v.slots.find(s => s.key === 'tekstur_warna'), { key: 'tekstur_warna', nama: 'Tekstur atau warna produk (yang terlihat)', butuh_foto: ['tekstur'], fotoOk: false, terisi: true, dipakai: false });
  v = core.validateProfile(A05, 'A-05', ['depan', 'tekstur']); assert.equal(v.ready, true); assert.equal(v.usable.length, 3);
});

test('keterpaduan dengan planner: profil yang dinyatakan siap benar-benar menghasilkan rencana 5 panel; yang tidak siap ditolak planner juga', () => {
  const row = { photos: [{ path: 'p/1.jpg', role: 'depan' }, { path: 'p/2.jpg', role: 'closeup' }], profile: PROFIL() };
  const pp = core.profilUntukPlanner(row); assert.deepEqual(pp.photos, [{ role: 'depan' }, { role: 'closeup' }]);
  assert.equal(core.validateProfile(row.profile, 'A-01', row.photos.map(p => p.role)).ready, true);
  const plan = core.buildPanelPlan({ archetypeId: 'A-01', productProfile: pp, settingId: 'S-01', seed: 9 }); assert.ok(!plan.error && !plan.habis, JSON.stringify(plan).slice(0, 200)); assert.equal(plan.panels.length, 5);
  const sedikit = { photos: row.photos, profile: PROFIL({ details: DETAIL_A01.slice(0, 2) }) };
  assert.equal(core.validateProfile(sedikit.profile, 'A-01', ['depan']).ready, false); assert.match(core.buildPanelPlan({ archetypeId: 'A-01', productProfile: core.profilUntukPlanner(sedikit), settingId: 'S-01', seed: 9 }).error, /kurang dari 3/);
  const A05 = { photos: [{ path: 'x', role: 'depan' }], profile: { details: [
    { slot_key: 'kemasan_label', text: 'kemasan botol', text_en: 'white bottle', confidence: 0.9 }, { slot_key: 'tekstur_warna', text: 'warna krem', text_en: 'cream colored', confidence: 0.9 }, { slot_key: 'cara_pakai', text: 'dituang', text_en: 'poured', confidence: 0.9 }] } };
  assert.equal(core.validateProfile(A05.profile, 'A-05', ['depan']).ready, false); assert.ok(core.buildPanelPlan({ archetypeId: 'A-05', productProfile: core.profilUntukPlanner(A05), settingId: 'S-01', seed: 9 }).error, 'planner juga menolak tanpa foto tekstur');
  A05.photos.push({ path: 'y', role: 'tekstur' }); assert.equal(core.validateProfile(A05.profile, 'A-05', ['depan', 'tekstur']).ready, true); assert.ok(!core.buildPanelPlan({ archetypeId: 'A-05', productProfile: core.profilUntukPlanner(A05), settingId: 'S-01', seed: 9 }).error);
  assert.deepEqual(core.profilUntukPlanner({}), { photos: [], facts: [], facts_en: [], colors: [], details: [] }); assert.deepEqual(core.profilUntukPlanner(null).photos, []);
});

test('prompt analisis: format JSON, slot arketipe dan syarat foto, urutan foto, daftar kata terlarang; peran bukan produk tidak dikirim; masukan salah ditolak', () => {
  const m = core.buildAnalysisMessages({ archetypeId: 'A-05', kategori: 'Kecantikan > Perawatan Wajah > Serum', roles: ['depan', 'tekstur'] });
  assert.match(m.system, /ONE JSON object/); assert.match(m.system, /"fakta_id".*"fakta_en".*"warna".*"detail".*"peringatan"/s); for (const w of KATA.claim_words.concat(KATA.banned_always)) assert.ok(m.system.includes(w), w);
  assert.match(m.system, /Never invent features/); assert.match(m.system, /No brand names, prices/);
  for (const s of core.slotsFor('A-05')) assert.ok(m.user.includes(`"${s.key}"`), s.key); assert.match(m.user, /"tekstur_warna".*hanya bila ada foto berperan: tekstur/); assert.match(m.user, /Foto 1: peran "depan"\nFoto 2: peran "tekstur"/); assert.match(m.user, /Kategori produk .*Serum/);
  const tanpaIzin = core.buildAnalysisMessages({ archetypeId: 'A-08', roles: ['depan', 'izin_klien', 'closeup'] }); assert.match(tanpaIzin.user, /Foto 1: peran "depan"\nFoto 2: peran "closeup"/); assert.ok(!/izin_klien"/.test(tanpaIzin.user.split('Foto terlampir')[1]));
  assert.doesNotMatch(core.buildAnalysisMessages({ archetypeId: 'A-01', roles: ['depan'] }).user, /Kategori produk/);
  assert.ok(core.buildAnalysisMessages({ archetypeId: 'A-01', kategori: 'x'.repeat(500), roles: ['depan'] }).user.length < 1500, 'kategori dipotong');
  assert.throws(() => core.buildAnalysisMessages({ archetypeId: 'A-99', roles: ['depan'] }), /tidak dikenal/); assert.throws(() => core.buildAnalysisMessages({ archetypeId: 'A-01', roles: [] }), /tidak ada foto produk/);
  assert.throws(() => core.buildAnalysisMessages({ archetypeId: 'A-01', roles: ['izin_klien'] }), /tidak ada foto produk/); assert.throws(() => core.buildAnalysisMessages({ archetypeId: 'A-01', roles: ['aneh'] }), /peran foto tidak valid/); assert.throws(() => core.buildAnalysisMessages({ archetypeId: 'A-01', roles: Array(7).fill('depan') }), /peran foto tidak valid/);
  assert.deepEqual(core.RESPONSE_FORMAT, { type: 'json_object' });
});

const AI_BAIK = { fakta_id: ['Warna dasar abu'], fakta_en: ['Gray base with a pastel floral print'], warna: ['light gray'], detail: [
  { slot: 'detail_utama', teks_id: 'kerah bulat dengan resleting depan', teks_en: 'round neckline with a front zipper', label: 'kerah', keyakinan: 0.9 },
  { slot: 'motif_kain', teks_id: 'motif bunga pastel', teks_en: 'soft pastel floral print', label: 'motif', keyakinan: 0.8 },
  { slot: 'lengan_bawahan_hem', teks_id: 'lengan pendek', teks_en: 'short sleeves', label: 'lengan', keyakinan: 0.7 }], peringatan: ['Foto belakang tidak ada'] };

test('normalizeAnalysis: jawaban baik menjadi profil siap; JSON berpagar kode dan teks di sekitarnya tetap terbaca; bentuk disesuaikan dengan planner', () => {
  for (const raw of [AI_BAIK, JSON.stringify(AI_BAIK), '```json\n' + JSON.stringify(AI_BAIK) + '\n```', 'Berikut hasilnya:\n' + JSON.stringify(AI_BAIK) + '\nSemoga membantu.']) {
    const r = core.normalizeAnalysis(raw, { archetypeId: 'A-01', roles: ['depan'] }); assert.equal(r.ok, true); assert.equal(r.ready, true, JSON.stringify(r.issues));
    assert.deepEqual(r.profile.details[0], { slot_key: 'detail_utama', text: 'kerah bulat dengan resleting depan', text_en: 'round neckline with a front zipper', label: 'kerah', confidence: 0.9 });
    assert.deepEqual(Object.keys(r.profile).sort(), ['colors', 'details', 'facts', 'facts_en']); assert.deepEqual(r.catatan, ['Foto belakang tidak ada']); assert.equal(r.usable.length, 3);
  }
  const plan = core.buildPanelPlan({ archetypeId: 'A-01', productProfile: core.profilUntukPlanner({ photos: [{ role: 'depan' }], profile: core.normalizeAnalysis(AI_BAIK, { archetypeId: 'A-01', roles: ['depan'] }).profile }), settingId: 'S-01', seed: 3 }); assert.ok(!plan.error, JSON.stringify(plan).slice(0, 200));
});

test('normalizeAnalysis: slot asing dan ganda dibuang dan dilaporkan; keyakinan dijepit 0..1 atau bawaan 0,7; label kosong memakai kunci slot; teks dibersihkan dan dipotong', () => {
  const raw = { fakta_id: [' a ', '', 5, 'b'], fakta_en: Array(12).fill('gray'), warna: ['  light gray  '], detail: [
    { slot: 'detail_utama', teks_id: '  kerah\n\tbulat  ', teks_en: 'round neckline', keyakinan: 7 },
    { slot: 'detail_utama', teks_id: 'dobel', teks_en: 'double' },
    { slot: 'sol', teks_id: 'sol', teks_en: 'sole' }, { slot: 'motif_kain', teks_id: 'motif', teks_en: 'print', keyakinan: -3 },
    { slot: 'lengan_bawahan_hem', teks_id: 'lengan', teks_en: 'sleeves', keyakinan: 'abc' }, { slot: 'siluet_panjang', teks_id: 'x'.repeat(300), teks_en: 'long', label: 'y'.repeat(99) }, 'bukan objek', null] };
  const r = core.normalizeAnalysis(raw, { archetypeId: 'A-01', roles: ['depan'] });
  assert.equal(r.profile.facts_en.length, 8); assert.deepEqual(r.profile.facts, ['a', '5', 'b']); assert.deepEqual(r.profile.colors, ['light gray']);
  const by = Object.fromEntries(r.profile.details.map(d => [d.slot_key, d])); assert.equal(by.detail_utama.text, 'kerah bulat'); assert.equal(by.detail_utama.confidence, 1); assert.equal(by.detail_utama.label, 'detail_utama'); assert.equal(by.motif_kain.confidence, 0); assert.equal(by.lengan_bawahan_hem.confidence, 0.7);
  assert.equal(by.siluet_panjang.text.length, 140); assert.equal(by.siluet_panjang.label.length, 40); assert.equal(r.profile.details.length, 4);
  assert.ok(r.dibuang.some(x => /"sol" bukan milik arketipe A-01/.test(x)) && r.dibuang.some(x => /muncul lagi/.test(x)) && r.dibuang.filter(x => /bukan objek/.test(x)).length === 2);
});

test('normalizeAnalysis: kata klaim dan kata Indonesia dari AI tidak lolos diam-diam (menjadi galat), dan tidak pernah melempar untuk jawaban acak', () => {
  const buruk = { ...AI_BAIK, detail: [{ ...AI_BAIK.detail[0], teks_id: 'kerah nyaman', teks_en: 'kerah bulat dengan resleting' }, ...AI_BAIK.detail.slice(1)] };
  const r = core.normalizeAnalysis(buruk, { archetypeId: 'A-01', roles: ['depan'] }); assert.equal(r.ready, false); const e = msgs(r).join(' | '); assert.match(e, /kata klaim.*nyaman/); assert.match(e, /kata Indonesia/);
  for (const raw of [null, undefined, '', '   ', 'bukan json', '[1,2]', '"teks"', 5, true, '{', '{"detail": "x"}', '{"detail": [1,[2]], "fakta_id": "x", "warna": {"a":1}}', '```', { detail: null }, []]) assert.doesNotThrow(() => core.normalizeAnalysis(raw, { archetypeId: 'A-01', roles: ['depan'] }), String(raw));
  for (const raw of [null, '', 'bukan json', '[1,2]', 5]) { const x = core.normalizeAnalysis(raw, { archetypeId: 'A-01', roles: ['depan'] }); assert.equal(x.ok, false); assert.equal(x.ready, false); assert.match(x.galat, /bukan JSON/); }
  assert.equal(core.normalizeAnalysis('{"detail": "x"}', { archetypeId: 'A-01', roles: ['depan'] }).ready, false);
});
