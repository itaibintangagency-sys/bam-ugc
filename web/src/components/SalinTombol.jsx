import { useState } from 'react';

export default function SalinTombol({ teks, label = 'Salin teks' }) {
  const [ok, setOk] = useState(false);
  async function salin() {
    try { await navigator.clipboard.writeText(teks); setOk(true); setTimeout(() => setOk(false), 2000); }
    catch { setOk(false); }
  }
  return <button type="button" className="btn btn-secondary" onClick={salin} disabled={!teks} aria-live="polite">{ok ? 'Tersalin' : label}</button>;
}
