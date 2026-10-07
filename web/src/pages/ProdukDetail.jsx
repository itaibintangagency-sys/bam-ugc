import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import PilihKategori from '../components/PilihKategori.jsx';
import EditorProfil from '../components/EditorProfil.jsx';
import { isAdmin } from '../lib/roles.js';
import { rupiah, usd } from '../lib/generate.js';
import {
  LABEL_ROLE, MAX_FOTO, MAX_FOTO_BYTE, ROLES_BUKAN_PRODUK, alamatFoto, ambilProduk, analisisProduk, bukaKembali, cekFotoProduk, galatProduk, infoRisiko, infoStatusProduk, konfirmasiProduk,
  labelKategori, muatKatalog, peranUntuk, perkecilFoto, profilKosong, risikoKategori, simpanFoto, simpanNama, simpanProfil, ubahKategori, unggahFotoProduk, urutkanDetail, validateProfile
} from '../lib/produk.js';

const dariRow = row => { const p = (row && row.profile) || {}; return { facts: p.facts || [], facts_en: p.facts_en || [], colors: p.colors || [], details: Array.isArray(p.details) ? p.details : [] }; };
const tanya = teks => (typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(teks) : true);

export default function ProdukDetail() {
  const { id } = useParams(); const { client, session, profile } = useAuth(); const lokasi = useLocation();
  const admin = isAdmin(profile); const userId = session && session.user ? session.user.id : null;
  const [p, setP] = useState(undefined); const [katalog, setKatalog] = useState(null); const [profil, setProfil] = useState(profilKosong()); const [urls, setUrls] = useState({});
  const [nama, setNama] = useState(''); const [gantiKat, setGantiKat] = useState(false); const [sibuk, setSibuk] = useState(''); const [galat, setGalat] = useState('');
  const [pesan, setPesan] = useState((lokasi.state && lokasi.state.pesan) || ''); const [info, setInfo] = useState(null);

  const terapkan = useCallback(async row => { setP(row); setProfil(dariRow(row)); setNama(row.name); setUrls(await alamatFoto(client, (row.photos || []).map(f => f.path))); }, [client]);
  useEffect(() => {
    let aktif = true;
    (async () => {
      try { const [row, kat] = await Promise.all([ambilProduk(client, id), muatKatalog(client)]); if (!aktif) return; setKatalog(kat); if (!row) { setP(null); return; } await terapkan(row); }
      catch (e) { if (aktif) { setGalat(galatProduk(e)); setP(null); } }
    })();
    return () => { aktif = false; };
  }, [client, id, terapkan]);

  const foto = useMemo(() => (p && p.photos) || [], [p]); const roles = useMemo(() => foto.map(f => f.role), [foto]);
  const bolehUbah = Boolean(p) && (p.created_by === userId || admin); const terkunci = !p || p.status === 'confirmed' || p.status === 'archived'; const sunting = bolehUbah && !terkunci;
  const kategori = p && katalog ? katalog.kategori.find(k => k.category_key === p.category_key) : null;
  const risiko = infoRisiko(p && p.risk_level) || infoRisiko(risikoKategori(kategori, katalog && katalog.arketipe));
  const adaFotoProduk = foto.some(f => !ROLES_BUKAN_PRODUK.includes(f.role));
  const validasi = useMemo(() => (p && p.archetype_id ? validateProfile(profil, p.archetype_id, roles) : null), [p, profil, roles]);
  const kotor = p ? JSON.stringify(profil) !== JSON.stringify(dariRow(p)) : false;
  const jalan = async (label, fn) => { setGalat(''); setPesan(''); setSibuk(label); try { await fn(); } catch (e) { setGalat(galatProduk(e)); } finally { setSibuk(''); } };

  const tambahFoto = e => {
    const files = Array.from((e.target && e.target.files) || []); if (e.target) e.target.value = ''; if (!files.length) return;
    jalan('Mengunggah foto…', async () => {
      let daftar = [...foto]; const catatan = [];
      for (const f of files) {
        if (daftar.length >= MAX_FOTO) { catatan.push(`Maksimal ${MAX_FOTO} foto; sisanya dilewati.`); break; }
        const m = cekFotoProduk(f); if (m.length) { catatan.push(`${f.name}: ${m[0]}`); continue; }
        const k = await perkecilFoto(f); if (k.file.size > MAX_FOTO_BYTE) { catatan.push(`${f.name}: ukuran lebih dari 6 MB setelah diperkecil.`); continue; }
        const path = await unggahFotoProduk(client, p.id, k.file); const dipakai = new Set(daftar.map(x => x.role));
        const peran = peranUntuk(p.archetype_id).find(r => !dipakai.has(r)) || 'closeup';
        daftar = [...daftar, { path, role: peran }];
      }
      if (daftar.length !== foto.length) { await terapkan(await simpanFoto(client, p.id, daftar)); setPesan('Foto tersimpan. Periksa peran tiap foto.'); }
      if (catatan.length) setGalat(catatan.join(' '));
    });
  };
  const ubahPeran = (i, role) => jalan('Menyimpan…', async () => terapkan(await simpanFoto(client, p.id, foto.map((f, k) => (k === i ? { ...f, role } : f)))));
  const hapusFoto = i => jalan('Menyimpan…', async () => { if (!tanya('Hapus foto ini dari produk?')) return; await terapkan(await simpanFoto(client, p.id, foto.filter((_, k) => k !== i))); });

  const analisis = () => jalan('AI sedang membaca foto… (bisa setengah menit)', async () => {
    if (kotor && !tanya('Isian di editor yang belum disimpan akan diganti hasil AI. Lanjutkan?')) return;
    const r = await analisisProduk(client, p.id);
    if (!r.ok) { setGalat(r.pesan); return; }
    const baru = urutkanDetail(r.hasil.profile, p.archetype_id); setProfil(baru);
    setInfo({ catatan: r.hasil.catatan || [], dibuang: r.hasil.dibuang || [], model: r.model, usd: r.cost_usd, idr: r.cost_idr });
    try { await terapkan(await simpanProfil(client, p.id, baru, 'analyzed')); setPesan('Analisis selesai dan draf tersimpan. Tinjau tiap slot, perbaiki bila perlu, lalu konfirmasi.'); }
    catch (e) { setGalat(`Analisis selesai tetapi draf belum tersimpan (${galatProduk(e)}). Jangan tutup halaman; klik Simpan draf.`); }
  });
  const simpanDraf = () => jalan('Menyimpan…', async () => { await terapkan(await simpanProfil(client, p.id, urutkanDetail(profil, p.archetype_id), profil.details.length ? 'analyzed' : 'draft')); setPesan('Draf tersimpan.'); });
  const konfirmasi = () => jalan('Mengonfirmasi…', async () => { await terapkan(await konfirmasiProduk(client, p.id, userId, urutkanDetail(profil, p.archetype_id))); setPesan('Produk terkonfirmasi dan siap dipakai di batch.'); });
  const buka = () => jalan('Membuka kembali…', async () => { await terapkan(await bukaKembali(client, p.id)); setPesan('Produk dibuka kembali untuk diedit; konfirmasi lagi setelah selesai.'); });
  const pilihKategori = k => jalan('Menyimpan kategori…', async () => {
    const berubah = k.archetype_id !== p.archetype_id;
    if (berubah && profil.details.length && !tanya('Arketipe berbeda: detail slot yang sudah ada akan dikosongkan dan perlu dianalisis ulang. Lanjutkan?')) return;
    await terapkan(await ubahKategori(client, p, k.category_key, k.archetype_id)); setGantiKat(false); setInfo(null); setPesan(berubah ? 'Kategori diganti. Detail slot dikosongkan; jalankan analisis ulang.' : 'Kategori diganti.');
  });

  if (p === undefined) return <p className="status-muted">Memuat produk…</p>;
  if (p === null) return <section><h1>Produk tidak ditemukan</h1>{galat && <div className="notice notice-bad" role="alert">{galat}</div>}<p><Link to="/produk">Kembali ke daftar produk</Link></p></section>;
  const st = infoStatusProduk(p.status);
  return (
    <section aria-labelledby="judul-detail-produk">
      <div className="page-head"><h1 id="judul-detail-produk">{p.name}</h1><Link to="/produk" className="btn btn-secondary">Kembali</Link></div>
      <p><span className={`badge badge-${st.tone}`} data-testid="status-produk">{st.label}</span> {risiko && <span className={`badge badge-${risiko.tone}`} data-testid="risiko-produk">{risiko.label}</span>}</p>
      {pesan && <div className="notice notice-ok" role="status" data-testid="pesan-produk">{pesan}</div>}
      {galat && <div className="notice notice-bad" role="alert" data-testid="galat-produk">{galat}</div>}
      {sibuk && <p className="status-muted" role="status" data-testid="sibuk">{sibuk}</p>}
      {!bolehUbah && <div className="notice notice-warn" role="note">Produk ini milik orang lain. Anda hanya bisa melihatnya.</div>}

      <h2>Kategori</h2>
      <p data-testid="kategori-sekarang">{kategori ? labelKategori(kategori) : 'Belum ada kategori'}{p.archetype_id ? ` (arketipe ${p.archetype_id}${katalog && katalog.arketipe[p.archetype_id] ? `: ${katalog.arketipe[p.archetype_id].nama}` : ''})` : ''}</p>
      {sunting && !gantiKat && <button type="button" className="btn btn-secondary" onClick={() => setGantiKat(true)}>Ganti kategori</button>}
      {sunting && gantiKat && <><PilihKategori katalog={katalog} value={p.category_key || ''} onChange={pilihKategori} id="ganti" /><button type="button" className="btn btn-secondary" onClick={() => setGantiKat(false)}>Batal ganti</button></>}
      {sunting && <div className="field"><label htmlFor="nama-detail">Nama produk</label><input id="nama-detail" value={nama} onChange={e => setNama(e.target.value)} maxLength={120} autoComplete="off" />
        {nama.trim() !== p.name && <button type="button" className="btn btn-secondary" onClick={() => jalan('Menyimpan…', async () => { await terapkan(await simpanNama(client, p.id, nama)); setPesan('Nama tersimpan.'); })}>Simpan nama</button>}</div>}

      <h2>Foto produk ({foto.length} dari {MAX_FOTO})</h2>
      <p className="hint">Foto diperkecil otomatis di browser. Beri peran yang benar pada tiap foto: beberapa slot hanya dipakai bila foto berperan tertentu ada (mis. tekstur).</p>
      <ul className="foto-produk" data-testid="foto-produk">
        {foto.map((f, i) => (
          <li key={f.path}>
            {urls[f.path] ? <img src={urls[f.path]} alt={`Foto produk ${i + 1}`} className="thumb" /> : <div className="thumb kosong" aria-hidden="true">Foto {i + 1}</div>}
            <label htmlFor={`peran-${i}`}>Peran foto {i + 1}</label>
            <select id={`peran-${i}`} value={f.role} onChange={e => ubahPeran(i, e.target.value)} disabled={!sunting || Boolean(sibuk)}>{(p.archetype_id ? peranUntuk(p.archetype_id) : []).concat(peranUntuk(p.archetype_id || 'A-01').includes(f.role) ? [] : [f.role]).map(r => <option key={r} value={r}>{LABEL_ROLE[r] || r}</option>)}</select>
            {sunting && <button type="button" className="btn btn-secondary" onClick={() => hapusFoto(i)} disabled={Boolean(sibuk)}>Hapus</button>}
          </li>
        ))}
      </ul>
      {sunting && foto.length < MAX_FOTO && <div className="field"><label htmlFor="tambah-foto">Tambah foto (bisa lebih dari satu)</label><input id="tambah-foto" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={tambahFoto} disabled={Boolean(sibuk)} /></div>}

      <h2>Detail produk</h2>
      {sunting && (
        <div className="panel-generate">
          <p className="lead">AI membaca foto lalu menyusun fakta, warna, dan detail per slot. Hasilnya draf: Anda yang meninjau dan mengonfirmasi.</p>
          <button type="button" className="btn btn-primary" onClick={analisis} disabled={Boolean(sibuk) || !adaFotoProduk || !p.archetype_id} data-testid="analisis">{profil.details.length ? 'Analisis ulang dengan AI' : 'Analisis dengan AI'}</button>
          {!adaFotoProduk && <p className="hint">Unggah minimal satu foto produk dulu.</p>}
          <p className="hint">Setiap analisis ada biayanya dan ada batas harian per akun. Mengisi manual tetap bisa tanpa AI.</p>
        </div>
      )}
      {info && (
        <div className="notice notice-warn" role="status" data-testid="info-analisis">
          <strong>Hasil analisis{info.model ? ` (${info.model})` : ''}.</strong>
          {info.catatan.length > 0 && <ul>{info.catatan.map((c, i) => <li key={i}>Catatan AI: {c}</li>)}</ul>}
          {info.dibuang.length > 0 && <ul>{info.dibuang.map((c, i) => <li key={i}>Dibuang: {c}</li>)}</ul>}
          {admin && info.idr != null && <p data-testid="biaya-analisis">Biaya analisis: {rupiah(info.idr)} ({usd(info.usd)})</p>}
        </div>
      )}
      {p.archetype_id ? <EditorProfil archetypeId={p.archetype_id} roles={roles} profil={profil} onChange={setProfil} disabled={!sunting} /> : <div className="notice notice-warn">Pilih kategori produk dulu.</div>}

      <div className="aksi">
        {sunting && <button type="button" className="btn btn-secondary" onClick={simpanDraf} disabled={Boolean(sibuk) || !kotor} data-testid="simpan-draf">Simpan draf</button>}
        {sunting && <button type="button" className="btn btn-primary" onClick={konfirmasi} disabled={Boolean(sibuk) || !(validasi && validasi.ready) || !adaFotoProduk || !p.risk_level} data-testid="konfirmasi">Konfirmasi produk</button>}
        {bolehUbah && p.status === 'confirmed' && <button type="button" className="btn btn-secondary" onClick={buka} disabled={Boolean(sibuk)} data-testid="buka-kembali">Buka kembali untuk diedit</button>}
      </div>
      {sunting && validasi && !validasi.ready && <p className="hint">Konfirmasi aktif setelah semua galat di atas diperbaiki dan minimal 3 slot terpakai.</p>}
      {p.status === 'confirmed' && <p className="hint">Produk terkonfirmasi: siap dipilih di batch (layar Batch menyusul).{p.risk_level === 'tinggi' ? ' Karena berisiko tinggi, tiap job membutuhkan persetujuan admin.' : ''}</p>}
    </section>
  );
}
