'use strict';
// Alat staf SEMENTARA (sebelum website 6b/6d jadi): mengirim ruang karakter dan job lokal ke Supabase supaya agent online
// bisa bekerja tanpa data di laptop. Memakai login staf/admin (bukan akun agent); aturan RLS database tetap berlaku.
//   push-char   ruang lokal  -> ugc_characters + foto wajah (bucket ugc-characters)  [+ --ready "alasan" oleh admin]
//   push-batch  job lokal    -> ugc_products + ugc_batches + ugc_jobs + storyboard (bucket ugc-storyboards) -> antrean
//   queue       daftar job milik akun yang login
//   videos      unduh video hasil ke local\outbox\online
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const room = require('./room');

const B_CHAR = 'ugc-characters', B_SB = 'ugc-storyboards', B_VID = 'ugc-videos';
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const UUID_RE = /^[0-9a-f-]{36}$/i;
const q = v => encodeURIComponent(v);

// ───────────── Pembentuk baris (murni; dipakai juga oleh tes database) ─────────────
function characterRow(r, userId) {
  return {
    code: r.code, name: r.name, gender: r.gender || null, creation_mode: 'reference',
    dna: { appearance_en: r.dna && r.dna.appearance_en || '' },
    identity_lock: r.dna && r.dna.appearance_en ? 'locked' : 'reference',
    flow_project_url: r.flow_project_url, flow_account_name: r.flow_account_name || null,
    voice: r.voice || {}, voice_base: r.voice && r.voice.base_voice || null, flow_voice_name: r.flow_voice_name || null,
    status: 'voice_defined',                       // staf tidak boleh membuat karakter langsung "ready"; itu lewat admin
    created_by: userId
  };
}
function characterPatch(r) { const { code, created_by, status, creation_mode, ...rest } = characterRow(r, null); return rest; }
const facePath = (characterId, ext) => `${characterId}/face_front${ext}`;
const photoRow = (characterId, p, userId) => ({ character_id: characterId, angle: 'face_front', path: p, approved: true, created_by: userId });
// Arketipe bawaan A-01 (busana). Bila kategori diberikan, arketipe dibiarkan kosong supaya trigger database mengisinya dari peta kategori.
const productRow = (name, userId, { archetype = null, category = null } = {}) => ({
  name, status: 'confirmed', photos: [], profile: {}, created_by: userId, confirmed_by: userId, confirmed_at: new Date().toISOString(),
  ...(category ? { category_key: category, category_source: 'manual', ...(archetype ? { archetype_id: archetype } : {}) } : { archetype_id: archetype || 'A-01' })
});
const batchRow = (characterId, resolution, userId) => ({ character_id: characterId, resolution, duration_sec: 10, location_mode: 'auto', status: 'approved', note: 'Dikirim lewat alat staf (sebelum website)', created_by: userId });
const jobRow = ({ id, batchId, productId, seq, storyboardPath, videoJson, userId }) => ({ id, batch_id: batchId, product_id: productId, seq, status: 'approved', storyboard_variant: 'clean', storyboard_path: storyboardPath, video_json: videoJson, created_by: userId });

// ───────────── Pembantu ─────────────
function friendly(e) {
  const m = String(e && e.message || e);
  if (/voice_base_uq|ugc_characters_voice_base/.test(m)) return new Error('Suara dasar ini sudah dipakai karakter lain. Satu karakter satu suara; pilih suara lain, atau minta admin menyetujui berbagi (voice_shared_ok).');
  if (/khusus admin/.test(m) || (e && e.code === '42501' && /ready/.test(m))) return new Error('Hanya akun admin yang boleh menandai karakter siap. Login sebagai admin, atau minta admin menjalankan langkah ini.');
  if (/batch_limit_per_day/.test(m)) return new Error('Batas batch per hari tercapai. Alat ini memasukkan SEMUA job ke satu batch; tunggu besok atau minta admin menaikkan batas di ugc_settings.');
  if (/job_limit_per_batch/.test(m)) return new Error('Satu batch maksimal 10 video. Kurangi job yang dikirim sekaligus.');
  if (/karakter belum berstatus siap/.test(m)) return new Error('Karakter belum berstatus siap. Jalankan "kirim karakter" dengan alasan siap (khusus admin) lebih dulu.');
  if (/ugc_products_category_fk/.test(m)) return new Error('Kategori produk tidak dikenal. Salin kunci kategori persis dari kolom Kunci_Lookup di CSV pemetaan (huruf, spasi, dan tanda > harus sama).');
  if (/ugc_products_archetype_fk|ugc_products_confirmed_complete/.test(m)) return new Error('Arketipe produk tidak dikenal. Pakai A-01 sampai A-15, atau kunci kategori dari CSV pemetaan.');
  if (/produk tanpa arketipe/.test(m)) return new Error('Ada produk tanpa arketipe atau risiko. Isi arketipe produk (A-01 sampai A-15) lebih dulu.');
  return e instanceof Error ? e : new Error(m);
}

async function login(env = process.env, io = null) {
  const { Supa } = require('./supabaseRest');
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) if (!env[k]) throw new Error(`${k} belum diisi di agent/.env`);
  let email = env.STAFF_EMAIL, password = env.STAFF_PASSWORD;
  if (!email || !password) {
    if (!io) throw new Error('STAFF_EMAIL dan STAFF_PASSWORD belum diisi dan tidak ada jendela tanya-jawab.');
    if (!email) email = await io.ask('Email akun staf atau admin');
    if (!password) password = await io.ask('Kata sandi (tampil saat diketik; tidak disimpan)');
  }
  const supa = new Supa({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, email, password });
  await supa.signIn();
  if (!supa.userId) throw new Error('Login berhasil tetapi id pengguna tidak terbaca dari Supabase.');
  return supa;
}

// ───────────── Kirim karakter ─────────────
async function pushChar(supa, localRoot, { room: code, ready } = {}, log = console.log) {
  const r = room.loadRoom(localRoot, code);
  if (!r) throw new Error(`Ruang karakter "${code}" tidak ditemukan. Buat dulu lewat mulai.bat menu 1.`);
  if (r.status !== 'project_ready') throw new Error(`Ruang ${r.code} belum lengkap (tahap: ${r.status}). Lengkapi foto wajah, penampilan, suara, dan alamat project lebih dulu.`);
  const face = room.facePath(localRoot, r);
  if (!face || !fs.existsSync(face)) throw new Error(`Foto wajah ruang ${r.code} hilang dari folder ruang.`);
  if (ready !== undefined && ready !== null && String(ready).trim() && String(ready).trim().length < 10) throw new Error('Alasan menandai siap minimal 10 karakter.');
  const userId = supa.userId;
  try {
    const found = await supa.select('ugc_characters', `select=id,status&code=eq.${q(r.code)}`);
    let id;
    if (found.length) { id = found[0].id; await supa.update('ugc_characters', `id=eq.${id}`, characterPatch(r)); log(`Karakter ${r.code} diperbarui di database.`); }
    else { id = (await supa.insert('ugc_characters', characterRow(r, userId))).id; log(`Karakter ${r.code} dibuat di database.`); }

    const ext = path.extname(face).toLowerCase(); const p = facePath(id, ext);
    await supa.upload(B_CHAR, p, face, MIME[ext] || 'application/octet-stream');
    const ph = await supa.select('ugc_character_photos', `select=id&character_id=eq.${id}&angle=eq.face_front`);
    if (ph.length) await supa.update('ugc_character_photos', `id=eq.${ph[0].id}`, { path: p, approved: true });
    else await supa.insert('ugc_character_photos', photoRow(id, p, userId));
    await supa.update('ugc_characters', `id=eq.${id}`, { face_ref_path: p });
    log('Foto wajah terunggah (bucket privat).');

    let becameReady = false;
    if (ready && String(ready).trim()) { await supa.rpc('ugc_admin_mark_ready', { p_character: id, p_reason: String(ready).trim() }); becameReady = true; log('Karakter ditandai SIAP (alasan tercatat di database).'); }
    const now = (await supa.select('ugc_characters', `select=id,code,status,flow_project_url,flow_account_name&id=eq.${id}`))[0];
    return { id, code: now.code, status: now.status, ready: becameReady };
  } catch (e) { throw friendly(e); }
}

// ───────────── Kirim batch ─────────────
function localPending(localRoot, code) {
  const inbox = path.join(localRoot, 'inbox');
  if (!fs.existsSync(inbox)) return [];
  const out = [];
  for (const id of fs.readdirSync(inbox).sort()) {
    const dir = path.join(inbox, id), jf = path.join(dir, 'job.json');
    if (!fs.existsSync(jf)) continue;
    const spec = JSON.parse(fs.readFileSync(jf, 'utf8'));
    if (spec.room_code !== code) continue;
    const sf = path.join(dir, 'status.json'); const st = fs.existsSync(sf) ? JSON.parse(fs.readFileSync(sf, 'utf8')) : { status: 'queued', attempts: 0 };
    if (st.status !== 'queued' || (st.attempts || 0) > 0) continue;
    out.push({ id, dir, spec, statusFile: sf });
  }
  return out;
}

async function pushBatch(supa, localRoot, { room: code } = {}, log = console.log) {
  const r = room.loadRoom(localRoot, code);
  if (!r) throw new Error(`Ruang karakter "${code}" tidak ditemukan.`);
  const pending = localPending(localRoot, code);
  if (!pending.length) throw new Error(`Tidak ada job lokal baru untuk ruang ${code}. Buat dulu lewat mulai.bat menu 3.`);
  if (pending.length > 10) throw new Error(`Ada ${pending.length} job lokal; satu batch maksimal 10. Kirim sebagian dulu (pindahkan sisanya sementara dari local\\inbox).`);
  const resos = [...new Set(pending.map(p => p.spec.resolution || '720p'))];
  if (resos.length > 1) throw new Error(`Job lokal punya resolusi berbeda (${resos.join(', ')}). Satu batch satu resolusi.`);

  const ch = await supa.select('ugc_characters', `select=id,status,flow_project_url,flow_account_name&code=eq.${q(code)}`);
  if (!ch.length) throw new Error(`Karakter ${code} belum ada di database. Jalankan "kirim karakter" lebih dulu.`);
  if (ch[0].status !== 'ready') throw new Error(`Karakter ${code} belum berstatus siap (sekarang: ${ch[0].status}). Jalankan "kirim karakter" dengan alasan siap (khusus admin).`);
  if (room.projectKey(ch[0].flow_project_url).id !== room.projectKey(r.flow_project_url).id || (ch[0].flow_account_name || '') !== (r.flow_account_name || '')) {
    throw new Error('Project atau akun di database berbeda dari ruang lokal. Jalankan "kirim karakter" lagi supaya database mengikuti ruang.');
  }
  // Kategori dari job lokal diperiksa ke peta kategori SEBELUM apa pun dibuat. Tanpa ini, kategori salah ketik membuat produk
  // 'confirmed' tanpa arketipe dan database menolaknya dengan pesan yang menyesatkan.
  for (const key of [...new Set(pending.map(p => p.spec.category_key).filter(Boolean))]) {
    const hit = await supa.select('ugc_category_map', `select=category_key&category_key=eq.${q(key)}`);
    if (!hit.length) throw new Error(`Kategori produk tidak dikenal: "${key}". Salin kunci kategori persis dari kolom Kunci_Lookup di CSV pemetaan (huruf, spasi, dan tanda > harus sama). Tidak ada yang dikirim.`);
  }
  const userId = supa.userId; let batchId = null; const made = [];
  const markPushed = () => { for (const m of made) fs.writeFileSync(m.local.statusFile, JSON.stringify({ status: 'pushed', pushed_batch: batchId, pushed_job_id: m.jobId, pushed_at: new Date().toISOString() }, null, 1)); };
  try {
    batchId = (await supa.insert('ugc_batches', batchRow(ch[0].id, resos[0], userId))).id;
    for (const [i, p] of pending.entries()) {
      const jobId = crypto.randomUUID();
      const name = p.spec.product_name || p.id;
      const prod = await supa.insert('ugc_products', productRow(name, userId, { archetype: p.spec.archetype_id, category: p.spec.category_key }));
      const sbFile = path.join(p.dir, p.spec.storyboard_file || 'storyboard.png'); const ext = path.extname(sbFile).toLowerCase() || '.png';
      const sbPath = `${batchId}/${jobId}${ext}`;
      await supa.upload(B_SB, sbPath, sbFile, MIME[ext] || 'application/octet-stream');
      const json = fs.readFileSync(path.join(p.dir, p.spec.video_json_file || 'prompt.json'), 'utf8');
      await supa.insert('ugc_jobs', jobRow({ id: jobId, batchId, productId: prod.id, seq: i + 1, storyboardPath: sbPath, videoJson: json, userId }));
      made.push({ local: p, jobId });
    }
    const n = await supa.rpc('ugc_enqueue_batch', { p_batch: batchId });
    markPushed();
    log(`Batch ${batchId.slice(0, 8)}… masuk antrean: ${n} job.`);
    return { batchId, jobs: made.map(m => ({ local: m.local.id, job_id: m.jobId })), queued: n };
  } catch (e) {
    // Produk berisiko tinggi: batch dan job SUDAH tersimpan dan sah. Yang kurang hanya persetujuan admin, jadi tidak dibatalkan.
    if (batchId && /berisiko tinggi menunggu persetujuan admin/.test(String(e && e.message))) {
      markPushed();
      const ids = made.map(m => m.jobId);
      const err = new Error(`Ada produk berisiko tinggi (arketipe atau kategori sensitif): admin harus menyetujui tiap job SEBELUM masuk antrean. Batch ${batchId} sudah tersimpan. Admin menjalankan di Supabase SQL Editor:\n`
        + ids.map(id => `  select ugc_approve_risk('${id}', 'alasan persetujuan');`).join('\n') + `\n  select ugc_enqueue_batch('${batchId}');`);
      err.batchId = batchId; err.jobIds = ids; err.needsApproval = true; throw err;
    }
    if (batchId) await supa.update('ugc_batches', `id=eq.${batchId}`, { status: 'canceled' }).catch(() => {});   // batch setengah jadi dibatalkan (tidak menghabiskan batas harian)
    throw friendly(e);
  }
}

// ───────────── Antrean dan video ─────────────
async function queue(supa, log = console.log) {
  const rows = await supa.select('ugc_jobs', 'select=id,seq,status,attempts,last_error,video_path,batch_id&order=created_at.desc&limit=30');
  if (!rows.length) { log('Belum ada job di database untuk akun ini.'); return rows; }
  const ico = { downloaded: '✔', done: '✔', failed: '✖', queued: '…', running: '▶', needs_human: '!', approved: '·', canceled: '–' };
  for (const j of rows) log(`${ico[j.status] || '?'} ${String(j.id).slice(0, 8)}… batch ${String(j.batch_id).slice(0, 8)}… #${j.seq} — ${j.status}${j.attempts ? ` (percobaan ${j.attempts})` : ''}${j.last_error ? ' — ' + String(j.last_error).slice(0, 100) : ''}`);
  return rows;
}
async function videos(supa, localRoot, log = console.log) {
  const rows = await supa.select('ugc_jobs', 'select=id,seq,video_path,status&video_path=not.is.null&order=created_at.desc&limit=50');
  const dir = path.join(localRoot, 'outbox', 'online'); const got = [];
  for (const j of rows) {
    if (!UUID_RE.test(j.id)) continue;
    const dest = path.join(dir, `${j.id}.mp4`);
    if (fs.existsSync(dest)) continue;
    const [bucket, ...rest] = [B_VID, j.video_path];
    await supa.download(bucket, rest.join('/'), dest); got.push(dest);
  }
  log(got.length ? `${got.length} video diunduh ke ${dir}` : 'Tidak ada video baru.');
  return got;
}

module.exports = { characterRow, characterPatch, facePath, photoRow, productRow, batchRow, jobRow, friendly, login, pushChar, pushBatch, queue, videos, localPending };
