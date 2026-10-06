'use strict';
// Profil suara karakter. Dua lapis:
//  1) IDENTITAS  -> teks "Sesuaikan performa" pada Voice di Flow (disimpan sekali, bahasa Inggris)
//  2) PER VIDEO  -> arahan suasana, jeda, dan ruang rekam di JSON video (ruang otomatis dari lokasi)
const VOICES = require('../data/flow_voices.json');

const OPT = {
  gender: { 'perempuan': 'woman', 'laki-laki': 'man' },
  usia: {
    dewasa_muda: 'early twenties, around 21 to 24 years old',
    muda: 'young adult, around 23 to 29 years old',
    dewasa: 'adult, around 30 to 39 years old',
    matang: 'mature adult, around 40 to 50 years old'
  },
  nada: { cerah: 'bright', hangat: 'warm', lembut: 'soft and gentle', jernih: 'clear', serak_ringan: 'slightly husky', tegas: 'firm and confident' },
  energi: { rendah: 'low energy', sedang: 'medium energy', tinggi: 'high energy' },
  tempo: { santai: 'relaxed pace', normal: 'normal pace', cepat: 'quick pace' },
  gaya: {
    ramah_teman: 'speaks like a friend recommending something',
    informatif: 'clear and informative delivery',
    antusias: 'enthusiastic delivery',
    tenang_softsell: 'calm, low-pressure delivery',
    bercerita: 'storytelling tone'
  },
  aksen: {
    indonesia_netral: 'neutral Indonesian accent',
    jakarta_santai: 'casual Jakarta accent',
    sunda_ringan: 'light Sundanese-influenced Indonesian accent',
    jawa_ringan: 'light Javanese-influenced Indonesian accent'
  },
  bahasa: { baku: 'formal standard Indonesian register', semi_santai: 'semi-casual register', gaul_ringan: 'light colloquial register' },
  suasana: { senyum_terdengar: 'audible smile', penasaran: 'curious tone', kagum_ringan: 'mildly impressed tone', netral: 'neutral mood' },
  jeda: { minim: 'minimal pauses', natural: 'natural pauses', banyak: 'frequent pauses' }
};
const REQUIRED = ['base_voice', 'gender', 'usia', 'nada', 'energi', 'tempo', 'gaya', 'aksen', 'bahasa'];
const DEFAULTS = { suasana: 'senyum_terdengar', jeda: 'natural', napas_awal: true };

function catalog(extra = []) { return VOICES.suara.concat(extra); }

function validateVoiceProfile(p, { extraVoices = [] } = {}) {
  const issues = [];
  const err = (field, msg) => issues.push({ level: 'error', field, msg });
  for (const f of REQUIRED) if (!p || p[f] == null || p[f] === '') err(f, 'wajib diisi');
  if (issues.length) return issues;
  if (p.usia === 'remaja_akhir') { err('usia', 'remaja_akhir tidak diizinkan: karakter harus dewasa (21 tahun ke atas). Pakai dewasa_muda, muda, dewasa, atau matang'); return issues; }
  for (const f of ['gender', 'usia', 'nada', 'energi', 'tempo', 'gaya', 'aksen', 'bahasa']) if (!OPT[f][p[f]]) err(f, `nilai "${p[f]}" tidak dikenal`);
  for (const f of ['suasana', 'jeda']) if (p[f] != null && !OPT[f][p[f]]) err(f, `nilai "${p[f]}" tidak dikenal`);
  const v = catalog(extraVoices).find(x => x.name.toLowerCase() === String(p.base_voice).toLowerCase());
  if (!v) issues.push({ level: 'warn', field: 'base_voice', msg: `suara "${p.base_voice}" tidak ada di daftar yang diketahui; pastikan namanya sama dengan di Flow` });
  else if (OPT.gender[p.gender] && v.gender !== p.gender) err('base_voice', `suara ${v.name} berjenis ${v.gender}, sedangkan profil ${p.gender}`);
  return issues;
}

// Lapis identitas: teks untuk kolom "Sesuaikan performa" (disimpan sekali di Flow).
function buildVoicePerformance(p) {
  const bad = validateVoiceProfile(p).filter(i => i.level === 'error');
  if (bad.length) throw new Error('Profil suara tidak valid: ' + bad.map(b => `${b.field}: ${b.msg}`).join('; '));
  const a = OPT.usia[p.usia];
  return [
    `${OPT.gender[p.gender] === 'man' ? 'Man' : 'Woman'} who sounds ${a}.`,
    `${cap(OPT.nada[p.nada])} timbre.`,
    `${cap(OPT.energi[p.energi])}, ${OPT.tempo[p.tempo]}.`,
    `${cap(OPT.gaya[p.gaya])}.`,
    `${cap(OPT.aksen[p.aksen])}, ${OPT.bahasa[p.bahasa]}.`
  ].join(' ');
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Lapis per video: suasana, jeda, napas, dan ruang rekam dari lokasi.
function buildVoiceDirection(p, setting) {
  const mood = OPT.suasana[p.suasana || DEFAULTS.suasana];
  const pause = OPT.jeda[p.jeda || DEFAULTS.jeda];
  const breath = (p.napas_awal ?? DEFAULTS.napas_awal) ? 'A small breath before the first sentence, no filler words.' : 'No filler words.';
  const space = setting && setting.acoustic ? ` Recording space: ${setting.acoustic.en}` : '';
  return `${cap(mood)}. ${breath} ${cap(pause)}.${space}`;
}

// Satu karakter satu suara, kecuali disetujui admin (voice_shared_ok).
function voiceConflicts(profile, others) {
  return (others || []).filter(o => o.voice_base && !o.voice_shared_ok && String(o.voice_base).toLowerCase() === String(profile.base_voice).toLowerCase());
}

const INTRO_WORD_LIMIT = 8;
function introLine(name) { return `Hai, aku ${String(name).trim()}. Senang kenalan sama kamu!`; }
function wordCount(s) { return String(s).trim().split(/\s+/).filter(Boolean).length; }

module.exports = { OPT, DEFAULTS, validateVoiceProfile, buildVoicePerformance, buildVoiceDirection, voiceConflicts, introLine, wordCount, INTRO_WORD_LIMIT, catalog };
