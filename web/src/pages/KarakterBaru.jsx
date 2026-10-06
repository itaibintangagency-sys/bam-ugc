import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Pilihan from '../components/Pilihan.jsx';
import SalinTombol from '../components/SalinTombol.jsx';
import {
  CONTOH_C02, LABEL, LABEL_SUARA, OPT, OPTIONS, appearanceOf, bacaDimensi, buatKarakter, cekFoto, cekIdentitas, cekProject, cekSuara, cleanDna,
  dnaIssues, dnaKosong, galatAwam, nilaiDimensi, pilihanSuara, suaraAwal, suaraTerpakai, teksPerforma
} from '../lib/karakter.js';

const LANGKAH = ['Identitas', 'DNA', 'Foto wajah', 'Suara dan Flow'];
const NAMA_KOLOM = { gender: 'Jenis kelamin', age_group: 'Kelompok usia', face_shape: 'Bentuk wajah', complexion: 'Warna kulit', expression: 'Ekspresi', hair_length: 'Panjang rambut', hair_texture: 'Tekstur rambut', hair_color: 'Warna rambut', hijab_style: 'Gaya hijab', hijab_color: 'Warna hijab', hijab: 'Hijab', beard: 'Janggut', distinguishing: 'Ciri khas', eyes: 'Mata', build: 'Postur', parting: 'Belahan rambut' };

export default function KarakterBaru() {
  const { client, session } = useAuth(); const navigate = useNavigate();
  const [langkah, setLangkah] = useState(0);
  const [form, setForm] = useState({ code: '', name: '', dna: dnaKosong(), voice: null, voiceUntuk: '', flowProjectUrl: '', flowAccountName: '' });
  const [file, setFile] = useState(null); const [fotoNilai, setFotoNilai] = useState({}); const [preview, setPreview] = useState('');
  const [dipakai, setDipakai] = useState([]); const [dipakaiGalat, setDipakaiGalat] = useState('');
  const [proses, setProses] = useState(''); const [galat, setGalat] = useState('');
  const judul = useRef(null);

  useEffect(() => { suaraTerpakai(client).then(setDipakai).catch(e => setDipakaiGalat(galatAwam(e))); }, [client]);
  useEffect(() => { if (judul.current) judul.current.focus(); }, [langkah]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setDna = (k, v) => setForm(f => ({ ...f, dna: { ...f.dna, [k]: v } }));
  const dnaBersih = useMemo(() => cleanDna(form.dna), [form.dna]);
  const kalimat = useMemo(() => appearanceOf(form.dna), [form.dna]);
  const masalahDna = useMemo(() => dnaIssues(form.dna), [form.dna]);

  // Suara awal dibuat saat DNA berubah (jenis kelamin atau usia), dan menghindari suara yang sudah dipakai karakter lain.
  const kunciSuara = `${dnaBersih.gender || ''}/${dnaBersih.age_group || ''}`;
  useEffect(() => {
    if (langkah !== 3 || !dnaBersih.gender || !dnaBersih.age_group || form.voiceUntuk === kunciSuara) return;
    try { const r = suaraAwal(dnaBersih.gender, dnaBersih.age_group, dipakai); setForm(f => ({ ...f, voice: r.profile, voiceUntuk: kunciSuara, suaraBentrok: r.bentrok })); } catch { /* kombinasi tidak dikenal: pengguna memilih manual */ }
  }, [langkah, kunciSuara, dipakai, dnaBersih.gender, dnaBersih.age_group, form.voiceUntuk]);

  async function pilihFoto(e) {
    const f = e.target.files && e.target.files[0]; setGalat('');
    if (preview) URL.revokeObjectURL(preview);
    setFile(null); setPreview(''); setFotoNilai({});
    if (!f) return;
    const masalah = cekFoto(f); if (masalah.length) { setFotoNilai({ galat: masalah[0] }); return; }
    const n = nilaiDimensi(await bacaDimensi(f)); setFotoNilai(n);
    if (n.galat) return;
    setFile(f); setPreview(URL.createObjectURL(f));
  }

  const masalahLangkah = [
    cekIdentitas(form),
    masalahDna.map(i => `${NAMA_KOLOM[i.field] || i.field}: ${i.msg}`),
    fotoNilai.galat ? [fotoNilai.galat] : (file ? [] : ['Foto wajah belum dipilih.']),
    [...(form.voice ? cekSuara(form.voice) : ['Suara belum dipilih.']), ...(form.voice && dipakai.some(s => String(s).toLowerCase() === String(form.voice.base_voice).toLowerCase()) ? ['Suara ini sudah dipakai karakter lain.'] : []), ...cekProject(form.flowProjectUrl, form.flowAccountName)]
  ];
  const masalah = masalahLangkah[langkah]; const siap = masalah.length === 0;
  const voices = dnaBersih.gender ? pilihanSuara(dnaBersih.gender, dipakai) : [];
  const performa = form.voice ? teksPerforma(form.voice) : '';

  function isiContoh() {
    setForm(f => ({ ...f, code: CONTOH_C02.code, name: CONTOH_C02.name, dna: { ...dnaKosong(), ...CONTOH_C02.dna }, voice: null, voiceUntuk: '' }));
  }
  async function simpan() {
    setGalat('');
    const semua = masalahLangkah.flat(); if (semua.length) { setGalat(semua[0]); return; }
    setProses('Menyimpan data karakter…');
    try {
      const hasil = await buatKarakter(client, session.user.id, { ...form, dna: form.dna }, file, setProses);
      navigate(`/karakter/${hasil.id}`, { replace: true, state: { pesan: hasil.lengkap ? 'Karakter tersimpan lengkap dengan foto wajah.' : null, peringatan: hasil.lengkap ? null : `Karakter tersimpan sebagai draf, tetapi foto belum terunggah: ${hasil.galat} Unggah ulang foto dari halaman ini.` } });
    } catch (e) { setGalat(galatAwam(e)); setProses(''); }
  }

  const d = form.dna; const gender = dnaBersih.gender; const hijab = d.hijab === true;
  return (
    <section aria-labelledby="judul-buat">
      <div className="page-head">
        <h1 id="judul-buat" ref={judul} tabIndex={-1}>Buat karakter</h1>
        <Link to="/karakter" className="btn btn-secondary">Batal</Link>
      </div>
      <ol className="langkah" aria-label="Langkah">
        {LANGKAH.map((n, i) => <li key={n} className={i === langkah ? 'sekarang' : i < langkah ? 'selesai' : ''} aria-current={i === langkah ? 'step' : undefined}><span>{n}</span></li>)}
      </ol>

      <div className="form-karakter">
        {langkah === 0 && (
          <>
            <p className="lead">Kode dipakai di seluruh sistem dan tidak bisa diubah. Nama dipanggil di video perkenalan.</p>
            <div className="field"><label htmlFor="kode">Kode karakter</label><input id="kode" value={form.code} onChange={e => set('code', e.target.value)} placeholder="C02_THE_SOFT_GIRL" autoComplete="off" /></div>
            <div className="field"><label htmlFor="nama">Nama karakter</label><input id="nama" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Nadia" autoComplete="off" /></div>
            <p><button type="button" className="btn btn-secondary" onClick={isiContoh} data-testid="isi-contoh">Isi contoh C02</button> <span className="hint">Mengisi kode, nama, dan DNA contoh C02 untuk mencoba alurnya.</span></p>
          </>
        )}

        {langkah === 1 && (
          <>
            <p className="lead">DNA menentukan kalimat penampilan yang dipakai di JSON video. Karakter harus dewasa (21 tahun ke atas), dan pakaian bukan bagian DNA karena pakaian selalu produknya.</p>
            <Pilihan legend="Jenis kelamin" name="gender" options={OPTIONS.gender} labels={LABEL.gender} value={d.gender} onChange={v => setDna('gender', v)} />
            <Pilihan legend="Kelompok usia" hint="Hanya dewasa." name="age" options={OPTIONS.age_group} labels={LABEL.age_group} value={d.age_group} onChange={v => setDna('age_group', v)} />
            <Pilihan legend="Bentuk wajah" name="face" options={OPTIONS.face_shape} labels={LABEL.face_shape} value={d.face_shape} onChange={v => setDna('face_shape', v)} />
            <Pilihan legend="Warna kulit" name="skin" options={OPTIONS.complexion} labels={LABEL.complexion} value={d.complexion} onChange={v => setDna('complexion', v)} />
            <Pilihan legend="Mata" name="eyes" options={OPTIONS.eyes} labels={LABEL.eyes} value={d.eyes || ''} onChange={v => setDna('eyes', v)} opsional />
            <Pilihan legend="Ekspresi" name="expr" options={OPTIONS.expression} labels={LABEL.expression} value={d.expression} onChange={v => setDna('expression', v)} />
            {gender === 'perempuan' && (
              <fieldset className="pilihan">
                <legend>Hijab</legend>
                <label className="cek"><input type="checkbox" checked={hijab} onChange={e => setDna('hijab', e.target.checked)} /> <span>Karakter berhijab</span></label>
              </fieldset>
            )}
            {hijab ? (
              <>
                <Pilihan legend="Gaya hijab" name="hstyle" options={OPTIONS.hijab_style} labels={LABEL.hijab_style} value={d.hijab_style || ''} onChange={v => setDna('hijab_style', v)} />
                <div className="field"><label htmlFor="hcolor">Warna hijab (bahasa Inggris)</label><input id="hcolor" value={d.hijab_color || ''} onChange={e => setDna('hijab_color', e.target.value)} placeholder="dusty pink" autoComplete="off" /></div>
              </>
            ) : (
              <>
                <Pilihan legend="Panjang rambut" name="hl" options={OPTIONS.hair_length} labels={LABEL.hair_length} value={d.hair_length} onChange={v => setDna('hair_length', v)} />
                <Pilihan legend="Tekstur rambut" name="ht" options={OPTIONS.hair_texture} labels={LABEL.hair_texture} value={d.hair_texture} onChange={v => setDna('hair_texture', v)} />
                <Pilihan legend="Warna rambut" name="hc" options={OPTIONS.hair_color} labels={LABEL.hair_color} value={d.hair_color} onChange={v => setDna('hair_color', v)} />
                <Pilihan legend="Belahan rambut" name="hp" options={OPTIONS.parting} labels={LABEL.parting} value={d.parting || ''} onChange={v => setDna('parting', v)} opsional />
              </>
            )}
            {gender === 'laki-laki' && <Pilihan legend="Janggut" name="beard" options={OPTIONS.beard} labels={LABEL.beard} value={d.beard || ''} onChange={v => setDna('beard', v)} opsional />}
            <Pilihan legend="Postur" name="build" options={OPTIONS.build} labels={LABEL.build} value={d.build || ''} onChange={v => setDna('build', v)} opsional />
            <div className="field"><label htmlFor="khas">Ciri khas (opsional, bahasa Inggris, maksimal 120 karakter)</label><input id="khas" value={d.distinguishing || ''} onChange={e => setDna('distinguishing', e.target.value)} placeholder="a small beauty mark near the left cheek" autoComplete="off" /></div>
            <div className="pratinjau" aria-live="polite" data-testid="kalimat-penampilan">
              <strong>Kalimat penampilan di JSON</strong>
              <p>{kalimat || 'Lengkapi pilihan di atas untuk melihat kalimatnya.'}</p>
            </div>
          </>
        )}

        {langkah === 2 && (
          <>
            <p className="lead">Foto ini menjadi satu-satunya sumber wajah: dilampirkan ke setiap video sebagai bahan kedua.</p>
            <ul className="saran">
              <li>Wajah menghadap depan, jelas, satu orang saja, tanpa kacamata gelap atau filter.</li>
              <li>Tanpa tulisan, logo, atau tanda air di foto.</li>
              <li>Karakter harus dewasa. Foto orang nyata hanya bila izinnya sudah Anda urus.</li>
              <li>Format PNG, JPG, atau WEBP, maksimal 6 MB, sisi terpendek minimal 512 piksel (disarankan 1024).</li>
            </ul>
            <div className="field"><label htmlFor="foto">Foto wajah</label><input id="foto" type="file" accept="image/png,image/jpeg,image/webp" onChange={pilihFoto} /></div>
            {fotoNilai.galat && <div className="notice notice-bad" role="alert" data-testid="galat-foto">{fotoNilai.galat}</div>}
            {fotoNilai.peringatan && <div className="notice notice-warn" role="status">{fotoNilai.peringatan}</div>}
            {preview && <img className="pratinjau-foto" src={preview} alt="Pratinjau foto wajah yang dipilih" data-testid="pratinjau-foto" />}
          </>
        )}

        {langkah === 3 && (
          <>
            <p className="lead">Suara dipilih sekali dan dipasang di Flow. Satu karakter satu suara.</p>
            {dipakaiGalat && <div className="notice notice-warn" role="status">Daftar suara terpakai tidak bisa dimuat ({dipakaiGalat}) Sistem tetap menolak suara kembar saat menyimpan.</div>}
            {form.suaraBentrok && <div className="notice notice-warn" role="status">Semua suara yang cocok sudah dipakai karakter lain. Pilih manual.</div>}
            {form.voice ? (
              <>
                <div className="field">
                  <label htmlFor="suara">Suara dasar</label>
                  <select id="suara" value={form.voice.base_voice} onChange={e => set('voice', { ...form.voice, base_voice: e.target.value })}>
                    {voices.map(v => <option key={v.name} value={v.name} disabled={v.dipakai && v.name !== form.voice.base_voice}>{v.name}, {v.desc}{v.dipakai ? ' (dipakai karakter lain)' : ''}</option>)}
                  </select>
                </div>
                <details className="rinci"><summary>Atur detail suara</summary>
                  {['nada', 'energi', 'tempo', 'gaya', 'aksen', 'bahasa'].map(k => (
                    <div className="field" key={k}><label htmlFor={`v-${k}`}>{k[0].toUpperCase() + k.slice(1)}</label>
                      <select id={`v-${k}`} value={form.voice[k]} onChange={e => set('voice', { ...form.voice, [k]: e.target.value })}>
                        {Object.keys(OPT[k]).map(o => <option key={o} value={o}>{LABEL_SUARA[k][o] || o}</option>)}
                      </select></div>
                  ))}
                </details>
                <div className="pratinjau"><strong>Teks untuk kolom "Sesuaikan performa" di Flow</strong><p data-testid="teks-performa">{performa || '-'}</p><SalinTombol teks={performa} label="Salin teks suara" /></div>
              </>
            ) : <p className="status-muted">Menyiapkan pilihan suara…</p>}
            <div className="field"><label htmlFor="proj">Alamat project Flow</label><input id="proj" value={form.flowProjectUrl} onChange={e => set('flowProjectUrl', e.target.value)} placeholder="https://flow.google.com/project/…" autoComplete="off" /></div>
            <div className="field"><label htmlFor="akun">Nama akun Google Flow</label><input id="akun" value={form.flowAccountName} onChange={e => set('flowAccountName', e.target.value)} placeholder="Seperti tampil di pojok kanan atas Flow" autoComplete="off" /></div>
          </>
        )}

        {masalah.length > 0 && <div className="notice notice-warn" role="status" data-testid="masalah-langkah"><strong>Yang masih kurang:</strong><ul>{masalah.map(m => <li key={m}>{m}</li>)}</ul></div>}
        {galat && <div className="notice notice-bad" role="alert" data-testid="galat-simpan">{galat}</div>}
        {proses && <p className="status-muted" role="status" data-testid="proses">{proses}</p>}

        <div className="aksi">
          {langkah > 0 && <button type="button" className="btn btn-secondary" onClick={() => setLangkah(l => l - 1)} disabled={Boolean(proses)}>Kembali</button>}
          {langkah < LANGKAH.length - 1
            ? <button type="button" className="btn btn-primary" onClick={() => setLangkah(l => l + 1)} disabled={!siap} data-testid="lanjut">Lanjut</button>
            : <button type="button" className="btn btn-primary" onClick={simpan} disabled={!siap || Boolean(proses)} data-testid="simpan">Simpan karakter</button>}
        </div>
      </div>
    </section>
  );
}
