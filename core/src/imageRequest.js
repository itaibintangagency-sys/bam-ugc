'use strict';
// Permintaan ke API gambar OpenRouter (POST /api/v1/images), format yang sama dengan alat uji lama:
//   { model, prompt, quality, [aspect_ratio], [size], [n], [output_format], input_references:[{type:'image_url', image_url:{url}}] }
// Gambar rujukan boleh URL https atau data URL base64. Respons: data[].b64_json + media_type, usage.cost.
// Modul ini TIDAK memanggil jaringan; ia menjamin bahwa urutan dan jumlah gambar rujukan cocok dengan prompt.
const { buildStoryboardPrompt } = require('./storyboardPrompt');
const { DEFAULT_MODEL, QUALITIES, FORMATS, refOf, buildImageRequest, parseImageResponse, describeError } = require('./imageApi');   // bagian murni ada di imageApi.js

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

module.exports = { DEFAULT_MODEL, QUALITIES, buildImageRequest, storyboardImageRequest, parseImageResponse, describeError };
