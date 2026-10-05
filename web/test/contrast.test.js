// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { contrastRatio } from '../src/lib/contrast.js';

// Membaca token warna langsung dari tokens.css, sehingga mengubah warna tanpa memeriksa kontras akan membuat tes gagal.
const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const T = Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)].map(m => [m[1], m[2]]));
const rasio = (a, b) => contrastRatio(T[a], T[b]);

describe('kontras warna (WCAG)', () => {
  it('token yang dibutuhkan ada', () => {
    for (const k of ['bg', 'panel', 'text', 'muted', 'accent', 'on-accent', 'border', 'focus', 'danger-text', 'danger-bg']) expect(T[k], k).toBeTruthy();
  });
  it('teks utama dan teks pendukung memenuhi AAA (7:1) di latar halaman dan kartu', () => {
    for (const bg of ['bg', 'panel']) { expect(rasio('text', bg)).toBeGreaterThanOrEqual(7); expect(rasio('muted', bg)).toBeGreaterThanOrEqual(7); }
  });
  it('teks tombol utama minimal 4,5:1 (AA)', () => { expect(rasio('on-accent', 'accent')).toBeGreaterThanOrEqual(4.5); expect(rasio('on-accent', 'accent-hover')).toBeGreaterThanOrEqual(4.5); });
  it('logo berwarna aksen terbaca di kartu (teks besar min 3:1, di sini diminta 4,5:1)', () => { expect(rasio('accent', 'panel')).toBeGreaterThanOrEqual(4.5); });
  it('garis tepi isian dan tombol sekunder minimal 3:1 terhadap latar', () => { expect(rasio('border', 'bg')).toBeGreaterThanOrEqual(3); expect(rasio('border', 'panel')).toBeGreaterThanOrEqual(3); });
  it('cincin fokus keyboard minimal 3:1', () => { expect(rasio('focus', 'bg')).toBeGreaterThanOrEqual(3); expect(rasio('focus', 'panel')).toBeGreaterThanOrEqual(3); });
  it('pesan galat, peringatan, dan sukses terbaca di latarnya (AAA)', () => {
    expect(rasio('danger-text', 'danger-bg')).toBeGreaterThanOrEqual(7);
    expect(rasio('warn-text', 'warn-bg')).toBeGreaterThanOrEqual(7);
    expect(rasio('ok-text', 'ok-bg')).toBeGreaterThanOrEqual(7);
  });
  it('placeholder isian minimal 4,5:1 di latar isian', () => {
    const login = readFileSync(new URL('../src/styles/login.css', import.meta.url), 'utf8');
    const ph = /::placeholder\s*\{\s*color:\s*(#[0-9A-Fa-f]{6})/.exec(login)[1];
    expect(contrastRatio(ph, T.bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('tidak ada ukuran huruf di bawah 14px pada gaya login dan aplikasi', () => {
    for (const f of ['login.css', 'app.css', 'base.css']) {
      const s = readFileSync(new URL('../src/styles/' + f, import.meta.url), 'utf8');
      for (const m of s.matchAll(/font-size:\s*([\d.]+)px/g)) expect(Number(m[1]), f).toBeGreaterThanOrEqual(14);
      for (const m of s.matchAll(/font-size:\s*([\d.]+)rem/g)) expect(Number(m[1]) * 16, f).toBeGreaterThanOrEqual(14);
    }
  });
});
