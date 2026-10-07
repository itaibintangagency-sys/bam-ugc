// Inti Edge Function analyze-product: AI membaca foto produk lalu menyusun DRAF profil (fakta, warna, detail per slot arketipe).
// Fungsi ini TIDAK menulis produk; staf meninjau dan mengonfirmasi di website. Yang dicatat hanya riwayat biaya (ugc_image_runs).
// Semua akses luar masuk lewat objek `d` (lihat index.ts), sehingga seluruh logika diuji di Node tanpa Supabase dan tanpa OpenRouter.
//
// Alur: login -> peran -> produk milik sendiri (atau admin) dengan kategori terpilih -> foto milik produk -> pesan jatah atomik ->
// unduh foto -> OpenRouter (chat, gambar masuk) -> normalisasi dan validasi sesuai aturan planner -> catat biaya dan kurs.
import { MAX_FOTO, ROLES, RESPONSE_FORMAT, buildAnalysisMessages, normalizeAnalysis } from '../_shared/core/productProfile.js';
import { describeError } from '../_shared/core/imageApi.js';
import { UUID, ambilKurs, bulat, galat, jawab, samarkan, tidur } from '../_shared/umum.js';

export const BATAS = {
  anggaranMs: 110000,           // di bawah batas 150 detik Supabase (paket Free)
  sisaMinMs: 10000,
  cobaUlangMinSisaMs: 45000,
  fotoMaksByte: 6 * 1024 * 1024,
  totalMaksByte: 12 * 1024 * 1024,   // gabungan semua foto; menjaga memori fungsi (256 MB) dan biaya token
  maxTokens: 1800
};
export const MODEL_BAWAAN = 'google/gemini-2.5-flash';
const TIPE_FOTO = ['image/png', 'image/jpeg', 'image/webp'];
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

// Isi pesan model bisa berupa teks atau daftar bagian bertipe text.
function isiPesan(json) {
  const c = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(x => (x && typeof x.text === 'string' ? x.text : '')).join('');
  return '';
}

export async function handle({ token, body }, d) {
  const t0 = d.now();
  if (!token) return galat(401, 'belum_login', 'Perlu login. Masuk lagi lalu coba ulang.');
  const user = await d.getUser(token);
  if (!user || !user.id) return galat(401, 'sesi_tidak_valid', 'Sesi login tidak valid atau sudah habis. Masuk lagi lalu coba ulang.');
  const role = await d.getRole(user.id);
  if (role !== 'admin' && role !== 'staff') return galat(403, 'tanpa_izin', 'Akun ini tidak punya izin menganalisis produk.');
  const admin = role === 'admin';
  if (!d.apiKey) return galat(500, 'kunci_belum_dipasang', 'Kunci OpenRouter belum dipasang di server (secret OPENROUTER_API_KEY). Hubungi admin.');

  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  if (!b) return galat(400, 'masukan_salah', 'Permintaan tidak terbaca.');
  if (!UUID.test(String(b.product_id || ''))) return galat(400, 'masukan_salah', 'product_id harus UUID.');

  // ── Produk: ada, milik sendiri atau admin, kategori sudah dipilih, foto milik produk ──
  const p = await d.getProduct(b.product_id);
  if (!p) return galat(404, 'produk_tidak_ada', 'Produk tidak ditemukan.');
  if (p.created_by !== user.id && !admin) return galat(403, 'bukan_milik', 'Produk ini bukan milik Anda.');
  if (!p.archetype_id) return galat(400, 'tanpa_kategori', 'Pilih kategori produk dulu: kategori menentukan slot detail yang dianalisis.');
  const foto = Array.isArray(p.photos) ? p.photos : [];
  if (!foto.length) return galat(400, 'tanpa_foto', 'Unggah minimal satu foto produk dulu.');
  if (foto.length > MAX_FOTO) return galat(400, 'foto_terlalu_banyak', `Maksimal ${MAX_FOTO} foto.`);
  for (const f of foto) {
    if (!f || typeof f.path !== 'string' || !f.path.startsWith(`${p.id}/`) || f.path.includes('..') || f.path.length > 200) return galat(400, 'foto_salah', 'Alamat foto produk tidak valid.');
    if (!ROLES.includes(f.role)) return galat(400, 'foto_salah', `Peran foto "${String(f.role).slice(0, 20)}" tidak dikenal.`);
  }
  const roles = foto.map(f => f.role);
  let pesanModel;
  try { pesanModel = buildAnalysisMessages({ archetypeId: p.archetype_id, kategori: p.kategori || '', roles }); }
  catch (e) { return galat(400, 'masukan_salah', e.message === 'tidak ada foto produk untuk dianalisis' ? 'Hanya ada berkas izin klien; unggah foto produk dulu.' : `Produk belum bisa dianalisis: ${e.message}`); }

  // ── Batas dan jatah (atomik) ──
  const settings = await d.getSettings(['analisis_model', 'analisis_limit_harian_staf', 'kurs_usd_idr', 'kurs_usd_idr_manual']);
  const model = (typeof settings.analisis_model === 'string' && settings.analisis_model) || MODEL_BAWAAN;
  const batas = admin ? null : bulat(settings.analisis_limit_harian_staf, 30);
  const runId = d.uuid();
  const hasilPesan = await d.reserveAnalysis({ id: runId, user_id: user.id, product_id: p.id, model }, batas);
  if (hasilPesan === 'batas') return galat(429, 'batas_harian', `Batas harian ${batas} analisis sudah tercapai. Coba lagi besok, atau isi detail produk secara manual.`);
  if (hasilPesan !== 'ok') return galat(500, 'pemesanan_gagal', 'Tidak bisa mencatat permintaan. Coba lagi.');

  // `biaya` terisi setelah OpenRouter menjawab: jawaban yang sudah ditagih tetapi tidak terbaca tetap dicatat biayanya.
  let biaya = {};
  const gagal = async (status, kode, asli) => {
    const teks = samarkan(asli, d.apiKey);
    try { await d.updateRun(runId, { status: 'gagal', error: teks.slice(0, 500), finished_at: new Date(d.now()).toISOString(), duration_ms: d.now() - t0, ...biaya }); } catch { /* catatan gagal tidak boleh menutupi galat aslinya */ }
    return galat(status, kode, teks, { run_id: runId });
  };

  try {
    // ── Unduh foto (izin_klien bukan foto produk: tidak dikirim ke AI) ──
    const gambar = []; let total = 0;
    for (const f of foto) {
      if (f.role === 'izin_klien') continue;
      const berkas = await d.downloadFoto(f.path);
      if (!berkas || !berkas.bytes) return await gagal(404, 'foto_tidak_ada', 'Salah satu foto produk tidak ditemukan di penyimpanan. Unggah ulang foto itu.');
      if (berkas.bytes.length > BATAS.fotoMaksByte) return await gagal(400, 'foto_terlalu_besar', 'Salah satu foto lebih dari 6 MB. Perkecil dulu.');
      if (!TIPE_FOTO.includes(berkas.contentType)) return await gagal(400, 'foto_format', 'Format foto harus PNG, JPG, atau WEBP.');
      total += berkas.bytes.length;
      if (total > BATAS.totalMaksByte) return await gagal(400, 'foto_terlalu_besar', 'Seluruh foto lebih dari 12 MB. Perkecil foto atau kurangi jumlahnya.');
      gambar.push({ type: 'image_url', image_url: { url: `data:${berkas.contentType};base64,${d.toBase64(berkas.bytes)}` } });
    }
    const req = { model, messages: [{ role: 'system', content: pesanModel.system }, { role: 'user', content: [{ type: 'text', text: pesanModel.user }, ...gambar] }], response_format: RESPONSE_FORMAT, temperature: 0.2, max_tokens: BATAS.maxTokens };

    // ── OpenRouter (satu percobaan ulang bila gagal cepat karena jaringan atau 5xx) ──
    let jawabanJson = null, sebab = '';
    for (let coba = 1; coba <= 2; coba++) {
      const sisa = BATAS.anggaranMs - (d.now() - t0);
      if (sisa < BATAS.sisaMinMs) { sebab = sebab || 'Waktu habis sebelum analisis selesai.'; break; }
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), sisa);
      try {
        const r = await d.fetch(OPENROUTER, { method: 'POST', signal: ctl.signal, headers: { Authorization: `Bearer ${d.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'BA UGC' }, body: JSON.stringify(req) });
        const teks = await r.text(); let json = null; try { json = teks ? JSON.parse(teks) : null; } catch { json = { raw: teks.slice(0, 300) }; }
        if (r.status >= 200 && r.status < 300) { jawabanJson = json; break; }
        sebab = describeError(r.status, json) + (r.status === 404 ? ' Admin: ubah pengaturan analisis_model di tabel ugc_settings.' : '');
        if (r.status < 500) break;
      } catch (e) {
        sebab = e && e.name === 'AbortError' ? `Waktu habis setelah ${Math.round(BATAS.anggaranMs / 1000)} detik. Coba lagi dengan foto lebih sedikit atau lebih kecil.` : `Tidak tersambung ke OpenRouter: ${(e && e.cause && e.cause.code) || (e && e.message) || 'koneksi gagal'}.`;
      } finally { clearTimeout(timer); }
      if (coba === 1 && BATAS.anggaranMs - (d.now() - t0) > BATAS.cobaUlangMinSisaMs) await tidur(d.retryWaitMs ?? 2000); else break;
    }
    if (!jawabanJson) return await gagal(502, 'openrouter_gagal', sebab || 'OpenRouter tidak memberi jawaban.');

    // ── Biaya dan kurs (dihitung segera: dicatat walau jawaban ternyata tidak terbaca) ──
    const usd = jawabanJson.usage && typeof jawabanJson.usage.cost === 'number' ? jawabanJson.usage.cost : null;
    let kurs = null; try { kurs = await ambilKurs(d, settings); } catch { kurs = null; }
    const idr = usd != null && kurs ? Math.round(usd * kurs.rate * 100) / 100 : null;
    biaya = { cost_usd: usd, kurs_idr: kurs ? kurs.rate : null, kurs_sumber: kurs ? (kurs.tanggal ? `${kurs.sumber} ${kurs.tanggal}` : kurs.sumber) : null, cost_idr: idr };

    const isi = isiPesan(jawabanJson);
    if (!isi.trim()) return await gagal(502, 'respons_kosong', 'AI tidak memberi jawaban (kosong atau ditolak). Coba lagi.');
    const hasil = normalizeAnalysis(isi, { archetypeId: p.archetype_id, roles });
    if (!hasil.ok) return await gagal(502, 'respons_aneh', 'AI tidak mengembalikan JSON yang bisa dibaca. Coba lagi, dan bila berulang ganti model di pengaturan analisis_model.');

    const durasi = d.now() - t0;
    await d.updateRun(runId, { status: 'ok', finished_at: new Date(d.now()).toISOString(), duration_ms: durasi, ...biaya });
    const out = { ok: true, run_id: runId, model, duration_ms: durasi, hasil: { profile: hasil.profile, catatan: hasil.catatan, dibuang: hasil.dibuang, issues: hasil.issues, slots: hasil.slots, usable: hasil.usable, ready: hasil.ready } };
    if (admin) Object.assign(out, { cost_usd: usd, cost_idr: idr, kurs: kurs ? kurs.rate : null, kurs_sumber: kurs ? kurs.sumber : null });   // biaya hanya dikirim ke admin
    return jawab(200, out);
  } catch (e) {
    return await gagal(500, 'galat_tak_terduga', `Galat tak terduga: ${String((e && e.message) || e).slice(0, 200)}`);
  }
}
