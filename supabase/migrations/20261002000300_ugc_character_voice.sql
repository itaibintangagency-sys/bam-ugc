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
