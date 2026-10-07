'use strict';
// Profil produk untuk planner video: peran foto, slot per arketipe, prompt analisis foto oleh AI, normalisasi hasil AI, dan validasi.
// Modul MURNI (tanpa jaringan). Dipakai bersama oleh website, Edge Function analyze-product, dan alat. Aturan yang ditegakkan di sini
// berasal dari planner dan lint yang sudah ada: slot harus milik arketipe, keyakinan minimal 0,6, foto berperan yang dibutuhkan slot harus ada,
// minimal 3 slot terpakai, teks Inggris tanpa kata Indonesia, dan tanpa kata klaim atau kata pemicu.
const SLOTS = require('../data/arketipe_slot_angle.json');
const KATA = require('../data/kata_terlarang.json');

// Peran dasar tersedia untuk semua arketipe. Peran tambahan hanya relevan bagi arketipe yang slot-nya menuntutnya (butuh_foto di katalog slot).
const ROLES_DASAR = ['depan', 'closeup', 'tekstur', 'samping', 'belakang', 'label'];
const ROLES_TAMBAHAN = ['variasi', 'sol', 'interior', 'isi_kotak', 'set', 'izin_klien'];
const ROLES = ROLES_DASAR.concat(ROLES_TAMBAHAN);
const LABEL_ROLE = { depan: 'Depan', closeup: 'Close-up', tekstur: 'Tekstur', samping: 'Samping', belakang: 'Belakang', label: 'Label', variasi: 'Variasi cara pakai', sol: 'Sol (bagian bawah)', interior: 'Bagian dalam / kompartemen', isi_kotak: 'Isi kotak', set: 'Isi set', izin_klien: 'Izin klien (bukan foto produk)' };
// Peran yang bukan foto produk: tidak dikirim ke AI dan tidak dideskripsikan.
const ROLES_BUKAN_PRODUK = ['izin_klien'];
const MAX_FOTO = 6, MIN_SLOT = 3, MIN_KEYAKINAN = 0.6, MAX_TEKS = 140, MAX_FAKTA = 8, MAX_WARNA = 6;

function slotsFor(archetypeId) {
  const a = SLOTS.arketipe[archetypeId]; if (!a || !Object.prototype.hasOwnProperty.call(SLOTS.arketipe, archetypeId)) return null;
  return a.slot.map(s => ({ key: s.key, nama: s.nama, butuh_foto: s.butuh_foto.slice(), beat: s.beat }));
}

// Peran yang boleh dipilih untuk sebuah arketipe: semua peran dasar, ditambah peran yang dituntut slot arketipe itu.
function peranUntuk(archetypeId) {
  const slots = slotsFor(archetypeId); if (!slots) return null;
  const extra = []; for (const s of slots) for (const r of s.butuh_foto) if (!ROLES_DASAR.includes(r) && !extra.includes(r)) extra.push(r);
  return ROLES_DASAR.concat(extra);
}

// Pencocokan kata utuh tanpa peduli huruf besar-kecil (sama dengan lint.js).
function kataTerdeteksi(text, words) {
  const low = String(text == null ? '' : text).toLowerCase(); const found = [];
  for (const w of words) { const re = new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i'); if (re.test(low)) found.push(w); }
  return found;
}
const bersih = (t, max = MAX_TEKS) => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Teks Indonesia (fokus panel): tanpa kata pemicu dan tanpa kata klaim.
function masalahTeksId(t) {
  const m = []; const b = kataTerdeteksi(t, KATA.banned_always.concat(KATA.banned_in_image_text)); if (b.length) m.push(`memuat kata pemicu: ${b.join(', ')}`);
  const c = kataTerdeteksi(t, KATA.claim_words); if (c.length) m.push(`memuat kata klaim yang tidak terverifikasi: ${c.join(', ')}`); return m;
}
// Teks Inggris (masuk JSON video): tanpa kata Indonesia, tanpa kata klaim, tanpa kata pemicu.
function masalahTeksEn(t) {
  const m = masalahTeksId(t); const i = kataTerdeteksi(t, KATA.indo_hint); if (i.length) m.push(`memuat kata Indonesia: ${i.slice(0, 4).join(', ')} (tulis dalam bahasa Inggris)`); return m;
}

// ───────────── Validasi profil ─────────────
// profil: { facts[], facts_en[], colors[], details:[{slot_key, text, text_en, label, confidence}] }; roles = peran foto produk (dari kolom photos).
function validateProfile(profil, archetypeId, roles = []) {
  const issues = []; const add = (level, field, msg) => issues.push({ level, field, msg });
  const slots = slotsFor(archetypeId);
  if (!slots) { add('error', 'archetype', `arketipe "${archetypeId}" tidak dikenal`); return { issues, slots: [], usable: [], ready: false }; }
  const p = profil && typeof profil === 'object' && !Array.isArray(profil) ? profil : {};
  const peran = new Set(Array.isArray(roles) ? roles : []);
  if (!peran.size) add('error', 'photos', 'Belum ada foto produk');
  for (const r of peran) if (!ROLES.includes(r)) add('error', 'photos', `peran foto "${r}" tidak dikenal. Pilihan: ${ROLES.join(', ')}`);
  if (Array.isArray(roles) && roles.length > MAX_FOTO) add('error', 'photos', `maksimal ${MAX_FOTO} foto`);

  const listTeks = (nama, arr, max, cek) => {
    if (arr == null) return;
    if (!Array.isArray(arr)) { add('error', nama, 'harus berupa daftar'); return; }
    if (arr.length > max) add('error', nama, `maksimal ${max} butir`);
    arr.forEach((t, i) => { if (typeof t !== 'string' || !bersih(t)) { add('error', `${nama}[${i}]`, 'kosong atau bukan teks'); return; } for (const m of cek(t)) add('error', `${nama}[${i}]`, m); });
  };
  listTeks('facts', p.facts, MAX_FAKTA, masalahTeksId); listTeks('facts_en', p.facts_en, MAX_FAKTA, masalahTeksEn); listTeks('colors', p.colors, MAX_WARNA, masalahTeksEn);

  const byKey = new Map(slots.map(s => [s.key, s])); const lihat = new Set(); const usable = [];
  const details = Array.isArray(p.details) ? p.details : []; if (p.details != null && !Array.isArray(p.details)) add('error', 'details', 'harus berupa daftar');
  details.forEach((d, i) => {
    const f = `details[${i}]`;
    if (!d || typeof d !== 'object') { add('error', f, 'bukan objek'); return; }
    const s = byKey.get(d.slot_key);
    if (!s) { add('error', f, `slot "${String(d.slot_key).slice(0, 40)}" bukan milik arketipe ${archetypeId}. Pilihan: ${slots.map(x => x.key).join(', ')}`); return; }
    if (lihat.has(d.slot_key)) { add('error', f, `slot "${d.slot_key}" terisi dua kali`); return; } lihat.add(d.slot_key);
    const id = bersih(d.text), en = bersih(d.text_en); let ok = true;
    if (!id) { add('error', `${f}.text`, `slot "${s.nama}": teks Indonesia kosong`); ok = false; } else for (const m of masalahTeksId(id)) { add('error', `${f}.text`, `slot "${s.nama}": ${m}`); ok = false; }
    if (!en) { add('error', `${f}.text_en`, `slot "${s.nama}": teks Inggris wajib (dipakai di JSON video)`); ok = false; } else for (const m of masalahTeksEn(en)) { add('error', `${f}.text_en`, `slot "${s.nama}": ${m}`); ok = false; }
    if (d.label != null && !bersih(d.label, 40)) add('warn', `${f}.label`, `slot "${s.nama}": label kosong; nama slot dipakai`);
    const c = d.confidence == null ? 1 : Number(d.confidence);
    if (!Number.isFinite(c) || c < 0 || c > 1) { add('error', `${f}.confidence`, `slot "${s.nama}": keyakinan harus 0 sampai 1`); ok = false; }
    else if (c < MIN_KEYAKINAN) add('warn', `${f}.confidence`, `slot "${s.nama}": keyakinan ${c} di bawah ${MIN_KEYAKINAN}, tidak dipakai planner; periksa lalu naikkan bila sudah benar`);
    const kurang = s.butuh_foto.filter(r => !peran.has(r));
    if (kurang.length) add('warn', f, `slot "${s.nama}" butuh foto berperan ${kurang.map(r => LABEL_ROLE[r] || r).join(', ')}; tanpa itu slot tidak dipakai`);
    if (ok && Number.isFinite(c) && c >= MIN_KEYAKINAN && !kurang.length) usable.push(d.slot_key);
  });
  if (usable.length < MIN_SLOT) add('error', 'details', `Baru ${usable.length} slot yang bisa dipakai planner; butuh minimal ${MIN_SLOT}. Lengkapi detail slot atau tambah foto yang dibutuhkan`);
  const status = slots.map(s => {
    const kurang = s.butuh_foto.filter(r => !peran.has(r));
    return { key: s.key, nama: s.nama, butuh_foto: s.butuh_foto, fotoOk: !kurang.length, terisi: lihat.has(s.key), dipakai: usable.includes(s.key) };
  });
  return { issues, slots: status, usable, ready: !issues.some(i => i.level === 'error') };
}

// ───────────── Profil siap planner ─────────────
// Baris ugc_products -> bentuk yang dibaca buildPanelPlan. Peran foto SELALU diambil dari kolom photos (bukan disalin ke profile).
function profilUntukPlanner(row) {
  const p = (row && row.profile) || {}; const photos = Array.isArray(row && row.photos) ? row.photos : [];
  return { photos: photos.map(x => ({ role: x.role })), facts: p.facts || [], facts_en: p.facts_en || [], colors: p.colors || [], details: Array.isArray(p.details) ? p.details : [] };
}

// ───────────── Prompt analisis foto ─────────────
const RESPONSE_FORMAT = { type: 'json_object' };
function buildAnalysisMessages({ archetypeId, kategori = '', roles = [] }) {
  const slots = slotsFor(archetypeId); if (!slots) throw new Error(`arketipe "${archetypeId}" tidak dikenal`);
  if (!Array.isArray(roles) || roles.length > MAX_FOTO || roles.some(r => !ROLES.includes(r))) throw new Error('peran foto tidak valid');
  const dilihat = roles.filter(r => !ROLES_BUKAN_PRODUK.includes(r));   // 'izin_klien' bukan foto produk: tidak masuk analisis
  if (!dilihat.length) throw new Error('tidak ada foto produk untuk dianalisis');
  const slotText = slots.map(s => `- "${s.key}": ${s.nama}${s.butuh_foto.length ? ` (hanya bila ada foto berperan: ${s.butuh_foto.join(', ')})` : ''}`).join('\n');
  const fotoText = dilihat.map((r, i) => `Foto ${i + 1}: peran "${r}"`).join('\n');
  const system = [
    'You describe a product for a short UGC video storyboard. Look ONLY at the attached photos and describe what is visibly there.',
    'Reply with ONE JSON object and nothing else (no markdown, no commentary).',
    '',
    'JSON shape:',
    '{ "fakta_id": ["..."], "fakta_en": ["..."], "warna": ["..."], "detail": [ { "slot": "<slot key>", "teks_id": "...", "teks_en": "...", "label": "...", "keyakinan": 0.0 } ], "peringatan": ["..."] }',
    '',
    'Rules:',
    `- "fakta_id" and "fakta_en": 3 to ${MAX_FAKTA} short visible facts (shape, material look, print, closure, parts). Same facts in both languages.`,
    '- "teks_id" is plain Indonesian; "teks_en" is plain English (no Indonesian words at all). Each at most 12 words, describing one visible detail of that slot.',
    '- "label" is a 1 to 3 word Indonesian label for the detail (for example "kerah", "motif").',
    `- "warna": up to ${MAX_WARNA} simple English color names of the product itself (for example "light gray", "dusty pink"). English only.`,
    '- Use only the slot keys listed below. Skip a slot when its detail is not visible in any photo. Never invent features, sizes, ingredients, or materials you cannot see.',
    '- "keyakinan" is your honest confidence from 0 to 1 that the detail is correct and visible.',
    '- NO claims or benefits and no marketing words. Never use these words in any language: ' + KATA.claim_words.concat(KATA.banned_always, KATA.banned_in_image_text).join(', ') + '.',
    '- No brand names, prices, discounts, shop names, or readable promotional text. If printed label text is hard to read, do not guess it; add a note in "peringatan".',
    '- No people or body descriptions. Describe the product only.',
    '- "peringatan": short Indonesian notes about anything unclear (blurry photo, hidden side, unreadable label). Empty list if none.'
  ].join('\n');
  const user = [
    kategori ? `Kategori produk (hanya konteks, jangan dijadikan sumber fitur): ${bersih(kategori, 120)}` : '',
    `Arketipe: ${archetypeId}`,
    'Slot yang boleh diisi:', slotText, '', 'Foto terlampir berurutan:', fotoText
  ].filter(x => x !== '').join('\n');
  return { system, user };
}

// ───────────── Normalisasi hasil AI ─────────────
function bacaJsonLonggar(teks) {
  if (teks && typeof teks === 'object') return teks;
  let t = String(teks == null ? '' : teks).trim(); t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(t); } catch { /* coba ambil objek terluar */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; } }
  return null;
}
const daftarTeks = (v, max) => (Array.isArray(v) ? v : []).map(x => bersih(x)).filter(Boolean).slice(0, max);

// raw = teks atau objek dari AI. Mengembalikan { ok, profile, catatan, dibuang, issues, slots, usable, ready }. Tidak pernah melempar karena isi AI.
function normalizeAnalysis(raw, { archetypeId, roles = [] }) {
  const j = bacaJsonLonggar(raw);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, galat: 'Jawaban AI bukan JSON yang bisa dibaca', profile: null, catatan: [], dibuang: [], issues: [], slots: [], usable: [], ready: false };
  const slots = slotsFor(archetypeId); const valid = new Set((slots || []).map(s => s.key)); const dibuang = []; const seen = new Set(); const details = [];
  for (const d of Array.isArray(j.detail) ? j.detail : []) {
    if (!d || typeof d !== 'object') { dibuang.push('butir detail bukan objek'); continue; }
    const key = String(d.slot == null ? '' : d.slot).trim();
    if (!valid.has(key)) { dibuang.push(`slot "${key.slice(0, 40)}" bukan milik arketipe ${archetypeId}`); continue; }
    if (seen.has(key)) { dibuang.push(`slot "${key}" muncul lagi, butir pertama dipakai`); continue; } seen.add(key);
    let c = Number(d.keyakinan); if (!Number.isFinite(c)) c = 0.7; c = Math.min(1, Math.max(0, c));
    details.push({ slot_key: key, text: bersih(d.teks_id), text_en: bersih(d.teks_en), label: bersih(d.label, 40) || key, confidence: Math.round(c * 100) / 100 });
  }
  const profile = { facts: daftarTeks(j.fakta_id, MAX_FAKTA), facts_en: daftarTeks(j.fakta_en, MAX_FAKTA), colors: daftarTeks(j.warna, MAX_WARNA), details };
  const catatan = daftarTeks(j.peringatan, 8);
  const v = validateProfile(profile, archetypeId, roles);
  return { ok: true, profile, catatan, dibuang, issues: v.issues, slots: v.slots, usable: v.usable, ready: v.ready };
}

module.exports = { ROLES, ROLES_DASAR, ROLES_TAMBAHAN, ROLES_BUKAN_PRODUK, peranUntuk, LABEL_ROLE, MAX_FOTO, MIN_SLOT, MIN_KEYAKINAN, MAX_TEKS, RESPONSE_FORMAT, slotsFor, validateProfile, profilUntukPlanner, buildAnalysisMessages, normalizeAnalysis, masalahTeksId, masalahTeksEn, bacaJsonLonggar };
