import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import StatCard from '../components/StatCard.jsx';
import { isAdmin } from '../lib/roles.js';
import { JENIS, bulanIni, daftarRiwayat, detik, galatRiwayat, jumlahkan, rentangBulan, riwayatKeCsv, ringkasanBiaya, rupiah, usd, waktuWib } from '../lib/generate.js';

const HALAMAN = 50;
const STATUS = { ok: { label: 'Berhasil', cls: 'badge-ok' }, gagal: { label: 'Gagal', cls: 'badge-warn' }, running: { label: 'Berjalan', cls: 'badge-warn' } };

export default function Riwayat() {
  const { client, profile } = useAuth();
  const admin = isAdmin(profile);
  const [bulan, setBulan] = useState(bulanIni()); const [uid, setUid] = useState(''); const [jenis, setJenis] = useState(''); const [mulai, setMulai] = useState(0);
  const [ringkas, setRingkas] = useState(null); const [daftar, setDaftar] = useState({ baris: [], total: 0 }); const [memuat, setMemuat] = useState(false); const [galat, setGalat] = useState('');

  const muat = useCallback(async () => {
    if (!admin) return;
    setMemuat(true); setGalat('');
    try {
      const r = rentangBulan(bulan);
      const [a, b] = await Promise.all([ringkasanBiaya(client, r), daftarRiwayat(client, { ...r, uid, jenis, batas: HALAMAN, mulai })]);
      setRingkas(a); setDaftar(b);
    } catch (e) { setGalat(galatRiwayat(e)); }
    finally { setMemuat(false); }
  }, [admin, client, bulan, uid, jenis, mulai]);
  useEffect(() => { muat(); }, [muat]);

  const total = useMemo(() => jumlahkan(ringkas || []), [ringkas]);
  const ubah = fn => v => { fn(v); setMulai(0); };

  function unduh() {
    const blob = new Blob([riwayatKeCsv(daftar.baris)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `riwayat-generate-${bulan}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  if (!admin) {
    return (
      <section aria-labelledby="judul-riwayat">
        <h1 id="judul-riwayat">Riwayat generate</h1>
        <div className="notice notice-warn" role="status" data-testid="khusus-admin">Halaman ini khusus admin. <Link to="/">Kembali ke dasbor</Link></div>
      </section>
    );
  }
  const awal = daftar.total ? mulai + 1 : 0; const akhir = Math.min(mulai + HALAMAN, daftar.total);
  return (
    <section aria-labelledby="judul-riwayat">
      <div className="page-head">
        <h1 id="judul-riwayat">Riwayat generate</h1>
        <button type="button" className="btn btn-secondary" onClick={muat} disabled={memuat}>{memuat ? 'Memuat…' : 'Muat ulang'}</button>
      </div>
      <p className="lead">Siapa membuat gambar AI, kapan, dan berapa biayanya. Satu baris per gambar. Hanya admin yang melihat halaman ini.</p>

      <div className="filter-riwayat">
        <div className="field"><label htmlFor="f-bulan">Bulan</label><input id="f-bulan" type="month" value={bulan} onChange={e => e.target.value && ubah(setBulan)(e.target.value)} /></div>
        <div className="field"><label htmlFor="f-orang">Orang</label>
          <select id="f-orang" value={uid} onChange={e => ubah(setUid)(e.target.value)}>
            <option value="">Semua orang</option>
            {(ringkas || []).map(x => <option key={x.uid} value={x.uid}>{x.nama}</option>)}
          </select></div>
        <div className="field"><label htmlFor="f-jenis">Jenis</label>
          <select id="f-jenis" value={jenis} onChange={e => ubah(setJenis)(e.target.value)}>
            <option value="">Semua jenis</option>
            {Object.entries(JENIS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></div>
      </div>

      {galat && <div className="notice notice-bad" role="alert" data-testid="galat-riwayat">{galat}</div>}

      <h2>Ringkasan {bulan}</h2>
      <div className="grid">
        <StatCard label="Gambar berhasil" value={ringkas ? total.gambar.toLocaleString('id-ID') : '–'} hint={ringkas ? `${total.gagal} gagal (tidak ditagih)` : ''} />
        <StatCard label="Biaya (Rupiah)" value={ringkas ? rupiah(total.idr) : '–'} hint="Kurs saat tiap gambar dibuat" />
        <StatCard label="Biaya (USD)" value={ringkas ? usd(total.usd) : '–'} hint="Dari laporan OpenRouter" />
        <StatCard label="Tanpa biaya terlapor" value={ringkas ? total.tanpaBiaya : '–'} hint="Gambar berhasil tetapi biaya tidak dilaporkan" tone={ringkas && total.tanpaBiaya > 0 ? 'bad' : 'neutral'} />
      </div>

      <h2>Per orang</h2>
      {ringkas && ringkas.length === 0 && <p className="status-muted">Belum ada gambar pada bulan ini.</p>}
      {ringkas && ringkas.length > 0 && (
        <div className="tabel-gulir"><table className="tabel" data-testid="tabel-orang">
          <caption className="sr-only">Biaya generate per orang</caption>
          <thead><tr><th scope="col">Nama</th><th scope="col" className="angka">Gambar</th><th scope="col" className="angka">Gagal</th><th scope="col" className="angka">USD</th><th scope="col" className="angka">Rupiah</th></tr></thead>
          <tbody>{ringkas.map(x => (
            <tr key={x.uid}><th scope="row">{x.nama}</th><td className="angka">{x.gambar}</td><td className="angka">{x.gagal}</td><td className="angka">{usd(x.usd)}</td><td className="angka">{rupiah(x.idr)}</td></tr>
          ))}</tbody>
        </table></div>
      )}

      <h2>Rincian</h2>
      {daftar.baris.length === 0 && !memuat && !galat && <p className="status-muted">Tidak ada data untuk pilihan ini.</p>}
      {daftar.baris.length > 0 && (
        <>
          <p className="hint" data-testid="info-halaman">Menampilkan {awal} sampai {akhir} dari {daftar.total}. <button type="button" className="link" onClick={unduh}>Unduh CSV halaman ini</button></p>
          <div className="tabel-gulir"><table className="tabel" data-testid="tabel-rincian">
            <caption className="sr-only">Rincian generate</caption>
            <thead><tr><th scope="col">Waktu</th><th scope="col">Siapa</th><th scope="col">Jenis</th><th scope="col">Karakter</th><th scope="col">Kualitas</th><th scope="col">Status</th><th scope="col" className="angka">Durasi</th><th scope="col" className="angka">USD</th><th scope="col" className="angka">Rupiah</th></tr></thead>
            <tbody>{daftar.baris.map(r => {
              const st = STATUS[r.status] || STATUS.gagal;
              return (
                <tr key={r.id}>
                  <td>{waktuWib(r.waktu)}</td><th scope="row">{r.nama}</th><td>{JENIS[r.jenis] || r.jenis}{r.hubungan ? ` (${r.hubungan})` : ''}</td>
                  <td>{r.kode_karakter ? `${r.kode_karakter}${r.dipilih ? ' ✓' : ''}` : '–'}</td><td>{r.kualitas}</td>
                  <td><span className={`badge ${st.cls}`}>{st.label}</span>{r.galat && <div className="galat-baris">{r.galat}</div>}</td>
                  <td className="angka">{detik(r.durasi_ms)}</td><td className="angka">{usd(r.usd)}</td><td className="angka">{rupiah(r.idr)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <div className="aksi">
            <button type="button" className="btn btn-secondary" onClick={() => setMulai(m => Math.max(0, m - HALAMAN))} disabled={mulai === 0 || memuat}>Sebelumnya</button>
            <button type="button" className="btn btn-secondary" onClick={() => setMulai(m => m + HALAMAN)} disabled={mulai + HALAMAN >= daftar.total || memuat}>Berikutnya</button>
          </div>
        </>
      )}
      <p className="hint">Tanda ✓ = gambar yang dipilih menjadi foto karakter. Rupiah memakai kurs referensi harian yang dicatat saat gambar dibuat, bukan kurs jual-beli bank.</p>
    </section>
  );
}
