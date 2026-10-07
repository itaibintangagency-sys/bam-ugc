// Logika murni dan operasi database untuk halaman Produk. Aturan profil (slot, peran foto, kata terlarang) datang dari src/core,
// salinan core/ yang sama dengan yang dipakai Edge Function analyze-product dan planner video.
import { LABEL_ROLE, MAX_FOTO, ROLES_BUKAN_PRODUK, ROLES_DASAR, peranUntuk, slotsFor, validateProfile } from '../core/productProfile.js';
import { ekstensi, TIPE_FOTO } from './karakter.js';
import { pesanDariFungsi } from './generate.js';

export { LABEL_ROLE, MAX_FOTO, ROLES_BUKAN_PRODUK, ROLES_DASAR, peranUntuk, slotsFor, validateProfile };
export const BUCKET_PRODUK = 'ugc-products';
export const FUNGSI_ANALISIS = 'analyze-product';
export const MAX_FOTO_BYTE = 6 * 1024 * 1024;     // batas fungsi per foto
export const SISI_MAKS = 1600;                     // foto produk diperkecil di browser: hemat unggahan dan biaya token AI
export const KUALITAS_JPEG = 0.85;
export const SISI_MIN = 300;

export const STATUS_PRODUK = {
  draft: { label: 'Draf', tone: 'warn' }, analyzed: { label: 'Perlu ditinjau', tone: 'warn' },
  confirmed: { label: 'Terkonfirmasi', tone: 'ok' }, archived: { label: 'Diarsipkan', tone: 'warn' }
};
export const infoStatusProduk = s => STATUS_PRODUK[s] || { label: s || '-', tone: 'warn' };
const URUT_RISIKO = { rendah: 1, sedang: 2, tinggi: 3 };
export const RISIKO = { rendah: { label: 'Risiko rendah', tone: 'ok' }, sedang: { label: 'Risiko sedang', tone: 'warn' }, tinggi: { label: 'Risiko tinggi: tiap job perlu persetujuan admin', tone: 'bad' } };
export const infoRisiko = r => RISIKO[r] || null;

// ───────────── Katalog kategori ─────────────
export const labelKategori = k => (k ? [k.l1, k.l2, k.l3].filter(Boolean).join(' > ') : '');
// Risiko efektif = yang lebih tinggi antara risiko arketipe dan risiko_override kategori (sama dengan penjaga di database).
export function risikoKategori(kategori, arketipe) {
  if (!kategori) return null;
  const a = arketipe && arketipe[kategori.archetype_id] ? arketipe[kategori.archetype_id].risk_level : null;
  const kandidat = [a, kategori.risiko_override].filter(Boolean); if (!kandidat.length) return null;
  return kandidat.sort((x, y) => (URUT_RISIKO[y] || 0) - (URUT_RISIKO[x] || 0))[0];
}
export async function muatKatalog(client) {
  const [k, a] = await Promise.all([
    client.from('ugc_category_map').select('category_key,l1,l2,l3,archetype_id,alt_archetype_id,kepercayaan,flags,perlu_review,req_gender,req_hijab,catatan_kebijakan,risiko_override').order('l1').order('l2').order('l3'),
    client.from('ugc_archetypes').select('id,nama,risk_level')
  ]);
  if (k.error) throw k.error; if (a.error) throw a.error;
  const arketipe = {}; for (const x of a.data || []) arketipe[x.id] = x;
  return { kategori: k.data || [], arketipe };
}
const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// Pencarian: setiap kata harus ada di label; hasil yang kata pertamanya diawali kueri diurutkan lebih dulu. Tanpa kueri: kosong (daftar 226 terlalu panjang).
export function cariKategori(daftar, kueri, batas = 30) {
  const kata = norm(kueri).split(/\s+/).filter(Boolean); if (!kata.length) return [];
  const hasil = [];
  for (const k of daftar || []) {
    const label = norm(labelKategori(k)); if (!kata.every(t => label.includes(t))) continue;
    const l3 = norm(k.l3 || k.l2); const skor = (l3.startsWith(kata[0]) ? 0 : label.split(/[\s>]+/).some(w => w.startsWith(kata[0])) ? 1 : 2);
    hasil.push({ k, skor });
  }
  return hasil.sort((a, b) => a.skor - b.skor || labelKategori(a.k).localeCompare(labelKategori(b.k), 'id')).slice(0, batas).map(x => x.k);
}
// Syarat dari kategori untuk karakter yang akan dipakai (ditampilkan sebagai peringatan; penegakan ada di tahap batch).
export function syaratKarakter(k) {
  if (!k) return [];
  const s = []; if (k.req_gender) s.push(`Karakter harus ${k.req_gender}.`); if (k.req_hijab === 'wajib') s.push('Karakter harus berhijab.'); if (k.req_hijab === 'tanpa') s.push('Karakter tidak berhijab.');
  return s;
}

// ───────────── Foto ─────────────
export const jalurFotoProduk = (idProduk, ext, id = crypto.randomUUID()) => `${idProduk}/${id}.${ext}`;
export function cekFotoProduk(file) {
  if (!file) return ['Foto belum dipilih.'];
  if (!TIPE_FOTO.includes(file.type)) return ['Format foto harus PNG, JPG, atau WEBP.'];
  if (file.size < 2 * 1024) return ['Foto terlalu kecil (di bawah 2 KB), kemungkinan bukan foto asli.'];
  return [];
}
export function hitungUkuran(w, h, sisiMaks = SISI_MAKS) {
  const maks = Math.max(w, h); if (!(w > 0 && h > 0)) return null; if (maks <= sisiMaks) return { w, h, ubah: false };
  const f = sisiMaks / maks; return { w: Math.round(w * f), h: Math.round(h * f), ubah: true };
}
// Perkecil di browser (JPEG, sisi terpanjang 1600). Bila browser tidak bisa mengolah gambar atau fotonya sudah kecil, file asli dipakai.
// `env` dapat diganti saat pengujian: { baca(file) -> {w,h}, gambar(file, w, h, kualitas) -> Blob }.
const envBrowser = {
  async baca(file) { const b = await createImageBitmap(file); const r = { w: b.width, h: b.height }; if (b.close) b.close(); return r; },
  async gambar(file, w, h, kualitas) {
    const bmp = await createImageBitmap(file); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bmp, 0, 0, w, h); if (bmp.close) bmp.close();
    return await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('gagal mengolah gambar'))), 'image/jpeg', kualitas));
  }
};
export async function perkecilFoto(file, { sisiMaks = SISI_MAKS, kualitas = KUALITAS_JPEG, env = envBrowser } = {}) {
  try {
    const d = await env.baca(file); const u = hitungUkuran(d.w, d.h, sisiMaks);
    if (!u || (!u.ubah && file.size <= MAX_FOTO_BYTE / 2)) return { file, diperkecil: false, w: d.w, h: d.h };
    const blob = await env.gambar(file, u.w, u.h, kualitas);
    if (!blob || blob.size >= file.size) return { file, diperkecil: false, w: d.w, h: d.h };
    const nama = String(file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg';
    return { file: new File([blob], nama, { type: 'image/jpeg' }), diperkecil: true, w: u.w, h: u.h };
  } catch { return { file, diperkecil: false, w: null, h: null }; }
}
export async function unggahFotoProduk(client, idProduk, file) {
  const path = jalurFotoProduk(idProduk, ekstensi(file.type));
  const up = await client.storage.from(BUCKET_PRODUK).upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw up.error;
  return path;
}
// Alamat bertanda tangan untuk tampilan kecil; gagal tidak mengganggu halaman (kartu tampil tanpa gambar).
export async function alamatFoto(client, paths, detik = 3600) {
  const ada = (paths || []).filter(Boolean); if (!ada.length) return {};
  try {
    const r = await client.storage.from(BUCKET_PRODUK).createSignedUrls(ada, detik); if (r.error || !Array.isArray(r.data)) return {};
    const out = {}; for (const x of r.data) if (x && x.path && x.signedUrl) out[x.path] = x.signedUrl; return out;
  } catch { return {}; }
}

// ───────────── Galat awam ─────────────
export function galatProduk(e) {
  const m = String((e && (e.message || e.error_description || e.error)) || e || ''); const code = e && e.code;
  if (/kategori produk tidak boleh dikosongkan/i.test(m)) return 'Kategori produk tidak boleh dikosongkan. Minta admin bila perlu.';
  if (/arketipe berisiko tinggi tidak boleh diturunkan/i.test(m)) return 'Produk ini berisiko tinggi dan hanya admin yang boleh memindahkannya ke kategori berisiko lebih rendah.';
  if (code === '42501' || /row-level security|permission denied/i.test(m)) return 'Akun ini tidak punya izin untuk tindakan ini. Hanya pembuat produk atau admin yang boleh mengubahnya.';
  if (/ugc_products_confirmed_complete/.test(m)) return 'Produk belum bisa dikonfirmasi: arketipe atau risiko belum terisi. Pilih kategori produk.';
  if (/ugc_products_max_photos/.test(m)) return `Maksimal ${MAX_FOTO} foto per produk.`;
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(m)) return 'Tidak tersambung ke server. Periksa koneksi internet, lalu coba lagi.';
  if (/Payload too large|too large|413/i.test(m)) return 'Berkas terlalu besar untuk diunggah.';
  if (/mime|not supported|unsupported/i.test(m)) return 'Format berkas ditolak oleh penyimpanan. Pakai PNG, JPG, atau WEBP.';
  if (/Could not find|schema cache|does not exist/i.test(m)) return 'Fitur ini belum aktif di database: jalankan migrasi terbaru (20261006000810_analisis_produk.sql).';
  return `Terjadi kesalahan: ${m.slice(0, 160)}`;
}

// ───────────── Operasi database ─────────────
const KOLOM = 'id,name,status,photos,profile,archetype_id,risk_level,category_key,category_source,confirmed_by,confirmed_at,created_by,created_at,updated_at';
export const KOLOM_DAFTAR = 'id,name,status,photos,archetype_id,risk_level,category_key,created_by,created_at';
export function cekNama(nama) { const n = String(nama || '').trim(); return n.length < 2 || n.length > 120 ? ['Nama produk wajib diisi (2 sampai 120 karakter).'] : []; }
export async function daftarProduk(client) {
  const r = await client.from('ugc_products').select(KOLOM_DAFTAR).order('created_at', { ascending: false }).limit(300);
  if (r.error) throw r.error; return r.data || [];
}
export async function ambilProduk(client, id) {
  const r = await client.from('ugc_products').select(KOLOM).eq('id', id);
  if (r.error) throw r.error; return (r.data && r.data[0]) || null;
}
// Membuat draf: arketipe dan risiko diturunkan database dari kategori (penjaga ugc_products_apply_category). Dibaca ulang dari baris hasil.
export async function buatProduk(client, userId, { nama, kategoriKey }) {
  const e = cekNama(nama); if (e.length) throw new Error(e[0]); if (!kategoriKey) throw new Error('Pilih kategori produk.');
  const r = await client.from('ugc_products').insert({ name: String(nama).trim(), category_key: kategoriKey, category_source: 'manual', status: 'draft', photos: [], profile: {}, created_by: userId }).select(KOLOM);
  if (r.error) throw r.error; const p = r.data && r.data[0]; if (!p) throw new Error('Database tidak mengembalikan produk yang baru dibuat.'); return p;
}
async function ubah(client, id, patch) {
  const r = await client.from('ugc_products').update(patch).eq('id', id).select(KOLOM);
  if (r.error) throw r.error; if (!r.data || !r.data.length) throw Object.assign(new Error('row-level security'), { code: '42501' }); return r.data[0];
}
export const simpanNama = (client, id, nama) => { const e = cekNama(nama); if (e.length) return Promise.reject(new Error(e[0])); return ubah(client, id, { name: String(nama).trim() }); };
export const simpanFoto = (client, id, photos) => {
  if (!Array.isArray(photos) || photos.length > MAX_FOTO) return Promise.reject(new Error(`Maksimal ${MAX_FOTO} foto per produk.`));
  return ubah(client, id, { photos: photos.map(p => ({ path: p.path, role: p.role })) });
};
// Ganti kategori: arketipe dan risiko ikut diturunkan database. Detail slot milik arketipe lama dikosongkan bila arketipenya berbeda.
export async function ubahKategori(client, produk, kategoriKey, arketipeBaru) {
  const patch = { category_key: kategoriKey, category_source: 'manual' };
  if (arketipeBaru && arketipeBaru !== produk.archetype_id) { patch.profile = {}; patch.status = 'draft'; patch.confirmed_by = null; patch.confirmed_at = null; }
  return ubah(client, produk.id, patch);
}
export const simpanProfil = (client, id, profil, status = 'analyzed') => ubah(client, id, { profile: { facts: profil.facts || [], facts_en: profil.facts_en || [], colors: profil.colors || [], details: profil.details || [] }, status });
// Profil dan status ditulis dalam SATU pembaruan, supaya produk tidak pernah terkonfirmasi dengan profil yang berbeda dari yang ditinjau.
export const konfirmasiProduk = (client, id, userId, profil) => ubah(client, id, { profile: { facts: profil.facts || [], facts_en: profil.facts_en || [], colors: profil.colors || [], details: profil.details || [] }, status: 'confirmed', confirmed_by: userId, confirmed_at: new Date().toISOString() });
export const bukaKembali = (client, id) => ubah(client, id, { status: 'draft', confirmed_by: null, confirmed_at: null });

// Analisis AI: fungsi server membaca foto produk dari penyimpanan lalu mengembalikan DRAF profil. Tidak menulis produk.
export async function analisisProduk(client, idProduk) {
  let data, error;
  try { ({ data, error } = await client.functions.invoke(FUNGSI_ANALISIS, { body: { product_id: idProduk } })); }
  catch (e) { error = e; }
  if (error) { const p = await pesanDariFungsi(error); return { ok: false, ...p }; }
  if (!data || !data.ok) return { ok: false, pesan: (data && data.pesan) || 'Fungsi analisis tidak mengembalikan hasil.', kode: (data && data.kode) || 'kosong' };
  return data;
}

// ───────────── Pembantu tampilan editor ─────────────
// Profil kosong untuk arketipe: satu butir kosong per slot supaya editor langsung menampilkan semua slot.
export function profilKosong() { return { facts: [], facts_en: [], colors: [], details: [] }; }
export const barisKeDaftar = teks => String(teks || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
export const daftarKeBaris = arr => (Array.isArray(arr) ? arr : []).join('\n');
// Mengisi/menghapus detail satu slot pada profil (tanpa mengubah profil asli). Teks kosong semua = slot dihapus.
export function setDetail(profil, slotKey, nilai) {
  const details = (profil.details || []).filter(d => d.slot_key !== slotKey);
  const ada = (profil.details || []).find(d => d.slot_key === slotKey) || {};
  const baru = { slot_key: slotKey, text: '', text_en: '', label: '', confidence: ada.confidence ?? 1, ...ada, ...nilai };
  const kosong = !String(baru.text || '').trim() && !String(baru.text_en || '').trim();
  return { ...profil, details: kosong ? details : [...details, baru] };
}
// Urutan detail mengikuti urutan slot arketipe agar editor dan JSON stabil.
export function urutkanDetail(profil, archetypeId) {
  const s = slotsFor(archetypeId); if (!s) return profil; const idx = Object.fromEntries(s.map((x, i) => [x.key, i]));
  return { ...profil, details: [...(profil.details || [])].sort((a, b) => (idx[a.slot_key] ?? 99) - (idx[b.slot_key] ?? 99)) };
}
