-- ═══════════════════════════════════════════════════════════════════════
-- 20261006000810 — Analisis foto produk oleh AI: riwayat dan biaya di tabel yang sama, batas harian terpisah, nama produk di laporan
-- Jalankan SETELAH 20261006000800. Aman diulang. Bila 0800 diulang SETELAH berkas ini, jalankan berkas ini sekali lagi
-- (0800 membuat ulang ugc_image_runs_list tanpa kolom nama_produk).
--
-- Edge Function `analyze-product` mencatat satu baris per analisis di ugc_image_runs (siapa, kapan, model, biaya, kurs), sehingga
-- laporan biaya admin otomatis mencakup analisis. Batas harian analisis TERPISAH dari batas gambar (tiap jenis hitungannya sendiri).
-- Perubahan perilaku yang disengaja: ugc_image_count_today kini hanya menghitung jenis gambar, supaya baris analisis tidak memakan jatah gambar.
-- ═══════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regclass('public.ugc_image_runs') is null or to_regclass('public.ugc_products') is null then
    raise exception 'URUTAN SALAH: jalankan 20261006000800_generate_gambar.sql lebih dulu.';
  end if;
end $$;

-- ── 1. Perluas ugc_image_runs ─────────────────────────────────
alter table ugc_image_runs drop constraint if exists ugc_image_runs_kind_check;
alter table ugc_image_runs add constraint ugc_image_runs_kind_check
  check (kind in ('wajah_dna', 'wajah_acuan', 'lembar_sudut', 'storyboard', 'analisis_produk', 'saran_kategori'));
alter table ugc_image_runs drop constraint if exists ugc_image_runs_quality_check;
alter table ugc_image_runs add constraint ugc_image_runs_quality_check check (quality in ('low', 'medium', 'high', 'na'));   -- na = tidak berlaku (analisis)
alter table ugc_image_runs add column if not exists product_id uuid references ugc_products (id) on delete set null;
create index if not exists ugc_image_runs_product_idx on ugc_image_runs (product_id);

-- ── 2. Pengaturan bawaan ──────────────────────────────────────
insert into ugc_settings (key, value, note) values
  ('analisis_model',             '"google/gemini-2.5-flash"'::jsonb, 'Model OpenRouter untuk analisis foto produk (harus mendukung masukan gambar)'),
  ('analisis_limit_harian_staf', '30'::jsonb,                        'Maksimal analisis foto produk per staf per hari (admin tanpa batas)')
on conflict (key) do nothing;

-- ── 3. Hitungan harian per jenis (hanya service_role) ─────────
create or replace function ugc_run_count_today(p_user uuid, p_kinds text[]) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from ugc_image_runs r
  where r.created_by = p_user and r.kind = any (p_kinds)
    and (r.status = 'ok' or (r.status = 'running' and r.created_at > now() - interval '10 minutes'))
    and (r.created_at at time zone coalesce((select value #>> '{}' from ugc_settings where key = 'timezone'), 'Asia/Jakarta'))::date
        = (now() at time zone coalesce((select value #>> '{}' from ugc_settings where key = 'timezone'), 'Asia/Jakarta'))::date
$$;
revoke execute on function ugc_run_count_today(uuid, text[]) from public, anon, authenticated;
do $$ begin   -- service_role selalu ada di Supabase; pemeriksaan ini hanya agar berkas tetap bisa dijalankan di Postgres biasa
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function ugc_run_count_today(uuid, text[]) to service_role';
  end if;
end $$;

-- Hitungan gambar: hanya jenis gambar (tanda tangan sama dengan sebelumnya, jadi ugc_image_reserve tidak berubah).
create or replace function ugc_image_count_today(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select ugc_run_count_today(p_user, array['wajah_dna', 'wajah_acuan', 'lembar_sudut', 'storyboard'])
$$;
revoke execute on function ugc_image_count_today(uuid) from public, anon, authenticated;
do $$ begin   -- service_role selalu ada di Supabase; pemeriksaan ini hanya agar berkas tetap bisa dijalankan di Postgres biasa
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function ugc_image_count_today(uuid) to service_role';
  end if;
end $$;

-- ── 4. Memesan jatah analisis (atomik, kunci per pengguna) ────
-- Hasil: 'ok' atau 'batas'. p_limit kosong = tanpa batas (admin). Setiap analisis punya batch sendiri.
create or replace function ugc_analysis_reserve(p_id uuid, p_user uuid, p_product uuid, p_model text, p_limit int) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('ugc_analysis_reserve:' || p_user::text, 0));
  if p_limit is not null and ugc_run_count_today(p_user, array['analisis_produk']) >= p_limit then return 'batas'; end if;
  insert into ugc_image_runs (id, batch_id, seq, created_by, kind, model, quality, product_id)
  values (p_id, gen_random_uuid(), 1, p_user, 'analisis_produk', p_model, 'na', p_product);
  return 'ok';
end $$;
revoke execute on function ugc_analysis_reserve(uuid, uuid, uuid, text, int) from public, anon, authenticated;
do $$ begin   -- service_role selalu ada di Supabase; pemeriksaan ini hanya agar berkas tetap bisa dijalankan di Postgres biasa
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function ugc_analysis_reserve(uuid, uuid, uuid, text, int) to service_role';
  end if;
end $$;

-- ── 5. Laporan admin: tambah nama produk ──────────────────────
drop function if exists ugc_image_runs_list(timestamptz, timestamptz, uuid, text, int, int);
create function ugc_image_runs_list(
  p_from timestamptz, p_to timestamptz, p_user uuid default null, p_kind text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, waktu timestamptz, uid uuid, nama text, jenis text, kode_karakter text, nama_produk text, model text, kualitas text,
               status text, galat text, durasi_ms int, usd numeric, kurs numeric, idr numeric, hubungan text, dipilih boolean, total bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not ugc_is_admin() then raise exception 'Riwayat generate khusus admin' using errcode = '42501'; end if;
  return query
  select r.id, r.created_at, r.created_by, coalesce(p.name, p.email, r.created_by::text), r.kind, c.code, pr.name, r.model, r.quality,
         case when r.status = 'running' and r.created_at < now() - interval '10 minutes' then 'gagal' else r.status end,
         case when r.status = 'running' and r.created_at < now() - interval '10 minutes' then 'Tidak selesai (fungsi berhenti di tengah jalan)' else r.error end,
         r.duration_ms, r.cost_usd, r.kurs_idr, r.cost_idr, r.relation, r.chosen, count(*) over ()
  from ugc_image_runs r
  left join user_profiles p on p.id = r.created_by
  left join ugc_characters c on c.id = r.character_id
  left join ugc_products pr on pr.id = r.product_id
  where r.created_at >= p_from and r.created_at < p_to
    and (p_user is null or r.created_by = p_user)
    and (p_kind is null or r.kind = p_kind)
  order by r.created_at desc, r.seq
  limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0));
end $$;
revoke execute on function ugc_image_runs_list(timestamptz, timestamptz, uuid, text, int, int) from public, anon;
grant execute on function ugc_image_runs_list(timestamptz, timestamptz, uuid, text, int, int) to authenticated;

-- ── 6. Ringkasan biaya: jumlahkan biaya yang tercatat apa pun statusnya ──
-- Jawaban AI yang sudah ditagih tetapi tidak terbaca (status gagal) tetap memiliki biaya. Gambar yang gagal sebelum ditagih tidak punya biaya,
-- jadi aman. Kolom gambar tetap hanya menghitung yang berhasil. Tanda tangan sama dengan 0800, jadi cukup create or replace.
create or replace function ugc_image_cost_summary(p_from timestamptz, p_to timestamptz)
returns table (uid uuid, nama text, gambar bigint, gagal bigint, usd numeric, idr numeric, tanpa_biaya bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ugc_is_admin() then raise exception 'Laporan biaya khusus admin' using errcode = '42501'; end if;
  return query
  select r.created_by,
         coalesce(p.name, p.email, r.created_by::text),
         count(*) filter (where r.status = 'ok'),
         count(*) filter (where r.status = 'gagal' or (r.status = 'running' and r.created_at < now() - interval '10 minutes')),
         coalesce(sum(r.cost_usd), 0),
         coalesce(sum(r.cost_idr), 0),
         count(*) filter (where r.status = 'ok' and (r.cost_usd is null or r.cost_idr is null))
  from ugc_image_runs r left join user_profiles p on p.id = r.created_by
  where r.created_at >= p_from and r.created_at < p_to
  group by r.created_by, p.name, p.email
  order by 6 desc, 3 desc;
end $$;
