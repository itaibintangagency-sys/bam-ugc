'use strict';
const test = require('node:test');
const assert = require('node:assert');
const core = require('../src');

const profile = { base_voice: 'Aoede', gender: 'perempuan', usia: 'muda', nada: 'hangat', energi: 'sedang', tempo: 'normal',
  gaya: 'ramah_teman', aksen: 'indonesia_netral', bahasa: 'semi_santai', suasana: 'senyum_terdengar', jeda: 'natural', napas_awal: true };

test('suara: contoh dari tabel menghasilkan teks performa bahasa Inggris yang ringkas', () => {
  const t = core.buildVoicePerformance(profile);
  for (const frag of ['Woman who sounds young adult, around 23 to 29 years old', 'Warm timbre', 'Medium energy, normal pace', 'Speaks like a friend recommending something', 'Neutral Indonesian accent, semi-casual register']) {
    assert.ok(t.includes(frag), frag + ' <= ' + t);
  }
  assert.ok(t.length < 400, 'panjang ' + t.length);
  assert.ok(!/ruang|room|reverb/i.test(t), 'ruang rekam bukan bagian identitas');
  assert.ok(!/smile|breath/i.test(t), 'suasana dan napas bukan bagian identitas');
});

test('suara: semua pilihan pada tabel punya padanan Inggris', () => {
  for (const [field, map] of Object.entries(core.OPT)) {
    assert.ok(Object.keys(map).length >= 2, field);
    for (const [k, v] of Object.entries(map)) assert.ok(typeof v === 'string' && v.length > 2, `${field}.${k}`);
  }
  assert.strictEqual(Object.keys(core.OPT.gaya).length, 5);
  assert.strictEqual(Object.keys(core.OPT.aksen).length, 4);
  assert.strictEqual(Object.keys(core.OPT.nada).length, 6);
});

test('suara: validasi menolak nilai kosong, nilai asing, dan jenis kelamin tidak cocok', () => {
  assert.ok(core.validateVoiceProfile({}).some(i => i.field === 'base_voice'));
  assert.ok(core.validateVoiceProfile({ ...profile, nada: 'galak' }).some(i => i.field === 'nada' && i.level === 'error'));
  const g = core.validateVoiceProfile({ ...profile, base_voice: 'Charon' });
  assert.ok(g.some(i => i.field === 'base_voice' && i.level === 'error' && /laki-laki/.test(i.msg)));
  const unknown = core.validateVoiceProfile({ ...profile, base_voice: 'Zeta' });
  assert.ok(unknown.every(i => i.level === 'warn') && unknown.length === 1, 'suara di luar daftar hanya peringatan');
  assert.throws(() => core.buildVoicePerformance({ ...profile, base_voice: 'Charon' }), /tidak valid/);
});

test('suara: arahan per video memuat suasana, napas, jeda, dan ruang rekam dari lokasi', () => {
  const living = core.getSetting('S-01'), car = core.getSetting('S-19'), park = core.getSetting('S-13');
  const a = core.buildVoiceDirection(profile, living), b = core.buildVoiceDirection(profile, car), c = core.buildVoiceDirection(profile, park);
  assert.match(a, /Audible smile\. A small breath before the first sentence, no filler words\. Natural pauses\./);
  assert.match(a, /light natural reverb/); assert.match(b, /parked car/); assert.match(c, /no room reverb/);
  assert.notStrictEqual(a, b);
  assert.match(core.buildVoiceDirection({ ...profile, napas_awal: false, suasana: 'penasaran', jeda: 'minim' }, living), /^Curious tone\. No filler words\. Minimal pauses\./);
});

test('akustik: ke-24 lokasi punya ruang rekam dan tidak ada yang ganda', () => {
  const all = core.listSettings();
  assert.strictEqual(all.length, 24);
  for (const s of all) assert.ok(s.acoustic && s.acoustic.en && s.acoustic.id, s.id);
  const data = require('../data/acoustics.json').kelompok;
  const ids = Object.values(data).flatMap(g => g.lokasi);
  assert.strictEqual(new Set(ids).size, ids.length, 'tidak ada lokasi di dua kelompok');
});

test('JSON video: ruang rekam otomatis mengikuti lokasi dan penanda karakter muncul satu kali', () => {
  const prof = { photos: [{ role: 'depan' }, { role: 'belakang' }, { role: 'closeup' }], facts: ['Lengan pendek'], colors: [],
    details: ['detail_utama', 'motif_kain', 'lengan_bawahan_hem', 'siluet_panjang'].map(k => ({ slot_key: k, text: k, label: k, confidence: 0.9 })) };
  const mk = (settingId) => JSON.parse(core.buildVideoJson(core.buildPanelPlan({ archetypeId: 'A-01', productProfile: prof, settingId, seed: 5 }),
    { characterCode: 'C02', jobTag: 'x', productProfile: prof, flowCharacterName: 'Sari', voiceProfile: profile }));
  const a = mk('S-01'), b = mk('S-13');
  assert.match(a.audio.recording_space, /light natural reverb/); assert.match(b.audio.recording_space, /no room reverb/);
  assert.match(a.audio.voice_direction, /Recording space:/);
  const raw = JSON.stringify(a);
  assert.strictEqual((raw.match(/@\[Sari\]/g) || []).length, 1);
  assert.deepStrictEqual(core.lintVideoJson(JSON.stringify(a)).filter(i => i.level === 'error'), []);
});

test('perkenalan: JSON 4 detik, satu adegan, ucapan pendek, lolos lint', () => {
  const txt = core.buildIntroJson({ name: 'Sari', code: 'C02', flowCharacterName: 'Sari', voiceProfile: profile, settingId: 'S-20' });
  const o = JSON.parse(txt);
  assert.strictEqual(o.project.duration, 'EXACTLY 4 seconds');
  assert.strictEqual(o.timeline.length, 1);
  assert.strictEqual(o.dialogue.line, 'Hai, aku Sari. Senang kenalan sama kamu!');
  assert.ok(core.wordCount(o.dialogue.line) <= 8);
  assert.strictEqual(o.dialogue.timing.must_finish_before, '3.2 seconds');
  assert.strictEqual((txt.match(/@\[Sari\]/g) || []).length, 1);
  assert.match(o.audio.recording_space, /Dry, almost reverb-free/);
  assert.deepStrictEqual(core.lintStoryboardText(JSON.stringify(o)).filter(i => i.level === 'error' && !['sticker', 'banner', 'label'].includes(i.word)), []);
  for (const w of ['tiktok', 'promo', 'keranjang', 'affiliate']) assert.ok(!txt.toLowerCase().includes(w), w);
});

test('perkenalan: menolak ucapan terlalu panjang, nama Flow bermasalah, dan lokasi asing', () => {
  const base = { name: 'Sari', flowCharacterName: 'Sari' };
  assert.throws(() => core.buildIntroJson({ ...base, line: 'Halo semuanya perkenalkan nama saya Sari dan saya senang sekali bertemu' }), /maksimal 8 kata/);
  assert.throws(() => core.buildIntroJson({ name: 'Sari' }), /flowCharacterName/);
  assert.throws(() => core.buildIntroJson({ ...base, flowCharacterName: 'Sa[ri]' }), /kurung/);
  assert.throws(() => core.buildIntroJson({ ...base, settingId: 'S-99' }), /tidak dikenal/);
});

test('suara: satu karakter satu suara kecuali disetujui', () => {
  const others = [{ voice_base: 'aoede', voice_shared_ok: false }, { voice_base: 'Achird', voice_shared_ok: false }, { voice_base: 'Despina', voice_shared_ok: true }];
  assert.strictEqual(core.voiceConflicts({ base_voice: 'Aoede' }, others).length, 1);
  assert.strictEqual(core.voiceConflicts({ base_voice: 'Despina' }, others).length, 0, 'yang sudah disetujui berbagi tidak dihitung');
  assert.strictEqual(core.voiceConflicts({ base_voice: 'Autonoe' }, others).length, 0);
});
