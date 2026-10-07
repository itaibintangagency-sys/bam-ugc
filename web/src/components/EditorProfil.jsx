import { useMemo } from 'react';
import { LABEL_ROLE, barisKeDaftar, daftarKeBaris, setDetail, slotsFor, validateProfile } from '../lib/produk.js';

// Editor profil produk: fakta, warna, dan satu baris detail per slot arketipe. Validasi langsung memakai aturan planner dan lint
// (sama dengan yang ditegakkan fungsi analisis), sehingga staf melihat masalahnya sebelum mengonfirmasi.
export default function EditorProfil({ archetypeId, roles, profil, onChange, disabled = false }) {
  const slots = useMemo(() => slotsFor(archetypeId) || [], [archetypeId]);
  const v = useMemo(() => validateProfile(profil, archetypeId, roles), [profil, archetypeId, roles]);
  const set = (k, nilai) => onChange({ ...profil, [k]: nilai });
  const detail = key => (profil.details || []).find(d => d.slot_key === key) || null;
  const galat = v.issues.filter(i => i.level === 'error'), peringatan = v.issues.filter(i => i.level === 'warn');
  return (
    <div className="editor-profil" data-testid="editor-profil">
      <div className="field"><label htmlFor="fakta-id">Fakta produk (Indonesia), satu per baris</label>
        <textarea id="fakta-id" rows={3} value={daftarKeBaris(profil.facts)} onChange={e => set('facts', barisKeDaftar(e.target.value))} disabled={disabled} /></div>
      <div className="field"><label htmlFor="fakta-en">Fakta produk (Inggris), satu per baris</label>
        <textarea id="fakta-en" rows={3} value={daftarKeBaris(profil.facts_en)} onChange={e => set('facts_en', barisKeDaftar(e.target.value))} disabled={disabled} />
        <p className="hint">Masuk ke JSON video. Tulis bahasa Inggris saja, tanpa klaim seperti "nyaman" atau "premium".</p></div>
      <div className="field"><label htmlFor="warna">Warna produk (Inggris), satu per baris</label>
        <textarea id="warna" rows={2} value={daftarKeBaris(profil.colors)} onChange={e => set('colors', barisKeDaftar(e.target.value))} disabled={disabled} /></div>

      <h3 className="sub">Detail per slot</h3>
      <p className="hint">Planner butuh minimal 3 slot terisi dengan keyakinan 0,6 atau lebih. Slot yang butuh foto berperan tertentu hanya dipakai bila foto itu ada.</p>
      {slots.map(s => {
        const d = detail(s.key); const st = v.slots.find(x => x.key === s.key) || {}; const kurang = s.butuh_foto.filter(r => !(roles || []).includes(r));
        const ubah = nilai => onChange(setDetail(profil, s.key, nilai));
        return (
          <fieldset key={s.key} className={`slot ${st.dipakai ? 'dipakai' : ''}`} data-testid={`slot-${s.key}`} disabled={disabled}>
            <legend>{s.nama} <span className={`badge badge-${st.dipakai ? 'ok' : 'warn'}`}>{st.dipakai ? 'Dipakai' : d ? 'Belum dipakai' : 'Kosong'}</span></legend>
            {kurang.length > 0 && <p className="hint">Butuh foto berperan {kurang.map(r => LABEL_ROLE[r] || r).join(', ')}.</p>}
            <div className="field"><label htmlFor={`s-${s.key}-id`}>Teks Indonesia</label><input id={`s-${s.key}-id`} value={d ? d.text : ''} onChange={e => ubah({ text: e.target.value })} maxLength={140} autoComplete="off" /></div>
            <div className="field"><label htmlFor={`s-${s.key}-en`}>Teks Inggris</label><input id={`s-${s.key}-en`} value={d ? d.text_en : ''} onChange={e => ubah({ text_en: e.target.value })} maxLength={140} autoComplete="off" /></div>
            <div className="baris-pilihan">
              <div className="field"><label htmlFor={`s-${s.key}-label`}>Label singkat</label><input id={`s-${s.key}-label`} value={d ? d.label : ''} onChange={e => ubah({ label: e.target.value })} maxLength={40} autoComplete="off" /></div>
              <div className="field"><label htmlFor={`s-${s.key}-conf`}>Keyakinan (0 sampai 1)</label><input id={`s-${s.key}-conf`} type="number" min="0" max="1" step="0.05" value={d ? d.confidence : ''} onChange={e => ubah({ confidence: e.target.value === '' ? 1 : Number(e.target.value) })} /></div>
            </div>
          </fieldset>
        );
      })}
      {galat.length > 0 && <div className="notice notice-bad" role="alert" data-testid="isu-galat"><strong>Perlu diperbaiki sebelum dikonfirmasi:</strong><ul>{galat.map((i, n) => <li key={n}>{i.msg}</li>)}</ul></div>}
      {peringatan.length > 0 && <div className="notice notice-warn" role="status" data-testid="isu-peringatan"><strong>Perhatian:</strong><ul>{peringatan.map((i, n) => <li key={n}>{i.msg}</li>)}</ul></div>}
      {v.ready && <div className="notice notice-ok" role="status" data-testid="profil-siap">Profil memenuhi syarat planner: {v.usable.length} slot terpakai.</div>}
    </div>
  );
}
