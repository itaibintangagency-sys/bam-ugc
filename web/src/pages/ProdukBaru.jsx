import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import PilihKategori from '../components/PilihKategori.jsx';
import { buatProduk, cekNama, galatProduk, muatKatalog } from '../lib/produk.js';

export default function ProdukBaru() {
  const { client, session } = useAuth(); const navigate = useNavigate(); const judul = useRef(null);
  const [katalog, setKatalog] = useState(null); const [nama, setNama] = useState(''); const [kat, setKat] = useState(null); const [galat, setGalat] = useState(''); const [proses, setProses] = useState(false);
  useEffect(() => { if (judul.current) judul.current.focus(); muatKatalog(client).then(setKatalog).catch(e => { setGalat(galatProduk(e)); setKatalog({ kategori: [], arketipe: {} }); }); }, [client]);
  const masalah = [...cekNama(nama), ...(kat ? [] : ['Kategori produk belum dipilih.'])];
  async function simpan() {
    setGalat(''); if (masalah.length) { setGalat(masalah[0]); return; } setProses(true);
    try { const p = await buatProduk(client, session.user.id, { nama, kategoriKey: kat.category_key }); navigate(`/produk/${p.id}`, { replace: true, state: { pesan: 'Draf produk tersimpan. Unggah foto, lalu jalankan analisis AI.' } }); }
    catch (e) { setGalat(galatProduk(e)); setProses(false); }
  }
  return (
    <section aria-labelledby="judul-produk-baru">
      <div className="page-head"><h1 id="judul-produk-baru" ref={judul} tabIndex={-1}>Produk baru</h1><Link to="/produk" className="btn btn-secondary">Batal</Link></div>
      <div className="form-karakter">
        <p className="lead">Mulai dari nama dan kategori. Kategori menentukan slot detail yang akan dianalisis AI dan tingkat risikonya. Foto diunggah di langkah berikutnya.</p>
        <div className="field"><label htmlFor="nama-produk">Nama produk</label><input id="nama-produk" value={nama} onChange={e => setNama(e.target.value)} placeholder="mis. Daster floral abu pastel" autoComplete="off" maxLength={120} /></div>
        <PilihKategori katalog={katalog} value={kat ? kat.category_key : ''} onChange={setKat} />
        {masalah.length > 0 && (nama || kat) && <div className="notice notice-warn" role="status" data-testid="masalah-produk"><strong>Yang masih kurang:</strong><ul>{masalah.map(m => <li key={m}>{m}</li>)}</ul></div>}
        {galat && <div className="notice notice-bad" role="alert" data-testid="galat-simpan">{galat}</div>}
        <div className="aksi"><button type="button" className="btn btn-primary" onClick={simpan} disabled={proses || masalah.length > 0} data-testid="simpan-produk">{proses ? 'Menyimpan…' : 'Simpan dan lanjut ke foto'}</button></div>
      </div>
    </section>
  );
}
