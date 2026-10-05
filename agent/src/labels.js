'use strict';
// Pemetaan label Flow dua bahasa (Inggris dan Indonesia). Semua pencocokan memakai gabungan kedua bahasa,
// jadi agent tetap jalan walau bahasa antarmuka Flow berganti (mis. akun Google berbeda).
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class Labels {
  constructor(cfg) {
    if (!cfg.languages) throw new Error('Konfigurasi label tidak memiliki bagian "languages"');
    this.cfg = cfg;
    this.codes = Object.keys(cfg.languages);
  }
  // Semua nilai (unik) untuk satu kunci di seluruh bahasa.
  all(group, key) {
    const out = [];
    for (const c of this.codes) {
      const v = (this.cfg.languages[c][group] || {})[key];
      if (v != null && v !== '' && !out.includes(v)) out.push(v);
    }
    return out;
  }
  label(key) { return this.all('labels', key); }
  show(key, group = 'labels') { return this.all(group, key).join(' / '); }
  // Selektor CSS gabungan: tag[aria-label="A"]:visible, tag[aria-label="B"]:visible
  aria(key, tag = 'button') { return this.label(key).map(v => `${tag}[aria-label="${v}"]:visible`).join(', '); }
  // Regex nama aksesibel, anchored. exact=false memakai pencocokan sebagian.
  nameRe(key, { group = 'labels', exact = true } = {}) {
    const alts = this.all(group, key).map(esc);
    return new RegExp(exact ? `^(?:${alts.join('|')})$` : `(?:${alts.join('|')})`, 'i');
  }
  partialRe(group, key) { return this.nameRe(key, { group, exact: false }); }
  durRe(n) {
    const alts = this.all('radios', 'dur').map(t => esc(t.replace('{n}', n)));
    return new RegExp(`(?:^|\\s)(?:${alts.join('|')})\\s*$`, 'i');
  }
  creditsRe() {
    const words = []; for (const c of this.codes) for (const w of this.cfg.languages[c].credits || []) if (!words.includes(w)) words.push(w);
    return new RegExp(`^(\\d+)\\s*(?:${words.map(esc).join('|')})$`, 'i');
  }
  creditsSentenceRe() { return /(?:menggunakan|will use)\s+(\d+)\s*(?:kredit|credits?)/i; }
  failureWords() {
    const w = []; for (const c of this.codes) for (const x of (this.cfg.languages[c].failure || {}).words || []) if (!w.includes(x)) w.push(x);
    return w;
  }
  classify(message) {
    for (const c of this.codes) for (const r of (this.cfg.languages[c].failure || {}).classify || []) {
      if (new RegExp(r.pattern, 'i').test(message || '')) return r.kind;
    }
    return 'unknown';
  }
  // Bahasa antarmuka yang terdeteksi dari tombol pada halaman. Mengembalikan kode bahasa atau null.
  async detect(page) {
    for (const c of this.codes) {
      const v = this.cfg.languages[c].labels.settingsChip;
      if (await page.locator(`button[aria-label="${v}"]:visible`).count().catch(() => 0)) return c;
    }
    return null;
  }
  unverified() {
    const out = [];
    for (const c of this.codes) for (const k of this.cfg.languages[c].tidak_terverifikasi || []) out.push(`${c}:${k}`);
    return out;
  }
}
module.exports = { Labels, esc };
