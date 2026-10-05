'use strict';
const test = require('node:test');
const assert = require('node:assert');
const core = require('../src');

const profileA01 = {
  photos: [{ role: 'depan' }, { role: 'belakang' }, { role: 'closeup' }],
  facts: ['Warna dasar biru tua dengan motif daun putih', 'Leher bulat dengan resleting depan', 'Lengan pendek', 'Panjang midi, potongan longgar'],
  colors: ['#1f3a8a', '#ffffff'],
  details: [
    { slot_key: 'detail_utama', text: 'leher bulat dengan resleting depan', label: 'Leher & Resleting', confidence: 0.95 },
    { slot_key: 'motif_kain', text: 'motif daun putih pada kain biru tua', label: 'Motif', confidence: 0.9 },
    { slot_key: 'lengan_bawahan_hem', text: 'lengan pendek', label: 'Lengan', confidence: 0.85 },
    { slot_key: 'siluet_panjang', text: 'siluet longgar dan panjang midi', label: 'Samping', confidence: 0.8 }
  ]
};
const base = { archetypeId: 'A-01', productProfile: profileA01, settingId: 'S-01', seed: 7, gestureVariant: 'open_palm' };

test('acak panel: deterministik untuk seed yang sama', () => {
  const a = core.buildPanelPlan(base), b = core.buildPanelPlan(base);
  assert.strictEqual(a.order_key, b.order_key);
  assert.strictEqual(a.panels.length, 5);
});

test('acak panel: aturan ketat dipenuhi untuk 300 seed', () => {
  const arch = core.getArchetype('A-01');
  for (let seed = 1; seed <= 300; seed++) {
    const p = core.buildPanelPlan({ ...base, seed });
    assert.ok(!p.error && !p.habis, 'seed ' + seed);
    const mids = p.panels.slice(1, 4);
    const slots = new Set(mids.map(m => m.slot));
    assert.strictEqual(slots.size, 3, 'slot unik');
    assert.ok(slots.has('detail_utama'), 'slot prioritas selalu dipakai');
    const first = arch.slot.find(s => s.key === mids[0].slot);
    assert.strictEqual(first.extreme, false, 'panel 2 bukan extreme');
    if (p.relax_level === 0) {
      const seq = [arch.panel_1_angle, ...mids.map(m => m.angle), arch.panel_5_angle];
      for (let i = 1; i < seq.length; i++) assert.notStrictEqual(seq[i], seq[i - 1], 'angle sama berurutan');
      assert.strictEqual(first.sideback, false);
    }
  }
});

test('acak panel: riwayat dihormati sampai habis', () => {
  const history = [];
  let habis = false;
  for (let i = 0; i < 40; i++) {
    const p = core.buildPanelPlan({ ...base, seed: 100 + i, history });
    if (p.habis) { habis = true; break; }
    assert.ok(!history.includes(p.order_key));
    history.push(p.order_key);
  }
  assert.ok(habis, 'akhirnya habis');
  assert.ok(history.length >= 10 && history.length <= 18, 'jumlah urutan wajar: ' + history.length);
});

test('perencana: slot tanpa detail atau foto tidak dipakai', () => {
  const noBack = { ...profileA01, photos: [{ role: 'depan' }] };
  const p = core.buildPanelPlan({ ...base, productProfile: noBack });
  assert.ok(!p.error);
  const lowConf = { ...profileA01, details: profileA01.details.map((d, i) => i === 3 ? { ...d, confidence: 0.2 } : d) };
  const q = core.buildPanelPlan({ ...base, productProfile: lowConf });
  assert.ok(!q.error);
  const tooFew = { ...profileA01, details: profileA01.details.slice(0, 2) };
  const r = core.buildPanelPlan({ ...base, productProfile: tooFew });
  assert.ok(r.error, 'kurang dari 3 slot terlihat harus error');
});

test('perencana: ganti lokasi hanya mengubah lokasi', () => {
  const a = core.buildPanelPlan(base), b = core.buildPanelPlan({ ...base, settingId: 'S-12' });
  assert.strictEqual(a.order_key, b.order_key);
  assert.notStrictEqual(a.setting.id, b.setting.id);
  assert.deepStrictEqual(a.panels.map(p => p.slot), b.panels.map(p => p.slot));
});

test('perencana: arketipe berisiko tinggi ditandai', () => {
  const prof = { photos: [{ role: 'kemasan' }, { role: 'label' }], details: [
    { slot_key: 'kemasan', text: 'kemasan botol', confidence: 0.9 },
    { slot_key: 'info_label', text: 'label informasi', confidence: 0.9 },
    { slot_key: 'penyimpanan', text: 'petunjuk penyimpanan pada label', confidence: 0.9 }], facts: [], colors: [] };
  const p = core.buildPanelPlan({ archetypeId: 'A-07', productProfile: prof, settingId: 'S-01', seed: 1 });
  assert.ok(!p.error && !p.habis, JSON.stringify(p).slice(0, 200));
  assert.strictEqual(p.needs_human_approval, true);
});

test('prompt storyboard: lolos lint (dokumentasi dan bersih)', () => {
  const plan = core.buildPanelPlan(base);
  for (const variant of ['documented', 'clean']) {
    const text = core.buildStoryboardPrompt(plan, { variant, characterCode: 'C02', productProfile: profileA01, images: [{ role: 'depan' }, { role: 'belakang' }, { role: 'closeup' }], layoutExample: variant === 'documented' });
    const bad = core.lintStoryboardText(text).filter(i => i.level === 'error');
    assert.deepStrictEqual(bad, [], variant + ': ' + JSON.stringify(bad));
  }
});

test('prompt storyboard: kamus label tanpa kata pemicu', () => {
  for (const [k, v] of Object.entries(core.L)) {
    const bad = core.lintStoryboardText(v).filter(i => i.level === 'error');
    assert.deepStrictEqual(bad, [], k + ' ' + v);
  }
});

test('JSON video: valid, 5 scene, lolos lint, urutan mengikuti rencana', () => {
  const plan = core.buildPanelPlan(base);
  const txt = core.buildVideoJson(plan, { characterCode: 'C02_THE_SOFT_GIRL', jobTag: 'B01-03', productProfile: profileA01 });
  const obj = JSON.parse(txt);
  assert.strictEqual(obj.timeline.length, 5);
  assert.deepStrictEqual(obj.timeline.map(s => s.shot), plan.panels.map(p => p.shot_en), 'urutan adegan mengikuti rencana (judul adegan berbahasa Inggris)');
  assert.ok(obj.timeline.every(s => s.slot === undefined), 'kunci slot berbahasa Indonesia tidak ikut ke JSON');
  const issues = core.lintVideoJson(txt).filter(i => i.level === 'error');
  assert.deepStrictEqual(issues, []);
  assert.ok(!/\{\{/.test(txt), 'tidak ada placeholder tersisa');
});

test('JSON video: dua varian gestur panel 5', () => {
  const open = JSON.parse(core.buildVideoJson(core.buildPanelPlan(base), { characterCode: 'C', jobTag: 'x', productProfile: profileA01 }));
  const point = JSON.parse(core.buildVideoJson(core.buildPanelPlan({ ...base, gestureVariant: 'pointing_down' }), { characterCode: 'C', jobTag: 'x', productProfile: profileA01 }));
  assert.ok(open.timeline[4].action.some(a => /open-palm/.test(a)));
  assert.ok(point.timeline[4].action.some(a => /pointing gesture downward/.test(a)));
  assert.deepStrictEqual(core.lintVideoJson(JSON.stringify(point)).filter(i => i.level === 'error'), []);
});

test('lint: mendeteksi kata pemicu dan klaim', () => {
  const issues = core.lintStoryboardText('Cocok untuk konten TikTok, ajak klik keranjang, bahan ringan dan nyaman');
  const words = issues.map(i => i.word);
  for (const w of ['tiktok', 'klik', 'keranjang', 'ringan', 'nyaman']) assert.ok(words.includes(w), w);
  const j = JSON.stringify({ timeline: [1, 2, 3, 4, 5], note: 'cek keranjang kuning' });
  assert.ok(core.lintVideoJson(j).some(i => i.word === 'keranjang'));
});

test('netralisasi istilah tubuh', () => {
  assert.strictEqual(core.neutralize('Full-body shot, half-body, upper-body, mid-body height'), 'full-length shot, half-length, medium close-up, mid-frame height');
  assert.ok(!/\bbody\b/i.test(core.neutralize('turns her body, bare surface, skin tone')));
});

test('katalog: angle dan lokasi tidak memuat istilah tubuh setelah netralisasi', () => {
  const bad = /\b(body|skin|chest|waist|bare|thigh|bust)\b/i;
  for (const a of ['C-01', 'C-03', 'C-04', 'C-07', 'C-13']) assert.ok(!bad.test(core.getAngle(a).prompt_en), a);
  for (const s of core.listSettings()) assert.ok(!bad.test(s.prompt_en), s.id);
});

test('lokasi: saran dan peringatan', () => {
  const s = core.suggestedSettings('A-01');
  assert.strictEqual(s.utama, 'S-01');
  assert.strictEqual(s.disarankan.length, 4);
  assert.ok(core.settingWarnings('S-04', 'A-01').length >= 1);
  assert.strictEqual(core.listSettings().length, 24);
});
