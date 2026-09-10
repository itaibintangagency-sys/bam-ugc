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

Login dengan email/password apa saja — mode prototype menerima semua kombinasi yang tidak kosong. Semua data (karakter, produk, video job) tersimpan di localStorage browser, sudah di-seed dengan 3 karakter + 5 produk contoh biar dashboard langsung keisi.

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

## 4. Sambungkan Supabase (biar bukan prototype lagi)

1. Buat project baru di [supabase.com](https://supabase.com).
2. Buka **SQL Editor** → jalankan isi `supabase/schema.sql`.
3. Buka **Storage** → buat 3 bucket privat: `character-assets`, `product-assets`, `video-outputs`.
4. Buka **Project Settings → API** → salin **Project URL** dan **anon public key**.
5. Isi ke `js/supabase-client.js`:
   ```js
   const SUPABASE_URL = 'https://xxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'ey...';
   ```
6. Buka **Authentication → Users** → buat akun admin pertama secara manual (staff tidak bisa daftar sendiri, sesuai desain role).

Setelah langkah 5, `login.html` otomatis pindah dari demo-session ke Supabase Auth sungguhan — tidak perlu ubah kode lain.

### Catatan penting sebelum pakai data asli
`js/data.js` saat ini baca/tulis ke `localStorage`, bukan ke Supabase. Struktur fungsinya (`DB.getCharacters()`, `DB.addProduct()`, dst.) sudah dibentuk sama persis dengan skema tabel, jadi langkah selanjutnya adalah mengganti isi tiap fungsi di `js/data.js` dengan pemanggilan `supabaseClient.from('...')` — tanpa perlu ubah kode di halaman manapun. Ini pekerjaan lanjutan, bukan bagian dari prototype klik-jadi ini.

## 5. Yang masih simulasi (belum tersambung ke API asli)

- **Generate composite / generate scene / produce video** — disimulasikan dengan `setTimeout`, belum memanggil Magnific API (OmniHuman, Nano Banana, Video Combiner).
- **Ambil data dari link produk** — disimulasikan, belum memanggil Apify scraper.
- Kedua bagian ini adalah pekerjaan n8n/backend selanjutnya (lihat catatan arsitektur proyek) — bukan pekerjaan frontend.
