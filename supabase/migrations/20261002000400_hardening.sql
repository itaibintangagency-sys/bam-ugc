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
