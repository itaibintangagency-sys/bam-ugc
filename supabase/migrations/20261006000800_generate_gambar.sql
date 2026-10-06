-- ═══════════════════════════════════════════════════════════════════════
-- 20261006000800 — Generate gambar lewat website: riwayat (siapa, kapan, apa, biaya), batas pemakaian, laporan khusus admin
-- Jalankan SETELAH 0720. Aman diulang. Tidak mengubah tabel lama.
--
-- Cara kerja: browser memanggil Edge Function `generate-image`. Fungsi itu memegang kunci OpenRouter (secret di Supabase, tidak pernah
-- di browser), memeriksa login dan batas, memanggil OpenRouter, lalu mencatat SATU BARIS per gambar di ugc_image_runs
-- (biaya dari respons OpenRouter, kurs IDR saat itu). Browser TIDAK bisa menulis tabel ini sama sekali; hanya service_role
-- (Edge Function) dan fungsi di bawah.
--
-- Hak baca: ADMIN SAJA (keputusan pemilik). Staf tetap melihat gambar hasil generate miliknya lewat respons fungsi dan penyimpanan.
--
-- Kurs: Edge Function menyimpan kurs otomatis di ugc_settings.kurs_usd_idr (JSON: rate, date, source, fetched_at).
-- Kurs MANUAL (opsional, menimpa otomatis) — isi bila ingin kurs sendiri:
--   insert into ugc_settings (key, value, note) values ('kurs_usd_idr_manual', '16500'::jsonb, 'Rupiah per 1 USD, menimpa kurs otomatis')
--   on conflict (key) do update set value = excluded.value, updated_at = now();
-- Hapus baris itu untuk kembali ke kurs otomatis.
-- ═══════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regclass('public.ugc_characters') is null or to_regclass('public.ugc_settings') is null then
    raise exception 'URUTAN SALAH: jalankan migrasi sebelumnya (sampai 20261005000720) lebih dulu.';
  end if;
end $$;

-- ── 1. Riwayat generate ───────────────────────────────────────
create table if not exists ugc_image_runs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,                        -- satu klik "Buat gambar" = satu kelompok
  seq int not null default 1 check (seq between 1 and 8),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  kind text not null check (kind in ('wajah_dna', 'wajah_acuan', 'lembar_sudut', 'storyboard')),
  character_id uuid references ugc_characters (id) on delete set null,
  chosen boolean not null default false,         -- gambar yang dipilih menjadi foto karakter
  model text not null,
  quality text not null check (quality in ('low', 'medium', 'high')),
  aspect_ratio text,
  relation text,                                 -- hubungan (hanya untuk foto acuan)
  status text not null default 'running' check (status in ('running', 'ok', 'gagal')),
  error text,
  duration_ms int,
  cost_usd numeric(12, 6),                       -- dari respons OpenRouter; kosong bila server tidak melaporkan
  kurs_idr numeric(14, 2),                       -- Rupiah per 1 USD saat gambar dibuat
  kurs_sumber text,
  cost_idr numeric(16, 2),
  image_path text,                               -- bucket ugc-characters
  ref_path text,                                 -- foto acuan (bucket ugc-characters)
  dna jsonb,
  note text
);
create index if not exists ugc_image_runs_created_idx on ugc_image_runs (created_at desc);
create index if not exists ugc_image_runs_user_idx on ugc_image_runs (created_by, created_at desc);
create index if not exists ugc_image_runs_batch_idx on ugc_image_runs (batch_id);
create unique index if not exists ugc_image_runs_batch_seq_uq on ugc_image_runs (batch_id, seq);   -- satu nomor per kelompok: permintaan ulang yang sama ditolak
create index if not exists ugc_image_runs_char_idx on ugc_image_runs (character_id);

alter table ugc_image_runs enable row level security;
drop policy if exists ugc_image_runs_admin_read on ugc_image_runs;
create policy ugc_image_runs_admin_read on ugc_image_runs for select to authenticated using (ugc_is_admin());
-- Sengaja TIDAK ada policy insert, update, atau delete: browser tidak boleh menulis riwayat biaya.
revoke all on ugc_image_runs from anon, authenticated;
grant select on ugc_image_runs to authenticated;

-- ── 2. Pengaturan bawaan (admin boleh mengubah di ugc_settings) ──
insert into ugc_settings (key, value, note) values
  ('gen_max_per_click',     '4'::jsonb,                  'Maksimal gambar per klik Buat gambar'),
  ('gen_daily_limit_staff', '20'::jsonb,                 'Maksimal gambar per staf per hari (admin tanpa batas)'),
  ('gen_model',             '"openai/gpt-image-2"'::jsonb, 'Model gambar OpenRouter')
on conflict (key) do nothing;

-- ── 3. Hitungan harian (hanya service_role, dipanggil Edge Function) ──
-- "Hari" mengikuti ugc_settings.timezone. Baris running yang lebih dari 10 menit dianggap gagal (fungsi mati di tengah jalan).
create or replace function ugc_image_count_today(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from ugc_image_runs r
  where r.created_by = p_user
    and (r.status = 'ok' or (r.status = 'running' and r.created_at > now() - interval '10 minutes'))
    and (r.created_at at time zone coalesce((select value #>> '{}' from ugc_settings where key = 'timezone'), 'Asia/Jakarta'))::date
        = (now() at time zone coalesce((select value #>> '{}' from ugc_settings where key = 'timezone'), 'Asia/Jakarta'))::date
$$;
revoke execute on function ugc_image_count_today(uuid) from public, anon, authenticated;
do $$ begin   -- service_role selalu ada di Supabase; pemeriksaan ini hanya agar berkas tetap bisa dijalankan di Postgres biasa (pengujian)
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function ugc_image_count_today(uuid) to service_role';
  end if;
end $$;

-- Memesan satu jatah gambar: memeriksa batas harian DAN menulis baris 'running' dalam satu langkah, dengan kunci per pengguna,
-- sehingga empat permintaan paralel tidak bisa sama-sama lolos melewati batas. p_limit kosong = tanpa batas (admin).
-- Hasil: 'ok', 'batas' (batas harian tercapai), atau 'duplikat' (kelompok dan nomor yang sama sudah pernah dipakai).
create or replace function ugc_image_reserve(
  p_id uuid, p_batch uuid, p_seq int, p_user uuid, p_kind text, p_model text, p_quality text, p_aspect text,
  p_relation text, p_ref text, p_dna jsonb, p_note text, p_limit int) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('ugc_image_reserve:' || p_user::text, 0));
  if p_limit is not null and ugc_image_count_today(p_user) >= p_limit then return 'batas'; end if;
  insert into ugc_image_runs (id, batch_id, seq, created_by, kind, model, quality, aspect_ratio, relation, ref_path, dna, note)
  values (p_id, p_batch, p_seq, p_user, p_kind, p_model, p_quality, p_aspect, p_relation, p_ref, p_dna, p_note);
  return 'ok';
exception when unique_violation then
  return 'duplikat';
end $$;
revoke execute on function ugc_image_reserve(uuid, uuid, int, uuid, text, text, text, text, text, text, jsonb, text, int) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function ugc_image_reserve(uuid, uuid, int, uuid, text, text, text, text, text, text, jsonb, text, int) to service_role';
  end if;
end $$;

-- ── 4. Laporan khusus admin ───────────────────────────────────
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
         coalesce(sum(r.cost_usd) filter (where r.status = 'ok'), 0),
         coalesce(sum(r.cost_idr) filter (where r.status = 'ok'), 0),
         count(*) filter (where r.status = 'ok' and (r.cost_usd is null or r.cost_idr is null))
  from ugc_image_runs r left join user_profiles p on p.id = r.created_by
  where r.created_at >= p_from and r.created_at < p_to
  group by r.created_by, p.name, p.email
  order by 6 desc, 3 desc;
end $$;

create or replace function ugc_image_runs_list(
  p_from timestamptz, p_to timestamptz, p_user uuid default null, p_kind text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, waktu timestamptz, uid uuid, nama text, jenis text, kode_karakter text, model text, kualitas text,
               status text, galat text, durasi_ms int, usd numeric, kurs numeric, idr numeric, hubungan text, dipilih boolean, total bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not ugc_is_admin() then raise exception 'Riwayat generate khusus admin' using errcode = '42501'; end if;
  return query
  select r.id, r.created_at, r.created_by, coalesce(p.name, p.email, r.created_by::text), r.kind, c.code, r.model, r.quality,
         case when r.status = 'running' and r.created_at < now() - interval '10 minutes' then 'gagal' else r.status end,
         case when r.status = 'running' and r.created_at < now() - interval '10 minutes' then 'Tidak selesai (fungsi berhenti di tengah jalan)' else r.error end,
         r.duration_ms, r.cost_usd, r.kurs_idr, r.cost_idr, r.relation, r.chosen, count(*) over ()
  from ugc_image_runs r
  left join user_profiles p on p.id = r.created_by
  left join ugc_characters c on c.id = r.character_id
  where r.created_at >= p_from and r.created_at < p_to
    and (p_user is null or r.created_by = p_user)
    and (p_kind is null or r.kind = p_kind)
  order by r.created_at desc, r.seq
  limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0));
end $$;

-- ── 5. Menautkan hasil yang dipilih ke karakter (setelah karakter disimpan) ──
-- Pemilik gambar (atau admin) menautkan seluruh kelompok ke karakter; yang dipilih ditandai. Biaya kelompok ikut menjadi biaya karakter.
create or replace function ugc_image_link(p_run uuid, p_character uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r ugc_image_runs;
begin
  if ugc_role() is null then raise exception 'Perlu login' using errcode = '42501'; end if;
  select * into r from ugc_image_runs where id = p_run;
  if r.id is null then raise exception 'Riwayat generate tidak ditemukan'; end if;
  if r.created_by is distinct from auth.uid() and not ugc_is_admin() then raise exception 'Bukan gambar milik Anda' using errcode = '42501'; end if;
  if r.status <> 'ok' then raise exception 'Hanya gambar yang berhasil yang bisa dipilih'; end if;
  if not exists (select 1 from ugc_characters where id = p_character) then raise exception 'Karakter tidak ditemukan'; end if;
  update ugc_image_runs set character_id = p_character, chosen = (id = p_run)
   where batch_id = r.batch_id and created_by = r.created_by;
end $$;

revoke execute on function ugc_image_cost_summary(timestamptz, timestamptz), ugc_image_runs_list(timestamptz, timestamptz, uuid, text, int, int),
  ugc_image_link(uuid, uuid) from public, anon;
grant execute on function ugc_image_cost_summary(timestamptz, timestamptz), ugc_image_runs_list(timestamptz, timestamptz, uuid, text, int, int),
  ugc_image_link(uuid, uuid) to authenticated;
