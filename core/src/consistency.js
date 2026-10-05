'use strict';
// Pemeriksa kesesuaian satu set prompt: rencana panel → prompt storyboard → JSON video.
// Tidak memanggil model apa pun dan tidak memakai kredit. Menangkap ketidakcocokan SEBELUM storyboard dibuat dan job diantrekan:
// panel yang berbeda urutan, deskripsi karakter yang berubah, kalimat bergender yang salah, atau JSON yang mengira storyboard
// memuat tulisan padahal bersih.
const { lintVideoJson, lintStoryboardText } = require('./lint');

const FEMALE = /\b(woman|women|girl|she|her|hers|female|lady)\b/i;
const MALE = /\b(man|men|boy|he|him|his|male|gentleman)\b/i;

// Kepala panel pada storyboard harus muncul berurutan 1..5.
function heads_inOrder(panels, sb) {
  const pos = panels.map(q => sb.search(new RegExp(`^(Panel ${q.n}\\b|PANEL 0?${q.n}\\b)`, 'm')));
  return pos.every(x => x >= 0) && pos.every((x, i) => i === 0 || x > pos[i - 1]);
}
function issuesOf(fn, x) { try { const r = fn(x); return Array.isArray(r) ? r : (r && r.issues) || []; } catch (e) { return [{ level: 'error', why: 'lint gagal: ' + e.message }]; } }
function strings(v, path = '', out = []) {
  if (typeof v === 'string') out.push([path, v]);
  else if (Array.isArray(v)) v.forEach(x => strings(x, path, out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) strings(v[k], path ? `${path}.${k}` : k, out);
  return out;
}

/**
 * set: { plan, storyboardPrompt, json (teks), variant: 'documented'|'clean', characterProfile, characterPhotoAttached, flowCharacterName }
 * Mengembalikan { errors:[...], warnings:[...], stats:{...} }. Galat berarti set ini tidak boleh dipakai.
 */
function checkPromptSet(set) {
  const { plan, storyboardPrompt, json, variant = 'documented', characterProfile = null, characterPhotoAttached = false, flowCharacterName = null } = set;
  const errors = [], warnings = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);

  let o;
  try { o = JSON.parse(json); } catch (e) { return { errors: ['JSON video bukan JSON yang valid: ' + e.message], warnings, stats: {} }; }
  const sb = String(storyboardPrompt || '');

  // 1. Struktur dan urutan panel: storyboard dan JSON harus menceritakan lima adegan yang sama, dengan urutan yang sama
  const panels = plan.panels || [];
  if (panels.length !== 5) err(`rencana punya ${panels.length} panel, seharusnya 5`);
  if (!Array.isArray(o.timeline) || o.timeline.length !== 5) err(`timeline JSON punya ${o.timeline && o.timeline.length} adegan, seharusnya 5`);
  panels.forEach((p, i) => {
    const sc = o.timeline && o.timeline[i]; if (!sc) return;
    const focus = p.focus_en || p.focus;
    if (!String(sc.time).startsWith(p.time)) err(`adegan ${i + 1}: waktu JSON "${sc.time}" berbeda dari rencana ${p.time}`);
    if (String(sc.product_focus) !== focus) err(`adegan ${i + 1}: product_focus JSON tidak memuat fokus rencana "${focus}"`);
    // Blok panel n pada storyboard: dari kepala panel n sampai kepala panel berikutnya. Fokus dan sudut harus ada DI DALAM blok itu,
    // sehingga urutan panel terjamin tanpa mencari teks di seluruh dokumen (fokus satu panel bisa menjadi potongan fokus panel lain).
    const heads = panels.map(q => sb.search(new RegExp(`^(Panel ${q.n}\\b|PANEL 0?${q.n}\\b)`, 'm')));
    if (heads[i] < 0) err(`prompt storyboard tidak memuat panel ${p.n}`);
    else {
      const next = heads.slice(i + 1).find(h => h > heads[i]);
      const block = sb.slice(heads[i], next === undefined ? sb.length : next);
      if (i > 0 && i < 4 && !block.includes(focus)) err(`panel ${p.n}: storyboard tidak menyebut fokus "${focus}" pada panel itu`);
      if (p.angle_prompt && !block.includes(p.angle_prompt.slice(0, 40))) err(`panel ${p.n}: sudut kamera di storyboard berbeda dari rencana`);
    }
  });
  if (!heads_inOrder(panels, sb)) err('urutan panel pada prompt storyboard berbeda dari rencana');
  // dialog menyebut hal yang sama dengan adegan
  const st = o.dialogue && o.dialogue.script_generation && o.dialogue.script_generation.structure;
  if (st) [['2.0-4.0', 1], ['4.0-6.0', 2], ['6.0-8.0', 3]].forEach(([k, i]) => { const f = panels[i].focus_en || panels[i].focus; if (String(st[k] || '') !== `Mention: ${f}.`) err(`dialog ${k} tidak menyebut fokus panel ${i + 1} ("${f}")`); });

  // 2. Lokasi: sama di storyboard dan JSON
  if (plan.setting) {
    if (!sb.includes(plan.setting.prompt_en)) err('lokasi di prompt storyboard berbeda dari rencana');
    if (!o.environment || o.environment.description !== plan.setting.prompt_en) err('lokasi di JSON berbeda dari rencana');
  }

  // 3. Jenis storyboard: JSON harus cocok dengan apa yang dikirim
  const docOnly = /header text|Under the photo write|exactly these bullets|Bahasa Indonesia\./;
  if (variant === 'clean') {
    if (docOnly.test(sb)) err('storyboard "bersih" masih memuat instruksi tulisan atau label dokumen');
    if (!/No words, no letters, no numbers, no labels, no icons, no captions/i.test(sb)) err('storyboard "bersih" tidak menyatakan larangan tulisan');
    const refs = JSON.stringify(o.references || {});
    if (/storyboard document|inside the attached storyboard|character reference portrait/i.test(refs)) err('JSON merujuk "dokumen storyboard" atau potret rujukan di dalam storyboard, padahal storyboard bersih hanya berisi foto');
    if (!/five photo panels/i.test(refs)) err('JSON tidak menjelaskan bahwa storyboard adalah lima panel foto tanpa tulisan');
  } else if (/No words, no letters, no numbers/i.test(sb)) warn('storyboard bertulis memuat larangan tulisan: varian tidak konsisten');
  if (variant === 'clean' && !characterPhotoAttached && !flowCharacterName) warn('storyboard bersih tanpa foto wajah terpisah: identitas hanya bersumber dari wajah di panel foto (lebih lemah)');

  // 4. Karakter: deskripsi, jenis kelamin, hijab
  const cp = characterProfile;
  if (cp && cp.appearance_en) {
    if (!o.character || o.character.appearance !== cp.appearance_en) err('deskripsi penampilan di JSON berbeda dari profil karakter');
  } else warn('profil karakter tanpa deskripsi penampilan (appearance_en)');
  const idText = strings({ ref: o.references && o.references.character, voice: o.dialogue && o.dialogue.voice, id: o.character && o.character.identity_lock }).map(x => x[1]).join(' | ');
  if (cp && cp.gender === 'laki-laki' && FEMALE.test(idText)) err('karakter laki-laki, tetapi JSON memuat kata bergender perempuan pada rujukan atau suara');
  if (cp && cp.gender === 'perempuan' && MALE.test(idText)) err('karakter perempuan, tetapi JSON memuat kata bergender laki-laki pada rujukan atau suara');
  if (cp && cp.hijab) { if (!/hijab/i.test(idText)) err('karakter berhijab, tetapi JSON tidak menyebut hijab pada identitas'); if (/same hairstyle|same hair color/.test(idText)) err('karakter berhijab, tetapi kunci identitas masih menyebut gaya atau warna rambut'); }
  else if (cp && /hijab/i.test(idText)) err('karakter tanpa hijab, tetapi identitas menyebut hijab');
  if (cp && cp.gender) {
    const want = cp.gender === 'laki-laki' ? 'male' : 'female';
    if (!new RegExp(`\\b${want} voice`).test(o.dialogue.voice)) err(`suara dialog "${o.dialogue.voice}" tidak sesuai jenis kelamin karakter`);
  }

  // 5. Kata terlarang dan bahasa (memakai pemeriksa yang sudah ada)
  for (const i of issuesOf(lintVideoJson, json)) (i.level === 'error' ? err : warn)(`JSON: ${i.why || i.msg || JSON.stringify(i)}${i.word ? ' [' + i.word + ']' : ''}`);
  for (const i of issuesOf(lintStoryboardText, sb)) (i.level === 'error' ? err : warn)(`storyboard: ${i.why || i.msg || JSON.stringify(i)}${i.word ? ' [' + i.word + ']' : ''}`);
  const sbNoSpec = variant === 'clean' ? sb : '';
  if (variant === 'clean' && /\b(TikTok|Instagram|Shopee|Tokopedia|keranjang|checkout|promo|diskon)\b/i.test(sbNoSpec)) err('storyboard bersih memuat kata platform atau promosi');

  // 6. Panjang (pemantau pergeseran, bukan aturan)
  if (json.length > 13000) warn(`JSON ${json.length} karakter: lebih panjang dari ukuran acuan v2.3 (±11.000)`);
  return { errors, warnings, stats: { json_chars: json.length, storyboard_chars: sb.length, order: panels.slice(1, 4).map(p => p.slot).join('>') } };
}

module.exports = { checkPromptSet };
