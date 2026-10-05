-- ═══════════════════════════════════════════════════════════════════════
-- 20261005000500 — Agent online setara agent offline
-- Jalankan SETELAH 0100–0400 (sudah dijalankan). Aman diulang (create or replace, add column if not exists).
--
-- Isi:
--  1. ugc_characters.flow_account_name : nama akun Google pemilik project Flow (untuk pemeriksaan akun oleh agent).
--  2. ugc_job_was_generated(job)       : apakah generate pernah ditekan tanpa kartu gagal sesudahnya (khusus internal).
--  3. ugc_claim_next_job               : kini juga mengembalikan flow_asset_url, generated, room_code, room, extra_photos.
--  4. ugc_requeue_own(agent)           : job berstatus running milik agent yang BARU mulai dikembalikan ke antrean
--                                        (ugc_requeue_stale tidak bisa, karena agent yang sama sudah berdetak lagi).
--
-- Tidak diubah: ugc_job_progress sudah menerima status 'running' dengan patch flow_asset_url (diuji di db/test/online.test.mjs).
-- ═══════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('public.ugc_characters') is null or to_regclass('public.ugc_job_events') is null
     or to_regprocedure('ugc_claim_next_job(text)') is null then
    raise exception 'URUTAN SALAH: jalankan 0200 dan 0300 lebih dulu (atau berkas gabungan 20261002_JALANKAN_SEMUA.sql).' using errcode = 'P0001';
  end if;
end $$;

-- ── 1. Akun Google pemilik project ───────────────────────────────
alter table ugc_characters add column if not exists flow_account_name text;

-- ── 2. Apakah generate pernah ditekan? ───────────────────────────
-- Sama dengan wasGenerated() di agent offline: generate_start atau generate menandai "mungkin sudah jadi",
-- generate_failed (kartu gagal, tidak ada video) menghapus tanda itu. Yang menentukan peristiwa TERAKHIR di antara ketiganya.
create or replace function ugc_job_was_generated(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select e.step in ('generate_start', 'generate')
                     from ugc_job_events e
                    where e.job_id = p_job and e.step in ('generate_start', 'generate', 'generate_failed')
                    order by e.id desc limit 1), false)
$$;

-- ── 3. Klaim job: tambahan data untuk pemulihan dan pemeriksaan ruang ─
-- Semua kunci lama dipertahankan; hanya ditambah.
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
    'setting_id', v_job.setting_id, 'gesture_variant', v_job.gesture_variant,
    -- baru (0500)
    'flow_asset_url', v_job.flow_asset_url,
    'generated', ugc_job_was_generated(v_job.id),
    'room_code', v_char.code,
    'room', jsonb_build_object(
      'code', v_char.code, 'name', v_char.name,
      'flow_project_url', v_char.flow_project_url, 'flow_account_name', v_char.flow_account_name,
      'dna', jsonb_build_object('appearance_en', v_char.dna ->> 'appearance_en')),
    'extra_photos', case when v_char.face_ref_path is null or v_char.face_ref_path = '' then '[]'::jsonb
                         else jsonb_build_array(jsonb_build_object('angle', 'face_front', 'bucket', 'ugc-characters', 'path', v_char.face_ref_path)) end
  );
end $$;

-- ── 4. Job running milik agent yang baru mulai ───────────────────
-- Satu Chrome hanya dikendalikan satu agent (kunci di laptop), jadi job running atas nama agent ini
-- pasti tertinggal dari proses sebelumnya. Dikembalikan ke antrean TANPA menunggu batas waktu.
-- flow_asset_url tetap tersimpan; bila generate pernah ditekan, agent mencari video lewat kode job (tanpa generate ulang).
-- PENTING: setiap laptop harus memakai AGENT_NAME yang berbeda.
create or replace function ugc_requeue_own(p_agent text) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if coalesce(ugc_role(), '') not in ('agent', 'admin') then raise exception 'khusus agent' using errcode = '42501'; end if;
  if coalesce(trim(p_agent), '') = '' then raise exception 'nama agent wajib diisi' using errcode = '22023'; end if;
  perform set_config('ugc.bypass', '1', true);
  with s as (
    update ugc_jobs j
       set status = 'queued', claimed_by = null, not_before = null,
           last_error = 'dikembalikan: agent berhenti di tengah job', error_kind = 'stale'
     where j.status = 'running' and j.claimed_by = p_agent
    returning j.id),
  e as (
    insert into ugc_job_events (job_id, kind, step, message, agent, result)
    select s.id, 'warn', 'requeue',
           case when ugc_job_was_generated(s.id)
                then 'Agent berhenti setelah generate ditekan: job dikembalikan ke antrean, video akan dicari lewat kode job (tanpa generate ulang)'
                else 'Agent berhenti di tengah job: dikembalikan ke antrean' end,
           p_agent, 'queued'
      from s
    returning 1)
  select count(*) into v_n from s;
  return v_n;
end $$;

revoke all on function ugc_job_was_generated(uuid) from public, anon, authenticated;
revoke all on function ugc_requeue_own(text), ugc_claim_next_job(text) from public, anon;
grant execute on function ugc_requeue_own(text), ugc_claim_next_job(text) to authenticated;
