// Menerjemahkan galat login Supabase ke bahasa yang jelas bagi staf.
export function authErrorMessage(err) {
  const raw = String((err && err.message) || err || '').toLowerCase();
  if (!raw) return 'Gagal masuk. Coba lagi.';
  if (raw.includes('invalid login credentials')) return 'Email atau kata sandi salah.';
  if (raw.includes('email not confirmed')) return 'Email belum dikonfirmasi. Hubungi admin.';
  if (raw.includes('too many requests') || raw.includes('rate limit')) return 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.';
  if (raw.includes('failed to fetch') || raw.includes('network')) return 'Tidak bisa terhubung ke server. Periksa koneksi internet.';
  return 'Gagal masuk. Coba lagi, atau hubungi admin bila berulang.';
}
