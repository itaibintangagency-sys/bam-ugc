'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_BYTES = 6 * 1024 * 1024;

const clean = s => String(s == null ? '' : s).trim().replace(/^["']+|["']+$/g, '').trim();
function readImage(file) {
  const f = clean(file); const ext = path.extname(f).toLowerCase();
  if (!fs.existsSync(f)) throw new Error(`Berkas tidak ditemukan: "${f}". Ketik alamat lengkap (mulai dari C:\\) tanpa tanda kutip.`);
  if (!MIME[ext]) throw new Error(`Format "${ext || '(tanpa ekstensi)'}" tidak didukung untuk "${f}". Pakai png, jpg, atau webp.`);
  const buf = fs.readFileSync(f);
  if (buf.length > MAX_BYTES) throw new Error(`Berkas "${path.basename(f)}" berukuran ${(buf.length / 1048576).toFixed(1)} MB (batas ${MAX_BYTES / 1048576} MB). Perkecil dulu.`);
  return { file: f, name: path.basename(f), bytes: buf.length, sha: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12), url: `data:${MIME[ext]};base64,${buf.toString('base64')}` };
}
function listImages(dir) {
  const d = clean(dir);
  if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) throw new Error(`Folder foto tidak ditemukan: "${d}".`);
  const files = fs.readdirSync(d).filter(n => MIME[path.extname(n).toLowerCase()]).sort();
  if (!files.length) throw new Error(`Folder "${d}" tidak berisi foto (png, jpg, webp).`);
  return files.map(n => path.join(d, n));
}
// Peran foto dari nama berkas; sisanya berurutan: depan, closeup, tekstur.
function roleOf(name, i, used) {
  const n = name.toLowerCase(); const by = [[/belakang|back/, 'belakang'], [/samping|side/, 'samping'], [/close|detail/, 'closeup'], [/tekstur|texture/, 'tekstur'], [/depan|front/, 'depan']];
  for (const [re, r] of by) if (re.test(n)) return r;
  return ['depan', 'closeup', 'tekstur', 'samping', 'belakang', 'label'][Math.min(i, 5)];
}
// Dimensi PNG dan JPEG dari byte data (tanpa pustaka). Mengembalikan null bila tidak terbaca.
function dimsOf(buf) {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf[0] === 0xff && buf[1] === 0xd8) { let i = 2; while (i < buf.length - 9) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; i += 2 + buf.readUInt16BE(i + 2); } }
  } catch { /* abaikan */ }
  return null;
}
const stamp = () => { const d = new Date().toISOString().replace(/[-:TZ]/g, '').replace('.', ''); return `${d.slice(0, 8)}-${d.slice(8, 14)}-${d.slice(14, 17)}`; };   // YYYYMMDD-HHMMSS-mmm
module.exports = { clean, readImage, listImages, roleOf, dimsOf, stamp, MIME };
