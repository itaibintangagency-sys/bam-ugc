# BA UGC v2 — generator video UGC (fondasi)

Pembangunan ulang BA UGC mengikuti alur yang sudah disepakati:
karakter → produk → batch (1 karakter, maksimal 10 produk) → storyboard → JSON → produksi di Google Flow → caption dan hashtag.

## Isi paket (tahap 1: fondasi)

| Folder | Fungsi | Status uji |
|---|---|---|
| `core/` | Logika inti: rencana panel dengan acak berbenih, 24 lokasi dengan **ruang rekam suara otomatis**, prompt storyboard (bertulis dan bersih), JSON video, **profil suara karakter** (dua lapis), **JSON video perkenalan**, pemeriksa kata pemicu dan klaim | 24 dari 24 lolos |
| `supabase/migrations/` | Catatan database berurutan: baseline lama (catatan), perbaikan celah, penutupan unggahan anonim, dan sistem v2 (antrean, RLS, detak agent, telemetri, bucket privat). Lihat `supabase/README.md`. | Rantai migrasi lolos di Postgres lokal |
| `db/` | Pengujian database dan kueri `export_schema.sql` untuk memperbarui catatan | 25 dari 25 lolos (termasuk putaran-balik terhadap struktur asli dan tahap karakter) |
| `agent/` | Agent di laptop produksi: menarik job video **dan tugas karakter** (upload foto, video perkenalan 720p 4 detik), memanggil karakter lewat daftar `@`, membuat project baru, perekam layar berpemandu. Mode online (Supabase) dan offline (folder) | 20 dari 20 lolos (halaman Flow tiruan) |

**Belum dibangun (tahap berikutnya):** website (wizard karakter, produk, batch), langkah AI (analisis produk, gambar storyboard, caption), dan otomasi pembuatan karakter dan suara di dalam Flow (menunggu hasil perekam layar).

## Yang sudah dan belum terbukti

| Terbukti di Flow asli (dari uji kita sebelumnya) | Baru diuji di halaman tiruan |
|---|---|
| Terhubung ke Chrome, upload, melampirkan bahan, isi prompt, atur setelan, generate, tunggu, nama menu unduh | Kartu gagal dan tombol ulang, deteksi video selesai pada banyak video, unduh otomatis, captcha, kesalahan tampilan, pemantau perubahan |

Karena itu, **uji pertama di Flow asli harus dilakukan dengan mendampingi** (lihat bagian "Uji pertama" di bawah).


## Tahap karakter (baru)

Alur status: `draft` → `face_ready` → `dna_locked` → `voice_defined` → `sheet_ready` → `project_ready` → `voice_in_flow` → `intro_review` → `ready`.

| Langkah | Pelaku | Catatan |
|---|---|---|
| Profil suara | Staff | Pilih suara dasar dari daftar Flow, lalu atur nada, energi, tempo, gaya, aksen, bahasa. Satu suara dasar hanya untuk satu karakter kecuali admin menyetujui. |
| Upload foto ke project | Agent (tugas `upload_photos`) | Hanya foto yang disetujui |
| Buat karakter dan suara di Flow | Staff (manual dulu) | Lalu konfirmasi di app. Otomasinya menunggu hasil perekam layar. |
| Video perkenalan | Agent (tugas `intro_video`) | 720p, 4 detik, karakter dipanggil lewat `@`. Teks: "Hai, aku {nama}. Senang kenalan sama kamu!" |
| Review | Staff | Wajah sama? Suara sesuai profil? Bersih dari teks atau watermark? Setuju maka `ready`. Ditolak 3 kali kembali ke `voice_defined`. |
| Pengecualian | Admin | Menyatakan siap tanpa perkenalan, dengan alasan tertulis (minimal 10 karakter) |

Batch hanya bisa masuk antrean bila karakternya berstatus `ready`.

### Suara: dua lapis
- **Identitas** (disimpan sekali sebagai Voice di Flow, bahasa Inggris, kolom "Sesuaikan performa"): jenis kelamin, usia, nada, energi, tempo, gaya, aksen, kadar bahasa. `core` menyusunnya otomatis lewat `buildVoicePerformance`.
- **Per video** (di JSON): suasana, jeda, napas awal, dan **ruang rekam yang otomatis mengikuti lokasi** yang dipilih saat storyboard (`audio.recording_space`).

### Perekam layar
`6-rekam-layar-flow.bat` memandu kamu membuka tiap layar Flow (project baru, halaman Karakter, form karakter, daftar suara, daftar `@`, dan lainnya). Di setiap layar tekan Enter, lalu agent memotret daftar elemennya. Tidak ada yang diklik dan tidak ada generate. Kirim folder `agent/recon/<waktu>` ke Claude.

## Memasang agent di laptop (Windows)

1. Folder `agent`: klik dua kali `0-install.bat` (sekali saja).
2. Klik dua kali `start-chrome.bat`. Login Google manual, lalu buka project Flow. Jangan maximize jendela.
3. Klik dua kali `1-doctor.bat`. Semua baris harus berawalan ✔.

## Uji pertama tanpa website (mode offline)

1. Siapkan `storyboard.png` dan `prompt.json` (seperti pada uji sebelumnya).
2. Klik dua kali `4-buat-job-offline.bat` dan isi tiga pertanyaan: alamat project Flow, file storyboard, file JSON. Pilih **360p** untuk uji pertama.
3. Klik dua kali `5-jalankan-1-job-offline.bat`. Pantau layar Chrome. Hasil video ada di `agent/local/outbox/<id>/video.mp4`.
4. Kalau gagal, kirim berkas di `agent/debug/` (JSON dan PNG) dan `agent/logs/`.

## Mode online (setelah database dan website siap)

1. Di Supabase SQL Editor, jalankan berurutan: `20261002000100_fix_legacy_rls_grants.sql`, `20261002000150_storage_remove_anon_upload.sql`, `20261002000200_ugc_v2.sql`, `20261002000300_ugc_character_voice.sql`, lalu `20261002000400_hardening.sql` (semuanya aman diulang). Atau jalankan satu berkas gabungan `supabase/run_all/20261002_JALANKAN_SEMUA.sql` (memuat 0100, 0200, 0300, 0400). Berkas baseline ada di folder `supabase/baseline` dan TIDAK untuk dijalankan di produksi. Setelah itu jalankan `db/verify_setup.sql` untuk memeriksa hasilnya.
2. Buat akun agent (Authentication → Users), lalu jadikan `role = 'agent'` (petunjuknya ada di akhir berkas SQL).
3. Salin `agent/.env.example` menjadi `agent/.env` dan isi **sendiri** (email, kata sandi, alamat Supabase, kunci anon).
4. Klik dua kali `2-start-agent.bat`.

## Aturan keselamatan yang tertanam

- Agent **menolak** mengklik: Pindahkan ke sampah, Upgrade, Resolusi ditingkatkan, Bagikan media, Favorit.
- Generate hanya ditekan bila: tepat 1 bahan terlampir, prompt cukup panjang, model Omni 1.1 Flash, dan semua setelan terpilih.
- Captcha, sesi Google habis, atau tampilan berubah → agent berhenti, mencatat, menjeda antrean, dan menunggu manusia. Agent tidak mencoba menembusnya.
- Kegagalan kebijakan diulang otomatis maksimal 2 kali per percobaan, dan 3 percobaan per job (bisa diubah admin di tabel `ugc_settings`).
- Kategori berisiko tinggi tidak bisa masuk antrean tanpa persetujuan admin.
- Maksimal 10 video per batch dan 10 batch per hari ditegakkan oleh database.

## Pemantau perubahan Flow ("Analisa Flow")

`3-analisa-flow.bat`: membandingkan tampilan sekarang dengan baseline dan menulis laporan di `agent/reports/`. Tidak menekan generate atau unduh. Jalankan setelah Flow tampak berubah, dan sebelum menjalankan antrean. Nama tombol semua tersimpan di `agent/config/flow.labels.json`, jadi perbaikan cukup mengubah berkas itu.

## Menjalankan pengujian

```
cd core  && node --test test/core.test.js test/voice.test.js
cd db    && npm i && npm test
cd agent && npm i && node --test test/agent.test.js test/agent.char.test.js   # butuh Chromium (CHROME_BIN)
```

## Batasan yang perlu diketahui

- Agent hanya mendukung tata letak jendela Chrome yang sempit (kapsul pengaturan di kanan bawah kotak prompt). Ukuran jendela harus tetap.
- Video terbaru diasumsikan berada di kiri atas grid project.
- Unduhan ditangkap lewat Chrome; bila gagal, agent mencari berkas di folder unduhan (`DOWNLOAD_DIR`).
- Satu agent memproses satu video pada satu waktu.
- Pemanggilan karakter lewat `@` dan pembuatan project baru baru diuji di halaman tiruan. Perilaku aslinya di Flow perlu dibuktikan dengan perekam layar dan uji pertama yang didampingi.
- Agent tidak membuat karakter dan suara di dalam Flow (belum dipetakan). Itu langkah manual staff dulu.
