# BA UGC: pasang halaman Produk dengan analisis foto oleh AI

## Apa yang baru

| Bagian | Isi |
|---|---|
| Menu **Produk** | Daftar produk (kartu dengan foto, kategori, status, lencana risiko), filter nama, status, risiko, "hanya milik saya" |
| **Produk baru** | Nama + **kategori** (cari di 226 kategori; arketipe, risiko, syarat karakter, dan catatan kebijakan tampil otomatis). Menyimpan draf lalu masuk ke halaman detail |
| **Detail produk** | Foto (1 sampai 6, diperkecil otomatis di browser, tiap foto diberi peran), **Analisis dengan AI**, editor detail per slot, simpan draf, **Konfirmasi produk**, buka kembali, ganti kategori |
| Fungsi `analyze-product` | AI membaca foto dan menyusun **draf** fakta, warna, dan detail per slot arketipe. Tidak menulis produk; Anda yang meninjau dan mengonfirmasi |
| Riwayat generate (admin) | Sekarang memuat juga **Analisis foto produk** (siapa, kapan, biaya Rupiah dan USD) dengan nama produknya |
| Database | Migrasi `20261006000810_analisis_produk.sql`: jenis baru di riwayat, batas harian analisis terpisah dari batas gambar, nama produk di laporan |
| `core` | Modul `productProfile` (slot, peran foto, validasi, prompt analisis), daftar kata terlarang dipindah ke satu berkas data |

Aturan: staf **tidak** melihat biaya. Staf dibatasi 30 analisis per hari (ubah di `ugc_settings`: `analisis_limit_harian_staf`). Admin tanpa batas.

## Urutan pasang

1. **Timpa berkas.** Ekstrak zip ke folder sementara dan timpa `C:\bam-ugc-v2\` dengan isinya, **setelah** `generate-ai-v2`. Untuk GitHub, unggah **isi folder hasil ekstrak** (bukan folder dari laptop). Lihat *Cara mengunggah ke GitHub* di `PASANG-GENERATE-GAMBAR.md`.
2. **Database.** Supabase, SQL Editor, jalankan `supabase\migrations\20261006000810_analisis_produk.sql`. Aman diulang.
3. **Secret.** Tidak ada secret baru: fungsi memakai `OPENROUTER_API_KEY` yang sudah ada.
4. **Deploy DUA fungsi** (fungsi gambar ikut berubah: biaya yang sudah ditagih kini tetap dicatat walau gambar gagal disimpan):

   ```
   npx supabase@latest functions deploy analyze-product --project-ref usrhroplsedwgkxywshw
   npx supabase@latest functions deploy generate-image --project-ref usrhroplsedwgkxywshw
   ```
5. **Website.** Unggah ke GitHub; Vercel membangun ulang.

## Model analisis (penting)

Bawaan: `google/gemini-2.5-flash` (membaca gambar, murah). **Nama model ini tebakan saya dan belum diuji di akun Anda.** Bila saat uji muncul "Model atau alamat tidak ditemukan", ganti di SQL Editor:

```sql
update ugc_settings set value = '"nama/model-baru"'::jsonb where key = 'analisis_model';
```

Pilih model di openrouter.ai/models yang mendukung **masukan gambar**. Tidak perlu deploy ulang.

## Uji pertama (biaya sangat kecil)

1. Masuk sebagai **admin**. Produk, **Produk baru**: nama "Daster uji", cari kategori "daster", pilih, **Simpan dan lanjut ke foto**.
2. Di halaman detail, unggah 2 sampai 3 foto produk (depan, close-up). Cek peran tiap foto.
3. Klik **Analisis dengan AI**. Tunggu sampai 30 detik. Editor terisi per slot, dengan catatan AI dan biaya (Rupiah dan USD, khusus admin).
4. **Baca tiap slot**: AI bisa salah. Perbaiki bila perlu. Konfirmasi aktif setelah minimal 3 slot terpakai dan tidak ada galat.
5. Klik **Konfirmasi produk**. Status berubah menjadi Terkonfirmasi.
6. Buka **Riwayat generate**: satu baris "Analisis foto produk" dengan nama produknya.
7. Masuk sebagai **staf**: biaya tidak tampil di mana pun.

## Yang perlu diketahui

| Hal | Keterangan |
|---|---|
| Urutan wajib | Kategori dulu (menentukan arketipe dan slot), lalu foto, lalu analisis |
| Peran foto | Beberapa slot hanya dipakai bila foto berperan tertentu ada (mis. **Tekstur** untuk produk perawatan, **Sol** untuk alas kaki). Pilihan peran menyesuaikan arketipe |
| Ganti kategori | Bila arketipenya berbeda, detail slot dikosongkan (dengan konfirmasi) dan perlu dianalisis ulang |
| Kata terlarang | Teks Inggris tidak boleh memuat kata Indonesia, dan kedua bahasa tidak boleh memuat kata klaim ("nyaman", "premium", dan sejenisnya). Editor menunjukkan masalahnya sebelum konfirmasi |
| Produk risiko tinggi | Ditandai merah. Tiap job-nya nanti butuh persetujuan admin (layar Batch menyusul) |
| Foto | Diperkecil di browser (sisi terpanjang 1600 piksel). Fungsi menolak total foto di atas 12 MB |
| Hapus foto | Hanya melepas foto dari produk; berkasnya tetap di penyimpanan (hanya admin bisa menghapus berkas) |
| Saran kategori oleh AI | Belum ada (sesuai keputusan: nanti). Kategori dipilih manual |

## Bila ada yang tidak jalan

| Pesan | Artinya | Tindakan |
|---|---|---|
| "Fungsi generate belum terpasang atau tidak bisa dijangkau" | `analyze-product` belum di-deploy | Langkah 4 |
| "Model atau alamat tidak ditemukan… analisis_model" | Nama model salah | Bagian *Model analisis* |
| "AI tidak mengembalikan JSON yang bisa dibaca" | Model tidak patuh format | Coba lagi; bila berulang, ganti model |
| "Batas harian N analisis sudah tercapai" | Batas staf | Besok, atau admin menaikkan `analisis_limit_harian_staf` |
| "Kunci OpenRouter belum dipasang" / "ditolak" / "Saldo… tidak cukup" | Sama seperti generate gambar | Lihat `PASANG-GENERATE-GAMBAR.md` |
| "Fitur ini belum aktif di database" | Migrasi 0810 belum dijalankan | Langkah 2 |
| Konfirmasi tetap nonaktif | Profil belum memenuhi syarat planner | Baca daftar "Perlu diperbaiki" di bawah editor |

## Tes yang menyertai

| Lokasi | Perintah | Isi |
|---|---|---|
| `core` | `npm test` | Termasuk uji terpadu: profil yang dinyatakan siap benar-benar menghasilkan rencana 5 panel di planner sungguhan |
| `web` | `npm test` | Pustaka, komponen, tiga halaman, dan inti fungsi analisis |
| `db` | `npm test` | Termasuk `analisis-produk.test.mjs` (rantai migrasi lengkap, izin, batas harian) |

**Belum terbukti oleh tes:** mutu isi analisis model sungguhan (akurasi slot, kepatuhan format, apakah OpenRouter mengembalikan biaya untuk model itu), Supabase dan OpenRouter sungguhan, dan konkurensi sungguhan.
