// Menguji inti Edge Function analyze-product dengan objek `d` tiruan: tanpa Supabase, tanpa OpenRouter, tanpa jaringan.
// Yang BELUM terbukti di sini: OpenRouter asli, model analisis asli (mutu isi, dukungan response_format), dan Supabase asli.
import { afterEach, describe, expect, it } from 'vitest';
import { BATAS, MODEL_BAWAAN, handle } from '../../supabase/functions/analyze-product/handler.js';

const KUNCI = 'sk-or-v1-RAHASIA-UJI-1234567890';
const ADMIN = '00000000-0000-0000-0000-0000000000a1', STAF = '00000000-0000-0000-0000-0000000000b2', LAIN = '00000000-0000-0000-0000-0000000000c3';
const PID = '11111111-1111-1111-1111-111111111111';
const RUN = 'aaaaaaaa-0000-0000-0000-000000000001';
const JPG = new Uint8Array([255, 216, 255, 224, 1, 2, 3, 4]);
const b64 = u8 => Buffer.from(u8).toString('base64');
const jsonRes = (status, obj) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(obj), json: async () => obj });
const AI = {
  fakta_id: ['Warna dasar abu'], fakta_en: ['Gray base with a pastel floral print'], warna: ['light gray'], peringatan: ['Foto belakang tidak ada'],
  detail: [
    { slot: 'detail_utama', teks_id: 'kerah bulat dengan resleting depan', teks_en: 'round neckline with a front zipper', label: 'kerah', keyakinan: 0.9 },
    { slot: 'motif_kain', teks_id: 'motif bunga pastel', teks_en: 'soft pastel floral print', label: 'motif', keyakinan: 0.8 },
    { slot: 'lengan_bawahan_hem', teks_id: 'lengan pendek', teks_en: 'short sleeves', label: 'lengan', keyakinan: 0.7 }]
};
const jawabAi = (obj = AI, cost = 0.004, isi = null) => jsonRes(200, { choices: [{ message: { role: 'assistant', content: isi ?? JSON.stringify(obj) }, finish_reason: 'stop' }], usage: cost == null ? {} : { prompt_tokens: 1200, completion_tokens: 300, cost } });
const FRANK = jsonRes(200, { date: '2026-10-06', rates: { IDR: 16500 } });
const FOTO = [{ path: `${PID}/a.jpg`, role: 'depan' }, { path: `${PID}/b.jpg`, role: 'closeup' }];

function dunia(o = {}) {
  const produk = o.produk === undefined ? { id: PID, created_by: STAF, archetype_id: 'A-01', category_key: 'x', kategori: 'Fashion Wanita > Dress > Daster', photos: FOTO } : o.produk;
  const s = { users: { tok_admin: { id: ADMIN }, tok_staf: { id: STAF }, tok_lain: { id: LAIN } }, roles: { [ADMIN]: 'admin', [STAF]: 'staff', [LAIN]: 'staff' }, settings: { ...(o.settings || {}) },
    produk, reserve: [], runs: {}, updates: [], orPanggilan: [], orPesan: [...(o.orPesan || [jawabAi()])], berkas: o.berkas || {}, jam: 1_000_000, reserveHasil: o.reserveHasil || 'ok', unduh: [] };
  s.runs[RUN] = null;
  const d = {
    apiKey: o.apiKey === undefined ? KUNCI : o.apiKey, retryWaitMs: 0,
    now: () => s.jam, uuid: () => RUN, toBase64: b64,
    getUser: async t => s.users[t] || null, getRole: async id => s.roles[id] ?? null,
    getSettings: async keys => Object.fromEntries(keys.filter(k => k in s.settings).map(k => [k, s.settings[k]])),
    setSetting: async (k, v) => { s.settings[k] = v; },
    getProduct: async id => (s.produk && s.produk.id === id ? s.produk : null),
    reserveAnalysis: async (row, limit) => { s.reserve.push({ row, limit }); if (s.reserveHasil === 'ok') s.runs[row.id] = { ...row, status: 'running' }; return s.reserveHasil; },
    updateRun: async (id, patch) => { s.updates.push([id, patch]); if (s.runs[id]) Object.assign(s.runs[id], patch); },
    downloadFoto: async p => { s.unduh.push(p); return p in s.berkas ? s.berkas[p] : { bytes: JPG, contentType: 'image/jpeg' }; },
    fetch: async (url, opt = {}) => {
      if (url.startsWith('https://openrouter.ai/')) {
        s.orPanggilan.push({ url, opt, body: JSON.parse(opt.body) }); s.jam += o.orMs ?? 8000;
        const n = s.orPesan.length > 1 ? s.orPesan.shift() : s.orPesan[0]; if (typeof n === 'function') return n(opt); if (n instanceof Error) throw n; return n;
      }
      const k = (o.kurs || {})[url.includes('frankfurter') ? 'frank' : 'er']; if (k instanceof Error) throw k; return k || (url.includes('frankfurter') ? FRANK : jsonRes(500, {}));
    }
  };
  return { s, d };
}
const minta = (over = {}) => ({ product_id: PID, ...over });
const jalan = (w, body = minta(), token = 'tok_staf') => handle({ token, body }, w.d);
const awal = { ...BATAS }; afterEach(() => Object.assign(BATAS, awal));
const kurs = { settings: { kurs_usd_idr_manual: 16500 } };

describe('login, peran, kunci', () => {
  it('tanpa token, token palsu, peran tidak berhak, kunci server kosong: ditolak sebelum menyentuh produk atau OpenRouter', async () => {
    const w = dunia();
    expect((await handle({ token: '', body: minta() }, w.d)).status).toBe(401); expect((await handle({ token: 'palsu', body: minta() }, w.d)).status).toBe(401);
    w.s.roles[STAF] = 'agent'; expect((await jalan(w)).status).toBe(403); w.s.roles[STAF] = null; expect((await jalan(w)).json.kode).toBe('tanpa_izin');
    const x = dunia({ apiKey: '' }); const r = await jalan(x); expect(r.status).toBe(500); expect(r.json.kode).toBe('kunci_belum_dipasang');
    for (const k of [w, x]) { expect(k.s.reserve.length).toBe(0); expect(k.s.orPanggilan.length).toBe(0); }
  });
});

describe('validasi produk (semua ditolak sebelum memesan jatah dan sebelum OpenRouter)', () => {
  const kasus = [
    ['product_id bukan UUID', null, { product_id: 'abc' }, 'tok_staf', 400, 'masukan_salah'],
    ['badan bukan objek', null, 'x', 'tok_staf', 400, 'masukan_salah'],
    ['produk tidak ada', null, { product_id: '22222222-2222-2222-2222-222222222222' }, 'tok_staf', 404, 'produk_tidak_ada'],
    ['produk milik staf lain', null, {}, 'tok_lain', 403, 'bukan_milik'],
    ['belum pilih kategori', { archetype_id: null }, {}, 'tok_staf', 400, 'tanpa_kategori'],
    ['belum ada foto', { photos: [] }, {}, 'tok_staf', 400, 'tanpa_foto'],
    ['foto lebih dari 6', { photos: Array.from({ length: 7 }, (_, i) => ({ path: `${PID}/${i}.jpg`, role: 'depan' })) }, {}, 'tok_staf', 400, 'foto_terlalu_banyak'],
    ['alamat foto milik produk lain', { photos: [{ path: `22222222-2222-2222-2222-222222222222/a.jpg`, role: 'depan' }] }, {}, 'tok_staf', 400, 'foto_salah'],
    ['alamat foto dengan ..', { photos: [{ path: `${PID}/../x.jpg`, role: 'depan' }] }, {}, 'tok_staf', 400, 'foto_salah'],
    ['peran foto tidak dikenal', { photos: [{ path: `${PID}/a.jpg`, role: 'aneh' }] }, {}, 'tok_staf', 400, 'foto_salah'],
    ['hanya berkas izin klien', { archetype_id: 'A-08', photos: [{ path: `${PID}/a.jpg`, role: 'izin_klien' }] }, {}, 'tok_staf', 400, 'masukan_salah'],
    ['arketipe tidak dikenal', { archetype_id: 'A-99' }, {}, 'tok_staf', 400, 'masukan_salah']
  ];
  for (const [nama, ubah, body, token, status, kode] of kasus) {
    it(nama, async () => {
      const base = { id: PID, created_by: STAF, archetype_id: 'A-01', category_key: 'x', kategori: 'K', photos: FOTO };
      const w = dunia({ produk: ubah === null ? base : { ...base, ...ubah } }); const r = await jalan(w, typeof body === 'string' ? body : minta(body), token);
      expect(r.status).toBe(status); expect(r.json.kode).toBe(kode); expect(r.json.ok).toBe(false); expect(w.s.reserve.length).toBe(0); expect(w.s.orPanggilan.length).toBe(0); expect(w.s.unduh.length).toBe(0);
    });
  }
  it('admin boleh menganalisis produk milik staf', async () => { const w = dunia(kurs); expect((await jalan(w, minta(), 'tok_admin')).status).toBe(200); });
});

describe('analisis berhasil', () => {
  it('mengirim pesan sistem, teks, dan gambar berurutan ke OpenRouter dengan kunci server dan model dari pengaturan; draf profil siap dan biaya dicatat', async () => {
    const w = dunia({ ...kurs, settings: { ...kurs.settings, analisis_model: 'google/gemini-9-uji' } }); const r = await jalan(w, minta(), 'tok_staf');
    expect(r.status).toBe(200); expect(r.json.ok).toBe(true); expect(r.json.model).toBe('google/gemini-9-uji');
    const p = w.s.orPanggilan[0]; expect(p.url).toBe('https://openrouter.ai/api/v1/chat/completions'); expect(p.opt.headers.Authorization).toBe(`Bearer ${KUNCI}`);
    expect(p.body).toMatchObject({ model: 'google/gemini-9-uji', response_format: { type: 'json_object' }, temperature: 0.2, max_tokens: 1800 });
    expect(p.body.messages[0]).toMatchObject({ role: 'system' }); expect(p.body.messages[0].content).toMatch(/ONE JSON object/);
    const isi = p.body.messages[1].content; expect(isi[0].type).toBe('text'); expect(isi[0].text).toMatch(/Kategori produk .*Fashion Wanita > Dress > Daster/); expect(isi[0].text).toMatch(/Foto 1: peran "depan"\nFoto 2: peran "closeup"/);
    expect(isi.slice(1).map(x => x.type)).toEqual(['image_url', 'image_url']); expect(isi[1].image_url.url).toBe(`data:image/jpeg;base64,${b64(JPG)}`); expect(w.s.unduh).toEqual([`${PID}/a.jpg`, `${PID}/b.jpg`]);
    expect(r.json.hasil.ready).toBe(true); expect(r.json.hasil.profile.details.map(x => x.slot_key)).toEqual(['detail_utama', 'motif_kain', 'lengan_bawahan_hem']); expect(r.json.hasil.catatan).toEqual(['Foto belakang tidak ada']);
    expect(w.s.runs[RUN]).toMatchObject({ status: 'ok', cost_usd: 0.004, kurs_idr: 16500, cost_idr: 66 }); expect(w.s.runs[RUN].duration_ms).toBe(8000);
    expect(w.s.reserve[0]).toEqual({ row: { id: RUN, user_id: STAF, product_id: PID, model: 'google/gemini-9-uji' }, limit: 30 });
  });
  it('model bawaan bila pengaturan kosong; batas harian staf dari pengaturan; admin tanpa batas', async () => {
    let w = dunia(kurs); await jalan(w); expect(w.s.orPanggilan[0].body.model).toBe(MODEL_BAWAAN); expect(w.s.reserve[0].limit).toBe(30);
    w = dunia({ settings: { ...kurs.settings, analisis_limit_harian_staf: 3 } }); await jalan(w); expect(w.s.reserve[0].limit).toBe(3);
    w = dunia(kurs); await jalan(w, minta(), 'tok_admin'); expect(w.s.reserve[0].limit).toBeNull();
  });
  it('staf TIDAK menerima biaya, admin menerima biaya dan kurs; keduanya tercatat di baris riwayat', async () => {
    const s1 = dunia(kurs); const r1 = await jalan(s1); for (const k of ['cost_usd', 'cost_idr', 'kurs', 'kurs_sumber']) expect(r1.json, k).not.toHaveProperty(k); expect(s1.s.runs[RUN].cost_usd).toBe(0.004);
    const a1 = dunia(kurs); const r2 = await jalan(a1, minta(), 'tok_admin'); expect(r2.json).toMatchObject({ cost_usd: 0.004, cost_idr: 66, kurs: 16500, kurs_sumber: 'manual' });
  });
  it('peran izin_klien tidak dikirim ke AI dan tidak diunduh, tetapi tetap dihitung sebagai peran produk', async () => {
    const p = { id: PID, created_by: STAF, archetype_id: 'A-08', category_key: 'x', kategori: 'Makanan', photos: [{ path: `${PID}/a.jpg`, role: 'depan' }, { path: `${PID}/izin.jpg`, role: 'izin_klien' }, { path: `${PID}/c.jpg`, role: 'closeup' }] };
    const w = dunia({ ...kurs, produk: p }); const r = await jalan(w); expect(r.status).toBe(200);
    expect(w.s.unduh).toEqual([`${PID}/a.jpg`, `${PID}/c.jpg`]); const isi = w.s.orPanggilan[0].body.messages[1].content; expect(isi.filter(x => x.type === 'image_url').length).toBe(2); expect(isi[0].text).toMatch(/Foto 1: peran "depan"\nFoto 2: peran "closeup"/);
  });
  it('JSON berpagar kode, isi berupa daftar bagian, slot asing dibuang dan dilaporkan; analisis tetap berhasil walau profil belum siap (staf melengkapi sendiri)', async () => {
    const pagar = '```json\n' + JSON.stringify({ ...AI, detail: [...AI.detail, { slot: 'sol', teks_id: 'x', teks_en: 'y' }] }) + '\n```';
    let w = dunia({ ...kurs, orPesan: [jawabAi(null, 0.004, pagar)] }); let r = await jalan(w); expect(r.status).toBe(200); expect(r.json.hasil.dibuang.join()).toMatch(/"sol" bukan milik arketipe A-01/); expect(r.json.hasil.ready).toBe(true);
    const bagian = jsonRes(200, { choices: [{ message: { content: [{ type: 'text', text: JSON.stringify(AI) }] } }], usage: { cost: 0.002 } });
    w = dunia({ ...kurs, orPesan: [bagian] }); r = await jalan(w); expect(r.status).toBe(200); expect(r.json.hasil.profile.details.length).toBe(3);
    w = dunia({ ...kurs, orPesan: [jawabAi({ ...AI, detail: AI.detail.slice(0, 1) })] }); r = await jalan(w); expect(r.status).toBe(200); expect(r.json.hasil.ready).toBe(false); expect(r.json.hasil.issues.some(i => /minimal 3/.test(i.msg))).toBe(true);
    expect(w.s.runs[RUN].status).toBe('ok');
  });
  it('kata klaim dari AI tidak lolos diam-diam: dilaporkan sebagai galat pada draf (staf harus memperbaiki)', async () => {
    const w = dunia({ ...kurs, orPesan: [jawabAi({ ...AI, detail: [{ ...AI.detail[0], teks_id: 'kerah nyaman dan premium' }, ...AI.detail.slice(1)] })] }); const r = await jalan(w);
    expect(r.json.hasil.ready).toBe(false); expect(r.json.hasil.issues.some(i => i.level === 'error' && /kata klaim.*nyaman, premium/.test(i.msg))).toBe(true);
  });
});

describe('batas, duplikat, dan kegagalan', () => {
  it('batas harian tercapai -> 429 dengan angka batasnya; foto tidak diunduh dan OpenRouter tidak dipanggil', async () => {
    const w = dunia({ reserveHasil: 'batas', settings: { analisis_limit_harian_staf: 7 } }); const r = await jalan(w);
    expect(r.status).toBe(429); expect(r.json.pesan).toMatch(/Batas harian 7 analisis/); expect(w.s.orPanggilan.length).toBe(0); expect(w.s.unduh.length).toBe(0);
    const x = dunia({ reserveHasil: 'galat' }); expect((await jalan(x)).status).toBe(500); expect(x.s.orPanggilan.length).toBe(0);
  });
  it('foto hilang, terlalu besar, total terlalu besar, atau format salah: jatah dipesan lalu dicatat gagal dengan alasan; OpenRouter tidak dipanggil', async () => {
    const besar = { bytes: new Uint8Array(BATAS.fotoMaksByte + 1), contentType: 'image/jpeg' };
    const sedang = { bytes: new Uint8Array(BATAS.fotoMaksByte - 10), contentType: 'image/jpeg' };
    for (const [berkas, kode] of [[{ [FOTO[0].path]: null }, 'foto_tidak_ada'], [{ [FOTO[0].path]: besar }, 'foto_terlalu_besar'], [{ [FOTO[0].path]: { bytes: JPG, contentType: 'image/gif' } }, 'foto_format'], [{ [FOTO[0].path]: sedang, [FOTO[1].path]: sedang, [`${PID}/c.jpg`]: sedang }, 'foto_terlalu_besar']]) {
      const w = dunia({ berkas, produk: { id: PID, created_by: STAF, archetype_id: 'A-01', kategori: 'K', photos: kode === 'foto_terlalu_besar' && Object.keys(berkas).length > 1 ? [...FOTO, { path: `${PID}/c.jpg`, role: 'samping' }] : FOTO } });
      const r = await jalan(w); expect(r.json.kode, kode).toBe(kode); expect(w.s.orPanggilan.length).toBe(0); expect(w.s.runs[RUN]).toMatchObject({ status: 'gagal' }); expect(w.s.runs[RUN].error.length).toBeGreaterThan(10);
    }
  });
  const kasus = [
    ['kunci ditolak', [jsonRes(401, { error: { message: 'No auth' } })], /Kunci OpenRouter ditolak/, 1], ['saldo habis', [jsonRes(402, {})], /Saldo OpenRouter tidak cukup/, 1],
    ['model tidak ditemukan', [jsonRes(404, { error: { message: 'no such model' } })], /Model atau alamat tidak ditemukan.*analisis_model/, 1], ['batas laju', [jsonRes(429, {})], /Terlalu banyak permintaan/, 1],
    ['5xx dua kali', [jsonRes(503, {})], /bermasalah sementara \(kode 503\)/, 2], ['jaringan putus dua kali', [Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })], /Tidak tersambung ke OpenRouter: ECONNRESET/, 2]
  ];
  for (const [nama, orPesan, pola, n] of kasus) {
    it(nama, async () => {
      const w = dunia({ ...kurs, orPesan }); const r = await jalan(w); expect(r.status).toBe(502); expect(r.json.pesan).toMatch(pola); expect(w.s.orPanggilan.length).toBe(n);
      expect(w.s.runs[RUN]).toMatchObject({ status: 'gagal' }); expect(w.s.runs[RUN].cost_usd).toBeUndefined();
    });
  }
  it('gagal sekali lalu berhasil pada percobaan ulang; tidak diulang bila sisa waktu sedikit; waktu habis dicatat', async () => {
    let w = dunia({ ...kurs, orPesan: [jsonRes(502, {}), jawabAi()] }); expect((await jalan(w)).json.ok).toBe(true); expect(w.s.orPanggilan.length).toBe(2);
    w = dunia({ orPesan: [jsonRes(503, {})], orMs: BATAS.anggaranMs - 30000 }); expect((await jalan(w)).json.ok).toBe(false); expect(w.s.orPanggilan.length).toBe(1);
    Object.assign(BATAS, { anggaranMs: 60, sisaMinMs: 10, cobaUlangMinSisaMs: 1e9 });
    const tunggu = opt => new Promise((_, rej) => opt.signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' }))));
    w = dunia({ ...kurs, orPesan: [tunggu], orMs: 0 }); const r = await jalan(w); expect(r.json.pesan).toMatch(/Waktu habis/); expect(w.s.runs[RUN].status).toBe('gagal');
  });
  it('jawaban AI kosong atau bukan JSON: gagal dengan penjelasan, DAN biaya yang sudah ditagih tetap dicatat', async () => {
    for (const [orPesan, kode] of [[[jawabAi(null, 0.004, 'maaf saya tidak bisa membaca gambar ini')], 'respons_aneh'], [[jawabAi(null, 0.004, '')], 'respons_kosong'], [[jsonRes(200, { choices: [], usage: { cost: 0.004 } })], 'respons_kosong']]) {
      const w = dunia({ ...kurs, orPesan }); const r = await jalan(w); expect(r.status).toBe(502); expect(r.json.kode).toBe(kode); expect(r.json.run_id).toBe(RUN);
      expect(w.s.runs[RUN]).toMatchObject({ status: 'gagal', cost_usd: 0.004, kurs_idr: 16500, cost_idr: 66 });
    }
  });
  it('biaya tidak dilaporkan: dicatat kosong tanpa mengarang angka; tanpa kurs: USD tercatat dan Rupiah kosong', async () => {
    let w = dunia({ ...kurs, orPesan: [jawabAi(AI, null)] }); let r = await jalan(w, minta(), 'tok_admin'); expect(r.json).toMatchObject({ ok: true, cost_usd: null, cost_idr: null }); expect(w.s.runs[RUN]).toMatchObject({ status: 'ok', cost_usd: null, cost_idr: null });
    w = dunia({ kurs: { frank: new Error('x'), er: new Error('x') } }); r = await jalan(w, minta(), 'tok_admin'); expect(r.json).toMatchObject({ ok: true, cost_usd: 0.004, cost_idr: null, kurs: null });
  });
  it('kunci OpenRouter tidak muncul di jawaban atau catatan, termasuk saat server menggemakannya', async () => {
    const w = dunia({ ...kurs, orPesan: [jsonRes(401, { error: { message: `bad key ${KUNCI}` } })] }); const r = await jalan(w); const semua = JSON.stringify([r, w.s.updates, w.s.reserve]);
    expect(semua).not.toContain('RAHASIA-UJI'); expect(semua).not.toMatch(/sk-or-v1-/); expect(r.json.pesan).toMatch(/\[kunci disembunyikan\]/);
  });
});
