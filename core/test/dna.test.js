'use strict';
// DNA karakter terstruktur (hanya dewasa), prompt wajah dan lembar, permintaan gambar OpenRouter, dan perbaikan kecil prompt storyboard.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src');

const C02 = { gender: 'perempuan', age_group: 'dewasa_muda', face_shape: 'oval', complexion: 'terang', expression: 'ceria', hair_length: 'panjang', hair_texture: 'bergelombang', hair_color: 'cokelat_muda_karamel', parting: 'tengah' };
const APP_C02 = 'A young woman in her early twenties with long, wavy, light-brown hair with soft caramel highlights, parted in the middle, a soft oval face, a fair to light complexion, and a bright cheerful smile.';
const PRIA = { gender: 'laki-laki', age_group: 'dewasa', face_shape: 'persegi', complexion: 'sawo_matang', expression: 'kalem', hair_length: 'pendek', hair_texture: 'lurus', hair_color: 'hitam', beard: 'janggut_tipis' };
const HIJAB = { gender: 'perempuan', age_group: 'muda', face_shape: 'bulat', complexion: 'kuning_langsat', expression: 'kalem', hijab: true, hijab_style: 'pasmina', hijab_color: 'Dusty Pink', eyes: 'almond' };
const lintOf = t => { const r = core.lintStoryboardText(t); return Array.isArray(r) ? r : (r.issues || []); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('DNA C02 menghasilkan persis kalimat penampilan yang dipakai uji di Flow asli; pria dan berhijab menghasilkan kalimat yang sesuai', () => {
  assert.equal(core.dnaToAppearance(C02), APP_C02);
  assert.equal(core.dnaToAppearance(PRIA), 'A man in his thirties with short, straight, black hair, with light stubble, a square jaw, a warm medium-brown complexion, and a calm gentle smile.');
  assert.equal(core.dnaToAppearance(HIJAB), 'A young woman in her mid to late twenties wearing a dusty pink draped pashmina hijab, a soft round face, almond-shaped dark-brown eyes, a light warm-beige complexion, and a calm gentle smile.');
  assert.deepEqual(core.dnaToProfile(HIJAB), { appearance_en: core.dnaToAppearance(HIJAB), gender: 'perempuan', age_group: 'muda', hijab: true });
  for (const d of [C02, PRIA, HIJAB]) assert.doesNotMatch(core.dnaToAppearance(d), /Indonesian|outfit|\b(girl|boy|teen)/i);
});

test('profil dari DNA masuk ke JSON video: kalimat identitas dan suara mengikuti DNA, dan pemeriksa kesesuaian lolos', () => {
  const prof = { photos: [{ role: 'depan' }, { role: 'closeup' }], facts: [], facts_en: ['Short sleeves'], colors: [], details: ['detail_utama', 'motif_kain', 'lengan_bawahan_hem', 'siluet_panjang'].map((k, i) => ({ slot_key: k, text: 'x', text_en: ['V-neckline', 'White print', 'Loose sleeves', 'Midi length'][i], label: k, confidence: 0.9 })) };
  for (const d of [C02, PRIA, HIJAB]) {
    const plan = core.buildPanelPlan({ archetypeId: 'A-01', productProfile: prof, settingId: 'S-01', seed: 9 });
    const cp = core.dnaToProfile(d);
    const sb = core.buildStoryboardPrompt(plan, { variant: 'clean', characterCode: 'C02', productProfile: prof, images: prof.photos });
    const json = core.buildVideoJson(plan, { characterCode: 'C02', jobTag: 'P', productProfile: prof, characterProfile: cp, characterPhotoAttached: true, storyboardVariant: 'clean' });
    const r = core.checkPromptSet({ plan, storyboardPrompt: sb, json, variant: 'clean', characterProfile: cp, characterPhotoAttached: true });
    assert.deepEqual(r.errors, [], d.gender + ' ' + r.errors.join(' | '));
  }
});

test('hanya dewasa: kelompok usia di bawahnya, kata anak atau remaja, dan "remaja_akhir" pada suara ditolak', () => {
  const bad = (d, field, re) => { const i = core.validateDna(d); assert.ok(i.some(x => x.field === field && re.test(x.msg)), JSON.stringify(i)); };
  bad({ ...C02, age_group: 'remaja_akhir' }, 'age_group', /harus dewasa/);
  bad({ ...C02, age_group: 'anak' }, 'age_group', /harus dewasa/);
  bad({ ...C02, age_group: 'abg' }, 'age_group', /harus dewasa/);
  for (const w of ['a teenage girl look', 'schoolgirl face', 'looks like a kid', 'remaja manis', 'a young boy', 'underage']) bad({ ...C02, distinguishing: w }, 'distinguishing', /menyiratkan anak atau remaja/);
  assert.deepEqual(core.validateDna({ ...C02, distinguishing: 'a small beauty mark near the left cheek' }), []);
  const v = core.validateVoiceProfile({ base_voice: 'Achernar', gender: 'perempuan', usia: 'remaja_akhir', nada: 'cerah', energi: 'sedang', tempo: 'normal', gaya: 'ramah_teman', aksen: 'indonesia_netral', bahasa: 'semi_santai' });
  assert.ok(v.some(i => i.level === 'error' && /remaja_akhir tidak diizinkan/.test(i.msg)));
  assert.deepEqual(core.validateVoiceProfile({ base_voice: 'Achernar', gender: 'perempuan', usia: 'dewasa_muda', nada: 'cerah', energi: 'sedang', tempo: 'normal', gaya: 'ramah_teman', aksen: 'indonesia_netral', bahasa: 'semi_santai' }), []);
  assert.match(core.buildVoicePerformance({ base_voice: 'Achernar', gender: 'perempuan', usia: 'dewasa_muda', nada: 'cerah', energi: 'sedang', tempo: 'normal', gaya: 'ramah_teman', aksen: 'indonesia_netral', bahasa: 'semi_santai' }), /early twenties, around 21 to 24/);
  for (const t of [core.buildFacePrompt(C02, 1), core.buildSheetGridPrompt(C02), core.buildSheetPrompt(C02, 'face_left')]) { assert.match(t, /adult/); assert.doesNotMatch(t, /\b(teen|girl|child|kid|minor|young girl)\b/i); }
});

test('pakaian bukan bagian identitas, hijab hanya perempuan, kolom tidak dikenal ditolak, pilihan wajib', () => {
  const has = (d, field) => assert.ok(core.validateDna(d).some(x => x.field === field), `${field}: ${JSON.stringify(core.validateDna(d))}`);
  has({ ...C02, outfit: 'casual' }, 'outfit'); has({ ...C02, clothing: 'x' }, 'clothing'); has({ ...C02, body_type: 'kurus' }, 'body_type');
  has({ ...HIJAB, gender: 'laki-laki' }, 'hijab'); has({ ...HIJAB, hijab_color: '' }, 'hijab_color'); has({ ...HIJAB, hijab_color: 'pink<script>' }, 'hijab_color');
  has({ ...HIJAB, hair_color: 'hitam' }, 'hair_color'); has({ ...C02, hijab_style: 'pasmina' }, 'hijab');
  has({ ...C02, warna_mata: 'biru' }, 'warna_mata'); has({ ...C02, beard: 'janggut_tipis' }, 'beard');
  has({ ...C02, gender: undefined }, 'gender'); has({ ...C02, face_shape: 'kotak' }, 'face_shape'); has({ ...C02, hair_length: undefined }, 'hair_length');
  has({ ...C02, distinguishing: 'wearing a red dress' }, 'distinguishing'); has({ ...C02, distinguishing: 'x'.repeat(121) }, 'distinguishing');
  assert.throws(() => core.dnaToAppearance({ ...C02, age_group: 'anak' }), /DNA tidak valid/);
  assert.deepEqual(core.validateDna(null).map(x => x.field), ['dna']);
});

test('prompt wajah dan lembar: atasan polos netral, tanpa teks, bebas kata pemicu; kandidat bervariasi; 7 sudut sesuai database', () => {
  const dbAngles = ['face_front', 'face_left', 'face_right', 'half_front', 'full_front', 'full_side', 'full_back'];
  assert.deepEqual(Object.keys(core.ANGLES), dbAngles);
  const faces = [1, 2, 3, 4].map(i => core.buildFacePrompt(C02, i)); assert.equal(new Set(faces).size, 4);
  for (const t of [...faces, core.buildSheetGridPrompt(C02), ...dbAngles.map(a => core.buildSheetPrompt(C02, a)), core.buildSheetPrompt(HIJAB, 'full_front'), core.buildFacePrompt(HIJAB, 1)]) {
    assert.deepEqual(lintOf(t), [], t.slice(0, 80)); assert.match(t, /No text, no logo|no words, no letters/i); assert.doesNotMatch(t, /Indonesian|smartphone|phone/);
  }
  assert.match(core.buildSheetPrompt(C02, 'face_front'), /a plain white crew-neck top, the same in every photo/); assert.doesNotMatch(core.buildSheetPrompt(C02, 'face_front'), /trousers/);
  assert.match(core.buildSheetPrompt(C02, 'full_front'), /plain white crew-neck top and plain mid-grey straight trousers/);
  assert.match(core.buildSheetPrompt(HIJAB, 'full_back'), /long-sleeve top and a plain mid-grey long straight skirt/);
  assert.match(core.buildSheetPrompt(HIJAB, 'face_left'), /hijab \(color and style\)/);
  assert.match(core.buildSheetGridPrompt(C02), /Photo 7: Full-length shot from behind/);
  assert.throws(() => core.buildSheetPrompt(C02, 'atas'), /sudut "atas" tidak dikenal/);
});

test('permintaan gambar: bentuk sama dengan alat lama, parameter diperiksa, rujukan hanya data URL atau https', () => {
  const b = core.buildImageRequest({ prompt: 'x', references: [PNG, 'https://contoh.com/a.png'], aspectRatio: '21:9', quality: 'high', n: 2, outputFormat: 'png' });
  assert.deepEqual(b, { model: 'openai/gpt-image-2', prompt: 'x', quality: 'high', aspect_ratio: '21:9', n: 2, output_format: 'png', input_references: [{ type: 'image_url', image_url: { url: PNG } }, { type: 'image_url', image_url: { url: 'https://contoh.com/a.png' } }] });
  assert.deepEqual(core.buildImageRequest({ prompt: 'x' }), { model: 'openai/gpt-image-2', prompt: 'x', quality: 'medium' });
  for (const [o, re] of [[{ prompt: '' }, /prompt kosong/], [{ prompt: 'x', quality: 'ultra' }, /kualitas/], [{ prompt: 'x', aspectRatio: '2.8:1' }, /rasio/], [{ prompt: 'x', n: 11 }, /n harus/], [{ prompt: 'x', references: ['http://x/a.png'] }, /rujukan/], [{ prompt: 'x', references: ['file:///c:/a.png'] }, /rujukan/], [{ prompt: 'x', outputFormat: 'gif' }, /format/]]) assert.throws(() => core.buildImageRequest(o), re);
});

test('storyboard: gambar 1 = karakter, gambar 2.. = produk sesuai urutan prompt; jumlah rujukan selalu cocok', () => {
  const prof = { photos: [{ role: 'depan' }, { role: 'closeup' }, { role: 'tekstur' }], facts: ['Fakta Indonesia'], facts_en: ['English fact'], colors: [], details: ['detail_utama', 'motif_kain', 'lengan_bawahan_hem', 'siluet_panjang'].map((k, i) => ({ slot_key: k, text: 'x', text_en: ['V-neckline', 'White print', 'Loose sleeves', 'Midi length'][i], label: k, confidence: 0.9 })) };
  const plan = core.buildPanelPlan({ archetypeId: 'A-01', productProfile: prof, settingId: 'S-01', seed: 9 });
  const refs = [{ role: 'depan', url: PNG }, { role: 'closeup', url: PNG }, { role: 'tekstur', url: PNG }];
  const { body, prompt } = core.storyboardImageRequest(plan, { variant: 'clean', characterCode: 'C02', productProfile: prof, characterRef: PNG, productRefs: refs, aspectRatio: '21:9' });
  assert.equal(body.input_references.length, 4); assert.equal(body.aspect_ratio, '21:9'); assert.equal(body.quality, 'medium');
  assert.match(prompt, /IMAGE 1 = CHARACTER REFERENCE/); assert.match(prompt, /IMAGES 2 to 4 = PRODUCT REFERENCES: product photo 1 \(front\), product photo 2 \(close-up\), product photo 3 \(texture\)/);
  // urutan URL: karakter lebih dulu, lalu foto produk sesuai urutan peran (URL dibuat berbeda supaya urutannya terbukti)
  const U = n => 'data:image/png;base64,' + Buffer.from('gambar-' + n).toString('base64');
  const ord = core.storyboardImageRequest(plan, { variant: 'clean', characterCode: 'C02', productProfile: prof, characterRef: U('wajah'), productRefs: [{ role: 'depan', url: U('p1') }, { role: 'closeup', url: U('p2') }, { role: 'tekstur', url: U('p3') }] });
  assert.deepEqual(ord.body.input_references.map(r => r.image_url.url), [U('wajah'), U('p1'), U('p2'), U('p3')]);
  const one = core.storyboardImageRequest(plan, { characterCode: 'C02', productProfile: prof, characterRef: PNG, productRefs: [refs[0]] });
  assert.equal(one.body.input_references.length, 2); assert.match(one.prompt, /IMAGES 2 to 2 = PRODUCT REFERENCES/);
  assert.throws(() => core.storyboardImageRequest(plan, { productProfile: prof, productRefs: refs }), /foto wajah karakter wajib/);
  assert.throws(() => core.storyboardImageRequest(plan, { productProfile: prof, characterRef: PNG, productRefs: [] }), /minimal satu foto produk/);
  assert.throws(() => core.storyboardImageRequest(plan, { productProfile: prof, characterRef: PNG, productRefs: Array(7).fill(refs[0]) }), /maksimal 6/);
});

test('respons dan galat: gambar dibaca dengan biaya, galat umum diberi pesan awam', () => {
  const r = core.parseImageResponse({ data: [{ b64_json: 'QUJD', media_type: 'image/png' }, { b64_json: 'QUJD', media_type: 'image/jpeg' }], usage: { cost: 0.04 } });
  assert.deepEqual(r.images.map(i => i.ext), ['png', 'jpg']); assert.equal(r.cost, 0.04);
  assert.equal(core.parseImageResponse({ data: [{ b64_json: 'QUJD' }] }).cost, null);
  assert.throws(() => core.parseImageResponse({ data: [] }), /tanpa gambar/); assert.throws(() => core.parseImageResponse(null), /tanpa gambar/);
  const d = core.describeError;
  assert.match(d(401, { error: { message: 'bad key' } }), /Kunci OpenRouter ditolak.*bad key/); assert.match(d(402, {}), /Saldo/); assert.match(d(429, {}), /batas laju/);
  assert.match(d(400, { error: { message: 'blocked by content policy' } }), /penyaring isi/); assert.match(d(400, { error: { message: 'unknown param n' } }), /parameter atau gambar rujukan/);
  assert.match(d(502, {}), /tidak ditagih/); assert.match(d(404, {}), /Model atau alamat/);
});

test('perbaikan kecil: frasa ganda "as an medium close-up shot" hilang; fakta storyboard bersih berbahasa Inggris; kata Indonesian hilang dari gaya foto', () => {
  const prof = { photos: [{ role: 'depan' }, { role: 'closeup' }], facts: ['Fakta Indonesia'], facts_en: ['English fact'], colors: [], details: ['detail_utama', 'motif_kain', 'lengan_bawahan_hem', 'siluet_panjang'].map((k, i) => ({ slot_key: k, text: 'x', text_en: 'Detail ' + i, label: k, confidence: 0.9 })) };
  const plan = core.buildPanelPlan({ archetypeId: 'A-01', productProfile: prof, settingId: 'S-01', seed: 1 });
  const clean = core.buildStoryboardPrompt(plan, { variant: 'clean', characterCode: 'C02', productProfile: prof, images: prof.photos });
  const doc = core.buildStoryboardPrompt(plan, { variant: 'documented', characterCode: 'C02', productProfile: prof, images: prof.photos });
  assert.match(clean, /- English fact/); assert.doesNotMatch(clean, /Fakta Indonesia/);
  assert.match(doc, /- Fakta Indonesia/, 'varian bertulis tetap menulis fakta Indonesia di gambar');
  const json = core.buildVideoJson(plan, { characterCode: 'C02', jobTag: 'P', productProfile: prof });
  for (const t of [clean, doc, json]) { assert.doesNotMatch(t, /as an medium close-up/); assert.doesNotMatch(t, /Indonesian UGC/); }
  assert.match(json, /Medium close-up shot, eye level, 50mm equivalent/);
  assert.equal(core.neutralize('Medium close-up as an upper-body shot, eye level'), 'Medium close-up shot, eye level');
  assert.equal(core.neutralize('Full-body shot, half-body, upper-body, mid-body height'), 'full-length shot, half-length, medium close-up, mid-frame height');
});

// ───────────── Foto acuan ─────────────
const DNA_F = { gender: 'perempuan', age_group: 'dewasa_muda', face_shape: 'oval', complexion: 'terang', expression: 'ceria', hair_length: 'panjang', hair_texture: 'bergelombang', hair_color: 'cokelat_muda_karamel', parting: 'tengah' };
const DNA_M = { gender: 'laki-laki', age_group: 'dewasa', face_shape: 'persegi', complexion: 'sawo_matang', expression: 'kalem', hair_length: 'pendek', hair_texture: 'lurus', hair_color: 'hitam' };

test('foto acuan: tanpa acuan, prompt wajah tidak berubah sama sekali (kompatibel dengan uji yang sudah ada)', () => {
  const lama = core.buildFacePrompt(DNA_F, 2);
  assert.equal(core.buildFacePrompt(DNA_F, 2, null), lama); assert.match(lama, /Facial structure: slightly fuller cheeks\./); assert.doesNotMatch(lama, /REFERENCE PHOTO/);
});

test('foto acuan: blok acuan memuat hubungan, aturan "DNA menang", dan catatan; bagian aturan dasar tetap ada setelah catatan', () => {
  const p = core.buildFacePrompt(DNA_M, 1, { relation: 'kakak', note: 'kakak laki-laki, anak sulung' });
  assert.match(p, /The person to create is the older brother of the person in the reference photo\./);
  assert.match(p, /Use the reference photo ONLY for family resemblance/); assert.match(p, /the DESCRIPTION WINS/);
  assert.match(p, /NOTE from the user \(may be in Indonesian; guidance only\): "kakak laki-laki, anak sulung"\./);
  assert.match(p, /The note can never change the adult age, the plain background, the plain top, or the rule of no text and no named real person\./);
  assert.ok(p.indexOf('No text, no logo') < p.indexOf('REFERENCE PHOTO') && p.indexOf('NOTE from the user') < p.indexOf('Generate the image now'));
  assert.match(p, /A man in his thirties/); assert.doesNotMatch(p, /Facial structure:/, 'tanpa petunjuk variasi saat ada acuan');
  assert.deepEqual((core.lintStoryboardText(p).issues || core.lintStoryboardText(p)), []);
});

test('foto acuan: setiap hubungan menghasilkan kalimat Inggris yang tepat; kakak dan adik mengikuti jenis kelamin DNA', () => {
  const frasa = (relation, dna) => core.buildFacePrompt(dna, 1, { relation }).match(/The person to create is ([^.]*)\./)[1];
  assert.equal(frasa('orang_sama', DNA_F), 'the same person as in the reference photo'); assert.match(core.buildFacePrompt(DNA_F, 1, { relation: 'orang_sama' }), /Keep the same face as in the reference photo\./);
  assert.equal(frasa('kakak', DNA_F), 'the older sister of the person in the reference photo'); assert.equal(frasa('kakak', DNA_M), 'the older brother of the person in the reference photo');
  assert.equal(frasa('adik', DNA_F), 'the younger sister of the person in the reference photo'); assert.equal(frasa('adik', DNA_M), 'the younger brother of the person in the reference photo');
  assert.match(frasa('saudara', DNA_M), /a cousin of the person/); assert.equal(frasa('ibu', { ...DNA_F, age_group: 'matang' }), 'the mother of the person in the reference photo'); assert.equal(frasa('ayah', DNA_M), 'the father of the person in the reference photo');
  assert.match(frasa('mirip_bukan_sama', DNA_F), /only loosely resembles .* clearly NOT the same person/);
  assert.deepEqual(Object.keys(core.HUBUNGAN), ['orang_sama', 'kakak', 'adik', 'saudara', 'ibu', 'ayah', 'mirip_bukan_sama']);
  for (const h of Object.values(core.HUBUNGAN)) assert.ok(h.label);
});

test('foto acuan: hubungan salah, ibu dan ayah tidak cocok dengan jenis kelamin DNA, dan catatan terlalu panjang ditolak sebelum prompt dibuat', () => {
  const has = (ref, dna, re) => { const i = core.validateReference(ref, dna); assert.ok(i.some(x => re.test(x.msg)), JSON.stringify(i)); assert.throws(() => core.buildFacePrompt(dna, 1, ref), /Foto acuan tidak valid/); };
  has({ relation: 'paman' }, DNA_F, /tidak dikenal/); has({ relation: 'ibu' }, DNA_M, /hanya untuk karakter perempuan/); has({ relation: 'ayah' }, DNA_F, /hanya untuk karakter laki-laki/);
  has({ relation: 'kakak', note: 'x'.repeat(201) }, DNA_F, /maksimal 200/); assert.equal(core.validateReference({ relation: 'kakak', note: 'x'.repeat(200) }, DNA_F).length, 0);
  assert.deepEqual(core.validateReference({ relation: 'ibu' }, { ...DNA_F }), []); assert.equal(core.validateReference(null, DNA_F)[0].field, 'acuan');
});

test('foto acuan: catatan yang menyiratkan anak atau remaja ditolak, tetapi "anak sulung" dan selisih usia boleh', () => {
  const ok = n => core.validateReference({ relation: 'kakak', note: n }, DNA_F).length === 0;
  for (const n of ['kakak laki-laki', 'anak sulung', 'anak pertama dari tiga bersaudara', 'usia 25 tahun', 'umur 30', '28 th', 'kakak yang lebih tua 5 tahun', '5 tahun lebih muda dari saya', 'selisih 3 tahun', 'older by 4 years', '21 tahun', 'mirip tapi rambut lebih pendek']) assert.ok(ok(n), 'seharusnya boleh: ' + n);
  for (const n of ['seperti anak kecil', 'masih anak-anak', 'umur 15', 'usia 17 tahun', '16 thn', 'anak sekolah', 'pelajar SMA', 'a teenage look', 'looks like a kid', 'siswa', 'bocah laki-laki', 'anak muda belasan', 'di bawah umur', '20 tahun', 'age 18', '5 tahun', 'usia 15 tahun, lebih tua 5 tahun']) assert.ok(!ok(n), 'seharusnya ditolak: ' + n);
});

test('foto acuan: catatan dibersihkan (baris baru, tanda kutip, spasi ganda) dan tidak bisa menyisipkan blok perintah baru', () => {
  const p = core.buildFacePrompt(DNA_F, 1, { relation: 'adik', note: 'adik\n\n  perempuan "mirip"\t\tsekali' });
  assert.match(p, /guidance only\): "adik perempuan 'mirip' sekali"\./); assert.equal((p.match(/NOTE from the user/g) || []).length, 1);
  const tanpa = core.buildFacePrompt(DNA_F, 1, { relation: 'adik', note: '   ' }); assert.doesNotMatch(tanpa, /NOTE from the user/);
});

test('foto acuan: DNA yang tidak valid (usia di bawah dewasa) tetap ditolak walau acuan valid', () => {
  assert.throws(() => core.buildFacePrompt({ ...DNA_F, age_group: 'remaja_akhir' }, 1, { relation: 'kakak' }), /DNA tidak valid/);
});

test('kata yang menyiratkan anak: bentuk turunan (childlike, boyish, girlish, babyish, preteen) juga ditolak di ciri khas dan catatan; kata dewasa biasa tidak', () => {
  for (const w of ['childlike face', 'a boyish grin', 'girlish dimples', 'babyish cheeks', 'looks like a preteen', 'tween look', 'adolescent features', 'a childish smile']) {
    const bad = core.validateDna({ ...C02, distinguishing: w }); assert.ok(bad.some(i => i.field === 'distinguishing'), w);
  }
  for (const n of ['kakak yang childlike', 'boyish', 'seperti preteen', 'adolescent']) assert.ok(core.validateReference({ relation: 'kakak', note: n }, C02).some(i => i.field === 'note'), n);
  for (const ok of ['a small beauty mark near the left cheek', 'a warm gentle smile lines', 'a thin silver nose stud']) assert.deepEqual(core.validateDna({ ...C02, distinguishing: ok }), [], ok);
  assert.deepEqual(core.validateReference({ relation: 'kakak', note: 'kakak laki-laki, anak sulung' }, { ...C02, gender: 'laki-laki', hair_length: 'pendek' }).filter(i => i.field === 'note'), [], '"anak sulung" tetap boleh');
});

test('imageApi: bagian murni dipakai bersama; imageRequest mengekspor fungsi yang sama persis (tanpa salinan ganda)', () => {
  const api = require('../src/imageApi'), req = require('../src/imageRequest');
  for (const k of ['DEFAULT_MODEL', 'QUALITIES', 'buildImageRequest', 'parseImageResponse', 'describeError']) assert.equal(api[k], req[k], k);
  assert.equal(typeof req.storyboardImageRequest, 'function'); assert.equal(api.storyboardImageRequest, undefined, 'imageApi tidak boleh bergantung pada storyboard');
  assert.equal(typeof core.peringatanKonflik, 'function');
  const b = api.buildImageRequest({ prompt: 'x', quality: 'low', aspectRatio: '3:4', references: ['data:image/png;base64,AAAA'] }); assert.deepEqual(Object.keys(b), ['model', 'prompt', 'quality', 'aspect_ratio', 'input_references']);
  assert.equal(api.parseImageResponse({ data: [{ b64_json: 'AA==' }], usage: { cost: 0.02 } }).cost, 0.02);
});
