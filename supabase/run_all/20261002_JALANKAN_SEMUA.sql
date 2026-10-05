-- ══════════════════════════════════════════════════════════════
-- BA UGC v2 — JALANKAN SEMUA (urutan sudah benar)
-- Gabungan: 0100 perbaikan RLS tabel lama → 0200 sistem v2 → 0300 tahap karakter dan suara → 0400 penguatan keamanan.
-- Aman diulang, dan aman dijalankan walau sebagian sudah pernah dijalankan.
-- TIDAK termasuk 20261002000150_storage_remove_anon_upload.sql (jalankan terpisah setelah
-- memastikan tidak ada workflow n8n yang mengunggah ke product-assets memakai kunci anon).
-- Berkas baseline_legacy (folder supabase/baseline) TIDAK boleh dijalankan di produksi.
-- ══════════════════════════════════════════════════════════════

-- ████████████████████████████████████████████████████████████
-- BAGIAN: 20261002000100_fix_legacy_rls_grants.sql
-- ████████████████████████████████████████████████████████████

-- ══════════════════════════════════════════════════════════════
-- Perbaikan celah keamanan pada tabel lama (ditemukan dari ekspor 2026-10-02)
-- Aman dijalankan. Tidak mengubah perilaku yang SUDAH berjalan:
--  - backend n8n memakai service_role, yang tidak terkena RLS;
--  - hak akses tabel yang sebenarnya dipakai tetap sama.
-- Aman diulang (idempotent).
-- ══════════════════════════════════════════════════════════════

-- 1) RLS pada tabel yang belum terlindungi.
--    backgrounds: tanpa policy = tertutup untuk anon/authenticated (kondisi efektif sekarang
--    sudah begitu karena tidak ada hak SELECT; ini hanya menguncinya secara resmi).
alter table public.backgrounds enable row level security;

--    frames: SEBELUMNYA semua staff yang login bisa membaca/mengubah/menghapus frame milik siapa pun.
--    Sekarang mengikuti kepemilikan video_jobs (sama seperti aturan video_jobs).
alter table public.frames enable row level security;
drop policy if exists "own or admin frames" on public.frames;
create policy "own or admin frames" on public.frames
  for all to authenticated
  using (exists (select 1 from public.video_jobs j where j.id = frames.video_job_id and (j.created_by = auth.uid() or public.is_admin())))
  with check (exists (select 1 from public.video_jobs j where j.id = frames.video_job_id and (j.created_by = auth.uid() or public.is_admin())));

--    products: hak akses tabel sudah hanya SELECT untuk staff; RLS dikunci dengan policy baca saja.
alter table public.products enable row level security;
drop policy if exists "authenticated read products" on public.products;
create policy "authenticated read products" on public.products for select to authenticated using (true);

-- 2) Cabut hak berlebih. TRUNCATE tidak tunduk pada RLS; REFERENCES dan TRIGGER tidak diperlukan.
--    (Hak ini tidak terbuka lewat API REST, tetapi prinsip hak minimum tetap perlu.)
revoke truncate, references, trigger on public.backgrounds, public.character_photos, public.characters,
  public.frames, public.products, public.user_profiles, public.video_jobs from anon, authenticated;

-- 3) Fungsi security definer wajib mengunci search_path.
alter function public.is_admin() set search_path = public;
alter function public.update_updated_at() set search_path = public;

-- 4) Indeks untuk kunci asing dan kolom kepemilikan (dipakai policy dan relasi).
create index if not exists character_photos_character_id_idx on public.character_photos (character_id);
create index if not exists frames_video_job_id_idx on public.frames (video_job_id);
create index if not exists frames_background_id_idx on public.frames (background_id);
create index if not exists video_jobs_created_by_idx on public.video_jobs (created_by);
create index if not exists video_jobs_character_id_idx on public.video_jobs (character_id);
create index if not exists video_jobs_product_id_idx on public.video_jobs (product_id);
create index if not exists characters_created_by_idx on public.characters (created_by);

-- ████████████████████████████████████████████████████████████
-- BAGIAN: 20261002000200_ugc_v2.sql
-- ████████████████████████████████████████████████████████████

-- ══════════════════════════════════════════════════════════════
-- BA UGC v2 — skema antrean generator video (Supabase / Postgres)
-- Urutan migrasi: baseline_legacy (hanya catatan) → fix_legacy_rls_grants → storage_remove_anon_upload → ugc_v2 (berkas ini)
-- Semua objek baru berawalan ugc_ dan TIDAK mengubah tabel lama
-- (characters, products, video_jobs, frames, backgrounds) milik bot lama.
-- Satu-satunya perubahan pada objek lama: kolom role di user_profiles
-- boleh bernilai 'agent' (akun laptop produksi).
-- Jalankan sekali di Supabase SQL Editor. Aman diulang (idempotent).
-- ══════════════════════════════════════════════════════════════

-- Pengaman: sistem v2 memakai tabel user_profiles yang sudah ada pada database lama.
do $$
begin
  if to_regclass('public.user_profiles') is null then
    raise exception 'Tabel user_profiles tidak ditemukan. Pastikan ini database BA UGC yang benar (atau bangun dulu dari supabase/baseline).';
  end if;
end $$;

-- ── 0. Role 'agent' ───────────────────────────────────────────
alter table user_profiles drop constraint if exists user_profiles_role_check;
alter table user_profiles add constraint user_profiles_role_check
  check (role in ('admin', 'staff', 'agent'));

-- Pembaca role tanpa rekursi RLS (security definer).
create or replace function ugc_role() returns text
language sql stable security definer set search_path = public as $$
  select role from user_profiles where id = auth.uid()
$$;

create or replace function ugc_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from user_profiles where id = auth.uid()), false)
$$;

-- ── 1. Pengaturan (diubah admin, bukan hardcode) ──────────────
create table if not exists ugc_settings (
  key text primary key,
  value jsonb not null,
  note text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

insert into ugc_settings (key, value, note) values
  ('max_batches_per_day',   '10'::jsonb,        'Batas batch per hari (zona waktu di bawah)'),
  ('max_jobs_per_batch',    '10'::jsonb,        'Maksimal video per batch (1 karakter, banyak produk)'),
  ('max_attempts',          '3'::jsonb,         'Percobaan per job (1 awal + 2 ulang)'),
  ('retry_backoff_minutes', '2'::jsonb,         'Jeda antar percobaan ulang (dikali nomor percobaan)'),
  ('stale_claim_minutes',   '20'::jsonb,        'Job yang tersangkut lebih lama dari ini dikembalikan ke antrean'),
  ('default_resolution',    '"720p"'::jsonb,    'Resolusi bawaan batch'),
  ('timezone',              '"Asia/Jakarta"'::jsonb, 'Zona waktu untuk hitungan harian')
on conflict (key) do nothing;

create or replace function ugc_setting_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from ugc_settings where key = p_key), p_default)
$$;

-- ── 2. Kontrol agent dan detak ────────────────────────────────
create table if not exists ugc_agent_control (
  id int primary key default 1 check (id = 1),
  paused boolean not null default false,
  reason text,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into ugc_agent_control (id) values (1) on conflict (id) do nothing;

create table if not exists ugc_agents (
  name text primary key,
  status text not null default 'online',
  version text,
  current_job_id uuid,
  info jsonb not null default '{}'::jsonb,
  last_seen timestamptz not null default now()
);

-- ── 3. Karakter ───────────────────────────────────────────────
create table if not exists ugc_characters (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- mis. C02_THE_SOFT_GIRL
  name text not null,
  gender text,
  creation_mode text not null default 'dna_first'
    check (creation_mode in ('face_first', 'dna_first', 'reference')),
  dna jsonb not null default '{}'::jsonb,    -- atribut identitas terkunci
  identity_lock text not null default 'none' check (identity_lock in ('none', 'reference', 'locked')),
  face_ref_path text,
  sheet_paths jsonb not null default '[]'::jsonb,
  flow_project_url text,                     -- satu karakter = satu project Flow
  status text not null default 'draft'
    check (status in ('draft', 'face_ready', 'dna_locked', 'sheet_ready', 'ready', 'archived')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 4. Produk ─────────────────────────────────────────────────
create table if not exists ugc_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'analyzed', 'confirmed', 'archived')),
  photos jsonb not null default '[]'::jsonb,   -- [{path, role}] maksimal 6
  profile jsonb not null default '{}'::jsonb,  -- hasil analisis AI yang dikonfirmasi staff
  archetype_id text,
  risk_level text check (risk_level in ('rendah', 'sedang', 'tinggi')),
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ugc_products_max_photos check (jsonb_array_length(photos) <= 6)
);

-- ── 5. Batch dan job ──────────────────────────────────────────
create table if not exists ugc_batches (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references ugc_characters (id),
  resolution text not null default '720p' check (resolution in ('360p', '720p')),
  duration_sec int not null default 10 check (duration_sec = 10),
  location_mode text not null default 'auto' check (location_mode in ('auto', 'fixed')),
  setting_id text,
  status text not null default 'draft'
    check (status in ('draft', 'storyboards_ready', 'approved', 'queued', 'running', 'paused', 'done', 'failed', 'canceled')),
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists ugc_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references ugc_batches (id) on delete cascade,
  product_id uuid not null references ugc_products (id),
  seq int not null check (seq between 1 and 10),
  status text not null default 'draft'
    check (status in ('draft', 'planned', 'storyboard_pending', 'storyboard_ready', 'json_ready',
                      'approved', 'queued', 'running', 'downloaded', 'done', 'failed', 'needs_human', 'canceled')),
  panel_plan jsonb,
  order_seed int,
  order_key text,
  setting_id text,
  gesture_variant text not null default 'open_palm' check (gesture_variant in ('open_palm', 'pointing_down')),
  storyboard_variant text not null default 'documented' check (storyboard_variant in ('documented', 'clean', 'none')),
  storyboard_path text,                       -- bucket ugc-storyboards, yang dilampirkan ke Flow
  storyboard_doc_path text,                   -- versi bertulis untuk dokumentasi/pratinjau staff
  video_json text,
  risk_approved_by uuid,                      -- wajib untuk kategori berisiko tinggi
  flow_asset_url text,
  video_path text,                            -- bucket ugc-videos
  credits_observed int,
  attempts int not null default 0,
  last_error text,
  error_kind text,
  not_before timestamptz,
  claimed_by text,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  qa jsonb not null default '{}'::jsonb,
  caption jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, seq),
  unique (batch_id, product_id)
);
create index if not exists ugc_jobs_queue_idx on ugc_jobs (status, not_before, created_at);

create table if not exists ugc_job_events (
  id bigserial primary key,
  job_id uuid not null references ugc_jobs (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null default 'info' check (kind in ('info', 'warn', 'error')),
  step text,
  message text,
  data jsonb,
  agent text,
  -- telemetri untuk mencari pola penolakan
  prompt_version text,
  setting_id text,
  archetype_id text,
  result text
);
create index if not exists ugc_job_events_job_idx on ugc_job_events (job_id, at);

-- Baseline tampilan Flow (untuk fitur Analisa Flow)
create table if not exists ugc_flow_snapshots (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_baseline boolean not null default false,
  items jsonb not null,
  taken_by text,
  taken_at timestamptz not null default now()
);

-- ── 6. Trigger ────────────────────────────────────────────────
create or replace function ugc_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists ugc_characters_touch on ugc_characters;
create trigger ugc_characters_touch before update on ugc_characters for each row execute function ugc_touch();
drop trigger if exists ugc_products_touch on ugc_products;
create trigger ugc_products_touch before update on ugc_products for each row execute function ugc_touch();
drop trigger if exists ugc_jobs_touch on ugc_jobs;
create trigger ugc_jobs_touch before update on ugc_jobs for each row execute function ugc_touch();

-- Batas batch per hari
create or replace function ugc_check_batch_limit() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tz text := coalesce((select value #>> '{}' from ugc_settings where key = 'timezone'), 'Asia/Jakarta');
  v_max int := ugc_setting_int('max_batches_per_day', 10);
  v_today int;
begin
  select count(*) into v_today from ugc_batches
   where status <> 'canceled'
     and (created_at at time zone v_tz)::date = (now() at time zone v_tz)::date;
  if v_today >= v_max then
    raise exception 'batch_limit_per_day: batas % batch per hari tercapai', v_max using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists ugc_batches_limit on ugc_batches;
create trigger ugc_batches_limit before insert on ugc_batches for each row execute function ugc_check_batch_limit();

-- Batas job per batch
create or replace function ugc_check_job_limit() returns trigger language plpgsql security definer set search_path = public as $$
declare v_max int := ugc_setting_int('max_jobs_per_batch', 10);
begin
  if (select count(*) from ugc_jobs where batch_id = new.batch_id) >= v_max then
    raise exception 'job_limit_per_batch: maksimal % video per batch', v_max using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists ugc_jobs_limit on ugc_jobs;
create trigger ugc_jobs_limit before insert on ugc_jobs for each row execute function ugc_check_job_limit();

-- Staff tidak boleh melompati pemeriksaan: status produksi hanya lewat fungsi.
create or replace function ugc_guard_job_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('ugc.bypass', true), '') = '1' then return new; end if;
  if coalesce(ugc_role(), '') = 'admin' then return new; end if;
  if new.status is distinct from old.status
     and new.status not in ('draft', 'planned', 'storyboard_pending', 'storyboard_ready', 'json_ready', 'approved', 'canceled') then
    raise exception 'status % hanya boleh diubah lewat fungsi sistem', new.status using errcode = '42501';
  end if;
  if new.risk_approved_by is distinct from old.risk_approved_by then
    raise exception 'persetujuan risiko hanya oleh admin' using errcode = '42501';
  end if;
  if old.status in ('running', 'downloaded', 'done') and new.video_path is distinct from old.video_path then
    raise exception 'hasil video tidak boleh diubah staff' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists ugc_jobs_guard on ugc_jobs;
create trigger ugc_jobs_guard before update on ugc_jobs for each row execute function ugc_guard_job_update();

-- Status batch mengikuti job
create or replace function ugc_rollup_batch() returns trigger language plpgsql security definer set search_path = public as $$
declare v_active int; v_running int; v_b text;
begin
  select status into v_b from ugc_batches where id = new.batch_id;
  if v_b not in ('queued', 'running') then return new; end if;
  select count(*) filter (where status in ('queued', 'running', 'needs_human')),
         count(*) filter (where status = 'running')
    into v_active, v_running from ugc_jobs where batch_id = new.batch_id;
  if v_active = 0 then
    update ugc_batches set status = 'done', finished_at = now() where id = new.batch_id;
  elsif v_running > 0 and v_b = 'queued' then
    update ugc_batches set status = 'running', started_at = coalesce(started_at, now()) where id = new.batch_id;
  end if;
  return new;
end $$;
drop trigger if exists ugc_jobs_rollup on ugc_jobs;
create trigger ugc_jobs_rollup after insert or update of status on ugc_jobs for each row execute function ugc_rollup_batch();

-- ── 7. Fungsi untuk staff ─────────────────────────────────────
-- Memasukkan batch ke antrean. Memeriksa kelengkapan dan persetujuan risiko.
create or replace function ugc_enqueue_batch(p_batch uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_char record; v_n int; v_bad int; v_risky int;
begin
  select created_by into v_owner from ugc_batches where id = p_batch;
  if v_owner is null then raise exception 'batch tidak ditemukan' using errcode = 'P0002'; end if;
  if v_owner <> auth.uid() and not ugc_is_admin() then raise exception 'bukan batch milikmu' using errcode = '42501'; end if;

  select c.* into v_char from ugc_batches b join ugc_characters c on c.id = b.character_id where b.id = p_batch;
  if v_char.flow_project_url is null or v_char.flow_project_url !~ '^https://flow\.google\.com/' then
    raise exception 'karakter belum punya alamat project Flow yang valid' using errcode = 'P0001';
  end if;

  select count(*) into v_n from ugc_jobs where batch_id = p_batch and status = 'approved';
  select count(*) into v_bad from ugc_jobs where batch_id = p_batch and status not in ('approved', 'canceled');
  if v_n = 0 then raise exception 'tidak ada job yang disetujui' using errcode = 'P0001'; end if;
  if v_bad > 0 then raise exception '% job belum disetujui', v_bad using errcode = 'P0001'; end if;
  if exists (select 1 from ugc_jobs where batch_id = p_batch and status = 'approved'
              and (storyboard_path is null or video_json is null)) then
    raise exception 'ada job tanpa storyboard atau JSON' using errcode = 'P0001';
  end if;
  select count(*) into v_risky from ugc_jobs
   where batch_id = p_batch and status = 'approved'
     and (panel_plan ->> 'needs_human_approval') = 'true' and risk_approved_by is null;
  if v_risky > 0 then raise exception '% job berisiko tinggi menunggu persetujuan admin', v_risky using errcode = 'P0001'; end if;

  perform set_config('ugc.bypass', '1', true);
  update ugc_batches set status = 'queued' where id = p_batch;
  update ugc_jobs set status = 'queued', not_before = null where batch_id = p_batch and status = 'approved';
  return v_n;
end $$;

-- Persetujuan QA hasil video oleh staff pemilik atau admin.
create or replace function ugc_review_job(p_job uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select created_by into v_owner from ugc_jobs where id = p_job;
  if v_owner is null then raise exception 'job tidak ditemukan' using errcode = 'P0002'; end if;
  if v_owner <> auth.uid() and not ugc_is_admin() then raise exception 'bukan job milikmu' using errcode = '42501'; end if;
  perform set_config('ugc.bypass', '1', true);
  update ugc_jobs
     set status = case when p_approve then 'done' else 'failed' end,
         qa = qa || jsonb_build_object('reviewed_by', auth.uid(), 'approved', p_approve, 'note', p_note, 'at', now())
   where id = p_job and status = 'downloaded';
  if not found then raise exception 'job tidak berstatus downloaded' using errcode = 'P0001'; end if;
end $$;

-- Jeda atau lanjutkan antrean (admin).
create or replace function ugc_set_pause(p_paused boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(ugc_role(), '') not in ('admin', 'agent') then raise exception 'tidak berwenang' using errcode = '42501'; end if;
  update ugc_agent_control set paused = p_paused, reason = case when p_paused then p_reason else null end,
         updated_by = coalesce(auth.uid()::text, 'system'), updated_at = now() where id = 1;
end $$;

-- ── 8. Fungsi untuk agent (laptop produksi) ───────────────────
create or replace function ugc_agent_heartbeat(p_agent text, p_info jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ctl record;
begin
  if coalesce(ugc_role(), '') not in ('agent', 'admin') then raise exception 'khusus agent' using errcode = '42501'; end if;
  insert into ugc_agents (name, status, version, info, last_seen)
  values (p_agent, coalesce(p_info ->> 'status', 'online'), p_info ->> 'version', p_info, now())
  on conflict (name) do update
    set status = coalesce(p_info ->> 'status', 'online'), version = p_info ->> 'version', info = p_info, last_seen = now();
  select paused, reason into v_ctl from ugc_agent_control where id = 1;
  return jsonb_build_object('paused', v_ctl.paused, 'reason', v_ctl.reason);
end $$;

-- Mengambil satu job dari antrean (FIFO per batch, tanpa tabrakan antar agent).
create or replace function ugc_claim_next_job(p_agent text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_job ugc_jobs; v_batch ugc_batches; v_char ugc_characters;
begin
  if coalesce(ugc_role(), '') not in ('agent', 'admin') then raise exception 'khusus agent' using errcode = '42501'; end if;
  if (select paused from ugc_agent_control where id = 1) then return null; end if;

  select j.* into v_job
    from ugc_jobs j join ugc_batches b on b.id = j.batch_id
   where j.status = 'queued' and (j.not_before is null or j.not_before <= now())
     and b.status in ('queued', 'running')
   order by b.created_at, j.seq
   limit 1
   for update of j skip locked;
  if not found then return null; end if;

  perform set_config('ugc.bypass', '1', true);
  update ugc_jobs
     set status = 'running', claimed_by = p_agent, claimed_at = now(),
         started_at = coalesce(started_at, now()), attempts = attempts + 1, last_error = null, error_kind = null
   where id = v_job.id returning * into v_job;
  select * into v_batch from ugc_batches where id = v_job.batch_id;
  select * into v_char from ugc_characters where id = v_batch.character_id;
  update ugc_agents set current_job_id = v_job.id, status = 'busy', last_seen = now() where name = p_agent;

  return jsonb_build_object(
    'job_id', v_job.id, 'batch_id', v_job.batch_id, 'seq', v_job.seq, 'attempt', v_job.attempts,
    'max_attempts', ugc_setting_int('max_attempts', 3),
    'project_url', v_char.flow_project_url, 'character_code', v_char.code,
    'resolution', v_batch.resolution, 'duration_sec', v_batch.duration_sec,
    'storyboard', jsonb_build_object('bucket', 'ugc-storyboards', 'path', v_job.storyboard_path),
    'video_json', v_job.video_json,
    'storyboard_variant', v_job.storyboard_variant,
    'setting_id', v_job.setting_id, 'gesture_variant', v_job.gesture_variant
  );
end $$;

-- Laporan kemajuan dari agent.
create or replace function ugc_job_progress(p_job uuid, p_status text, p_patch jsonb default '{}'::jsonb, p_event jsonb default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_job ugc_jobs; v_final text := p_status; v_backoff int;
begin
  if coalesce(ugc_role(), '') not in ('agent', 'admin') then raise exception 'khusus agent' using errcode = '42501'; end if;
  if p_status not in ('running', 'downloaded', 'failed', 'needs_human', 'queued') then
    raise exception 'status % tidak diizinkan untuk agent', p_status using errcode = '22023';
  end if;
  select * into v_job from ugc_jobs where id = p_job for update;
  if not found then raise exception 'job tidak ditemukan' using errcode = 'P0002'; end if;

  perform set_config('ugc.bypass', '1', true);

  if p_status = 'failed' then
    v_backoff := ugc_setting_int('retry_backoff_minutes', 2);
    if v_job.attempts < ugc_setting_int('max_attempts', 3) and coalesce(p_patch ->> 'error_kind', 'unknown') <> 'fatal' then
      v_final := 'queued';
    end if;
  end if;

  update ugc_jobs set
    status = v_final,
    video_path = coalesce(p_patch ->> 'video_path', video_path),
    flow_asset_url = coalesce(p_patch ->> 'flow_asset_url', flow_asset_url),
    credits_observed = coalesce((p_patch ->> 'credits_observed')::int, credits_observed),
    last_error = coalesce(p_patch ->> 'last_error', last_error),
    error_kind = coalesce(p_patch ->> 'error_kind', error_kind),
    not_before = case when v_final = 'queued' and p_status = 'failed'
                      then now() + make_interval(mins => v_backoff * greatest(v_job.attempts, 1)) else not_before end,
    claimed_by = case when v_final = 'running' then claimed_by else null end,
    finished_at = case when v_final in ('downloaded', 'failed') then now() else finished_at end
  where id = p_job;

  if v_final = 'needs_human' then
    update ugc_agent_control set paused = true, reason = 'job ' || p_job || ' butuh manusia: ' || coalesce(p_patch ->> 'last_error', ''),
           updated_by = 'agent', updated_at = now() where id = 1;
  end if;

  if p_event is not null then
    insert into ugc_job_events (job_id, kind, step, message, data, agent, prompt_version, setting_id, archetype_id, result)
    values (p_job, coalesce(p_event ->> 'kind', 'info'), p_event ->> 'step', p_event ->> 'message', p_event -> 'data',
            p_event ->> 'agent', p_event ->> 'prompt_version',
            coalesce(p_event ->> 'setting_id', v_job.setting_id),
            coalesce(p_event ->> 'archetype_id', v_job.panel_plan ->> 'archetype_id'),
            coalesce(p_event ->> 'result', v_final));
  end if;
  return v_final;
end $$;

-- Pencatatan peristiwa tanpa mengubah status.
create or replace function ugc_log_event(p_job uuid, p_event jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(ugc_role(), '') not in ('agent', 'admin', 'staff') then raise exception 'tidak berwenang' using errcode = '42501'; end if;
  insert into ugc_job_events (job_id, kind, step, message, data, agent, prompt_version, setting_id, archetype_id, result)
  values (p_job, coalesce(p_event ->> 'kind', 'info'), p_event ->> 'step', p_event ->> 'message', p_event -> 'data',
          p_event ->> 'agent', p_event ->> 'prompt_version', p_event ->> 'setting_id', p_event ->> 'archetype_id', p_event ->> 'result');
end $$;

-- Job 'running' yang tersangkut (agent mati) dikembalikan ke antrean.
create or replace function ugc_requeue_stale() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if coalesce(ugc_role(), '') not in ('agent', 'admin') then raise exception 'tidak berwenang' using errcode = '42501'; end if;
  perform set_config('ugc.bypass', '1', true);
  with s as (
    update ugc_jobs j set status = 'queued', claimed_by = null, last_error = 'dikembalikan: agent berhenti merespons', error_kind = 'stale'
     where j.status = 'running'
       and j.claimed_at < now() - make_interval(mins => ugc_setting_int('stale_claim_minutes', 20))
       and not exists (select 1 from ugc_agents a where a.name = j.claimed_by and a.last_seen > now() - interval '2 minutes')
    returning j.id)
  select count(*) into v_n from s;
  return v_n;
end $$;

-- ── 9. RLS ────────────────────────────────────────────────────
alter table ugc_settings enable row level security;
alter table ugc_agent_control enable row level security;
alter table ugc_agents enable row level security;
alter table ugc_characters enable row level security;
alter table ugc_products enable row level security;
alter table ugc_batches enable row level security;
alter table ugc_jobs enable row level security;
alter table ugc_job_events enable row level security;
alter table ugc_flow_snapshots enable row level security;

-- Pengaturan: semua yang login boleh baca, hanya admin menulis.
drop policy if exists ugc_settings_read on ugc_settings;
create policy ugc_settings_read on ugc_settings for select to authenticated using (ugc_role() is not null);
drop policy if exists ugc_settings_admin on ugc_settings;
create policy ugc_settings_admin on ugc_settings for all to authenticated using (ugc_is_admin()) with check (ugc_is_admin());

drop policy if exists ugc_control_read on ugc_agent_control;
create policy ugc_control_read on ugc_agent_control for select to authenticated using (ugc_role() is not null);
drop policy if exists ugc_agents_read on ugc_agents;
create policy ugc_agents_read on ugc_agents for select to authenticated using (ugc_role() is not null);

-- Karakter dan produk: pustaka bersama staff dan admin.
drop policy if exists ugc_characters_read on ugc_characters;
create policy ugc_characters_read on ugc_characters for select to authenticated using (ugc_role() in ('admin', 'staff'));
drop policy if exists ugc_characters_insert on ugc_characters;
create policy ugc_characters_insert on ugc_characters for insert to authenticated
  with check (ugc_role() in ('admin', 'staff') and created_by = auth.uid());
drop policy if exists ugc_characters_update on ugc_characters;
create policy ugc_characters_update on ugc_characters for update to authenticated
  using (created_by = auth.uid() or ugc_is_admin()) with check (created_by = auth.uid() or ugc_is_admin());
drop policy if exists ugc_characters_delete on ugc_characters;
create policy ugc_characters_delete on ugc_characters for delete to authenticated using (ugc_is_admin());

drop policy if exists ugc_products_read on ugc_products;
create policy ugc_products_read on ugc_products for select to authenticated using (ugc_role() in ('admin', 'staff'));
drop policy if exists ugc_products_insert on ugc_products;
create policy ugc_products_insert on ugc_products for insert to authenticated
  with check (ugc_role() in ('admin', 'staff') and created_by = auth.uid());
drop policy if exists ugc_products_update on ugc_products;
create policy ugc_products_update on ugc_products for update to authenticated
  using (created_by = auth.uid() or ugc_is_admin()) with check (created_by = auth.uid() or ugc_is_admin());
drop policy if exists ugc_products_delete on ugc_products;
create policy ugc_products_delete on ugc_products for delete to authenticated using (ugc_is_admin());

-- Batch dan job: staff hanya miliknya, admin semua. Agent hanya lewat fungsi.
drop policy if exists ugc_batches_read on ugc_batches;
create policy ugc_batches_read on ugc_batches for select to authenticated
  using (created_by = auth.uid() or ugc_is_admin());
drop policy if exists ugc_batches_insert on ugc_batches;
create policy ugc_batches_insert on ugc_batches for insert to authenticated
  with check (ugc_role() in ('admin', 'staff') and created_by = auth.uid());
drop policy if exists ugc_batches_update on ugc_batches;
create policy ugc_batches_update on ugc_batches for update to authenticated
  using ((created_by = auth.uid() and status in ('draft', 'storyboards_ready', 'approved')) or ugc_is_admin())
  with check ((created_by = auth.uid() and status in ('draft', 'storyboards_ready', 'approved', 'canceled')) or ugc_is_admin());
drop policy if exists ugc_batches_delete on ugc_batches;
create policy ugc_batches_delete on ugc_batches for delete to authenticated using (ugc_is_admin());

drop policy if exists ugc_jobs_read on ugc_jobs;
create policy ugc_jobs_read on ugc_jobs for select to authenticated
  using (created_by = auth.uid() or ugc_is_admin());
drop policy if exists ugc_jobs_insert on ugc_jobs;
create policy ugc_jobs_insert on ugc_jobs for insert to authenticated
  with check (ugc_role() in ('admin', 'staff') and created_by = auth.uid()
              and exists (select 1 from ugc_batches b where b.id = batch_id and (b.created_by = auth.uid() or ugc_is_admin())));
drop policy if exists ugc_jobs_update on ugc_jobs;
create policy ugc_jobs_update on ugc_jobs for update to authenticated
  using ((created_by = auth.uid() and status in ('draft', 'planned', 'storyboard_pending', 'storyboard_ready', 'json_ready', 'approved')) or ugc_is_admin())
  with check (created_by = auth.uid() or ugc_is_admin());
drop policy if exists ugc_jobs_delete on ugc_jobs;
create policy ugc_jobs_delete on ugc_jobs for delete to authenticated using (ugc_is_admin());

drop policy if exists ugc_events_read on ugc_job_events;
create policy ugc_events_read on ugc_job_events for select to authenticated
  using (exists (select 1 from ugc_jobs j where j.id = job_id and (j.created_by = auth.uid() or ugc_is_admin())));

drop policy if exists ugc_snapshots_admin on ugc_flow_snapshots;
create policy ugc_snapshots_admin on ugc_flow_snapshots for all to authenticated
  using (ugc_role() in ('admin', 'agent')) with check (ugc_role() in ('admin', 'agent'));

-- ── 10. Penyimpanan (bucket privat) ───────────────────────────
insert into storage.buckets (id, name, public) values
  ('ugc-characters', 'ugc-characters', false),
  ('ugc-products', 'ugc-products', false),
  ('ugc-storyboards', 'ugc-storyboards', false),
  ('ugc-videos', 'ugc-videos', false)
on conflict (id) do nothing;

drop policy if exists ugc_storage_read on storage.objects;
create policy ugc_storage_read on storage.objects for select to authenticated
  using (bucket_id in ('ugc-characters', 'ugc-products', 'ugc-storyboards', 'ugc-videos') and ugc_role() is not null);

drop policy if exists ugc_storage_write on storage.objects;
create policy ugc_storage_write on storage.objects for insert to authenticated
  with check (
    (bucket_id in ('ugc-characters', 'ugc-products', 'ugc-storyboards') and ugc_role() in ('staff', 'admin'))
    or (bucket_id = 'ugc-videos' and ugc_role() in ('agent', 'admin'))
  );

drop policy if exists ugc_storage_update on storage.objects;
create policy ugc_storage_update on storage.objects for update to authenticated
  using (
    (bucket_id in ('ugc-characters', 'ugc-products', 'ugc-storyboards') and ugc_role() in ('staff', 'admin'))
    or (bucket_id = 'ugc-videos' and ugc_role() in ('agent', 'admin'))
  );

drop policy if exists ugc_storage_delete on storage.objects;
create policy ugc_storage_delete on storage.objects for delete to authenticated
  using (bucket_id like 'ugc-%' and ugc_is_admin());

-- ── 11. Hak eksekusi fungsi ───────────────────────────────────
revoke all on function ugc_claim_next_job(text), ugc_job_progress(uuid, text, jsonb, jsonb),
  ugc_agent_heartbeat(text, jsonb), ugc_requeue_stale(), ugc_set_pause(boolean, text),
  ugc_enqueue_batch(uuid), ugc_review_job(uuid, boolean, text), ugc_log_event(uuid, jsonb) from public, anon;
grant execute on function ugc_claim_next_job(text), ugc_job_progress(uuid, text, jsonb, jsonb),
  ugc_agent_heartbeat(text, jsonb), ugc_requeue_stale(), ugc_set_pause(boolean, text),
  ugc_enqueue_batch(uuid), ugc_review_job(uuid, boolean, text), ugc_log_event(uuid, jsonb) to authenticated;

-- ── 11b. Hak akses tabel eksplisit (hak minimum) ───────────────
-- Database ini sebelumnya memberi anon/authenticated hak TRUNCATE/REFERENCES/TRIGGER pada tabel baru
-- lewat hak bawaan. Di sini dicabut semuanya lalu diberi hanya DML untuk authenticated;
-- RLS di atas yang menentukan baris mana yang boleh dilihat/diubah.
do $$
declare t text;
begin
  foreach t in array array['ugc_settings', 'ugc_agent_control', 'ugc_agents', 'ugc_characters', 'ugc_products',
                           'ugc_batches', 'ugc_jobs', 'ugc_job_events', 'ugc_flow_snapshots'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ── 12. Setelah menjalankan skrip ini ─────────────────────────
-- 1) Buat akun agent: Authentication → Users → Add user (email + password).
-- 2) Jadikan role 'agent':
--      insert into user_profiles (id, email, name, role)
--      values ('<uuid-akun-agent>', '<email-agent>', 'Agent Laptop', 'agent')
--      on conflict (id) do update set role = 'agent';
-- 3) Isi alamat project Flow pada karakter (kolom flow_project_url).

-- ████████████████████████████████████████████████████████████
-- BAGIAN: 20261002000300_ugc_character_voice.sql
-- ████████████████████████████████████████████████████████████

-- ══════════════════════════════════════════════════════════════
-- BA UGC v2 — tahap karakter: suara, foto, tugas agent, dan syarat "siap"
-- Jalankan SETELAH 20261002000200_ugc_v2.sql. Aman diulang.
--
-- Status karakter:
--   draft → face_ready → dna_locked → voice_defined → sheet_ready → project_ready
--         → voice_in_flow → intro_review → ready            (archived di luar alur)
-- Staff hanya boleh mengubah status sampai sheet_ready. Sisanya lewat fungsi.
-- Batch hanya bisa masuk antrean bila karakternya berstatus ready.
-- ══════════════════════════════════════════════════════════════

-- ── 0. Pemeriksaan urutan ────────────────────────────────────
-- Berkas ini butuh tabel dari 20261002000200_ugc_v2.sql. Bila belum ada, hentikan dengan pesan yang jelas.
do $$
begin
  if to_regclass('public.ugc_characters') is null or to_regclass('public.ugc_jobs') is null then
    raise exception 'URUTAN SALAH: jalankan 20261002000200_ugc_v2.sql lebih dulu (tabel ugc_characters belum ada). Atau jalankan berkas gabungan 20261002_JALANKAN_SEMUA.sql.'
      using errcode = 'P0001';
  end if;
end $$;

-- ── 1. Kolom baru pada karakter ───────────────────────────────
alter table ugc_characters
  add column if not exists voice jsonb not null default '{}'::jsonb,       -- profil suara terstruktur
  add column if not exists voice_base text,                                -- nama suara dasar di Flow (mis. Aoede)
  add column if not exists voice_shared_ok boolean not null default false, -- admin menyetujui berbagi suara dasar
  add column if not exists flow_character_name text,                       -- nama karakter di Flow (dipanggil lewat @)
  add column if not exists flow_voice_name text,                           -- nama voice kustom di Flow
  add column if not exists voice_ref_clip_path text,                       -- klip referensi 3 detik (opsional)
  add column if not exists intro_video_path text,
  add column if not exists intro_attempts int not null default 0,
  add column if not exists ready_override_reason text,
  add column if not exists ready_at timestamptz;

alter table ugc_characters drop constraint if exists ugc_characters_status_check;
alter table ugc_characters add constraint ugc_characters_status_check
  check (status in ('draft', 'face_ready', 'dna_locked', 'voice_defined', 'sheet_ready', 'project_ready',
                    'voice_in_flow', 'intro_review', 'ready', 'archived'));

alter table ugc_characters drop constraint if exists ugc_characters_flow_name_check;
alter table ugc_characters add constraint ugc_characters_flow_name_check
  check (flow_character_name is null or (flow_character_name ~ '^[^\[\]@]{1,40}$'));

-- Satu karakter satu suara dasar, kecuali admin menyetujui berbagi.
create unique index if not exists ugc_characters_voice_base_uq
  on ugc_characters (lower(voice_base))
  where voice_base is not null and voice_shared_ok = false and status <> 'archived';

-- ── 2. Foto karakter ──────────────────────────────────────────
create table if not exists ugc_character_photos (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references ugc_characters (id) on delete cascade,
  angle text not null check (angle in ('face_front', 'face_left', 'face_right', 'half_front', 'full_front', 'full_side', 'full_back')),
  path text not null,                         -- bucket ugc-characters
  approved boolean not null default false,
  flow_uploaded_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (character_id, angle)
);
create index if not exists ugc_character_photos_char_idx on ugc_character_photos (character_id);

-- ── 3. Tugas karakter untuk agent ─────────────────────────────
create table if not exists ugc_character_tasks (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references ugc_characters (id) on delete cascade,
  kind text not null check (kind in ('upload_photos', 'intro_video')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'needs_human', 'canceled')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  attempts int not null default 0,
  last_error text,
  error_kind text,
  not_before timestamptz,
  claimed_by text,
  claimed_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists ugc_character_tasks_active_uq
  on ugc_character_tasks (character_id, kind) where status in ('queued', 'running', 'needs_human');
create index if not exists ugc_character_tasks_queue_idx on ugc_character_tasks (status, not_before, created_at);

drop trigger if exists ugc_character_tasks_touch on ugc_character_tasks;
create trigger ugc_character_tasks_touch before update on ugc_character_tasks for each row execute function ugc_touch();

-- ── 4. Penjaga perubahan karakter dan foto oleh staff ─────────
create or replace function ugc_guard_character_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('ugc.bypass', true), '') = '1' then return new; end if;
  if auth.uid() is null then return new; end if;  -- service_role / SQL Editor: tanpa pengguna login
  if coalesce(ugc_role(), '') = 'admin' then return new; end if;
  if new.status is distinct from old.status and new.status in ('project_ready', 'voice_in_flow', 'intro_review', 'ready') then
    raise exception 'status % hanya boleh diubah lewat fungsi sistem', new.status using errcode = '42501';
  end if;
  if new.intro_video_path is distinct from old.intro_video_path
     or new.intro_attempts is distinct from old.intro_attempts
     or new.ready_at is distinct from old.ready_at
     or new.ready_override_reason is distinct from old.ready_override_reason
     or new.voice_shared_ok is distinct from old.voice_shared_ok then
    raise exception 'kolom ini hanya boleh diubah lewat fungsi sistem atau admin' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists ugc_characters_guard on ugc_characters;
create trigger ugc_characters_guard before update on ugc_characters for each row execute function ugc_guard_character_update();

create or replace function ugc_guard_character_insert() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('ugc.bypass', true), '') = '1' or auth.uid() is null or coalesce(ugc_role(), '') = 'admin' then return new; end if;
  if new.status in ('project_ready', 'voice_in_flow', 'intro_review', 'ready') or new.voice_shared_ok then
    raise exception 'karakter baru tidak boleh langsung berstatus %', new.status using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists ugc_characters_guard_ins on ugc_characters;
create trigger ugc_characters_guard_ins before insert on ugc_characters for each row execute function ugc_guard_character_insert();

create or replace function ugc_guard_photo_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('ugc.bypass', true), '') = '1' or auth.uid() is null or coalesce(ugc_role(), '') = 'admin' then return new; end if;
  if new.flow_uploaded_at is distinct from old.flow_uploaded_at then
    raise exception 'flow_uploaded_at hanya diisi oleh agent' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists ugc_character_photos_guard on ugc_character_photos;
create trigger ugc_character_photos_guard before update on ugc_character_photos for each row execute function ugc_guard_photo_update();

-- Penjaga job dari migrasi v2: konteks tanpa pengguna login (service_role, SQL Editor, n8n) dipercaya.
create or replace function ugc_guard_job_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('ugc.bypass', true), '') = '1' then return new; end if;
  if auth.uid() is null then return new; end if;
  if coalesce(ugc_role(), '') = 'admin' then return new; end if;
  if new.status is distinct from old.status
     and new.status not in ('draft', 'planned', 'storyboard_pending', 'storyboard_ready', 'json_ready', 'approved', 'canceled') then
    raise exception 'status % hanya boleh diubah lewat fungsi sistem', new.status using errcode = '42501';
  end if;
  if new.risk_approved_by is distinct from old.risk_approved_by then
    raise exception 'persetujuan risiko hanya oleh admin' using errcode = '42501';
  end if;
  if old.status in ('running', 'downloaded', 'done') and new.video_path is distinct from old.video_path then
    raise exception 'hasil video tidak boleh diubah staff' using errcode = '42501';
  end if;
  return new;
end $$;

-- ── 5. Fungsi untuk staff ─────────────────────────────────────
create or replace function ugc_char_owner_check(p_character uuid) returns ugc_characters
language plpgsql security definer set search_path = public as $$
declare c ugc_characters;
begin
  select * into c from ugc_characters where id = p_character;
  if not found then raise exception 'karakter tidak ditemukan' using errcode = 'P0002'; end if;
  if c.created_by <> auth.uid() and not ugc_is_admin() then raise exception 'bukan karakter milikmu' using errcode = '42501'; end if;
  return c;
end $$;

-- Meminta tugas untuk agent (upload foto ke project, atau video perkenalan).
create or replace function ugc_request_char_task(p_character uuid, p_kind text, p_payload jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare c ugc_characters; v_id uuid; v_n int;
begin
  c := ugc_char_owner_check(p_character);
  if c.flow_project_url is null or c.flow_project_url !~ '^https://flow\.google\.com/' then
    raise exception 'karakter belum punya alamat project Flow yang valid' using errcode = 'P0001';
  end if;
  if p_kind = 'upload_photos' then
    if c.status <> 'sheet_ready' then raise exception 'upload foto hanya dari status sheet_ready (sekarang: %)', c.status using errcode = 'P0001'; end if;
    select count(*) into v_n from ugc_character_photos where character_id = p_character and approved;
    if v_n = 0 then raise exception 'belum ada foto yang disetujui' using errcode = 'P0001'; end if;
  elsif p_kind = 'intro_video' then
    if c.status <> 'voice_in_flow' then raise exception 'video perkenalan hanya dari status voice_in_flow (sekarang: %)', c.status using errcode = 'P0001'; end if;
    if c.flow_character_name is null then raise exception 'nama karakter di Flow belum diisi' using errcode = 'P0001'; end if;
    if coalesce(p_payload ->> 'video_json', '') = '' then raise exception 'JSON perkenalan kosong' using errcode = 'P0001'; end if;
  else
    raise exception 'jenis tugas % tidak dikenal', p_kind using errcode = '22023';
  end if;
  perform set_config('ugc.bypass', '1', true);
  insert into ugc_character_tasks (character_id, kind, payload, created_by) values (p_character, p_kind, coalesce(p_payload, '{}'::jsonb), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Staff mengonfirmasi bahwa karakter dan suara sudah dibuat di Flow (langkah manual sampai tampilannya terpetakan).
create or replace function ugc_confirm_flow_character(p_character uuid, p_flow_character_name text, p_flow_voice_name text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c ugc_characters;
begin
  c := ugc_char_owner_check(p_character);
  if c.status <> 'project_ready' then raise exception 'konfirmasi hanya dari status project_ready (sekarang: %)', c.status using errcode = 'P0001'; end if;
  if coalesce(trim(p_flow_character_name), '') = '' then raise exception 'nama karakter di Flow wajib diisi' using errcode = 'P0001'; end if;
  perform set_config('ugc.bypass', '1', true);
  update ugc_characters set flow_character_name = trim(p_flow_character_name), flow_voice_name = nullif(trim(coalesce(p_flow_voice_name, '')), ''),
         status = 'voice_in_flow' where id = p_character;
end $$;

-- Review video perkenalan. Disetujui → ready. Ditolak → ulang (maksimal 3 kali), lalu kembali ke definisi suara.
create or replace function ugc_review_intro(p_character uuid, p_approve boolean, p_note text default null, p_ref_clip_path text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c ugc_characters; v_to text;
begin
  c := ugc_char_owner_check(p_character);
  if c.status <> 'intro_review' then raise exception 'review hanya dari status intro_review (sekarang: %)', c.status using errcode = 'P0001'; end if;
  perform set_config('ugc.bypass', '1', true);
  if p_approve then
    v_to := 'ready';
    update ugc_characters set status = 'ready', ready_at = now(), voice_ref_clip_path = coalesce(p_ref_clip_path, voice_ref_clip_path) where id = p_character;
  else
    v_to := case when c.intro_attempts >= 3 then 'voice_defined' else 'voice_in_flow' end;
    update ugc_characters set status = v_to where id = p_character;
  end if;
  update ugc_character_tasks set result = result || jsonb_build_object('review', jsonb_build_object('approved', p_approve, 'note', p_note, 'by', auth.uid(), 'at', now()))
   where id = (select id from ugc_character_tasks where character_id = p_character and kind = 'intro_video' order by created_at desc limit 1);
  return v_to;
end $$;

-- Admin menyatakan karakter siap tanpa video perkenalan: alasan tertulis wajib.
create or replace function ugc_admin_mark_ready(p_character uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ugc_is_admin() then raise exception 'khusus admin' using errcode = '42501'; end if;
  if coalesce(length(trim(p_reason)), 0) < 10 then raise exception 'alasan wajib diisi (minimal 10 karakter)' using errcode = 'P0001'; end if;
  perform set_config('ugc.bypass', '1', true);
  update ugc_characters set status = 'ready', ready_at = now(), ready_override_reason = trim(p_reason) where id = p_character;
  if not found then raise exception 'karakter tidak ditemukan' using errcode = 'P0002'; end if;
end $$;

-- ── 6. Fungsi untuk agent ─────────────────────────────────────
create or replace function ugc_claim_next_char_task(p_agent text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t ugc_character_tasks; c ugc_characters; v_photos jsonb;
begin
  if coalesce(ugc_role(), '') not in ('agent', 'admin') then raise exception 'khusus agent' using errcode = '42501'; end if;
  if (select paused from ugc_agent_control where id = 1) then return null; end if;
  select * into t from ugc_character_tasks
   where status = 'queued' and (not_before is null or not_before <= now())
   order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  perform set_config('ugc.bypass', '1', true);
  update ugc_character_tasks set status = 'running', claimed_by = p_agent, claimed_at = now(), attempts = attempts + 1, last_error = null, error_kind = null
   where id = t.id returning * into t;
  select * into c from ugc_characters where id = t.character_id;
  select coalesce(jsonb_agg(jsonb_build_object('angle', angle, 'bucket', 'ugc-characters', 'path', path) order by angle), '[]'::jsonb)
    into v_photos from ugc_character_photos where character_id = c.id and approved;
  return jsonb_build_object(
    'task_id', t.id, 'kind', t.kind, 'attempt', t.attempts, 'max_attempts', ugc_setting_int('max_attempts', 3),
    'character_id', c.id, 'character_code', c.code, 'project_url', c.flow_project_url,
    'flow_character_name', c.flow_character_name, 'flow_voice_name', c.flow_voice_name, 'voice_base', c.voice_base,
    'payload', t.payload, 'photos', v_photos);
end $$;

create or replace function ugc_char_task_progress(p_task uuid, p_status text, p_patch jsonb default '{}'::jsonb, p_event jsonb default null) returns text
language plpgsql security definer set search_path = public as $$
declare t ugc_character_tasks; v_final text := p_status; v_backoff int;
begin
  if coalesce(ugc_role(), '') not in ('agent', 'admin') then raise exception 'khusus agent' using errcode = '42501'; end if;
  if p_status not in ('running', 'done', 'failed', 'needs_human', 'queued') then raise exception 'status % tidak diizinkan', p_status using errcode = '22023'; end if;
  select * into t from ugc_character_tasks where id = p_task for update;
  if not found then raise exception 'tugas tidak ditemukan' using errcode = 'P0002'; end if;
  perform set_config('ugc.bypass', '1', true);

  if p_status = 'failed' and t.attempts < ugc_setting_int('max_attempts', 3) and coalesce(p_patch ->> 'error_kind', 'unknown') <> 'fatal' then
    v_final := 'queued';
    v_backoff := ugc_setting_int('retry_backoff_minutes', 2);
  end if;

  update ugc_character_tasks set
    status = v_final,
    result = result || coalesce(p_patch - 'last_error' - 'error_kind', '{}'::jsonb)
             || case when p_event is null then '{}'::jsonb else jsonb_build_object('last_event', p_event) end,
    last_error = coalesce(p_patch ->> 'last_error', last_error),
    error_kind = coalesce(p_patch ->> 'error_kind', error_kind),
    not_before = case when v_final = 'queued' and p_status = 'failed' then now() + make_interval(mins => v_backoff * greatest(t.attempts, 1)) else not_before end,
    claimed_by = case when v_final = 'running' then claimed_by else null end,
    finished_at = case when v_final in ('done', 'failed') then now() else finished_at end
  where id = p_task;

  if v_final = 'done' then
    if t.kind = 'upload_photos' then
      update ugc_character_photos set flow_uploaded_at = now() where character_id = t.character_id and approved;
      update ugc_characters set status = 'project_ready' where id = t.character_id and status = 'sheet_ready';
    elsif t.kind = 'intro_video' then
      update ugc_characters set status = 'intro_review', intro_video_path = p_patch ->> 'video_path', intro_attempts = intro_attempts + 1
       where id = t.character_id and status = 'voice_in_flow';
    end if;
  end if;

  if v_final = 'needs_human' then
    update ugc_agent_control set paused = true, reason = 'tugas karakter ' || p_task || ' butuh manusia: ' || coalesce(p_patch ->> 'last_error', ''),
           updated_by = 'agent', updated_at = now() where id = 1;
  end if;
  return v_final;
end $$;

-- ── 7. Pintu batch: karakter wajib berstatus ready ────────────
create or replace function ugc_enqueue_batch(p_batch uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_char record; v_n int; v_bad int; v_risky int;
begin
  select created_by into v_owner from ugc_batches where id = p_batch;
  if v_owner is null then raise exception 'batch tidak ditemukan' using errcode = 'P0002'; end if;
  if v_owner <> auth.uid() and not ugc_is_admin() then raise exception 'bukan batch milikmu' using errcode = '42501'; end if;

  select c.* into v_char from ugc_batches b join ugc_characters c on c.id = b.character_id where b.id = p_batch;
  if v_char.status <> 'ready' then
    raise exception 'karakter belum berstatus siap (sekarang: %)', v_char.status using errcode = 'P0001';
  end if;
  if v_char.flow_project_url is null or v_char.flow_project_url !~ '^https://flow\.google\.com/' then
    raise exception 'karakter belum punya alamat project Flow yang valid' using errcode = 'P0001';
  end if;

  select count(*) into v_n from ugc_jobs where batch_id = p_batch and status = 'approved';
  select count(*) into v_bad from ugc_jobs where batch_id = p_batch and status not in ('approved', 'canceled');
  if v_n = 0 then raise exception 'tidak ada job yang disetujui' using errcode = 'P0001'; end if;
  if v_bad > 0 then raise exception '% job belum disetujui', v_bad using errcode = 'P0001'; end if;
  if exists (select 1 from ugc_jobs where batch_id = p_batch and status = 'approved'
              and (storyboard_path is null or video_json is null)) then
    raise exception 'ada job tanpa storyboard atau JSON' using errcode = 'P0001';
  end if;
  select count(*) into v_risky from ugc_jobs
   where batch_id = p_batch and status = 'approved'
     and (panel_plan ->> 'needs_human_approval') = 'true' and risk_approved_by is null;
  if v_risky > 0 then raise exception '% job berisiko tinggi menunggu persetujuan admin', v_risky using errcode = 'P0001'; end if;

  perform set_config('ugc.bypass', '1', true);
  update ugc_batches set status = 'queued' where id = p_batch;
  update ugc_jobs set status = 'queued', not_before = null where batch_id = p_batch and status = 'approved';
  return v_n;
end $$;

-- Job video kini membawa nama karakter dan voice di Flow.
create or replace function ugc_claim_next_job(p_agent text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_job ugc_jobs; v_batch ugc_batches; v_char ugc_characters;
begin
  if coalesce(ugc_role(), '') not in ('agent', 'admin') then raise exception 'khusus agent' using errcode = '42501'; end if;
  if (select paused from ugc_agent_control where id = 1) then return null; end if;

  select j.* into v_job
    from ugc_jobs j join ugc_batches b on b.id = j.batch_id
   where j.status = 'queued' and (j.not_before is null or j.not_before <= now())
     and b.status in ('queued', 'running')
   order by b.created_at, j.seq
   limit 1
   for update of j skip locked;
  if not found then return null; end if;

  perform set_config('ugc.bypass', '1', true);
  update ugc_jobs
     set status = 'running', claimed_by = p_agent, claimed_at = now(),
         started_at = coalesce(started_at, now()), attempts = attempts + 1, last_error = null, error_kind = null
   where id = v_job.id returning * into v_job;
  select * into v_batch from ugc_batches where id = v_job.batch_id;
  select * into v_char from ugc_characters where id = v_batch.character_id;
  update ugc_agents set current_job_id = v_job.id, status = 'busy', last_seen = now() where name = p_agent;

  return jsonb_build_object(
    'job_id', v_job.id, 'batch_id', v_job.batch_id, 'seq', v_job.seq, 'attempt', v_job.attempts,
    'max_attempts', ugc_setting_int('max_attempts', 3),
    'project_url', v_char.flow_project_url, 'character_code', v_char.code,
    'flow_character_name', v_char.flow_character_name, 'flow_voice_name', v_char.flow_voice_name,
    'resolution', v_batch.resolution, 'duration_sec', v_batch.duration_sec,
    'storyboard', jsonb_build_object('bucket', 'ugc-storyboards', 'path', v_job.storyboard_path),
    'video_json', v_job.video_json,
    'storyboard_variant', v_job.storyboard_variant,
    'setting_id', v_job.setting_id, 'gesture_variant', v_job.gesture_variant
  );
end $$;

-- ── 8. RLS dan hak akses tabel baru ───────────────────────────
alter table ugc_character_photos enable row level security;
alter table ugc_character_tasks enable row level security;

drop policy if exists ugc_photos_read on ugc_character_photos;
create policy ugc_photos_read on ugc_character_photos for select to authenticated using (ugc_role() in ('admin', 'staff'));
drop policy if exists ugc_photos_insert on ugc_character_photos;
create policy ugc_photos_insert on ugc_character_photos for insert to authenticated
  with check (ugc_role() in ('admin', 'staff') and created_by = auth.uid()
              and exists (select 1 from ugc_characters c where c.id = character_id and (c.created_by = auth.uid() or ugc_is_admin())));
drop policy if exists ugc_photos_update on ugc_character_photos;
create policy ugc_photos_update on ugc_character_photos for update to authenticated
  using (created_by = auth.uid() or ugc_is_admin()) with check (created_by = auth.uid() or ugc_is_admin());
drop policy if exists ugc_photos_delete on ugc_character_photos;
create policy ugc_photos_delete on ugc_character_photos for delete to authenticated using (ugc_is_admin());

drop policy if exists ugc_char_tasks_read on ugc_character_tasks;
create policy ugc_char_tasks_read on ugc_character_tasks for select to authenticated
  using (created_by = auth.uid() or ugc_is_admin());

do $$
declare t text;
begin
  foreach t in array array['ugc_character_photos', 'ugc_character_tasks'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  grant select, insert, update, delete on public.ugc_character_photos to authenticated;
  grant select on public.ugc_character_tasks to authenticated;
end $$;

revoke all on function ugc_char_owner_check(uuid), ugc_request_char_task(uuid, text, jsonb), ugc_confirm_flow_character(uuid, text, text),
  ugc_review_intro(uuid, boolean, text, text), ugc_admin_mark_ready(uuid, text), ugc_claim_next_char_task(text),
  ugc_char_task_progress(uuid, text, jsonb, jsonb), ugc_enqueue_batch(uuid), ugc_claim_next_job(text) from public, anon;
grant execute on function ugc_request_char_task(uuid, text, jsonb), ugc_confirm_flow_character(uuid, text, text),
  ugc_review_intro(uuid, boolean, text, text), ugc_admin_mark_ready(uuid, text), ugc_claim_next_char_task(text),
  ugc_char_task_progress(uuid, text, jsonb, jsonb), ugc_enqueue_batch(uuid), ugc_claim_next_job(text) to authenticated;
-- ugc_char_owner_check dipakai internal oleh fungsi lain; tidak dibuka langsung ke klien.
revoke execute on function ugc_char_owner_check(uuid) from authenticated;

-- ████████████████████████████████████████████████████████████
-- BAGIAN: 20261002000400_hardening.sql
-- ████████████████████████████████████████████████████████████

-- ══════════════════════════════════════════════════════════════
-- BA UGC v2 — Penguatan keamanan dan kinerja (hasil analisis Supabase 2026-10-02)
-- Jalankan SETELAH 20261002000300. Aman diulang.
--
-- 1) KRITIS: staff tidak boleh menaikkan role dirinya sendiri (policy "update own name" mengizinkan
--    pembaruan kolom APA PUN pada baris sendiri, termasuk role dan email).
-- 2) Fungsi trigger dan pembantu tidak lagi dapat dijalankan anon lewat API.
-- 3) search_path pada ugc_touch, delapan indeks kunci asing.
-- 4) Policy memakai (select auth.uid()) dan tidak lagi tumpang tindih; peran dibatasi ke authenticated.
-- ══════════════════════════════════════════════════════════════

-- Pengaman urutan
do $$
begin
  if to_regclass('public.ugc_character_tasks') is null then
    raise exception 'URUTAN SALAH: jalankan 20261002000300_ugc_character_voice.sql lebih dulu, lalu ulangi berkas ini.' using errcode = 'P0001';
  end if;
end $$;

-- ── 1. user_profiles: hanya name dan avatar_path yang boleh diubah pengguna ──
revoke update on public.user_profiles from authenticated;
grant update (name, avatar_path) on public.user_profiles to authenticated;
-- Mengubah role/email kini hanya lewat dashboard Supabase, SQL Editor, atau service_role.

-- ── 2. Hak eksekusi fungsi ────────────────────────────────────
-- Fungsi trigger: hak EXECUTE hanya diperiksa saat trigger dibuat, bukan saat dijalankan.
revoke execute on function ugc_check_batch_limit(), ugc_check_job_limit(), ugc_guard_job_update(), ugc_guard_character_insert(),
  ugc_guard_character_update(), ugc_guard_photo_update(), ugc_rollup_batch(), ugc_touch() from public, anon, authenticated;
-- Dipakai internal oleh fungsi SECURITY DEFINER lain, tidak perlu dipanggil klien.
revoke execute on function ugc_setting_int(text, int) from public, anon, authenticated;
-- Dipakai policy RLS (dijalankan atas nama pemanggil): authenticated wajib bisa, anon tidak.
revoke execute on function ugc_role(), ugc_is_admin(), public.is_admin() from public, anon;
grant execute on function ugc_role(), ugc_is_admin(), public.is_admin() to authenticated;

-- ── 3. search_path dan indeks ─────────────────────────────────
alter function ugc_touch() set search_path = public;

create index if not exists ugc_batches_character_idx on ugc_batches (character_id);
create index if not exists ugc_batches_created_by_idx on ugc_batches (created_by);
create index if not exists ugc_character_photos_created_by_idx on ugc_character_photos (created_by);
create index if not exists ugc_character_tasks_created_by_idx on ugc_character_tasks (created_by);
create index if not exists ugc_characters_created_by_idx on ugc_characters (created_by);
create index if not exists ugc_jobs_created_by_idx on ugc_jobs (created_by);
create index if not exists ugc_jobs_product_idx on ugc_jobs (product_id);
create index if not exists ugc_products_created_by_idx on ugc_products (created_by);

-- ── 4. Policy tabel lama (perilaku sama, lebih cepat, tanpa tumpang tindih) ──
drop policy if exists "admin read all profiles" on public.user_profiles;
drop policy if exists "read own profile" on public.user_profiles;
drop policy if exists "read own or admin profile" on public.user_profiles;
create policy "read own or admin profile" on public.user_profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
drop policy if exists "update own name" on public.user_profiles;
create policy "update own name" on public.user_profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "admin write characters" on public.characters;
drop policy if exists "authenticated read characters" on public.characters;
create policy "authenticated read characters" on public.characters for select to authenticated using (true);
drop policy if exists "admin insert characters" on public.characters;
create policy "admin insert characters" on public.characters for insert to authenticated with check (public.is_admin());
drop policy if exists "admin update characters" on public.characters;
create policy "admin update characters" on public.characters for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin delete characters" on public.characters;
create policy "admin delete characters" on public.characters for delete to authenticated using (public.is_admin());

drop policy if exists "authenticated read character_photos" on public.character_photos;
create policy "authenticated read character_photos" on public.character_photos for select to authenticated using (true);

drop policy if exists "own or admin select video_jobs" on public.video_jobs;
drop policy if exists "own or admin modify video_jobs" on public.video_jobs;
create policy "own or admin select video_jobs" on public.video_jobs for select to authenticated
  using (created_by = (select auth.uid()) or public.is_admin());
drop policy if exists "own or admin insert video_jobs" on public.video_jobs;
create policy "own or admin insert video_jobs" on public.video_jobs for insert to authenticated
  with check (created_by = (select auth.uid()) or public.is_admin());
drop policy if exists "own or admin update video_jobs" on public.video_jobs;
create policy "own or admin update video_jobs" on public.video_jobs for update to authenticated
  using (created_by = (select auth.uid()) or public.is_admin()) with check (created_by = (select auth.uid()) or public.is_admin());
drop policy if exists "own or admin delete video_jobs" on public.video_jobs;
create policy "own or admin delete video_jobs" on public.video_jobs for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_admin());

drop policy if exists "own or admin frames" on public.frames;
create policy "own or admin frames" on public.frames
  for all to authenticated
  using (exists (select 1 from public.video_jobs j where j.id = frames.video_job_id and (j.created_by = (select auth.uid()) or public.is_admin())))
  with check (exists (select 1 from public.video_jobs j where j.id = frames.video_job_id and (j.created_by = (select auth.uid()) or public.is_admin())));

-- ── 5. Policy sistem v2: (select auth.uid()) dan pengaturan tanpa tumpang tindih ──
drop policy if exists ugc_settings_admin on ugc_settings;
drop policy if exists ugc_settings_admin_insert on ugc_settings;
create policy ugc_settings_admin_insert on ugc_settings for insert to authenticated with check (ugc_is_admin());
drop policy if exists ugc_settings_admin_update on ugc_settings;
create policy ugc_settings_admin_update on ugc_settings for update to authenticated using (ugc_is_admin()) with check (ugc_is_admin());
drop policy if exists ugc_settings_admin_delete on ugc_settings;
create policy ugc_settings_admin_delete on ugc_settings for delete to authenticated using (ugc_is_admin());

drop policy if exists ugc_characters_insert on ugc_characters;
create policy ugc_characters_insert on ugc_characters for insert to authenticated
  with check (ugc_role() in ('admin', 'staff') and created_by = (select auth.uid()));
drop policy if exists ugc_characters_update on ugc_characters;
create policy ugc_characters_update on ugc_characters for update to authenticated
  using (created_by = (select auth.uid()) or ugc_is_admin()) with check (created_by = (select auth.uid()) or ugc_is_admin());
drop policy if exists ugc_products_insert on ugc_products;
create policy ugc_products_insert on ugc_products for insert to authenticated
  with check (ugc_role() in ('admin', 'staff') and created_by = (select auth.uid()));
drop policy if exists ugc_products_update on ugc_products;
create policy ugc_products_update on ugc_products for update to authenticated
  using (created_by = (select auth.uid()) or ugc_is_admin()) with check (created_by = (select auth.uid()) or ugc_is_admin());
drop policy if exists ugc_batches_read on ugc_batches;
create policy ugc_batches_read on ugc_batches for select to authenticated
  using (created_by = (select auth.uid()) or ugc_is_admin());
drop policy if exists ugc_batches_insert on ugc_batches;
create policy ugc_batches_insert on ugc_batches for insert to authenticated
  with check (ugc_role() in ('admin', 'staff') and created_by = (select auth.uid()));
drop policy if exists ugc_batches_update on ugc_batches;
create policy ugc_batches_update on ugc_batches for update to authenticated
  using ((created_by = (select auth.uid()) and status in ('draft', 'storyboards_ready', 'approved')) or ugc_is_admin())
  with check ((created_by = (select auth.uid()) and status in ('draft', 'storyboards_ready', 'approved', 'canceled')) or ugc_is_admin());
drop policy if exists ugc_jobs_read on ugc_jobs;
create policy ugc_jobs_read on ugc_jobs for select to authenticated
  using (created_by = (select auth.uid()) or ugc_is_admin());
drop policy if exists ugc_jobs_insert on ugc_jobs;
create policy ugc_jobs_insert on ugc_jobs for insert to authenticated
  with check (ugc_role() in ('admin', 'staff') and created_by = (select auth.uid())
              and exists (select 1 from ugc_batches b where b.id = batch_id and (b.created_by = (select auth.uid()) or ugc_is_admin())));
drop policy if exists ugc_jobs_update on ugc_jobs;
create policy ugc_jobs_update on ugc_jobs for update to authenticated
  using ((created_by = (select auth.uid()) and status in ('draft', 'planned', 'storyboard_pending', 'storyboard_ready', 'json_ready', 'approved')) or ugc_is_admin())
  with check (created_by = (select auth.uid()) or ugc_is_admin());
drop policy if exists ugc_events_read on ugc_job_events;
create policy ugc_events_read on ugc_job_events for select to authenticated
  using (exists (select 1 from ugc_jobs j where j.id = job_id and (j.created_by = (select auth.uid()) or ugc_is_admin())));
drop policy if exists ugc_photos_insert on ugc_character_photos;
create policy ugc_photos_insert on ugc_character_photos for insert to authenticated
  with check (ugc_role() in ('admin', 'staff') and created_by = (select auth.uid())
              and exists (select 1 from ugc_characters c where c.id = character_id and (c.created_by = (select auth.uid()) or ugc_is_admin())));
drop policy if exists ugc_photos_update on ugc_character_photos;
create policy ugc_photos_update on ugc_character_photos for update to authenticated
  using (created_by = (select auth.uid()) or ugc_is_admin()) with check (created_by = (select auth.uid()) or ugc_is_admin());
drop policy if exists ugc_char_tasks_read on ugc_character_tasks;
create policy ugc_char_tasks_read on ugc_character_tasks for select to authenticated
  using (created_by = (select auth.uid()) or ugc_is_admin());
