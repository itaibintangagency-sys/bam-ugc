'use strict';
// Ruang karakter (offline): data yang berlaku sepanjang umur project Flow diisi SEKALI di sini.
//   local/rooms/<kode>/room.json   identitas, DNA (deskripsi penampilan), profil suara, project Flow, akun Google
//   local/rooms/<kode>/face.<ext>  foto wajah rujukan (disalin sekali)
// Nama field sengaja mengikuti tabel `ugc_characters` (code, name, gender, dna, identity_lock, face_ref_path,
// flow_project_url, voice, flow_voice_name, status) supaya nanti bisa dipindah ke database tanpa mengubah bentuk.
const fs = require('fs');
const path = require('path');

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const PROJECT_RE = /^https:\/\/flow\.google\.com\/(?:u\/(\d+)\/)?project\/([^/\s?#]+)/;
const PHOTO_EXT = ['.png', '.jpg', '.jpeg', '.webp'];

function roomsRoot(localRoot) { return path.join(localRoot, 'rooms'); }
function roomDir(localRoot, code) { return path.join(roomsRoot(localRoot), code); }

// Hilangkan tanda kutip yang ikut tersalin saat "Copy as path" di Windows.
function clean(s) { return String(s == null ? '' : s).trim().replace(/^["']+|["']+$/g, '').trim(); }
function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

function projectKey(url) {
  const m = PROJECT_RE.exec(String(url || ''));
  return m ? { id: m[2], user: m[1] == null ? '0' : m[1] } : { id: String(url || ''), user: '0', raw: true };
}

function validateProjectUrl(url) {
  if (process.env.ALLOW_ANY_PROJECT_URL === '1') return;
  if (!PROJECT_RE.test(String(url || ''))) {
    throw new Error(`Alamat project bukan alamat Flow: "${String(url || '').slice(0, 80)}". Harus berawalan https://flow.google.com/project/ . Buka project di Chrome khusus, lalu salin alamat dari tab Flow itu (Ctrl+L, Ctrl+C).`);
  }
}

// Status mengikuti urutan tahap karakter di database. Dihitung dari isi ruang, bukan diisi manual.
function computeStatus(r) {
  if (!r.face_ref_path) return 'draft';
  if (!(r.dna && r.dna.appearance_en)) return 'face_ready';
  if (!(r.voice && r.voice.base_voice)) return 'dna_locked';
  if (!r.flow_project_url) return 'voice_defined';
  return 'project_ready';
}

function loadRoom(localRoot, code) {
  const f = path.join(roomDir(localRoot, code), 'room.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function saveRoom(localRoot, r) {
  r.status = computeStatus(r); r.updated_at = new Date().toISOString();
  r.identity_lock = r.face_ref_path && r.dna && r.dna.appearance_en ? 'locked' : (r.face_ref_path ? 'reference' : 'none');
  fs.mkdirSync(roomDir(localRoot, r.code), { recursive: true });
  fs.writeFileSync(path.join(roomDir(localRoot, r.code), 'room.json'), JSON.stringify(r, null, 1));
  return r;
}
function listRooms(localRoot) {
  const root = roomsRoot(localRoot);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(d => fs.existsSync(path.join(root, d, 'room.json'))).sort()
    .map(d => { try { return JSON.parse(fs.readFileSync(path.join(root, d, 'room.json'), 'utf8')); } catch { return null; } }).filter(Boolean);
}
function facePath(localRoot, r) { return r && r.face_ref_path ? path.join(roomDir(localRoot, r.code), r.face_ref_path) : null; }

// Ambil deskripsi penampilan dari JSON video yang sudah ada (character.appearance), supaya tidak perlu diketik ulang.
function appearanceFromJsonFile(file) {
  const f = clean(file);
  if (!fs.existsSync(f)) throw new Error(`Berkas JSON tidak ditemukan: "${f}". Ketik alamat lengkap berkas, mulai dari C:\\ dan tanpa tanda kutip.`);
  let o; try { o = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error(`Berkas JSON bukan JSON yang valid (${e.message}).`); }
  const a = o && o.character && o.character.appearance;
  if (!a || typeof a !== 'string') throw new Error('JSON itu tidak memuat character.appearance. Pakai JSON dari paket uji v2.3, atau ketik deskripsinya sendiri.');
  return a;
}

function loadVoice(file) {
  const f = clean(file);
  if (!fs.existsSync(f)) throw new Error(`Berkas profil suara tidak ditemukan: "${f}".`);
  let v; try { v = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error(`Berkas profil suara bukan JSON yang valid (${e.message}).`); }
  if (v && typeof v === 'object') for (const k of Object.keys(v)) if (k.startsWith('_')) delete v[k];
  return v;
}

// Validasi profil suara memakai modul core (dimuat saat dibutuhkan, supaya agent tetap jalan bila core tidak ada).
function voiceReport(voice) {
  let core;
  try { core = require('../../core/src'); } catch { throw new Error('Folder core tidak ditemukan di sebelah folder agent (C:\\bam-ugc-v2\\core). Profil suara tidak bisa diperiksa.'); }
  const issues = core.validateVoiceProfile(voice);
  const errors = issues.filter(i => i.level === 'error');
  if (errors.length) throw new Error('Profil suara tidak valid: ' + errors.map(e => `${e.field}: ${e.msg}`).join('; '));
  return { warnings: issues.filter(i => i.level === 'warn').map(w => `${w.field}: ${w.msg}`), performance_en: core.buildVoicePerformance(voice) };
}

/**
 * Membuat atau memperbarui ruang. Hanya field yang diberikan yang diubah; foto disalin sekali.
 * in: { code, name, gender, face, appearance, appearanceFromJson, voiceFile, project, account, flowVoiceName }
 */
function upsertRoom(localRoot, input) {
  const code = clean(input.code);
  if (!CODE_RE.test(code)) throw new Error(`Kode karakter "${code}" tidak valid. Pakai huruf, angka, garis bawah atau tanda hubung (maksimal 40), contoh C02_THE_SOFT_GIRL.`);
  const old = loadRoom(localRoot, code);
  const r = old || { code, name: '', gender: '', creation_mode: 'reference', dna: {}, identity_lock: 'none', face_ref_path: null, voice: {}, flow_voice_name: '', flow_project_url: '', flow_account_name: '', created_at: new Date().toISOString() };
  const notes = [];
  if (input.name != null && clean(input.name)) r.name = clean(input.name);
  if (!r.name) throw new Error('Nama karakter wajib diisi.');
  if (input.gender != null && clean(input.gender)) r.gender = clean(input.gender);

  // 1) Validasi semua masukan DULU (tanpa menulis apa pun), supaya galat tidak meninggalkan ruang setengah jadi.
  let facePlan = null, voicePlan = null, appearancePlan = null;
  if (input.face != null && clean(input.face)) {
    const src = clean(input.face);
    if (!fs.existsSync(src)) throw new Error(`Foto wajah tidak ditemukan: "${src}". Ketik alamat lengkap berkas, mulai dari C:\\ dan tanpa tanda kutip.`);
    const ext = path.extname(src).toLowerCase();
    if (!PHOTO_EXT.includes(ext)) throw new Error(`Format foto "${ext || '(tanpa ekstensi)'}" tidak didukung. Pakai ${PHOTO_EXT.join(', ')}.`);
    facePlan = { src, ext };
  }
  if (input.appearanceFromJson) appearancePlan = { text: appearanceFromJsonFile(input.appearanceFromJson), fromJson: true };
  else if (input.appearance != null && clean(input.appearance)) appearancePlan = { text: clean(input.appearance) };
  if (input.voiceFile != null && clean(input.voiceFile)) { const v = loadVoice(input.voiceFile); voicePlan = { v, rep: voiceReport(v) }; }
  let projectPlan = null;
  if (input.project != null && clean(input.project)) { validateProjectUrl(clean(input.project)); projectPlan = clean(input.project); }

  // 2) Baru terapkan.
  if (facePlan) {
    const dir = roomDir(localRoot, code); fs.mkdirSync(dir, { recursive: true });
    if (r.face_ref_path && r.face_ref_path !== 'face' + facePlan.ext) fs.rmSync(path.join(dir, r.face_ref_path), { force: true });
    fs.copyFileSync(facePlan.src, path.join(dir, 'face' + facePlan.ext)); r.face_ref_path = 'face' + facePlan.ext;
    notes.push('Foto wajah disalin ke ruang (cukup sekali).');
  }
  if (appearancePlan) { r.dna = { ...r.dna, appearance_en: appearancePlan.text }; if (appearancePlan.fromJson) notes.push('Deskripsi penampilan dibaca dari JSON.'); }
  if (voicePlan) { r.voice = voicePlan.v; r.voice_performance_en = voicePlan.rep.performance_en; notes.push(...voicePlan.rep.warnings.map(w => 'Peringatan suara — ' + w)); }
  if (input.flowVoiceName != null && clean(input.flowVoiceName)) r.flow_voice_name = clean(input.flowVoiceName);
  if (projectPlan) r.flow_project_url = projectPlan;
  if (input.account != null && clean(input.account)) r.flow_account_name = clean(input.account);
  saveRoom(localRoot, r);
  return { room: r, notes };
}

// Cek job terhadap ruangnya. Murni (tanpa Flow): nama akun yang sedang terbuka diberikan dari luar.
// Mengembalikan { problems:[...] (menghentikan job), warnings:[...] }.
function checkJobAgainstRoom(job, accountNow) {
  const problems = [], warnings = [];
  const room = job && job.room;
  if (!room) return { problems, warnings };
  if (room.missing) { problems.push(`Ruang karakter "${job.room_code}" tidak ditemukan di folder local\\rooms. Job dihentikan sebelum menyentuh Flow.`); return { problems, warnings }; }
  if (!room.flow_project_url) problems.push(`Ruang ${room.code} belum punya alamat project Flow. Isi lewat menu "Ganti project atau akun".`);
  else {
    const a = projectKey(job.project_url), b = projectKey(room.flow_project_url);
    if (a.id !== b.id) problems.push(`Project pada job (${a.id.slice(0, 8)}…) berbeda dari project ruang ${room.code} (${b.id.slice(0, 8)}…). Job dihentikan supaya tidak masuk ke project karakter lain atau akun lama.`);
    else if (a.user !== b.user) warnings.push(`Nomor akun pada alamat project berbeda (/u/${a.user}/ pada job, /u/${b.user}/ pada ruang). Pastikan hanya satu akun Google yang masuk di Chrome khusus.`);
  }
  if (room.flow_account_name) {
    if (!accountNow) warnings.push('Nama akun Google tidak terbaca di tab Flow, jadi kecocokan akun tidak bisa diperiksa. Periksa manual di pojok kanan atas.');
    else if (norm(accountNow) !== norm(room.flow_account_name)) problems.push(`Akun Google yang terbuka ("${accountNow}") berbeda dari akun ruang ${room.code} ("${room.flow_account_name}"). Job dihentikan sebelum menyentuh Flow, supaya kredit akun lain tidak terpakai.`);
  }
  return { problems, warnings };
}

// Deskripsi penampilan pada JSON video harus sama dengan ruang (identitas tidak boleh bergeser antar produk).
function appearanceMismatch(room, jsonText) {
  try {
    const o = JSON.parse(jsonText); const a = o && o.character && o.character.appearance;
    if (!room.dna || !room.dna.appearance_en) return null;
    if (!a) return 'JSON video tidak memuat character.appearance, sedangkan ruang punya deskripsi penampilan.';
    if (norm(a) !== norm(room.dna.appearance_en)) return 'character.appearance pada JSON berbeda dari deskripsi penampilan di ruang. Wajah bisa bergeser antar video.';
    return null;
  } catch { return null; }
}

function summarize(r) {
  return {
    code: r.code, name: r.name, status: r.status, identity_lock: r.identity_lock,
    foto: r.face_ref_path ? 'ya' : 'belum', penampilan: r.dna && r.dna.appearance_en ? 'ya' : 'belum', suara: r.voice && r.voice.base_voice ? r.voice.base_voice : 'belum',
    project: r.flow_project_url ? projectKey(r.flow_project_url).id.slice(0, 8) + '…' : 'belum', akun: r.flow_account_name || '(belum dicatat)'
  };
}

module.exports = { CODE_RE, roomsRoot, roomDir, clean, norm, projectKey, validateProjectUrl, computeStatus, loadRoom, saveRoom, listRooms, facePath, appearanceFromJsonFile, voiceReport, upsertRoom, checkJobAgainstRoom, appearanceMismatch, summarize };
