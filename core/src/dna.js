'use strict';
// DNA karakter terstruktur. Satu sumber untuk: (1) deskripsi penampilan di JSON video (character.appearance), (2) prompt pembuat wajah,
// (3) prompt lembar 7 sudut. Pilihan berupa kunci Indonesia (untuk antarmuka) yang dipetakan ke frasa Inggris (untuk model).
//
// ATURAN TETAP:
//  - Karakter HARUS dewasa (21 tahun ke atas). Tidak ada kelompok usia di bawahnya, dan kata yang menyiratkan anak atau remaja ditolak.
//  - Pakaian BUKAN bagian identitas. Pakaian karakter hanya produk. Wajah dan lembar dibuat dengan atasan polos netral.
//  - Kata "Indonesian" tidak dipakai pada deskripsi orang (menggeser wajah ke tampilan umum); lihat catatan v2.3.
const AGE = {
  dewasa_muda: { phrase: 'in {pos} early twenties', adj: 'young', years: '21 to 24' },
  muda: { phrase: 'in {pos} mid to late twenties', adj: 'young', years: '25 to 29' },
  dewasa: { phrase: 'in {pos} thirties', adj: '', years: '30 to 39' },
  matang: { phrase: 'in {pos} forties', adj: 'mature', years: '40 to 49' }
};
const FACE = { oval: 'a soft oval face', bulat: 'a soft round face', lonjong: 'a long oval face', persegi: 'a square jaw', hati: 'a heart-shaped face' };
const COMPLEXION = { terang: 'a fair to light complexion', kuning_langsat: 'a light warm-beige complexion', sawo_matang: 'a warm medium-brown complexion', cokelat_tua: 'a deep brown complexion', gelap: 'a rich dark-brown complexion' };
const EYES = { almond: 'almond-shaped dark-brown eyes', bulat: 'large round dark-brown eyes', sipit_ringan: 'softly narrow dark-brown eyes' };
const EXPRESSION = { ceria: 'a bright cheerful smile', kalem: 'a calm gentle smile', profesional: 'a composed friendly expression', playful: 'a playful warm smile' };
const HAIR_LENGTH = { pendek: 'short', sebahu: 'shoulder-length', panjang: 'long' };
const HAIR_TEXTURE = { lurus: 'straight', bergelombang: 'wavy', ikal: 'curly' };
const HAIR_COLOR = { hitam: 'black', cokelat_tua: 'dark-brown', cokelat_muda_karamel: 'light-brown' };
const HIGHLIGHT = { cokelat_muda_karamel: ' with soft caramel highlights' };
const PARTING = { tengah: ', parted in the middle', samping: ', side-parted' };
const BEARD = { tanpa: '', janggut_tipis: ', with light stubble', janggut_tebal: ', with a full neatly trimmed beard' };
const HIJAB_STYLE = { pasmina: 'draped pashmina', segi_empat: 'square', instan: 'instant slip-on', syari: 'long modest' };
const BUILD = { ramping: 'a slim build', sedang: 'a medium build', atletis: 'an athletic build' };
const GENDER = { perempuan: { noun: 'woman', pos: 'her' }, 'laki-laki': { noun: 'man', pos: 'his' } };

const OPTIONS = { gender: Object.keys(GENDER), age_group: Object.keys(AGE), face_shape: Object.keys(FACE), complexion: Object.keys(COMPLEXION), eyes: Object.keys(EYES), expression: Object.keys(EXPRESSION),
  hair_length: Object.keys(HAIR_LENGTH), hair_texture: Object.keys(HAIR_TEXTURE), hair_color: Object.keys(HAIR_COLOR), parting: Object.keys(PARTING), beard: Object.keys(BEARD), hijab_style: Object.keys(HIJAB_STYLE), build: Object.keys(BUILD) };

const FORBIDDEN_KEYS = { outfit: 'pakaian bukan bagian identitas (pakaian karakter hanya produk)', clothing: 'pakaian bukan bagian identitas', pakaian: 'pakaian bukan bagian identitas', body_type: 'gunakan "build" (ramping, sedang, atletis)', age: 'gunakan age_group (dewasa_muda, muda, dewasa, matang)' };
const MINOR_WORDS = /\b(teen(ager|age)?|girl|boy|child(ren)?|kid(s)?|minor|underage|under-age|schoolgirl|schoolboy|student|juvenile|youthful|baby|infant|toddler|remaja|anak|bocah|abg|smp|sma|childlike|childish|childhood|schoolchild|boyish|girlish|babyish|babyfaced|babyface|preteen|pre-teen|tween|adolescent|prepubescent)\b/i;
const KNOWN = new Set(['gender', 'age_group', 'face_shape', 'complexion', 'eyes', 'expression', 'hair_length', 'hair_texture', 'hair_color', 'parting', 'beard', 'hijab', 'hijab_style', 'hijab_color', 'build', 'distinguishing', 'appearance_en']);

// Mengembalikan daftar masalah (kosong = valid). Setiap masalah: { field, msg }.
function validateDna(dna) {
  const issues = []; const err = (field, msg) => issues.push({ field, msg });
  if (!dna || typeof dna !== 'object' || Array.isArray(dna)) return [{ field: 'dna', msg: 'DNA harus berupa objek' }];
  for (const k of Object.keys(dna)) {
    if (FORBIDDEN_KEYS[k]) err(k, FORBIDDEN_KEYS[k]);
    else if (!KNOWN.has(k)) err(k, `kolom "${k}" tidak dikenal`);
  }
  const need = (f, opts) => { if (dna[f] == null || dna[f] === '') err(f, 'wajib diisi'); else if (opts && !opts.includes(dna[f])) err(f, `nilai "${dna[f]}" tidak dikenal. Pilihan: ${opts.join(', ')}`); };
  need('gender', OPTIONS.gender);
  if (dna.age_group != null && /^(remaja|anak|bocah|abg)/i.test(String(dna.age_group))) err('age_group', 'karakter harus dewasa (21 tahun ke atas); kelompok usia di bawahnya tidak tersedia');
  else need('age_group', OPTIONS.age_group);
  need('face_shape', OPTIONS.face_shape); need('complexion', OPTIONS.complexion); need('expression', OPTIONS.expression);
  for (const f of ['eyes', 'build', 'parting']) if (dna[f] != null && !OPTIONS[f === 'parting' ? 'parting' : f].includes(dna[f])) err(f, `nilai "${dna[f]}" tidak dikenal. Pilihan: ${OPTIONS[f].join(', ')}`);
  const hijab = dna.hijab === true;
  if (dna.hijab != null && typeof dna.hijab !== 'boolean') err('hijab', 'harus true atau false');
  if (hijab) {
    if (dna.gender && dna.gender !== 'perempuan') err('hijab', 'hijab hanya untuk karakter perempuan');
    need('hijab_style', OPTIONS.hijab_style);
    if (!dna.hijab_color) err('hijab_color', 'wajib diisi (bahasa Inggris, mis. "dusty pink")');
    else if (!/^[a-z][a-z \-]{2,30}$/i.test(dna.hijab_color)) err('hijab_color', 'hanya huruf Inggris, spasi, atau tanda hubung (maksimal 31 karakter)');
    for (const f of ['hair_length', 'hair_texture', 'hair_color', 'parting']) if (dna[f] != null) err(f, 'tidak dipakai bila karakter berhijab');
  } else {
    need('hair_length', OPTIONS.hair_length); need('hair_texture', OPTIONS.hair_texture); need('hair_color', OPTIONS.hair_color);
    if (dna.hijab_style != null || dna.hijab_color != null) err('hijab', 'hijab_style dan hijab_color hanya bila hijab: true');
  }
  if (dna.gender === 'laki-laki' ? false : dna.beard != null) err('beard', 'beard hanya untuk karakter laki-laki');
  if (dna.beard != null && !OPTIONS.beard.includes(dna.beard)) err('beard', `nilai "${dna.beard}" tidak dikenal. Pilihan: ${OPTIONS.beard.join(', ')}`);
  if (dna.distinguishing != null) {
    const d = String(dna.distinguishing);
    if (d.length > 120) err('distinguishing', 'maksimal 120 karakter');
    if (MINOR_WORDS.test(d)) err('distinguishing', 'mengandung kata yang menyiratkan anak atau remaja; karakter harus dewasa');
    if (/\b(Indonesian|outfit|wearing|dress|shirt|top|trousers)\b/i.test(d)) err('distinguishing', 'jangan menyebut pakaian atau kata "Indonesian"; hanya ciri wajah');
    if (/[^\x20-\x7E]/.test(d)) err('distinguishing', 'tulis dalam bahasa Inggris tanpa karakter khusus');
  }
  return issues;
}
function assertValid(dna) { const i = validateDna(dna); if (i.length) throw new Error('DNA tidak valid: ' + i.map(x => `${x.field}: ${x.msg}`).join('; ')); }

function who(dna) { const g = GENDER[dna.gender]; return { ...g, Pos: g.pos[0].toUpperCase() + g.pos.slice(1) }; }
function agePhrase(dna) { return AGE[dna.age_group].phrase.replace('{pos}', who(dna).pos); }

// Deskripsi penampilan (Inggris) untuk JSON video. DNA C02 menghasilkan tepat kalimat yang dipakai uji di Flow.
function dnaToAppearance(dna) {
  assertValid(dna); const w = who(dna); const age = AGE[dna.age_group];
  const head = `A ${[age.adj, w.noun].filter(Boolean).join(' ')} ${agePhrase(dna)}`;
  const parts = [];
  if (dna.hijab === true) parts.push(`wearing a ${dna.hijab_color.toLowerCase()} ${HIJAB_STYLE[dna.hijab_style]} hijab`);
  else parts.push(`with ${HAIR_LENGTH[dna.hair_length]}, ${HAIR_TEXTURE[dna.hair_texture]}, ${HAIR_COLOR[dna.hair_color]} hair${HIGHLIGHT[dna.hair_color] || ''}${dna.parting ? PARTING[dna.parting] : ''}${dna.gender === 'laki-laki' && dna.beard ? BEARD[dna.beard] : ''}`);
  parts.push(FACE[dna.face_shape]);
  if (dna.eyes) parts.push(EYES[dna.eyes]);
  parts.push(COMPLEXION[dna.complexion]);
  if (dna.build) parts.push(BUILD[dna.build]);
  if (dna.distinguishing) parts.push(String(dna.distinguishing).trim().replace(/[.]+$/, ''));
  parts.push(EXPRESSION[dna.expression]);
  const last = parts.pop();
  return `${head} ${parts.join(', ')}, and ${last}.`;
}
// Profil karakter untuk buildVideoJson.
function dnaToProfile(dna) { return { appearance_en: dnaToAppearance(dna), gender: dna.gender, age_group: dna.age_group, hijab: dna.hijab === true }; }

// ───────────── Prompt gambar ─────────────
const OUTFIT_TOP = 'a plain white crew-neck top', OUTFIT_TOP_HIJAB = 'a plain white long-sleeve top';
const OUTFIT_FULL = 'a plain white crew-neck top and plain mid-grey straight trousers', OUTFIT_FULL_HIJAB = 'a plain white long-sleeve top and a plain mid-grey long straight skirt';
const outfit = (dna, full) => (dna.hijab === true ? (full ? OUTFIT_FULL_HIJAB : OUTFIT_TOP_HIJAB) : (full ? OUTFIT_FULL : OUTFIT_TOP));
const BASE = 'Plain light-grey seamless background. Soft natural window light, natural everyday photo look, realistic complexion texture, no retouching. No text, no logo, no watermark, no border.';
const VARIATION = ['natural, slightly asymmetrical features', 'slightly fuller cheeks', 'slightly more defined cheekbones', 'a softer jawline'];

const ANGLES = {
  face_front: 'Close-up portrait, head and shoulders, facing the camera directly at eye level',
  face_left: 'Close-up portrait, head and shoulders, head turned to show the LEFT side of the face in a three-quarter view, eyes toward the camera',
  face_right: 'Close-up portrait, head and shoulders, head turned to show the RIGHT side of the face in a three-quarter view, eyes toward the camera',
  half_front: 'Half-length shot from the front at eye level, standing relaxed, arms at the sides',
  full_front: 'Full-length shot from the front at eye level, standing relaxed, feet visible',
  full_side: 'Full-length shot in profile, standing relaxed, feet visible',
  full_back: 'Full-length shot from behind, standing relaxed, back to the camera, face not visible'
};
const FULL_ANGLES = new Set(['full_front', 'full_side', 'full_back', 'half_front']);

// ───────────── Foto acuan (opsional) ─────────────
// Foto acuan BUKAN wajah karakter. Ia hanya bahan kemiripan bagi generator; wajah karakter adalah hasil generate yang dipilih.
// Hubungan menjelaskan kaitan orang di foto dengan karakter. Bila DNA bertentangan dengan foto (jenis kelamin, usia, rambut), DNA MENANG.
const HUBUNGAN = {
  orang_sama: { label: 'Orang yang sama', same: true, en: () => 'the same person as in the reference photo' },
  kakak: { label: 'Kakak', en: g => `the older ${g === 'laki-laki' ? 'brother' : 'sister'} of the person in the reference photo` },
  adik: { label: 'Adik', en: g => `the younger ${g === 'laki-laki' ? 'brother' : 'sister'} of the person in the reference photo` },
  saudara: { label: 'Saudara (sepupu)', en: () => 'a cousin of the person in the reference photo, with a family resemblance' },
  ibu: { label: 'Ibu', gender: 'perempuan', en: () => 'the mother of the person in the reference photo' },
  ayah: { label: 'Ayah', gender: 'laki-laki', en: () => 'the father of the person in the reference photo' },
  mirip_bukan_sama: { label: 'Mirip, tetapi bukan orang yang sama', en: () => 'a different person who only loosely resembles the person in the reference photo, clearly NOT the same person' }
};
const NOTE_MAX = 200;
const NOTE_MINOR = /\b(teen(ager|age)?|girl|boy|child(ren)?|kid(s)?|minor|underage|under-age|schoolgirl|schoolboy|juvenile|baby|infant|toddler|remaja|bocah|abg|balita|bayi|childlike|childish|childhood|schoolchild|boyish|girlish|babyish|babyfaced|babyface|preteen|pre-teen|tween|adolescent|prepubescent)\b/i;   // "anak sulung" tetap boleh (kakak)
// Catatan yang menyiratkan anak atau remaja: kata tertentu, frasa "anak kecil/muda/sekolah", atau angka usia di bawah 21.
const NOTE_MINOR_PHRASE = /\banak[- ](kecil|muda|belasan|sekolah|remaja|di ?bawah ?umur|balita|perempuan kecil|laki-laki kecil)\b|\b(masih|seperti|mirip|kayak) (anak|bocah)\b|\bbelum dewasa\b|\bdi ?bawah ?umur\b|\bhigh ?school\b|\bpelajar\b|\bsiswa\b|\bsiswi\b/i;
function noteMentionsMinor(n) {
  if (NOTE_MINOR.test(n) || NOTE_MINOR_PHRASE.test(n)) return true;
  // Selisih usia ("lebih tua 5 tahun", "5 tahun lebih muda") bukan usia karakter, jadi dikeluarkan sebelum angka diperiksa.
  n = n.replace(/\b(?:lebih (?:tua|muda)|selisih|beda(?:nya)?|older|younger|apart)\s*(?:by|sekitar|kira-kira|about|around)?\s*\d{1,2}\s*(?:tahun|thn|th|years?)?/gi, ' ').replace(/\b\d{1,2}\s*(?:tahun|thn|th|years?)\s*(?:lebih (?:tua|muda)|older|younger)/gi, ' ');
  const re = /(?:\b(?:umur|usia|age|aged|berumur)\s*(?:sekitar|kira-kira|about|around)?\s*(\d{1,2})\b)|(?:\b(\d{1,2})\s*(?:tahun|thn|th|years?|yo|y\/o)\b)/gi; let m;
  while ((m = re.exec(n))) { const a = Number(m[1] || m[2]); if (a >= 1 && a <= 20) return true; }
  return false;
}
function cleanNote(note) { return String(note == null ? '' : note).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').replace(/"/g, "'").trim(); }
// Masalah pada hubungan dan catatan terhadap DNA (kosong = valid). Setiap masalah: { field, msg }.
function validateReference(ref, dna) {
  const issues = []; const err = (field, msg) => issues.push({ field, msg });
  if (!ref || typeof ref !== 'object') return [{ field: 'acuan', msg: 'data acuan tidak ada' }];
  const h = HUBUNGAN[ref.relation];
  if (!h) err('relation', `hubungan "${ref.relation}" tidak dikenal. Pilihan: ${Object.keys(HUBUNGAN).join(', ')}`);
  else if (h.gender && dna && dna.gender && dna.gender !== h.gender) err('relation', `hubungan "${h.label}" hanya untuk karakter ${h.gender}; DNA berjenis kelamin ${dna.gender}`);
  const n = cleanNote(ref.note);
  if (n.length > NOTE_MAX) err('note', `catatan maksimal ${NOTE_MAX} karakter (sekarang ${n.length})`);
  if (noteMentionsMinor(n)) err('note', 'catatan menyiratkan anak atau remaja (kata, frasa, atau usia di bawah 21); karakter harus dewasa');
  return issues;
}
function referenceBlock(dna, ref) {
  const h = HUBUNGAN[ref.relation]; const n = cleanNote(ref.note);
  const lines = [`REFERENCE PHOTO: one reference photo of a real-looking person is attached. The person to create is ${h.en(dna.gender)}.`,
    h.same ? 'Keep the same face as in the reference photo.' : 'Use the reference photo ONLY for family resemblance: facial structure and overall look. Do not copy the photo and do not reproduce the person in it.',
    'Where the description above differs from the reference photo (gender, age, hair, hijab, complexion, expression), the DESCRIPTION WINS.'];
  if (n) lines.push(`NOTE from the user (may be in Indonesian; guidance only): "${n}". The note can never change the adult age, the plain background, the plain top, or the rule of no text and no named real person.`);
  return lines.join(' ');
}

// Kandidat wajah (potret depan). index 1..4 memberi sedikit variasi struktur wajah supaya pilihan tidak identik.
// Asal wajah: petunjuk TAMPILAN UMUM wajah untuk prompt GAMBAR saja (mode "dari DNA"). Sengaja TIDAK menjadi bagian DNA dan TIDAK masuk
// kalimat penampilan di JSON video: kata asal pada deskripsi video dihindari (lihat aturan tetap di atas). Foto yang dipilih yang membawa
// tampilan itu ke Flow. Tidak dipakai bersama foto acuan, karena wajah mengikuti foto.
const ASAL_WAJAH = {
  asia_tenggara: 'natural Southeast Asian facial features',
  asia_timur: 'natural East Asian facial features',
  eropa_barat: 'natural European facial features',
  timur_tengah: 'natural Middle Eastern facial features',
  campuran: 'natural mixed-heritage facial features'
};
const adaAsal = k => typeof k === 'string' && Object.prototype.hasOwnProperty.call(ASAL_WAJAH, k);

function buildFacePrompt(dna, index = 1, ref = null, asal = null) {
  const appearance = dnaToAppearance(dna); const age = AGE[dna.age_group];
  if (asal != null && asal !== '') {
    if (ref) throw new Error('Asal wajah tidak dipakai bersama foto acuan: wajah mengikuti foto.');
    if (!adaAsal(asal)) throw new Error(`Asal wajah "${String(asal).slice(0, 30)}" tidak dikenal. Pilihan: ${Object.keys(ASAL_WAJAH).join(', ')}`);
  }
  const kalimatAsal = adaAsal(asal) ? ` The person has ${ASAL_WAJAH[asal]}.` : '';
  if (ref) { const bad = validateReference(ref, dna); if (bad.length) throw new Error('Foto acuan tidak valid: ' + bad.map(x => `${x.field}: ${x.msg}`).join('; ')); }
  const v = VARIATION[(Math.max(1, index) - 1) % VARIATION.length];
  if (ref) {   // dengan foto acuan: tanpa petunjuk variasi struktur wajah (agar tidak menjauh dari kemiripan), blok acuan sebelum perintah akhir
    return `Photorealistic close-up portrait photograph of one real-looking adult: ${appearance} The person is clearly an adult, apparent age ${age.years} years. Facing the camera at eye level, shoulders square, looking directly into the camera with a natural relaxed expression. Wearing ${outfit(dna, false)}. ${BASE}\n\n${referenceBlock(dna, ref)}\n\nGenerate the image now. Do not answer with text only and do not ask questions.`;
  }
  return `Photorealistic close-up portrait photograph of one real-looking adult: ${appearance}${kalimatAsal} The person is clearly an adult, apparent age ${age.years} years. Facing the camera at eye level, shoulders square, looking directly into the camera with a natural relaxed expression. Wearing ${outfit(dna, false)}. Facial structure: ${v}. ${BASE}\n\nGenerate the image now. Do not answer with text only and do not ask questions.`;
}
// Satu sudut lembar, dari gambar rujukan wajah terpilih.
function buildSheetPrompt(dna, angle) {
  if (!ANGLES[angle]) throw new Error(`sudut "${angle}" tidak dikenal. Pilihan: ${Object.keys(ANGLES).join(', ')}`);
  const appearance = dnaToAppearance(dna); const full = FULL_ANGLES.has(angle);
  const idPart = dna.hijab === true ? 'face, complexion, hijab (color and style), overall proportions, apparent age' : 'face, complexion, hair (color and style), overall proportions, apparent age';
  return `Photorealistic photograph of the SAME adult person shown in the reference image: ${appearance}\nIDENTITY: the reference image is the ONLY source of the person's identity (${idPart}). Do not change the person.\nSHOT: ${ANGLES[angle]}.\nCLOTHING: ${outfit(dna, full)}, the same in every photo of this set. ${BASE}\n\nGenerate the image now. Do not answer with text only and do not ask questions.`;
}
// Satu gambar berisi ketujuh sudut (tata letak kisi), dari gambar rujukan wajah terpilih.
function buildSheetGridPrompt(dna) {
  const appearance = dnaToAppearance(dna);
  const list = Object.entries(ANGLES).map(([k, v], i) => `Photo ${i + 1}: ${v}.`).join('\n');
  return `Create ONE image: a clean character reference sheet, a tidy grid of seven photorealistic photographs of the SAME adult person shown in the reference image, all on one plain light-grey background. Top row: photos 1 to 3. Bottom row: photos 4 to 7. Photographs only: no words, no letters, no numbers, no labels, no icons, no captions, no borders.\n\nThe person: ${appearance}\nIDENTITY: the reference image is the ONLY source of the person's identity. The same person, the same face, the same complexion, the same ${dna.hijab === true ? 'hijab' : 'hair'} in all seven photos.\nCLOTHING: ${outfit(dna, true)}, identical in every photo. Soft natural window light, natural everyday photo look, no retouching.\n\nPHOTOS:\n${list}\n\nGenerate the image now. Do not answer with text only and do not ask questions.`;
}

// Peringatan bila catatan bebas menyebut jenis kelamin yang bertentangan dengan DNA (DNA yang menang). Mengembalikan teks atau ''.
const KATA_L = '(?:laki[- ]?laki|lelaki|pria|cowok|male|man|boy)', KATA_P = '(?:perempuan|wanita|cewek|female|woman|girl)';
function peringatanKonflik(catatan, dna) {
  const t = String(catatan == null ? '' : catatan).toLowerCase(); if (!t.trim() || !dna || !dna.gender) return '';
  let g = null;
  const k = t.match(new RegExp(`\\b(?:kakak|adik|saudara|sepupu|ibu|ayah|orang|sosok|karakter|brother|sister|person)\\s+(?:yang\\s+)?(${KATA_L}|${KATA_P})\\b`));
  if (k) g = new RegExp(`^${KATA_L}$`).test(k[1]) ? 'laki-laki' : 'perempuan';
  else { const l = new RegExp(`\\b${KATA_L}\\b`).test(t), p = new RegExp(`\\b${KATA_P}\\b`).test(t); if (l !== p) g = l ? 'laki-laki' : 'perempuan'; }
  if (!g || g === dna.gender) return '';
  return `catatan menyebut ${g}, tetapi DNA berjenis kelamin ${dna.gender}. DNA yang menang, jadi hasilnya ${dna.gender}.`;
}

module.exports = { peringatanKonflik, ASAL_WAJAH, OPTIONS, ANGLES, HUBUNGAN, NOTE_MAX, validateDna, validateReference, dnaToAppearance, dnaToProfile, buildFacePrompt, buildSheetPrompt, buildSheetGridPrompt };
