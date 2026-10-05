'use strict';
// Acak urutan panel 2-4 dengan seed. Angle melekat pada slot, bukan nomor panel.
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffle(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// level 0 = ketat; 1 = longgarkan larangan samping/belakang di panel 2; 2 = longgarkan angle sama berurutan
function valid(order, p1, p5, level) {
  if (order[0].extreme) return false;
  if (level < 2) {
    const seq = [p1, ...order.map(s => s.angle), p5];
    for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) return false;
  }
  if (level < 1 && order[0].sideback) return false;
  return true;
}

// pool: slot yang boleh dipakai, berurutan prioritas. Slot pertama selalu dipakai.
function buildPanelOrder({ pool, panel1Angle, panel5Angle, seed, history = [] }) {
  if (pool.length < 3) return { error: 'slot terlihat kurang dari 3: tambah foto atau konfirmasi detail produk', tersedia: pool.map(s => s.key) };
  const rnd = mulberry32(seed >>> 0);
  const [wajib, ...sisa] = pool;
  for (const level of [0, 1, 2]) {
    for (let t = 0; t < 300; t++) {
      const dipilih = [wajib, ...shuffle(sisa, rnd).slice(0, 2)];
      const order = shuffle(dipilih, rnd);
      const key = order.map(s => s.key).join('>');
      if (valid(order, panel1Angle, panel5Angle, level) && !history.includes(key)) return { seed, level, order, key };
    }
  }
  return { seed, habis: true, pesan: 'Semua urutan sudah pernah dipakai. Ganti lokasi atau kosongkan riwayat.' };
}
module.exports = { buildPanelOrder, mulberry32, shuffle, valid };
