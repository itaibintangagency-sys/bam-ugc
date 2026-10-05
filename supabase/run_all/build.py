#!/usr/bin/env python3
"""Menyusun ulang 20261002_JALANKAN_SEMUA.sql dari berkas migrasi sumber.
Jalankan: python3 supabase/run_all/build.py   (setiap kali migrasi 0100/0200/0300/0400 berubah)"""
import os
here = os.path.dirname(os.path.abspath(__file__))
mig = os.path.join(here, '..', 'migrations')
parts = ['20261002000100_fix_legacy_rls_grants.sql', '20261002000200_ugc_v2.sql',
         '20261002000300_ugc_character_voice.sql', '20261002000400_hardening.sql']
bar = '-- ' + '█' * 60
head = """-- ══════════════════════════════════════════════════════════════
-- BA UGC v2 — JALANKAN SEMUA (urutan sudah benar)
-- Gabungan: 0100 perbaikan RLS tabel lama → 0200 sistem v2 → 0300 tahap karakter dan suara → 0400 penguatan keamanan.
-- Aman diulang, dan aman dijalankan walau sebagian sudah pernah dijalankan.
-- TIDAK termasuk 20261002000150_storage_remove_anon_upload.sql (jalankan terpisah setelah
-- memastikan tidak ada workflow n8n yang mengunggah ke product-assets memakai kunci anon).
-- Berkas baseline_legacy (folder supabase/baseline) TIDAK boleh dijalankan di produksi.
-- ══════════════════════════════════════════════════════════════
"""
out = [head]
for f in parts:
    src = open(os.path.join(mig, f), encoding='utf-8').read().strip()
    out.append(f"\n{bar}\n-- BAGIAN: {f}\n{bar}\n\n{src}\n")
open(os.path.join(here, '20261002_JALANKAN_SEMUA.sql'), 'w', encoding='utf-8').write("".join(out))
print('dibuat:', sum(len(x) for x in out), 'karakter dari', len(parts), 'bagian')
