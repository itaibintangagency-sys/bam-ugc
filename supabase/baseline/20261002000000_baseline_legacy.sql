-- ══════════════════════════════════════════════════════════════
-- BASELINE LEGACY — struktur database BA UGC lama (hanya CATATAN)
-- Direkonstruksi dari ekspor struktur database asli tanggal 2026-10-02
-- (PostgreSQL 17.6, Supabase). Database produksi SUDAH memiliki semua ini.
--
-- JANGAN dijalankan di database produksi (berkas ini kini berada di folder supabase/baseline, bukan migrations). Gunanya:
--   1) dokumentasi di repo tentang kondisi database sebelum v2;
--   2) membangun ulang lingkungan uji/baru dari nol (jalankan SEBELUM migrasi lain).
-- Isi data (baris tabel) tidak termasuk.
-- ══════════════════════════════════════════════════════════════

-- Pengaman: berkas ini hanya CATATAN. Bila database sudah memiliki tabel lama, berhenti dengan pesan jelas.
do $$
begin
  if to_regclass('public.backgrounds') is not null or to_regclass('public.video_jobs') is not null then
    raise exception 'Berkas ini hanya catatan struktur lama. Database ini SUDAH memiliki tabel lama, jadi berkas ini tidak perlu dan tidak boleh dijalankan. Lanjutkan ke folder migrations.';
  end if;
end $$;

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ── Tabel ────────────────────────────────────────────────────
create table if not exists public.backgrounds (
  id uuid not null default gen_random_uuid(),
  name text,
  type text,
  context_prompt text,
  storage_path text not null,
  aspect_ratio text default '9:16'::text,
  tags text[],
  created_at timestamp with time zone default now()
);

create table if not exists public.character_photos (
  id uuid not null default gen_random_uuid(),
  character_id uuid,
  storage_path text not null,
  telegram_file_id text,
  created_at timestamp with time zone default now(),
  shot_type text,
  expression text
);

create table if not exists public.characters (
  id uuid not null default gen_random_uuid(),
  name text not null,
  personality text,
  style text,
  avatar_id text,
  voice_id text,
  photos_count integer default 0,
  status text default 'draft'::text,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  pending_shot_type text default 'closeup'::text,
  pending_expression text default 'neutral'::text,
  gender text,
  reference_photo_url text,
  identity_lock text default 'none'::text,
  attributes jsonb,
  created_by uuid
);

create table if not exists public.frames (
  id uuid not null default gen_random_uuid(),
  video_job_id uuid not null,
  frame_number integer not null,
  script text,
  background_id uuid,
  background_image_url text,
  clip_url text,
  audio_url text,
  magnific_generation_id text,
  status text default 'pending'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.products (
  id uuid not null default gen_random_uuid(),
  name text not null,
  url text,
  platform text,
  price text,
  description text,
  selling_points text[],
  reviews_summary text,
  rating numeric(2,1),
  images text[],
  scraped_data jsonb,
  status text default 'active'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.user_profiles (
  id uuid not null,
  email text not null,
  name text,
  role text not null default 'staff'::text,
  created_at timestamp with time zone default now(),
  avatar_path text
);

create table if not exists public.video_jobs (
  id uuid not null default gen_random_uuid(),
  character_id uuid,
  product_photo_url text,
  product_name text,
  script text,
  audio_url text,
  video_url text,
  status text default 'analyzing'::text,
  error_message text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  product_id uuid,
  composite_image_url text,
  frame_plan jsonb,
  frames_count integer default 5,
  duration_per_frame integer default 10,
  current_step integer default 1,
  final_video_url text,
  magnific_space_id text,
  created_by uuid
);

-- ── Constraint (kunci utama, aturan nilai, kunci asing) ───────
alter table public.backgrounds add constraint backgrounds_pkey PRIMARY KEY (id);
alter table public.character_photos add constraint character_photos_pkey PRIMARY KEY (id);
alter table public.characters add constraint characters_pkey PRIMARY KEY (id);
alter table public.frames add constraint frames_pkey PRIMARY KEY (id);
alter table public.products add constraint products_pkey PRIMARY KEY (id);
alter table public.user_profiles add constraint user_profiles_pkey PRIMARY KEY (id);
alter table public.video_jobs add constraint video_jobs_pkey PRIMARY KEY (id);
alter table public.backgrounds add constraint backgrounds_type_check CHECK ((type = ANY (ARRAY['ai_generated'::text, 'uploaded'::text])));
alter table public.character_photos add constraint character_photos_expression_check CHECK ((expression = ANY (ARRAY['neutral'::text, 'smiling'::text, 'serious'::text, 'excited'::text])));
alter table public.character_photos add constraint character_photos_shot_type_check CHECK ((shot_type = ANY (ARRAY['closeup'::text, 'medium'::text, 'wide'::text])));
alter table public.characters add constraint characters_identity_lock_check CHECK ((identity_lock = ANY (ARRAY['locked'::text, 'reference'::text, 'none'::text])));
alter table public.characters add constraint characters_pending_expression_check CHECK ((pending_expression = ANY (ARRAY['neutral'::text, 'smiling'::text, 'serious'::text, 'excited'::text])));
alter table public.characters add constraint characters_pending_shot_type_check CHECK ((pending_shot_type = ANY (ARRAY['closeup'::text, 'medium'::text, 'wide'::text])));
alter table public.characters add constraint characters_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'collecting_photos'::text, 'avatar_processing'::text, 'avatar_ready'::text, 'voice_ready'::text, 'complete'::text, 'abandoned'::text])));
alter table public.characters add constraint characters_style_check CHECK ((style = ANY (ARRAY['review'::text, 'storytelling'::text, 'viral'::text])));
alter table public.frames add constraint frames_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'generating'::text, 'review'::text, 'approved'::text, 'regenerating'::text])));
alter table public.products add constraint products_platform_check CHECK ((platform = ANY (ARRAY['shopee'::text, 'tiktok'::text, 'tokopedia'::text, 'manual'::text])));
alter table public.products add constraint products_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])));
alter table public.user_profiles add constraint user_profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'staff'::text])));
alter table public.video_jobs add constraint video_jobs_status_check CHECK ((status = ANY (ARRAY['analyzing'::text, 'scripting'::text, 'generating_audio'::text, 'generating_video'::text, 'completed'::text, 'failed'::text])));
alter table public.character_photos add constraint character_photos_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE;
alter table public.characters add constraint characters_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.frames add constraint frames_background_id_fkey FOREIGN KEY (background_id) REFERENCES backgrounds(id) ON DELETE SET NULL;
alter table public.frames add constraint frames_video_job_id_fkey FOREIGN KEY (video_job_id) REFERENCES video_jobs(id) ON DELETE CASCADE;
alter table public.user_profiles add constraint user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.video_jobs add constraint fk_video_jobs_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
alter table public.video_jobs add constraint video_jobs_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id);
alter table public.video_jobs add constraint video_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

-- ── Fungsi ───────────────────────────────────────────────────
create or replace function public.is_admin()
 returns boolean
 language sql
 stable security definer
as $function$
  select exists (
    select 1 from user_profiles where id = auth.uid() and role = 'admin'
  );
$function$;

create or replace function public.update_updated_at()
 returns trigger
 language plpgsql
as $function$
begin new.updated_at = now(); return new; end;
$function$;

-- ── Trigger ──────────────────────────────────────────────────
create trigger trg_characters_updated_at before update on public.characters for each row execute function update_updated_at();
create trigger trg_frames_updated_at before update on public.frames for each row execute function update_updated_at();
create trigger trg_products_updated_at before update on public.products for each row execute function update_updated_at();
create trigger trg_video_jobs_updated_at before update on public.video_jobs for each row execute function update_updated_at();

-- ── Row Level Security ───────────────────────────────────────
alter table public.backgrounds disable row level security;  -- BELUM aktif pada kondisi asli
alter table public.character_photos enable row level security;
alter table public.characters enable row level security;
alter table public.frames disable row level security;  -- BELUM aktif pada kondisi asli
alter table public.products disable row level security;  -- BELUM aktif pada kondisi asli
alter table public.user_profiles enable row level security;
alter table public.video_jobs enable row level security;

-- ── Policy (public) ──────────────────────────────────────────
create policy "authenticated read character_photos" on public.character_photos as permissive for select
  using ((auth.role() = 'authenticated'::text));
create policy "admin write characters" on public.characters as permissive for all
  using (is_admin());
create policy "authenticated read characters" on public.characters as permissive for select
  using ((auth.role() = 'authenticated'::text));
create policy "admin read all profiles" on public.user_profiles as permissive for select
  using (is_admin());
create policy "read own profile" on public.user_profiles as permissive for select
  using ((auth.uid() = id));
create policy "update own name" on public.user_profiles as permissive for update
  using ((auth.uid() = id))
  with check ((auth.uid() = id));
create policy "own or admin modify video_jobs" on public.video_jobs as permissive for all
  using (((created_by = auth.uid()) OR is_admin()));
create policy "own or admin select video_jobs" on public.video_jobs as permissive for select
  using (((created_by = auth.uid()) OR is_admin()));

-- ── Hak akses tabel (kondisi asli) ───────────────────────────
-- Catatan: anon dan authenticated masih memegang TRUNCATE/REFERENCES/TRIGGER pada semua tabel.
revoke all on public.backgrounds from anon, authenticated;
grant references, trigger, truncate on public.backgrounds to anon;
grant references, trigger, truncate on public.backgrounds to authenticated;
revoke all on public.character_photos from anon, authenticated;
grant references, trigger, truncate on public.character_photos to anon;
grant delete, insert, references, select, trigger, truncate, update on public.character_photos to authenticated;
revoke all on public.characters from anon, authenticated;
grant references, trigger, truncate on public.characters to anon;
grant delete, insert, references, select, trigger, truncate, update on public.characters to authenticated;
revoke all on public.frames from anon, authenticated;
grant references, trigger, truncate on public.frames to anon;
grant delete, insert, references, select, trigger, truncate, update on public.frames to authenticated;
revoke all on public.products from anon, authenticated;
grant references, trigger, truncate on public.products to anon;
grant references, select, trigger, truncate on public.products to authenticated;
revoke all on public.user_profiles from anon, authenticated;
grant references, trigger, truncate on public.user_profiles to anon;
grant references, select, trigger, truncate, update on public.user_profiles to authenticated;
revoke all on public.video_jobs from anon, authenticated;
grant references, trigger, truncate on public.video_jobs to anon;
grant delete, insert, references, select, trigger, truncate, update on public.video_jobs to authenticated;

-- ── Penyimpanan: bucket dan policy storage.objects ───────────
insert into storage.buckets (id, name, public, file_size_limit) values ('avatars', 'avatars', false, null)
  on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;
insert into storage.buckets (id, name, public, file_size_limit) values ('character-assets', 'character-assets', true, 5242880)
  on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;
insert into storage.buckets (id, name, public, file_size_limit) values ('product-assets', 'product-assets', true, 5242880)
  on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;
insert into storage.buckets (id, name, public, file_size_limit) values ('video-outputs', 'video-outputs', true, null)
  on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

create policy "Allow anon uploads to product-assets" on storage.objects as permissive for insert to anon
  with check ((bucket_id = 'product-assets'::text));
create policy "authenticated read avatars" on storage.objects as permissive for select
  using (((bucket_id = 'avatars'::text) AND (auth.role() = 'authenticated'::text)));
create policy "authenticated read character-assets" on storage.objects as permissive for select to authenticated
  using ((bucket_id = 'character-assets'::text));
create policy "authenticated read product-assets" on storage.objects as permissive for select to authenticated
  using ((bucket_id = 'product-assets'::text));
create policy "authenticated read video-outputs" on storage.objects as permissive for select to authenticated
  using ((bucket_id = 'video-outputs'::text));
create policy "authenticated upload character-assets" on storage.objects as permissive for insert to authenticated
  with check ((bucket_id = 'character-assets'::text));
create policy "authenticated upload product-assets" on storage.objects as permissive for insert to authenticated
  with check ((bucket_id = 'product-assets'::text));
create policy "users update own avatar" on storage.objects as permissive for update
  using (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));
create policy "users upload own avatar" on storage.objects as permissive for insert
  with check (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));
