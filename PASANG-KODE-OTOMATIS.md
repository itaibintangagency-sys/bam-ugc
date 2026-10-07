# BA UGC: kode karakter dibuat otomatis

## Apa yang berubah

| Sebelum | Sesudah |
|---|---|
| Kode diketik manual di langkah Identitas (mis. `C02_THE_SOFT_GIRL`), bisa salah ketik atau bentrok | **Kolom kode hilang.** Database membuat kode saat karakter disimpan |
| | Bentuk kode: `C04-3F9A12BC` = huruf **C** + **nomor urut** + **8 karakter pertama dari kunci utama (id)** karakter itu |
| Kode karakter lama | **Tidak berubah** |
| Alat di laptop produksi (kode dari nama folder ruang) | **Tidak berubah**: bila kode dikirim, database memakainya apa adanya |

Aturan nomor: tertinggi yang ada + 1. Kode lama seperti `C02_THE_SOFT_GIRL` ikut dihitung, jadi karakter baru berikutnya mendapat `C03-...`. Nomor dihitung di dalam kunci per transaksi, jadi dua karakter yang disimpan bersamaan tidak mendapat nomor yang sama. Dua digit minimum, dan nomor di atas 99 tidak dipotong (`C100-...`).

## Urutan pasang (urutan penting)

1. **Database dulu.** Supabase, SQL Editor, jalankan `supabase\migrations\20261007000820_kode_karakter_otomatis.sql`. Aman diulang.
2. Timpa berkas di laptop dengan isi zip ini, lalu unggah **isi zip yang diekstrak** ke GitHub (bukan folder dari laptop). Vercel membangun ulang.
3. Tidak ada fungsi yang perlu di-deploy ulang dan tidak ada secret baru.

Bila website sudah tayang **sebelum** langkah 1, membuat karakter menampilkan: "Pembuatan kode otomatis belum aktif di database: jalankan migrasi 20261007000820…". Jalankan langkah 1 lalu coba lagi; tidak ada data yang rusak.

## Cara memeriksa

1. Buat karakter baru (langkah Identitas tidak lagi meminta kode; ada kotak hijau "Kode dibuat otomatis").
2. Setelah simpan, halaman detail dan daftar karakter menampilkan kode, misalnya `C03-9B21D4E0`. Pesan hijau juga menyebut kodenya.
3. Cek di SQL Editor:

```sql
select code, name, left(replace(id::text, '-', ''), 8) as awal_id from ugc_characters order by created_at;
```

Untuk karakter baru, bagian setelah tanda hubung sama dengan `awal_id` (huruf besar). Kode karakter lama tetap seperti semula.

## Yang perlu diketahui

| Hal | Keterangan |
|---|---|
| Nama diubah nanti | Kode tidak ikut berubah (nama tidak menjadi bagian kode) |
| Nomor bisa berloncat | Bila penyimpanan gagal setelah nomor dihitung, nomor itu tidak dipakai lagi. Tidak masalah untuk keunikan |
| Kode tidak bisa diubah | Tulisan di formulir menyatakan demikian. **Saya belum memeriksa apakah database melarang kode diubah lewat jalur lain** (staf pembuat karakter secara teknis boleh memperbarui barisnya). Bila ingin dikunci di database, kabari saya |
| Konkurensi sungguhan | Tes memakai satu koneksi. Kunci per transaksi adalah mekanisme standar Postgres, tetapi belum diuji dengan dua koneksi sungguhan |
