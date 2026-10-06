// BERKAS HASIL SALINAN dari core/ oleh scripts/sync-core.mjs. Jangan diedit di sini; ubah di core/ lalu jalankan: npm run sync-core
import VOICES from './flow_voices.json';
// Profil suara karakter. Dua lapis:
//  1) IDENTITAS  -> teks "Sesuaikan performa" pada Voice di Flow (disimpan sekali, bahasa Inggris)
//  2) PER VIDEO  -> arahan suasana, jeda, dan ruang rekam di JSON video (ruang otomatis dari lokasi)

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

// Aksen yang belum terbukti: peringatan, bukan galat.
const AKSEN_EKSPERIMEN = ['sunda_ringan', 'jawa_ringan'];

// Suara yang cocok dengan jenis kelamin karakter (urut abjad), termasuk suara berlabel netral ("Ungendered" di Flow).
// Dipakai pemilih suara di website.
function voicesForGender(gender, { extraVoices = [] } = {}) {
  return catalog(extraVoices).filter(v => v.gender === gender || v.gender === 'netral').sort((a, b) => a.name.localeCompare(b.name));
}

// Pilihan awal suara dasar per jenis kelamin dan kelompok usia (urutan = prioritas). Berdasarkan ciri di pemilih suara Flow:
// usia muda -> suara "youthful", "younger", atau bernada lebih tinggi; usia matang -> "mature" atau lebih rendah.
const DEFAULT_PICKS = {
  perempuan: { dewasa_muda: ['Leda', 'Zephyr', 'Autonoe'], muda: ['Autonoe', 'Laomedeia', 'Aoede'], dewasa: ['Despina', 'Sulafat', 'Vindemiatrix'], matang: ['Gacrux', 'Callirrhoe', 'Kore'] },
  'laki-laki': { dewasa_muda: ['Fenrir', 'Puck', 'Achird'], muda: ['Achird', 'Puck', 'Algieba'], dewasa: ['Iapetus', 'Rasalgethi', 'Schedar'], matang: ['Charon', 'Alnilam', 'Algenib'] }
};
const DEFAULT_NADA = {
  perempuan: { dewasa_muda: 'cerah', muda: 'hangat', dewasa: 'lembut', matang: 'hangat' },
  'laki-laki': { dewasa_muda: 'hangat', muda: 'hangat', dewasa: 'jernih', matang: 'tegas' }
};

// Profil suara awal ketika jenis kelamin dan usia dipilih. `taken` = suara dasar yang sudah dipakai karakter lain:
// dilewati agar bawaan tidak bentrok (satu karakter satu suara). Bila semua suara sejenis terpakai, hasilnya bentrok=true.
function defaultVoiceProfile(gender, ageGroup, { taken = [], extraVoices = [] } = {}) {
  const picks = DEFAULT_PICKS[gender] && DEFAULT_PICKS[gender][ageGroup];
  if (!picks) throw new Error(`kombinasi jenis kelamin dan usia tidak dikenal: ${gender} / ${ageGroup}`);
  const used = new Set((taken || []).filter(Boolean).map(x => String(x).toLowerCase()));
  const pool = voicesForGender(gender, { extraVoices }).map(v => v.name);
  const free = picks.concat(pool.filter(n => !picks.includes(n))).find(n => !used.has(n.toLowerCase()));
  return {
    profile: { base_voice: free || picks[0], gender, usia: ageGroup, nada: DEFAULT_NADA[gender][ageGroup], energi: 'sedang', tempo: 'normal', gaya: 'ramah_teman', aksen: 'indonesia_netral', bahasa: 'semi_santai' },
    bentrok: !free
  };
}

// Jalan pintas dari DNA karakter (dna.gender dan dna.age_group memakai kunci yang sama dengan profil suara).
function defaultVoiceFromDna(dna, opts) { return defaultVoiceProfile(dna && dna.gender, dna && dna.age_group, opts); }

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
  else if (OPT.gender[p.gender] && v.gender !== 'netral' && v.gender !== p.gender) err('base_voice', `suara ${v.name} berjenis ${v.gender}, sedangkan profil ${p.gender}`);
  if (AKSEN_EKSPERIMEN.includes(p.aksen)) issues.push({ level: 'warn', field: 'aksen', msg: `aksen ${p.aksen} belum terbukti didukung (Sunda tidak ada di daftar bahasa TTS Google, Jawa masih pratinjau); uji dengar dulu, bawaan aman: indonesia_netral atau jakarta_santai` });
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

export { OPT, DEFAULTS, validateVoiceProfile, buildVoicePerformance, buildVoiceDirection, voiceConflicts, introLine, wordCount, INTRO_WORD_LIMIT, catalog, AKSEN_EKSPERIMEN, voicesForGender, defaultVoiceProfile, defaultVoiceFromDna };
