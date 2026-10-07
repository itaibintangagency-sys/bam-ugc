import { describe, expect, it, vi } from 'vitest';
import {
  CONTOH_C02, LABEL, LABEL_SUARA, OPT, OPTIONS, appearanceOf, barisKarakter, buatKarakter, cekFoto, cekIdentitas, cekProject, cekSuara, cleanDna, dnaIssues, dnaKosong,
  ekstensi, galatAwam, infoStatus, jalurFoto, langkahBerikut, lengkap, nilaiDimensi, pasangFoto, pilihanSuara, suaraAwal, syaratSiap, tandaiSiap, teksPerforma, ubahProject
} from '../src/lib/karakter.js';

const KALIMAT_C02 = 'A young woman in her early twenties with long, wavy, light-brown hair with soft caramel highlights, parted in the middle, a soft oval face, a fair to light complexion, and a bright cheerful smile.';
const berkas = (type, size) => ({ type, size });

// Klien tiruan: mencatat panggilan dan mengembalikan hasil yang ditentukan per tabel dan operasi.
function klien(atur = {}) {
  const log = [];
  const hasil = (t, op) => (atur[`${t}.${op}`] !== undefined ? (typeof atur[`${t}.${op}`] === 'function' ? atur[`${t}.${op}`]() : atur[`${t}.${op}`]) : { data: [], error: null });
  const from = t => { const st = { t, op: 'select', args: {} }; const b = {
    select(kolom) { st.kolom = kolom; return b; }, order() { return b; }, eq(k, v) { st.args[k] = v; return b; },
    insert(v) { st.op = 'insert'; st.args.v = v; return b; }, update(v) { st.op = 'update'; st.args.v = v; return b; },
    then(res, rej) { log.push({ ...st }); return Promise.resolve(hasil(t, st.op)).then(res, rej); } }; return b; };
  const storage = { from: () => ({ upload: async (path, f, o) => { log.push({ t: 'storage', op: 'upload', args: { path, o } }); return atur.upload !== undefined ? atur.upload : { data: {}, error: null }; } }) };
  return { from, storage, rpc: async (fn, a) => { log.push({ t: 'rpc', fn, a }); return atur.rpc || { data: null, error: null }; }, log };
}

describe('label dan pilihan', () => {
  it('setiap pilihan DNA dan suara punya label Indonesia', () => {
    for (const g of Object.keys(LABEL)) for (const k of OPTIONS[g]) expect(LABEL[g][k], `${g}.${k}`).toBeTruthy();
    for (const g of ['nada', 'energi', 'tempo', 'gaya', 'aksen', 'bahasa']) for (const k of Object.keys(OPT[g])) expect(LABEL_SUARA[g][k], `${g}.${k}`).toBeTruthy();
    for (const k of Object.keys(OPT.usia)) expect(LABEL_SUARA.usia[k], k).toBeTruthy();
  });
  it('hanya dewasa: tidak ada kelompok usia di bawah 21 dan DNA remaja ditolak', () => {
    expect(OPTIONS.age_group).toEqual(['dewasa_muda', 'muda', 'dewasa', 'matang']);
    expect(Object.keys(OPT.usia)).not.toContain('remaja_akhir');
    expect(dnaIssues({ ...CONTOH_C02.dna, age_group: 'remaja_akhir' }).some(i => /dewasa/.test(i.msg))).toBe(true);
    expect(dnaIssues({ ...CONTOH_C02.dna, distinguishing: 'a teenage girl look' }).length).toBeGreaterThan(0);
    expect(dnaIssues({ ...CONTOH_C02.dna, outfit: 'casual' }).some(i => i.field === 'outfit')).toBe(true);
  });
});

describe('DNA', () => {
  it('contoh C02 menghasilkan tepat kalimat yang dipakai uji di Flow dan tidak punya masalah', () => {
    expect(dnaIssues({ ...dnaKosong(), ...CONTOH_C02.dna })).toEqual([]);
    expect(appearanceOf({ ...dnaKosong(), ...CONTOH_C02.dna })).toBe(KALIMAT_C02);
  });
  it('DNA kosong atau belum lengkap: kalimat kosong dan ada daftar masalah', () => { expect(appearanceOf(dnaKosong())).toBe(''); expect(dnaIssues(dnaKosong()).length).toBeGreaterThan(3); });
  it('cleanDna membuang kolom kosong dan kolom yang tidak berlaku', () => {
    expect(cleanDna({ ...dnaKosong(), ...CONTOH_C02.dna, hijab: false, eyes: '', hijab_style: 'pasmina', beard: 'tanpa' })).toEqual(CONTOH_C02.dna);
    const h = cleanDna({ gender: 'perempuan', hijab: true, hijab_style: 'pasmina', hijab_color: ' dusty pink ', hair_length: 'panjang', hair_color: 'hitam', age_group: 'muda' });
    expect(h.hair_length).toBeUndefined(); expect(h.hair_color).toBeUndefined(); expect(h.hijab_color).toBe('dusty pink');
    expect(cleanDna({ gender: 'laki-laki', hijab: true, hijab_style: 'pasmina', hijab_color: 'x', beard: 'janggut_tipis' })).toEqual({ gender: 'laki-laki', beard: 'janggut_tipis' });
  });
  it('karakter berhijab dan karakter pria menghasilkan kalimat yang sesuai', () => {
    const h = appearanceOf({ ...dnaKosong(), gender: 'perempuan', age_group: 'muda', face_shape: 'bulat', complexion: 'kuning_langsat', expression: 'kalem', hijab: true, hijab_style: 'pasmina', hijab_color: 'Dusty Pink' });
    expect(h).toBe('A young woman in her mid to late twenties wearing a dusty pink draped pashmina hijab, a soft round face, a light warm-beige complexion, and a calm gentle smile.');
    expect(appearanceOf({ ...dnaKosong(), gender: 'laki-laki', age_group: 'dewasa', face_shape: 'persegi', complexion: 'sawo_matang', expression: 'kalem', hair_length: 'pendek', hair_texture: 'lurus', hair_color: 'hitam', beard: 'janggut_tipis' })).toMatch(/^A man in his thirties with short, straight, black hair, with light stubble/);
  });
});

describe('validasi isian', () => {
  it('identitas', () => {
    expect(cekIdentitas({ name: 'Nadia' })).toEqual([]);
    expect(cekIdentitas({ name: ' ' }).length).toBe(1); expect(cekIdentitas({ name: '' }).length).toBe(1); expect(cekIdentitas({ name: 'N' }).length).toBe(1); expect(cekIdentitas({ name: 'N'.repeat(61) }).length).toBe(1);
    expect(cekIdentitas({ name: 'Nadia' })).toEqual([]);
    expect(cekIdentitas({ code: '../x', name: 'Nadia' })).toEqual([]);   // kode tidak lagi diperiksa: dibuat otomatis oleh database
    expect(cekIdentitas({ name: 'Nadia' }).join()).not.toMatch(/Kode/);
  });
  it('project Flow dan akun', () => {
    expect(cekProject('https://flow.google.com/project/abc-123', 'Uji Bintang')).toEqual([]);
    expect(cekProject('https://flow.google.com/u/1/project/abc', 'Uji')).toEqual([]);
    for (const u of ['', 'http://flow.google.com/project/a', 'https://contoh.com/project/a', 'https://flow.google.com/', 'flow.google.com/project/a']) expect(cekProject(u, 'Uji').length, u).toBe(1);
    expect(cekProject('https://flow.google.com/project/a', ' ').length).toBe(1);
  });
  it('foto: tipe, ukuran, dan dimensi', () => {
    expect(cekFoto(null)).toEqual(['Foto wajah belum dipilih.']);
    expect(cekFoto(berkas('image/png', 200000))).toEqual([]); expect(cekFoto(berkas('image/webp', 200000))).toEqual([]);
    expect(cekFoto(berkas('image/gif', 200000))[0]).toMatch(/PNG, JPG, atau WEBP/); expect(cekFoto(berkas('image/png', 7 * 1048576))[0]).toMatch(/batas 6 MB/); expect(cekFoto(berkas('image/png', 500))[0]).toMatch(/terlalu kecil/);
    expect(nilaiDimensi(null).galat).toMatch(/tidak terbaca/); expect(nilaiDimensi({ w: 400, h: 900 }).galat).toMatch(/512/);
    expect(nilaiDimensi({ w: 800, h: 1000 }).peringatan).toMatch(/1024/); expect(nilaiDimensi({ w: 1200, h: 1500 })).toEqual({});
  });
  it('ekstensi dan jalur foto', () => { expect(ekstensi('image/png')).toBe('png'); expect(ekstensi('image/webp')).toBe('webp'); expect(ekstensi('image/jpeg')).toBe('jpg'); expect(jalurFoto('abc', 'png')).toBe('abc/face_front.png'); });
});

describe('suara', () => {
  it('pilihan menurut jenis kelamin menandai suara yang sudah dipakai', () => {
    const p = pilihanSuara('perempuan', ['achernar']); expect(p.find(v => v.name === 'Achernar').dipakai).toBe(true); expect(p.every(v => ['perempuan', 'netral'].includes(v.gender))).toBe(true);
    expect(pilihanSuara('laki-laki').every(v => ['laki-laki', 'netral'].includes(v.gender))).toBe(true);
  });
  it('suara awal valid, dan menghindari suara yang sudah dipakai', () => {
    const a = suaraAwal('perempuan', 'dewasa_muda', []); expect(cekSuara(a.profile)).toEqual([]); expect(a.bentrok).toBe(false);
    const b = suaraAwal('perempuan', 'dewasa_muda', [a.profile.base_voice]); expect(b.profile.base_voice).not.toBe(a.profile.base_voice); expect(cekSuara(b.profile)).toEqual([]);
    expect(teksPerforma(a.profile)).toMatch(/early twenties, around 21 to 24/); expect(teksPerforma({ ...a.profile, nada: 'aneh' })).toBe('');
    const semua = pilihanSuara('perempuan').map(v => v.name); expect(suaraAwal('perempuan', 'muda', semua).bentrok).toBe(true);
  });
});

describe('status dan syarat siap', () => {
  const c = { status: 'voice_defined', face_ref_path: 'x/face_front.png', dna: { appearance_en: 'A' }, voice_base: 'Achernar', flow_project_url: 'https://flow.google.com/project/a', flow_account_name: 'Uji' };
  it('syarat lengkap dan langkah berikut menurut peran', () => {
    expect(lengkap(c)).toBe(true); expect(syaratSiap(c).every(s => s.ok)).toBe(true);
    expect(langkahBerikut(c, false)).toMatch(/Menunggu admin/); expect(langkahBerikut(c, true)).toMatch(/tandai siap/); expect(langkahBerikut({ ...c, status: 'ready' }, false)).toMatch(/siap dipakai/);
    expect(langkahBerikut({ ...c, face_ref_path: null, status: 'draft' }, true)).toMatch(/Unggah foto wajah/); expect(langkahBerikut({ ...c, flow_account_name: '' }, true)).toMatch(/Lengkapi/);
  });
  it('syarat kurang terdeteksi satu per satu', () => {
    for (const [k, over] of [['foto', { face_ref_path: null }], ['dna', { dna: {} }], ['suara', { voice_base: null }], ['project', { flow_project_url: 'https://x.com' }], ['akun', { flow_account_name: '' }]]) {
      const s = syaratSiap({ ...c, ...over }); expect(s.find(x => x.kunci === k).ok, k).toBe(false); expect(lengkap({ ...c, ...over }), k).toBe(false);
    }
  });
  it('label status', () => { expect(infoStatus('ready').label).toBe('Siap dipakai'); expect(infoStatus('voice_defined').label).toMatch(/menunggu admin/); expect(infoStatus('aneh').label).toBe('aneh'); });
});

describe('baris database', () => {
  it('sama bentuknya dengan yang diterima database (tervalidasi di tes RLS): draf, terkunci, dna berisi kalimat penampilan, suara dasar tersalin', () => {
    const voice = suaraAwal('perempuan', 'dewasa_muda').profile;
    const r = barisKarakter({ code: 'C99_COBA_KIRIM', name: ' Nadia ', dna: { ...dnaKosong(), ...CONTOH_C02.dna }, voice, flowProjectUrl: ' https://flow.google.com/project/a ', flowAccountName: ' Uji ' }, 'uid-1');
    expect(r).not.toHaveProperty('code'); expect(Object.keys(r)).not.toContain('code'); expect(r).toMatchObject({ name: 'Nadia', gender: 'perempuan', creation_mode: 'reference', identity_lock: 'locked', status: 'draft', created_by: 'uid-1', voice_base: voice.base_voice, flow_project_url: 'https://flow.google.com/project/a', flow_account_name: 'Uji' });
    expect(r.dna.appearance_en).toBe(KALIMAT_C02); expect(r.dna.hijab).toBeUndefined(); expect(r.voice).toBe(voice);
  });
});

describe('galat berbahasa awam', () => {
  it('memetakan galat umum', () => {
    expect(galatAwam({ code: '23505', message: 'duplicate key value violates unique constraint "ugc_characters_code_key"' })).toMatch(/Kode karakter otomatis bentrok.*simpan sekali lagi/);
    expect(galatAwam({ code: '23505', message: 'duplicate key value violates unique constraint "ugc_characters_pkey"' })).toMatch(/bentrok dengan data yang sudah ada/);
    expect(galatAwam({ code: '23502', message: 'null value in column "code" of relation "ugc_characters" violates not-null constraint' })).toMatch(/kode otomatis belum aktif.*20261007000820/);
    expect(galatAwam({ code: '23502', message: 'null value in column "name" violates not-null constraint' })).not.toMatch(/kode otomatis/);
    expect(galatAwam({ code: '23505', message: 'x', details: 'Key (voice_base)=(Achernar) already exists' })).toMatch(/Satu karakter satu suara/);
    expect(galatAwam(new Error('khusus admin'))).toMatch(/Hanya akun admin/); expect(galatAwam(new Error('alasan wajib diisi (minimal 10 karakter)'))).toMatch(/minimal 10/);
    expect(galatAwam({ code: '42501', message: 'new row violates row-level security policy' })).toMatch(/tidak punya izin/); expect(galatAwam(new TypeError('Failed to fetch'))).toMatch(/Tidak tersambung/);
    expect(galatAwam(new Error('aneh sekali'))).toMatch(/^Terjadi kesalahan: aneh sekali/);
  });
});

describe('operasi ke database (klien tiruan)', () => {
  const k0 = { id: 'k1', status: 'draft' }; const foto = { type: 'image/png', size: 50000 };
  it('pasangFoto: mengunggah dengan upsert, membuat baris foto, menautkan karakter, dan menaikkan status draf', async () => {
    const c = klien({ 'ugc_character_photos.select': { data: [], error: null } });
    await pasangFoto(c, 'u1', k0, foto);
    expect(c.log.find(l => l.op === 'upload').args).toEqual({ path: 'k1/face_front.png', o: { contentType: 'image/png', upsert: true } });
    expect(c.log.find(l => l.t === 'ugc_character_photos' && l.op === 'insert').args.v).toEqual({ character_id: 'k1', angle: 'face_front', path: 'k1/face_front.png', approved: true, created_by: 'u1' });
    expect(c.log.find(l => l.t === 'ugc_characters' && l.op === 'update').args.v).toEqual({ face_ref_path: 'k1/face_front.png', status: 'voice_defined' });
  });
  it('pasangFoto: foto sudah ada → memperbarui barisnya (tidak menggandakan) dan status tidak diturunkan', async () => {
    const c = klien({ 'ugc_character_photos.select': { data: [{ id: 'p9' }], error: null } });
    await pasangFoto(c, 'u1', { id: 'k1', status: 'voice_defined' }, { type: 'image/jpeg', size: 50000 });
    expect(c.log.some(l => l.t === 'ugc_character_photos' && l.op === 'insert')).toBe(false);
    expect(c.log.find(l => l.t === 'ugc_character_photos' && l.op === 'update').args).toMatchObject({ id: 'p9', v: { path: 'k1/face_front.jpg', approved: true } });
    expect(c.log.find(l => l.t === 'ugc_characters' && l.op === 'update').args.v).toEqual({ face_ref_path: 'k1/face_front.jpg' });
  });
  it('pasangFoto: galat unggah dilempar dan tidak mengubah karakter', async () => {
    const c = klien({ upload: { data: null, error: new Error('Payload too large') } });
    await expect(pasangFoto(c, 'u1', k0, foto)).rejects.toThrow(/too large/); expect(c.log.some(l => l.t === 'ugc_characters' && l.op === 'update')).toBe(false);
  });
  const form = { name: 'Nadia', dna: { ...dnaKosong(), ...CONTOH_C02.dna }, voice: suaraAwal('perempuan', 'dewasa_muda').profile, flowProjectUrl: 'https://flow.google.com/project/a', flowAccountName: 'Uji' };
  it('buatKarakter: urutan simpan data lalu foto, dan melaporkan langkahnya', async () => {
    const c = klien({ 'ugc_characters.insert': { data: [{ id: 'k1', code: 'C04-3F9A12BC', status: 'draft' }], error: null } }); const langkah = vi.fn();
    const r = await buatKarakter(c, 'u1', form, foto, langkah);
    expect(r).toEqual({ id: 'k1', code: 'C04-3F9A12BC', lengkap: true }); expect(langkah.mock.calls.map(x => x[0])).toEqual(['Menyimpan data karakter…', 'Mengunggah foto wajah…']);
    expect(c.log.find(l => l.t === 'ugc_characters' && l.op === 'insert').args.v.status).toBe('draft'); expect(String(c.log.find(l => l.t === 'ugc_characters' && l.op === 'insert').kolom).split(',')).toEqual(expect.arrayContaining(['id', 'code', 'status']));   // kode dibuat database; website harus memintanya kembali expect(c.log.find(l => l.t === 'ugc_characters' && l.op === 'insert').args.v).not.toHaveProperty('code', expect.anything());
  });
  it('buatKarakter: foto gagal → karakter tetap tersimpan sebagai draf dan hasilnya memuat pesan awam', async () => {
    const c = klien({ 'ugc_characters.insert': { data: [{ id: 'k1', code: 'C05-AAAA1111', status: 'draft' }], error: null }, upload: { data: null, error: new Error('Failed to fetch') } });
    const r = await buatKarakter(c, 'u1', form, foto); expect(r.id).toBe('k1'); expect(r.code).toBe('C05-AAAA1111'); expect(r.lengkap).toBe(false); expect(r.galat).toMatch(/Tidak tersambung/);
  });
  it('buatKarakter: bentrok data dilempar sebagai galat dan tidak mengunggah apa pun', async () => {
    const c = klien({ 'ugc_characters.insert': { data: null, error: { code: '23505', message: 'duplicate key' } } });
    await expect(buatKarakter(c, 'u1', form, foto)).rejects.toMatchObject({ code: '23505' }); expect(c.log.some(l => l.op === 'upload')).toBe(false);
  });
  it('tandaiSiap: alasan minimal 10 karakter diperiksa sebelum memanggil database; galat database diteruskan', async () => {
    const c = klien(); await expect(tandaiSiap(c, 'k1', 'pendek')).rejects.toThrow(/minimal 10/); expect(c.log.length).toBe(0);
    await tandaiSiap(c, 'k1', '  Wajah dan suara sudah diverifikasi di Flow asli  '); expect(c.log[0]).toEqual({ t: 'rpc', fn: 'ugc_admin_mark_ready', a: { p_character: 'k1', p_reason: 'Wajah dan suara sudah diverifikasi di Flow asli' } });
    await expect(tandaiSiap(klien({ rpc: { data: null, error: { message: 'khusus admin', code: '42501' } } }), 'k1', 'alasan yang cukup panjang')).rejects.toMatchObject({ message: 'khusus admin' });
  });
  it('ubahProject: alamat salah ditolak lebih dulu; update tanpa baris terdampak dianggap tanpa izin', async () => {
    await expect(ubahProject(klien(), 'k1', { url: 'https://contoh.com', akun: 'Uji' })).rejects.toThrow(/https:\/\/flow\.google\.com\/project\//);
    await expect(ubahProject(klien({ 'ugc_characters.update': { data: [], error: null } }), 'k1', { url: 'https://flow.google.com/project/a', akun: 'Uji' })).rejects.toMatchObject({ code: '42501' });
    await expect(ubahProject(klien({ 'ugc_characters.update': { data: [{ id: 'k1' }], error: null } }), 'k1', { url: 'https://flow.google.com/project/a', akun: 'Uji' })).resolves.toBeUndefined();
  });
});
