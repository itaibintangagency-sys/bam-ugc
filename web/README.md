# BA UGC — website (fase 1)

Website staf untuk BA UGC. Fase 1 berisi: **login**, **peran** (admin, staf), kerangka halaman, dan **dasbor** (antrean per status, status agent, kredit teramati).
Website hanyalah layar di atas database Supabase yang sudah terkunci aturannya (RLS). Rahasia tidak pernah ada di kode browser.

## Struktur

| Folder | Isi |
|---|---|
| `src/pages` | `Login.jsx`, `Dashboard.jsx` |
| `src/auth` | Konteks login dan penjaga halaman |
| `src/lib` | Logika murni yang diuji: status job, status agent, peran, pesan galat, kontras warna |
| `src/styles` | `tokens.css` (warna dan ukuran), `base.css`, `login.css`, `app.css` |
| `test` | 30 tes (logika, dasbor dengan klien tiruan, render halaman login, kontras warna) |

## Menjalankan di laptop

```
cd web
npm install
copy env.contoh .env.local      (lalu isi VITE_SUPABASE_ANON_KEY)
npm run dev
npm test
npm run build
```

## Memasang di Vercel

1. Vercel → **Add New → Project** → pilih repo ini.
2. **Root Directory**: `web`. Framework: Vite (terdeteksi otomatis). Build: `npm run build`. Output: `dist`.
3. **Environment Variables**: `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` (keduanya publik; nilainya sama dengan di `js/supabase-client.js` atau Supabase → Project Settings → API).
4. Deploy. Jangan pernah mengisi kunci `service_role`, kunci OpenRouter, atau `BAUGC_SHARED_SECRET` di Vercel untuk proyek ini.

`vercel.json` mengarahkan semua alamat ke `index.html` agar `/masuk` bisa dibuka langsung.

## Keterbacaan (CSS)

- Huruf dasar 16px; tidak ada teks di bawah 14px.
- Teks utama dan pendukung memenuhi **AAA (7:1)**; tombol utama, logo, dan galat memenuhi AA atau lebih; garis tepi isian dan cincin fokus minimal 3:1.
- `test/contrast.test.js` membaca warna langsung dari `src/styles/tokens.css`. **Mengubah warna tanpa memeriksa kontras membuat tes gagal.**
- Mode kontras tinggi sistem (`prefers-contrast: more`) menebalkan teks dan garis.

## Batasan yang diketahui

- Tampilan **belum diuji di browser sungguhan**; yang teruji hanya logika, render komponen (jsdom), dan build. Periksa pratinjau Vercel.
- Batas status agent (online ≤ 5 menit, tidak aktif ≤ 30 menit) adalah perkiraan; sesuaikan di `src/lib/agent.js`.
- Dasbor menghitung 1.000 job terbaru; peran dibaca dari `user_profiles` (bila baris tidak ada, dianggap staf). Hak akses sesungguhnya tetap ditentukan RLS.

## Fase berikutnya

2 Karakter (unggah foto wajah dulu) · 3 Produk (kategori dari 226, lencana risiko) · pekerja gambar · 4 Batch · 5 Antrean dan QA · 6 Pembuatan wajah dan sudut.
