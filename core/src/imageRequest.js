'use strict';
// Permintaan ke API gambar OpenRouter (POST /api/v1/images), format yang sama dengan alat uji lama:
//   { model, prompt, quality, [aspect_ratio], [size], [n], [output_format], input_references:[{type:'image_url', image_url:{url}}] }
// Gambar rujukan boleh URL https atau data URL base64. Respons: data[].b64_json + media_type, usage.cost.
// Modul ini TIDAK memanggil jaringan; ia menjamin bahwa urutan dan jumlah gambar rujukan cocok dengan prompt.
const { buildStoryboardPrompt } = require('./storyboardPrompt');

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

/**
 * Storyboard: gambar 1 = rujukan karakter, gambar 2.. = foto produk, urut sesuai peran pada prompt.
 * ctx: { variant:'clean'|'documented', characterCode, productProfile, characterRef, productRefs:[{role, url}], aspectRatio, quality, model }
 */
function storyboardImageRequest(plan, ctx) {
  const { variant = 'clean', characterCode = '', productProfile, characterRef, productRefs = [], aspectRatio, quality, model } = ctx;
  if (!characterRef) throw new Error('foto wajah karakter wajib (gambar 1 = rujukan karakter)');
  if (!productRefs.length) throw new Error('minimal satu foto produk');
  if (productRefs.length > 6) throw new Error('maksimal 6 foto produk');
  const prompt = buildStoryboardPrompt(plan, { variant, characterCode, productProfile, images: productRefs.map(r => ({ role: r.role })) });
  const body = buildImageRequest({ model, prompt, quality, aspectRatio, references: [characterRef, ...productRefs.map(r => r.url)] });
  const m = /IMAGES (\d+) to (\d+) = PRODUCT REFERENCES/.exec(prompt);
  if (!m || Number(m[1]) !== 2 || Number(m[2]) !== 1 + productRefs.length || !/IMAGE 1 = CHARACTER REFERENCE/.test(prompt)) {
    throw new Error('urutan gambar pada prompt tidak cocok dengan gambar rujukan yang dikirim');
  }
  if (body.input_references.length !== 1 + productRefs.length) throw new Error('jumlah gambar rujukan tidak cocok dengan prompt');
  return { body, prompt };
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

module.exports = { DEFAULT_MODEL, QUALITIES, buildImageRequest, storyboardImageRequest, parseImageResponse, describeError };
