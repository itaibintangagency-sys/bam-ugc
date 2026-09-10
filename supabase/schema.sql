-- ══════════════════════════════════════
-- BA UGC — Supabase schema
-- Jalankan di Supabase Dashboard → SQL Editor.
-- Mengikuti struktur tabel yang sudah dipakai di project (lihat memori proyek).
-- ══════════════════════════════════════

create extension if not exists "pgcrypto";

create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  personality text,
  style text,
  voice_id text,
  gender text,
  hijab boolean default false,
  primary_photo text,
  status text default 'active',
  video_count int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists character_photos (
  id uuid primary key default gen_random_uuid(),
  character_id uuid references characters(id) on delete cascade,
  storage_path text not null,
  is_primary boolean default false,
  created_at timestamptz default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text,
  platform text,
  price text,
  category text,
  description text,
  selling_points text[],
  reviews_summary text,
  rating numeric,
  images text[],
  scraped_data jsonb,
  created_at timestamptz default now()
);

create table if not exists backgrounds (
  id uuid primary key default gen_random_uuid(),
  name text,
  type text, -- 'ai_generated' | 'uploaded'
  context_prompt text,
  storage_path text,
  aspect_ratio text default '9:16',
  tags text[],
  created_at timestamptz default now()
);

create table if not exists video_jobs (
  id uuid primary key default gen_random_uuid(),
  character_id uuid references characters(id),
  product_id uuid references products(id),
  title text,
  composite_image_url text,
  frame_plan jsonb,
  frames_count int default 0,
  duration_per_frame int,
  current_step int default 1, -- 1..4
  status text default 'draft', -- draft | review | generating | complete
  final_video_url text,
  magnific_space_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists frames (
  id uuid primary key default gen_random_uuid(),
  video_job_id uuid references video_jobs(id) on delete cascade,
  frame_number int not null,
  label text,
  time_range text,
  script text,
  background_id uuid references backgrounds(id),
  background_override_url text,
  clip_url text,
  magnific_generation_id text,
  status text default 'pending', -- pending | generating | approved
  created_at timestamptz default now()
);

-- ── Row Level Security ──────────────────────
-- MVP: semua user yang sudah login (admin & staff) boleh baca/tulis.
-- Perketat per-role kalau kebutuhan "staff cuma lihat riwayat sendiri" mau ditegakkan di DB level.

alter table characters enable row level security;
alter table character_photos enable row level security;
alter table products enable row level security;
alter table backgrounds enable row level security;
alter table video_jobs enable row level security;
alter table frames enable row level security;

create policy "authenticated read/write characters" on characters for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write character_photos" on character_photos for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write products" on products for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write backgrounds" on backgrounds for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write video_jobs" on video_jobs for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write frames" on frames for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ── Storage buckets (jalankan lewat Dashboard → Storage, bukan SQL) ──
-- character-assets (private), product-assets (private), video-outputs (private)
