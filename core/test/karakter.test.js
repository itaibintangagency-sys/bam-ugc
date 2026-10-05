'use strict';
// JSON video mengikuti karakter (jenis kelamin, usia, hijab) dan jenis storyboard (bertulis atau bersih), dan pemeriksa kesesuaian
// rencana panel → storyboard → JSON diuji otomatis pada empat produk sampel yang sama dengan uji di Flow asli.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src');

const APP_F = 'A young woman in her early twenties with long, wavy, light-brown hair with soft caramel highlights, parted in the middle, a soft oval face, a fair to light complexion, and a bright cheerful smile.';
const APP_M = 'A man in his early thirties with short black hair, a square jaw, a medium brown complexion, and a calm friendly expression.';
const APP_H = 'A woman in her late twenties wearing a plain dusty-pink hijab, a round face, a warm medium complexion, and a gentle smile.';
const CHAR = {
  perempuan: { appearance_en: APP_F, gender: 'perempuan', age_group: 'muda' },
  laki: { appearance_en: APP_M, gender: 'laki-laki', age_group: 'dewasa' },
  hijab: { appearance_en: APP_H, gender: 'perempuan', age_group: 'muda', hijab: true },
  lama: { appearance_en: APP_F }   // bentuk lama: tanpa jenis kelamin
};
const slots = ['detail_utama', 'motif_kain', 'lengan_bawahan_hem', 'siluet_panjang'];
const mkProfile = texts => ({ photos: [{ role: 'depan' }, { role: 'closeup' }], facts: [], facts_en: ['Short sleeves'], colors: [],
  details: slots.map((k, i) => ({ slot_key: k, text: 'x', text_en: texts[i], label: k, confidence: 0.9 })) });
// Empat produk sampel (daster) seperti paket uji v2.3; deskripsi dalam bahasa Inggris
const SAMPLES = {
  'floral abu pastel': mkProfile(['Round neckline with a front zipper', 'Soft floral print on pastel grey fabric', 'Short sleeves and a straight hem', 'Midi length with a relaxed straight silhouette']),
  'hitam-putih geometris': mkProfile(['Round neckline with a small collar', 'Bold black and white geometric print', 'Short sleeves and a plain hem', 'Midi length falling straight from the shoulders']),
  'terracotta': mkProfile(['V-neckline with a soft collar', 'Terracotta batik-style print', 'Short sleeves and a loose hem', 'Midi length with a gently flared silhouette']),
  'tropical floral': mkProfile(['Round neckline with a tie detail', 'Tropical floral print on a light base', 'Short sleeves and a gathered hem', 'Midi length with a soft flowing cut'])
};
const build = (prof, { seed = 9, setting = 'S-01', variant = 'documented', ch = CHAR.perempuan, photo = true, flow = null } = {}) => {
  const plan = core.buildPanelPlan({ archetypeId: 'A-01', productProfile: prof, settingId: setting, seed });
  const storyboardPrompt = core.buildStoryboardPrompt(plan, { variant, characterCode: 'C02', productProfile: prof, images: [{ role: 'depan' }, { role: 'closeup' }] });
  const json = core.buildVideoJson(plan, { characterCode: 'C02', jobTag: 'PRODUCT-01', productProfile: prof, characterProfile: ch, characterPhotoAttached: photo, flowCharacterName: flow, storyboardVariant: variant });
  return { plan, storyboardPrompt, json, o: JSON.parse(json), set: { plan, storyboardPrompt, json, variant, characterProfile: ch, characterPhotoAttached: photo, flowCharacterName: flow } };
};
const prof0 = SAMPLES.terracotta;

test('bentuk lama: tanpa jenis kelamin, kalimat identitas dan suara sama dengan v2.3 (perempuan muda)', () => {
  const { o } = build(prof0, { ch: CHAR.lama });
  assert.match(o.references.character, /^A separate close-up portrait photo of the woman is attached\. It is the ONLY source of her face, complexion, and hair \(color and style\)\. The storyboard document also shows her;/);
  assert.equal(o.dialogue.voice, 'young Indonesian female voice');
  assert.deepEqual(o.character.identity_lock.preserve, ['same face identity', 'same facial proportions', 'same complexion', 'same hairstyle', 'same hair color', 'same apparent age', 'same overall proportions']);
  assert.match(o.references.storyboard, /^The attached storyboard defines the order and timing/);
});

test('karakter laki-laki: tidak ada kata bergender perempuan pada rujukan, kunci identitas, dan suara; usia dewasa', () => {
  const { o } = build(prof0, { ch: CHAR.laki });
  const id = JSON.stringify([o.references.character, o.character.identity_lock, o.dialogue.voice]);
  assert.doesNotMatch(id, /\b(woman|her|she|female)\b/i);
  assert.match(o.references.character, /portrait photo of the man is attached.*ONLY source of his face.*His outfit is only the product/s);
  assert.equal(o.dialogue.voice, 'adult Indonesian male voice');
  const flow = build(prof0, { ch: CHAR.laki, photo: false, flow: 'Raka' }).o;
  assert.match(flow.references.character, /@\[Raka\].*His outfit is NEVER taken from the character/s);
  const nophoto = build(prof0, { ch: CHAR.laki, photo: false }).o;
  assert.match(nophoto.references.character, /^The man shown in the character reference portrait inside the attached storyboard/);
});

test('usia suara mengikuti kelompok usia karakter; tanpa usia memakai "young"', () => {
  for (const [age, word] of [['dewasa_muda', 'young'], ['muda', 'young'], ['dewasa', 'adult'], ['matang', 'mature']]) {
    assert.equal(build(prof0, { ch: { appearance_en: APP_F, gender: 'perempuan', age_group: age } }).o.dialogue.voice, `${word} Indonesian female voice`);
  }
  assert.equal(build(prof0, { ch: { appearance_en: APP_M, gender: 'laki-laki' } }).o.dialogue.voice, 'young Indonesian male voice');
});

test('karakter berhijab: identitas memakai hijab (bukan rambut), dan hijab dijaga kecuali produknya sendiri hijab', () => {
  const { o } = build(prof0, { ch: CHAR.hijab });
  assert.match(o.references.character, /face, complexion, and hijab \(color and style\)/);
  assert.match(o.references.character, /The hijab is part of the identity.*unless the product itself is a hijab/);
  assert.deepEqual(o.character.identity_lock.preserve.filter(x => /hair|hijab/.test(x)), ['same hijab style', 'same hijab color']);
  const nophoto = build(prof0, { ch: CHAR.hijab, photo: false }).o;
  assert.match(nophoto.references.character, /face, complexion, hijab color, and hijab style/);
  assert.doesNotMatch(JSON.stringify(build(prof0, { ch: CHAR.perempuan }).o.references), /hijab/i, 'karakter tanpa hijab tidak menyebut hijab');
});

test('storyboard bersih: JSON menyebut lima panel foto tanpa tulisan dan tidak merujuk "dokumen" atau potret di dalam storyboard', () => {
  for (const [photo, flow] of [[true, null], [false, null], [false, 'Nadia']]) {
    const { o } = build(prof0, { variant: 'clean', photo, flow });
    const refs = JSON.stringify(o.references);
    assert.match(refs, /five photo panels/); assert.match(o.references.storyboard, /contains no text/);
    assert.doesNotMatch(refs, /storyboard document|inside the attached storyboard|character reference portrait/i);
  }
  const doc = build(prof0, { variant: 'documented' }).o;
  assert.match(doc.references.character, /storyboard document also shows/);
});

// ───────────── Uji otomatis: storyboard → JSON pada sampel yang ada ─────────────
test('uji otomatis: 4 produk × 10 seed × 2 jenis storyboard × 4 bentuk karakter × 3 lokasi, nol galat dan nol peringatan bahasa', () => {
  let n = 0; const orders = new Set(); const seen = {};
  for (const [name, prof] of Object.entries(SAMPLES)) for (let seed = 1; seed <= 10; seed++) for (const variant of ['documented', 'clean'])
    for (const [chName, ch] of Object.entries(CHAR)) for (const setting of ['S-01', 'S-02', 'S-07']) {
      const b = build(prof, { seed, variant, ch, setting });
      const r = core.checkPromptSet(b.set); n++;
      assert.deepEqual(r.errors, [], `${name} seed ${seed} ${variant} ${chName} ${setting}: ${r.errors.join(' | ')}`);
      assert.ok(!r.warnings.some(w => /Indonesia/.test(w)), `${name}: ${r.warnings.join(' | ')}`);
      orders.add(r.stats.order); seen[variant] = (seen[variant] || 0) + 1;
      assert.ok(r.stats.json_chars < 13000, `panjang ${r.stats.json_chars}`);
    }
  assert.equal(n, 4 * 10 * 2 * 4 * 3);
  assert.ok(orders.size >= 5, `urutan panel bervariasi: ${orders.size}`);
});

test('uji otomatis (negatif): pemeriksa menangkap ketidakcocokan yang sengaja dibuat', () => {
  const base = build(prof0, { seed: 4, variant: 'clean', ch: CHAR.perempuan });
  const run = (mut, setOver = {}) => { const o = JSON.parse(base.json); mut(o); return core.checkPromptSet({ ...base.set, json: JSON.stringify(o, null, 1), ...setOver }); };
  const has = (r, re) => assert.ok(r.errors.some(e => re.test(e)), `tidak tertangkap ${re}: ${r.errors.join(' | ')} || ${r.warnings.join(' | ')}`);
  has(run(o => { [o.timeline[1].product_focus, o.timeline[2].product_focus] = [o.timeline[2].product_focus, o.timeline[1].product_focus]; }), /product_focus JSON tidak memuat fokus|urutan panel/);
  has(run(o => { o.timeline[1].product_focus = 'A completely unrelated product detail.'; }), /adegan 2: product_focus JSON tidak memuat fokus rencana/);   // hanya pemeriksaan product_focus yang menangkap ini
  has(run(o => { o.timeline[3].product_focus = ''; }), /adegan 4: product_focus JSON tidak memuat fokus rencana/);
  has(run(o => { o.character.appearance = 'Someone else.'; }), /deskripsi penampilan di JSON berbeda/);
  has(run(o => { o.references.character = o.references.character.replace('woman', 'man'); }, {}), /pada rujukan atau suara|laki-laki/);
  has(run(o => { o.dialogue.voice = 'adult Indonesian male voice'; }), /suara dialog .* tidak sesuai/);
  has(run(o => { o.environment.description = 'A neon-lit nightclub.'; }), /lokasi di JSON berbeda/);
  has(run(o => { o.references.storyboard = 'The attached storyboard document defines the order.'; o.references.character += ' The storyboard document also shows her.'; }), /merujuk "dokumen storyboard"|tidak menjelaskan/);
  has(run(o => { o.timeline.pop(); }), /timeline JSON punya 4 adegan/);
  has(run(o => { o.timeline[0].time = '1.0-2.0 seconds'; }), /waktu JSON/);
  has(run(o => { o.dialogue.script_generation.structure['4.0-6.0'] = 'Mention: something else.'; }), /dialog 4.0-6.0 tidak menyebut fokus/);
  // set bertulis memakai JSON bersih dan sebaliknya
  const docSet = build(prof0, { seed: 4, variant: 'documented' });
  has(core.checkPromptSet({ ...docSet.set, variant: 'clean' }), /storyboard "bersih" masih memuat instruksi tulisan|tidak menyatakan larangan/);
  has(core.checkPromptSet({ ...base.set, json: build(prof0, { seed: 4, variant: 'documented' }).json }), /merujuk "dokumen storyboard"|tidak menjelaskan/);
  // karakter hijab dengan JSON non-hijab, dan laki-laki dengan JSON perempuan
  has(core.checkPromptSet({ ...build(prof0, { ch: CHAR.perempuan }).set, characterProfile: CHAR.hijab }), /berhijab|deskripsi penampilan/);
  has(core.checkPromptSet({ ...build(prof0, { ch: { appearance_en: APP_M } }).set, characterProfile: CHAR.laki }), /bergender perempuan|suara dialog/);
  has(core.checkPromptSet({ ...base.set, json: '{bukan json' }), /bukan JSON yang valid/);
  has(core.checkPromptSet({ ...base.set, storyboardPrompt: base.storyboardPrompt.replace(/Panel 3 /, 'Panel X ') }), /tidak memuat panel 3/);
});

test('uji otomatis: kata platform atau promosi di storyboard bersih ditangkap; JSON tetap kecil dan teks tidak mengandung kata Indonesia', () => {
  const b = build(prof0, { variant: 'clean' });
  const r = core.checkPromptSet({ ...b.set, storyboardPrompt: b.storyboardPrompt + '\nTambahkan logo TikTok dan tulisan diskon.' });
  assert.ok(r.errors.length > 0, 'kata platform ditangkap');
  const ok = core.checkPromptSet(b.set); assert.deepEqual(ok.errors, []);
  assert.ok(ok.stats.json_chars > 9000 && ok.stats.json_chars < 13000, String(ok.stats.json_chars));
});

test('pemeriksa kesesuaian: fokus yang saling mengandung (potongan satu sama lain) tidak menimbulkan galat palsu, dan panel yang tertukar di storyboard tetap tertangkap', () => {
  const prof = mkProfile(['V-neckline at the front', 'terracotta brown base with a white abstract print', 'short loose-fitting sleeves', 'white abstract print and the length of the lower dress']);
  for (let seed = 1; seed <= 24; seed++) for (const variant of ['clean', 'documented']) {
    const b = build(prof, { seed, variant });
    assert.deepEqual(core.checkPromptSet(b.set).errors, [], `seed ${seed} ${variant}`);
  }
  // tukar isi panel 2 dan 3 pada teks storyboard bersih: urutan dalam rencana tidak lagi cocok
  const b = build(prof, { seed: 9, variant: 'clean' });
  const lines = b.storyboardPrompt.split('\n'); const i2 = lines.findIndex(l => l.startsWith('Panel 2')), i3 = lines.findIndex(l => l.startsWith('Panel 3'));
  [lines[i2], lines[i3]] = [lines[i3].replace('Panel 3', 'Panel 2'), lines[i2].replace('Panel 2', 'Panel 3')];
  const r = core.checkPromptSet({ ...b.set, storyboardPrompt: lines.join('\n') });
  assert.ok(r.errors.some(e => /storyboard tidak menyebut fokus .* pada panel itu/.test(e)), r.errors.join(' | '));
});
