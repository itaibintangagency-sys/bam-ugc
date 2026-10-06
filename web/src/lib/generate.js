// Logika murni dan panggilan ke Supabase untuk fitur generate gambar (Edge Function generate-image) dan Riwayat generate.
// Kunci OpenRouter TIDAK ada di sini dan tidak pernah ada di browser: browser hanya memanggil fungsi di server.
import { HUBUNGAN, peringatanKonflik } from '../core/dna.js';
import { BUCKET, ekstensi, muatFoto } from './karakter.js';

export { peringatanKonflik };
export const FUNGSI = 'generate-image';
export const MAKS_PER_KLIK = 4;
export const JENIS = { wajah_dna: 'Wajah dari DNA', wajah_acuan: 'Wajah dari foto acuan', lembar_sudut: 'Lembar 7 sudut', storyboard: 'Storyboard' };

export const KUALITAS = [
  { kunci: 'low', label: 'Hemat (low)', admin: false },
  { kunci: 'medium', label: 'Sedang (medium)', admin: false },
  { kunci: 'high', label: 'Tinggi (high), khusus admin', admin: true }
];
export const kualitasUntuk = admin => KUALITAS.filter(k => admin || !k.admin);

// Hubungan yang cocok dengan jenis kelamin DNA hasil (ibu hanya perempuan, ayah hanya laki-laki).
export function hubunganUntuk(gender) {
  return Object.entries(HUBUNGAN)
    .filter(([, h]) => !h.gender || h.gender === gender)
    .map(([kunci, h]) => ({ kunci, label: h.label }));
}

// ───────────── Format uang ─────────────
const fmtRp = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
export function rupiah(n) { return n == null || !Number.isFinite(Number(n)) ? '–' : `Rp ${fmtRp.format(Math.round(Number(n)))}`; }
export function usd(n) {   // empat desimal, nol di belakang dipangkas sampai tersisa minimal dua desimal
  if (n == null || !Number.isFinite(Number(n))) return '–';
  return `US$ ${Number(n).toFixed(4).replace(/(\.\d{2}\d*?)0+$/, '$1')}`;
}
export const detik = ms => (ms == null ? '–' : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} dtk`);

// Rentang waktu satu bulan menurut zona Asia/Jakarta (UTC+7 tetap, tanpa DST). bulan = 'YYYY-MM'.
export function rentangBulan(bulan) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(bulan || '')); if (!m) throw new Error('Bulan harus berbentuk YYYY-MM.');
  const y = Number(m[1]), mo = Number(m[2]); const ny = mo === 12 ? y + 1 : y, nm = mo === 12 ? 1 : mo + 1;
  const p = n => String(n).padStart(2, '0');
  return { dari: `${y}-${p(mo)}-01T00:00:00+07:00`, sampai: `${ny}-${p(nm)}-01T00:00:00+07:00` };
}
export function bulanIni(sekarang = new Date()) {
  const wib = new Date(sekarang.getTime() + 7 * 3600 * 1000);   // geser ke WIB lalu baca bagian UTC
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, '0')}`;
}
export const waktuWib = iso => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(iso));

// ───────────── Foto acuan ─────────────
export const jalurAcuan = (userId, ext, id = crypto.randomUUID()) => `refs/${userId}/${id}.${ext}`;
export async function unggahAcuan(client, userId, file) {
  const path = jalurAcuan(userId, ekstensi(file.type));
  const up = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw up.error;
  return path;
}

// ───────────── Memanggil fungsi ─────────────
// supabase-js mengembalikan galat generik untuk status bukan 2xx; pesan awam dari fungsi ada di badan jawabannya.
export async function pesanDariFungsi(error) {
  try {
    const ctx = error && error.context;
    if (ctx && typeof ctx.json === 'function') { const j = await ctx.json(); if (j && j.pesan) return { pesan: j.pesan, kode: j.kode || '' }; }
  } catch { /* badan bukan JSON */ }
  const m = String((error && error.message) || error || '');
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return { pesan: 'Tidak tersambung ke server. Periksa koneksi internet, lalu coba lagi.', kode: 'jaringan' };
  if (/non-2xx|FunctionsHttpError/i.test(m)) return { pesan: 'Server menolak permintaan. Coba lagi; bila berulang, hubungi admin.', kode: 'server' };
  if (/FunctionsFetchError|relay/i.test(m)) return { pesan: 'Fungsi generate belum terpasang atau tidak bisa dijangkau. Hubungi admin.', kode: 'fungsi' };
  return { pesan: `Terjadi kesalahan: ${m.slice(0, 160)}`, kode: 'lain' };
}

// Satu klik = satu kelompok (batch_id). Setiap gambar adalah satu panggilan sendiri agar tiap gambar punya batas waktu sendiri;
// semuanya dijalankan serentak. onSlot(indeks, hasil) dipanggil begitu satu gambar selesai (berhasil atau gagal).
export async function buatGambar(client, { kind, dna, quality, jumlah, relation, note, refPath }, onSlot = () => {}) {
  const n = Number(jumlah); if (!Number.isInteger(n) || n < 1 || n > MAKS_PER_KLIK) throw new Error(`Jumlah gambar harus 1 sampai ${MAKS_PER_KLIK}.`);
  const batchId = crypto.randomUUID();
  const satu = async seq => {
    const body = { kind, batch_id: batchId, seq, total: n, quality, dna };
    if (kind === 'wajah_acuan') Object.assign(body, { relation, note: note || '', ref_path: refPath });
    let hasil;
    try {
      const { data, error } = await client.functions.invoke(FUNGSI, { body });
      if (error) { const p = await pesanDariFungsi(error); hasil = { ok: false, ...p }; }
      else if (data && data.ok) hasil = data;
      else hasil = { ok: false, pesan: (data && data.pesan) || 'Fungsi tidak mengembalikan gambar.', kode: (data && data.kode) || 'kosong' };
    } catch (e) { hasil = { ok: false, ...(await pesanDariFungsi(e)) }; }
    hasil = { ...hasil, seq };
    onSlot(seq - 1, hasil);
    return hasil;
  };
  const semua = await Promise.all(Array.from({ length: n }, (_, i) => satu(i + 1)));
  return { batchId, hasil: semua };
}

// Mengambil gambar hasil dari penyimpanan menjadi File, agar jalurnya sama dengan foto yang diunggah manual (pasangFoto).
export async function gambarKeFile(client, path, nama = 'wajah-ai') {
  const blob = await muatFoto(client, path);
  const type = blob.type || 'image/png'; const ext = ekstensi(type);
  return new File([blob], `${nama}.${ext}`, { type });
}

// ───────────── Riwayat (admin) ─────────────
export async function ringkasanBiaya(client, { dari, sampai }) {
  const r = await client.rpc('ugc_image_cost_summary', { p_from: dari, p_to: sampai });
  if (r.error) throw r.error;
  return (r.data || []).map(x => ({ uid: x.uid, nama: x.nama, gambar: Number(x.gambar), gagal: Number(x.gagal), usd: Number(x.usd), idr: Number(x.idr), tanpaBiaya: Number(x.tanpa_biaya) }));
}
export function jumlahkan(baris) {   // dibulatkan agar penjumlahan desimal tidak menghasilkan ekor seperti 0.06999999
  const t = baris.reduce((a, x) => ({ gambar: a.gambar + x.gambar, gagal: a.gagal + x.gagal, usd: a.usd + x.usd, idr: a.idr + x.idr, tanpaBiaya: a.tanpaBiaya + x.tanpaBiaya }), { gambar: 0, gagal: 0, usd: 0, idr: 0, tanpaBiaya: 0 });
  return { ...t, usd: Number(t.usd.toFixed(6)), idr: Number(t.idr.toFixed(2)) };
}
export async function daftarRiwayat(client, { dari, sampai, uid = null, jenis = null, batas = 50, mulai = 0 }) {
  const r = await client.rpc('ugc_image_runs_list', { p_from: dari, p_to: sampai, p_user: uid || null, p_kind: jenis || null, p_limit: batas, p_offset: mulai });
  if (r.error) throw r.error;
  const baris = r.data || [];
  return { baris, total: baris.length ? Number(baris[0].total) : 0 };
}
export async function tautkanGambar(client, runId, karakterId) {
  const r = await client.rpc('ugc_image_link', { p_run: runId, p_character: karakterId });
  if (r.error) throw r.error;
}
export function galatRiwayat(e) {
  const m = String((e && (e.message || e)) || '');
  if ((e && e.code === '42501') || /khusus admin/i.test(m)) return 'Riwayat generate dan laporan biaya khusus admin.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Tidak tersambung ke server. Periksa koneksi internet, lalu coba lagi.';
  if (/Could not find the function|does not exist|schema cache/i.test(m)) return 'Fitur ini belum aktif di database: jalankan berkas migrasi 20261006000800_generate_gambar.sql lebih dulu.';
  return `Terjadi kesalahan: ${m.slice(0, 160)}`;
}

// CSV riwayat (untuk pembukuan). Kolom jelas, Rupiah dan USD apa adanya, kutip ganda di-escape.
export function riwayatKeCsv(baris) {
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const kol = ['Waktu (ISO)', 'Siapa', 'Jenis', 'Karakter', 'Kualitas', 'Status', 'Durasi (detik)', 'USD', 'Kurs IDR/USD', 'Rupiah', 'Galat'];
  const isi = baris.map(r => [r.waktu, r.nama, JENIS[r.jenis] || r.jenis, r.kode_karakter || '', r.kualitas, r.status, r.durasi_ms == null ? '' : (r.durasi_ms / 1000).toFixed(1), r.usd ?? '', r.kurs ?? '', r.idr ?? '', r.galat || ''].map(q).join(','));
  return '\ufeff' + [kol.join(','), ...isi].join('\r\n') + '\r\n';
}
