// Tes sisi website untuk generate gambar AI dan Riwayat generate. Memakai klien Supabase TIRUAN: yang belum terbukti di sini adalah
// Edge Function sungguhan, penyimpanan sungguhan, dan OpenRouter sungguhan (lihat generate-handler.test.js untuk sisi server).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from '../src/auth/AuthContext.jsx';
import PanelGenerate from '../src/components/PanelGenerate.jsx';
import Riwayat from '../src/pages/Riwayat.jsx';
import KarakterBaru from '../src/pages/KarakterBaru.jsx';
import Layout from '../src/components/Layout.jsx';
import {
  bulanIni, buatGambar, daftarRiwayat, detik, hubunganUntuk, jalurAcuan, jumlahkan, kualitasUntuk, pesanDariFungsi, rentangBulan, riwayatKeCsv,
  ringkasanBiaya, rupiah, tautkanGambar, unggahAcuan, usd, waktuWib
} from '../src/lib/generate.js';
import { barisKarakter, CONTOH_C02, dnaKosong } from '../src/lib/karakter.js';

// jsdom tidak mendekode gambar, jadi pembaca dimensi dibuat tiruan agar foto uji dianggap cukup besar.
vi.mock('../src/lib/karakter.js', async orig => ({ ...(await orig()), bacaDimensi: async () => ({ w: 1200, h: 1200 }) }));

// Pencocok sederhana (proyek ini tidak memasang jest-dom).
expect.extend({
  toBeDisabled(el) { return { pass: Boolean(el) && el.disabled === true, message: () => 'elemen seharusnya nonaktif' }; },
  toBeEnabled(el) { return { pass: Boolean(el) && el.disabled === false, message: () => 'elemen seharusnya aktif' }; },
  toHaveAttribute(el, k, v) { const a = el.getAttribute(k); return { pass: v === undefined ? a !== null : a === v, message: () => `atribut ${k} = ${a}, diharapkan ${v}` }; }
});

beforeEach(() => { URL.createObjectURL = vi.fn(() => `blob:uji-${Math.random()}`); URL.revokeObjectURL = vi.fn(); });
afterEach(cleanup);

const U1 = 'u1-0000-0000-0000-000000000001';
const DNA = { ...CONTOH_C02.dna };
const DNA_PRIA = { gender: 'laki-laki', age_group: 'dewasa', face_shape: 'persegi', complexion: 'sawo_matang', expression: 'kalem', hair_length: 'pendek', hair_texture: 'lurus', hair_color: 'hitam' };
const foto = (nama = 'a.png', type = 'image/png', ukuran = 20000) => new File([new Uint8Array(ukuran)], nama, { type });
const sukses = seq => ({ data: { ok: true, run_id: `r${seq}`, image_path: `generated/${U1}/b/${seq}.png`, cost_usd: 0.03, cost_idr: 495, kurs: 16500, seq }, error: null });
const galatFungsi = (pesan, kode = 'batas_harian') => ({ data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { name: 'FunctionsHttpError', context: { json: async () => ({ ok: false, kode, pesan }) } }) });

// Klien tiruan serbaguna
function klien({ role = 'admin', invoke, rpc = {}, tabel = {} } = {}) {
  const log = { invoke: [], upload: [], rpc: [], from: [] };
  const hasilTabel = (t, op) => { const k = `${t}.${op}`; return tabel[k] !== undefined ? (typeof tabel[k] === 'function' ? tabel[k]() : tabel[k]) : { data: [], error: null }; };
  const from = t => {
    if (t === 'user_profiles') { const c = { select: () => c, eq: () => c, maybeSingle: () => Promise.resolve({ data: { id: U1, name: 'Patrik', role }, error: null }) }; return c; }
    const st = { t, op: 'select', v: null }; const b = {
      select() { return b; }, order() { return b; }, eq() { return b; },
      insert(v) { st.op = 'insert'; st.v = v; return b; }, update(v) { st.op = 'update'; st.v = v; return b; },
      then(res, rej) { log.from.push({ ...st }); return Promise.resolve(hasilTabel(t, st.op)).then(res, rej); }
    }; return b;
  };
  return {
    log,
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: U1, email: 'p@x.id' } } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: () => Promise.resolve({}) },
    from,
    functions: { invoke: async (nama, o) => { log.invoke.push({ nama, body: o.body }); return invoke ? invoke(o.body) : sukses(o.body.seq); } },
    storage: { from: () => ({
      upload: async (path, f, opt) => { log.upload.push({ path, f, opt }); return { data: {}, error: null }; },
      download: async path => ({ data: new Blob([new Uint8Array(30000)], { type: 'image/png' }), error: null })
    }) },
    rpc: async (fn, args) => { log.rpc.push({ fn, args }); const r = rpc[fn]; return typeof r === 'function' ? r(args) : (r || { data: [], error: null }); }
  };
}

// ───────────── Pustaka ─────────────
describe('lib/generate: format, rentang, hubungan, kualitas', () => {
  it('rupiah dan USD', () => {
    expect(rupiah(495)).toBe('Rp 495'); expect(rupiah(1234567.6)).toBe('Rp 1.234.568'); expect(rupiah(null)).toBe('–'); expect(rupiah(NaN)).toBe('–');
    expect(usd(0.03)).toBe('US$ 0.03'); expect(usd(0.0333)).toBe('US$ 0.0333'); expect(usd(1.5)).toBe('US$ 1.50'); expect(usd(undefined)).toBe('–');
    expect(detik(5000)).toBe('5.0 dtk'); expect(detik(45000)).toBe('45 dtk'); expect(detik(null)).toBe('–');
  });
  it('rentang bulan memakai WIB (UTC+7) dan menolak format salah; Desember berganti tahun', () => {
    expect(rentangBulan('2026-10')).toEqual({ dari: '2026-10-01T00:00:00+07:00', sampai: '2026-11-01T00:00:00+07:00' });
    expect(rentangBulan('2026-12')).toEqual({ dari: '2026-12-01T00:00:00+07:00', sampai: '2027-01-01T00:00:00+07:00' });
    for (const x of ['2026-13', '2026-1', '', 'abc', null]) expect(() => rentangBulan(x)).toThrow(/YYYY-MM/);
  });
  it('bulan ini menurut WIB: 31 Okt 20.00 UTC sudah 1 Nov di WIB', () => {
    expect(bulanIni(new Date('2026-10-31T16:59:00Z'))).toBe('2026-10'); expect(bulanIni(new Date('2026-10-31T17:00:00Z'))).toBe('2026-11'); expect(bulanIni(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01');
  });
  it('hubungan mengikuti jenis kelamin DNA: ibu hanya perempuan, ayah hanya laki-laki', () => {
    const p = hubunganUntuk('perempuan').map(h => h.kunci), l = hubunganUntuk('laki-laki').map(h => h.kunci);
    expect(p).toContain('ibu'); expect(p).not.toContain('ayah'); expect(l).toContain('ayah'); expect(l).not.toContain('ibu');
    for (const k of ['kakak', 'adik', 'orang_sama', 'mirip_bukan_sama']) { expect(p).toContain(k); expect(l).toContain(k); }
  });
  it('kualitas high hanya untuk admin', () => { expect(kualitasUntuk(false).map(k => k.kunci)).toEqual(['low', 'medium']); expect(kualitasUntuk(true).map(k => k.kunci)).toEqual(['low', 'medium', 'high']); });
  it('jalur foto acuan di folder pemilik; waktu WIB', () => { expect(jalurAcuan('u9', 'png', 'x1')).toBe('refs/u9/x1.png'); expect(waktuWib('2026-10-06T00:30:00Z')).toMatch(/07\.30|07:30/); });
  it('jumlahkan dan CSV (kutip ganda di-escape, BOM, Rupiah dan USD apa adanya)', () => {
    expect(jumlahkan([{ gambar: 2, gagal: 1, usd: 0.06, idr: 990, tanpaBiaya: 0 }, { gambar: 1, gagal: 0, usd: 0.01, idr: 165, tanpaBiaya: 1 }])).toEqual({ gambar: 3, gagal: 1, usd: 0.07, idr: 1155, tanpaBiaya: 1 });
    expect(jumlahkan([])).toEqual({ gambar: 0, gagal: 0, usd: 0, idr: 0, tanpaBiaya: 0 });
    const csv = riwayatKeCsv([{ waktu: '2026-10-06T01:00:00Z', nama: 'Ndyy, Jr', jenis: 'wajah_dna', kode_karakter: 'C02', kualitas: 'low', status: 'gagal', durasi_ms: 5000, usd: null, kurs: 16500, idr: null, galat: 'dia bilang "tidak"' }]);
    expect(csv.startsWith('\ufeffWaktu (ISO),Siapa')).toBe(true); expect(csv).toContain('"Ndyy, Jr"'); expect(csv).toContain('"dia bilang ""tidak"""'); expect(csv).toContain('Wajah dari DNA,C02,low,gagal,5.0,,16500,,');
  });
});

describe('lib/generate: memanggil fungsi', () => {
  it('buatGambar: satu klik = satu batch_id; tiap gambar satu panggilan serentak dengan seq 1..n dan total n; hasil sebagian gagal tetap terkumpul', async () => {
    const c = klien({ invoke: b => (b.seq === 2 ? galatFungsi('Batas harian 20 gambar sudah tercapai.') : sukses(b.seq)) }); const slot = [];
    const { batchId, hasil } = await buatGambar(c, { kind: 'wajah_dna', dna: DNA, quality: 'low', jumlah: 3 }, (i, h) => slot.push([i, h.ok]));
    expect(c.log.invoke).toHaveLength(3); expect(new Set(c.log.invoke.map(x => x.body.batch_id))).toEqual(new Set([batchId])); expect(c.log.invoke.map(x => x.body.seq).sort()).toEqual([1, 2, 3]);
    expect(c.log.invoke.every(x => x.nama === 'generate-image' && x.body.total === 3 && x.body.quality === 'low' && x.body.kind === 'wajah_dna')).toBe(true);
    expect(c.log.invoke[0].body).not.toHaveProperty('relation'); expect(c.log.invoke[0].body).not.toHaveProperty('ref_path');
    expect(hasil.map(h => h.ok)).toEqual([true, false, true]); expect(hasil[1].pesan).toMatch(/Batas harian 20/); expect(slot.sort()).toEqual([[0, true], [1, false], [2, true]]);
  });
  it('buatGambar acuan menyertakan hubungan, catatan, dan alamat foto; jumlah di luar 1 sampai 4 ditolak sebelum memanggil', async () => {
    const c = klien(); await buatGambar(c, { kind: 'wajah_acuan', dna: DNA_PRIA, quality: 'medium', jumlah: 1, relation: 'kakak', note: 'kakak laki-laki', refPath: 'refs/u1/x.png' });
    expect(c.log.invoke[0].body).toMatchObject({ kind: 'wajah_acuan', relation: 'kakak', note: 'kakak laki-laki', ref_path: 'refs/u1/x.png', quality: 'medium' });
    for (const n of [0, 5, 1.5, 'x']) await expect(buatGambar(c, { kind: 'wajah_dna', dna: DNA, quality: 'low', jumlah: n })).rejects.toThrow(/1 sampai 4/);
    expect(c.log.invoke).toHaveLength(1);
  });
  it('buatGambar: pengecualian dari jaringan menjadi pesan awam, bukan melempar', async () => {
    const c = klien({ invoke: () => { throw new TypeError('Failed to fetch'); } }); const { hasil } = await buatGambar(c, { kind: 'wajah_dna', dna: DNA, quality: 'low', jumlah: 2 });
    expect(hasil.every(h => !h.ok && /Tidak tersambung ke server/.test(h.pesan))).toBe(true);
  });
  it('pesanDariFungsi: membaca pesan awam dari badan jawaban; galat generik diterjemahkan', async () => {
    expect(await pesanDariFungsi(galatFungsi('Kualitas high hanya untuk admin.', 'kualitas_admin').error)).toEqual({ pesan: 'Kualitas high hanya untuk admin.', kode: 'kualitas_admin' });
    expect((await pesanDariFungsi(new Error('Edge Function returned a non-2xx status code'))).pesan).toMatch(/Server menolak/);
    expect((await pesanDariFungsi(Object.assign(new Error('Failed to send a request to the Edge Function'), { name: 'FunctionsFetchError' }))).pesan).toMatch(/belum terpasang|tidak bisa dijangkau|Terjadi kesalahan/);
    expect((await pesanDariFungsi({ context: { json: async () => { throw new Error('bukan json'); } }, message: 'x' })).pesan).toMatch(/Terjadi kesalahan: x/);
  });
  it('unggahAcuan: ke folder refs/<user>/ dan tanpa menimpa; galat penyimpanan dilempar', async () => {
    const c = klien(); const p = await unggahAcuan(c, U1, foto('a.png')); expect(p).toMatch(new RegExp(`^refs/${U1}/[0-9a-f-]{36}\\.png$`)); expect(c.log.upload[0].opt).toMatchObject({ upsert: false, contentType: 'image/png' });
    c.storage.from = () => ({ upload: async () => ({ error: new Error('bucket penuh') }) }); await expect(unggahAcuan(c, U1, foto())).rejects.toThrow(/bucket penuh/);
  });
  it('RPC admin: ringkasan, daftar (total dari baris pertama), dan tautan; galat dilempar', async () => {
    const c = klien({ rpc: {
      ugc_image_cost_summary: { data: [{ uid: 'a', nama: 'Ndyy', gambar: '2', gagal: '1', usd: '0.06', idr: '990', tanpa_biaya: '0' }], error: null },
      ugc_image_runs_list: { data: [{ id: 'r1', total: '7' }, { id: 'r2', total: '7' }], error: null }, ugc_image_link: { data: null, error: null } } });
    const r = { dari: 'D', sampai: 'S' };
    expect(await ringkasanBiaya(c, r)).toEqual([{ uid: 'a', nama: 'Ndyy', gambar: 2, gagal: 1, usd: 0.06, idr: 990, tanpaBiaya: 0 }]);
    const d = await daftarRiwayat(c, { ...r, uid: '', jenis: '', batas: 50, mulai: 100 }); expect(d.total).toBe(7); expect(d.baris).toHaveLength(2);
    expect(c.log.rpc[1].args).toEqual({ p_from: 'D', p_to: 'S', p_user: null, p_kind: null, p_limit: 50, p_offset: 100 });
    await tautkanGambar(c, 'r1', 'c1'); expect(c.log.rpc[2]).toEqual({ fn: 'ugc_image_link', args: { p_run: 'r1', p_character: 'c1' } });
    expect(await daftarRiwayat(klien({ rpc: { ugc_image_runs_list: { data: [], error: null } } }), r)).toEqual({ baris: [], total: 0 });
    await expect(ringkasanBiaya(klien({ rpc: { ugc_image_cost_summary: { data: null, error: { code: '42501', message: 'Laporan biaya khusus admin' } } } }), r)).rejects.toMatchObject({ code: '42501' });
  });
  it('barisKarakter: mode pembuatan opsional, bawaan tetap reference, nilai asing diabaikan', () => {
    const f = { code: 'C1', name: 'Ab', dna: { ...dnaKosong(), ...DNA }, voice: { base_voice: 'Leda' }, flowProjectUrl: 'https://flow.google.com/project/x', flowAccountName: 'a@b' };
    expect(barisKarakter(f, 'u').creation_mode).toBe('reference'); expect(barisKarakter({ ...f, creationMode: 'dna_first' }, 'u').creation_mode).toBe('dna_first'); expect(barisKarakter({ ...f, creationMode: "x'; drop" }, 'u').creation_mode).toBe('reference');
  });
});

// ───────────── Panel generate ─────────────
function panel(props = {}) {
  const c = props.client || klien(); const onPilih = vi.fn();
  render(<PanelGenerate client={c} userId={U1} admin={props.admin ?? true} mode={props.mode || 'dna'} dna={props.dna || DNA} dnaValid={props.dnaValid ?? true} onPilih={onPilih} pilihanRunId={props.pilihanRunId || ''} />);
  return { c, onPilih };
}
describe('PanelGenerate: wajah dari DNA', () => {
  it('admin: membuat 2 gambar, melihat biaya Rupiah dan USD per gambar dan total, lalu memilih satu', async () => {
    const { c, onPilih } = panel();
    fireEvent.click(screen.getByTestId('buat-gambar')); expect(screen.getByTestId('buat-gambar')).toBeDisabled();
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    expect(c.log.invoke).toHaveLength(2); expect(screen.getAllByTestId('biaya-gambar')[0].textContent).toMatch(/Rp 495.*US\$ 0\.03.*kurs 16\.500/);
    await waitFor(() => expect(screen.getByTestId('biaya-total').textContent).toMatch(/Rp 990 \(US\$ 0\.06\)/));
    fireEvent.click(screen.getAllByRole('button', { name: 'Pakai gambar ini' })[0]);
    await waitFor(() => expect(onPilih).toHaveBeenCalledTimes(1));
    const [file, meta] = onPilih.mock.calls[0]; expect(file).toBeInstanceOf(File); expect(file.type).toBe('image/png'); expect(file.name).toMatch(/^wajah-ai-\d\.png$/); expect(meta).toMatchObject({ mode: 'dna', kind: 'wajah_dna' }); expect(meta.runId).toMatch(/^r[12]$/);
  });
  it('staf: biaya TIDAK tampil, kualitas high tidak ada di pilihan', async () => {
    panel({ admin: false }); const opsi = within(screen.getByLabelText('Kualitas')).getAllByRole('option').map(o => o.value); expect(opsi).toEqual(['low', 'medium']);
    fireEvent.click(screen.getByTestId('buat-gambar')); await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    expect(screen.queryByTestId('biaya-gambar')).toBeNull(); expect(screen.queryByTestId('biaya-total')).toBeNull(); expect(document.body.textContent).not.toMatch(/Rp \d/);
  });
  it('jumlah dan kualitas dipakai pada permintaan', async () => {
    const { c } = panel(); fireEvent.change(screen.getByLabelText('Jumlah gambar'), { target: { value: '3' } }); fireEvent.change(screen.getByLabelText('Kualitas'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buat 3 gambar' })); await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3));
    expect(c.log.invoke.every(x => x.body.quality === 'high' && x.body.total === 3)).toBe(true);
  });
  it('satu gambar gagal: pesan dari server tampil di kartunya, gambar lain tetap bisa dipakai', async () => {
    panel({ client: klien({ invoke: b => (b.seq === 2 ? galatFungsi('Batas harian 20 gambar sudah tercapai. Coba lagi besok.') : sukses(b.seq)) }) });
    fireEvent.click(screen.getByTestId('buat-gambar')); await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/Gambar 2 gagal\. Batas harian 20/); expect(screen.getAllByRole('img')).toHaveLength(1); expect(screen.getByRole('button', { name: 'Pakai gambar ini' })).toBeEnabled();
  });
  it('DNA belum lengkap: tombol nonaktif dan ada penjelasan', () => { panel({ dnaValid: false }); expect(screen.getByTestId('buat-gambar')).toBeDisabled(); expect(screen.getByText(/DNA di langkah 2 belum lengkap/)).toBeTruthy(); });
  it('gambar yang dipilih ditandai terpilih', async () => {
    panel({ pilihanRunId: 'r1' }); fireEvent.click(screen.getByTestId('buat-gambar')); await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Terpilih' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('PanelGenerate: wajah dari foto acuan (eksperimen)', () => {
  const pilihFoto = async (f = foto()) => { fireEvent.change(screen.getByLabelText('Foto acuan'), { target: { files: [f] } }); await waitFor(() => expect(screen.getByAltText('Pratinjau foto acuan')).toBeTruthy()); };
  it('tombol baru aktif setelah foto dipilih DAN izin dicentang; label eksperimen dan peringatan privasi tampil', async () => {
    panel({ mode: 'acuan', dna: DNA_PRIA });
    expect(screen.getByText(/Eksperimen/)).toBeTruthy(); expect(screen.getByText(/dikirim ke OpenRouter/)).toBeTruthy(); expect(screen.getByTestId('buat-gambar')).toBeDisabled();
    await pilihFoto(); expect(screen.getByTestId('buat-gambar')).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/izin memakai fotonya sudah saya urus/)); expect(screen.getByTestId('buat-gambar')).toBeEnabled();
  });
  it('mengunggah foto ke refs/<user>/ lalu memanggil fungsi dengan hubungan, catatan, dan alamat foto', async () => {
    const { c } = panel({ mode: 'acuan', dna: DNA_PRIA }); await pilihFoto();
    fireEvent.change(screen.getByLabelText(/Catatan/), { target: { value: 'kakak laki-laki' } }); fireEvent.click(screen.getByLabelText(/izin memakai fotonya/));
    fireEvent.change(screen.getByLabelText('Jumlah gambar'), { target: { value: '1' } }); fireEvent.click(screen.getByTestId('buat-gambar'));
    await waitFor(() => expect(screen.getAllByRole('img').length).toBeGreaterThan(1));
    expect(c.log.upload).toHaveLength(1); expect(c.log.upload[0].path).toMatch(new RegExp(`^refs/${U1}/`));
    expect(c.log.invoke[0].body).toMatchObject({ kind: 'wajah_acuan', relation: 'kakak', note: 'kakak laki-laki', ref_path: c.log.upload[0].path, total: 1 });
  });
  it('pilihan hubungan mengikuti DNA (laki-laki: tanpa ibu), dan peringatan konflik tampil bila catatan bertentangan dengan DNA', async () => {
    panel({ mode: 'acuan', dna: DNA_PRIA }); const hub = within(screen.getByLabelText(/Hubungan/)).getAllByRole('option').map(o => o.value); expect(hub).toContain('ayah'); expect(hub).not.toContain('ibu');
    cleanup(); panel({ mode: 'acuan', dna: DNA });
    fireEvent.change(screen.getByLabelText(/Catatan/), { target: { value: 'kakak perempuan' } }); expect(screen.queryByTestId('konflik')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Catatan/), { target: { value: 'laki-laki' } }); expect(screen.getByTestId('konflik').textContent).toMatch(/catatan menyebut laki-laki, tetapi DNA berjenis kelamin perempuan/);
  });
  it('foto acuan terlalu kecil ditolak dengan pesan, dan unggahan tidak dilakukan', async () => {
    const { c } = panel({ mode: 'acuan', dna: DNA_PRIA }); fireEvent.change(screen.getByLabelText('Foto acuan'), { target: { files: [foto('k.png', 'image/png', 500)] } });
    await waitFor(() => expect(screen.getByTestId('galat-acuan').textContent).toMatch(/terlalu kecil/)); expect(c.log.upload).toHaveLength(0); expect(screen.getByTestId('buat-gambar')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Foto acuan'), { target: { files: [foto('k.gif', 'image/gif')] } }); await waitFor(() => expect(screen.getByTestId('galat-acuan').textContent).toMatch(/PNG, JPG, atau WEBP/));
  });
  it('unggahan foto acuan gagal: galat awam tampil dan fungsi tidak dipanggil', async () => {
    const c = klien(); c.storage.from = () => ({ upload: async () => ({ error: { message: 'Failed to fetch' } }), download: async () => ({ data: new Blob(['x']), error: null }) });
    panel({ client: c, mode: 'acuan', dna: DNA_PRIA }); await pilihFoto(); fireEvent.click(screen.getByLabelText(/izin memakai fotonya/)); fireEvent.click(screen.getByTestId('buat-gambar'));
    await waitFor(() => expect(screen.getByTestId('galat-generate').textContent).toMatch(/Tidak tersambung ke server/)); expect(c.log.invoke).toHaveLength(0);
  });
});

// ───────────── Halaman Riwayat ─────────────
const ringkasanData = [
  { uid: 'a1', nama: 'Ndyy', gambar: 12, gagal: 1, usd: 0.36, idr: 5940, tanpa_biaya: 0 },
  { uid: 'b2', nama: 'Rina', gambar: 3, gagal: 0, usd: 0.09, idr: 1485, tanpa_biaya: 1 }
];
const barisData = [
  { id: 'r1', waktu: '2026-10-06T01:00:00Z', uid: 'a1', nama: 'Ndyy', jenis: 'wajah_dna', kode_karakter: 'C02', kualitas: 'low', status: 'ok', galat: null, durasi_ms: 31000, usd: 0.03, kurs: 16500, idr: 495, hubungan: null, dipilih: true, total: 2 },
  { id: 'r2', waktu: '2026-10-06T02:00:00Z', uid: 'b2', nama: 'Rina', jenis: 'wajah_acuan', kode_karakter: null, kualitas: 'medium', status: 'gagal', galat: 'Saldo OpenRouter tidak cukup.', durasi_ms: 2000, usd: null, kurs: null, idr: null, hubungan: 'kakak', dipilih: false, total: 2 }
];
function halamanRiwayat(c) {
  return render(<MemoryRouter initialEntries={['/riwayat']}><AuthProvider client={c}><Routes><Route path="/riwayat" element={<Riwayat />} /><Route path="/" element={<p>DASBOR</p>} /></Routes></AuthProvider></MemoryRouter>);
}
describe('halaman Riwayat generate', () => {
  const rpcOk = () => ({ ugc_image_cost_summary: { data: ringkasanData, error: null }, ugc_image_runs_list: { data: barisData, error: null } });
  it('staf: tampil "khusus admin" dan TIDAK memanggil laporan sama sekali', async () => {
    const c = klien({ role: 'staff', rpc: rpcOk() }); halamanRiwayat(c); await waitFor(() => expect(screen.getByTestId('khusus-admin')).toBeTruthy());
    expect(c.log.rpc).toHaveLength(0); expect(document.body.textContent).not.toMatch(/Rp \d/);
  });
  it('admin: ringkasan total, tabel per orang, dan rincian dengan status, galat, karakter terpilih, dan biaya', async () => {
    const c = klien({ rpc: rpcOk() }); halamanRiwayat(c); await waitFor(() => expect(screen.getByTestId('tabel-rincian')).toBeTruthy());
    expect(screen.getByText('Gambar berhasil').parentElement.textContent).toMatch(/15.*1 gagal/); expect(screen.getByText('Biaya (Rupiah)').parentElement.textContent).toMatch(/Rp 7\.425/); expect(screen.getByText('Biaya (USD)').parentElement.textContent).toMatch(/US\$ 0\.45/);
    expect(screen.getByText('Tanpa biaya terlapor').parentElement.textContent).toMatch(/1/);
    const orang = within(screen.getByTestId('tabel-orang')); expect(orang.getByText('Ndyy')).toBeTruthy(); expect(orang.getByText('Rp 5.940')).toBeTruthy(); expect(orang.getByText('Rp 1.485')).toBeTruthy();
    const rincian = within(screen.getByTestId('tabel-rincian')); expect(rincian.getByText('C02 ✓')).toBeTruthy(); expect(rincian.getByText('Wajah dari foto acuan (kakak)')).toBeTruthy(); expect(rincian.getByText('Saldo OpenRouter tidak cukup.')).toBeTruthy();
    expect(rincian.getByText('Berhasil')).toBeTruthy(); expect(rincian.getByText('Gagal')).toBeTruthy(); expect(rincian.getByText('Rp 495')).toBeTruthy(); expect(rincian.getByText('31 dtk')).toBeTruthy(); expect(screen.getByTestId('info-halaman').textContent).toMatch(/1 sampai 2 dari 2/);
  });
  it('rentang bulan ini dipakai dan mengganti bulan atau orang memuat ulang dengan parameter yang benar, kembali ke halaman pertama', async () => {
    const c = klien({ rpc: rpcOk() }); halamanRiwayat(c); await waitFor(() => expect(screen.getByTestId('tabel-rincian')).toBeTruthy());
    const r0 = rentangBulan(bulanIni()); expect(c.log.rpc[0].args).toEqual({ p_from: r0.dari, p_to: r0.sampai }); expect(c.log.rpc[1].args).toMatchObject({ p_from: r0.dari, p_user: null, p_kind: null, p_limit: 50, p_offset: 0 });
    fireEvent.change(screen.getByLabelText('Bulan'), { target: { value: '2026-09' } }); await waitFor(() => expect(c.log.rpc.some(x => x.args.p_from === '2026-09-01T00:00:00+07:00')).toBe(true));
    fireEvent.change(screen.getByLabelText('Orang'), { target: { value: 'b2' } }); await waitFor(() => expect(c.log.rpc.some(x => x.args.p_user === 'b2')).toBe(true));
    fireEvent.change(screen.getByLabelText('Jenis'), { target: { value: 'wajah_acuan' } }); await waitFor(() => expect(c.log.rpc.some(x => x.args.p_kind === 'wajah_acuan')).toBe(true));
  });
  it('halaman berikutnya memakai offset 50; tombol nonaktif di ujung', async () => {
    const banyak = barisData.map(b => ({ ...b, total: 120 })); const c = klien({ rpc: { ugc_image_cost_summary: { data: ringkasanData, error: null }, ugc_image_runs_list: { data: banyak, error: null } } });
    halamanRiwayat(c); await waitFor(() => expect(screen.getByTestId('tabel-rincian')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Sebelumnya' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }));
    await waitFor(() => expect(c.log.rpc.some(x => x.args.p_offset === 50)).toBe(true)); await waitFor(() => expect(screen.getByTestId('info-halaman').textContent).toMatch(/51 sampai 100 dari 120/));
  });
  it('tidak ada data: pesan kosong; migrasi belum dijalankan dan izin ditolak: pesan awam', async () => {
    let c = klien({ rpc: { ugc_image_cost_summary: { data: [], error: null }, ugc_image_runs_list: { data: [], error: null } } }); halamanRiwayat(c);
    await waitFor(() => expect(screen.getByText('Belum ada gambar pada bulan ini.')).toBeTruthy()); expect(screen.getByText('Tidak ada data untuk pilihan ini.')).toBeTruthy(); cleanup();
    c = klien({ rpc: { ugc_image_cost_summary: { data: null, error: { message: 'Could not find the function public.ugc_image_cost_summary in the schema cache' } }, ugc_image_runs_list: { data: null, error: { message: 'x' } } } }); halamanRiwayat(c);
    await waitFor(() => expect(screen.getByTestId('galat-riwayat').textContent).toMatch(/jalankan berkas migrasi 20261006000800/)); cleanup();
    c = klien({ rpc: { ugc_image_cost_summary: { data: null, error: { code: '42501', message: 'x' } }, ugc_image_runs_list: { data: null, error: { code: '42501', message: 'x' } } } }); halamanRiwayat(c);
    await waitFor(() => expect(screen.getByTestId('galat-riwayat').textContent).toMatch(/khusus admin/));
  });
});

// ───────────── Alur Karakter baru dengan gambar AI ─────────────
function DetailTiruan() { const s = useLocation().state || {}; return <div data-testid="detail"><span data-testid="detail-pesan">{s.pesan || ''}</span><span data-testid="detail-peringatan">{s.peringatan || ''}</span></div>; }
function halamanBaru(c) {
  return render(<MemoryRouter initialEntries={['/karakter/baru']}><AuthProvider client={c}><Routes>
    <Route path="/karakter/baru" element={<KarakterBaru />} /><Route path="/karakter/:id" element={<DetailTiruan />} />
  </Routes></AuthProvider></MemoryRouter>);
}
const kolom = () => ({ 'ugc_characters.insert': { data: [{ id: 'c-baru', status: 'draft' }], error: null }, 'ugc_character_photos.select': { data: [], error: null }, 'ugc_character_photos.insert': { data: null, error: null }, 'ugc_characters.update': { data: null, error: null } });
const lanjut = async () => { await waitFor(() => expect(screen.getByTestId('lanjut')).toBeEnabled()); fireEvent.click(screen.getByTestId('lanjut')); };
async function sampaiLangkahFoto() {
  await waitFor(() => expect(screen.getByTestId('isi-contoh')).toBeTruthy()); fireEvent.click(screen.getByTestId('isi-contoh')); await lanjut(); await lanjut();
  await waitFor(() => expect(screen.getByText('Dari mana fotonya?')).toBeTruthy());
}
describe('Karakter baru: foto wajah dari AI', () => {
  it('DNA contoh -> buat gambar dari DNA -> pilih -> lengkapi suara dan Flow -> simpan: karakter dibuat dengan mode dna_first, foto AI diunggah, riwayat ditautkan', async () => {
    const c = klien({ tabel: kolom() }); halamanBaru(c); await sampaiLangkahFoto();
    fireEvent.click(screen.getByLabelText('Buat dengan AI dari DNA')); expect(screen.getByTestId('panel-dna')).toBeTruthy(); expect(screen.getByTestId('lanjut')).toBeDisabled();
    fireEvent.click(screen.getByTestId('buat-gambar')); await waitFor(() => expect(screen.getAllByAltText(/Hasil gambar/)).toHaveLength(2));
    expect(c.log.invoke[0].body.dna).toMatchObject({ gender: 'perempuan', age_group: 'dewasa_muda', hair_color: 'cokelat_muda_karamel' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Pakai gambar ini' })[1]); await waitFor(() => expect(screen.getByTestId('pratinjau-foto')).toBeTruthy());
    expect(screen.getByText(/hasil AI/)).toBeTruthy(); await lanjut();
    await waitFor(() => expect(screen.getByLabelText('Alamat project Flow')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Alamat project Flow'), { target: { value: 'https://flow.google.com/project/abc123' } }); fireEvent.change(screen.getByLabelText('Nama akun Google Flow'), { target: { value: 'akun@bintang.id' } });
    await waitFor(() => expect(screen.getByTestId('simpan')).toBeEnabled()); fireEvent.click(screen.getByTestId('simpan'));
    await waitFor(() => expect(screen.getByTestId('detail')).toBeTruthy());
    const ins = c.log.from.find(x => x.t === 'ugc_characters' && x.op === 'insert'); expect(ins.v).toMatchObject({ code: 'C02_THE_SOFT_GIRL', creation_mode: 'dna_first', status: 'draft' });
    expect(c.log.upload.some(u => u.path === 'c-baru/face_front.png')).toBe(true); expect(c.log.upload.find(u => u.path === 'c-baru/face_front.png').f.name).toMatch(/^wajah-ai-2\.png$/);
    expect(c.log.rpc.find(x => x.fn === 'ugc_image_link').args).toEqual({ p_run: 'r2', p_character: 'c-baru' });
  });
  it('foto unggahan sendiri tetap berjalan seperti sebelumnya: mode reference dan TANPA menautkan riwayat', async () => {
    const c = klien({ tabel: kolom() }); halamanBaru(c); await sampaiLangkahFoto();
    fireEvent.change(screen.getByLabelText('Foto wajah'), { target: { files: [foto('saya.png', 'image/png', 30000)] } }); await waitFor(() => expect(screen.getByTestId('pratinjau-foto')).toBeTruthy()); await lanjut();
    await waitFor(() => expect(screen.getByLabelText('Alamat project Flow')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Alamat project Flow'), { target: { value: 'https://flow.google.com/project/abc123' } }); fireEvent.change(screen.getByLabelText('Nama akun Google Flow'), { target: { value: 'akun@bintang.id' } });
    await waitFor(() => expect(screen.getByTestId('simpan')).toBeEnabled()); fireEvent.click(screen.getByTestId('simpan')); await waitFor(() => expect(screen.getByTestId('detail')).toBeTruthy());
    expect(c.log.from.find(x => x.t === 'ugc_characters' && x.op === 'insert').v.creation_mode).toBe('reference'); expect(c.log.rpc.find(x => x.fn === 'ugc_image_link')).toBeUndefined(); expect(c.log.invoke).toHaveLength(0);
  });
  it('mengubah DNA setelah memilih gambar AI membatalkan gambar itu, memberi tahu, dan menahan langkah sampai foto dipilih lagi', async () => {
    const c = klien({ tabel: kolom() }); halamanBaru(c); await sampaiLangkahFoto();
    fireEvent.click(screen.getByLabelText('Buat dengan AI dari DNA')); fireEvent.click(screen.getByTestId('buat-gambar')); await waitFor(() => expect(screen.getAllByAltText(/Hasil gambar/)).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'Pakai gambar ini' })[0]); await waitFor(() => expect(screen.getByTestId('pratinjau-foto')).toBeTruthy()); expect(screen.getByTestId('lanjut')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Kembali' })); await waitFor(() => expect(screen.getByTestId('kalimat-penampilan')).toBeTruthy());   // kembali ke langkah DNA
    fireEvent.click(screen.getByLabelText('Kalem'));   // ekspresi diubah dari Ceria ke Kalem
    expect(screen.getByTestId('kalimat-penampilan').textContent).toMatch(/calm gentle smile/);
    fireEvent.click(screen.getByTestId('lanjut')); await waitFor(() => expect(screen.getByTestId('info-reset')).toBeTruthy());
    expect(screen.getByTestId('info-reset').textContent).toMatch(/gambar AI yang tadi dipilih dibatalkan/); expect(screen.queryByTestId('pratinjau-foto')).toBeNull(); expect(screen.getByTestId('lanjut')).toBeDisabled();
  });
  it('tautan riwayat gagal tidak membatalkan karakter: tetap pindah ke detail, foto terunggah, dengan peringatan yang menyebut riwayat belum tertaut', async () => {
    const c = klien({ tabel: kolom(), rpc: { ugc_image_link: { data: null, error: { message: 'Bukan gambar milik Anda', code: '42501' } } } }); halamanBaru(c); await sampaiLangkahFoto();
    fireEvent.click(screen.getByLabelText('Buat dengan AI dari DNA')); fireEvent.click(screen.getByTestId('buat-gambar')); await waitFor(() => expect(screen.getAllByAltText(/Hasil gambar/)).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'Pakai gambar ini' })[0]); await waitFor(() => expect(screen.getByTestId('pratinjau-foto')).toBeTruthy()); await lanjut();
    await waitFor(() => expect(screen.getByLabelText('Alamat project Flow')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Alamat project Flow'), { target: { value: 'https://flow.google.com/project/abc123' } }); fireEvent.change(screen.getByLabelText('Nama akun Google Flow'), { target: { value: 'akun@bintang.id' } });
    await waitFor(() => expect(screen.getByTestId('simpan')).toBeEnabled()); fireEvent.click(screen.getByTestId('simpan')); await waitFor(() => expect(screen.getByTestId('detail')).toBeTruthy());
    expect(c.log.from.some(x => x.t === 'ugc_characters' && x.op === 'insert')).toBe(true); expect(c.log.upload.some(u => u.path === 'c-baru/face_front.png')).toBe(true);
    expect(screen.getByTestId('detail-pesan').textContent).toMatch(/Karakter tersimpan lengkap/); expect(screen.getByTestId('detail-peringatan').textContent).toMatch(/Riwayat generate belum tertaut.*Karakter sendiri sudah tersimpan/);
  });
});

// ───────────── Menu ─────────────
describe('menu utama', () => {
  const tampilMenu = c => render(<MemoryRouter initialEntries={['/']}><AuthProvider client={c}><Routes><Route element={<Layout />}><Route path="/" element={<p>ISI</p>} /></Route></Routes></AuthProvider></MemoryRouter>);
  it('tautan Riwayat generate hanya muncul untuk admin', async () => {
    tampilMenu(klien({ role: 'admin' })); await waitFor(() => expect(screen.getByRole('link', { name: 'Riwayat generate' })).toBeTruthy()); expect(screen.getByRole('link', { name: 'Riwayat generate' }).getAttribute('href')).toBe('/riwayat'); cleanup();
    tampilMenu(klien({ role: 'staff' })); await waitFor(() => expect(screen.getByText('Karakter')).toBeTruthy()); await waitFor(() => expect(screen.getByText('Staf')).toBeTruthy()); expect(screen.queryByRole('link', { name: 'Riwayat generate' })).toBeNull();
  });
});
