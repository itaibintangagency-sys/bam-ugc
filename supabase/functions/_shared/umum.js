// Bagian bersama Edge Function (generate-image, analyze-product): bentuk jawaban, penyamaran kunci, dan kurs USD ke Rupiah.
// Semua akses luar masuk lewat objek `d` yang disuntikkan, jadi seluruhnya teruji di Node tanpa Supabase dan tanpa jaringan.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const KURS = { ttlMs: 12 * 3600 * 1000, wajarMin: 1000, wajarMax: 100000, timeoutMs: 5000 };

export const jawab = (status, json) => ({ status, json });
export const galat = (status, kode, pesan, extra = {}) => jawab(status, { ok: false, kode, pesan, ...extra });
export const bulat = (v, def) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def; };
export const tidur = ms => new Promise(r => setTimeout(r, ms));
// Pesan dari server luar bisa memuat kunci (mis. pesan galat yang menggemakan header). Samarkan sebelum disimpan atau dikirim.
export const samarkan = (teks, kunci) => { let t = String(teks == null ? '' : teks); if (kunci) t = t.split(kunci).join('[kunci disembunyikan]'); return t.replace(/sk-or-[A-Za-z0-9_-]{8,}/g, '[kunci disembunyikan]'); };

// ───────────── Kurs USD -> IDR ─────────────
// Urutan: kurs manual admin -> kurs otomatis yang masih segar -> Frankfurter -> open.er-api -> kurs otomatis lama -> tidak ada.
// Kurs referensi harian (bukan kurs jual-beli bank). Disimpan per gambar, jadi riwayat tidak berubah ketika kurs berubah.
export async function ambilKurs(d, settings) {
  const wajar = x => Number.isFinite(x) && x >= KURS.wajarMin && x <= KURS.wajarMax;
  const manual = Number(settings.kurs_usd_idr_manual);
  if (wajar(manual)) return { rate: manual, sumber: 'manual', tanggal: null };
  const c = settings.kurs_usd_idr;
  const umur = c && c.fetched_at ? d.now() - Date.parse(c.fetched_at) : Infinity;
  if (c && wajar(Number(c.rate)) && umur < KURS.ttlMs) return { rate: Number(c.rate), sumber: c.source || 'cache', tanggal: c.date || null };

  const coba = async (url, baca) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), KURS.timeoutMs);
    try { const r = await d.fetch(url, { signal: ctl.signal }); if (!r.ok) return null; const x = baca(await r.json()); return x && wajar(x.rate) ? x : null; }
    catch { return null; } finally { clearTimeout(t); }
  };
  const baru = (await coba('https://api.frankfurter.dev/v1/latest?base=USD&symbols=IDR', j => ({ rate: Number(j && j.rates && j.rates.IDR), sumber: 'frankfurter', tanggal: (j && j.date) || null })))
    || (await coba('https://open.er-api.com/v6/latest/USD', j => (j && j.result === 'success' ? { rate: Number(j.rates && j.rates.IDR), sumber: 'open.er-api', tanggal: String(j.time_last_update_utc || '').slice(0, 16) || null } : null)));
  if (baru) {
    try { await d.setSetting('kurs_usd_idr', { rate: baru.rate, date: baru.tanggal, source: baru.sumber, fetched_at: new Date(d.now()).toISOString() }); } catch { /* menyimpan cache gagal tidak menggagalkan gambar */ }
    return baru;
  }
  if (c && wajar(Number(c.rate))) return { rate: Number(c.rate), sumber: `${c.source || 'cache'} (lama)`, tanggal: c.date || null };
  return null;
}

