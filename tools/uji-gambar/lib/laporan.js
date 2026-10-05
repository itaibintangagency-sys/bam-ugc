'use strict';
const fs = require('fs');
const path = require('path');
const csvq = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

function summarize(rows) {
  const ok = rows.filter(r => r.status === 'ok'); const cost = ok.map(r => r.biaya_usd).filter(x => typeof x === 'number');
  return { total: rows.length, sukses: ok.length, gagal: rows.filter(r => r.status === 'gagal').length, kering: rows.filter(r => r.status === 'kering').length,
    biaya_usd: cost.length ? Number(cost.reduce((a, b) => a + b, 0).toFixed(4)) : null, biaya_tercatat: cost.length,
    detik_rata2: ok.length ? Number((ok.reduce((a, r) => a + r.detik, 0) / ok.length).toFixed(1)) : null, detik_maks: ok.length ? Math.max(...ok.map(r => r.detik)) : null };
}
function write(dir, command, rows, extra = []) {
  const cols = ['no', 'nama', 'jenis', 'model', 'kualitas', 'rasio', 'rujukan', 'status', 'detik', 'biaya_usd', 'ukuran_px', 'berkas', 'catatan'];
  fs.writeFileSync(path.join(dir, 'laporan.csv'), '\ufeff' + [cols.join(','), ...rows.map(r => cols.map(c => csvq(r[c])).join(','))].join('\r\n') + '\r\n');
  const s = summarize(rows);
  const md = [`# Laporan uji gambar — ${command}`, '', `Dibuat: ${new Date().toISOString()}`, '',
    `| Ringkasan | Nilai |`, `|---|---|`, `| Permintaan | ${s.total} |`, `| Sukses | ${s.sukses} |`, `| Gagal | ${s.gagal} |`, ...(s.kering ? [`| Hanya disusun (tanpa dikirim) | ${s.kering} |`] : []),
    `| Biaya tercatat (USD) | ${s.biaya_usd == null ? '(server tidak melaporkan biaya)' : `${s.biaya_usd} dari ${s.biaya_tercatat} gambar`} |`, `| Waktu rata-rata per gambar (detik) | ${s.detik_rata2 ?? '-'} |`, `| Waktu terlama (detik) | ${s.detik_maks ?? '-'} |`, '',
    `| # | Nama | Jenis | Rasio | Kualitas | Rujukan | Status | Detik | USD | Ukuran | Berkas / catatan |`, `|---|---|---|---|---|---|---|---|---|---|---|`,
    ...rows.map(r => `| ${r.no} | ${r.nama} | ${r.jenis} | ${r.rasio || '-'} | ${r.kualitas} | ${r.rujukan} | ${r.status} | ${r.detik ?? '-'} | ${r.biaya_usd ?? '-'} | ${r.ukuran_px || '-'} | ${r.berkas || ''}${r.catatan ? ' — ' + r.catatan : ''} |`), '', ...extra, '',
    'Catatan: gambar yang gagal tidak ditagih OpenRouter. Biaya di atas dibaca dari respons server dan bisa kosong untuk sebagian penyedia.', ''].join('\n');
  fs.writeFileSync(path.join(dir, 'laporan.md'), md);
  return s;
}
module.exports = { summarize, write };
