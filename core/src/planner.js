'use strict';
const { getArchetype, getSetting, getAngle, META } = require('./catalog');
const { buildPanelOrder } = require('./shuffle');

const TIMES = [['0.0', '2.0'], ['2.0', '4.0'], ['4.0', '6.0'], ['6.0', '8.0'], ['8.0', '10.0']];
const WORN = new Set(['A-01', 'A-02', 'A-03', 'A-04']);
// Judul adegan berbahasa Inggris, diturunkan dari angle (bukan dari kalimat Indonesia), supaya tidak tampil sebagai tulisan di video.
const SHOT_EN = { 'C-01': 'FULL-BODY VIEW', 'C-02': 'MEDIUM-FULL VIEW', 'C-03': 'MEDIUM VIEW', 'C-04': 'MEDIUM CLOSE-UP', 'C-05': 'CLOSE-UP', 'C-06': 'EXTREME CLOSE-UP',
  'C-07': 'THREE-QUARTER VIEW', 'C-08': 'SIDE VIEW', 'C-09': 'BACK VIEW', 'C-10': 'LOW-ANGLE VIEW', 'C-11': 'HIGH-ANGLE VIEW', 'C-12': 'TOP-DOWN VIEW', 'C-13': 'HANDS POV', 'C-14': 'OVER-THE-SHOULDER VIEW' };
// Nama lokasi berbahasa Inggris: bagian awal kalimat deskripsi lokasi (sebelum "with"/koma/titik).
function placeEn(prompt) {
  const m = /^(.*?)(?:\s+with\s+|,|\.)/i.exec(String(prompt || '')); return (m ? m[1] : String(prompt || '')).trim();
}

function aksiForAngle(angleId, detail) {
  const d = detail || 'detail produk';
  switch (angleId) {
    case 'C-04': return ['Kamera medium close-up, karakter menghadap kamera', `Perlihatkan ${d}`, 'Gerakan tangan kecil dan natural', 'Senyum natural'];
    case 'C-05': return ['Kamera mendekat ke area produk', `Fokus pada ${d}`, 'Tunjuk atau sentuh pelan bagian itu', 'Gerakan kecil, produk tidak berubah'];
    case 'C-06': return ['Close-up sangat dekat pada permukaan', `Tampilkan ${d}`, 'Gerakan sangat minim', 'Sesuai foto close-up referensi'];
    case 'C-07': return ['Karakter berputar pelan ke tiga perempat', `Perlihatkan ${d}`, 'Tetap tersenyum', 'Tanpa putaran penuh'];
    case 'C-08': return ['Karakter menghadap ke samping', `Perlihatkan ${d}`, 'Gerakan pelan dan natural', 'Kembali menghadap kamera'];
    case 'C-09': return ['Karakter membelakangi kamera sesaat', `Perlihatkan ${d}`, 'Boleh menoleh ke kamera', 'Tanpa putaran penuh'];
    case 'C-10': return ['Sudut rendah dari lantai', `Perlihatkan ${d}`, 'Langkah kecil dan pelan', 'Produk tidak berubah'];
    case 'C-11': case 'C-12': return ['Produk terlihat dari atas atau sudut menunduk', `Perlihatkan ${d}`, 'Tangan karakter merapikan atau menunjuk', 'Gerakan kecil'];
    case 'C-13': return ['Sudut pandang tangan karakter, wajah tidak terlihat', `Peragakan ${d}`, 'Gerakan tangan pelan dan jelas', 'Produk sesuai foto referensi'];
    case 'C-02': return ['Kamera medium-full', `Perlihatkan ${d}`, 'Gerakan kecil dan natural', 'Senyum natural'];
    default: return ['Kamera dekat dan stabil', `Perlihatkan ${d}`, 'Gerakan kecil dan natural', 'Senyum natural'];
  }
}

function panel1(arch) {
  const worn = WORN.has(arch.id);
  return {
    n: 1, slot: 'fixed_full_look', beat: 'pembuka',
    title: arch.meta.panel1_label,
    angle: arch.panel_1_angle,
    focus: worn ? 'produk utuh dipakai karakter' : 'produk utuh dipegang karakter dengan label menghadap kamera',
    focus_en: worn ? 'the complete product worn by the character' : 'the complete product held by the character with the label facing the camera',
    shot_en: 'OPENING VIEW',
    aksi: worn
      ? ['Karakter tampil dengan produk utuh', 'Menyapa kamera dan mulai bicara', 'Gerakan tangan kecil', 'Perlihatkan keseluruhan produk']
      : ['Karakter memegang produk utuh', 'Menyapa kamera dan mulai bicara', 'Label atau bagian depan menghadap kamera', 'Gerakan tangan kecil']
  };
}

function panel5(arch, gesture) {
  const g = gesture === 'pointing_down' ? 'Satu gestur pointing ke bawah' : 'Satu gestur telapak tangan terbuka menyajikan produk';
  return {
    n: 5, slot: 'fixed_final_look', beat: 'penutup',
    title: 'TAMPILAN AKHIR + PENUTUP',
    angle: arch.panel_5_angle,
    focus: 'produk utuh sekali lagi',
    focus_en: 'the complete product one more time',
    shot_en: 'CLOSING VIEW',
    gesture,
    aksi: ['Kembali ke tampilan awal', 'Senyum ke kamera', g, 'Penutup hanya lewat suara; tahan pose pada 9.2-10.0 detik']
  };
}

function shortTitle(slot, detail) {
  const raw = (detail && detail.label) ? detail.label : slot.nama.split('(')[0].trim();
  return ('DETAIL ' + raw).toUpperCase().replace(/^DETAIL (DETAIL|TAMPILAN) /, (m, a) => (a === 'TAMPILAN' ? 'TAMPILAN ' : 'DETAIL '));
}

/**
 * opts: { archetypeId, productProfile, settingId, seed, gestureVariant, history, minConfidence }
 * productProfile: { photos:[{role}], details:[{slot_key,text,label,confidence}], facts:[], colors:[] }
 */
function buildPanelPlan(opts) {
  const { archetypeId, productProfile, settingId, seed, gestureVariant = 'open_palm', history = [], minConfidence = 0.6 } = opts;
  const arch = getArchetype(archetypeId);
  if (!arch) return { error: `arketipe ${archetypeId} tidak dikenal` };
  const setting = getSetting(settingId);
  if (!setting) return { error: `lokasi ${settingId} tidak dikenal` };
  if (!['open_palm', 'pointing_down'].includes(gestureVariant)) return { error: 'varian gestur tidak dikenal' };

  const roles = new Set((productProfile.photos || []).map(p => p.role));
  const detailBy = {};
  for (const d of productProfile.details || []) if ((d.confidence ?? 1) >= minConfidence) detailBy[d.slot_key] = d;

  const pool = arch.slot.filter(s => s.butuh_foto.every(r => roles.has(r)) && detailBy[s.key]);
  const res = buildPanelOrder({ pool, panel1Angle: arch.panel_1_angle, panel5Angle: arch.panel_5_angle, seed, history });
  if (res.error || res.habis) return res;

  const mid = res.order.map((slot, i) => {
    const d = detailBy[slot.key];
    return {
      n: i + 2, slot: slot.key, beat: slot.beat,
      title: shortTitle(slot, d),
      angle: slot.angle,
      focus: d.text,
      focus_en: d.text_en || d.text,
      shot_en: SHOT_EN[slot.angle] || 'CLOSE-UP',
      aksi: aksiForAngle(slot.angle, d.text)
    };
  });
  const panels = [panel1(arch), ...mid, panel5(arch, gestureVariant)].map((p, i) => ({
    ...p, time: `${TIMES[i][0]}-${TIMES[i][1]}`, time_label: `${TIMES[i][0]}–${TIMES[i][1]}`,
    angle_prompt: getAngle(p.angle) ? getAngle(p.angle).prompt_en : ''
  }));

  return {
    version: 'v3', archetype_id: archetypeId, risk_level: META[archetypeId].risiko,
    needs_human_approval: META[archetypeId].risiko === 'tinggi',
    setting: { id: setting.id, name: setting.nama, lighting: setting.cahaya, color_temperature_k: setting.suhu_warna_k, prompt_en: setting.prompt_en, name_en: placeEn(setting.prompt_en), acoustic: setting.acoustic },
    gesture_variant: gestureVariant,
    order_seed: seed, order_key: res.key, relax_level: res.level,
    panels
  };
}

module.exports = { buildPanelPlan };
