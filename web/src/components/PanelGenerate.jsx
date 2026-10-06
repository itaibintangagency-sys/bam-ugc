import { useEffect, useMemo, useRef, useState } from 'react';
import {
  JENIS, MAKS_PER_KLIK, buatGambar, gambarKeFile, hubunganUntuk, kualitasUntuk, peringatanKonflik, rupiah, unggahAcuan, usd
} from '../lib/generate.js';
import { bacaDimensi, cekFoto, galatAwam, muatFoto, nilaiDimensi } from '../lib/karakter.js';

// Panel "Buat dengan AI" di langkah Foto wajah. mode = 'dna' atau 'acuan'. `dna` = DNA langkah 2 (sudah dibersihkan),
// `dnaValid` = DNA sudah lolos validasi. onPilih(file, asal) dipanggil saat satu gambar dipilih jadi wajah karakter.
// Biaya (USD dan Rupiah) hanya tampil untuk admin; fungsi di server pun hanya mengirimkannya ke admin.
export default function PanelGenerate({ client, userId, admin, mode, dna, dnaValid, onPilih, pilihanRunId }) {
  const kind = mode === 'acuan' ? 'wajah_acuan' : 'wajah_dna';
  const [jumlah, setJumlah] = useState(2); const [kualitas, setKualitas] = useState('low');
  const [hubungan, setHubungan] = useState(''); const [catatan, setCatatan] = useState(''); const [izin, setIzin] = useState(false);
  const [acuan, setAcuan] = useState(null); const [acuanGalat, setAcuanGalat] = useState(''); const [acuanPratinjau, setAcuanPratinjau] = useState('');
  const [slot, setSlot] = useState([]); const [berjalan, setBerjalan] = useState(false); const [galat, setGalat] = useState(''); const [memilih, setMemilih] = useState('');
  const urls = useRef([]);

  const pilihanHubungan = useMemo(() => hubunganUntuk(dna && dna.gender), [dna]);
  useEffect(() => { if (mode === 'acuan' && !pilihanHubungan.some(h => h.kunci === hubungan)) setHubungan((pilihanHubungan.find(h => h.kunci === 'kakak') || pilihanHubungan[0] || {}).kunci || ''); }, [mode, pilihanHubungan, hubungan]);
  useEffect(() => () => { urls.current.forEach(u => URL.revokeObjectURL(u)); if (acuanPratinjau) URL.revokeObjectURL(acuanPratinjau); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const konflik = mode === 'acuan' && dna ? peringatanKonflik(catatan, dna) : '';
  const siap = dnaValid && !berjalan && (mode !== 'acuan' || (acuan && !acuanGalat && izin && hubungan));

  async function pilihAcuan(e) {
    const f = e.target.files && e.target.files[0]; setGalat(''); setAcuanGalat('');
    if (acuanPratinjau) URL.revokeObjectURL(acuanPratinjau);
    setAcuan(null); setAcuanPratinjau('');
    if (!f) return;
    const masalah = cekFoto(f); if (masalah.length) { setAcuanGalat(masalah[0]); return; }
    const n = nilaiDimensi(await bacaDimensi(f)); if (n.galat) { setAcuanGalat(n.galat); return; }
    setAcuan(f); setAcuanPratinjau(URL.createObjectURL(f));
  }

  async function mulai() {
    setGalat(''); setMemilih(''); urls.current.forEach(u => URL.revokeObjectURL(u)); urls.current = [];
    setSlot(Array.from({ length: jumlah }, () => ({ status: 'menunggu' }))); setBerjalan(true);
    try {
      let refPath;
      if (mode === 'acuan') refPath = await unggahAcuan(client, userId, acuan);
      await buatGambar(client, { kind, dna, quality: kualitas, jumlah, relation: hubungan, note: catatan, refPath }, async (i, h) => {
        if (!h.ok) { setSlot(s => s.map((x, k) => (k === i ? { status: 'gagal', pesan: h.pesan } : x))); return; }
        let url = '';
        try { url = URL.createObjectURL(await muatFoto(client, h.image_path)); urls.current.push(url); } catch (e) { url = ''; }
        setSlot(s => s.map((x, k) => (k === i ? { status: url ? 'jadi' : 'gagal', url, pesan: url ? '' : 'Gambar jadi tetapi tidak bisa ditampilkan. Coba muat ulang halaman.', ...h } : x)));
      });
    } catch (e) { setGalat(galatAwam(e)); setSlot([]); }
    finally { setBerjalan(false); }
  }

  async function pakai(s) {
    setMemilih(s.run_id); setGalat('');
    try { const file = await gambarKeFile(client, s.image_path, `wajah-ai-${s.seq}`); onPilih(file, { runId: s.run_id, mode, kind }); }
    catch (e) { setGalat(galatAwam(e)); }
    finally { setMemilih(''); }
  }

  const totalIdr = slot.reduce((a, s) => a + (Number(s.cost_idr) || 0), 0); const totalUsd = slot.reduce((a, s) => a + (Number(s.cost_usd) || 0), 0);
  const adaBiaya = admin && slot.some(s => s.status === 'jadi');

  return (
    <div className="panel-generate" data-testid={`panel-${mode}`}>
      <p className="lead">{mode === 'acuan'
        ? 'AI membuat wajah baru yang mirip orang di foto acuan, sesuai DNA di langkah 2. Hasil kemiripan masih eksperimen: periksa tiap gambar sebelum dipakai.'
        : 'AI membuat wajah dari DNA di langkah 2. Buat beberapa kandidat lalu pilih satu.'}</p>
      {!dnaValid && <div className="notice notice-warn" role="status">DNA di langkah 2 belum lengkap. Kembali ke langkah DNA lalu lengkapi dulu.</div>}

      {mode === 'acuan' && (
        <>
          <div className="notice notice-warn" role="note">
            <strong>Eksperimen.</strong> Foto acuan dikirim ke OpenRouter dan penyedia modelnya, dan disimpan di penyimpanan privat. Pakai hanya foto orang dewasa yang izinnya sudah Anda urus. Foto orang nyata dapat ditolak oleh penyaring isi model.
          </div>
          <div className="field"><label htmlFor="acuan-foto">Foto acuan</label><input id="acuan-foto" type="file" accept="image/png,image/jpeg,image/webp" onChange={pilihAcuan} disabled={berjalan} /></div>
          {acuanGalat && <div className="notice notice-bad" role="alert" data-testid="galat-acuan">{acuanGalat}</div>}
          {acuanPratinjau && <img className="pratinjau-foto" src={acuanPratinjau} alt="Pratinjau foto acuan" />}
          <div className="field">
            <label htmlFor="acuan-hub">Hubungan orang yang dibuat dengan orang di foto</label>
            <select id="acuan-hub" value={hubungan} onChange={e => setHubungan(e.target.value)} disabled={berjalan}>
              {pilihanHubungan.map(h => <option key={h.kunci} value={h.kunci}>{h.label}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="acuan-catatan">Catatan (opsional)</label><input id="acuan-catatan" value={catatan} onChange={e => setCatatan(e.target.value)} placeholder="mis. kakak laki-laki" autoComplete="off" disabled={berjalan} maxLength={200} /></div>
          {konflik && <div className="notice notice-warn" role="status" data-testid="konflik">Perhatian: {konflik}</div>}
          <label className="cek"><input type="checkbox" checked={izin} onChange={e => setIzin(e.target.checked)} disabled={berjalan} /> <span>Orang di foto itu dewasa dan izin memakai fotonya sudah saya urus.</span></label>
        </>
      )}

      <div className="baris-pilihan">
        <div className="field"><label htmlFor="gen-jumlah">Jumlah gambar</label>
          <select id="gen-jumlah" value={jumlah} onChange={e => setJumlah(Number(e.target.value))} disabled={berjalan}>
            {Array.from({ length: MAKS_PER_KLIK }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
          </select></div>
        <div className="field"><label htmlFor="gen-kualitas">Kualitas</label>
          <select id="gen-kualitas" value={kualitas} onChange={e => setKualitas(e.target.value)} disabled={berjalan}>
            {kualitasUntuk(admin).map(k => <option key={k.kunci} value={k.kunci}>{k.label}</option>)}
          </select></div>
      </div>
      <p className="hint">Maksimal {MAKS_PER_KLIK} gambar per klik{admin ? '' : ', dan ada batas harian per akun'}. Satu gambar bisa memakan setengah menit atau lebih. Jangan menutup halaman ini selagi menunggu.</p>
      <p><button type="button" className="btn btn-primary" onClick={mulai} disabled={!siap} data-testid="buat-gambar">{berjalan ? 'Membuat gambar…' : `Buat ${jumlah} gambar`}</button></p>
      {galat && <div className="notice notice-bad" role="alert" data-testid="galat-generate">{galat}</div>}

      {slot.length > 0 && (
        <>
          <h3 className="sub">Hasil ({JENIS[kind]})</h3>
          <ul className="galeri" data-testid="galeri">
            {slot.map((s, i) => (
              <li key={i} className={`kartu-gambar ${pilihanRunId && s.run_id === pilihanRunId ? 'terpilih' : ''}`} data-status={s.status}>
                {s.status === 'menunggu' && <div className="menunggu" role="status">Membuat gambar {i + 1}…</div>}
                {s.status === 'gagal' && <div className="notice notice-bad" role="alert">Gambar {i + 1} gagal. {s.pesan}</div>}
                {s.status === 'jadi' && (
                  <>
                    <img src={s.url} alt={`Hasil gambar ${i + 1}`} />
                    {admin && <p className="biaya" data-testid="biaya-gambar">{rupiah(s.cost_idr)} <span className="hint">({usd(s.cost_usd)}{s.kurs ? `, kurs ${Math.round(s.kurs).toLocaleString('id-ID')}` : ''})</span></p>}
                    <button type="button" className="btn btn-secondary" onClick={() => pakai(s)} disabled={Boolean(memilih)} aria-pressed={Boolean(pilihanRunId && s.run_id === pilihanRunId)}>
                      {pilihanRunId && s.run_id === pilihanRunId ? 'Terpilih' : memilih === s.run_id ? 'Mengambil…' : 'Pakai gambar ini'}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {adaBiaya && !berjalan && <p className="hint" data-testid="biaya-total">Biaya klik ini: {rupiah(totalIdr)} ({usd(totalUsd)}). Gambar yang gagal tidak ditagih.</p>}
        </>
      )}
    </div>
  );
}
