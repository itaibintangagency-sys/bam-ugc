/* ══════════════════════════════════════
   BA UGC — Supabase client
   Isi SUPABASE_URL dan SUPABASE_ANON_KEY setelah project Supabase dibuat.
   Ambil dari: Supabase Dashboard → Project Settings → API.
   Untuk Vercel, paling aman taruh sebagai Environment Variables lalu
   inject saat build — untuk prototype ini cukup isi langsung di sini
   (anon key memang public-safe, bukan service_role key).
   ══════════════════════════════════════ */

const SUPABASE_URL = 'https://usrhroplsedwgkxywshw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzcmhyb3Bsc2Vkd2dreHl3c2h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTAwODIsImV4cCI6MjEwNDQyNjA4Mn0.vLKkBL24pBlN_vvKKmm8QCUPjVww6wqxPz69jK8ty2Y';

let supabaseClient = null;
let SUPABASE_READY = false;

// Aktif hanya kalau lib supabase-js sudah di-load via CDN (lihat <script> di tiap halaman)
// dan URL/key di atas sudah diisi. Sebelum itu, app jalan penuh di mode prototype (localStorage).
try {
  if (
    typeof window !== 'undefined' &&
    window.supabase &&
    !SUPABASE_URL.includes('YOUR-PROJECT') &&
    !SUPABASE_ANON_KEY.includes('YOUR-ANON')
  ) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    SUPABASE_READY = true;
  }
} catch (e) {
  console.warn('Supabase belum dikonfigurasi, jalan di mode prototype (localStorage).', e);
}
