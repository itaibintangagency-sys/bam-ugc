import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import FaceImage from '../components/FaceImage.jsx';
import { daftarKarakter, galatAwam, infoStatus, labelOf } from '../lib/karakter.js';

export default function Karakter() {
  const { client } = useAuth();
  const [baris, setBaris] = useState(null); const [galat, setGalat] = useState('');
  const muat = useCallback(async () => {
    setGalat('');
    try { setBaris(await daftarKarakter(client)); } catch (e) { setGalat(galatAwam(e)); setBaris(b => b || []); }
  }, [client]);
  useEffect(() => { muat(); }, [muat]);

  return (
    <section aria-labelledby="judul-karakter">
      <div className="page-head">
        <h1 id="judul-karakter">Karakter</h1>
        <Link to="/karakter/baru" className="btn btn-primary">Buat karakter</Link>
      </div>
      <p className="lead">Karakter yang dipakai sebagai wajah dan suara video. Satu karakter punya satu foto wajah, satu suara, dan satu project Flow.</p>
      {galat && <div className="notice notice-bad" role="alert" data-testid="galat-daftar">{galat} <button type="button" className="link" onClick={muat}>Coba lagi</button></div>}
      {baris === null && <p className="status-muted" role="status">Memuat karakter…</p>}
      {baris && baris.length === 0 && !galat && (
        <div className="kosong" data-testid="daftar-kosong">
          <p><strong>Belum ada karakter.</strong></p>
          <p>Mulai dengan menekan <em>Buat karakter</em>. Siapkan satu foto wajah (dewasa), alamat project Flow, dan nama akun Google Flow.</p>
        </div>
      )}
      {baris && baris.length > 0 && (
        <ul className="kartu-daftar">
          {baris.map(c => {
            const st = infoStatus(c.status);
            return (
              <li key={c.id} className="kartu-karakter" data-testid="kartu-karakter">
                <FaceImage client={client} path={c.face_ref_path} alt={`Foto wajah ${c.name}`} />
                <div className="kartu-isi">
                  <h2><Link to={`/karakter/${c.id}`}>{c.name}</Link></h2>
                  <p className="kode">{c.code}</p>
                  <p><span className={`badge badge-${st.tone}`}>{st.label}</span></p>
                  <p className="kecil">{labelOf('gender', c.gender)}{c.voice_base ? `, suara ${c.voice_base}` : ''}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
