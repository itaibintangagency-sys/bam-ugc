-- ══════════════════════════════════════════════════════════════
-- BA UGC — Ekspor STRUKTUR database (baca-saja, tanpa isi data)
-- Cara pakai: Supabase Dashboard → SQL Editor → New query → tempel semua
-- isi berkas ini → Run → klik "Export" pada hasil → "Download CSV".
-- Kueri ini tidak mengubah apa pun dan tidak membaca isi baris tabel.
-- ══════════════════════════════════════════════════════════════
-- Ubah ke false jika kamu tidak ingin isi (badan) fungsi ikut terkirim.
with params as (select true as include_function_bodies),

tbl as (
  select c.oid, n.nspname as schema, c.relname as name, c.relkind, c.relrowsecurity as rls_enabled,
         c.relforcerowsecurity as rls_forced, greatest(c.reltuples::bigint, 0) as approx_rows,
         obj_description(c.oid) as comment
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
),

sections as (
  select 'meta' as section,
         jsonb_build_object(
           'exported_at', now(), 'database', current_database(), 'version', version(),
           'extensions', (select coalesce(jsonb_agg(extname order by extname), '[]'::jsonb) from pg_extension)
         ) as data

  union all
  select 'tables', coalesce(jsonb_agg(jsonb_build_object(
           'schema', schema, 'name', name,
           'kind', case relkind when 'r' then 'table' when 'p' then 'partitioned' when 'v' then 'view' when 'm' then 'matview' end,
           'rls_enabled', rls_enabled, 'rls_forced', rls_forced, 'approx_rows', approx_rows, 'comment', comment) order by name), '[]'::jsonb)
  from tbl

  union all
  select 'columns', coalesce(jsonb_agg(jsonb_build_object(
           'table', t.name, 'pos', a.attnum, 'column', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
           'not_null', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid),
           'identity', nullif(a.attidentity::text, ''), 'generated', nullif(a.attgenerated::text, ''),
           'comment', col_description(a.attrelid, a.attnum)) order by t.name, a.attnum), '[]'::jsonb)
  from tbl t
  join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum

  union all
  select 'constraints', coalesce(jsonb_agg(jsonb_build_object(
           'table', t.name, 'name', co.conname,
           'type', case co.contype when 'p' then 'primary key' when 'f' then 'foreign key' when 'u' then 'unique' when 'c' then 'check' when 'x' then 'exclude' else co.contype::text end,
           'definition', pg_get_constraintdef(co.oid)) order by t.name, co.conname), '[]'::jsonb)
  from tbl t join pg_constraint co on co.conrelid = t.oid

  union all
  select 'indexes', coalesce(jsonb_agg(jsonb_build_object('table', tablename, 'name', indexname, 'definition', indexdef) order by tablename, indexname), '[]'::jsonb)
  from pg_indexes where schemaname = 'public'

  union all
  select 'policies', coalesce(jsonb_agg(jsonb_build_object(
           'schema', schemaname, 'table', tablename, 'name', policyname, 'permissive', permissive,
           'roles', roles, 'command', cmd, 'using', qual, 'with_check', with_check) order by schemaname, tablename, policyname), '[]'::jsonb)
  from pg_policies where schemaname in ('public', 'storage')

  union all
  select 'functions', coalesce(jsonb_agg(jsonb_build_object(
           'name', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'returns', pg_get_function_result(p.oid),
           'security_definer', p.prosecdef, 'language', l.lanname,
           'definition', case when (select include_function_bodies from params) then pg_get_functiondef(p.oid) else '(disembunyikan)' end
         ) order by p.proname), '[]'::jsonb)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  join pg_language l on l.oid = p.prolang
  where p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend dp where dp.objid = p.oid and dp.deptype = 'e')

  union all
  select 'triggers', coalesce(jsonb_agg(jsonb_build_object(
           'table', tg.tgrelid::regclass::text, 'name', tg.tgname, 'definition', pg_get_triggerdef(tg.oid)) order by tg.tgrelid::regclass::text, tg.tgname), '[]'::jsonb)
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not tg.tgisinternal and (n.nspname = 'public' or tg.tgrelid::regclass::text = 'auth.users')

  union all
  select 'views', coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'definition', pg_get_viewdef(t.oid, true)) order by t.name), '[]'::jsonb)
  from tbl t where t.relkind in ('v', 'm')

  union all
  select 'enums', coalesce(jsonb_agg(jsonb_build_object(
           'type', ty.typname, 'values', (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = ty.oid)) order by ty.typname), '[]'::jsonb)
  from pg_type ty join pg_namespace n on n.oid = ty.typnamespace
  where n.nspname = 'public' and ty.typtype = 'e'

  union all
  select 'storage_buckets', coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'name', name, 'public', public, 'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types) order by id), '[]'::jsonb)
  from storage.buckets

  union all
  select 'grants_anon_authenticated', coalesce(jsonb_agg(jsonb_build_object(
           'table', table_name, 'role', grantee, 'privileges', privs) order by table_name, grantee), '[]'::jsonb)
  from (
    select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
    group by table_name, grantee
  ) g

  union all
  select 'realtime_tables', coalesce(jsonb_agg(jsonb_build_object('schema', schemaname, 'table', tablename) order by tablename), '[]'::jsonb)
  from pg_publication_tables where pubname = 'supabase_realtime'
)
select section, data from sections order by section;
