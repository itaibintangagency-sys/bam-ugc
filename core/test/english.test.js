'use strict';
// Pengujian padanan bahasa Inggris pada JSON video: deskripsi produk tidak lagi berupa kalimat Indonesia di tengah prompt Inggris.
const test = require('node:test');
const assert = require('node:assert');
const core = require('../src');

const mk = (en) => ({
  photos: [{ role: 'depan' }, { role: 'closeup' }],
  facts: ['Leher bulat dengan resleting depan', 'Lengan pendek'],
  ...(en ? { facts_en: ['Round neckline with a front zipper', 'Short sleeves'] } : {}),
  colors: ['#ffffff'],
  details: [
    ['detail_utama', 'leher bulat dengan resleting depan', 'round neckline with a front zipper'],
    ['lengan_bawahan_hem', 'lengan pendek', 'short sleeves'],
    ['siluet_panjang', 'motif bunga di bagian bawah dan panjang midi', 'floral print near the hem and the midi length']
  ].map(([k, t, e]) => ({ slot_key: k, text: t, ...(en ? { text_en: e } : {}), label: k, confidence: 0.9 }))
});
const build = (en, extra = {}) => { const prof = mk(en); const plan = core.buildPanelPlan({ archetypeId: 'A-01', productProfile: prof, settingId: 'S-01', seed: 9 }); return { plan, txt: core.buildVideoJson(plan, { characterCode: 'C02_THE_SOFT_GIRL', jobTag: 'PRODUCT-01', productProfile: prof, ...extra }) }; };
const strings = o => { const out = []; (function w(n) { if (typeof n === 'string') out.push(n); else if (Array.isArray(n)) n.forEach(w); else if (n && typeof n === 'object') Object.values(n).forEach(w); })(o); return out; };

test('dengan padanan Inggris: tidak ada kata Indonesia di JSON dan pemeriksa tidak memberi peringatan', () => {
  const { txt } = build(true);
  const o = JSON.parse(txt);
  const indo = /\b(dengan|yang|dan|bagian|bulat|lengan|motif|panjang|depan|leher|resleting|kerah|warna|ruang|tamu|produk|tampil|kain|dasar|longgar|pendek)\b/i;
  const hit = strings(o).filter(t => indo.test(t));
  assert.deepStrictEqual(hit, []);
  assert.deepStrictEqual(core.lintVideoJson(txt).filter(i => i.level === 'warn'), []);
  assert.deepStrictEqual(core.lintVideoJson(txt).filter(i => i.level === 'error'), []);
});

test('adegan: judul Inggris dari angle, fokus Inggris, arahan kamera (bukan label), tanpa tulisan di layar', () => {
  const o = JSON.parse(build(true).txt);
  assert.strictEqual(o.timeline.length, 5);
  for (const s of o.timeline) { assert.strictEqual(s.on_screen_text, 'none'); assert.ok(/^[A-Z0-9 \-+]+$/.test(s.shot), 'judul adegan Inggris: ' + s.shot); assert.ok(s.slot === undefined); }
  const detail = o.timeline[1];
  assert.match(detail.action[0], /^Move the camera in close on: round neckline with a front zipper\. Show it only visually, through camera framing and a small gesture\. Never write it as text\.$/);
  assert.strictEqual(detail.product_focus, 'round neckline with a front zipper');
  assert.deepStrictEqual(o.locked_product_facts, ['Round neckline with a front zipper', 'Short sleeves']);
  assert.strictEqual(o.dialogue.script_generation.structure['2.0-4.0'], 'Mention: round neckline with a front zipper.');
  assert.match(o.clean_frame.rule, /never text to display: never render any word, label, caption, callout, arrow, or pointer line/);
  assert.strictEqual(o.environment.location, 'A modern minimalist Indonesian living room');
});

test('profil lama tanpa padanan Inggris tetap bekerja, tetapi pemeriksa memperingatkan kalimat Indonesia', () => {
  const { txt } = build(false);
  const issues = core.lintVideoJson(txt);
  assert.deepStrictEqual(issues.filter(i => i.level === 'error'), []);
  const w = issues.find(i => i.level === 'warn' && /kalimat Indonesia/.test(i.why));
  assert.ok(w, 'ada peringatan');
  assert.match(w.why, /text_en dan facts_en/);
  assert.match(JSON.parse(txt).timeline[1].product_focus, /leher bulat/, 'jatuh ke teks Indonesia bila padanan tidak ada');
});

test('urutan adegan tetap mengikuti rencana, dan prompt storyboard memakai fokus Inggris pada bagian "Show"', () => {
  const { plan } = build(true);
  const prof = mk(true);
  const doc = core.buildStoryboardPrompt(plan, { variant: 'documented', characterCode: 'C02', productProfile: prof, images: prof.photos });
  const clean = core.buildStoryboardPrompt(plan, { variant: 'clean', characterCode: 'C02', productProfile: prof, images: prof.photos });
  assert.match(doc, /Show: round neckline with a front zipper/);
  assert.match(clean, /Show: round neckline with a front zipper/);
  assert.match(doc, /- Perlihatkan leher bulat dengan resleting depan|leher bulat dengan resleting depan/, 'butir aksi di bawah foto tetap Indonesia (teks gambar)');
});

test('JSON perkenalan karakter: lokasi berbahasa Inggris', () => {
  const o = JSON.parse(core.buildIntroJson({ name: 'Sari', code: 'C02', flowCharacterName: 'Sari', settingId: 'S-20' }));
  assert.ok(!/studio backdrop polos/i.test(o.environment.location));
  assert.match(o.environment.location, /^[A-Za-z ,'-]+$/);
});

test('identitas karakter: daftar kunci, penampilan dari profil, tiga bentuk rujukan, dan pakaian tidak pernah diambil dari karakter', () => {
  const prof = mk(true);
  const plan = core.buildPanelPlan({ archetypeId: 'A-01', productProfile: prof, settingId: 'S-01', seed: 9 });
  const b = ctx => JSON.parse(core.buildVideoJson(plan, { characterCode: 'C02_THE_SOFT_GIRL', jobTag: 'PRODUCT-01', productProfile: prof, ...ctx }));
  const base = b({});
  assert.strictEqual(base.character.identity_lock.priority, 'ABSOLUTE');
  assert.ok(base.character.identity_lock.preserve.includes('same hair color') && base.character.identity_lock.preserve.includes('same hairstyle'));
  assert.strictEqual(base.character.appearance, undefined, 'tanpa profil: tidak ada penampilan');
  assert.match(base.references.character, /character reference portrait inside the attached storyboard/);
  assert.match(base.references.character, /Never replace her with a different person/);
  assert.match(base.references.character, /outfit is only the product/);

  const withProfile = b({ characterProfile: { appearance_en: 'A young woman with long wavy light-brown hair and a soft oval face.' } });
  assert.strictEqual(withProfile.character.appearance, 'A young woman with long wavy light-brown hair and a soft oval face.');

  const photo = b({ characterPhotoAttached: true });
  assert.match(photo.references.character, /separate close-up portrait photo of the woman is attached/);
  assert.match(photo.references.character, /the portrait photo wins/);

  const flow = b({ flowCharacterName: 'Sari', characterPhotoAttached: true });
  assert.match(flow.references.character, /^Use @\[Sari\] as the ONLY source of the talent's face, complexion, hair and voice identity\./);
  assert.match(flow.references.character, /outfit is NEVER taken from the character/);
  assert.ok(!/clothing/.test(flow.references.character), 'tidak lagi menyebut pakaian sebagai bagian identitas');
  assert.strictEqual((JSON.stringify(flow).match(/@\[Sari\]/g) || []).length, 1, 'penanda karakter tetap satu kali');
});

test('kata "Indonesian" tidak menempel pada deskripsi orang (hanya bahasa, suara, dan lokasi)', () => {
  const o = JSON.parse(core.buildVideoJson(core.buildPanelPlan({ archetypeId: 'A-01', productProfile: mk(true), settingId: 'S-01', seed: 9 }), { characterCode: 'C', jobTag: 'P', productProfile: mk(true) }));
  const hits = []; (function w(n, p) { if (typeof n === 'string' && /Indonesian/.test(n)) hits.push(p); else if (Array.isArray(n)) n.forEach((x, i) => w(x, p + '[' + i + ']')); else if (n && typeof n === 'object') Object.entries(n).forEach(([k, v]) => w(v, p + '.' + k)); })(o, '');
  assert.deepStrictEqual(hits.sort(), ['.dialogue.voice', '.environment.description', '.environment.location'].sort());
  assert.deepStrictEqual(core.lintVideoJson(JSON.stringify(o)).filter(i => i.level !== 'error' ), [], 'tanpa peringatan istilah tubuh');
});
