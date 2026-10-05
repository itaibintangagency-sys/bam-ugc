# Catatan paket siap-push (5 Okt 2026)

Isi = salinan GitHub (bam-ugc, cabang main) + file yang hanya ada di folder lokal C:\bam-ugc-v2 + migrasi 0720 (Opsi B).

Aturan gabung: core/, agent/, tools/ memakai versi LOKAL (superset); db/test, db/package.json, supabase/ memakai versi GITHUB.
Perubahan di atas itu: migrasi 20261005000720_risiko_klaim_kesehatan.sql, tes db/test/risiko-klaim.test.mjs,
tiga tes 0710 di gerbang.test.mjs dibatasi ke kondisi sampai 0710, satu baris README Supabase, dan dua baris .gitignore
(agent/recon/ dan tools/uji-gambar/hasil/).

Tidak ikut: node_modules, .env, log agent, agent/recon (tangkapan layar Flow), tools/uji-gambar/hasil, folder .git.

Hasil uji pada pohon ini (Postgres tiruan PGlite; belum diuji di Supabase asli atau Flow asli):
- core 55/55, tools/uji-gambar 16/16
- db: online 14/14, gerbang 12/12, risiko-klaim 6/6, characters 11/11, chain 1/1, roundtrip 1/1, verify 3/3, urutan 4/4, hardening 8/8
- agent: tidak dijalankan (butuh Chrome)

Masih berlaku: js/data.js memuat nilai literal BAUGC_SHARED_SECRET (ganti di n8n dan hapus dari kode);
migrasi 0720 baru dijalankan di Supabase SESUDAH push.
