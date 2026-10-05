'use strict';
// Pengujian pengubahan kata: tidak ada kata ponsel di prompt, ada aturan bingkai pertama, dan pemeriksa kata bekerja.
const test = require('node:test');
const assert = require('node:assert');
const core = require('../src');

const prof = { photos: [{ role: 'depan' }, { role: 'closeup' }], facts: ['Lengan pendek'], colors: ['#ffffff'],
  details: [['detail_utama', 'leher bulat dengan resleting depan', 'Leher'], ['motif_kain', 'motif bunga', 'Motif'], ['lengan_bawahan_hem', 'lengan pendek', 'Lengan'], ['siluet_panjang', 'siluet longgar dan panjang midi', 'Samping']]
    .map(([k, t, l]) => ({ slot_key: k, text: t, label: l, confidence: 0.9 })) };
const plan = () => core.buildPanelPlan({ archetypeId: 'A-01', productProfile: prof, settingId: 'S-01', seed: 1 });
const json = (extra = {}) => core.buildVideoJson(plan(), { characterCode: 'C02', jobTag: 'UJI', productProfile: prof, ...extra });
const outsideSafe = txt => { const o = JSON.parse(txt); const out = []; (function w(n, k) { if (['negative_prompt', 'clean_frame', 'restriction', 'final_instruction'].includes(k)) return; if (typeof n === 'string') out.push(n); else if (Array.isArray(n)) n.forEach(x => w(x, k)); else if (n && typeof n === 'object') Object.entries(n).forEach(([kk, v]) => w(v, kk)); })(o, ''); return out.join(' '); };

test('JSON video: tanpa kata ponsel di luar larangan, dan lolos pemeriksa tanpa peringatan ponsel', () => {
  const t = json();
  assert.ok(!/smartphone|phone camera/i.test(outsideSafe(t)), 'tidak ada smartphone/phone camera');
  assert.ok(!/smartphone|phone camera/i.test(t.replace(/no phone screen[^"]*/gi, '').replace(/No phone screen[^"]*/g, '').replace(/never a picture of a screen, a phone[^"]*/g, '').replace(/never opens on a phone screen[^"]*/g, '').replace(/never on a phone screen[^"]*/g, '')), 'sisa kata hanya dalam larangan');
  const issues = core.lintVideoJson(t);
  assert.deepStrictEqual(issues.filter(i => i.word === 'phone' || i.word === 'smartphone'), []);
  assert.deepStrictEqual(issues.filter(i => i.level === 'error'), []);
});

test('JSON video: ada aturan bingkai pertama, bingkai adalah rekaman bukan layar, dan larangan layar ponsel', () => {
  const o = JSON.parse(json());
  assert.match(o.clean_frame.first_frame, /Frame 1 \(0\.0 s\) is already the live scene/);
  assert.match(o.clean_frame.first_frame, /never opens on a phone screen, a camera interface/);
  assert.match(o.clean_frame.instruction, /never a picture of a screen, a phone, a camera app/);
  assert.ok(o.camera.restriction.some(r => /No phone screen, camera interface, or device frame/.test(r)));
  assert.ok(o.negative_prompt.includes('no phone screen, camera app interface, viewfinder, or device frame'));
  assert.match(o.final_instruction, /starting directly on the live scene/);
  assert.strictEqual(o.camera.style, 'natural handheld or stabilized camera');
  assert.match(o.character.performance, /talking naturally to the camera/);
});

test('daftar larangan: bawaan tetap lengkap, versi ringkas menggabungkan butir antarmuka dan platform', () => {
  const full = JSON.parse(json()).negative_prompt, compact = JSON.parse(json({ compactNegatives: true })).negative_prompt;
  for (const k of ['no watermark', 'no sticker', 'no username or handle', 'no logo of any platform or app', 'no app interface elements', 'no text on screen']) assert.ok(full.includes(k), k);
  for (const k of ['no username or handle', 'no logo of any platform or app', 'no app interface elements', 'no sticker', 'no banner']) assert.ok(!compact.includes(k), 'ringkas tanpa ' + k);
  assert.ok(compact.includes('pure footage with nothing overlaid on the picture'));
  assert.ok(compact.includes('no phone screen, camera app interface, viewfinder, or device frame'));
  assert.ok(compact.length < full.length);
  assert.deepStrictEqual(core.lintVideoJson(json({ compactNegatives: true })).filter(i => i.level === 'error'), []);
});

test('JSON perkenalan karakter: sama, tanpa kata ponsel dan dengan aturan bingkai pertama', () => {
  const t = core.buildIntroJson({ name: 'Sari', code: 'C02', flowCharacterName: 'Sari', settingId: 'S-20' });
  const o = JSON.parse(t);
  assert.ok(!/smartphone|phone camera/i.test(outsideSafe(t)));
  assert.match(o.clean_frame.first_frame, /already the live scene/);
  assert.ok(o.negative_prompt.includes('no phone screen, camera app interface, viewfinder, or device frame'));
  assert.deepStrictEqual(core.lintVideoJson(t.replace(/"timeline": \[[\s\S]*?\n \],/, '"timeline": [1,2,3,4,5],')).filter(i => i.word === 'phone' || i.word === 'smartphone'), []);
});

test('prompt storyboard: tanpa "smartphone", dan versi bertulis melarang ikon ponsel, kamera, dan aplikasi', () => {
  const p = plan();
  const images = [{ role: 'depan' }, { role: 'closeup' }];
  const doc = core.buildStoryboardPrompt(p, { variant: 'documented', characterCode: 'C02', productProfile: prof, images });
  const clean = core.buildStoryboardPrompt(p, { variant: 'clean', characterCode: 'C02', productProfile: prof, images });
  for (const t of [doc, clean]) assert.ok(!/smartphone/i.test(t));
  assert.match(doc, /Do not draw any phone, camera, or app icons, pictograms, or device frames anywhere in the image/);
  assert.deepStrictEqual(core.lintStoryboardText(doc).filter(i => i.level === 'error'), []);
  assert.deepStrictEqual(core.lintStoryboardText(doc).filter(i => i.word === 'phone' || i.word === 'smartphone'), [], 'kalimat larangan ikon dikecualikan');
});

test('pemeriksa kata: menandai gaya lama ("smartphone look", "phone camera") sebagai peringatan, bukan galat', () => {
  const old = JSON.stringify({ project: { style: 'natural smartphone look' }, character: { performance: 'talking to her phone camera' }, timeline: [1, 2, 3, 4, 5], negative_prompt: ['no phone screen'] });
  const issues = core.lintVideoJson(old);
  assert.ok(issues.some(i => i.word === 'smartphone' && i.level === 'warn'));
  assert.ok(issues.some(i => i.word === 'phone' && i.level === 'warn'));
  assert.deepStrictEqual(issues.filter(i => i.level === 'error'), []);
  const onlyNeg = JSON.stringify({ negative_prompt: ['no phone screen'], clean_frame: { x: 'never a phone' }, timeline: [1, 2, 3, 4, 5] });
  assert.deepStrictEqual(core.lintVideoJson(onlyNeg).filter(i => i.word === 'phone'), [], 'kata ponsel di kunci larangan tidak ditandai');
  assert.ok(core.lintStoryboardText('natural smartphone look').some(i => i.word === 'smartphone'));
});
