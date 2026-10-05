import { createClient } from '@supabase/supabase-js';

// Hanya dua nilai PUBLIK yang boleh ada di sini (URL proyek dan kunci anon). Rahasia tidak pernah masuk kode browser.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const konfigurasiLengkap = Boolean(url && key);
export const supabase = konfigurasiLengkap ? createClient(url, key) : null;
