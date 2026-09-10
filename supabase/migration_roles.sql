-- ══════════════════════════════════════
-- BA UGC — Role system migration
-- Jalankan di Supabase SQL Editor
-- ══════════════════════════════════════

CREATE TABLE user_profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  name       TEXT,
  role       TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: aktifkan
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- User boleh baca profil sendiri
CREATE POLICY "read own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = id);

-- Admin boleh baca semua profil (dicek lewat fungsi helper di bawah)
CREATE POLICY "admin read all profiles" ON user_profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role = 'admin')
  );

-- User boleh update nama sendiri saja (bukan role — role cuma bisa diubah backend/service_role)
CREATE POLICY "update own name" ON user_profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- INSERT sengaja TIDAK dibuka untuk anon/authenticated — cuma service_role (dipanggil dari n8n)
-- yang boleh bikin baris baru, supaya pembuatan akun staff selalu lewat backend aman.

-- Tambahkan created_by ke video_jobs, sesuai desain "staff cuma lihat video sendiri"
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

-- video_jobs RLS: staff cuma lihat/kelola miliknya sendiri, admin lihat semua
ALTER TABLE video_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own or admin select video_jobs" ON video_jobs
  FOR SELECT USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role = 'admin')
  );

CREATE POLICY "own or admin modify video_jobs" ON video_jobs
  FOR ALL USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role = 'admin')
  );

-- PENTING: setelah migration ini jalan, buat baris user_profiles untuk akun admin
-- yang sudah ada sekarang secara manual, contoh:
-- INSERT INTO user_profiles (id, email, name, role)
-- VALUES ('<uuid-user-supabase-auth>', 'itai.bintangagency@...', 'Patrik', 'admin');
