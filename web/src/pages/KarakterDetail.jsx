import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { isAdmin } from '../lib/roles.js';
import FaceImage from '../components/FaceImage.jsx';
import SalinTombol from '../components/SalinTombol.jsx';
import {
  LABEL, ambilKarakter, bacaDimensi, cekFoto, cekProject, galatAwam, infoStatus, labelOf, langkahBerikut, lengkap, nilaiDimensi, pasangFoto, syaratSiap,
  tandaiSiap, teksPerforma, ubahProject
} from '../lib/karakter.js';

const RINCI = [['gender', 'Jenis kelamin'], ['age_group', 'Kelompok usia'], ['face_shape', 'Bentuk wajah'], ['complexion', 'Warna kulit'], ['eyes', 'Mata'], ['expression', 'Ekspresi'], ['hair_length', 'Panjang rambut'], ['hair_texture', 'Tekstur rambut'], ['hair_color', 'Warna rambut'], ['parting', 'Belahan'], ['beard', 'Janggut'], ['hijab_style', 'Gaya hijab'], ['build', 'Postur']];

export default function KarakterDetail() {
  const { id } = useParams(); const { client, session, profile } = useAuth(); const lokasi = useLocation();
  const admin = isAdmin(profile); const [c, setC] = useState(undefined); const [galat, setGalat] = useState('');
  const [pesan, setPesan] = useState((lokasi.state && lokasi.state.pesan) || ''); const [peringatan, setPeringatan] = useState((lokasi.state && lokasi.state.peringatan) || '');
  const [alasan, setAlasan] = useState(''); const [sibuk, setSibuk] = useState(''); const [url, setUrl] = useState(''); const [akun, setAkun] = useState(''); const [fotoGalat, setFotoGalat] = useState('');

  const muat = useCallback(async () => {
    try { const r = await ambilKarakter(client, id); setC(r); if (r) { setUrl(r.flow_project_url || ''); setAkun(r.flow_account_name || ''); } setGalat(''); }
    catch (e) { setGalat(galatAwam(e)); setC(null); }
  }, [client, id]);
  useEffect(() => { muat(); }, [muat]);

  if (c === undefined) return <p className="status-muted" role="status">Memuat karakter…</p>;
  if (!c) return <section><h1>Karakter tidak ditemukan</h1>{galat && <div className="notice notice-bad" role="alert">{galat}</div>}<p><Link to="/karakter" className="btn btn-secondary">Kembali ke daftar</Link></p></section>;

  const pemilik = c.created_by === session.user.id; const bolehUbah = pemilik || admin; const st = infoStatus(c.status);
  const dna = c.dna || {}; const syarat = syaratSiap(c); const performa = c.voice ? teksPerforma(c.voice) : '';

  async function jalankan(nama, fn, ok) {
    setGalat(''); setPesan(''); setSibuk(nama);
    try { await fn(); setPesan(ok); await muat(); } catch (e) { setGalat(galatAwam(e)); } finally { setSibuk(''); }
  }
  async function unggahFoto(e) {
    const f = e.target.files && e.target.files[0]; setFotoGalat(''); if (!f) return;
    const m = cekFoto(f); if (m.length) { setFotoGalat(m[0]); e.target.value = ''; return; }
    const n = nilaiDimensi(await bacaDimensi(f)); if (n.galat) { setFotoGalat(n.galat); e.target.value = ''; return; }
    await jalankan('foto', () => pasangFoto(client, session.user.id, c, f), 'Foto wajah terunggah.');
    e.target.value = '';
  }

  return (
    <section aria-labelledby="judul-rinci">
      <div className="page-head"><h1 id="judul-rinci">{c.name}</h1><Link to="/karakter" className="btn btn-secondary">Semua karakter</Link></div>
      {pesan && <div className="notice notice-ok" role="status" data-testid="pesan">{pesan}</div>}
      {peringatan && <div className="notice notice-warn" role="alert" data-testid="peringatan">{peringatan}</div>}
      {galat && <div className="notice notice-bad" role="alert" data-testid="galat">{galat}</div>}

      <div className="rinci-grid">
        <div>
          <FaceImage client={client} path={c.face_ref_path} alt={`Foto wajah ${c.name}`} className="foto-besar" />
          {bolehUbah && c.status !== 'ready' && (
            <div className="field"><label htmlFor="ganti-foto">{c.face_ref_path ? 'Ganti foto wajah' : 'Unggah foto wajah'}</label><input id="ganti-foto" type="file" accept="image/png,image/jpeg,image/webp" onChange={unggahFoto} disabled={Boolean(sibuk)} />
              {fotoGalat && <div className="notice notice-bad" role="alert" data-testid="galat-foto">{fotoGalat}</div>}</div>
          )}
        </div>
        <div>
          <p><span className={`badge badge-${st.tone}`} data-testid="status">{st.label}</span></p>
          <p className="kode">{c.code}</p>
          <p className="lead" data-testid="langkah-berikut">{langkahBerikut(c, admin)}</p>
          <h2>Syarat siap dipakai</h2>
          <ul className="daftar-syarat" data-testid="syarat">
            {syarat.map(s => <li key={s.kunci} className={s.ok ? 'ok' : 'belum'}><span aria-hidden="true">{s.ok ? '✓' : '○'}</span> {s.label}<span className="sr-only">{s.ok ? ' (sudah)' : ' (belum)'}</span></li>)}
            <li className={c.status === 'ready' ? 'ok' : 'belum'}><span aria-hidden="true">{c.status === 'ready' ? '✓' : '○'}</span> Ditandai siap oleh admin<span className="sr-only">{c.status === 'ready' ? ' (sudah)' : ' (belum)'}</span></li>
          </ul>
        </div>
      </div>

      <h2>DNA</h2>
      <p className="kalimat" data-testid="kalimat">{dna.appearance_en || '-'}</p>
      <dl className="kv">
        {RINCI.filter(([k]) => dna[k]).map(([k, l]) => <div key={k}><dt>{l}</dt><dd>{LABEL[k] ? labelOf(k, dna[k]) : String(dna[k])}</dd></div>)}
        {dna.hijab_color && <div><dt>Warna hijab</dt><dd>{dna.hijab_color}</dd></div>}
        {dna.distinguishing && <div><dt>Ciri khas</dt><dd>{dna.distinguishing}</dd></div>}
      </dl>

      <h2>Suara</h2>
      <p>Suara dasar: <strong data-testid="suara">{c.voice_base || '-'}</strong></p>
      {performa && <div className="pratinjau"><strong>Teks untuk kolom "Sesuaikan performa" di Flow</strong><p>{performa}</p><SalinTombol teks={performa} label="Salin teks suara" /></div>}

      <h2>Project Flow</h2>
      {bolehUbah ? (
        <form className="form-karakter" onSubmit={e => { e.preventDefault(); jalankan('project', () => ubahProject(client, c.id, { url, akun }), 'Project dan akun diperbarui.'); }}>
          <div className="field"><label htmlFor="e-proj">Alamat project Flow</label><input id="e-proj" value={url} onChange={e => setUrl(e.target.value)} autoComplete="off" /></div>
          <div className="field"><label htmlFor="e-akun">Nama akun Google Flow</label><input id="e-akun" value={akun} onChange={e => setAkun(e.target.value)} autoComplete="off" /></div>
          {cekProject(url, akun).length > 0 && <p className="hint" data-testid="masalah-project">{cekProject(url, akun)[0]}</p>}
          <p className="hint">Setelah berganti akun atau project, job yang sudah antre masih membawa alamat lama dan akan ditolak agent. Buat ulang job itu.</p>
          <button type="submit" className="btn btn-secondary" disabled={Boolean(sibuk) || cekProject(url, akun).length > 0 || (url === (c.flow_project_url || '') && akun === (c.flow_account_name || ''))}>Simpan perubahan</button>
        </form>
      ) : <dl className="kv"><div><dt>Alamat</dt><dd className="pecah">{c.flow_project_url || '-'}</dd></div><div><dt>Akun</dt><dd>{c.flow_account_name || '-'}</dd></div></dl>}

      {c.status === 'ready' ? (
        <div className="notice notice-ok" data-testid="sudah-siap"><strong>Sudah ditandai siap.</strong>{c.ready_override_reason ? <> Alasan: <span data-testid="alasan-tersimpan">{c.ready_override_reason}</span></> : null}</div>
      ) : admin ? (
        <form className="panel-admin" onSubmit={e => { e.preventDefault(); jalankan('siap', () => tandaiSiap(client, c.id, alasan), 'Karakter ditandai siap.'); }}>
          <h2>Tandai siap (admin)</h2>
          <p className="hint">Alasan ditulis sendiri oleh admin dan tersimpan di database. Contoh: "Wajah dan suara sudah diverifikasi di Flow asli."</p>
          <div className="field"><label htmlFor="alasan">Alasan menandai siap (minimal 10 karakter)</label><textarea id="alasan" rows={3} value={alasan} onChange={e => setAlasan(e.target.value)} /></div>
          {!lengkap(c) && <p className="hint" data-testid="belum-lengkap">Belum bisa ditandai siap: lengkapi syarat yang masih kosong di atas.</p>}
          <button type="submit" className="btn btn-primary" disabled={Boolean(sibuk) || !lengkap(c) || alasan.trim().length < 10} data-testid="tandai-siap">Tandai siap</button>
        </form>
      ) : <p className="hint" data-testid="menunggu-admin">Hanya admin yang bisa menandai karakter siap.</p>}
    </section>
  );
}
