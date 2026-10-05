'use strict';
// Pemeriksa kata pemicu. Dipakai untuk memastikan prompt storyboard, teks pada
// gambar, dan JSON video tidak memuat kata yang dicurigai memicu watermark,
// stiker, atau penolakan kebijakan.
const BANNED_ALWAYS = ['tiktok', 'affiliate', 'promo', 'diskon', 'checkout', 'google flow', 'tanpa teks', 'klik', 'link bio'];
const BANNED_IN_IMAGE_TEXT = ['keranjang', 'cta', 'beli', 'hook'];
const CLAIM_WORDS = ['nyaman', 'ringan', 'lembut', 'adem', 'flowy', 'empuk', 'awet', 'tahan lama', 'premium', 'berkualitas', 'terbaik', 'anti luntur'];
const BODY_TERMS = ['body', 'skin', 'anatomy', 'touch', 'bare', 'chest', 'waist', 'bust', 'thigh'];
// Kata yang membuat model menggambar layar kamera ponsel (video tampak seperti rekaman layar aplikasi kamera).
const PHONE_WORDS = ['smartphone', 'phone', 'handphone', 'ponsel'];
// Kata Indonesia yang lazim pada deskripsi produk. Di dalam JSON berbahasa Inggris, kalimat Indonesia mudah ditampilkan model sebagai tulisan di video.
const INDO_HINT = ['dengan', 'yang', 'dan', 'bagian', 'bulat', 'lengan', 'motif', 'panjang', 'depan', 'leher', 'resleting', 'kerah', 'warna', 'ruang', 'tamu', 'produk', 'tampil', 'kain', 'dasar', 'longgar', 'pendek'];
const PHONE_SAFE_KEYS = new Set(['negative_prompt', 'clean_frame', 'restriction', 'final_instruction']);

function hits(text, words) {
  const low = String(text).toLowerCase();
  const found = [];
  for (const w of words) {
    const re = new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i');
    if (re.test(low)) found.push(w);
  }
  return found;
}

// text = prompt untuk model gambar atau teks yang akan tampil pada gambar
function lintStoryboardText(text) {
  const issues = [];
  for (const w of hits(text, BANNED_ALWAYS)) issues.push({ level: 'error', word: w, why: 'kata pemicu' });
  for (const w of hits(text, BANNED_IN_IMAGE_TEXT)) issues.push({ level: 'error', word: w, why: 'kata ajakan pada gambar' });
  for (const w of hits(text, CLAIM_WORDS)) issues.push({ level: 'error', word: w, why: 'klaim yang tidak terverifikasi' });
  for (const w of hits(text, BODY_TERMS)) issues.push({ level: 'warn', word: w, why: 'istilah tubuh' });
  const noIcons = String(text).replace(/Do not draw any phone, camera, or app icons[^.]*\./gi, '');
  for (const w of hits(noIcons, PHONE_WORDS)) issues.push({ level: 'warn', word: w, why: 'kata ponsel: dapat membuat video tampak seperti layar kamera' });
  return issues;
}

// Mengumpulkan semua nilai teks pada JSON, kecuali di bawah kunci larangan (di sana kata "phone" justru dipakai untuk melarang).
function collectStrings(node, out = [], key = '') {
  if (PHONE_SAFE_KEYS.has(key)) return out;
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach(x => collectStrings(x, out, key));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) collectStrings(v, out, k);
  return out;
}

// JSON video: "keranjang kuning" hanya boleh muncul di dialog penutup (ucapan).
function lintVideoJson(jsonText) {
  const issues = [];
  let obj;
  try { obj = JSON.parse(jsonText); } catch { return [{ level: 'error', word: '(json)', why: 'JSON tidak valid' }]; }
  const copy = JSON.parse(jsonText);
  if (copy.dialogue && copy.dialogue.script_generation && copy.dialogue.script_generation.structure) {
    delete copy.dialogue.script_generation.structure['8.0-9.2'];
  }
  const text = JSON.stringify(copy);
  for (const w of hits(text, BANNED_ALWAYS)) issues.push({ level: 'error', word: w, why: 'kata pemicu' });
  for (const w of hits(text, ['keranjang', 'cta'])) issues.push({ level: 'error', word: w, why: 'ajakan di luar dialog penutup' });
  for (const w of hits(text, BODY_TERMS)) issues.push({ level: 'warn', word: w, why: 'istilah tubuh' });
  for (const w of hits(collectStrings(obj).join(' \n '), PHONE_WORDS)) issues.push({ level: 'warn', word: w, why: 'kata ponsel: dapat membuat video tampak seperti layar kamera' });
  const indo = hits(collectStrings(obj).filter(t => !/^Bahasa Indonesia$/i.test(t)).join(' \n '), INDO_HINT);
  if (indo.length) issues.push({ level: 'warn', word: indo.slice(0, 4).join(', '), why: 'kalimat Indonesia di JSON bisa tampil sebagai tulisan di video: tulis deskripsi produk dalam bahasa Inggris (text_en dan facts_en)' });
  if (!obj.timeline || obj.timeline.length !== 5) issues.push({ level: 'error', word: 'timeline', why: 'harus 5 scene' });
  return issues;
}

const hasErrors = (issues) => issues.some(i => i.level === 'error');
module.exports = { lintStoryboardText, lintVideoJson, hasErrors, BANNED_ALWAYS, CLAIM_WORDS, BODY_TERMS, PHONE_WORDS };
