import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { fileURLToPath } from 'node:url';
const P = p => fileURLToPath(new URL(p, import.meta.url));
const BASE = readFileSync(P('../../supabase/baseline/20261002000000_baseline_legacy.sql'), 'utf8');
const EXPORT = readFileSync(P('../export_schema.sql'), 'utf8').replace(/^--.*$/gm, '');
const spec = JSON.parse(readFileSync(P('./legacy_spec.json'), 'utf8'));

const db = new PGlite();
await db.exec(`
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  alter table storage.objects enable row level security;
  create role authenticated nologin; create role anon nologin;
`);
await db.exec(BASE.replace(/^create extension.*$/gm, ''));
const rows = (await db.query(EXPORT)).rows;
const by = Object.fromEntries(rows.map(r => [r.section, r.data]));
const norm = s => (s ?? '').toString().replace(/\s+/g, ' ').trim();
let problems = 0;
const bad = (m) => { problems++; console.log('  ✖', m); };

// tabel + RLS
for (const [t, on] of Object.entries(spec.rls)) {
  const x = by.tables.find(r => r.name === t);
  if (!x) bad(`tabel ${t} tidak ada`); else if (x.rls_enabled !== on) bad(`RLS ${t}: ${x.rls_enabled} ≠ ${on}`);
}
console.log('tabel      :', by.tables.length, 'dari', Object.keys(spec.rls).length);

// kolom
let nc = 0;
for (const [t, cols] of Object.entries(spec.tables)) {
  cols.forEach((c, i) => {
    nc++;
    const x = by.columns.find(r => r.table === t && r.column === c.column);
    if (!x) return bad(`kolom ${t}.${c.column} tidak ada`);
    if (x.pos !== i + 1) bad(`urutan ${t}.${c.column}: ${x.pos} ≠ ${i + 1}`);
    if (norm(x.type) !== norm(c.type)) bad(`tipe ${t}.${c.column}: ${x.type} ≠ ${c.type}`);
    if (x.not_null !== c.not_null) bad(`not null ${t}.${c.column}`);
    if (norm(x.default) !== norm(c.default)) bad(`default ${t}.${c.column}: ${x.default} ≠ ${c.default}`);
  });
}
console.log('kolom      :', by.columns.length, 'dari', nc);

// constraint
for (const c of spec.constraints) {
  const x = by.constraints.find(r => r.table === c.table && r.name === c.name);
  if (!x) bad(`constraint ${c.name} tidak ada`);
  else if (norm(x.definition) !== norm(c.definition)) bad(`constraint ${c.name}:\n      dapat : ${x.definition}\n      asli  : ${c.definition}`);
}
console.log('constraint :', by.constraints.length, 'dari', spec.constraints.length);

// index
for (const n of spec.pkeys) if (!by.indexes.find(r => r.name === n)) bad(`index ${n} tidak ada`);
console.log('index      :', by.indexes.length, 'dari', spec.pkeys.length);

// policy
for (const p of spec.policies.filter(p => p.schema === 'public')) {
  const x = by.policies.find(r => r.schema === p.schema && r.table === p.table && r.name === p.name);
  if (!x) { bad(`policy ${p.name} tidak ada`); continue; }
  if (x.command !== p.command) bad(`policy ${p.name} perintah ${x.command} ≠ ${p.command}`);
  if (norm(x.using) !== norm(p.using)) bad(`policy ${p.name} using: ${x.using} ≠ ${p.using}`);
  if (norm(x.with_check) !== norm(p.with_check)) bad(`policy ${p.name} with_check: ${x.with_check} ≠ ${p.with_check}`);
  if (JSON.stringify(x.roles) !== JSON.stringify(p.roles)) bad(`policy ${p.name} roles ${JSON.stringify(x.roles)} ≠ ${JSON.stringify(p.roles)}`);
}
const stor = spec.policies.filter(p => p.schema === 'storage');
for (const p of stor) {
  const x = by.policies.find(r => r.schema === 'storage' && r.name === p.name);
  if (!x) { bad(`policy storage ${p.name} tidak ada`); continue; }
  if (x.command !== p.command) bad(`policy ${p.name} perintah`);
  if (norm(x.using) !== norm(p.using)) bad(`policy ${p.name} using: ${x.using} ≠ ${p.using}`);
  if (norm(x.with_check) !== norm(p.with_check)) bad(`policy ${p.name} with_check: ${x.with_check} ≠ ${p.with_check}`);
  if (JSON.stringify(x.roles) !== JSON.stringify(p.roles)) bad(`policy ${p.name} roles ${JSON.stringify(x.roles)} ≠ ${JSON.stringify(p.roles)}`);
}
console.log('policy     :', by.policies.length, 'dari', spec.policies.length);

// fungsi, trigger
const fn = n => by.functions.find(f => f.name === n);
if (!fn('is_admin') || !fn('is_admin').security_definer || fn('is_admin').returns !== 'boolean') bad('is_admin tidak sesuai');
if (!fn('update_updated_at') || fn('update_updated_at').returns !== 'trigger') bad('update_updated_at tidak sesuai');
console.log('fungsi     :', by.functions.length, 'dari 2');
for (const [t, n] of spec.triggers) {
  const x = by.triggers.find(r => r.name === n);
  if (!x || x.table !== t) bad(`trigger ${n}`);
}
console.log('trigger    :', by.triggers.length, 'dari', spec.triggers.length);

// bucket
for (const [id, pub, lim] of spec.buckets) {
  const x = by.storage_buckets.find(b => b.id === id);
  if (!x || x.public !== pub || (x.file_size_limit ?? null) !== (lim ?? null)) bad(`bucket ${id}`);
}
console.log('bucket     :', by.storage_buckets.length, 'dari', spec.buckets.length);

// hak akses
const gmap = {};
for (const g of by.grants_anon_authenticated) gmap[`${g.table}|${g.role}`] = g.privileges;
for (const [t, [an, au]] of Object.entries(spec.grants)) {
  if (gmap[`${t}|anon`] !== an) bad(`grant anon ${t}: ${gmap[`${t}|anon`]} ≠ ${an}`);
  if (gmap[`${t}|authenticated`] !== au) bad(`grant authenticated ${t}: ${gmap[`${t}|authenticated`]} ≠ ${au}`);
}
console.log('hak akses  :', by.grants_anon_authenticated.length, 'dari 14');
if (problems) { throw new Error(problems + ' ketidakcocokan'); }
console.log(problems === 0 ? '\nHASIL: baseline identik dengan struktur asli (semua pemeriksaan cocok).' : `\nHASIL: ${problems} ketidakcocokan.`);
const extra = by.constraints.filter(c => !spec.constraints.find(s => s.name === c.name));
console.log('constraint tambahan di PGlite (PG18):', extra.length, '| jenis:', [...new Set(extra.map(e => e.type))].join(','));
