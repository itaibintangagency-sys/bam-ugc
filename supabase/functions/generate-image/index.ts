// Edge Function generate-image: menyambungkan handler.js ke Supabase (login, database, penyimpanan) dan ke internet.
// Kunci OpenRouter dibaca dari secret OPENROUTER_API_KEY; tidak pernah dikirim ke browser dan tidak pernah ditulis ke log.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './handler.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const BUCKET = 'ugc-characters';
const kirim = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function keBase64(bytes: Uint8Array): string {
  let s = ''; const POTONG = 0x8000;
  for (let i = 0; i < bytes.length; i += POTONG) s += String.fromCharCode(...bytes.subarray(i, i + POTONG));
  return btoa(s);
}
function dariBase64(b64: string): Uint8Array {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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
    fromBase64: dariBase64,
    async getUser(jwt: string) { const { data, error } = await db.auth.getUser(jwt); return error || !data?.user ? null : { id: data.user.id }; },
    async getRole(id: string) { const { data } = await db.from('user_profiles').select('role').eq('id', id).maybeSingle(); return data?.role ?? null; },
    async getSettings(keys: string[]) { const { data } = await db.from('ugc_settings').select('key,value').in('key', keys); return Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value])); },
    async setSetting(key: string, value: unknown) { const { error } = await db.from('ugc_settings').upsert({ key, value, updated_at: new Date().toISOString() }); if (error) throw new Error(error.message); },
    async reserve(row: Record<string, unknown>, limit: number | null) {
      const { data, error } = await db.rpc('ugc_image_reserve', { p_id: row.id, p_batch: row.batch_id, p_seq: row.seq, p_user: row.user_id, p_kind: row.kind, p_model: row.model, p_quality: row.quality, p_aspect: row.aspect_ratio, p_relation: row.relation, p_ref: row.ref_path, p_dna: row.dna, p_note: row.note, p_limit: limit });
      if (error) { console.error('reserve gagal:', error.message); return 'galat'; }
      return data as string;
    },
    async updateRun(id: string, patch: Record<string, unknown>) { const { error } = await db.from('ugc_image_runs').update(patch).eq('id', id); if (error) throw new Error(error.message); },
    async downloadRef(path: string) { const { data, error } = await db.storage.from(BUCKET).download(path); if (error || !data) return null; return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type }; },
    async uploadImage(path: string, bytes: Uint8Array, contentType: string) { const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true }); if (error) throw new Error(error.message); }
  };

  const r = await handle({ token, body }, d);
  return kirim(r.status, r.json);
});
