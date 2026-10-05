-- =====================================================================
-- BA UGC | 0600_selaraskan_katalog.sql  (MIGRASI KOREKSI)
-- Menggantikan objek dari migrasi sebelumnya (migrasi_ba_ugc.sql) yang memakai
-- 7 arketipe A-G dan 9 lokasi contoh, dengan katalog asli proyek:
--   * 15 arketipe A-01..A-15  (core/data/archetypes_meta.json)
--   * 24 lokasi   S-01..S-24  (core/data/latar_dan_angle_master.json)
--   * peta 226 kategori marketplace -> arketipe (baru)
-- Sumber kebenaran tetap core/data; tabel di sini hanya CERMIN untuk FK dan
-- penjaga di database. Jalankan SETELAH paket 0500 (Tahap 4). Aman diulang.
-- Berhenti otomatis bila sudah ada data yang bergantung pada katalog lama.
-- =====================================================================
begin;

-- ---------------------------------------------------------------
-- 0. BERSIHKAN objek migrasi sebelumnya
-- ---------------------------------------------------------------
do $$
declare v_n bigint;
begin
  select (select count(*) from public.ugc_batches)
       + (select count(*) from public.ugc_jobs)
       + (select count(*) from public.ugc_products)
       + (select count(*) from public.ugc_characters)
    into v_n;
  if v_n > 0 then
    raise exception 'ugc_batches/jobs/products/characters berisi % baris; hentikan dan periksa dulu', v_n;
  end if;
end $$;

drop trigger  if exists ugc_products_apply_category   on public.ugc_products;
drop trigger  if exists ugc_characters_identity_guard on public.ugc_characters;
drop function if exists public.ugc_products_apply_category();
drop function if exists public.ugc_guard_identity_lock();

alter table public.ugc_batches    drop constraint if exists ugc_batches_fixed_needs_setting;
alter table public.ugc_batches    drop constraint if exists ugc_batches_setting_fk;
alter table public.ugc_jobs       drop constraint if exists ugc_jobs_setting_fk;
alter table public.ugc_products   drop constraint if exists ugc_products_archetype_fk;
alter table public.ugc_products   drop constraint if exists ugc_products_confirmed_complete;
alter table public.ugc_characters drop constraint if exists ugc_characters_identity_len;
alter table public.ugc_characters drop constraint if exists ugc_characters_identity_lock_complete;

alter table public.ugc_characters
  drop column if exists identity_text,
  drop column if exists anchor_features,
  drop column if exists model_lock,
  drop column if exists identity_locked_at,
  drop column if exists identity_locked_by;

drop table if exists public.ugc_category_map cascade;
drop table if exists public.ugc_archetypes   cascade;
drop table if exists public.ugc_locations    cascade;

drop policy if exists ugc_locations_storage_read   on storage.objects;
drop policy if exists ugc_locations_storage_write  on storage.objects;
drop policy if exists ugc_locations_storage_update on storage.objects;
-- Bucket 'ugc-locations' (privat, kosong) sengaja TIDAK dihapus lewat SQL karena Supabase
-- memblokir penghapusan langsung di tabel storage. Hapus lewat dashboard Storage bila mau.

delete from public.ugc_settings where key = 'identity_min_photos';

-- ---------------------------------------------------------------
-- 1. ARKETIPE (cermin core/data/archetypes_meta.json; 15 baris)
-- ---------------------------------------------------------------
create table public.ugc_archetypes (
  id         text primary key check (id ~ '^A-[0-9]{2}$'),
  nama       text not null,
  risk_level text not null check (risk_level in ('rendah','sedang','tinggi')),
  updated_at timestamptz not null default now()
);

insert into public.ugc_archetypes (id, nama, risk_level) values
  ('A-01', 'Busana dipakai', 'rendah'),
  ('A-02', 'Aksesori kepala, leher, dan tangan dipakai', 'rendah'),
  ('A-03', 'Alas kaki', 'rendah'),
  ('A-04', 'Tas dan koper', 'rendah'),
  ('A-05', 'Perawatan dan kecantikan topikal', 'sedang'),
  ('A-06', 'Wewangian dan aromaterapi', 'sedang'),
  ('A-07', 'Kesehatan, suplemen, dan obat', 'tinggi'),
  ('A-08', 'Makanan dan minuman', 'sedang'),
  ('A-09', 'Produk anak dan bayi (tanpa karakter anak)', 'sedang'),
  ('A-10', 'Elektronik dan gadget', 'rendah'),
  ('A-11', 'Peralatan elektrik rumah dan dapur', 'rendah'),
  ('A-12', 'Perlengkapan rumah non-elektrik', 'rendah'),
  ('A-13', 'Hobi, koleksi, mainan, dan souvenir', 'rendah'),
  ('A-14', 'Perawatan kendaraan', 'sedang'),
  ('A-15', 'Pakaian dalam dan produk sensitif', 'tinggi');

-- ---------------------------------------------------------------
-- 2. LOKASI (cermin core/data/latar_dan_angle_master.json -> tempat; 24 baris)
-- Deskripsi prompt, cahaya, dan akustik tetap di core; di sini hanya identitas.
-- ---------------------------------------------------------------
create table public.ugc_locations (
  id            text primary key check (id ~ '^S-[0-9]{2}$'),
  nama          text not null,
  tipe          text not null,
  catatan_risiko text,
  aktif         boolean not null default true,
  updated_at    timestamptz not null default now()
);

insert into public.ugc_locations (id, nama, tipe, catatan_risiko) values
  ('S-01', 'Ruang tamu minimalis modern', 'dalam rumah', null),
  ('S-02', 'Kamar tidur rapi', 'dalam rumah', null),
  ('S-03', 'Sudut cermin dan lemari pakaian', 'dalam rumah', 'pantulan cermin dapat memperlihatkan perangkat perekam'),
  ('S-04', 'Kamar mandi bersih', 'dalam rumah', 'label merek pada botol harus tidak terbaca'),
  ('S-05', 'Meja rias dekat jendela', 'dalam rumah', 'pantulan cermin'),
  ('S-06', 'Dapur rumah', 'dalam rumah', 'merek peralatan lain di latar'),
  ('S-07', 'Meja makan', 'dalam rumah', null),
  ('S-08', 'Meja kerja', 'dalam rumah', 'logo pada perangkat lain'),
  ('S-09', 'Kamar anak tanpa anak', 'dalam rumah', 'tidak boleh ada anak atau bayi'),
  ('S-10', 'Ruang cuci dan area jemur', 'dalam rumah', 'merek mesin lain'),
  ('S-11', 'Sudut ibadah yang rapi', 'dalam rumah', 'tampilkan dengan hormat, tanpa gerak berlebihan'),
  ('S-12', 'Teras rumah', 'luar rumah', 'orang lewat di jalan'),
  ('S-13', 'Taman atau halaman', 'luar rumah', 'bayangan keras pada wajah'),
  ('S-14', 'Balkon apartemen', 'luar rumah', 'gedung dengan papan nama'),
  ('S-15', 'Rooftop saat golden hour', 'luar rumah', 'highlight terbakar, bayangan keras'),
  ('S-16', 'Carport atau garasi', 'luar rumah', 'plat nomor harus tidak terbaca'),
  ('S-17', 'Jalan komplek pagi hari', 'luar rumah', 'orang lewat harus tidak dikenali'),
  ('S-18', 'Kafe kekinian', 'luar rumah', 'papan nama dan logo merek tidak boleh terbaca'),
  ('S-19', 'Interior mobil (kursi penumpang)', 'luar rumah', 'sopir, setir, plat nomor tidak masuk frame'),
  ('S-20', 'Studio backdrop polos', 'dalam rumah', 'kurang terasa UGC, aman untuk kesetiaan produk'),
  ('S-21', 'Warung atau pasar tradisional', 'luar rumah', 'orang di latar harus buram dan tidak dikenali'),
  ('S-22', 'Minimarket tanpa logo', 'dalam ruang publik', 'merek di rak tidak boleh terbaca'),
  ('S-23', 'Sudut olahraga atau gym kecil', 'dalam rumah', 'logo alat olahraga'),
  ('S-24', 'Meja tabletop flat lay', 'dalam rumah', 'properti tidak boleh menambah klaim');

-- setting_id yang sudah ada di batch/job wajib mengacu ke lokasi S-xx
alter table public.ugc_batches add constraint ugc_batches_setting_fk
  foreign key (setting_id) references public.ugc_locations(id) on update cascade;
alter table public.ugc_jobs add constraint ugc_jobs_setting_fk
  foreign key (setting_id) references public.ugc_locations(id) on update cascade;

-- ---------------------------------------------------------------
-- 3. PETA KATEGORI MARKETPLACE -> ARKETIPE (226 baris; kunci = "L1 > L2 > L3")
-- kepercayaan: seberapa yakin pemetaannya (rendah/sedang perlu ditinjau manusia).
-- flags/perlu_review = isyarat kebijakan tambahan, TIDAK mengubah risk_level arketipe.
-- ---------------------------------------------------------------
create table public.ugc_category_map (
  category_key  text primary key,
  l1            text not null,
  l2            text not null,
  l3            text,
  archetype_id  text not null references public.ugc_archetypes(id) on update cascade,
  alt_archetype_id text references public.ugc_archetypes(id) on update cascade,
  kepercayaan   text not null check (kepercayaan in ('rendah','sedang','tinggi')),
  flags         text[] not null default '{}',
  perlu_review  boolean not null default false,
  req_gender    text check (req_gender in ('perempuan','laki-laki')),
  req_hijab     text check (req_hijab in ('wajib','tanpa')),
  catatan_kebijakan text,
  updated_at    timestamptz not null default now()
);
create index ugc_category_map_archetype_idx on public.ugc_category_map (archetype_id);

insert into public.ugc_category_map (category_key, l1, l2, l3, archetype_id, alt_archetype_id, kepercayaan, flags, perlu_review, req_gender, req_hijab, catatan_kebijakan) values
  ('Aksesoris Fashion > Topi', 'Aksesoris Fashion', 'Topi', null, 'A-02', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Aksesoris Fashion > Aksesoris Rambut > Jepitan & Pin Rambut', 'Aksesoris Fashion', 'Aksesoris Rambut', 'Jepitan & Pin Rambut', 'A-02', null, 'tinggi', '{}'::text[], false, 'perempuan', 'tanpa', 'Karakter berhijab: demo sebagai pin hijab, bukan jepit rambut'),
  ('Aksesoris Fashion > Syal & Selendang', 'Aksesoris Fashion', 'Syal & Selendang', null, 'A-02', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Audio > Earphone, Headphone, & Headset', 'Audio', 'Earphone, Headphone, & Headset', null, 'A-10', null, 'sedang', '{}'::text[], false, null, null, null),
  ('Audio > Mikrofon & Aksesoris', 'Audio', 'Mikrofon & Aksesoris', null, 'A-10', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Audio > Perangkat Audio & Speaker > Home Theater & Karaoke', 'Audio', 'Perangkat Audio & Speaker', 'Home Theater & Karaoke', 'A-11', 'A-10', 'sedang', '{}'::text[], false, null, null, null),
  ('Audio > Perangkat Audio & Speaker > Speaker', 'Audio', 'Perangkat Audio & Speaker', 'Speaker', 'A-10', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Elektronik > Peralatan Listrik Besar > Mesin Cuci & Pengering', 'Elektronik', 'Peralatan Listrik Besar', 'Mesin Cuci & Pengering', 'A-11', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Elektronik > Perangkat Dapur > Oven', 'Elektronik', 'Perangkat Dapur', 'Oven', 'A-11', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Elektronik > Peralatan Listrik Kecil > Penyedot Debu & Peralatan Perawatan Lantai', 'Elektronik', 'Peralatan Listrik Kecil', 'Penyedot Debu & Peralatan Perawatan Lantai', 'A-11', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Elektronik > Peralatan Listrik Kecil > Setrika & Mesin Uap', 'Elektronik', 'Peralatan Listrik Kecil', 'Setrika & Mesin Uap', 'A-11', null, 'tinggi', array['KESELAMATAN']::text[], false, null, null, 'Hindari tangan menyentuh bagian panas'),
  ('Elektronik > Perangkat Dapur > Juicer, Blender & Mesin Kacang Kedelai', 'Elektronik', 'Perangkat Dapur', 'Juicer, Blender & Mesin Kacang Kedelai', 'A-11', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Elektronik > Perangkat Dapur > Food Processor & Penggiling Daging', 'Elektronik', 'Perangkat Dapur', 'Food Processor & Penggiling Daging', 'A-11', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Elektronik > Perangkat Dapur > Penanak Nasi', 'Elektronik', 'Perangkat Dapur', 'Penanak Nasi', 'A-11', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Elektronik > Perangkat Dapur > Alat Masak Serbaguna', 'Elektronik', 'Perangkat Dapur', 'Alat Masak Serbaguna', 'A-11', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Elektronik > Perangkat Dapur > Kompor & Regulator Gas', 'Elektronik', 'Perangkat Dapur', 'Kompor & Regulator Gas', 'A-11', null, 'tinggi', array['KESELAMATAN']::text[], false, null, null, 'Jangan tampilkan penggunaan gas yang tidak aman'),
  ('Elektronik > Perangkat Dapur > Air Fryer', 'Elektronik', 'Perangkat Dapur', 'Air Fryer', 'A-11', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Elektronik > Perangkat Dapur > Mixer', 'Elektronik', 'Perangkat Dapur', 'Mixer', 'A-11', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Elektronik > Proyektor & Aksesoris > Proyektor & Layar Proyektor', 'Elektronik', 'Proyektor & Aksesoris', 'Proyektor & Layar Proyektor', 'A-11', 'A-10', 'sedang', '{}'::text[], false, null, null, null),
  ('Elektronik > Peralatan Listrik Kecil > Purifier & Humidifier', 'Elektronik', 'Peralatan Listrik Kecil', 'Purifier & Humidifier', 'A-11', null, 'tinggi', array['KLAIM_KESEHATAN']::text[], true, null, null, 'Jangan klaim manfaat kesehatan/penyembuhan'),
  ('Elektronik > Kelistrikan > Stop Kontak & Sambungan Kabel', 'Elektronik', 'Kelistrikan', 'Stop Kontak & Sambungan Kabel', 'A-11', 'A-10', 'sedang', array['KESELAMATAN']::text[], false, null, null, 'Jangan tampilkan penggunaan tidak aman (beban berlebih, tangan basah)'),
  ('Elektronik > TV & Aksesoris > TV', 'Elektronik', 'TV & Aksesoris', 'TV', 'A-11', 'A-10', 'sedang', '{}'::text[], false, null, null, null),
  ('Fashion Bayi & Anak > Pakaian Anak Laki-Laki > Atasan', 'Fashion Bayi & Anak', 'Pakaian Anak Laki-Laki', 'Atasan', 'A-09', null, 'tinggi', array['ANAK']::text[], true, null, null, 'Jangan generate model anak; tampilkan flat-lay atau dipegang karakter dewasa'),
  ('Fashion Bayi & Anak > Pakaian Anak Laki-Laki > Jas & Setelan', 'Fashion Bayi & Anak', 'Pakaian Anak Laki-Laki', 'Jas & Setelan', 'A-09', null, 'tinggi', array['ANAK']::text[], true, null, null, 'Jangan generate model anak; tampilkan flat-lay atau dipegang karakter dewasa'),
  ('Fashion Bayi & Anak > Pakaian Anak Perempuan > Jas & Setelan', 'Fashion Bayi & Anak', 'Pakaian Anak Perempuan', 'Jas & Setelan', 'A-09', null, 'tinggi', array['ANAK']::text[], true, null, null, 'Jangan generate model anak; tampilkan flat-lay atau dipegang karakter dewasa'),
  ('Fashion Bayi & Anak > Pakaian Anak Perempuan > Dress', 'Fashion Bayi & Anak', 'Pakaian Anak Perempuan', 'Dress', 'A-09', null, 'tinggi', array['ANAK']::text[], true, null, null, 'Jangan generate model anak; tampilkan flat-lay atau dipegang karakter dewasa'),
  ('Fashion Bayi & Anak > Pakaian Anak Perempuan > Atasan', 'Fashion Bayi & Anak', 'Pakaian Anak Perempuan', 'Atasan', 'A-09', null, 'tinggi', array['ANAK']::text[], true, null, null, 'Jangan generate model anak; tampilkan flat-lay atau dipegang karakter dewasa'),
  ('Fashion Bayi & Anak > Aksesoris Bayi & Anak > Jam Tangan', 'Fashion Bayi & Anak', 'Aksesoris Bayi & Anak', 'Jam Tangan', 'A-09', 'A-02', 'sedang', array['ANAK']::text[], true, null, null, 'Tampilkan produk saja, tanpa model anak'),
  ('Fashion Bayi & Anak > Pakaian Anak Perempuan > Baju Tidur', 'Fashion Bayi & Anak', 'Pakaian Anak Perempuan', 'Baju Tidur', 'A-09', null, 'tinggi', array['ANAK']::text[], true, null, null, 'Jangan generate model anak; tampilkan flat-lay atau dipegang karakter dewasa'),
  ('Fashion Bayi & Anak > Pakaian Anak Perempuan > Pakaian Dalam', 'Fashion Bayi & Anak', 'Pakaian Anak Perempuan', 'Pakaian Dalam', 'A-15', 'A-09', 'tinggi', array['ANAK','INTIM']::text[], true, null, null, 'Produk saja, tanpa model; framing netral'),
  ('Fashion Bayi & Anak > Pakaian Anak Perempuan > Bawahan', 'Fashion Bayi & Anak', 'Pakaian Anak Perempuan', 'Bawahan', 'A-09', null, 'tinggi', array['ANAK']::text[], true, null, null, 'Jangan generate model anak; tampilkan flat-lay atau dipegang karakter dewasa'),
  ('Fashion Muslim > Mukena & Perlengkapan Sholat > Mukena Travel', 'Fashion Muslim', 'Mukena & Perlengkapan Sholat', 'Mukena Travel', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', 'wajib', null),
  ('Fashion Muslim > Mukena & Perlengkapan Sholat > Mukena', 'Fashion Muslim', 'Mukena & Perlengkapan Sholat', 'Mukena', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', 'wajib', null),
  ('Fashion Muslim > Pakaian Muslim Wanita > Dress', 'Fashion Muslim', 'Pakaian Muslim Wanita', 'Dress', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Fashion Muslim > Pakaian Muslim Anak > Pakaian Muslim Anak Perempuan', 'Fashion Muslim', 'Pakaian Muslim Anak', 'Pakaian Muslim Anak Perempuan', 'A-09', null, 'tinggi', array['ANAK']::text[], true, null, null, 'Jangan generate model anak; tampilkan flat-lay atau dipegang karakter dewasa'),
  ('Fashion Muslim > Pakaian Muslim Pria > Celana', 'Fashion Muslim', 'Pakaian Muslim Pria', 'Celana', 'A-01', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Fashion Muslim > Fashion Muslim Lainnya', 'Fashion Muslim', 'Fashion Muslim Lainnya', null, 'A-01', null, 'rendah', '{}'::text[], false, 'perempuan', null, null),
  ('Fashion Muslim > Pakaian Muslim Wanita > Hijab', 'Fashion Muslim', 'Pakaian Muslim Wanita', 'Hijab', 'A-02', 'A-01', 'tinggi', '{}'::text[], false, 'perempuan', 'wajib', null),
  ('Fashion Muslim > Pakaian Muslim Wanita > Baju Olahraga Muslim', 'Fashion Muslim', 'Pakaian Muslim Wanita', 'Baju Olahraga Muslim', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Fashion Muslim > Pakaian Muslim Wanita > Bawahan', 'Fashion Muslim', 'Pakaian Muslim Wanita', 'Bawahan', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Fashion Muslim > Set', 'Fashion Muslim', 'Set', null, 'A-01', null, 'sedang', '{}'::text[], false, 'perempuan', null, null),
  ('Fashion Muslim > Pakaian Muslim Wanita > Atasan', 'Fashion Muslim', 'Pakaian Muslim Wanita', 'Atasan', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Fashion Muslim > Pakaian Muslim Pria > Atasan', 'Fashion Muslim', 'Pakaian Muslim Pria', 'Atasan', 'A-01', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Fashion Muslim > Pakaian Muslim Pria > Gamis Pria', 'Fashion Muslim', 'Pakaian Muslim Pria', 'Gamis Pria', 'A-01', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Fashion Muslim > Pakaian Muslim Wanita > Pakaian Muslim Wanita Lainnya', 'Fashion Muslim', 'Pakaian Muslim Wanita', 'Pakaian Muslim Wanita Lainnya', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Fashion Muslim > Pakaian Muslim Pria > Sarung', 'Fashion Muslim', 'Pakaian Muslim Pria', 'Sarung', 'A-01', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Fashion Muslim > Outerwear > Cardigan', 'Fashion Muslim', 'Outerwear', 'Cardigan', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Handphone & Aksesoris > Aksesoris > Kipas USB', 'Handphone & Aksesoris', 'Aksesoris', 'Kipas USB', 'A-10', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Handphone & Aksesoris > Perangkat Wearable > Smartwatch & Fitness Tracker', 'Handphone & Aksesoris', 'Perangkat Wearable', 'Smartwatch & Fitness Tracker', 'A-02', 'A-10', 'sedang', '{}'::text[], false, null, null, null),
  ('Handphone & Aksesoris > Aksesoris > Powerbank & Baterai', 'Handphone & Aksesoris', 'Aksesoris', 'Powerbank & Baterai', 'A-10', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Handphone & Aksesoris > Aksesoris > Flash & Lampu Selfie Handphone', 'Handphone & Aksesoris', 'Aksesoris', 'Flash & Lampu Selfie Handphone', 'A-10', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Handphone & Aksesoris > Aksesoris > Aksesoris Selfie', 'Handphone & Aksesoris', 'Aksesoris', 'Aksesoris Selfie', 'A-10', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Handphone & Aksesoris > Aksesoris > USB & Lampu Handphone', 'Handphone & Aksesoris', 'Aksesoris', 'USB & Lampu Handphone', 'A-10', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Handphone & Aksesoris > Aksesoris > Kabel, Charger, & Konverter', 'Handphone & Aksesoris', 'Aksesoris', 'Kabel, Charger, & Konverter', 'A-10', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Handphone & Aksesoris > Handphone', 'Handphone & Aksesoris', 'Handphone', null, 'A-10', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Hobi & Koleksi > Souvenir & Hadiah > Gantungan Kunci', 'Hobi & Koleksi', 'Souvenir & Hadiah', 'Gantungan Kunci', 'A-13', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Hobi & Koleksi > Souvenir & Hadiah > Souvenir Lainnya', 'Hobi & Koleksi', 'Souvenir & Hadiah', 'Souvenir Lainnya', 'A-13', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Hobi & Koleksi > Koleksi > Action Figure', 'Hobi & Koleksi', 'Koleksi', 'Action Figure', 'A-13', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Ibu & Bayi > Kesehatan Bayi > Vitamin & Suplemen Bayi', 'Ibu & Bayi', 'Kesehatan Bayi', 'Vitamin & Suplemen Bayi', 'A-07', 'A-09', 'sedang', array['ANAK','KLAIM_KESEHATAN']::text[], true, null, null, 'Jangan tampilkan bayi/anak; tanpa klaim medis/hasil pasti'),
  ('Ibu & Bayi > Kesehatan Bayi > Perawatan Mulut Bayi', 'Ibu & Bayi', 'Kesehatan Bayi', 'Perawatan Mulut Bayi', 'A-09', null, 'tinggi', array['ANAK','KLAIM_KESEHATAN']::text[], true, null, null, 'Jangan tampilkan bayi/anak; tanpa klaim medis/hasil pasti'),
  ('Ibu & Bayi > Perlengkapan Makan Bayi > Peralatan Makan', 'Ibu & Bayi', 'Perlengkapan Makan Bayi', 'Peralatan Makan', 'A-09', null, 'tinggi', array['ANAK']::text[], true, null, null, 'Jangan tampilkan bayi/anak; produk saja'),
  ('Ibu & Bayi > Perlengkapan Makan Bayi > Perlengkapan Menyusui', 'Ibu & Bayi', 'Perlengkapan Makan Bayi', 'Perlengkapan Menyusui', 'A-09', null, 'tinggi', array['ANAK']::text[], true, null, null, 'Jangan tampilkan bayi/anak; produk saja'),
  ('Ibu & Bayi > Perlengkapan Travelling Bayi > Gendongan Bayi', 'Ibu & Bayi', 'Perlengkapan Travelling Bayi', 'Gendongan Bayi', 'A-09', null, 'tinggi', array['ANAK']::text[], true, null, null, 'Tunjukkan gendongan kosong atau dipakai karakter dewasa tanpa bayi'),
  ('Ibu & Bayi > Popok & Pispot > Perlak', 'Ibu & Bayi', 'Popok & Pispot', 'Perlak', 'A-09', null, 'tinggi', array['ANAK']::text[], true, null, null, 'Jangan tampilkan bayi/anak; produk saja'),
  ('Ibu & Bayi > Perlengkapan Makan Bayi > Perlengkapan Botol Susu', 'Ibu & Bayi', 'Perlengkapan Makan Bayi', 'Perlengkapan Botol Susu', 'A-09', null, 'tinggi', array['ANAK']::text[], true, null, null, 'Jangan tampilkan bayi/anak; produk saja'),
  ('Ibu & Bayi > Kesehatan Bayi > Perawatan Hidung & Pernafasan', 'Ibu & Bayi', 'Kesehatan Bayi', 'Perawatan Hidung & Pernafasan', 'A-07', 'A-09', 'sedang', array['ANAK','KLAIM_KESEHATAN']::text[], true, null, null, 'Jangan tampilkan bayi/anak; tanpa klaim medis/hasil pasti'),
  ('Ibu & Bayi > Perlengkapan Mandi > Tisu', 'Ibu & Bayi', 'Perlengkapan Mandi', 'Tisu', 'A-09', null, 'tinggi', array['ANAK']::text[], true, null, null, 'Jangan tampilkan bayi/anak; produk saja'),
  ('Ibu & Bayi > Kesehatan Bayi > Perawatan Kulit Bayi', 'Ibu & Bayi', 'Kesehatan Bayi', 'Perawatan Kulit Bayi', 'A-09', null, 'tinggi', array['ANAK','KLAIM_KESEHATAN']::text[], true, null, null, 'Jangan tampilkan bayi/anak; tanpa klaim medis/hasil pasti'),
  ('Ibu & Bayi > Mainan > Boneka & Mainan Boneka', 'Ibu & Bayi', 'Mainan', 'Boneka & Mainan Boneka', 'A-09', 'A-13', 'sedang', array['ANAK']::text[], true, null, null, 'Dipegang karakter dewasa; tanpa anak bermain'),
  ('Ibu & Bayi > Perlengkapan Mandi > Perawatan Rambut & Sabun Mandi', 'Ibu & Bayi', 'Perlengkapan Mandi', 'Perawatan Rambut & Sabun Mandi', 'A-09', null, 'tinggi', array['ANAK']::text[], true, null, null, 'Jangan tampilkan bayi/anak; produk saja'),
  ('Ibu & Bayi > Susu Formula & Makanan Bayi > Camilan Bayi', 'Ibu & Bayi', 'Susu Formula & Makanan Bayi', 'Camilan Bayi', 'A-09', 'A-08', 'sedang', array['ANAK','KLAIM_KESEHATAN']::text[], true, null, null, 'Jangan tampilkan bayi/anak; hindari klaim nutrisi berlebihan; cek kebijakan platform dan regulasi promosi produk bayi'),
  ('Ibu & Bayi > Susu Formula & Makanan Bayi > Susu Formula & Makanan Bayi Lainnya', 'Ibu & Bayi', 'Susu Formula & Makanan Bayi', 'Susu Formula & Makanan Bayi Lainnya', 'A-09', 'A-08', 'sedang', array['ANAK','KLAIM_KESEHATAN']::text[], true, null, null, 'Jangan tampilkan bayi/anak; hindari klaim nutrisi berlebihan; cek kebijakan platform dan regulasi promosi produk bayi'),
  ('Ibu & Bayi > Kesehatan Kehamilan > Vitamin & Suplemen Ibu Hamil', 'Ibu & Bayi', 'Kesehatan Kehamilan', 'Vitamin & Suplemen Ibu Hamil', 'A-07', null, 'tinggi', array['KLAIM_KESEHATAN']::text[], true, 'perempuan', null, 'Tanpa klaim medis/hasil pasti'),
  ('Ibu & Bayi > Mainan > Kendaraan Mainan', 'Ibu & Bayi', 'Mainan', 'Kendaraan Mainan', 'A-09', 'A-13', 'sedang', array['ANAK']::text[], true, null, null, 'Dipegang karakter dewasa; tanpa anak bermain'),
  ('Ibu & Bayi > Kesehatan Bayi > Sun Care Bayi', 'Ibu & Bayi', 'Kesehatan Bayi', 'Sun Care Bayi', 'A-09', null, 'tinggi', array['ANAK','KLAIM_KESEHATAN']::text[], true, null, null, 'Jangan tampilkan bayi/anak; tanpa klaim medis/hasil pasti'),
  ('Kamera & Drone > Aksesoris Kamera > Lighting & Perlengkapan Studio Foto', 'Kamera & Drone', 'Aksesoris Kamera', 'Lighting & Perlengkapan Studio Foto', 'A-10', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Kamera & Drone > Aksesoris Kamera > Tripod, Monopod, & Aksesoris', 'Kamera & Drone', 'Aksesoris Kamera', 'Tripod, Monopod, & Aksesoris', 'A-10', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Kamera & Drone > Aksesoris Kamera > Aksesoris Flash', 'Kamera & Drone', 'Aksesoris Kamera', 'Aksesoris Flash', 'A-10', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Kamera & Drone > Aksesoris Kamera > Gimbal & Stabilizer', 'Kamera & Drone', 'Aksesoris Kamera', 'Gimbal & Stabilizer', 'A-10', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Kesehatan > Suplemen Makanan > Kesejahteraan', 'Kesehatan', 'Suplemen Makanan', 'Kesejahteraan', 'A-07', null, 'tinggi', array['KLAIM_KESEHATAN']::text[], true, null, null, 'Tanpa klaim medis/penyembuhan/hasil pasti'),
  ('Kesehatan > Perawatan Diri > Perawatan Mulut', 'Kesehatan', 'Perawatan Diri', 'Perawatan Mulut', 'A-05', 'A-07', 'sedang', array['KLAIM_KESEHATAN']::text[], true, null, null, 'Tanpa klaim medis/hasil pasti'),
  ('Kesehatan > Obat-obatan & Alat Kesehatan > Timbangan & Alat Ukur Kadar Lemak', 'Kesehatan', 'Obat-obatan & Alat Kesehatan', 'Timbangan & Alat Ukur Kadar Lemak', 'A-10', 'A-07', 'sedang', array['KLAIM_KESEHATAN']::text[], true, null, null, 'Hindari angka berat badan/tubuh sebagai target; fokus fitur alat'),
  ('Kesehatan > Perawatan Diri > Alat Pijat & Terapi', 'Kesehatan', 'Perawatan Diri', 'Alat Pijat & Terapi', 'A-10', 'A-07', 'sedang', array['KLAIM_KESEHATAN']::text[], true, null, null, 'Tanpa klaim menyembuhkan/mengobati'),
  ('Kesehatan > Suplemen Makanan > Diet & Detoks', 'Kesehatan', 'Suplemen Makanan', 'Diet & Detoks', 'A-07', null, 'tinggi', array['KLAIM_KESEHATAN']::text[], true, null, null, 'Dilarang klaim penurunan berat badan/hasil angka; hindari tampilan tubuh sebagai target'),
  ('Kesehatan > Suplemen Makanan > Suplemen Kecantikan', 'Kesehatan', 'Suplemen Makanan', 'Suplemen Kecantikan', 'A-07', null, 'tinggi', array['KLAIM_KESEHATAN']::text[], true, null, null, 'Tanpa klaim medis/penyembuhan/hasil pasti'),
  ('Kesehatan > Obat-obatan & Alat Kesehatan > Obat Tradisional', 'Kesehatan', 'Obat-obatan & Alat Kesehatan', 'Obat Tradisional', 'A-07', null, 'tinggi', array['KLAIM_KESEHATAN']::text[], true, null, null, 'Dilarang klaim menyembuhkan/mengobati; ikuti izin edar produk'),
  ('Kesehatan > Perawatan Diri > Perawatan Diri Lainnya', 'Kesehatan', 'Perawatan Diri', 'Perawatan Diri Lainnya', 'A-05', 'A-07', 'rendah', '{}'::text[], false, null, null, null),
  ('Kesehatan > Perawatan Diri > Kewanitaan', 'Kesehatan', 'Perawatan Diri', 'Kewanitaan', 'A-15', null, 'tinggi', array['INTIM']::text[], true, 'perempuan', null, 'Produk saja, framing netral, tanpa menampilkan area intim'),
  ('Kesehatan > Perawatan Diri > Hand Sanitizer', 'Kesehatan', 'Perawatan Diri', 'Hand Sanitizer', 'A-05', 'A-12', 'sedang', array['KLAIM_KESEHATAN']::text[], true, null, null, 'Hindari klaim berlebihan (mis. angka pasti membunuh kuman)'),
  ('Koper & Tas Travel > Tas Travel > Tas Duffel', 'Koper & Tas Travel', 'Tas Travel', 'Tas Duffel', 'A-04', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Koper & Tas Travel > Tas Travel > Tas Serut', 'Koper & Tas Travel', 'Tas Travel', 'Tas Serut', 'A-04', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Koper & Tas Travel > Aksesoris Travel > Organizer Travel', 'Koper & Tas Travel', 'Aksesoris Travel', 'Organizer Travel', 'A-04', 'A-12', 'sedang', '{}'::text[], false, null, null, null),
  ('Makanan & Minuman > Makanan Ringan > Kacang', 'Makanan & Minuman', 'Makanan Ringan', 'Kacang', 'A-08', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Makanan & Minuman > Kebutuhan Memasak > Bumbu Masak', 'Makanan & Minuman', 'Kebutuhan Memasak', 'Bumbu Masak', 'A-08', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Makanan & Minuman > Kebutuhan Memasak > Penambah Rasa', 'Makanan & Minuman', 'Kebutuhan Memasak', 'Penambah Rasa', 'A-08', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Makanan & Minuman > Makanan Ringan > Popcorn', 'Makanan & Minuman', 'Makanan Ringan', 'Popcorn', 'A-08', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Makanan & Minuman > Makanan Ringan > Makanan Ringan Kering', 'Makanan & Minuman', 'Makanan Ringan', 'Makanan Ringan Kering', 'A-08', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Makanan & Minuman > Makanan Ringan > Makanan Ringan Lainnya', 'Makanan & Minuman', 'Makanan Ringan', 'Makanan Ringan Lainnya', 'A-08', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Mobil > Perawatan Kendaraan > Pembersih Kaca & Anti-Air', 'Mobil', 'Perawatan Kendaraan', 'Pembersih Kaca & Anti-Air', 'A-14', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Pakaian Pria > Atasan > Kemeja', 'Pakaian Pria', 'Atasan', 'Kemeja', 'A-01', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Pakaian Pria > Jaket, Mantel, & Rompi > Jaket', 'Pakaian Pria', 'Jaket, Mantel, & Rompi', 'Jaket', 'A-01', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Pakaian Pria > Celana Panjang > Cargo', 'Pakaian Pria', 'Celana Panjang', 'Cargo', 'A-01', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Pakaian Pria > Sweater & Cardigan', 'Pakaian Pria', 'Sweater & Cardigan', null, 'A-01', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Pakaian Pria > Celana Panjang > Celana Panjang', 'Pakaian Pria', 'Celana Panjang', 'Celana Panjang', 'A-01', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Pakaian Pria > Jas Formal > Celana Formal', 'Pakaian Pria', 'Jas Formal', 'Celana Formal', 'A-01', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Pakaian Pria > Jas Formal > Set Jas Formal', 'Pakaian Pria', 'Jas Formal', 'Set Jas Formal', 'A-01', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Pakaian Pria > Jas Formal > Rompi Formal', 'Pakaian Pria', 'Jas Formal', 'Rompi Formal', 'A-01', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Pakaian Pria > Celana Panjang Jeans', 'Pakaian Pria', 'Celana Panjang Jeans', null, 'A-01', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Pakaian Pria > Celana Pendek', 'Pakaian Pria', 'Celana Pendek', null, 'A-01', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Pakaian Wanita > Atasan > Kaos', 'Pakaian Wanita', 'Atasan', 'Kaos', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Celana Jeans', 'Pakaian Wanita', 'Celana Jeans', null, 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Celana Pendek > Celana Pendek', 'Pakaian Wanita', 'Celana Pendek', 'Celana Pendek', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Dress', 'Pakaian Wanita', 'Dress', null, 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Rok', 'Pakaian Wanita', 'Rok', null, 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Atasan > Kemeja & Blouse', 'Pakaian Wanita', 'Atasan', 'Kemeja & Blouse', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Set > Set Wanita', 'Pakaian Wanita', 'Set', 'Set Wanita', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Jaket, Mantel, & Rompi > Jaket', 'Pakaian Wanita', 'Jaket, Mantel, & Rompi', 'Jaket', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Set > Set Pakaian Keluarga', 'Pakaian Wanita', 'Set', 'Set Pakaian Keluarga', 'A-01', 'A-09', 'rendah', array['ANAK']::text[], true, null, null, 'Tampilkan hanya bagian dewasa atau flat-lay; tanpa model anak'),
  ('Pakaian Wanita > Celana Panjang & Legging > Celana Panjang', 'Pakaian Wanita', 'Celana Panjang & Legging', 'Celana Panjang', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Jaket, Mantel, & Rompi > Rompi', 'Pakaian Wanita', 'Jaket, Mantel, & Rompi', 'Rompi', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Pakaian Tidur & Piyama > Kimono', 'Pakaian Wanita', 'Pakaian Tidur & Piyama', 'Kimono', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Jaket, Mantel, & Rompi > Jaket, Mantel, & Rompi Lainnya', 'Pakaian Wanita', 'Jaket, Mantel, & Rompi', 'Jaket, Mantel, & Rompi Lainnya', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Jaket, Mantel, & Rompi > Cape', 'Pakaian Wanita', 'Jaket, Mantel, & Rompi', 'Cape', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Pakaian Tidur & Piyama > Pakaian Tidur & Piyama Lainnya', 'Pakaian Wanita', 'Pakaian Tidur & Piyama', 'Pakaian Tidur & Piyama Lainnya', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Pakaian Tradisional > Atasan Tradisional', 'Pakaian Wanita', 'Pakaian Tradisional', 'Atasan Tradisional', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Jaket, Mantel, & Rompi > Blazer', 'Pakaian Wanita', 'Jaket, Mantel, & Rompi', 'Blazer', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Pakaian Tidur & Piyama > Piyama', 'Pakaian Wanita', 'Pakaian Tidur & Piyama', 'Piyama', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Pakaian Tidur & Piyama > Daster', 'Pakaian Wanita', 'Pakaian Tidur & Piyama', 'Daster', 'A-01', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Pakaian Wanita > Pakaian Dalam > Celana Dalam', 'Pakaian Wanita', 'Pakaian Dalam', 'Celana Dalam', 'A-15', null, 'tinggi', array['INTIM']::text[], true, 'perempuan', null, 'Produk dipegang saja, tidak dikenakan'),
  ('Perawatan & Kecantikan > Perawatan Wajah > Pelembab Wajah', 'Perawatan & Kecantikan', 'Perawatan Wajah', 'Pelembab Wajah', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Tubuh > Sabun Mandi', 'Perawatan & Kecantikan', 'Perawatan Tubuh', 'Sabun Mandi', 'A-05', null, 'tinggi', array['PRIVASI_TUBUH']::text[], false, null, null, 'Jangan tampilkan area intim/tubuh terbuka'),
  ('Perawatan & Kecantikan > Perawatan Wajah > Pembersih Wajah', 'Perawatan & Kecantikan', 'Perawatan Wajah', 'Pembersih Wajah', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Kosmetik > Kosmetik Wajah', 'Perawatan & Kecantikan', 'Kosmetik', 'Kosmetik Wajah', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Kosmetik > Kosmetik Mata', 'Perawatan & Kecantikan', 'Kosmetik', 'Kosmetik Mata', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Kosmetik > Kosmetik Bibir', 'Perawatan & Kecantikan', 'Kosmetik', 'Kosmetik Bibir', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Kosmetik > Pembersih Make Up', 'Perawatan & Kecantikan', 'Kosmetik', 'Pembersih Make Up', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Wajah > Treatment Jerawat', 'Perawatan & Kecantikan', 'Perawatan Wajah', 'Treatment Jerawat', 'A-05', null, 'tinggi', array['KLAIM_KESEHATAN']::text[], true, null, null, 'Tanpa klaim medis/hasil pasti (jerawat hilang, perlindungan mutlak)'),
  ('Perawatan & Kecantikan > Perawatan Wajah > Toner', 'Perawatan & Kecantikan', 'Perawatan Wajah', 'Toner', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Wajah > Sunscreen Wajah', 'Perawatan & Kecantikan', 'Perawatan Wajah', 'Sunscreen Wajah', 'A-05', null, 'tinggi', array['KLAIM_KESEHATAN']::text[], true, null, null, 'Tanpa klaim medis/hasil pasti (jerawat hilang, perlindungan mutlak)'),
  ('Perawatan & Kecantikan > Perawatan Wajah > Serum & Essence Wajah', 'Perawatan & Kecantikan', 'Perawatan Wajah', 'Serum & Essence Wajah', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Rambut > Shampo', 'Perawatan & Kecantikan', 'Perawatan Rambut', 'Shampo', 'A-05', null, 'tinggi', '{}'::text[], false, null, 'tanpa', 'Rambut harus terlihat: karakter berhijab tidak cocok; pakai karakter berambut terlihat atau demo tangan + produk saja'),
  ('Perawatan & Kecantikan > Perawatan Rambut > Kondisioner Rambut dan Kulit Kepala', 'Perawatan & Kecantikan', 'Perawatan Rambut', 'Kondisioner Rambut dan Kulit Kepala', 'A-05', null, 'tinggi', '{}'::text[], false, null, 'tanpa', 'Rambut harus terlihat: karakter berhijab tidak cocok; pakai karakter berambut terlihat atau demo tangan + produk saja'),
  ('Perawatan & Kecantikan > Parfum & Wewangian', 'Perawatan & Kecantikan', 'Parfum & Wewangian', null, 'A-06', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Rambut > Treatment Rambut', 'Perawatan & Kecantikan', 'Perawatan Rambut', 'Treatment Rambut', 'A-05', null, 'tinggi', '{}'::text[], false, null, 'tanpa', 'Rambut harus terlihat: karakter berhijab tidak cocok; pakai karakter berambut terlihat atau demo tangan + produk saja'),
  ('Perawatan & Kecantikan > Alat Kecantikan > Aksesoris Make Up', 'Perawatan & Kecantikan', 'Alat Kecantikan', 'Aksesoris Make Up', 'A-05', 'A-10', 'rendah', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Alat Kecantikan > Alat Rambut', 'Perawatan & Kecantikan', 'Alat Kecantikan', 'Alat Rambut', 'A-05', 'A-10', 'rendah', '{}'::text[], false, null, 'tanpa', 'Rambut harus terlihat: karakter berhijab tidak cocok; pakai karakter berambut terlihat atau demo tangan + produk saja'),
  ('Perawatan & Kecantikan > Perawatan Pria > Perawatan Wajah', 'Perawatan & Kecantikan', 'Perawatan Pria', 'Perawatan Wajah', 'A-05', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Perawatan & Kecantikan > Perawatan Rambut > Pewarna Rambut', 'Perawatan & Kecantikan', 'Perawatan Rambut', 'Pewarna Rambut', 'A-05', null, 'tinggi', '{}'::text[], false, null, 'tanpa', 'Rambut harus terlihat: karakter berhijab tidak cocok; pakai karakter berambut terlihat atau demo tangan + produk saja'),
  ('Perawatan & Kecantikan > Paket & Set Kecantikan', 'Perawatan & Kecantikan', 'Paket & Set Kecantikan', null, 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Wajah > Treatment Mata', 'Perawatan & Kecantikan', 'Perawatan Wajah', 'Treatment Mata', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Pria > Shaving & Grooming', 'Perawatan & Kecantikan', 'Perawatan Pria', 'Shaving & Grooming', 'A-05', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Perawatan & Kecantikan > Alat Kecantikan > Alat Perawatan Wajah', 'Perawatan & Kecantikan', 'Alat Kecantikan', 'Alat Perawatan Wajah', 'A-05', 'A-10', 'rendah', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan & Kecantikan Lainnya', 'Perawatan & Kecantikan', 'Perawatan & Kecantikan Lainnya', null, 'A-05', null, 'sedang', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Perawatan & Kecantikan', 'Perawatan Tubuh', 'Body Cream, Body Lotion & Body Butter', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Wajah > Treatment Bibir', 'Perawatan & Kecantikan', 'Perawatan Wajah', 'Treatment Bibir', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Tubuh > Deodoran', 'Perawatan & Kecantikan', 'Perawatan Tubuh', 'Deodoran', 'A-05', null, 'tinggi', array['PRIVASI_TUBUH']::text[], false, null, null, 'Jangan tampilkan area ketiak'),
  ('Perawatan & Kecantikan > Perawatan Wajah > Masker Wajah', 'Perawatan & Kecantikan', 'Perawatan Wajah', 'Masker Wajah', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Tubuh > Scrub & Peel Tubuh', 'Perawatan & Kecantikan', 'Perawatan Tubuh', 'Scrub & Peel Tubuh', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Wajah > Perawatan Wajah Lainnya', 'Perawatan & Kecantikan', 'Perawatan Wajah', 'Perawatan Wajah Lainnya', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Pria > Perawatan Tubuh', 'Perawatan & Kecantikan', 'Perawatan Pria', 'Perawatan Tubuh', 'A-05', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Perawatan & Kecantikan > Perawatan Rambut > Hair Styling', 'Perawatan & Kecantikan', 'Perawatan Rambut', 'Hair Styling', 'A-05', null, 'tinggi', '{}'::text[], false, null, 'tanpa', 'Rambut harus terlihat: karakter berhijab tidak cocok; pakai karakter berambut terlihat atau demo tangan + produk saja'),
  ('Perawatan & Kecantikan > Perawatan Wajah > Scrub & Peel Wajah', 'Perawatan & Kecantikan', 'Perawatan Wajah', 'Scrub & Peel Wajah', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Pria > Perawatan Rambut', 'Perawatan & Kecantikan', 'Perawatan Pria', 'Perawatan Rambut', 'A-05', null, 'tinggi', '{}'::text[], false, 'laki-laki', 'tanpa', 'Rambut harus terlihat: karakter berhijab tidak cocok; pakai karakter berambut terlihat atau demo tangan + produk saja'),
  ('Perawatan & Kecantikan > Perawatan Tubuh > Perawatan Tubuh Lainnya', 'Perawatan & Kecantikan', 'Perawatan Tubuh', 'Perawatan Tubuh Lainnya', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Tubuh > Sun Care', 'Perawatan & Kecantikan', 'Perawatan Tubuh', 'Sun Care', 'A-05', null, 'tinggi', array['KLAIM_KESEHATAN']::text[], true, null, null, 'Tanpa klaim perlindungan mutlak'),
  ('Perawatan & Kecantikan > Perawatan Rambut > Perawatan Rambut Lainnya', 'Perawatan & Kecantikan', 'Perawatan Rambut', 'Perawatan Rambut Lainnya', 'A-05', null, 'tinggi', '{}'::text[], false, null, 'tanpa', 'Rambut harus terlihat: karakter berhijab tidak cocok; pakai karakter berambut terlihat atau demo tangan + produk saja'),
  ('Perawatan & Kecantikan > Perawatan Wajah > Facial Mist', 'Perawatan & Kecantikan', 'Perawatan Wajah', 'Facial Mist', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Tubuh > Minyak Tubuh', 'Perawatan & Kecantikan', 'Perawatan Tubuh', 'Minyak Tubuh', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Tangan', 'Perawatan & Kecantikan', 'Perawatan Tangan, Kaki & Kuku', 'Perawatan Tangan', 'A-05', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perlengkapan Dapur > Tempat Penyimpanan Makanan', 'Perlengkapan Rumah', 'Perlengkapan Dapur', 'Tempat Penyimpanan Makanan', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Peralatan Makan > Cangkir, Mug, & Gelas', 'Perlengkapan Rumah', 'Peralatan Makan', 'Cangkir, Mug, & Gelas', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Peralatan Makan > Botol Minum & Aksesoris', 'Perlengkapan Rumah', 'Peralatan Makan', 'Botol Minum & Aksesoris', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perlengkapan Dapur > Spatula & Capitan', 'Perlengkapan Rumah', 'Perlengkapan Dapur', 'Spatula & Capitan', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perawatan Rumah > Pembasmi Hama & Gulma', 'Perlengkapan Rumah', 'Perawatan Rumah', 'Pembasmi Hama & Gulma', 'A-12', null, 'tinggi', array['KESELAMATAN']::text[], false, null, null, 'Tampilkan peringatan kemasan; hindari penggunaan tidak aman'),
  ('Perlengkapan Rumah > Pengharum Ruangan & Aromaterapi > Diffuser, Humidifier, & Oil Burner', 'Perlengkapan Rumah', 'Pengharum Ruangan & Aromaterapi', 'Diffuser, Humidifier, & Oil Burner', 'A-06', 'A-11', 'sedang', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Lampu', 'Perlengkapan Rumah', 'Lampu', null, 'A-11', 'A-12', 'sedang', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perawatan Rumah > Pembersih', 'Perlengkapan Rumah', 'Perawatan Rumah', 'Pembersih', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Peralatan Makan > Mangkuk', 'Perlengkapan Rumah', 'Peralatan Makan', 'Mangkuk', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perawatan Rumah > Kain Pel', 'Perlengkapan Rumah', 'Perawatan Rumah', 'Kain Pel', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Kamar Tidur > Sprei, Sarung Bantal, & Sarung Guling', 'Perlengkapan Rumah', 'Kamar Tidur', 'Sprei, Sarung Bantal, & Sarung Guling', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perawatan Rumah > Sikat Pembersih', 'Perlengkapan Rumah', 'Perawatan Rumah', 'Sikat Pembersih', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perawatan Rumah > Kantong Plastik  & Kantong Sampah', 'Perlengkapan Rumah', 'Perawatan Rumah', 'Kantong Plastik  & Kantong Sampah', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perlengkapan Dapur > Timbangan Dapur', 'Perlengkapan Rumah', 'Perlengkapan Dapur', 'Timbangan Dapur', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perlengkapan Dapur > Rak Dapur', 'Perlengkapan Rumah', 'Perlengkapan Dapur', 'Rak Dapur', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Furniture > Kursi & Bangku', 'Perlengkapan Rumah', 'Furniture', 'Kursi & Bangku', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Kamar Mandi > Rak & Kabinet Kamar Mandi', 'Perlengkapan Rumah', 'Kamar Mandi', 'Rak & Kabinet Kamar Mandi', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Kamar Mandi > Kepala Shower & Spray Bidet', 'Perlengkapan Rumah', 'Kamar Mandi', 'Kepala Shower & Spray Bidet', 'A-12', null, 'tinggi', array['PRIVASI_TUBUH']::text[], false, null, null, 'Tanpa menampilkan tubuh; produk dan pemasangan saja'),
  ('Perlengkapan Rumah > Pengharum Ruangan & Aromaterapi > Minyak Esensial', 'Perlengkapan Rumah', 'Pengharum Ruangan & Aromaterapi', 'Minyak Esensial', 'A-06', null, 'sedang', array['KLAIM_KESEHATAN']::text[], true, null, null, 'Jangan klaim manfaat kesehatan/terapi'),
  ('Perlengkapan Rumah > Kamar Tidur > Bantal', 'Perlengkapan Rumah', 'Kamar Tidur', 'Bantal', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perawatan Rumah > Basin, Ember, & Gayung Air', 'Perlengkapan Rumah', 'Perawatan Rumah', 'Basin, Ember, & Gayung Air', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Kamar Mandi > Handuk Mandi & Kimono', 'Perlengkapan Rumah', 'Kamar Mandi', 'Handuk Mandi & Kimono', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perawatan Rumah > Tali Jemuran & Rak Pengering', 'Perlengkapan Rumah', 'Perawatan Rumah', 'Tali Jemuran & Rak Pengering', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perawatan Rumah > Kemoceng', 'Perlengkapan Rumah', 'Perawatan Rumah', 'Kemoceng', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perlengkapan Dapur > Alat & Aksesoris Pemanggang', 'Perlengkapan Rumah', 'Perlengkapan Dapur', 'Alat & Aksesoris Pemanggang', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Alat Pertukangan & Renovasi Rumah > Bak Cuci Piring & Kran Air', 'Perlengkapan Rumah', 'Alat Pertukangan & Renovasi Rumah', 'Bak Cuci Piring & Kran Air', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Kamar Tidur > Selimut', 'Perlengkapan Rumah', 'Kamar Tidur', 'Selimut', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Peralatan Makan > Piring', 'Perlengkapan Rumah', 'Peralatan Makan', 'Piring', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Peralatan Makan > Alat Makan', 'Perlengkapan Rumah', 'Peralatan Makan', 'Alat Makan', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perlengkapan Dapur > Alat & Dekorasi Baking', 'Perlengkapan Rumah', 'Perlengkapan Dapur', 'Alat & Dekorasi Baking', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perlengkapan Dapur > Celemek & Pelindung Tangan', 'Perlengkapan Rumah', 'Perlengkapan Dapur', 'Celemek & Pelindung Tangan', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Kamar Mandi > Shower Cap', 'Perlengkapan Rumah', 'Kamar Mandi', 'Shower Cap', 'A-12', null, 'tinggi', '{}'::text[], false, null, 'tanpa', 'Karakter berhijab tidak cocok untuk demo; pakai karakter berambut terlihat'),
  ('Perlengkapan Rumah > Perlengkapan Dapur > Talenan', 'Perlengkapan Rumah', 'Perlengkapan Dapur', 'Talenan', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perlengkapan Dapur > Panci', 'Perlengkapan Rumah', 'Perlengkapan Dapur', 'Panci', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perlengkapan Dapur > Penggorengan', 'Perlengkapan Rumah', 'Perlengkapan Dapur', 'Penggorengan', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Perlengkapan Dapur > Pisau & Gunting Dapur', 'Perlengkapan Rumah', 'Perlengkapan Dapur', 'Pisau & Gunting Dapur', 'A-12', null, 'tinggi', array['KESELAMATAN']::text[], false, null, null, 'Jangan acungkan benda tajam ke kamera'),
  ('Perlengkapan Rumah > Peralatan Makan > Jug, Pitcher, & Aksesoris', 'Perlengkapan Rumah', 'Peralatan Makan', 'Jug, Pitcher, & Aksesoris', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Perlengkapan Rumah > Dekorasi > Keset', 'Perlengkapan Rumah', 'Dekorasi', 'Keset', 'A-12', null, 'tinggi', '{}'::text[], false, null, null, null),
  ('Sepatu Pria > Sandal > Sandal Slide', 'Sepatu Pria', 'Sandal', 'Sandal Slide', 'A-03', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Sepatu Pria > Slip-On & Mules', 'Sepatu Pria', 'Slip-On & Mules', null, 'A-03', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Sepatu Pria > Sneakers', 'Sepatu Pria', 'Sneakers', null, 'A-03', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Sepatu Pria > Aksesoris & Perawatan Sepatu > Alat Perawatan & Pembersih Sepatu', 'Sepatu Pria', 'Aksesoris & Perawatan Sepatu', 'Alat Perawatan & Pembersih Sepatu', 'A-12', 'A-03', 'sedang', '{}'::text[], false, null, null, null),
  ('Sepatu Wanita > Wedges', 'Sepatu Wanita', 'Wedges', null, 'A-03', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Sepatu Wanita > Sepatu Flat > Flat & Ballerina', 'Sepatu Wanita', 'Sepatu Flat', 'Flat & Ballerina', 'A-03', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Sepatu Wanita > Sepatu Flat > Loafer', 'Sepatu Wanita', 'Sepatu Flat', 'Loafer', 'A-03', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Sepatu Wanita > Sepatu Flat > Slip-On, Mules & Mary Janes', 'Sepatu Wanita', 'Sepatu Flat', 'Slip-On, Mules & Mary Janes', 'A-03', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Sepatu Wanita > Sneakers', 'Sepatu Wanita', 'Sneakers', null, 'A-03', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Sepatu Wanita > Sepatu Flat > Sepatu Flat Lainnya', 'Sepatu Wanita', 'Sepatu Flat', 'Sepatu Flat Lainnya', 'A-03', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Sepatu Wanita > Sandal Jepit & Sandal Lainnya > Sandal Flat', 'Sepatu Wanita', 'Sandal Jepit & Sandal Lainnya', 'Sandal Flat', 'A-03', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Sepatu Wanita > Heels', 'Sepatu Wanita', 'Heels', null, 'A-03', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Tas Pria > Clutch', 'Tas Pria', 'Clutch', null, 'A-04', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Tas Pria > Tas Laptop > Ransel Laptop', 'Tas Pria', 'Tas Laptop', 'Ransel Laptop', 'A-04', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Tas Pria > Tas Selempang & Bahu Pria', 'Tas Pria', 'Tas Selempang & Bahu Pria', null, 'A-04', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Tas Pria > Tote Bag', 'Tas Pria', 'Tote Bag', null, 'A-04', null, 'tinggi', '{}'::text[], false, 'laki-laki', null, null),
  ('Tas Wanita > Top Handle Bag', 'Tas Wanita', 'Top Handle Bag', null, 'A-04', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Tas Wanita > Tote Bag', 'Tas Wanita', 'Tote Bag', null, 'A-04', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null),
  ('Tas Wanita > Tas Selempang & Bahu Wanita', 'Tas Wanita', 'Tas Selempang & Bahu Wanita', null, 'A-04', null, 'tinggi', '{}'::text[], false, 'perempuan', null, null);

-- RLS + hak akses (pola proyek: anon tanpa akses; baca semua peran; tulis hanya admin)
alter table public.ugc_archetypes   enable row level security;
alter table public.ugc_locations    enable row level security;
alter table public.ugc_category_map enable row level security;
revoke all on public.ugc_archetypes, public.ugc_locations, public.ugc_category_map from anon;
grant select, insert, update, delete on public.ugc_archetypes, public.ugc_locations, public.ugc_category_map to authenticated;

create policy ugc_archetypes_read on public.ugc_archetypes for select to authenticated using (ugc_role() is not null);
create policy ugc_archetypes_admin_write on public.ugc_archetypes for all to authenticated
  using (ugc_is_admin()) with check (ugc_is_admin());
create policy ugc_locations_read on public.ugc_locations for select to authenticated using (ugc_role() is not null);
create policy ugc_locations_admin_write on public.ugc_locations for all to authenticated
  using (ugc_is_admin()) with check (ugc_is_admin());
create policy ugc_category_map_read on public.ugc_category_map for select to authenticated using (ugc_role() is not null);
create policy ugc_category_map_admin_write on public.ugc_category_map for all to authenticated
  using (ugc_is_admin()) with check (ugc_is_admin());

-- ---------------------------------------------------------------
-- 4. PRODUK (ugc_products): kategori opsional + arketipe terjaga + lantai risiko
-- category_key boleh kosong (produk bisa dianalisis AI dari foto saja).
-- ---------------------------------------------------------------
alter table public.ugc_products
  add column if not exists category_key    text,
  add column if not exists category_source text;

alter table public.ugc_products drop constraint if exists ugc_products_category_source_check;
alter table public.ugc_products add constraint ugc_products_category_source_check
  check (category_source is null or category_source in ('ai','manual'));
alter table public.ugc_products drop constraint if exists ugc_products_category_fk;
alter table public.ugc_products add constraint ugc_products_category_fk
  foreign key (category_key) references public.ugc_category_map(category_key) on update cascade;
alter table public.ugc_products add constraint ugc_products_archetype_fk
  foreign key (archetype_id) references public.ugc_archetypes(id) on update cascade;
alter table public.ugc_products add constraint ugc_products_confirmed_complete
  check (status <> 'confirmed' or (archetype_id is not null and risk_level is not null));
create index if not exists ugc_products_category_idx on public.ugc_products (category_key);

create or replace function public.ugc_risk_rank(p text) returns int
language sql immutable set search_path = public as $$
  select case p when 'rendah' then 1 when 'sedang' then 2 when 'tinggi' then 3 else 0 end
$$;

create or replace function public.ugc_arch_rank(p text) returns int
language sql stable set search_path = public as $$
  select coalesce((select ugc_risk_rank(risk_level) from public.ugc_archetypes where id = p), 0)
$$;

-- Kategori mengisi arketipe otomatis (bisa ditimpa). risk_level tidak boleh di bawah
-- risiko arketipe produk (baru maupun lama) atau arketipe kategori, kecuali admin.
create or replace function public.ugc_products_apply_category() returns trigger
language plpgsql set search_path = public as $$
declare
  c       public.ugc_category_map;
  v_priv  boolean;
  v_floor int := 0;
  v_cat   boolean := false;
begin
  v_priv := coalesce(current_setting('ugc.bypass', true), '') = '1'
            or auth.uid() is null
            or coalesce(ugc_role(), '') = 'admin';

  if tg_op = 'UPDATE' and old.category_key is not null and new.category_key is null and not v_priv then
    raise exception 'kategori produk tidak boleh dikosongkan; minta admin' using errcode = '42501';
  end if;

  if new.category_key is not null then
    select * into c from public.ugc_category_map where category_key = new.category_key;
    v_cat := found;
    if v_cat then
      if tg_op = 'INSERT' then
        new.archetype_id := coalesce(new.archetype_id, c.archetype_id);
      elsif new.category_key is distinct from old.category_key
            and new.archetype_id is not distinct from old.archetype_id then
        new.archetype_id := c.archetype_id;
      end if;
      v_floor := greatest(v_floor, ugc_arch_rank(c.archetype_id));
    end if;
  end if;

  -- Gerbang persetujuan manusia membaca arketipe berisiko tinggi (A-07, A-15) lewat panel_plan.
  -- Staff tidak boleh menurunkan produk dari/ke bawah arketipe tinggi; admin boleh.
  if not v_priv and new.archetype_id is not null and ugc_arch_rank(new.archetype_id) < 3 then
    if (v_cat and ugc_arch_rank(c.archetype_id) = 3)
       or (tg_op = 'UPDATE' and ugc_arch_rank(old.archetype_id) = 3
           and new.archetype_id is distinct from old.archetype_id) then
      raise exception 'arketipe berisiko tinggi tidak boleh diturunkan oleh staff; minta admin'
        using errcode = '42501';
    end if;
  end if;

  v_floor := greatest(v_floor, ugc_arch_rank(new.archetype_id));
  if tg_op = 'UPDATE' then
    v_floor := greatest(v_floor, ugc_arch_rank(old.archetype_id));
  end if;

  if v_floor > 0 then
    if v_priv then
      new.risk_level := coalesce(new.risk_level,
        case v_floor when 3 then 'tinggi' when 2 then 'sedang' else 'rendah' end);
    elsif new.risk_level is null or ugc_risk_rank(new.risk_level) < v_floor then
      new.risk_level := case v_floor when 3 then 'tinggi' when 2 then 'sedang' else 'rendah' end;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.ugc_products_apply_category() from public, anon, authenticated;

create trigger ugc_products_apply_category before insert or update on public.ugc_products
  for each row execute function public.ugc_products_apply_category();

-- ---------------------------------------------------------------
-- 5. KARAKTER: DNA dibekukan sejak status dna_locked
-- Status dna_locked sudah ada, tetapi belum ada yang menahan perubahan dna sesudahnya.
-- Admin, fungsi sistem (ugc.bypass), dan SQL Editor/service_role tetap bisa mengubah.
-- ---------------------------------------------------------------
create or replace function public.ugc_guard_dna_freeze() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('ugc.bypass', true), '') = '1' then return new; end if;
  if auth.uid() is null then return new; end if;
  if coalesce(ugc_role(), '') = 'admin' then return new; end if;
  if new.dna is distinct from old.dna
     and old.status in ('dna_locked','voice_defined','sheet_ready','project_ready',
                        'voice_in_flow','intro_review','ready') then
    raise exception 'DNA karakter sudah dikunci (status %); minta admin untuk mengubahnya', old.status
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.ugc_guard_dna_freeze() from public, anon, authenticated;

drop trigger if exists ugc_characters_dna_freeze on public.ugc_characters;
create trigger ugc_characters_dna_freeze before update on public.ugc_characters
  for each row execute function public.ugc_guard_dna_freeze();

commit;

-- =====================================================================
-- VERIFIKASI (setelah migrasi)
--   select count(*) from ugc_archetypes;      -- 15
--   select count(*) from ugc_locations;       -- 24
--   select count(*) from ugc_category_map;    -- 226
--   select archetype_id, count(*) from ugc_category_map group by 1 order by 1;
--   select count(*) from ugc_category_map where kepercayaan <> 'tinggi';   -- yang perlu ditinjau
--   select column_name from information_schema.columns
--     where table_name = 'ugc_characters' and column_name in ('identity_text','anchor_features','model_lock');  -- 0 baris
--
-- Cek silang dengan core (jalankan di Node): jumlah kunci archetypes_meta = 15 dan
-- latar_dan_angle_master.tempat = 24; bila core berubah, bangkitkan ulang seed dari core/data.
--
-- ROLLBACK 0600 (tabel kosong): drop trigger ugc_characters_dna_freeze + fungsi ugc_guard_dna_freeze;
--   drop trigger ugc_products_apply_category + fungsi ugc_products_apply_category, ugc_arch_rank;
--   drop constraint ugc_products_archetype_fk/_category_fk/_confirmed_complete/_category_source_check;
--   drop constraint ugc_batches_setting_fk, ugc_jobs_setting_fk;
--   drop table ugc_category_map, ugc_locations, ugc_archetypes cascade.
-- =====================================================================
