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
