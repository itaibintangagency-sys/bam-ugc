import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { RISIKO, STATUS_PRODUK, alamatFoto, daftarProduk, galatProduk, infoRisiko, infoStatusProduk, labelKategori, muatKatalog, ROLES_BUKAN_PRODUK } from '../lib/produk.js';

export default function Produk() {
  const { client, session } = useAuth(); const userId = session && session.user ? session.user.id : null;
  const [daftar, setDaftar] = useState(null); const [katalog, setKatalog] = useState(null); const [urls, setUrls] = useState({}); const [galat, setGalat] = useState('');
  const [cari, setCari] = useState(''); const [status, setStatus] = useState(''); const [risiko, setRisiko] = useState(''); const [milik, setMilik] = useState(false);

  useEffect(() => {
    let aktif = true;
    (async () => {
      try {
        const [d, k] = await Promise.all([daftarProduk(client), muatKatalog(client).catch(() => null)]);
        if (!aktif) return; setDaftar(d); setKatalog(k);
        const paths = d.map(p => ((p.photos || []).find(f => !ROLES_BUKAN_PRODUK.includes(f.role)) || {}).path).filter(Boolean);
        const u = await alamatFoto(client, paths); if (aktif) setUrls(u);
      } catch (e) { if (aktif) { setGalat(galatProduk(e)); setDaftar([]); } }
    })();
    return () => { aktif = false; };
  }, [client]);

  const tampil = useMemo(() => (daftar || []).filter(p => {
    if (cari.trim() && !p.name.toLowerCase().includes(cari.trim().toLowerCase())) return false;
    if (status && p.status !== status) return false; if (risiko && p.risk_level !== risiko) return false; if (milik && p.created_by !== userId) return false; return true;
  }), [daftar, cari, status, risiko, milik, userId]);
  const katKey = k => (katalog ? labelKategori(katalog.kategori.find(x => x.category_key === k)) : '');

  return (
    <section aria-labelledby="judul-produk">
      <div className="page-head"><h1 id="judul-produk">Produk</h1><Link to="/produk/baru" className="btn btn-primary" data-testid="produk-baru">Produk baru</Link></div>
      <p className="lead">Daftarkan produk, pilih kategorinya, unggah foto, lalu biarkan AI menyusun detailnya untuk Anda tinjau.</p>
      {galat && <div className="notice notice-bad" role="alert" data-testid="galat-produk">{galat}</div>}
      <div className="filter-riwayat">
        <div className="field"><label htmlFor="cari-produk">Cari nama</label><input id="cari-produk" type="search" value={cari} onChange={e => setCari(e.target.value)} autoComplete="off" /></div>
        <div className="field"><label htmlFor="f-status">Status</label><select id="f-status" value={status} onChange={e => setStatus(e.target.value)}><option value="">Semua</option>{Object.entries(STATUS_PRODUK).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        <div className="field"><label htmlFor="f-risiko">Risiko</label><select id="f-risiko" value={risiko} onChange={e => setRisiko(e.target.value)}><option value="">Semua</option>{Object.keys(RISIKO).map(k => <option key={k} value={k}>{k}</option>)}</select></div>
        <label className="cek"><input type="checkbox" checked={milik} onChange={e => setMilik(e.target.checked)} /> <span>Hanya milik saya</span></label>
      </div>
      {daftar === null && <p className="status-muted">Memuat produk…</p>}
      {daftar && tampil.length === 0 && <p className="status-muted" data-testid="produk-kosong">{daftar.length === 0 ? 'Belum ada produk.' : 'Tidak ada produk yang cocok dengan filter.'}</p>}
      <ul className="grid-produk" data-testid="daftar-produk">
        {tampil.map(p => {
          const st = infoStatusProduk(p.status); const rs = infoRisiko(p.risk_level); const foto = (p.photos || []).find(f => !ROLES_BUKAN_PRODUK.includes(f.role)); const u = foto && urls[foto.path];
          return (
            <li key={p.id} className="kartu-produk">
              <Link to={`/produk/${p.id}`} className="tautan-kartu">
                {u ? <img src={u} alt={`Foto ${p.name}`} className="thumb" /> : <div className="thumb kosong" aria-hidden="true">Tanpa foto</div>}
                <strong>{p.name}</strong>
              </Link>
              <p className="hint">{katKey(p.category_key) || 'Tanpa kategori'}</p>
              <p><span className={`badge badge-${st.tone}`}>{st.label}</span> {rs && p.risk_level !== 'rendah' && <span className={`badge badge-${rs.tone}`}>{p.risk_level === 'tinggi' ? 'Risiko tinggi' : 'Risiko sedang'}</span>} {p.created_by === userId && <span className="hint">milik Anda</span>}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
