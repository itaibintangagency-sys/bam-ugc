-- ═══════════════════════════════════════════════════════════════════════
-- 20261005000700 — Gerbang antrean dan persetujuan risiko tinggi
-- Jalankan SETELAH 0500 dan 0600. Aman diulang.
--
-- Celah yang ditutup (semuanya terbukti di Postgres lokal sebelum perbaikan):
--  A. Staf bisa MENYISIPKAN batch dan job langsung berstatus 'queued'. Agent lalu mengklaimnya, melewati semua gerbang
--     (karakter siap, persetujuan admin, validasi produk). Penjaga lama hanya ada pada UPDATE, tidak pada INSERT.
--  B. Staf bisa memalsukan persetujuan admin (risk_approved_by) saat menyisipkan job.
--  C. Gerbang risiko tinggi membaca panel_plan yang bisa ditulis staf (needs_human_approval=false atau panel_plan kosong).
--  D. Staf bisa mengisi flow_asset_url (alamat yang akan DIBUKA agent) dan kolom sistem lain pada job.
--
-- Perbaikan:
--  1. ugc_guard_job_fields   : penjaga INSERT dan UPDATE pada kolom sistem job (hanya admin, fungsi sistem, atau SQL Editor).
--  2. ugc_guard_batch_insert : batch baru oleh staf hanya boleh berstatus draft, storyboards_ready, atau approved.
--  3. ugc_enqueue_batch      : risiko dibaca dari PRODUK (dijaga trigger 0600), bukan dari panel_plan; produk tanpa risiko ditolak.
--  4. ugc_approve_risk       : jalur resmi persetujuan admin per job.
-- ═══════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('public.ugc_archetypes') is null or to_regprocedure('ugc_arch_rank(text)') is null then
    raise exception 'URUTAN SALAH: jalankan 0600 (katalog arketipe) lebih dulu.' using errcode = 'P0001';
  end if;
  if to_regprocedure('ugc_requeue_own(text)') is null then
    raise exception 'URUTAN SALAH: jalankan 0500 lebih dulu.' using errcode = 'P0001';
  end if;
end $$;

-- ── 1. Penjaga kolom sistem pada job ─────────────────────────────
create or replace function ugc_guard_job_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('ugc.bypass', true), '') = '1' then return new; end if;
  if auth.uid() is null then return new; end if;                 -- SQL Editor / service_role / n8n
  if coalesce(ugc_role(), '') = 'admin' then return new; end if;

  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'planned', 'storyboard_pending', 'storyboard_ready', 'json_ready', 'approved', 'canceled') then
      raise exception 'job baru tidak boleh berstatus %; status itu hanya lewat fungsi sistem', new.status using errcode = '42501';
    end if;
    if new.risk_approved_by is not null then
      raise exception 'persetujuan risiko hanya oleh admin' using errcode = '42501';
    end if;
    if new.flow_asset_url is not null or new.video_path is not null or new.claimed_by is not null or new.credits_observed is not null
       or coalesce(new.attempts, 0) <> 0 or new.not_before is not null or new.started_at is not null or new.finished_at is not null then
      raise exception 'kolom sistem job tidak boleh diisi saat membuat job' using errcode = '42501';
    end if;
  else
    if new.flow_asset_url is distinct from old.flow_asset_url or new.attempts is distinct from old.attempts
       or new.claimed_by is distinct from old.claimed_by or new.credits_observed is distinct from old.credits_observed
       or new.not_before is distinct from old.not_before then
      raise exception 'kolom sistem job hanya boleh diubah oleh fungsi sistem atau admin' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function ugc_guard_job_fields() from public, anon, authenticated;
drop trigger if exists ugc_jobs_guard_fields on ugc_jobs;
create trigger ugc_jobs_guard_fields before insert or update on ugc_jobs for each row execute function ugc_guard_job_fields();

-- ── 2. Penjaga INSERT batch ──────────────────────────────────────
create or replace function ugc_guard_batch_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('ugc.bypass', true), '') = '1' or auth.uid() is null or coalesce(ugc_role(), '') = 'admin' then return new; end if;
  if new.status not in ('draft', 'storyboards_ready', 'approved') then
    raise exception 'batch baru tidak boleh berstatus %; antrean hanya lewat ugc_enqueue_batch', new.status using errcode = '42501';
  end if;
  if new.started_at is not null or new.finished_at is not null then
    raise exception 'kolom sistem batch tidak boleh diisi saat membuat batch' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function ugc_guard_batch_insert() from public, anon, authenticated;
drop trigger if exists ugc_batches_guard_ins on ugc_batches;
create trigger ugc_batches_guard_ins before insert on ugc_batches for each row execute function ugc_guard_batch_insert();

-- ── 3. Gerbang antrean: risiko dari PRODUK ───────────────────────
-- Salinan ugc_enqueue_batch dari 0300 dengan dua perubahan: (a) produk tanpa risiko ditolak, (b) risiko tinggi dibaca dari
-- ugc_products.risk_level (dijaga trigger 0600, tidak bisa diturunkan staf). panel_plan tetap dihormati sebagai tambahan.
create or replace function ugc_enqueue_batch(p_batch uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_char record; v_n int; v_bad int; v_risky int; v_norisk int;
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

  select count(*) into v_norisk from ugc_jobs j join ugc_products p on p.id = j.product_id
   where j.batch_id = p_batch and j.status = 'approved' and p.risk_level is null;
  if v_norisk > 0 then
    raise exception '% job memakai produk tanpa arketipe atau risiko; lengkapi produknya dulu', v_norisk using errcode = 'P0001';
  end if;

  select count(*) into v_risky from ugc_jobs j join ugc_products p on p.id = j.product_id
   where j.batch_id = p_batch and j.status = 'approved' and j.risk_approved_by is null
     and (p.risk_level = 'tinggi' or (j.panel_plan ->> 'needs_human_approval') = 'true');
  if v_risky > 0 then raise exception '% job berisiko tinggi menunggu persetujuan admin', v_risky using errcode = 'P0001'; end if;

  perform set_config('ugc.bypass', '1', true);
  update ugc_batches set status = 'queued' where id = p_batch;
  update ugc_jobs set status = 'queued', not_before = null where batch_id = p_batch and status = 'approved';
  return v_n;
end $$;

-- ── 4. Persetujuan risiko oleh admin ─────────────────────────────
create or replace function ugc_approve_risk(p_job uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_job ugc_jobs;
begin
  if not ugc_is_admin() then raise exception 'khusus admin' using errcode = '42501'; end if;
  select * into v_job from ugc_jobs where id = p_job for update;
  if not found then raise exception 'job tidak ditemukan' using errcode = 'P0002'; end if;
  if v_job.status not in ('draft', 'planned', 'storyboard_pending', 'storyboard_ready', 'json_ready', 'approved') then
    raise exception 'job berstatus %: persetujuan risiko hanya sebelum masuk antrean', v_job.status using errcode = 'P0001';
  end if;
  perform set_config('ugc.bypass', '1', true);
  update ugc_jobs set risk_approved_by = auth.uid() where id = p_job;
  insert into ugc_job_events (job_id, kind, step, message, agent, result)
  values (p_job, 'info', 'risk_approved', 'Disetujui admin' || coalesce(': ' || nullif(trim(p_note), ''), ''), 'admin', 'approved');
end $$;

-- ── 5. Kebijakan katalog tanpa tumpang tindih ────────────────────
-- 0600 membuat "admin kelola semua" (for all) di samping kebijakan baca: dua kebijakan permisif untuk SELECT pada tiap tabel.
-- Dipecah menjadi insert, update, delete khusus admin supaya sesuai standar 0400.
do $$
declare t text;
begin
  foreach t in array array['ugc_archetypes', 'ugc_locations', 'ugc_category_map'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_delete', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (ugc_is_admin())', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (ugc_is_admin()) with check (ugc_is_admin())', t || '_admin_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (ugc_is_admin())', t || '_admin_delete', t);
  end loop;
end $$;

revoke all on function ugc_enqueue_batch(uuid), ugc_approve_risk(uuid, text) from public, anon;
grant execute on function ugc_enqueue_batch(uuid), ugc_approve_risk(uuid, text) to authenticated;
