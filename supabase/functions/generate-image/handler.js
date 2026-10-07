// Inti Edge Function generate-image. SEMUA akses luar (login, database, penyimpanan, jaringan, jam) masuk lewat objek `d`,
// sehingga seluruh logika diuji di Node tanpa Supabase dan tanpa OpenRouter. index.ts hanya menyambungkan `d` ke yang sungguhan.
//
// Alur satu gambar: login -> peran -> validasi (DNA diperiksa ULANG di server) -> pesan jatah atomik (batas harian) ->
// foto acuan (bila ada) -> panggil OpenRouter -> simpan gambar -> catat biaya dan kurs. Kunci OpenRouter hanya ada di `d.apiKey`.
import { validateDna, validateReference, buildFacePrompt, HUBUNGAN, ASAL_WAJAH } from '../_shared/core/dna.js';
import { buildImageRequest, parseImageResponse, describeError, DEFAULT_MODEL } from '../_shared/core/imageApi.js';
import { UUID, ambilKurs, bulat, galat, jawab, samarkan, tidur } from '../_shared/umum.js';
export { ambilKurs };   // tetap diekspor dari sini agar pemanggil lama tidak berubah

export const BATAS = {
  anggaranMs: 140000,            // di bawah batas 150 detik Supabase (paket Free); gambar yang lebih lama dicatat gagal, bukan 504
  sisaMinMs: 10000,              // di bawah ini tidak lagi memulai panggilan ke OpenRouter
  cobaUlangMinSisaMs: 45000,     // percobaan ulang hanya bila sisa waktu cukup
  refMaksByte: 6 * 1024 * 1024,
};
const KIND = ['wajah_dna', 'wajah_acuan'];     // lembar sudut dan storyboard menyusul di tahap berikutnya
const KUALITAS = ['low', 'medium', 'high'];
const TIPE_REF = ['image/png', 'image/jpeg', 'image/webp'];
const OPENROUTER = 'https://openrouter.ai/api/v1/images';


// ───────────── Satu gambar ─────────────
export async function handle({ token, body }, d) {
  const t0 = d.now();
  if (!token) return galat(401, 'belum_login', 'Perlu login. Masuk lagi lalu coba ulang.');
  const user = await d.getUser(token);
  if (!user || !user.id) return galat(401, 'sesi_tidak_valid', 'Sesi login tidak valid atau sudah habis. Masuk lagi lalu coba ulang.');
  const role = await d.getRole(user.id);
  if (role !== 'admin' && role !== 'staff') return galat(403, 'tanpa_izin', 'Akun ini tidak punya izin membuat gambar.');
  const admin = role === 'admin';
  if (!d.apiKey) return galat(500, 'kunci_belum_dipasang', 'Kunci OpenRouter belum dipasang di server (secret OPENROUTER_API_KEY). Hubungi admin.');

  // ── Validasi masukan ──
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  if (!b) return galat(400, 'masukan_salah', 'Permintaan tidak terbaca.');
  if (!KIND.includes(b.kind)) return galat(400, 'jenis_tidak_didukung', `Jenis "${String(b.kind).slice(0, 30)}" belum tersedia. Pilihan: ${KIND.join(', ')}.`);
  if (!UUID.test(String(b.batch_id || ''))) return galat(400, 'masukan_salah', 'batch_id harus UUID.');
  const settings = await d.getSettings(['gen_max_per_click', 'gen_daily_limit_staff', 'gen_model', 'kurs_usd_idr', 'kurs_usd_idr_manual']);
  const maks = Math.min(8, Math.max(1, bulat(settings.gen_max_per_click, 4)));
  const seq = Number(b.seq), total = Number(b.total);
  if (!Number.isInteger(seq) || seq < 1 || seq > maks) return galat(400, 'melebihi_per_klik', `Nomor gambar harus 1 sampai ${maks} (batas per klik).`);
  if (!Number.isInteger(total) || total < seq || total > maks) return galat(400, 'melebihi_per_klik', `Jumlah gambar per klik maksimal ${maks}.`);
  if (!KUALITAS.includes(b.quality)) return galat(400, 'masukan_salah', 'Kualitas harus low, medium, atau high.');
  if (b.quality === 'high' && !admin) return galat(403, 'kualitas_admin', 'Kualitas high hanya untuk admin. Pilih low atau medium.');

  const dna = b.dna;
  const masalahDna = validateDna(dna);
  if (masalahDna.length) return galat(400, 'dna_tidak_valid', `DNA tidak valid: ${masalahDna[0].field}: ${masalahDna[0].msg}`);   // aturan dewasa ditegakkan di server

  // Asal wajah (petunjuk tampilan umum wajah): hanya untuk wajah dari DNA dan hanya masuk ke prompt gambar.
  const asal = b.asal == null || b.asal === '' ? null : b.asal;
  if (asal != null) {
    if (b.kind !== 'wajah_dna') return galat(400, 'masukan_salah', 'Asal wajah hanya untuk wajah dari DNA. Pada foto acuan, wajah mengikuti foto.');
    if (typeof asal !== 'string' || !Object.prototype.hasOwnProperty.call(ASAL_WAJAH, asal)) return galat(400, 'asal_salah', `Asal wajah tidak dikenal. Pilihan: ${Object.keys(ASAL_WAJAH).join(', ')}.`);
  }

  const acuan = b.kind === 'wajah_acuan';
  let ref = null;
  if (acuan) {
    const rel = String(b.relation || ''), note = typeof b.note === 'string' ? b.note : '';
    if (!HUBUNGAN[rel]) return galat(400, 'hubungan_salah', 'Hubungan foto acuan tidak dikenal.');
    const bad = validateReference({ relation: rel, note }, dna);
    if (bad.length) return galat(400, 'acuan_tidak_valid', `Foto acuan tidak valid: ${bad[0].msg}`);
    const rp = String(b.ref_path || '');
    if (!rp.startsWith(`refs/${user.id}/`) || rp.includes('..') || rp.length > 200) return galat(400, 'ref_salah', 'Foto acuan harus diunggah lewat website oleh akun Anda sendiri.');
    ref = { relation: rel, note, path: rp };
  } else if (b.relation || b.ref_path || b.note) return galat(400, 'masukan_salah', 'Hubungan, catatan, dan foto acuan hanya untuk jenis wajah_acuan.');

  const model = (typeof settings.gen_model === 'string' && settings.gen_model) || DEFAULT_MODEL;
  const aspek = '3:4';
  const runId = d.uuid();
  const batas = admin ? null : bulat(settings.gen_daily_limit_staff, 20);

  // ── Pesan jatah (atomik: batas harian dan baris 'running' sekaligus) ──
  const pesan = await d.reserve({ id: runId, batch_id: b.batch_id, seq, user_id: user.id, kind: b.kind, model, quality: b.quality, aspect_ratio: aspek, relation: ref ? ref.relation : null, ref_path: ref ? ref.path : null, dna: asal ? { ...dna, asal_wajah: asal } : dna, note: ref && ref.note ? ref.note.slice(0, 200) : null }, batas);
  if (pesan === 'batas') return galat(429, 'batas_harian', `Batas harian ${batas} gambar sudah tercapai. Coba lagi besok, atau minta admin menaikkan batas.`);
  if (pesan === 'duplikat') return galat(409, 'duplikat', 'Nomor gambar ini sudah pernah diminta pada klik yang sama. Mulai klik baru.');
  if (pesan !== 'ok') return galat(500, 'pemesanan_gagal', 'Tidak bisa mencatat permintaan. Coba lagi.');

  let biaya = {};   // terisi setelah gambar jadi
  const gagal = async (status, kode, pesanAsli) => {
    const pesanTeks = samarkan(pesanAsli, d.apiKey);
    try { await d.updateRun(runId, { status: 'gagal', error: pesanTeks.slice(0, 500), finished_at: new Date(d.now()).toISOString(), duration_ms: d.now() - t0, ...biaya }); } catch { /* catatan gagal tidak boleh menutupi galat aslinya */ }
    return galat(status, kode, pesanTeks, { run_id: runId });
  };

  try {
    // ── Foto acuan ──
    const references = [];
    if (ref) {
      const f = await d.downloadRef(ref.path);
      if (!f || !f.bytes) return await gagal(404, 'ref_tidak_ada', 'Foto acuan tidak ditemukan di penyimpanan. Unggah ulang lalu coba lagi.');
      if (f.bytes.length > BATAS.refMaksByte) return await gagal(400, 'ref_terlalu_besar', 'Foto acuan terlalu besar (batas 6 MB).');
      if (!TIPE_REF.includes(f.contentType)) return await gagal(400, 'ref_format', 'Format foto acuan harus PNG, JPG, atau WEBP.');
      references.push(`data:${f.contentType};base64,${d.toBase64(f.bytes)}`);
    }
    const prompt = buildFacePrompt(dna, seq, ref ? { relation: ref.relation, note: ref.note } : null, asal);
    const req = buildImageRequest({ model, quality: b.quality, aspectRatio: aspek, prompt, references });

    // ── OpenRouter (satu percobaan ulang bila gagal cepat karena jaringan atau 5xx) ──
    let hasil = null, sebab = '';
    for (let coba = 1; coba <= 2; coba++) {
      const sisa = BATAS.anggaranMs - (d.now() - t0);
      if (sisa < BATAS.sisaMinMs) { sebab = sebab || 'Waktu habis sebelum gambar jadi.'; break; }
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), sisa);
      try {
        const r = await d.fetch(OPENROUTER, { method: 'POST', signal: ctl.signal, headers: { Authorization: `Bearer ${d.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'BA UGC' }, body: JSON.stringify(req) });
        const teks = await r.text(); let json = null; try { json = teks ? JSON.parse(teks) : null; } catch { json = { raw: teks.slice(0, 300) }; }
        if (r.status >= 200 && r.status < 300) { hasil = json; break; }
        sebab = describeError(r.status, json);
        if (r.status < 500) break;                                   // 4xx tidak diulang
      } catch (e) {
        sebab = e && e.name === 'AbortError' ? `Waktu habis setelah ${Math.round(BATAS.anggaranMs / 1000)} detik. Coba lagi, atau pakai kualitas lebih rendah.` : `Tidak tersambung ke OpenRouter: ${(e && e.cause && e.cause.code) || (e && e.message) || 'koneksi gagal'}.`;
      } finally { clearTimeout(timer); }
      if (coba === 1 && BATAS.anggaranMs - (d.now() - t0) > BATAS.cobaUlangMinSisaMs) await tidur(d.retryWaitMs ?? 2000); else break;
    }
    if (!hasil) return await gagal(502, 'openrouter_gagal', sebab || 'OpenRouter tidak memberi jawaban.');

    let parsed; try { parsed = parseImageResponse(hasil); } catch (e) { return await gagal(502, 'respons_aneh', `Jawaban OpenRouter tidak berisi gambar (${e.message}).`); }
    const img = parsed.images[0];
    if (!img.b64) return await gagal(502, 'respons_aneh', 'OpenRouter memberi alamat gambar, bukan data. Belum didukung.');

    // ── Biaya dan kurs (dihitung sebelum menyimpan: dicatat walau penyimpanan gagal, karena gambar sudah ditagih) ──
    const usd = parsed.cost;
    let kurs = null; try { kurs = await ambilKurs(d, settings); } catch { kurs = null; }
    const idr = usd != null && kurs ? Math.round(usd * kurs.rate * 100) / 100 : null;
    biaya = { cost_usd: usd, kurs_idr: kurs ? kurs.rate : null, kurs_sumber: kurs ? (kurs.tanggal ? `${kurs.sumber} ${kurs.tanggal}` : kurs.sumber) : null, cost_idr: idr };

    // ── Simpan gambar ──
    const path = `generated/${user.id}/${b.batch_id}/${seq}.${img.ext}`;
    try { await d.uploadImage(path, d.fromBase64(img.b64), img.mediaType); }
    catch (e) { return await gagal(500, 'simpan_gagal', `Gambar jadi tetapi gagal disimpan ke penyimpanan: ${String((e && e.message) || e).slice(0, 200)}. Biaya mungkin sudah terpotong di OpenRouter.`); }

    const durasi = d.now() - t0;
    await d.updateRun(runId, { status: 'ok', finished_at: new Date(d.now()).toISOString(), duration_ms: durasi, ...biaya, image_path: path });
    const out = { ok: true, run_id: runId, image_path: path, duration_ms: durasi };
    if (admin) Object.assign(out, { cost_usd: usd, cost_idr: idr, kurs: kurs ? kurs.rate : null, kurs_sumber: kurs ? kurs.sumber : null });   // biaya hanya dikirim ke admin
    return jawab(200, out);
  } catch (e) {
    return await gagal(500, 'galat_tak_terduga', `Galat tak terduga: ${String((e && e.message) || e).slice(0, 200)}`);
  }
}
