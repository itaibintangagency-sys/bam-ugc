-- ═══════════════════════════════════════════════════════════════════════
-- 20261005000710 — Risiko tingkat kategori (OPSIONAL tetapi disarankan)
-- Jalankan SETELAH 0600 dan 0700. Aman diulang.
--
-- Kebijakan: 5 kategori produk bayi yang menggabungkan isyarat ANAK dan KLAIM_KESEHATAN dinaikkan ke risiko "tinggi",
-- walaupun arketipenya (A-09) berisiko "sedang". Akibatnya produk dari kategori itu butuh persetujuan admin per job
-- (ugc_approve_risk) sebelum masuk antrean. Kategori lain TIDAK berubah.
-- Tidak menjalankan berkas ini = 5 kategori itu tetap mengikuti risiko arketipenya.
--
-- Perubahan:
--  1. ugc_category_map.risiko_override (kosong = ikuti arketipe).
--  2. Trigger ugc_products_apply_category: lantai risiko memperhitungkan override; untuk UPDATE oleh staf, risiko lama tidak
--     boleh diturunkan (menutup jalan memutar: mengganti kategori lalu menurunkan risiko).
--
-- Mencabut kebijakan ini: update ugc_category_map set risiko_override = null where risiko_override is not null;
-- ═══════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('public.ugc_category_map') is null or to_regprocedure('ugc_arch_rank(text)') is null then
    raise exception 'URUTAN SALAH: jalankan 0600 lebih dulu.' using errcode = 'P0001';
  end if;
  if to_regprocedure('ugc_approve_risk(uuid, text)') is null then
    raise exception 'URUTAN SALAH: jalankan 0700 lebih dulu (gerbang persetujuan admin).' using errcode = 'P0001';
  end if;
end $$;

alter table public.ugc_category_map add column if not exists risiko_override text;
alter table public.ugc_category_map drop constraint if exists ugc_category_map_risiko_override_check;
alter table public.ugc_category_map add constraint ugc_category_map_risiko_override_check
  check (risiko_override is null or risiko_override in ('sedang', 'tinggi'));

do $$
declare v_n int;
begin
  update public.ugc_category_map set risiko_override = 'tinggi'
   where category_key in (
  ('Ibu & Bayi > Kesehatan Bayi > Perawatan Mulut Bayi'),
  ('Ibu & Bayi > Kesehatan Bayi > Perawatan Kulit Bayi'),
  ('Ibu & Bayi > Susu Formula & Makanan Bayi > Camilan Bayi'),
  ('Ibu & Bayi > Susu Formula & Makanan Bayi > Susu Formula & Makanan Bayi Lainnya'),
  ('Ibu & Bayi > Kesehatan Bayi > Sun Care Bayi'));
  get diagnostics v_n = row_count;
  if v_n <> 5 then
    raise exception 'diharapkan 5 kategori, yang cocok: %. Pemetaan kategori berbeda dari yang diperkirakan; hentikan dan periksa.', v_n using errcode = 'P0001';
  end if;
end $$;

create or replace function public.ugc_products_apply_category() returns trigger
language plpgsql set search_path = public as $$
declare
  c       public.ugc_category_map;
  v_priv  boolean;
  v_floor int := 0;
  v_cat   boolean := false;
begin
  v_priv := coalesce(current_setting('ugc.bypass', true), '') = '1'
            or auth.uid() is null
            or coalesce(ugc_role(), '') = 'admin';

  if tg_op = 'UPDATE' and old.category_key is not null and new.category_key is null and not v_priv then
    raise exception 'kategori produk tidak boleh dikosongkan; minta admin' using errcode = '42501';
  end if;

  if new.category_key is not null then
    select * into c from public.ugc_category_map where category_key = new.category_key;
    v_cat := found;
    if v_cat then
      if tg_op = 'INSERT' then
        new.archetype_id := coalesce(new.archetype_id, c.archetype_id);
      elsif new.category_key is distinct from old.category_key
            and new.archetype_id is not distinct from old.archetype_id then
        new.archetype_id := c.archetype_id;
      end if;
      v_floor := greatest(v_floor, ugc_arch_rank(c.archetype_id), ugc_risk_rank(c.risiko_override));
    end if;
  end if;

  -- Gerbang persetujuan manusia membaca arketipe berisiko tinggi (A-07, A-15) lewat panel_plan.
  -- Staff tidak boleh menurunkan produk dari/ke bawah arketipe tinggi; admin boleh.
  if not v_priv and new.archetype_id is not null and ugc_arch_rank(new.archetype_id) < 3 then
    if (v_cat and ugc_arch_rank(c.archetype_id) = 3)
       or (tg_op = 'UPDATE' and ugc_arch_rank(old.archetype_id) = 3
           and new.archetype_id is distinct from old.archetype_id) then
      raise exception 'arketipe berisiko tinggi tidak boleh diturunkan oleh staff; minta admin'
        using errcode = '42501';
    end if;
  end if;

  v_floor := greatest(v_floor, ugc_arch_rank(new.archetype_id));
  if tg_op = 'UPDATE' then
    v_floor := greatest(v_floor, ugc_arch_rank(old.archetype_id));
    if not v_priv then v_floor := greatest(v_floor, ugc_risk_rank(old.risk_level)); end if;
  end if;

  if v_floor > 0 then
    if v_priv then
      new.risk_level := coalesce(new.risk_level,
        case v_floor when 3 then 'tinggi' when 2 then 'sedang' else 'rendah' end);
    elsif new.risk_level is null or ugc_risk_rank(new.risk_level) < v_floor then
      new.risk_level := case v_floor when 3 then 'tinggi' when 2 then 'sedang' else 'rendah' end;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.ugc_products_apply_category() from public, anon, authenticated;
