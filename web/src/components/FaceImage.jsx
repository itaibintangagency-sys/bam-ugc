import { useEffect, useState } from 'react';
import { muatFoto } from '../lib/karakter.js';

// Foto wajah berada di bucket privat, jadi diunduh lewat sesi login lalu ditampilkan sebagai gambar lokal.
export default function FaceImage({ client, path, alt, className = 'thumb' }) {
  const [src, setSrc] = useState(''); const [galat, setGalat] = useState(false);
  useEffect(() => {
    let aktif = true; let url = '';
    setSrc(''); setGalat(false);
    if (!path) return undefined;
    muatFoto(client, path).then(b => { if (!aktif) return; url = URL.createObjectURL(b); setSrc(url); }).catch(() => { if (aktif) setGalat(true); });
    return () => { aktif = false; if (url) URL.revokeObjectURL(url); };
  }, [client, path]);
  if (!path) return <div className={`${className} thumb-kosong`} role="img" aria-label="Foto wajah belum ada">Belum ada foto</div>;
  if (galat) return <div className={`${className} thumb-kosong`} role="img" aria-label="Foto tidak bisa dimuat">Foto tidak bisa dimuat</div>;
  if (!src) return <div className={`${className} thumb-kosong`} role="img" aria-label="Memuat foto">Memuat…</div>;
  return <img className={className} src={src} alt={alt} />;
}
