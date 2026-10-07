// Tes sisi website untuk Produk: pustaka, pemilih kategori, editor profil, dan tiga halaman. Klien Supabase TIRUAN yang meniru penjaga
// kategori di database (arketipe dan risiko diturunkan saat simpan). Yang belum terbukti di sini: fungsi analyze-product sungguhan dan model AI sungguhan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from '../src/auth/AuthContext.jsx';
import PilihKategori from '../src/components/PilihKategori.jsx';
import EditorProfil from '../src/components/EditorProfil.jsx';
import Produk from '../src/pages/Produk.jsx';
import ProdukBaru from '../src/pages/ProdukBaru.jsx';
import ProdukDetail from '../src/pages/ProdukDetail.jsx';
import {
  alamatFoto, analisisProduk, barisKeDaftar, buatProduk, cariKategori, cekFotoProduk, galatProduk, hitungUkuran, jalurFotoProduk, konfirmasiProduk, labelKategori, muatKatalog,
  perkecilFoto, profilKosong, risikoKategori, setDetail, simpanFoto, syaratKarakter, ubahKategori, unggahFotoProduk, urutkanDetail
} from '../src/lib/produk.js';

beforeEach(() => { URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn(); window.confirm = vi.fn(() => true); });
afterEach(cleanup);
expect.extend({
  toBeDisabled(el) { return { pass: Boolean(el) && el.disabled === true, message: () => 'elemen seharusnya nonaktif' }; },
  toBeEnabled(el) { return { pass: Boolean(el) && el.disabled === false, message: () => 'elemen seharusnya aktif' }; }
});

const U1 = 'u1-0000-0000-0000-000000000001', U2 = 'u2-0000-0000-0000-000000000002', PID = '11111111-1111-1111-1111-111111111111';
const ARK = [{ id: 'A-01', nama: 'Busana dipakai', risk_level: 'rendah' }, { id: 'A-05', nama: 'Perawatan dan kecantikan topikal', risk_level: 'sedang' }, { id: 'A-07', nama: 'Kesehatan, suplemen, dan obat', risk_level: 'tinggi' }, { id: 'A-09', nama: 'Produk anak dan bayi (tanpa karakter anak)', risk_level: 'sedang' }];
const KAT = [
  { category_key: 'fashion-wanita-dress-daster', l1: 'Fashion Wanita', l2: 'Dress', l3: 'Daster', archetype_id: 'A-01', kepercayaan: 'tinggi', flags: [], perlu_review: false, req_gender: 'perempuan', req_hijab: null, catatan_kebijakan: null, risiko_override: null },
  { category_key: 'fashion-wanita-dress-gamis', l1: 'Fashion Wanita', l2: 'Dress', l3: 'Gamis', archetype_id: 'A-01', kepercayaan: 'tinggi', flags: [], perlu_review: false, req_gender: 'perempuan', req_hijab: 'wajib', catatan_kebijakan: null, risiko_override: null },
  { category_key: 'kecantikan-wajah-serum', l1: 'Kecantikan', l2: 'Perawatan Wajah', l3: 'Serum', archetype_id: 'A-05', kepercayaan: 'sedang', flags: [], perlu_review: true, req_gender: null, req_hijab: null, catatan_kebijakan: 'Tanpa klaim hasil.', risiko_override: null },
  { category_key: 'kecantikan-wajah-jerawat', l1: 'Kecantikan', l2: 'Perawatan Wajah', l3: 'Treatment Jerawat', archetype_id: 'A-05', kepercayaan: 'tinggi', flags: [], perlu_review: false, req_gender: null, req_hijab: null, catatan_kebijakan: null, risiko_override: 'tinggi' },
  { category_key: 'kesehatan-suplemen', l1: 'Kesehatan', l2: 'Suplemen', l3: null, archetype_id: 'A-07', kepercayaan: 'tinggi', flags: [], perlu_review: false, req_gender: null, req_hijab: null, catatan_kebijakan: null, risiko_override: null },
  { category_key: 'ibu-anak-bayi-botol', l1: 'Ibu & Anak', l2: 'Perlengkapan Bayi', l3: 'Botol Susu', archetype_id: 'A-09', kepercayaan: 'tinggi', flags: [], perlu_review: false, req_gender: null, req_hijab: null, catatan_kebijakan: null, risiko_override: null }
];
const KATALOG = { kategori: KAT, arketipe: Object.fromEntries(ARK.map(a => [a.id, a])) };
const RANK = { rendah: 1, sedang: 2, tinggi: 3 };
const DETAIL = [
  { slot_key: 'detail_utama', text: 'kerah bulat dengan resleting depan', text_en: 'round neckline with a front zipper', label: 'kerah', confidence: 0.9 },
  { slot_key: 'motif_kain', text: 'motif bunga pastel', text_en: 'soft pastel floral print', label: 'motif', confidence: 0.8 },
  { slot_key: 'lengan_bawahan_hem', text: 'lengan pendek', text_en: 'short sleeves', label: 'lengan', confidence: 0.7 }
];
const HASIL_AI = (extra = {}) => ({ data: { ok: true, run_id: 'r1', model: 'google/gemini-2.5-flash', hasil: { profile: { facts: ['Warna dasar abu'], facts_en: ['Gray base'], colors: ['light gray'], details: DETAIL }, catatan: ['Foto belakang tidak ada'], dibuang: ['slot "sol" bukan milik arketipe A-01'], issues: [], slots: [], usable: ['detail_utama', 'motif_kain', 'lengan_bawahan_hem'], ready: true }, ...extra }, error: null });
const galatFungsi = (pesan, kode = 'batas_harian') => ({ data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { name: 'FunctionsHttpError', context: { json: async () => ({ ok: false, kode, pesan }) } }) });
const foto = (nama = 'a.png', type = 'image/png', ukuran = 20000) => new File([new Uint8Array(ukuran)], nama, { type });
const P = (o = {}) => ({ id: PID, name: 'Daster floral', status: 'draft', photos: [{ path: `${PID}/a.png`, role: 'depan' }, { path: `${PID}/b.png`, role: 'closeup' }], profile: {}, archetype_id: 'A-01', risk_level: 'rendah', category_key: 'fashion-wanita-dress-daster', category_source: 'manual', confirmed_by: null, confirmed_at: null, created_by: U1, created_at: '2026-10-06T01:00:00Z', updated_at: '2026-10-06T01:00:00Z', ...o });

// Klien tiruan dengan tabel di memori. Meniru penjaga database: arketipe dari kategori, risiko tidak turun, staf tidak boleh mengosongkan kategori.
function klien({ role = 'staff', userId = U1, produk = [], invoke, upload, signed } = {}) {
  const db = { ugc_products: produk.map(x => ({ ...x })), log: [], invoke: [], upload: [] };
  const hitungRisiko = (row, lama) => {
    const k = KAT.find(x => x.category_key === row.category_key); const dasar = k ? [ARK.find(a => a.id === k.archetype_id).risk_level, k.risiko_override].filter(Boolean) : [];
    const lantai = Math.max(0, ...dasar.map(r => RANK[r]), lama && lama.risk_level ? RANK[lama.risk_level] : 0); return lantai ? Object.keys(RANK).find(r => RANK[r] === lantai) : row.risk_level;
  };
  const from = t => {
    if (t === 'user_profiles') { const c = { select: () => c, eq: () => c, maybeSingle: () => Promise.resolve({ data: { id: userId, name: 'Uji', role }, error: null }) }; return c; }
    if (t === 'ugc_category_map') return { select: () => { const c = { order: () => c, then: (r, j) => Promise.resolve({ data: KAT, error: null }).then(r, j) }; return c; } };
    if (t === 'ugc_archetypes') return { select: () => Promise.resolve({ data: ARK, error: null }) };
    const st = { op: 'select', filter: null, v: null }; const b = {
      select() { return b; }, order() { return b; }, limit() { return b; }, eq(k, v) { st.filter = [k, v]; return b; },
      insert(v) { st.op = 'insert'; st.v = v; return b; }, update(v) { st.op = 'update'; st.v = v; return b; },
      then(res, rej) {
        let hasil;
        if (st.op === 'insert') { const baru = { id: PID, created_at: 'x', updated_at: 'x', confirmed_by: null, confirmed_at: null, risk_level: null, archetype_id: null, ...st.v }; const k = KAT.find(x => x.category_key === baru.category_key); if (k) baru.archetype_id = baru.archetype_id || k.archetype_id; baru.risk_level = hitungRisiko(baru); db.ugc_products.push(baru); hasil = { data: [baru], error: null }; }
        else if (st.op === 'update') { const row = db.ugc_products.find(x => x[st.filter[0]] === st.filter[1]); if (!row || (role !== 'admin' && row.created_by !== userId)) hasil = { data: [], error: null }; else { const lama = { ...row }; Object.assign(row, st.v); if (st.v.category_key && st.v.category_key !== lama.category_key) { const k = KAT.find(x => x.category_key === row.category_key); if (k) row.archetype_id = k.archetype_id; } row.risk_level = hitungRisiko(row, lama); hasil = { data: [{ ...row }], error: null }; } }
        else { let d = db.ugc_products; if (st.filter) d = d.filter(x => x[st.filter[0]] === st.filter[1]); hasil = { data: d.map(x => ({ ...x })), error: null }; }
        db.log.push({ t, op: st.op, v: st.v, filter: st.filter }); return Promise.resolve(hasil).then(res, rej);
      }
    }; return b;
  };
  return { db, from,
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: userId, email: 'u@x.id' } } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: () => Promise.resolve({}) },
    functions: { invoke: async (nama, o) => { db.invoke.push({ nama, body: o.body }); return invoke ? invoke(o.body) : HASIL_AI(); } },
    storage: { from: () => ({
      upload: async (path, f, opt) => { db.upload.push({ path, f, opt }); return upload || { data: {}, error: null }; },
      createSignedUrls: async paths => signed || { data: paths.map(p => ({ path: p, signedUrl: `https://u/${p}` })), error: null }
    }) } };
}
const bungkus = (c, awal, rute) => render(<MemoryRouter initialEntries={[awal]}><AuthProvider client={c}><Routes>{rute}</Routes></AuthProvider></MemoryRouter>);
function Tiruan() { const s = useLocation().state || {}; return <div data-testid="tujuan"><span data-testid="tujuan-pesan">{s.pesan || ''}</span></div>; }

// ───────────── Pustaka ─────────────
describe('lib/produk: kategori', () => {
  it('risiko efektif = yang lebih tinggi antara arketipe dan override; syarat karakter dan label', () => {
    expect(risikoKategori(KAT[0], KATALOG.arketipe)).toBe('rendah'); expect(risikoKategori(KAT[2], KATALOG.arketipe)).toBe('sedang'); expect(risikoKategori(KAT[3], KATALOG.arketipe)).toBe('tinggi'); expect(risikoKategori(KAT[4], KATALOG.arketipe)).toBe('tinggi');
    expect(risikoKategori(null, KATALOG.arketipe)).toBeNull(); expect(risikoKategori({ archetype_id: 'A-99' }, KATALOG.arketipe)).toBeNull(); expect(risikoKategori({ archetype_id: 'A-01', risiko_override: 'sedang' }, KATALOG.arketipe)).toBe('sedang');
    expect(syaratKarakter(KAT[1])).toEqual(['Karakter harus perempuan.', 'Karakter harus berhijab.']); expect(syaratKarakter({ req_hijab: 'tanpa' })).toEqual(['Karakter tidak berhijab.']); expect(syaratKarakter(KAT[3])).toEqual([]); expect(syaratKarakter(null)).toEqual([]);
    expect(labelKategori(KAT[0])).toBe('Fashion Wanita > Dress > Daster'); expect(labelKategori(KAT[4])).toBe('Kesehatan > Suplemen'); expect(labelKategori(null)).toBe('');
  });
  it('pencarian: semua kata harus cocok, tanpa peduli huruf besar dan aksen, awalan kata diutamakan, kueri kosong tidak menampilkan apa pun, ada batas hasil', () => {
    expect(cariKategori(KAT, '')).toEqual([]); expect(cariKategori(KAT, '   ')).toEqual([]); expect(cariKategori(KAT, 'xyz')).toEqual([]);
    expect(cariKategori(KAT, 'DASTER').map(k => k.l3)).toEqual(['Daster']); expect(cariKategori(KAT, 'dress daster').map(k => k.l3)).toEqual(['Daster']); expect(cariKategori(KAT, 'wajah').map(k => k.l3)).toEqual(['Serum', 'Treatment Jerawat']);
    expect(cariKategori(KAT, 'jerawat')[0].category_key).toBe('kecantikan-wajah-jerawat'); expect(cariKategori(KAT, 'bayi').map(k => k.l3)).toEqual(['Botol Susu']); expect(cariKategori(KAT, 'e', 2)).toHaveLength(2);
    const aksen = [{ ...KAT[0], l3: 'Dàster Ékstra' }]; expect(cariKategori(aksen, 'daster ekstra')).toHaveLength(1);
    expect(cariKategori(null, 'x')).toEqual([]);
  });
  it('muatKatalog membaca kategori dan arketipe; galat dilempar', async () => {
    const k = await muatKatalog(klien()); expect(k.kategori).toHaveLength(6); expect(k.arketipe['A-07'].risk_level).toBe('tinggi');
    await expect(muatKatalog({ from: t => (t === 'ugc_archetypes' ? { select: () => Promise.resolve({ data: null, error: { message: 'x' } }) } : klien().from(t)) })).rejects.toMatchObject({ message: 'x' });
  });
});

describe('lib/produk: foto', () => {
  it('ukuran dan pemeriksaan berkas', () => {
    expect(hitungUkuran(4000, 3000)).toEqual({ w: 1600, h: 1200, ubah: true }); expect(hitungUkuran(3000, 4000)).toEqual({ w: 1200, h: 1600, ubah: true }); expect(hitungUkuran(800, 600)).toEqual({ w: 800, h: 600, ubah: false }); expect(hitungUkuran(0, 5)).toBeNull();
    expect(cekFotoProduk(foto())).toEqual([]); expect(cekFotoProduk(null)).toEqual(['Foto belum dipilih.']); expect(cekFotoProduk(foto('a.gif', 'image/gif'))[0]).toMatch(/PNG, JPG, atau WEBP/); expect(cekFotoProduk(foto('a.png', 'image/png', 500))[0]).toMatch(/terlalu kecil/);
    expect(jalurFotoProduk(PID, 'png', 'x1')).toBe(`${PID}/x1.png`);
  });
  it('perkecilFoto: memperkecil bila sisi terlalu besar; tidak menyentuh foto kecil; memakai file asli bila gagal atau hasilnya lebih besar', async () => {
    const besar = foto('besar.png', 'image/png', 3_000_000); const env = { baca: async () => ({ w: 4000, h: 3000 }), gambar: async (f, w, h, q) => { env.dipanggil = [w, h, q]; return new Blob([new Uint8Array(400_000)], { type: 'image/jpeg' }); } };
    let r = await perkecilFoto(besar, { env }); expect(r.diperkecil).toBe(true); expect(r.file.type).toBe('image/jpeg'); expect(r.file.name).toBe('besar.jpg'); expect(r.file.size).toBe(400_000); expect(env.dipanggil).toEqual([1600, 1200, 0.85]);
    const kecil = foto('k.png', 'image/png', 50_000); r = await perkecilFoto(kecil, { env: { baca: async () => ({ w: 800, h: 600 }), gambar: async () => { throw new Error('tidak boleh dipanggil'); } } }); expect(r.diperkecil).toBe(false); expect(r.file).toBe(kecil);
    r = await perkecilFoto(besar, { env: { baca: async () => { throw new Error('tanpa canvas'); } } }); expect(r.diperkecil).toBe(false); expect(r.file).toBe(besar);
    r = await perkecilFoto(besar, { env: { baca: async () => ({ w: 4000, h: 3000 }), gambar: async () => new Blob([new Uint8Array(9_000_000)]) } }); expect(r.diperkecil).toBe(false); expect(r.file).toBe(besar);
  });
  it('unggahFotoProduk: ke folder produk tanpa menimpa; galat dilempar. alamatFoto: gagal tidak melempar', async () => {
    const c = klien(); const path = await unggahFotoProduk(c, PID, foto('a.png')); expect(path).toMatch(new RegExp(`^${PID}/[0-9a-f-]{36}\\.png$`)); expect(c.db.upload[0].opt).toMatchObject({ upsert: false, contentType: 'image/png' });
    await expect(unggahFotoProduk(klien({ upload: { error: new Error('penuh') } }), PID, foto())).rejects.toThrow(/penuh/);
    expect(await alamatFoto(klien(), [`${PID}/a.png`, null])).toEqual({ [`${PID}/a.png`]: `https://u/${PID}/a.png` }); expect(await alamatFoto(klien(), [])).toEqual({}); expect(await alamatFoto(klien({ signed: { error: { message: 'x' } } }), ['p'])).toEqual({});
  });
});

describe('lib/produk: simpan dan analisis', () => {
  it('buatProduk: draf dengan kategori manual; arketipe dan risiko dibaca dari hasil database; masukan salah ditolak sebelum menyentuh database', async () => {
    const c = klien(); const p = await buatProduk(c, U1, { nama: '  Serum Glow ', kategoriKey: 'kecantikan-wajah-jerawat' });
    expect(c.db.log[0].v).toMatchObject({ name: 'Serum Glow', category_key: 'kecantikan-wajah-jerawat', category_source: 'manual', status: 'draft', photos: [], profile: {}, created_by: U1 }); expect(p).toMatchObject({ archetype_id: 'A-05', risk_level: 'tinggi' });
    const d = klien(); await expect(buatProduk(d, U1, { nama: 'a', kategoriKey: 'x' })).rejects.toThrow(/Nama produk wajib/); await expect(buatProduk(d, U1, { nama: 'Valid', kategoriKey: '' })).rejects.toThrow(/Pilih kategori/); expect(d.db.log).toHaveLength(0);
  });
  it('simpanFoto: maksimal 6 dan hanya path dan role; konfirmasiProduk menulis profil dan status dalam SATU pembaruan; ubahKategori mengosongkan profil hanya bila arketipe berbeda', async () => {
    const c = klien({ produk: [P()] }); await expect(simpanFoto(c, PID, Array.from({ length: 7 }, (_, i) => ({ path: `p${i}`, role: 'depan' })))).rejects.toThrow(/Maksimal 6/);
    await simpanFoto(c, PID, [{ path: 'x', role: 'depan', url: 'jangan ikut' }]); expect(c.db.log.at(-1).v).toEqual({ photos: [{ path: 'x', role: 'depan' }] });
    const profil = { facts: ['a'], facts_en: ['b'], colors: ['c'], details: DETAIL, ekstra: 'jangan ikut' }; const r = await konfirmasiProduk(c, PID, U1, profil);
    expect(c.db.log.at(-1).v).toMatchObject({ status: 'confirmed', confirmed_by: U1, profile: { facts: ['a'], facts_en: ['b'], colors: ['c'], details: DETAIL } }); expect(c.db.log.at(-1).v.profile).not.toHaveProperty('ekstra'); expect(r.status).toBe('confirmed');
    const a = klien({ produk: [P({ status: 'analyzed', profile: { details: DETAIL } })] }); await ubahKategori(a, P(), 'fashion-wanita-dress-gamis', 'A-01'); expect(a.db.log.at(-1).v).toEqual({ category_key: 'fashion-wanita-dress-gamis', category_source: 'manual' });
    await ubahKategori(a, P(), 'kecantikan-wajah-serum', 'A-05'); expect(a.db.log.at(-1).v).toMatchObject({ category_key: 'kecantikan-wajah-serum', profile: {}, status: 'draft', confirmed_by: null, confirmed_at: null });
    const lain = klien({ produk: [P({ created_by: U2 })], userId: U1 }); await expect(simpanFoto(lain, PID, [])).rejects.toMatchObject({ code: '42501' });
  });
  it('analisisProduk: berhasil mengembalikan hasil; galat fungsi menjadi pesan awam; tidak melempar', async () => {
    let c = klien(); const r = await analisisProduk(c, PID); expect(r.ok).toBe(true); expect(c.db.invoke[0]).toEqual({ nama: 'analyze-product', body: { product_id: PID } });
    c = klien({ invoke: () => galatFungsi('Batas harian 30 analisis sudah tercapai.') }); expect(await analisisProduk(c, PID)).toMatchObject({ ok: false, pesan: 'Batas harian 30 analisis sudah tercapai.', kode: 'batas_harian' });
    c = klien({ invoke: () => { throw new TypeError('Failed to fetch'); } }); expect((await analisisProduk(c, PID)).pesan).toMatch(/Tidak tersambung/); c = klien({ invoke: () => ({ data: { ok: false, pesan: 'x' }, error: null }) }); expect((await analisisProduk(c, PID)).pesan).toBe('x');
    c = klien({ invoke: () => ({ data: null, error: null }) }); expect((await analisisProduk(c, PID)).ok).toBe(false);
  });
  it('galatProduk, daftar baris, setDetail dan urutkanDetail', () => {
    expect(galatProduk({ message: 'kategori produk tidak boleh dikosongkan; minta admin' })).toMatch(/tidak boleh dikosongkan/); expect(galatProduk({ message: 'arketipe berisiko tinggi tidak boleh diturunkan oleh staff; minta admin' })).toMatch(/berisiko tinggi/);
    expect(galatProduk({ code: '42501', message: 'x' })).toMatch(/tidak punya izin/); expect(galatProduk({ message: 'violates check constraint "ugc_products_confirmed_complete"' })).toMatch(/Pilih kategori/); expect(galatProduk({ message: 'Failed to fetch' })).toMatch(/Tidak tersambung/);
    expect(galatProduk({ message: 'Could not find the function' })).toMatch(/migrasi terbaru/); expect(galatProduk(null)).toMatch(/Terjadi kesalahan/);
    expect(barisKeDaftar(' a \n\n b\r\n')).toEqual(['a', 'b']); expect(barisKeDaftar(null)).toEqual([]);
    let p = setDetail(profilKosong(), 'motif_kain', { text: 'motif', text_en: 'print' }); expect(p.details).toEqual([{ slot_key: 'motif_kain', text: 'motif', text_en: 'print', label: '', confidence: 1 }]);
    p = setDetail(p, 'motif_kain', { confidence: 0.4 }); expect(p.details[0]).toMatchObject({ text: 'motif', confidence: 0.4 }); expect(setDetail(p, 'motif_kain', { text: '', text_en: '' }).details).toEqual([]);
    const urut = urutkanDetail({ details: [{ slot_key: 'siluet_panjang' }, { slot_key: 'detail_utama' }, { slot_key: 'asing' }] }, 'A-01'); expect(urut.details.map(d => d.slot_key)).toEqual(['detail_utama', 'siluet_panjang', 'asing']);
  });
});

// ───────────── Komponen ─────────────
describe('PilihKategori', () => {
  const tampil = (value = '', onChange = vi.fn()) => { render(<PilihKategori katalog={KATALOG} value={value} onChange={onChange} />); return onChange; };
  it('mengetik menampilkan hasil dengan nama arketipe; memilih memanggil onChange; kueri tanpa hasil memberi pesan', () => {
    const on = tampil(); expect(screen.queryByTestId('hasil-kategori')).toBeNull(); fireEvent.change(screen.getByLabelText('Cari kategori'), { target: { value: 'serum' } });
    const opsi = within(screen.getByTestId('hasil-kategori')).getAllByRole('option'); expect(opsi).toHaveLength(1); expect(opsi[0].textContent).toMatch(/Kecantikan > Perawatan Wajah > Serum.*Perawatan dan kecantikan topikal/);
    fireEvent.click(opsi[0]); expect(on).toHaveBeenCalledWith(expect.objectContaining({ category_key: 'kecantikan-wajah-serum' })); expect(screen.queryByTestId('hasil-kategori')).toBeNull();
    fireEvent.change(screen.getByLabelText('Cari kategori'), { target: { value: 'tidak-ada' } }); expect(screen.getByTestId('hasil-kategori').textContent).toMatch(/Tidak ada kategori yang cocok/);
  });
  it('kategori terpilih: arketipe, lencana risiko (override menaikkan jadi tinggi), syarat karakter, catatan kebijakan, perlu review', () => {
    tampil('kecantikan-wajah-jerawat'); expect(screen.getByTestId('kategori-terpilih').textContent).toMatch(/Arketipe A-05: Perawatan dan kecantikan topikal/); expect(screen.getByTestId('risiko-kategori').className).toMatch(/badge-bad/); expect(screen.getByTestId('risiko-kategori').textContent).toMatch(/perlu persetujuan admin/);
    cleanup(); tampil('fashion-wanita-dress-gamis'); expect(screen.getByTestId('kategori-terpilih').textContent).toMatch(/Karakter harus perempuan\.Karakter harus berhijab\./); expect(screen.getByTestId('risiko-kategori').className).toMatch(/badge-ok/);
    cleanup(); tampil('kecantikan-wajah-serum'); expect(screen.getByTestId('kategori-terpilih').textContent).toMatch(/Catatan kebijakan: Tanpa klaim hasil\./); expect(screen.getByTestId('kategori-terpilih').textContent).toMatch(/perlu ditinjau admin/);
  });
  it('katalog belum dimuat: pesan memuat', () => { render(<PilihKategori katalog={null} value="" onChange={() => {}} />); expect(screen.getByText(/Memuat daftar kategori/)).toBeTruthy(); });
});

describe('EditorProfil', () => {
  const Wadah = ({ awal = profilKosong(), roles = ['depan'], disabled = false, arketipe = 'A-01' }) => { const [p, setP] = (require('react')).useState(awal); return <EditorProfil archetypeId={arketipe} roles={roles} profil={p} onChange={setP} disabled={disabled} />; };
  it('menampilkan satu isian per slot arketipe; mengisi tiga slot dengan benar membuat profil siap; kata klaim memunculkan galat dengan pesan awam', () => {
    render(<Wadah />); expect(['detail_utama', 'motif_kain', 'lengan_bawahan_hem', 'siluet_panjang'].map(k => screen.getByTestId(`slot-${k}`))).toHaveLength(4); expect(screen.getByTestId('isu-galat').textContent).toMatch(/Baru 0 slot.*minimal 3/);
    for (const [k, id, en] of [['detail_utama', 'kerah bulat', 'round neckline'], ['motif_kain', 'motif bunga', 'floral print'], ['lengan_bawahan_hem', 'lengan pendek', 'short sleeves']]) { fireEvent.change(screen.getByLabelText('Teks Indonesia', { selector: `#s-${k}-id` }), { target: { value: id } }); fireEvent.change(screen.getByLabelText('Teks Inggris', { selector: `#s-${k}-en` }), { target: { value: en } }); }
    expect(screen.getByTestId('profil-siap').textContent).toMatch(/3 slot terpakai/); expect(screen.queryByTestId('isu-galat')).toBeNull(); expect(within(screen.getByTestId('slot-motif_kain')).getByText('Dipakai')).toBeTruthy();
    fireEvent.change(document.querySelector('#s-motif_kain-id'), { target: { value: 'kain nyaman dan premium' } }); expect(screen.getByTestId('isu-galat').textContent).toMatch(/kata klaim.*nyaman, premium/); expect(screen.queryByTestId('profil-siap')).toBeNull();
    fireEvent.change(document.querySelector('#s-motif_kain-id'), { target: { value: 'motif bunga' } }); fireEvent.change(document.querySelector('#s-motif_kain-en'), { target: { value: 'motif dengan warna abu' } }); expect(screen.getByTestId('isu-galat').textContent).toMatch(/kata Indonesia/);
  });
  it('fakta dan warna dipecah per baris; slot yang butuh foto berperan tertentu memberi petunjuk dan tidak dihitung tanpa foto itu; keyakinan rendah tidak dihitung', () => {
    render(<Wadah arketipe="A-05" roles={['depan']} />); expect(screen.getByTestId('slot-tekstur_warna').textContent).toMatch(/Butuh foto berperan Tekstur/);
    fireEvent.change(document.querySelector('#s-tekstur_warna-id'), { target: { value: 'warna krem' } }); fireEvent.change(document.querySelector('#s-tekstur_warna-en'), { target: { value: 'cream colored' } }); expect(within(screen.getByTestId('slot-tekstur_warna')).getByText('Belum dipakai')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Fakta produk \(Inggris\)/), { target: { value: 'white bottle\nblue cap' } }); expect(screen.getByLabelText(/Fakta produk \(Inggris\)/).value).toBe('white bottle\nblue cap');
    cleanup(); render(<Wadah awal={{ facts: [], facts_en: [], colors: [], details: DETAIL }} />); expect(screen.getByTestId('profil-siap')).toBeTruthy();
    fireEvent.change(document.querySelector('#s-detail_utama-conf'), { target: { value: '0.5' } }); expect(screen.getByTestId('isu-peringatan').textContent).toMatch(/di bawah 0.6/); expect(screen.queryByTestId('profil-siap')).toBeNull();
  });
  it('mode terkunci: semua isian nonaktif', () => { render(<Wadah awal={{ facts: [], facts_en: [], colors: [], details: DETAIL }} disabled />); expect(document.querySelector('#fakta-id').disabled).toBe(true); expect(document.querySelector('fieldset.slot').disabled).toBe(true); });
});

// ───────────── Halaman ─────────────
describe('halaman Produk (daftar)', () => {
  const rute = <><Route path="/produk" element={<Produk />} /><Route path="/produk/baru" element={<Tiruan />} /></>;
  const DATA = [P({ id: 'p1', name: 'Daster floral' }), P({ id: 'p2', name: 'Serum glow', status: 'confirmed', risk_level: 'tinggi', archetype_id: 'A-05', category_key: 'kecantikan-wajah-jerawat', created_by: U2, photos: [] }), P({ id: 'p3', name: 'Gamis polos', status: 'analyzed', category_key: 'fashion-wanita-dress-gamis' })];
  it('menampilkan kartu dengan foto, kategori, status, lencana risiko (hanya sedang atau tinggi), dan penanda milik sendiri', async () => {
    bungkus(klien({ produk: DATA }), '/produk', rute); await waitFor(() => expect(screen.getByTestId('daftar-produk').children.length).toBe(3));
    const k1 = screen.getByText('Daster floral').closest('li'); expect(k1.textContent).toMatch(/Fashion Wanita > Dress > Daster/); expect(k1.textContent).toMatch(/Draf/); expect(k1.textContent).toMatch(/milik Anda/); expect(k1.querySelector('img').getAttribute('src')).toBe(`https://u/${PID}/a.png`); expect(k1.textContent).not.toMatch(/Risiko/);
    const k2 = screen.getByText('Serum glow').closest('li'); expect(k2.textContent).toMatch(/Terkonfirmasi/); expect(k2.textContent).toMatch(/Risiko tinggi/); expect(k2.textContent).not.toMatch(/milik Anda/); expect(k2.querySelector('img')).toBeNull(); expect(k2.textContent).toMatch(/Tanpa foto/);
    expect(screen.getByTestId('produk-baru').getAttribute('href')).toBe('/produk/baru');
  });
  it('filter nama, status, risiko, dan hanya milik saya; pesan kosong yang sesuai', async () => {
    bungkus(klien({ produk: DATA }), '/produk', rute); await waitFor(() => expect(screen.getByTestId('daftar-produk').children.length).toBe(3)); const jml = () => screen.getByTestId('daftar-produk').children.length;
    fireEvent.change(screen.getByLabelText('Cari nama'), { target: { value: 'GAMIS' } }); expect(jml()).toBe(1); fireEvent.change(screen.getByLabelText('Cari nama'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'confirmed' } }); expect(jml()).toBe(1); fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Risiko'), { target: { value: 'tinggi' } }); expect(screen.getByText('Serum glow')).toBeTruthy(); expect(jml()).toBe(1); fireEvent.change(screen.getByLabelText('Risiko'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Hanya milik saya')); expect(jml()).toBe(2); fireEvent.change(screen.getByLabelText('Cari nama'), { target: { value: 'tidak ada' } }); expect(screen.getByTestId('produk-kosong').textContent).toMatch(/Tidak ada produk yang cocok/);
  });
  it('belum ada produk dan galat memuat memberi pesan awam', async () => {
    bungkus(klien(), '/produk', rute); await waitFor(() => expect(screen.getByTestId('produk-kosong').textContent).toBe('Belum ada produk.')); cleanup();
    const c = klien(); const asli = c.from; c.from = t => (t === 'ugc_products' ? { select: () => { const q = { order: () => q, limit: () => q, then: (r, j) => Promise.resolve({ data: null, error: { message: 'Failed to fetch' } }).then(r, j) }; return q; } } : asli(t));
    bungkus(c, '/produk', rute); await waitFor(() => expect(screen.getByTestId('galat-produk').textContent).toMatch(/Tidak tersambung/));
  });
});

describe('halaman Produk baru', () => {
  const rute = <><Route path="/produk/baru" element={<ProdukBaru />} /><Route path="/produk/:id" element={<Tiruan />} /></>;
  const pilih = async (kueri, indeks = 0) => { await waitFor(() => expect(screen.getByLabelText('Cari kategori')).toBeTruthy()); fireEvent.change(screen.getByLabelText('Cari kategori'), { target: { value: kueri } }); fireEvent.click(within(screen.getByTestId('hasil-kategori')).getAllByRole('option')[indeks]); };
  it('tombol simpan aktif setelah nama dan kategori; menyimpan draf lalu pindah ke detail dengan pesan', async () => {
    const c = klien(); bungkus(c, '/produk/baru', rute); await waitFor(() => expect(screen.getByTestId('simpan-produk')).toBeDisabled());
    fireEvent.change(screen.getByLabelText('Nama produk'), { target: { value: 'Daster floral' } }); expect(screen.getByTestId('masalah-produk').textContent).toMatch(/Kategori produk belum dipilih/); await pilih('daster'); expect(screen.getByTestId('simpan-produk')).toBeEnabled();
    fireEvent.click(screen.getByTestId('simpan-produk')); await waitFor(() => expect(screen.getByTestId('tujuan')).toBeTruthy());
    expect(c.db.log[0].v).toMatchObject({ name: 'Daster floral', category_key: 'fashion-wanita-dress-daster', status: 'draft', created_by: U1 }); expect(screen.getByTestId('tujuan-pesan').textContent).toMatch(/Draf produk tersimpan/);
  });
  it('galat dari database ditampilkan dengan bahasa awam dan tombol aktif kembali', async () => {
    const c = klien(); const asli = c.from; c.from = t => (t === 'ugc_products' ? { insert: () => ({ select: () => Promise.resolve({ data: null, error: { code: '42501', message: 'row-level security' } }) }) } : asli(t));
    bungkus(c, '/produk/baru', rute); fireEvent.change(screen.getByLabelText('Nama produk'), { target: { value: 'Serum' } }); await pilih('serum'); fireEvent.click(screen.getByTestId('simpan-produk'));
    await waitFor(() => expect(screen.getByTestId('galat-simpan').textContent).toMatch(/tidak punya izin/)); expect(screen.getByTestId('simpan-produk')).toBeEnabled();
  });
});

describe('halaman Produk detail', () => {
  const rute = <Route path="/produk/:id" element={<ProdukDetail />} />;
  const buka = (c) => bungkus(c, `/produk/${PID}`, rute);
  const siap = async () => { await waitFor(() => expect(screen.getByTestId('editor-profil')).toBeTruthy()); };
  it('analisis AI: memanggil fungsi untuk produk ini, mengisi editor, menyimpan draf (status analyzed), menampilkan catatan AI dan butir yang dibuang; staf TIDAK melihat biaya', async () => {
    const c = klien({ produk: [P()] }); buka(c); await siap(); expect(screen.getByTestId('status-produk').textContent).toBe('Draf');
    fireEvent.click(screen.getByTestId('analisis')); await waitFor(() => expect(screen.getByTestId('info-analisis')).toBeTruthy());
    expect(c.db.invoke[0]).toEqual({ nama: 'analyze-product', body: { product_id: PID } }); expect(document.querySelector('#s-detail_utama-en').value).toBe('round neckline with a front zipper'); expect(screen.getByTestId('profil-siap')).toBeTruthy();
    const simpan = c.db.log.filter(x => x.op === 'update').at(-1).v; expect(simpan.status).toBe('analyzed'); expect(simpan.profile.details.map(d => d.slot_key)).toEqual(['detail_utama', 'motif_kain', 'lengan_bawahan_hem']);
    expect(screen.getByTestId('info-analisis').textContent).toMatch(/Catatan AI: Foto belakang tidak ada/); expect(screen.getByTestId('info-analisis').textContent).toMatch(/Dibuang: slot "sol"/); expect(screen.queryByTestId('biaya-analisis')).toBeNull(); expect(screen.getByTestId('status-produk').textContent).toBe('Perlu ditinjau');
    expect(screen.getByTestId('pesan-produk').textContent).toMatch(/draf tersimpan/);
  });
  it('admin melihat biaya analisis dalam Rupiah dan USD', async () => {
    const c = klien({ role: 'admin', userId: U2, produk: [P()], invoke: () => HASIL_AI({ cost_usd: 0.004, cost_idr: 66 }) }); buka(c); await siap(); fireEvent.click(screen.getByTestId('analisis'));
    await waitFor(() => expect(screen.getByTestId('biaya-analisis')).toBeTruthy()); expect(screen.getByTestId('biaya-analisis').textContent).toMatch(/Rp 66.*US\$ 0\.004/);
  });
  it('lapis kedua: bila (karena kesalahan server) biaya ikut terkirim ke staf, halaman tetap TIDAK menampilkannya', async () => {
    const c = klien({ produk: [P()], invoke: () => HASIL_AI({ cost_usd: 0.004, cost_idr: 66 }) }); buka(c); await siap(); fireEvent.click(screen.getByTestId('analisis'));
    await waitFor(() => expect(screen.getByTestId('info-analisis')).toBeTruthy()); expect(screen.queryByTestId('biaya-analisis')).toBeNull(); expect(document.body.textContent).not.toMatch(/Rp 66|US\$ 0\.004/);
  });
  it('galat analisis (mis. batas harian): pesan dari server tampil, editor dan data tidak berubah, tidak ada penyimpanan', async () => {
    const c = klien({ produk: [P()], invoke: () => galatFungsi('Batas harian 30 analisis sudah tercapai. Coba lagi besok, atau isi detail produk secara manual.') }); buka(c); await siap();
    fireEvent.click(screen.getByTestId('analisis')); await waitFor(() => expect(screen.getByTestId('galat-produk').textContent).toMatch(/Batas harian 30 analisis/)); expect(c.db.log.filter(x => x.op === 'update')).toHaveLength(0); expect(document.querySelector('#s-detail_utama-en').value).toBe('');
  });
  it('analisis butuh foto produk dan kategori: tombol nonaktif tanpa foto; konfirmasi nonaktif sampai profil memenuhi syarat planner', async () => {
    let c = klien({ produk: [P({ photos: [] })] }); buka(c); await siap(); expect(screen.getByTestId('analisis')).toBeDisabled(); expect(screen.getByTestId('konfirmasi')).toBeDisabled(); cleanup();
    c = klien({ produk: [P()] }); buka(c); await siap(); expect(screen.getByTestId('konfirmasi')).toBeDisabled(); expect(screen.getByTestId('isu-galat').textContent).toMatch(/Baru 0 slot/);
  });
  it('alur lengkap: analisis -> konfirmasi (profil dan status dalam satu pembaruan, oleh pengguna ini) -> terkunci -> buka kembali -> draf', async () => {
    const c = klien({ produk: [P()] }); buka(c); await siap(); fireEvent.click(screen.getByTestId('analisis')); await waitFor(() => expect(screen.getByTestId('profil-siap')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('konfirmasi')).toBeEnabled()); fireEvent.click(screen.getByTestId('konfirmasi')); await waitFor(() => expect(screen.getByTestId('status-produk').textContent).toBe('Terkonfirmasi'));
    const u = c.db.log.filter(x => x.op === 'update').at(-1).v; expect(u).toMatchObject({ status: 'confirmed', confirmed_by: U1 }); expect(u.profile.details).toHaveLength(3);
    expect(screen.queryByTestId('analisis')).toBeNull(); expect(document.querySelector('#fakta-en').disabled).toBe(true); expect(screen.queryByTestId('konfirmasi')).toBeNull(); expect(screen.getByTestId('buka-kembali')).toBeTruthy();
    fireEvent.click(screen.getByTestId('buka-kembali')); await waitFor(() => expect(screen.getByTestId('status-produk').textContent).toBe('Draf')); expect(c.db.log.filter(x => x.op === 'update').at(-1).v).toMatchObject({ status: 'draft', confirmed_by: null, confirmed_at: null }); expect(screen.getByTestId('analisis')).toBeEnabled();
  });
  it('mengisi manual tanpa AI: tiga slot lalu simpan draf dan konfirmasi berjalan', async () => {
    const c = klien({ produk: [P()] }); buka(c); await siap();
    for (const [k, id, en] of [['detail_utama', 'kerah bulat', 'round neckline'], ['motif_kain', 'motif bunga', 'floral print'], ['lengan_bawahan_hem', 'lengan pendek', 'short sleeves']]) { fireEvent.change(document.querySelector(`#s-${k}-id`), { target: { value: id } }); fireEvent.change(document.querySelector(`#s-${k}-en`), { target: { value: en } }); }
    fireEvent.click(screen.getByTestId('simpan-draf')); await waitFor(() => expect(c.db.log.some(x => x.op === 'update' && x.v.status === 'analyzed')).toBe(true));
    await waitFor(() => expect(screen.getByTestId('konfirmasi')).toBeEnabled()); fireEvent.click(screen.getByTestId('konfirmasi')); await waitFor(() => expect(screen.getByTestId('status-produk').textContent).toBe('Terkonfirmasi')); expect(c.db.invoke).toHaveLength(0);
  });
  it('unggah foto: diunggah ke folder produk, peran otomatis diisi berurutan, disimpan; berkas salah dilaporkan dan dilewati', async () => {
    const c = klien({ produk: [P({ photos: [] })] }); buka(c); await siap();
    fireEvent.change(screen.getByLabelText(/Tambah foto/), { target: { files: [foto('a.png'), foto('b.gif', 'image/gif'), foto('c.png')] } }); await waitFor(() => expect(c.db.upload).toHaveLength(2));
    await waitFor(() => expect(c.db.log.some(x => x.op === 'update' && x.v.photos)).toBe(true)); const fotoSimpan = c.db.log.filter(x => x.op === 'update').at(-1).v.photos;
    expect(fotoSimpan.map(f => f.role)).toEqual(['depan', 'closeup']); expect(fotoSimpan[0].path).toMatch(new RegExp(`^${PID}/`)); await waitFor(() => expect(screen.getByTestId('galat-produk').textContent).toMatch(/b\.gif: Format foto harus PNG/));
  });
  it('batas 6 foto: sisanya dilewati dengan pesan; ubah peran dan hapus foto tersimpan', async () => {
    const enam = Array.from({ length: 5 }, (_, i) => ({ path: `${PID}/${i}.png`, role: 'depan' })); const c = klien({ produk: [P({ photos: enam })] }); buka(c); await siap();
    fireEvent.change(screen.getByLabelText(/Tambah foto/), { target: { files: [foto('x.png'), foto('y.png')] } }); await waitFor(() => expect(c.db.upload).toHaveLength(1)); await waitFor(() => expect(screen.getByTestId('galat-produk').textContent).toMatch(/Maksimal 6 foto/));
    await waitFor(() => expect(screen.getByText(/Foto produk \(6 dari 6\)/)).toBeTruthy()); expect(screen.queryByLabelText(/Tambah foto/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Peran foto 1'), { target: { value: 'tekstur' } }); await waitFor(() => expect(c.db.log.filter(x => x.op === 'update').at(-1).v.photos[0].role).toBe('tekstur'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Hapus' })[0]); await waitFor(() => expect(c.db.log.filter(x => x.op === 'update').at(-1).v.photos.length).toBe(5));
  });
  it('mengganti kategori ke arketipe lain mengosongkan detail (setelah konfirmasi) dan menampilkan arketipe serta risiko dari database; arketipe yang sama tidak mengosongkan', async () => {
    const c = klien({ produk: [P({ status: 'analyzed', profile: { facts: [], facts_en: [], colors: [], details: DETAIL } })] }); buka(c); await siap(); expect(document.querySelector('#s-detail_utama-en').value).toBe('round neckline with a front zipper');
    fireEvent.click(screen.getByRole('button', { name: 'Ganti kategori' })); fireEvent.change(screen.getByLabelText('Cari kategori'), { target: { value: 'gamis' } }); fireEvent.click(within(screen.getByTestId('hasil-kategori')).getAllByRole('option')[0]);
    await waitFor(() => expect(screen.getByTestId('pesan-produk').textContent).toBe('Kategori diganti.')); expect(c.db.log.filter(x => x.op === 'update').at(-1).v).toEqual({ category_key: 'fashion-wanita-dress-gamis', category_source: 'manual' }); expect(document.querySelector('#s-detail_utama-en').value).toBe('round neckline with a front zipper');
    fireEvent.click(screen.getByRole('button', { name: 'Ganti kategori' })); fireEvent.change(screen.getByLabelText('Cari kategori'), { target: { value: 'jerawat' } }); fireEvent.click(within(screen.getByTestId('hasil-kategori')).getAllByRole('option')[0]);
    await waitFor(() => expect(screen.getByTestId('pesan-produk').textContent).toMatch(/Detail slot dikosongkan/)); expect(window.confirm).toHaveBeenCalled(); expect(screen.getByTestId('kategori-sekarang').textContent).toMatch(/Treatment Jerawat.*arketipe A-05/); expect(screen.getByTestId('risiko-produk').className).toMatch(/badge-bad/);
    expect(screen.getByTestId('status-produk').textContent).toBe('Draf'); expect(document.querySelector('#s-kemasan_label-id').value).toBe('');
  });
  it('batal pada konfirmasi pergantian arketipe: tidak ada yang berubah', async () => {
    window.confirm = vi.fn(() => false); const c = klien({ produk: [P({ status: 'analyzed', profile: { details: DETAIL } })] }); buka(c); await siap();
    fireEvent.click(screen.getByRole('button', { name: 'Ganti kategori' })); fireEvent.change(screen.getByLabelText('Cari kategori'), { target: { value: 'serum' } }); fireEvent.click(within(screen.getByTestId('hasil-kategori')).getAllByRole('option')[0]);
    await waitFor(() => expect(window.confirm).toHaveBeenCalled()); expect(c.db.log.filter(x => x.op === 'update')).toHaveLength(0);
  });
  it('produk milik orang lain: hanya lihat, tanpa tombol ubah; admin boleh mengubah produk staf', async () => {
    let c = klien({ produk: [P({ created_by: U2 })] }); buka(c); await siap(); expect(screen.getByText(/milik orang lain/)).toBeTruthy(); for (const t of ['analisis', 'konfirmasi', 'simpan-draf']) expect(screen.queryByTestId(t)).toBeNull(); expect(screen.queryByLabelText(/Tambah foto/)).toBeNull(); cleanup();
    c = klien({ role: 'admin', produk: [P({ created_by: U2 })] }); buka(c); await siap(); expect(screen.queryByText(/milik orang lain/)).toBeNull(); expect(screen.getByTestId('analisis')).toBeEnabled();
  });
  it('produk tidak ditemukan dan produk tanpa kategori', async () => {
    bungkus(klien(), `/produk/${PID}`, rute); await waitFor(() => expect(screen.getByText('Produk tidak ditemukan')).toBeTruthy()); cleanup();
    buka(klien({ produk: [P({ archetype_id: null, category_key: null, risk_level: null })] })); await waitFor(() => expect(screen.getByText('Pilih kategori produk dulu.')).toBeTruthy()); expect(screen.getByTestId('analisis')).toBeDisabled(); expect(screen.getByTestId('konfirmasi')).toBeDisabled();
  });
});
