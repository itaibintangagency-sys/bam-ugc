// BERKAS HASIL SALINAN dari core/ oleh scripts/sync-core.mjs. Jangan diedit di sini; ubah di core/ lalu jalankan: npm run sync-core
// API gambar OpenRouter, bagian MURNI (tanpa dependensi lain, tanpa jaringan): pembentuk permintaan, pembaca respons, pesan galat awam.
// Dipakai bersama oleh alat uji, agent, dan Edge Function. Disalin ke supabase/functions/_shared/core oleh web/scripts/sync-core.mjs.

const DEFAULT_MODEL = 'openai/gpt-image-2';
const QUALITIES = ['auto', 'low', 'medium', 'high'];
const FORMATS = ['png', 'jpeg', 'webp'];

function refOf(url) {
  if (typeof url !== 'string' || !(/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(url) || /^https:\/\/\S+$/.test(url))) {
    throw new Error('gambar rujukan harus URL https atau data URL base64 (png, jpeg, webp)');
  }
  return { type: 'image_url', image_url: { url } };
}

function buildImageRequest({ model = DEFAULT_MODEL, prompt, quality = 'medium', aspectRatio, size, n, references = [], outputFormat } = {}) {
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) throw new Error('prompt kosong');
  if (!QUALITIES.includes(quality)) throw new Error(`kualitas "${quality}" tidak dikenal. Pilihan: ${QUALITIES.join(', ')}`);
  if (aspectRatio != null && !/^(auto|\d{1,2}:\d{1,2})$/.test(aspectRatio)) throw new Error(`rasio "${aspectRatio}" tidak valid (contoh 21:9, 4:1, 9:16, auto)`);
  if (n != null && !(Number.isInteger(n) && n >= 1 && n <= 10)) throw new Error('n harus bilangan 1 sampai 10');
  if (outputFormat != null && !FORMATS.includes(outputFormat)) throw new Error(`format "${outputFormat}" tidak dikenal. Pilihan: ${FORMATS.join(', ')}`);
  const body = { model, prompt, quality };
  if (aspectRatio != null) body.aspect_ratio = aspectRatio;
  if (size != null) body.size = size;
  if (n != null) body.n = n;
  if (outputFormat != null) body.output_format = outputFormat;
  if (references.length) body.input_references = references.map(refOf);
  return body;
}

function parseImageResponse(json) {
  if (!json || !Array.isArray(json.data) || !json.data.length) throw new Error('respons tanpa gambar');
  const images = json.data.map(d => {
    if (d.b64_json) { const mt = d.media_type || 'image/png'; return { b64: d.b64_json, mediaType: mt, ext: mt.includes('jpeg') ? 'jpg' : mt.includes('webp') ? 'webp' : 'png' }; }
    if (d.url) return { url: d.url, mediaType: d.media_type || 'image/png', ext: 'png' };
    throw new Error('respons berisi gambar tanpa data');
  });
  const u = json.usage || {};
  return { images, cost: typeof u.cost === 'number' ? u.cost : null, usage: u };
}

// Pesan awam untuk kegagalan umum; teks asli dari server ikut dilampirkan.
function describeError(status, body) {
  const raw = (body && (body.error && (body.error.message || body.error) || body.message)) || '';
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const tail = text ? ` (pesan server: ${text.slice(0, 240)})` : '';
  if (status === 401 || status === 403) return `Kunci OpenRouter ditolak. Periksa kunci dan pastikan akunnya aktif.${tail}`;
  if (status === 402) return `Saldo OpenRouter tidak cukup. Isi saldo lalu ulangi.${tail}`;
  if (status === 429) return `Terlalu banyak permintaan (batas laju). Tunggu sebentar lalu ulangi.${tail}`;
  if (status === 400 && /moderat|safety|policy|content|blocked|refus/i.test(text)) return `Permintaan ditolak oleh penyaring isi model. Ubah deskripsi atau foto rujukan.${tail}`;
  if (status === 400) return `Permintaan tidak diterima (parameter atau gambar rujukan tidak sesuai dengan model ini).${tail}`;
  if (status === 404) return `Model atau alamat tidak ditemukan. Periksa nama model.${tail}`;
  if (status >= 500) return `Penyedia gambar bermasalah sementara (kode ${status}). Gambar gagal tidak ditagih.${tail}`;
  return `Kegagalan tidak dikenal (kode ${status}).${tail}`;
}

export { DEFAULT_MODEL, QUALITIES, FORMATS, refOf, buildImageRequest, parseImageResponse, describeError };
