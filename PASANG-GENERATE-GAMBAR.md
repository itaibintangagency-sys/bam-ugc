# BA UGC: pasang fitur Generate gambar (website + Edge Function + riwayat biaya)

## Apa yang berubah

| Bagian | Isi |
|---|---|
| Karakter baru, langkah 3 | Pilihan sumber foto: unggah sendiri, buat dengan AI dari DNA, buat dengan AI dari foto acuan (eksperimen) |
| Halaman **Riwayat generate** | **Khusus admin.** Siapa, kapan, jenis, karakter, status, galat, durasi, USD, Rupiah. Total per orang per bulan, filter, unduh CSV |
| Dasbor | Kartu "biaya bulan ini" untuk admin |
| Edge Function `generate-image` | Memegang kunci OpenRouter di server. Browser tidak pernah melihat kunci |
| Database | Tabel `ugc_image_runs` (riwayat), batas harian, fungsi laporan, satu migrasi |
| `core` | `imageApi.js` dipisah dari `imageRequest.js`; `peringatanKonflik` pindah ke `dna.js`; daftar kata anak diperketat (childlike, boyish, girlish, preteen, dan sejenisnya) |

Aturan: staf **tidak** melihat biaya. Kualitas `high` dan tanpa batas harian hanya untuk admin. Staf dibatasi 20 gambar per hari dan 4 per klik (ubah di tabel `ugc_settings`: `gen_daily_limit_staff`, `gen_max_per_click`).

## Urutan pasang (penting, jangan dibalik)

1. **Timpa berkas.** Ekstrak zip ini ke `C:\bam-ugc-v2\` dengan Timpa / Replace, **setelah** zip `uji-foto-acuan-v4` sudah terpasang. GitHub `main` belum memuat perubahan foto acuan.
2. **Database.** Buka Supabase, SQL Editor, jalankan isi `supabase\migrations\20261006000800_generate_gambar.sql`. Aman diulang. Harus sudah ada migrasi sampai 20261005000720.
3. **Kunci OpenRouter sebagai secret.** Supabase, Edge Functions, Secrets, tambah `OPENROUTER_API_KEY` berisi kunci **baru**. Jangan menempelkannya di chat atau berkas. Kunci yang pernah terlihat di tangkapan layar sebaiknya sudah dicabut.
4. **Deploy fungsi.** Dari folder repo, dengan Supabase CLI sudah login dan terhubung ke proyek `usrhroplsedwgkxywshw`:

   ```
   supabase functions deploy generate-image
   ```

   Folder `supabase\functions\_shared\core` ikut terbundel otomatis karena diimpor dengan alamat relatif. Biarkan "Verify JWT" **aktif** (bawaan).
5. **Website.** Dorong perubahan ke GitHub; Vercel membangun ulang. Variabel `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` tidak berubah.

## Uji pertama (biaya kecil)

1. Masuk sebagai **admin**. Karakter, Buat karakter, isi contoh C02, sampai langkah Foto wajah.
2. Pilih "Buat dengan AI dari DNA", jumlah **1**, kualitas **low**, klik Buat. Tunggu sampai gambar muncul (bisa setengah menit lebih).
3. Pastikan kartu gambar menampilkan biaya Rupiah dan USD, lalu buka **Riwayat generate**: satu baris, nama Anda, biaya sama.
4. Masuk sebagai **staf**: biaya tidak tampil, menu Riwayat tidak ada, dan membuka `/riwayat` langsung menampilkan "khusus admin".

## Kurs Rupiah

Urutan: kurs manual (bila diisi) lalu cache 12 jam, Frankfurter (kurs referensi harian Bank Sentral Eropa), open.er-api, cache lama. Kurs **dicatat per gambar**, jadi riwayat tidak berubah ketika kurs berubah. Ini kurs referensi, bukan kurs jual-beli bank. Bila semua sumber gagal, biaya USD tetap tercatat dan kolom Rupiah kosong.

Kurs manual (menimpa otomatis), jalankan di SQL Editor:

```sql
insert into ugc_settings (key, value, note) values ('kurs_usd_idr_manual', '16500'::jsonb, 'Rupiah per 1 USD, menimpa kurs otomatis')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

Hapus barisnya untuk kembali ke kurs otomatis: `delete from ugc_settings where key = 'kurs_usd_idr_manual';`

## Batas dan perilaku yang perlu diketahui

| Hal | Keterangan |
|---|---|
| Waktu satu gambar | Fungsi menyerah di 140 detik (batas Supabase: 150 detik paket Free, 400 detik berbayar). Gambar yang lebih lama dicatat **gagal**, tidak ditagih OpenRouter |
| Satu klik, banyak gambar | Tiap gambar satu panggilan sendiri, berjalan serentak |
| Gambar gagal | Tercatat di riwayat dengan alasan; tidak dihitung biaya |
| Foto acuan | Disimpan di penyimpanan privat (`refs/<id pengguna>/`) dan dikirim ke OpenRouter. Hanya admin yang bisa menghapus. Pakai hanya foto orang dewasa yang izinnya sudah diurus |
| Biaya tidak dilaporkan OpenRouter | Dicatat kosong dan dihitung di kartu "Tanpa biaya terlapor". Tidak ada angka karangan |

## Bila ada yang tidak jalan

| Pesan | Artinya | Tindakan |
|---|---|---|
| "Fungsi generate belum terpasang atau tidak bisa dijangkau" | Fungsi belum di-deploy | Langkah 4 |
| "Kunci OpenRouter belum dipasang di server" | Secret belum ada | Langkah 3, lalu deploy ulang bila perlu |
| "Kunci OpenRouter ditolak" | Kunci salah atau dicabut | Buat kunci baru, ganti secret |
| "Saldo OpenRouter tidak cukup" | Saldo habis | Isi saldo |
| "Batas harian N gambar sudah tercapai" | Batas staf | Coba besok, atau admin menaikkan `gen_daily_limit_staff` |
| "Fitur ini belum aktif di database" di Riwayat | Migrasi belum dijalankan | Langkah 2 |
| "Waktu habis setelah 140 detik" | Model lambat | Coba lagi, kualitas lebih rendah |

## Tes yang menyertai

| Lokasi | Perintah | Isi |
|---|---|---|
| `web` | `npm test` | Pustaka, panel generate, Riwayat, alur Karakter baru, inti fungsi server |
| `db` | `npm test` | Termasuk `generate-gambar.test.mjs` (skema asli, izin per peran, batas harian, laporan) |
| `core` | `npm test` | DNA, daftar kata anak, `imageApi` |
| `tools\uji-gambar` | `npm test` | Alat uji gambar |

Yang belum terbukti oleh tes: Supabase dan OpenRouter sungguhan, konkurensi sungguhan, dan lama satu gambar di dunia nyata.
