// Edge Function analyze-product: menyambungkan handler.js ke Supabase (login, database, penyimpanan) dan ke internet.
// Kunci OpenRouter dibaca dari secret OPENROUTER_API_KEY (sama dengan generate-image); tidak pernah dikirim ke browser atau ditulis ke log.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './handler.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const BUCKET = 'ugc-products';
const kirim = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function keBase64(bytes: Uint8Array): string {
  let s = ''; const POTONG = 0x8000;
  for (let i = 0; i < bytes.length; i += POTONG) s += String.fromCharCode(...bytes.subarray(i, i + POTONG));
  return btoa(s);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return kirim(405, { ok: false, kode: 'metode', pesan: 'Gunakan POST.' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let body: unknown = null; try { body = await req.json(); } catch { body = null; }

  const d = {
    apiKey: Deno.env.get('OPENROUTER_API_KEY') ?? '',
    fetch: (u: string, o?: RequestInit) => fetch(u, o),
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),
    toBase64: keBase64,
    async getUser(jwt: string) { const { data, error } = await db.auth.getUser(jwt); return error || !data?.user ? null : { id: data.user.id }; },
    async getRole(id: string) { const { data } = await db.from('user_profiles').select('role').eq('id', id).maybeSingle(); return data?.role ?? null; },
    async getSettings(keys: string[]) { const { data } = await db.from('ugc_settings').select('key,value').in('key', keys); return Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value])); },
    async setSetting(key: string, value: unknown) { const { error } = await db.from('ugc_settings').upsert({ key, value, updated_at: new Date().toISOString() }); if (error) throw new Error(error.message); },
    async getProduct(id: string) {
      const { data, error } = await db.from('ugc_products').select('id,created_by,archetype_id,category_key,photos').eq('id', id).maybeSingle();
      if (error || !data) return null;
      let kategori = '';
      if (data.category_key) {
        const c = await db.from('ugc_category_map').select('l1,l2,l3').eq('category_key', data.category_key).maybeSingle();
        if (c.data) kategori = [c.data.l1, c.data.l2, c.data.l3].filter(Boolean).join(' > ');
      }
      return { ...data, kategori };
    },
    async reserveAnalysis(row: Record<string, unknown>, limit: number | null) {
      const { data, error } = await db.rpc('ugc_analysis_reserve', { p_id: row.id, p_user: row.user_id, p_product: row.product_id, p_model: row.model, p_limit: limit });
      if (error) { console.error('reserve gagal:', error.message); return 'galat'; }
      return data as string;
    },
    async updateRun(id: string, patch: Record<string, unknown>) { const { error } = await db.from('ugc_image_runs').update(patch).eq('id', id); if (error) throw new Error(error.message); },
    async downloadFoto(path: string) { const { data, error } = await db.storage.from(BUCKET).download(path); if (error || !data) return null; return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type }; }
  };

  const r = await handle({ token, body }, d);
  return kirim(r.status, r.json);
});
