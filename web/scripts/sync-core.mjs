// Menyalin kode DNA dan suara dari ../core ke src/core sebagai modul ES, supaya website tidak bergantung pada folder core
// saat dibangun (Vercel boleh memakai Root Directory = web). core/ tetap SATU-SATUNYA sumber; berkas hasil jangan diedit.
// Jalankan:  npm run sync-core      Pemeriksaan:  npm test (test/core-sync.test.js gagal bila salinan basi)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CORE = path.resolve(HERE, '..', '..', 'core');
export const OUT = path.resolve(HERE, '..', 'src', 'core');
const HEADER = '// BERKAS HASIL SALINAN dari core/ oleh scripts/sync-core.mjs. Jangan diedit di sini; ubah di core/ lalu jalankan: npm run sync-core\n';

function toEsm(name, src) {
  let s = src.replace(/^'use strict';\r?\n/, '');
  s = s.replace(/const (\w+) = require\('\.\.\/data\/([\w.-]+\.json)'\);/g, "import $1 from './$2';");
  const m = /module\.exports = \{([^}]*)\};?\s*$/.exec(s);
  if (!m) throw new Error(`${name}: tidak menemukan module.exports di akhir berkas`);
  s = s.replace(m[0], `export {${m[1]}};\n`);
  if (/\brequire\(/.test(s)) throw new Error(`${name}: masih ada require() setelah konversi`);
  const importLines = s.match(/^import .*;$/gm) || [];   // impor harus di awal berkas
  for (const l of importLines) s = s.replace(l + '\n', '');
  return HEADER + (importLines.length ? importLines.join('\n') + '\n' : '') + s;
}

export function build() {
  return {
    'dna.js': toEsm('dna.js', fs.readFileSync(path.join(CORE, 'src', 'dna.js'), 'utf8')),
    'voice.js': toEsm('voice.js', fs.readFileSync(path.join(CORE, 'src', 'voice.js'), 'utf8')),
    'flow_voices.json': fs.readFileSync(path.join(CORE, 'data', 'flow_voices.json'), 'utf8')
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [f, text] of Object.entries(build())) fs.writeFileSync(path.join(OUT, f), text);
  console.log('Salinan core diperbarui di web/src/core');
}
