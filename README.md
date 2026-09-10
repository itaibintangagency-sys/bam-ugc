# BA UGC — Prototype

Prototype klik-jadi untuk platform generate video UGC internal Bintang Agency. Semua halaman, navigasi, dan alur (Video Studio 4-step, Character Creator, Product Library) sudah bisa diklik end-to-end. Saat ini datanya jalan di **mode prototype** (tersimpan di `localStorage` browser) supaya bisa langsung dites tanpa setup apa pun.

## Struktur

```
index.html          → redirect ke login/dashboard sesuai sesi
login.html           → Supabase Auth (email+password), fallback demo-session
dashboard.html        → kapasitas produksi, pipeline, karakter aktif, aktivitas terbaru
characters.html       → library karakter + character creator (game-style preset picker)
products.html         → library produk + tambah produk (scrape-simulasi / manual)
video-studio.html     → wizard 4 langkah: Pilih → Rencana → Generate → Produce
history.html          → semua video job, bisa difilter & dilanjutkan
css/style.css          → 1 file token desain + semua komponen (dipakai semua halaman)
js/data.js             → "database" prototype (localStorage), API-nya sudah dibentuk
                          persis seperti tabel Supabase — tinggal ganti isinya nanti
js/supabase-client.js  → init supabase-js, isi URL + anon key di sini
js/auth.js              → login/logout/guard, otomatis pakai Supabase kalau sudah dikonfigurasi
js/app.js                → toast, modal, helper kecil
supabase/schema.sql      → skema tabel siap-pakai untuk Supabase
```

## 1. Coba lokal dulu

Karena semua fetch pakai path relatif, buka lewat local server (bukan `file://`):

```bash
cd ba-ugc
python3 -m http.server 8080
# buka http://localhost:8080
```

⚠️ **Login bisa dicoba tanpa setup apa pun** (mode demo-session, email/password apa saja yang tidak kosong). Tapi begitu masuk ke Dashboard/Produk/Video Studio, halaman-halaman itu sekarang manggil Supabase asli langsung — **tidak akan menampilkan apa-apa (atau muncul pesan error) sampai `js/supabase-client.js` diisi** kredensial yang valid (lihat bagian 4). Ini bukan lagi mode mock-lokal seperti sebelumnya.

## 2. Push ke GitHub

```bash
cd ba-ugc
git init
git add .
git commit -m "BA UGC prototype"
git branch -M main
git remote add origin <url-repo-github-kamu>
git push -u origin main
```

## 3. Deploy ke Vercel

1. Buka [vercel.com](https://vercel.com) → **New Project** → import repo GitHub di atas.
2. Framework preset: pilih **Other** (situs statis, tidak butuh build step).
3. Deploy — selesai, dapat URL `*.vercel.app`.

## 4. Sambungkan Supabase

Project Supabase untuk BA UGC **sudah ada** (dipakai juga oleh bot Telegram untuk mengumpulkan foto karakter) — jangan jalankan `supabase/schema.sql`, itu arsip skema lama yang tidak dipakai lagi.

1. Buka **Project Settings → API** di project Supabase yang sudah ada → salin **Project URL** dan **anon public key**.
2. Isi ke `js/supabase-client.js`:
   ```js
   const SUPABASE_URL = 'https://xxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'ey...';
   ```
3. Pastikan RLS policy & 3 storage bucket (`character-assets`, `product-assets`, `video-outputs`) sudah ada di project itu — dicek manual di dashboard, bukan lewat file ini.
4. Buka **Authentication → Users** → buat akun admin pertama secara manual kalau belum ada (staff tidak bisa daftar sendiri, sesuai desain role).

Setelah langkah 2, `login.html` otomatis pindah dari demo-session ke Supabase Auth sungguhan — tidak perlu ubah kode lain.

### Status koneksi data per tabel
`js/data.js` sekarang bicara langsung ke Supabase (bukan `localStorage` lagi), tapi cakupannya beda per tabel:

| Tabel | Status | Catatan |
|---|---|---|
| `products` | Live, full CRUD | Form "Produk baru" langsung insert ke Supabase |
| `video_jobs`, `frames` | Live, full CRUD | `title` dihitung di app dari nama karakter + `product_name`, bukan kolom asli. Rencana scene (script/label per-frame) disimpan sebagai JSON di `video_jobs.frame_plan` — struktur JSON-nya usulan dari saya, belum ada standar resmi, cek dengan tim n8n sebelum backend lain ikut menulis ke kolom yang sama |
| `characters` | **Read-only** | Video Studio & halaman Karakter menampilkan data asli untuk dipilih, tapi Character Creator (wizard di characters.html) sengaja **tidak menulis apa pun** — alur pembuatan karakter asli berbasis `collecting_photos` bertahap lewat Telegram bot, beda total dari wizard instan di prototype ini. Perlu didesain ulang terpisah sebelum disambung |

## 5. Yang masih simulasi

- **Generate composite / generate scene / produce video** — disimulasikan dengan `setTimeout`, belum memanggil Magnific API (OmniHuman, Nano Banana, Video Combiner). Status di `video_jobs`/`frames` sudah ditulis pakai enum asli (`analyzing`/`scripting`/`generating_video`/dst, `pending`/`generating`/`review`/`approved`), jadi begitu n8n mulai update status yang sama dari backend, tampilan di app ini otomatis ikut berubah — tidak perlu ubah kode frontend.
- **Ambil data dari link produk** — disimulasikan, belum memanggil Apify scraper.
- **Character Creator** — murni pratinjau UI, tidak menulis ke database (lihat tabel di atas).
