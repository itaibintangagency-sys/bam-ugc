-- ═══════════════════════════════════════════════════════════════════════
-- 20261005000720 — Risiko tinggi untuk kategori klaim kesehatan (Opsi B, keputusan pemilik 5 Okt 2026)
-- Jalankan SETELAH 0710. Aman diulang.
--
-- 0710 menaikkan 5 kategori bayi (ANAK + KLAIM_KESEHATAN). Berkas ini menambah 9 kategori yang berisiko karena klaim
-- kesehatan pada isi video (janji hasil, manfaat medis), sehingga butuh persetujuan admin per job (ugc_approve_risk)
-- sebelum masuk antrean:
--   A-05 perawatan topikal : Treatment Jerawat, Sunscreen Wajah, Sun Care, Perawatan Mulut, Hand Sanitizer
--   A-10 gadget            : Timbangan dan Alat Ukur Kadar Lemak, Alat Pijat dan Terapi
--   A-06 aromaterapi       : Minyak Esensial
--   A-11 peralatan elektrik: Purifier dan Humidifier
-- Hasil: 14 kategori dinaikkan lewat override; kategori berisiko tinggi efektif = 10 (arketipe A-07 dan A-15) + 14 = 24.
--
-- SENGAJA TIDAK DINAIKKAN: 19 kategori yang hanya berisiko ANAK (pakaian anak, mainan, perlengkapan makan/mandi/travelling
-- bayi, perlak, jam tangan anak, set pakaian keluarga). Penjagaannya struktural (arketipe A-09 tanpa karakter anak dan
-- lokasi S-09 tanpa anak). Bila uji di Flow menunjukkan anak muncul di video, naikkan juga ke tinggi.
--
-- Mencabut: update ugc_category_map set risiko_override = null where category_key in (<9 kunci di bawah>);
-- ═══════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('public.ugc_category_map') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ugc_category_map' and column_name = 'risiko_override') then
    raise exception 'URUTAN SALAH: jalankan 0710 lebih dulu.' using errcode = 'P0001';
  end if;
end $$;

do $$
declare v_n int; v_total int;
begin
  update public.ugc_category_map set risiko_override = 'tinggi'
   where category_key in (
    ('Elektronik > Peralatan Listrik Kecil > Purifier & Humidifier'),
    ('Kesehatan > Perawatan Diri > Perawatan Mulut'),
    ('Kesehatan > Obat-obatan & Alat Kesehatan > Timbangan & Alat Ukur Kadar Lemak'),
    ('Kesehatan > Perawatan Diri > Alat Pijat & Terapi'),
    ('Kesehatan > Perawatan Diri > Hand Sanitizer'),
    ('Perawatan & Kecantikan > Perawatan Wajah > Treatment Jerawat'),
    ('Perawatan & Kecantikan > Perawatan Wajah > Sunscreen Wajah'),
    ('Perawatan & Kecantikan > Perawatan Tubuh > Sun Care'),
    ('Perlengkapan Rumah > Pengharum Ruangan & Aromaterapi > Minyak Esensial')
  );
  get diagnostics v_n = row_count;
  if v_n <> 9 then
    raise exception 'diharapkan 9 kategori, yang cocok: %. Pemetaan kategori berbeda dari yang diperkirakan; hentikan dan periksa.', v_n using errcode = 'P0001';
  end if;
  select count(*) into v_total from public.ugc_category_map where risiko_override = 'tinggi';
  if v_total <> 14 then
    raise exception 'diharapkan total 14 kategori berisiko tinggi lewat override (5 dari 0710 dan 9 dari berkas ini), ditemukan %', v_total using errcode = 'P0001';
  end if;
end $$;
