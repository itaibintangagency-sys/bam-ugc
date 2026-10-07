import { useMemo, useState } from 'react';
import { cariKategori, infoRisiko, labelKategori, risikoKategori, syaratKarakter } from '../lib/produk.js';

// Pemilih kategori: cari di 226 kategori (L1 > L2 > L3). Arketipe dan risiko tampil otomatis; keputusan resminya tetap dari database.
export default function PilihKategori({ katalog, value, onChange, disabled = false, id = 'kategori' }) {
  const [kueri, setKueri] = useState('');
  const terpilih = useMemo(() => (katalog && value ? katalog.kategori.find(k => k.category_key === value) || null : null), [katalog, value]);
  const hasil = useMemo(() => (katalog ? cariKategori(katalog.kategori, kueri) : []), [katalog, kueri]);
  if (!katalog) return <p className="status-muted">Memuat daftar kategori…</p>;
  const ar = terpilih ? katalog.arketipe[terpilih.archetype_id] : null; const risiko = infoRisiko(risikoKategori(terpilih, katalog.arketipe)); const syarat = syaratKarakter(terpilih);
  return (
    <div className="pilih-kategori">
      <div className="field">
        <label htmlFor={`${id}-cari`}>Cari kategori</label>
        <input id={`${id}-cari`} type="search" value={kueri} onChange={e => setKueri(e.target.value)} placeholder="mis. daster, serum, sepatu, kopi" autoComplete="off" disabled={disabled} />
        <p className="hint">Ketik sebagian nama kategori. Kategori menentukan arketipe, slot detail yang dianalisis, dan tingkat risiko.</p>
      </div>
      {kueri.trim() && (
        <ul className="hasil-kategori" role="listbox" aria-label="Hasil pencarian kategori" data-testid="hasil-kategori">
          {hasil.length === 0 && <li className="status-muted">Tidak ada kategori yang cocok dengan "{kueri}".</li>}
          {hasil.map(k => (
            <li key={k.category_key}>
              <button type="button" role="option" aria-selected={k.category_key === value} className={`opsi-kategori ${k.category_key === value ? 'on' : ''}`} onClick={() => { onChange(k); setKueri(''); }} disabled={disabled}>
                <span>{labelKategori(k)}</span><span className="hint">{(katalog.arketipe[k.archetype_id] || {}).nama || k.archetype_id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {terpilih && (
        <div className="kategori-terpilih" data-testid="kategori-terpilih">
          <strong>{labelKategori(terpilih)}</strong>
          <p>Arketipe {terpilih.archetype_id}: {ar ? ar.nama : '-'}</p>
          {risiko && <p><span className={`badge badge-${risiko.tone}`} data-testid="risiko-kategori">{risiko.label}</span></p>}
          {syarat.length > 0 && <div className="notice notice-warn" role="note">{syarat.map(x => <div key={x}>{x}</div>)}</div>}
          {terpilih.catatan_kebijakan && <div className="notice notice-warn" role="note"><strong>Catatan kebijakan:</strong> {terpilih.catatan_kebijakan}</div>}
          {terpilih.perlu_review && <p className="hint">Kategori ini ditandai perlu ditinjau admin; pastikan kategorinya tepat.</p>}
        </div>
      )}
    </div>
  );
}
