// src/core harus identik dengan hasil konversi dari ../core. Gagal berarti core/ berubah tetapi salinannya belum diperbarui (npm run sync-core).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE, OUT, build } from '../scripts/sync-core.mjs';

describe('salinan core di website', () => {
  const ada = fs.existsSync(path.join(CORE, 'src', 'dna.js'));
  (ada ? it : it.skip)('sama persis dengan hasil konversi dari core/', () => {
    for (const [nama, teks] of Object.entries(build())) {
      const ada = fs.readFileSync(path.join(OUT, nama), 'utf8');
      expect(ada, `${nama} basi: jalankan npm run sync-core`).toBe(teks);
    }
  });
  it('tidak memuat require() dan diawali penanda berkas hasil salinan', () => {
    for (const nama of ['dna.js', 'voice.js']) {
      const t = fs.readFileSync(path.join(OUT, nama), 'utf8');
      expect(t).not.toMatch(/\brequire\(/); expect(t.startsWith('// BERKAS HASIL SALINAN')).toBe(true); expect(t).toMatch(/\nexport \{/);
    }
  });
});
