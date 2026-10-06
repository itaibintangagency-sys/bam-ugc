import { useId } from 'react';

// Kelompok pilihan tunggal (tombol radio bergaya chip). Dapat dioperasikan dengan keyboard dan pembaca layar.
export default function Pilihan({ legend, hint, options, value, onChange, labels = {}, opsional = false, name }) {
  const uid = useId(); const nm = name || uid;
  return (
    <fieldset className="pilihan">
      <legend>{legend}{opsional ? <span className="opsional"> (opsional)</span> : null}</legend>
      {hint ? <p className="hint">{hint}</p> : null}
      <div className="chips">
        {options.map(o => (
          <label key={o} className={`chip ${value === o ? 'on' : ''}`}>
            <input type="radio" name={nm} value={o} checked={value === o} onChange={() => onChange(o)} />
            <span>{labels[o] || o}</span>
          </label>
        ))}
        {opsional && value ? <button type="button" className="link" onClick={() => onChange('')}>Kosongkan</button> : null}
      </div>
    </fieldset>
  );
}
