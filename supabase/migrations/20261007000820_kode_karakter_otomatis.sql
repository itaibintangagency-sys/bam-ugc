-- ═══════════════════════════════════════════════════════════════════════
-- 20261007000820 — Kode karakter dibuat otomatis: nomor urut + turunan kunci utama, mis. C04-3F9A12BC
-- Jalankan SETELAH 20261006000810. Aman diulang. Tidak mengubah kode karakter yang sudah ada.
--
-- Aturan: bila kode KOSONG saat karakter dibuat, database mengisinya: 'C' + nomor urut + '-' + 8 karakter pertama dari id (kunci utama).
--   * Nomor urut = nomor tertinggi yang ada + 1 (kode lama seperti C02_THE_SOFT_GIRL ikut dihitung; dua digit minimum, tidak dipotong).
--   * Penghitungan memakai kunci per transaksi, jadi dua karakter yang disimpan bersamaan tidak mendapat nomor yang sama.
--   * Bagian dari id membuat kode tetap unik walau nomor kebetulan sama, dan bisa dilacak balik ke barisnya.
--   * Bila kode DIISI (mis. alat di laptop produksi yang memakai nama folder ruang), kode itu dipakai apa adanya.
-- Website tidak lagi meminta kode. Batas panjang dan karakter yang diizinkan website (huruf, angka, _ dan -, maksimal 40) tetap terpenuhi.
-- ═══════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regclass('public.ugc_characters') is null then
    raise exception 'URUTAN SALAH: jalankan migrasi sebelumnya lebih dulu (tabel ugc_characters belum ada).';
  end if;
end $$;

-- security definer: nomor harus dihitung dari SEMUA karakter, bukan hanya yang boleh dilihat pemanggil (RLS).
create or replace function ugc_characters_auto_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_n bigint;
begin
  if new.code is not null and btrim(new.code) <> '' then new.code := btrim(new.code); return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('ugc_characters_auto_code', 0));
  select coalesce(max((substring(code from '(?i)^C([0-9]{1,9})(?:[^0-9]|$)'))::bigint), 0) + 1 into v_n from ugc_characters;
  new.code := 'C' || case when v_n < 10 then '0' || v_n::text else v_n::text end || '-' || upper(substr(replace(new.id::text, '-', ''), 1, 8));
  return new;
end $$;
revoke execute on function ugc_characters_auto_code() from public, anon, authenticated;

drop trigger if exists ugc_characters_auto_code on ugc_characters;
create trigger ugc_characters_auto_code before insert on ugc_characters
  for each row execute function ugc_characters_auto_code();
