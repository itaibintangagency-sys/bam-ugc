-- ══════════════════════════════════════════════════════════════
-- BA UGC — Pemeriksaan hasil migrasi (BACA-SAJA, tidak mengubah apa pun)
-- Cara pakai: Supabase → SQL Editor → New query → tempel → Run.
-- Hasilnya satu tabel. Kolom "status": OK = sesuai, PERIKSA = ada yang tidak sesuai,
-- BELUM = langkah manual yang memang belum kamu lakukan.
-- ══════════════════════════════════════════════════════════════
with legacy(t) as (values ('backgrounds'), ('character_photos'), ('characters'), ('frames'), ('products'), ('user_profiles'), ('video_jobs')),
ugc(t) as (values ('ugc_settings'), ('ugc_agent_control'), ('ugc_agents'), ('ugc_characters'), ('ugc_products'), ('ugc_batches'),
                  ('ugc_jobs'), ('ugc_job_events'), ('ugc_flow_snapshots'), ('ugc_character_photos'), ('ugc_character_tasks')),
fn(f) as (values ('ugc_role'), ('ugc_is_admin'), ('ugc_setting_int'), ('ugc_enqueue_batch'), ('ugc_review_job'), ('ugc_set_pause'),
                 ('ugc_agent_heartbeat'), ('ugc_claim_next_job'), ('ugc_job_progress'), ('ugc_log_event'), ('ugc_requeue_stale'),
                 ('ugc_request_char_task'), ('ugc_confirm_flow_character'), ('ugc_review_intro'), ('ugc_admin_mark_ready'),
                 ('ugc_claim_next_char_task'), ('ugc_char_task_progress')),
r(no, pemeriksaan, hasil, diharapkan, belum_ok) as (
  select 1, 'Tabel lama dengan RLS aktif (dari 7)',
         (select count(*) from pg_class c join legacy l on l.t = c.relname where c.relnamespace = 'public'::regnamespace and c.relrowsecurity)::text, '7', false
  union all select 2, 'Policy unggah anonim ke product-assets sudah hilang',
         (select count(*) from pg_policies where policyname = 'Allow anon uploads to product-assets')::text, '0', false
  union all select 3, 'Hak TRUNCATE tersisa pada tabel lama (anon/authenticated)',
         (select count(*) from legacy l cross join (values ('anon'), ('authenticated')) ro(r)
           where has_table_privilege(ro.r, 'public.' || l.t, 'truncate'))::text, '0', false
  union all select 4, 'Policy baru pada tabel lama (frames dan products)',
         (select count(*) from pg_policies where policyname in ('own or admin frames', 'authenticated read products'))::text, '2', false
  union all select 5, 'Tabel sistem v2 ada (dari 11)',
         (select count(*) from pg_class c join ugc u on u.t = c.relname where c.relnamespace = 'public'::regnamespace and c.relkind = 'r')::text, '11', false
  union all select 6, 'Tabel sistem v2 dengan RLS aktif (dari 11)',
         (select count(*) from pg_class c join ugc u on u.t = c.relname where c.relnamespace = 'public'::regnamespace and c.relrowsecurity)::text, '11', false
  union all select 7, 'Hak untuk anon pada tabel v2 (harus nol)',
         (select count(*) from ugc u cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate')) p(x)
           where has_table_privilege('anon', 'public.' || u.t, p.x))::text, '0', false
  union all select 8, 'Fungsi sistem v2 ada (dari 17)',
         (select count(distinct p.proname) from pg_proc p join fn on fn.f = p.proname where p.pronamespace = 'public'::regnamespace)::text, '17', false
  union all select 9, 'Bucket privat ugc-* (dari 4)',
         (select count(*) from storage.buckets where id like 'ugc-%' and public = false)::text, '4', false
  union all select 10, 'Pengaturan bawaan terisi (minimal 7)',
         (select count(*) from ugc_settings)::text, '>=7', false
  union all select 11, 'Role agent diizinkan pada user_profiles',
         (select count(*) from pg_constraint where conname = 'user_profiles_role_check' and pg_get_constraintdef(oid) like '%agent%')::text, '1', false
  union all select 12, 'Status karakter sudah memuat "ready"',
         (select count(*) from pg_constraint where conname = 'ugc_characters_status_check' and pg_get_constraintdef(oid) like '%intro_review%')::text, '1', false
  union all select 13, 'Aturan satu suara satu karakter (indeks unik) ada',
         (select count(*) from pg_indexes where indexname = 'ugc_characters_voice_base_uq')::text, '1', false
  union all select 14, 'Fungsi is_admin() dengan search_path terkunci',
         (select count(*) from pg_proc where proname = 'is_admin' and pronamespace = 'public'::regnamespace and proconfig is not null)::text, '1', false
  union all select 15, 'Akun agent (role = agent) sudah dibuat',
         (select count(*) from user_profiles where role = 'agent')::text, '>=1', true
  union all select 16, 'Karakter yang sudah berstatus ready',
         (select count(*) from ugc_characters where status = 'ready')::text, 'info', true
  union all select 17, 'Staff dapat mengubah kolom role/email profilnya sendiri (harus false)',
         has_column_privilege('authenticated', 'public.user_profiles', 'role', 'update')::text, 'false', false
  union all select 18, 'Fungsi SECURITY DEFINER milik sistem yang masih bisa dijalankan anon (harus 0)',
         (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
            and (p.proname like 'ugc\_%' or p.proname = 'is_admin') and has_function_privilege('anon', p.oid, 'execute'))::text, '0', false
)
select no as "no", pemeriksaan, hasil, diharapkan,
       case
         when diharapkan = 'info' then 'INFO'
         when diharapkan = '>=7' then case when hasil::int >= 7 then 'OK' else 'PERIKSA' end
         when diharapkan = '>=1' then case when hasil::int >= 1 then 'OK' else 'BELUM' end
         when hasil = diharapkan then 'OK'
         else 'PERIKSA'
       end as status
from r order by no;
