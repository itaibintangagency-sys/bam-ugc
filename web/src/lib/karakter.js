// Logika murni dan operasi database untuk halaman Karakter (Fase 2). Aturan inti (DNA hanya dewasa, profil suara) datang dari
// src/core, salinan core/ yang sama dengan yang dipakai agent dan alat uji.
import { OPTIONS, validateDna, dnaToAppearance, dnaToProfile } from '../core/dna.js';
import { OPT, validateVoiceProfile, buildVoicePerformance, voicesForGender, defaultVoiceProfile } from '../core/voice.js';

export const BUCKET = 'ugc-characters';
export const MAX_FOTO_BYTE = 6 * 1024 * 1024;
export const TIPE_FOTO = ['image/png', 'image/jpeg', 'image/webp'];
export const SISI_MIN = 512;       // di bawah ini foto ditolak
export const SISI_DISARANKAN = 1024;

// ───────────── Label pilihan DNA (kunci = nilai di core; label = tampilan) ─────────────
export const LABEL = {
  gender: { perempuan: 'Perempuan', 'laki-laki': 'Laki-laki' },
  age_group: { dewasa_muda: '21 sampai 24 tahun', muda: '25 sampai 29 tahun', dewasa: '30 sampai 39 tahun', matang: '40 sampai 49 tahun' },
  face_shape: { oval: 'Oval', bulat: 'Bulat', lonjong: 'Lonjong', persegi: 'Persegi (rahang tegas)', hati: 'Hati' },
  complexion: { terang: 'Terang', kuning_langsat: 'Kuning langsat', sawo_matang: 'Sawo matang', cokelat_tua: 'Cokelat tua', gelap: 'Gelap' },
  eyes: { almond: 'Almond', bulat: 'Bulat besar', sipit_ringan: 'Sipit ringan' },
  expression: { ceria: 'Ceria', kalem: 'Kalem', profesional: 'Profesional', playful: 'Jenaka' },
  hair_length: { pendek: 'Pendek', sebahu: 'Sebahu', panjang: 'Panjang' },
  hair_texture: { lurus: 'Lurus', bergelombang: 'Bergelombang', ikal: 'Ikal' },
  hair_color: { hitam: 'Hitam', cokelat_tua: 'Cokelat tua', cokelat_muda_karamel: 'Cokelat muda dengan sorot karamel' },
  parting: { tengah: 'Belah tengah', samping: 'Belah samping' },
  beard: { tanpa: 'Tanpa janggut', janggut_tipis: 'Janggut tipis', janggut_tebal: 'Janggut tebal rapi' },
  hijab_style: { pasmina: 'Pashmina', segi_empat: 'Segi empat', instan: 'Instan', syari: 'Syar\'i panjang' },
  build: { ramping: 'Ramping', sedang: 'Sedang', atletis: 'Atletis' }
};
export const LABEL_SUARA = {
  usia: { dewasa_muda: 'Dewasa muda (21 sampai 24)', muda: 'Muda (25 sampai 29)', dewasa: 'Dewasa (30 sampai 39)', matang: 'Matang (40 sampai 49)' },
  nada: { cerah: 'Cerah', hangat: 'Hangat', lembut: 'Lembut', jernih: 'Jernih', serak_ringan: 'Serak ringan', tegas: 'Tegas' },
  energi: { rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi' },
  tempo: { santai: 'Santai', normal: 'Normal', cepat: 'Cepat' },
  gaya: { ramah_teman: 'Ramah seperti teman', informatif: 'Informatif', antusias: 'Antusias', tenang_softsell: 'Tenang, soft selling', bercerita: 'Bercerita' },
  aksen: { indonesia_netral: 'Indonesia netral', jakarta_santai: 'Jakarta santai', sunda_ringan: 'Sunda ringan (belum terbukti)', jawa_ringan: 'Jawa ringan (belum terbukti)' },
  bahasa: { baku: 'Baku', semi_santai: 'Semi santai', gaul_ringan: 'Gaul ringan' }
};
export const labelOf = (group, key) => (LABEL[group] && LABEL[group][key]) || (LABEL_SUARA[group] && LABEL_SUARA[group][key]) || key;
export { OPTIONS, OPT };

// Contoh siap pakai: DNA C02 menghasilkan tepat kalimat penampilan yang dipakai uji di Flow.
export const CONTOH_C02 = {
  code: 'C02_THE_SOFT_GIRL', name: 'Nadia',
  dna: { gender: 'perempuan', age_group: 'dewasa_muda', face_shape: 'oval', complexion: 'terang', expression: 'ceria', hair_length: 'panjang', hair_texture: 'bergelombang', hair_color: 'cokelat_muda_karamel', parting: 'tengah' }
};
export const dnaKosong = () => ({ gender: '', age_group: '', face_shape: '', complexion: '', expression: '', hair_length: '', hair_texture: '', hair_color: '', hijab: false });

// DNA dari formulir dibersihkan: kolom kosong dibuang, kolom yang tidak berlaku (rambut bila berhijab, janggut bila perempuan) dibuang.
export function cleanDna(d) {
  const o = {}; for (const [k, v] of Object.entries(d || {})) if (v !== '' && v != null) o[k] = typeof v === 'string' ? v.trim() : v;
  if (o.hijab !== true) { delete o.hijab; delete o.hijab_style; delete o.hijab_color; }
  else { for (const k of ['hair_length', 'hair_texture', 'hair_color', 'parting']) delete o[k]; }
  if (o.gender !== 'laki-laki') delete o.beard;
  if (o.gender !== 'perempuan') { delete o.hijab; delete o.hijab_style; delete o.hijab_color; }
  return o;
}
export const dnaIssues = d => validateDna(cleanDna(d));
export function appearanceOf(d) { const c = cleanDna(d); return validateDna(c).length ? '' : dnaToAppearance(c); }

// ───────────── Validasi isian ─────────────
const KODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const PROJECT = /^https:\/\/flow\.google\.com\/(?:u\/\d+\/)?project\/[^/\s?#]+/;
export function cekIdentitas({ code, name }) {
  const e = [];
  if (!KODE.test(String(code || '').trim())) e.push('Kode: huruf, angka, garis bawah atau tanda hubung, maksimal 40 karakter (contoh C02_THE_SOFT_GIRL).');
  const n = String(name || '').trim(); if (n.length < 2 || n.length > 60) e.push('Nama karakter wajib diisi (2 sampai 60 karakter).');
  return e;
}
export function cekProject(url, akun) {
  const e = [];
  if (!PROJECT.test(String(url || '').trim())) e.push('Alamat project harus diawali https://flow.google.com/project/ . Buka project di Chrome, lalu salin alamat dari tab Flow itu.');
  const a = String(akun || '').trim(); if (a.length < 2 || a.length > 80) e.push('Nama akun Google wajib diisi seperti tampil di pojok kanan atas Flow (2 sampai 80 karakter).');
  return e;
}
export function cekFoto(file) {
  if (!file) return ['Foto wajah belum dipilih.'];
  if (!TIPE_FOTO.includes(file.type)) return ['Format foto harus PNG, JPG, atau WEBP.'];
  if (file.size > MAX_FOTO_BYTE) return [`Ukuran foto ${(file.size / 1048576).toFixed(1)} MB; batas 6 MB. Perkecil dulu.`];
  if (file.size < 10 * 1024) return ['Foto terlalu kecil (di bawah 10 KB), kemungkinan bukan foto asli.'];
  return [];
}
// Dimensi diperiksa terpisah karena butuh mendekode gambar di browser. Mengembalikan { w, h } atau null.
export function bacaDimensi(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}
export function nilaiDimensi(d) {
  if (!d) return { galat: 'Berkas ini tidak terbaca sebagai gambar. Pilih foto lain.' };
  const sisi = Math.min(d.w, d.h);
  if (sisi < SISI_MIN) return { galat: `Foto terlalu kecil (${d.w} x ${d.h} piksel). Minimal sisi terpendek ${SISI_MIN} piksel agar wajah jelas.` };
  if (sisi < SISI_DISARANKAN) return { peringatan: `Foto ${d.w} x ${d.h} piksel. Disarankan sisi terpendek minimal ${SISI_DISARANKAN} piksel.` };
  return {};
}

// ───────────── Suara ─────────────
export function pilihanSuara(gender, dipakai = []) {
  const used = new Set((dipakai || []).filter(Boolean).map(s => String(s).toLowerCase()));
  return voicesForGender(gender).map(v => ({ name: v.name, desc: v.desc, gender: v.gender, dipakai: used.has(v.name.toLowerCase()) }));
}
export function suaraAwal(gender, ageGroup, dipakai = []) { return defaultVoiceProfile(gender, ageGroup, { taken: dipakai }); }
export function cekSuara(profile) { return validateVoiceProfile(profile).filter(i => i.level === 'error').map(i => `${i.field}: ${i.msg}`); }
export const teksPerforma = profile => { try { return validateVoiceProfile(profile).some(i => i.level === 'error') ? '' : buildVoicePerformance(profile); } catch { return ''; } };

// ───────────── Status karakter ─────────────
const STATUS = {
  draft: { label: 'Draf (belum lengkap)', tone: 'warn' }, face_ready: { label: 'Foto siap', tone: 'warn' }, dna_locked: { label: 'DNA terkunci', tone: 'warn' },
  voice_defined: { label: 'Lengkap, menunggu admin', tone: 'ok' }, sheet_ready: { label: 'Lembar sudut siap', tone: 'ok' }, project_ready: { label: 'Project Flow siap', tone: 'ok' },
  voice_in_flow: { label: 'Suara di Flow', tone: 'ok' }, intro_review: { label: 'Review perkenalan', tone: 'ok' }, ready: { label: 'Siap dipakai', tone: 'ok' }
};
export const infoStatus = s => STATUS[s] || { label: s || '-', tone: 'warn' };

// Syarat karakter bisa ditandai siap oleh admin.
export function syaratSiap(c) {
  const dna = (c && c.dna) || {};
  return [
    { kunci: 'foto', label: 'Foto wajah terunggah', ok: Boolean(c && c.face_ref_path) },
    { kunci: 'dna', label: 'DNA dan kalimat penampilan', ok: Boolean(dna.appearance_en) },
    { kunci: 'suara', label: 'Suara dasar dipilih', ok: Boolean(c && c.voice_base) },
    { kunci: 'project', label: 'Alamat project Flow', ok: Boolean(c && c.flow_project_url && PROJECT.test(c.flow_project_url)) },
    { kunci: 'akun', label: 'Nama akun Google Flow', ok: Boolean(c && c.flow_account_name) }
  ];
}
export const lengkap = c => syaratSiap(c).every(s => s.ok);
export function langkahBerikut(c, isAdmin) {
  if (!c) return '';
  if (c.status === 'ready') return 'Karakter siap dipakai. Pilih karakter ini saat membuat batch (halaman Batch menyusul di Fase 4).';
  if (!c.face_ref_path) return 'Unggah foto wajah untuk melengkapi karakter.';
  if (!lengkap(c)) return 'Lengkapi data yang masih kosong.';
  return isAdmin ? 'Periksa lalu tandai siap dengan alasan tertulis.' : 'Menunggu admin menandai karakter ini siap.';
}

// ───────────── Pembentuk baris database ─────────────
export function barisKarakter({ code, name, dna, voice, flowProjectUrl, flowAccountName, creationMode }, userId) {
  const d = cleanDna(dna);
  return {
    code: String(code).trim(), name: String(name).trim(), gender: d.gender, creation_mode: ['dna_first', 'face_first', 'reference'].includes(creationMode) ? creationMode : 'reference',
    dna: { ...d, appearance_en: dnaToAppearance(d) }, identity_lock: 'locked',
    flow_project_url: String(flowProjectUrl).trim(), flow_account_name: String(flowAccountName).trim(),
    voice, voice_base: voice.base_voice, status: 'draft', created_by: userId
  };
}
export const jalurFoto = (idKarakter, ext) => `${idKarakter}/face_front.${ext}`;
export const ekstensi = type => (type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg');

// ───────────── Galat berbahasa awam ─────────────
export function galatAwam(e) {
  const m = String((e && (e.message || e.error_description || e.error)) || e || ''); const code = e && e.code;
  if (code === '23505' && /voice_base/.test(m + (e.details || ''))) return 'Suara dasar ini sudah dipakai karakter lain. Satu karakter satu suara; pilih suara lain.';
  if (code === '23505') return 'Kode karakter ini sudah dipakai. Pilih kode lain.';
  if (/ugc_characters_voice_base/.test(m)) return 'Suara dasar ini sudah dipakai karakter lain. Satu karakter satu suara; pilih suara lain.';
  if (/duplicate key|already exists/i.test(m) && /code/i.test(m)) return 'Kode karakter ini sudah dipakai. Pilih kode lain.';
  if (/khusus admin/.test(m)) return 'Hanya akun admin yang boleh menandai karakter siap.';
  if (/alasan wajib/.test(m)) return 'Alasan wajib diisi, minimal 10 karakter.';
  if (code === '42501' || /row-level security|permission denied/i.test(m)) return 'Akun ini tidak punya izin untuk tindakan ini. Hanya pembuat karakter atau admin yang boleh mengubahnya.';
  if (/DNA karakter sudah dikunci/i.test(m)) return 'DNA karakter sudah dikunci. Minta admin bila perlu diubah.';
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(m)) return 'Tidak tersambung ke server. Periksa koneksi internet, lalu coba lagi.';
  if (/Payload too large|too large|413/i.test(m)) return 'Berkas terlalu besar untuk diunggah.';
  if (/mime|not supported|unsupported/i.test(m)) return 'Format berkas ditolak oleh penyimpanan. Pakai PNG, JPG, atau WEBP.';
  return `Terjadi kesalahan: ${m.slice(0, 160)}`;
}

// ───────────── Operasi ke Supabase (client = klien supabase-js) ─────────────
const KOLOM = 'id,code,name,gender,status,identity_lock,face_ref_path,flow_project_url,flow_account_name,voice_base,voice,dna,created_by,created_at,ready_at,ready_override_reason';
export async function daftarKarakter(client) {
  const r = await client.from('ugc_characters').select(KOLOM).order('created_at', { ascending: false });
  if (r.error) throw r.error; return r.data || [];
}
export async function ambilKarakter(client, id) {
  const r = await client.from('ugc_characters').select(KOLOM).eq('id', id);
  if (r.error) throw r.error; return (r.data && r.data[0]) || null;
}
export async function suaraTerpakai(client) {
  const r = await client.from('ugc_characters').select('id,voice_base');
  if (r.error) throw r.error; return (r.data || []).map(x => x.voice_base).filter(Boolean);
}

// Mengunggah (atau mengganti) foto wajah dan menautkannya ke karakter. Aman diulang.
export async function pasangFoto(client, userId, karakter, file) {
  const ext = ekstensi(file.type); const path = jalurFoto(karakter.id, ext);
  const up = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: true });
  if (up.error) throw up.error;
  const ada = await client.from('ugc_character_photos').select('id').eq('character_id', karakter.id).eq('angle', 'face_front');
  if (ada.error) throw ada.error;
  if (ada.data && ada.data.length) { const u = await client.from('ugc_character_photos').update({ path, approved: true }).eq('id', ada.data[0].id); if (u.error) throw u.error; }
  else { const i = await client.from('ugc_character_photos').insert({ character_id: karakter.id, angle: 'face_front', path, approved: true, created_by: userId }); if (i.error) throw i.error; }
  const patch = { face_ref_path: path };
  if (karakter.status === 'draft' || karakter.status == null) patch.status = 'voice_defined';
  const k = await client.from('ugc_characters').update(patch).eq('id', karakter.id);
  if (k.error) throw k.error;
  return { path };
}

// Membuat karakter: baris dulu (draf), lalu foto. Bila foto gagal, karakter tetap ada sebagai draf dan fotonya bisa diunggah ulang.
export async function buatKarakter(client, userId, form, file, onLangkah = () => {}) {
  const row = barisKarakter(form, userId);
  onLangkah('Menyimpan data karakter…');
  const ins = await client.from('ugc_characters').insert(row).select('id,status');
  if (ins.error) throw ins.error;
  const karakter = (ins.data && ins.data[0]);
  if (!karakter) throw new Error('Database tidak mengembalikan data karakter yang baru dibuat.');
  try {
    onLangkah('Mengunggah foto wajah…');
    await pasangFoto(client, userId, karakter, file);
    return { id: karakter.id, lengkap: true };
  } catch (e) { return { id: karakter.id, lengkap: false, galat: galatAwam(e) }; }
}

export async function ubahProject(client, id, { url, akun }) {
  const e = cekProject(url, akun); if (e.length) throw new Error(e[0]);
  const r = await client.from('ugc_characters').update({ flow_project_url: String(url).trim(), flow_account_name: String(akun).trim() }).eq('id', id).select('id');
  if (r.error) throw r.error;
  if (!r.data || !r.data.length) throw Object.assign(new Error('row-level security'), { code: '42501' });
}
export async function tandaiSiap(client, id, alasan) {
  const a = String(alasan || '').trim(); if (a.length < 10) throw new Error('alasan wajib minimal 10 karakter');
  const r = await client.rpc('ugc_admin_mark_ready', { p_character: id, p_reason: a });
  if (r.error) throw r.error;
}
export async function muatFoto(client, path) {
  const r = await client.storage.from(BUCKET).download(path);
  if (r.error) throw r.error; return r.data;   // Blob
}
export { dnaToProfile };
