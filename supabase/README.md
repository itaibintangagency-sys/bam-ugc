# Catatan database (Supabase)

Semua perubahan struktur database dicatat sebagai berkas bertanggal di `migrations/`.
Aturan kerja: **setiap perubahan database = satu berkas baru di sini**, dijalankan di SQL Editor, lalu berkasnya disimpan di repo.

## Urutan dan status

| Berkas | Fungsi | Status pada database produksi |
|---|---|---|
| `baseline/20261002000000_baseline_legacy.sql` | CATATAN struktur lama (7 tabel, 2 fungsi, 4 trigger, 17 policy, 4 bucket). Direkonstruksi dari ekspor 2026-10-02. | **Jangan dijalankan.** Database sudah memilikinya. Dipakai hanya untuk membangun lingkungan uji dari nol. |
| `20261002000100_fix_legacy_rls_grants.sql` | Menutup celah: RLS pada `frames`/`products`/`backgrounds`, cabut TRUNCATE, kunci `search_path`, tambah indeks | Sudah dijalankan (per catatan serah-terima 4 Okt 2026) |
| `20261002000150_storage_remove_anon_upload.sql` | Menutup unggahan anonim ke bucket publik `product-assets` | Sudah dijalankan (per catatan serah-terima 4 Okt 2026) |
| `20261002000200_ugc_v2.sql` | Sistem baru: antrean batch/job, agent, telemetri, bucket privat `ugc-*` | Sudah dijalankan (per catatan serah-terima 4 Okt 2026) |
| `migrations/20261002000400_hardening.sql` | **Penguatan keamanan dan kinerja** dari analisis Supabase: menutup kenaikan role oleh staff, mencabut hak fungsi anon, indeks, dan merapikan policy. | Sudah dijalankan (per catatan serah-terima 4 Okt 2026) |
| `20261002000300_ugc_character_voice.sql` | Tahap karakter: profil suara, foto, tugas agent (upload foto, video perkenalan), status sampai `ready`, gerbang batch. Juga memperbaiki penjaga status: konteks tanpa pengguna login (service_role, SQL Editor, n8n) tidak lagi terblokir. | Sudah dijalankan (per catatan serah-terima 4 Okt 2026) |
| `20261005000500_agent_online_parity.sql` | Agent online setara agent offline: klaim job membawa `flow_asset_url`, penanda generate, data ruang karakter, dan foto wajah; `ugc_requeue_own`; kolom `flow_account_name` | **Belum dijalankan.** Jalankan setelah 0100–0400 (aman diulang) |
| `20261005000600_selaraskan_katalog.sql` | Katalog di database: 15 arketipe, 24 lokasi, peta 226 kategori. Produk mendapat arketipe dari kategori, risiko tidak bisa diturunkan staf, DNA karakter dibekukan sejak `dna_locked`. Berhenti bila tabel sudah berisi data | Sudah dijalankan |
| `20261005000700_gerbang_risiko.sql` | Menutup jalan pintas antrean: staf tidak bisa menyisipkan batch atau job langsung `queued`, memalsukan persetujuan admin, atau mengisi kolom sistem job. Gerbang risiko tinggi membaca risiko PRODUK. `ugc_approve_risk`. Kebijakan katalog tanpa tumpang tindih | **Belum dijalankan.** Jalankan setelah 0600 |
| `20261005000710_risiko_kategori.sql` | OPSIONAL: 5 kategori bayi (anak + klaim kesehatan) dinaikkan ke risiko tinggi; risiko lama tidak bisa diturunkan staf dengan mengganti kategori | **Belum dijalankan.** Jalankan setelah 0700 bila kebijakan disetujui |
| `20261005000720_risiko_klaim_kesehatan.sql` | OPSIONAL (Opsi B): 9 kategori klaim kesehatan (jerawat, sunscreen, sun care, perawatan mulut, hand sanitizer, minyak esensial, alat pijat, timbangan lemak, purifier) dinaikkan ke risiko tinggi; total override 14, berisiko tinggi efektif 24. Kategori anak saja sengaja tidak dinaikkan | **Belum dijalankan.** Jalankan setelah 0710 |

## Hasil audit ekspor 2026-10-02

| Temuan | Tingkat | Perbaikan |
|---|---|---|
| `frames`: RLS mati, tetapi staff yang login memegang hak penuh. Siapa pun yang login dapat membaca atau mengubah frame milik orang lain. | Sedang | `..._fix_legacy_rls_grants.sql` |
| Policy storage `Allow anon uploads to product-assets`: tanpa login siapa pun dapat mengunggah ke bucket publik (kunci anon tertulis di repo publik). | Sedang | `..._storage_remove_anon_upload.sql` |
| `anon` dan `authenticated` masih memegang TRUNCATE/REFERENCES/TRIGGER pada semua tabel (tidak terbuka lewat API REST, tetapi melanggar hak minimum) | Rendah | `..._fix_legacy_rls_grants.sql` |
| `backgrounds` dan `products` tanpa RLS (hak akses tabel membatasinya, tetapi pagar kedua tidak ada) | Rendah | `..._fix_legacy_rls_grants.sql` |
| Fungsi `is_admin()` dan `update_updated_at()` tanpa `search_path` | Rendah | `..._fix_legacy_rls_grants.sql` |
| Tidak ada indeks selain kunci utama | Rendah | `..._fix_legacy_rls_grants.sql` |
| Bucket `character-assets`, `product-assets`, `video-outputs` bersifat publik. Berkas dapat dibuka siapa pun yang memiliki alamatnya. | Informasi | v2 memakai bucket privat |
| Realtime belum aktif pada tabel mana pun | Informasi | Website v2 memakai polling dulu |

## Ketidakcocokan kode lama dengan database

| Kode lama (`js/data.js`) | Database asli | Akibat |
|---|---|---|
| `createCharacter` menulis `status: 'generating'` | Aturan CHECK hanya mengizinkan `draft`, `collecting_photos`, `avatar_processing`, `avatar_ready`, `voice_ready`, `complete`, `abandoned` | Tombol buat karakter gagal |
| Tulis `characters` oleh staff | Policy hanya admin yang boleh menulis | Gagal untuk staff |
| `addProduct` menulis `products` | Staff hanya punya hak SELECT pada `products` | Tombol tambah produk gagal |
| Perbaikan `shot_type` (`base`/`variasi`) dan `fix_rls_gap.sql` dari handoff | Batasan `shot_type` masih `closeup`/`medium`/`wide`; RLS belum aktif | Kedua perbaikan itu tidak pernah dijalankan |

Karena sistem v2 memakai tabel `ugc_*` yang terpisah, tabel lama tidak diubah fungsinya dan tidak perlu diperbaiki lebih jauh selama backend lama tidak dipakai.

## Memperbarui catatan ini

Jalankan `../db/export_schema.sql` di SQL Editor kapan saja untuk mendapatkan struktur terbaru, lalu bandingkan dengan berkas di sini.


## Hasil analisis Supabase langsung (2026-10-02, lewat konektor, baca-saja)

Project GeneratedContentBAM: 18 tabel dengan RLS aktif, 4 bucket `ugc-*` privat, 7 pengaturan bawaan, tanpa Edge Function. Semua 14 pemeriksaan pemasangan OK; akun agent belum dibuat.

| Temuan | Tingkat | Perbaikan |
|---|---|---|
| Policy "update own name" memberi staff hak mengubah kolom APA PUN pada profilnya, termasuk `role` dan `email`. Staff dapat menaikkan dirinya menjadi admin lewat API. | **Kritis** | `0400`: hak UPDATE hanya pada kolom `name` dan `avatar_path` |
| 11 fungsi SECURITY DEFINER (trigger dan pembantu) masih bisa dipanggil anon lewat API | Peringatan | `0400` |
| `ugc_touch` tanpa `search_path` | Peringatan | `0400` |
| 21 policy memakai `auth.uid()` langsung, 16 kasus policy tumpang tindih, 8 kunci asing tanpa indeks | Kinerja | `0400` |
| Perlindungan kata sandi bocor (leaked password protection) nonaktif | Peringatan | Pengaturan di dashboard (Auth), bukan SQL |
| 14 fungsi RPC untuk staff/agent tetap tampil sebagai peringatan "dapat dijalankan authenticated" | Sengaja | Tiap fungsi memeriksa peran di dalamnya |
