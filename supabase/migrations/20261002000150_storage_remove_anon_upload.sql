-- ══════════════════════════════════════════════════════════════
-- Menutup unggahan anonim ke bucket publik product-assets
-- Kunci anon Supabase tertulis di repo publik, sehingga siapa pun tanpa login
-- dapat mengunggah berkas (hingga 5 MB per berkas) ke bucket publik ini.
--
-- SEBELUM menjalankan: pastikan tidak ada workflow n8n atau skrip yang mengunggah
-- ke product-assets memakai kunci ANON. Unggahan staff yang sudah login tetap berjalan
-- (policy "authenticated upload product-assets" tidak diubah).
-- ══════════════════════════════════════════════════════════════
drop policy if exists "Allow anon uploads to product-assets" on storage.objects;
