#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeLogger } = require('./log');
const { Supa } = require('./supabaseRest');
const { SupabaseSource } = require('./sources/supabaseSource');
const { LocalSource } = require('./sources/localSource');
const { FlowDriver, connectFlow } = require('./flowDriver');
const { processJob } = require('./jobRunner');
const { processCharTask } = require('./charTaskRunner');
const { runRecon } = require('./recon');
const { NeedsHuman } = require('./errors');
const inventory = require('./inventory');
const roomLib = require('./room');

const ROOT = path.join(__dirname, '..');
const VERSION = require('../package.json').version;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
function loadCfg() {
  const f = process.env.FLOW_CONFIG || path.join(ROOT, 'config', 'flow.labels.json');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function parseArgs(argv) {
  const pos = [], opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); if (['save-baseline', 'idle-exit'].includes(k)) opts[k] = true; else { opts[k] = argv[i + 1]; i++; } }
    else pos.push(a);
  }
  return { pos, opts };
}

// Nilai SOURCE dibersihkan dari spasi: di cmd, `set SOURCE=local & perintah` menyimpan spasi di ujung nilai.
function sourceMode() { return String(process.env.SOURCE || 'supabase').trim().toLowerCase(); }

function localRoot() { return process.env.LOCAL_DIR || path.join(ROOT, 'local'); }

function makeSource(log) {
  if (sourceMode() === 'local') {
    const root = process.env.LOCAL_DIR || path.join(ROOT, 'local');
    log.info(`Mode OFFLINE (folder: ${root})`);
    return new LocalSource(root, { backoffMinutes: Number(process.env.LOCAL_BACKOFF_MIN ?? 2) });
  }
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'AGENT_EMAIL', 'AGENT_PASSWORD']) {
    if (!process.env[k]) throw new Error(`${k} belum diisi di agent/.env`);
  }
  const supa = new Supa({ url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY, email: process.env.AGENT_EMAIL, password: process.env.AGENT_PASSWORD });
  return new SupabaseSource(supa, { agentName: process.env.AGENT_NAME || os.hostname(), version: VERSION });
}

async function waitHuman(flow, source, onResume, log) {
  const pollMs = Number(process.env.HUMAN_POLL_MS || 5000), maxMs = Number(process.env.HUMAN_WAIT_MS || 60 * 60000);
  log.warn(`Agent menunggu manusia menyelesaikan masalah di Chrome (maksimal ${Math.round(maxMs / 60000)} menit)...`);
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(pollMs);
    try { await flow.assertLayout(); }
    catch (e) { if (e instanceof NeedsHuman) { continue; } throw e; }
    log.info('Masalah tampak teratasi. Melanjutkan antrean.');
    await source.setPause(false).catch(() => {});
    await onResume().catch(() => {});
    return true;
  }
  log.error('Batas tunggu habis. Antrean tetap dijeda.');
  return false;
}

async function runLoop(opts = {}) {
  const { acquireAgentLock, lockFile } = require('./lock');
  const lk = acquireAgentLock(lockFile(ROOT, process.env.CDP_URL || 'http://127.0.0.1:9222'));
  if (!lk.ok) {
    throw new Error(`Agent lain sedang berjalan pada Chrome yang sama (PID ${lk.owner && lk.owner.pid}, sejak ${lk.owner && lk.owner.started}). `
      + 'Tutup jendela agent itu atau tunggu sampai selesai. Dua agent pada satu Chrome saling menimpa dan membuat video ganda (kredit terbuang).');
  }
  try { return await runLoopInner(opts); } finally { lk.release(); }
}

async function runLoopInner(opts = {}) {
  const cfg = loadCfg();
  const log = opts.log || makeLogger(path.join(ROOT, 'logs'));
  const source = opts.source || makeSource(log);
  const agentName = process.env.AGENT_NAME || os.hostname();
  const workDir = process.env.WORK_DIR || path.join(ROOT, 'work');
  const downloadDir = process.env.DOWNLOAD_DIR || path.join(os.homedir(), 'Downloads');
  const maxJobs = opts.maxJobs ?? Infinity;
  const idleMs = Number(process.env.IDLE_MS ?? 5000);
  let stop = false;
  process.once('SIGINT', () => { log.warn('Ctrl+C: berhenti setelah job berjalan selesai (tekan lagi untuk paksa).'); stop = true; process.once('SIGINT', () => process.exit(1)); });

  let conn;
  for (;;) {
    try { conn = await connectFlow(cfg, log); break; }
    catch (e) { log.error(e.message); if (opts.maxJobs !== undefined || opts.noRetryConnect) throw e; await sleep(10000); }
  }
  const flow = new FlowDriver({ page: conn.page, ctx: conn.ctx, cfg, log, downloadDir, debugDir: path.join(ROOT, 'debug') });
  log.info(`Agent ${agentName} v${VERSION} siap. Menunggu job...`);
  await source.requeueStale().catch(e => log.warn('requeueStale: ' + e.message));

  let done = 0, resumes = 0;
  const maxResumes = opts.repeatOnResume ? (opts.maxResumes ?? 2) : 0;
  while (!stop && done < maxJobs) {
    let hb = null;
    try { hb = await source.heartbeat({ status: 'online' }); } catch (e) { log.warn('Heartbeat gagal: ' + e.message); await sleep(idleMs); continue; }
    if (hb && hb.paused) { await sleep(idleMs); continue; }
    // Tugas karakter didahulukan karena menentukan siapa yang boleh dipakai batch.
    let task = null;
    if (typeof source.claimCharTask === 'function') {
      try { task = await source.claimCharTask(); } catch (e) { log.warn('Klaim tugas karakter gagal: ' + e.message); }
    }
    if (task) {
      const timer = setInterval(() => source.heartbeat({ status: 'busy', task_id: task.task_id }).catch(() => {}), 20000);
      let res;
      try { res = await processCharTask({ task, source, flow, cfg, log, workDir }); } finally { clearInterval(timer); }
      done++;
      if (res === 'needs_human') await waitHuman(flow, source, () => source.charTaskProgress(task.task_id, 'queued', {}, { step: 'resume', message: 'Dilanjutkan setelah manusia selesai' }), log);
      continue;
    }
    let job = null;
    try { job = await source.claim(); } catch (e) { log.warn('Klaim gagal: ' + e.message); await sleep(idleMs); continue; }
    if (!job) { if (opts.idleExit) break; await sleep(idleMs); continue; }

    const timer = setInterval(() => source.heartbeat({ status: 'busy', job_id: job.job_id }).catch(() => {}), 20000);
    let res; const meta = {};
    try { res = await processJob({ job, source, flow, cfg, log, workDir, meta }); }
    finally { clearInterval(timer); }
    done++;
    if (res === 'needs_human') {
      const resumed = await waitHuman(flow, source, () => source.progress(job.job_id, 'queued', {}, { kind: 'info', step: 'resume', message: 'Dilanjutkan setelah manusia selesai' }), log);
      // Mode uji (once): ulangi job yang sama, tetapi hanya bila generate BELUM ditekan, supaya tidak ada video ganda dan kredit terbuang.
      if (resumed && opts.repeatOnResume) {
        if (meta.generated && !meta.videoReady) log.warn('Job berhenti setelah generate ditekan tetapi sebelum video tercatat, jadi tidak diulang otomatis. Periksa dulu project Flow (mungkin videonya sudah jadi).');
        else if (resumes < maxResumes) { resumes++; done--; log.info(`Mengulang job yang sama (belum menekan generate), ulangan ${resumes}/${maxResumes}.`); }
      }
    }
  }
  try { await conn.browser.close(); } catch { /* abaikan */ }
  log.info(`Agent berhenti. Job diproses: ${done}`);
  return done;
}

async function supabaseCheck(ok) {
  if (sourceMode() === 'local') { ok('Supabase dilewati (mode offline: SOURCE=local)', true); return; }
  const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'AGENT_EMAIL', 'AGENT_PASSWORD'].filter(k => !process.env[k]);
  if (missing.length) { ok('Berkas .env lengkap', false, `belum diisi: ${missing.join(', ')} (salin .env.example menjadi .env di folder agent)`); return; }
  ok('Berkas .env lengkap', true);
  const supa = new Supa({ url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY, email: process.env.AGENT_EMAIL, password: process.env.AGENT_PASSWORD });
  try { await supa.signIn(); ok('Login Supabase sebagai akun agent', true); }
  catch (e) { ok('Login Supabase sebagai akun agent', false, `${e.message} (periksa AGENT_EMAIL, AGENT_PASSWORD, dan SUPABASE_URL)`); return; }
  try {
    const r = await supa.rpc('ugc_agent_heartbeat', { p_agent: process.env.AGENT_NAME || os.hostname(), p_info: { version: VERSION, status: 'online', check: 'doctor' } });
    ok('Detak agent diterima database', true, `jeda antrean: ${r && r.paused ? 'ya' : 'tidak'}`);
  } catch (e) { ok('Detak agent diterima database', false, `${e.message} (akun login harus berole agent)`); return; }
  try { await supa.rpc('ugc_requeue_own', { p_agent: '__doctor__' }); ok('Migrasi 20261005000500 terpasang di database', true); }
  catch (e) { ok('Migrasi 20261005000500 terpasang di database', false, /Could not find|PGRST202|404/i.test(e.message) ? 'fungsi ugc_requeue_own tidak ada. Jalankan berkas JALANKAN-0500.sql di Supabase (SQL Editor)' : e.message); }
}

// Pemeriksaan sebelum produksi. Hanya membaca, tidak menekan generate atau unduh dan tidak mengambil tugas.
async function doctor() {
  const cfg = loadCfg(); const log = makeLogger(path.join(ROOT, 'logs'));
  const rows = [];
  const ok = (name, pass, note = '') => { rows.push({ name, pass, note }); log.info(`${pass ? '✔' : '✖'} ${name}${note ? ' — ' + note : ''}`); };
  await supabaseCheck(ok);
  let conn;
  try { conn = await connectFlow(cfg, log); ok('Terhubung ke Chrome', true); } catch (e) { ok('Terhubung ke Chrome', false, e.message); return rows; }
  const flow = new FlowDriver({ page: conn.page, ctx: conn.ctx, cfg, log });
  const lg = flow.lg;
  try {
    ok('Tab Flow yang diperiksa', true, conn.page.url().replace(/\/project\/[0-9a-f-]+/i, '/project/<id>'));
    await flow.captchaCheck(); ok('Tanpa captcha/login habis', true);
    await flow.assertLayout(); ok('Tata letak dikenali (kapsul pengaturan terlihat)', true);
    const acct = await flow.accountName(); ok('Akun Google yang dipakai Flow', !!acct, acct || 'tidak terbaca (periksa manual di pojok kanan atas)');
    for (const r of roomLib.listRooms(localRoot())) {
      if (!r.flow_account_name) log.info(`ℹ Ruang ${r.code} belum mencatat nama akun Google${acct ? ` (akun saat ini: ${acct})` : ''}. Isi lewat mulai.bat menu 2.`);
      else if (acct) ok(`Ruang ${r.code}: akun Google cocok`, roomLib.norm(acct) === roomLib.norm(r.flow_account_name), roomLib.norm(acct) === roomLib.norm(r.flow_account_name) ? '' : `Flow memakai "${acct}", ruang mencatat "${r.flow_account_name}". Ganti akun atau perbarui ruang lewat mulai.bat menu 2.`);
    }
    ok('Bahasa antarmuka Flow terdeteksi', !!flow.lang, flow.lang ? cfg.languages[flow.lang].nama : 'tidak diketahui');
    const unv = lg.unverified().filter(x => x.startsWith(flow.lang + ':'));
    if (unv.length) log.info(`ℹ Label belum terverifikasi untuk bahasa ini: ${unv.map(x => x.split(':')[1]).join(', ')}`);
    await flow.closeOverlays();
    const popupMs = await flow.openSettingsPopup(); ok('Pop-up pengaturan terbuka', true, `${popupMs} ms`);
    const need = [[lg.show('mode', 'radios'), lg.partialRe('radios', 'mode')], [lg.show('submode', 'radios'), lg.partialRe('radios', 'submode')],
      ['9:16', /9:16/], ['360p', /360p/], ['720p', /720p/], ['10 detik', lg.durRe(10)], ['x1', /^\s*x1\s*$/]];
    for (const [label, re] of need) ok(`Pilihan "${label}" ada di pop-up`, (await flow.radio(re).count()) > 0);
    const model = (await conn.page.getByRole('button', { name: lg.nameRe('modelPicker') }).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
    ok(`Model ${cfg.expectModel}`, new RegExp(cfg.expectModel, 'i').test(model), `terbaca: "${model}"`);
    const credits = await flow.readCredits(); ok('Angka kredit terbaca', credits !== null, credits !== null ? `${credits} kredit (setelan saat ini)` : '');
    await flow.closePopup();
    await flow.click(conn.page.getByRole('button', { name: lg.nameRe('addIngredient') }).first(), lg.show('addIngredient')); await sleep(1500);
    ok('Panel aset terbuka dan tombol Upload media ada', await flow.panelOpen());
    await flow.closePanel();
    ok('Panel aset tertutup kembali', !(await flow.panelOpen()));
  } catch (e) { ok('Pemeriksaan berhenti', false, e.message); }
  try { await conn.browser.close(); } catch { /* abaikan */ }
  const bad = rows.filter(r => !r.pass).length;
  log.info(bad ? `Hasil: ${bad} pemeriksaan GAGAL.` : 'Hasil: semua pemeriksaan LOLOS.');
  return rows;
}

// Analisa Flow: dijalankan manusia lewat tombol/perintah. Membandingkan tampilan dengan baseline.
async function analyze(saveBaseline) {
  const cfg = loadCfg(); const log = makeLogger(path.join(ROOT, 'logs'));
  const conn = await connectFlow(cfg, log);
  const flow = new FlowDriver({ page: conn.page, ctx: conn.ctx, cfg, log });
  await flow.assertLayout(); await flow.closeOverlays();
  const screens = {};
  screens.project = await inventory.collect(conn.page);
  await flow.chip().click(); await sleep(900); screens.pengaturan = await inventory.collect(conn.page); await flow.closePopup();
  await flow.click(conn.page.getByRole('button', { name: flow.lg.nameRe('addIngredient') }).first(), flow.lg.show('addIngredient')); await sleep(1500);
  screens.panel_aset = await inventory.collect(conn.page); await flow.closePanel();
  await conn.browser.close();

  const dirB = path.join(ROOT, 'baseline'); const dirR = path.join(ROOT, 'reports');
  fs.mkdirSync(dirB, { recursive: true }); fs.mkdirSync(dirR, { recursive: true });
  const bf = path.join(dirB, 'inventory.json');
  const lines = [`# Analisa Flow — ${new Date().toISOString()}`, ''];
  if (saveBaseline) { fs.writeFileSync(bf, JSON.stringify(screens, null, 1)); lines.push('Baseline disimpan.'); }
  else if (fs.existsSync(bf)) {
    const base = JSON.parse(fs.readFileSync(bf, 'utf8')); let changed = 0;
    for (const [name, cur] of Object.entries(screens)) {
      const d = inventory.diff(base[name] || [], cur); changed += d.hilang.length + d.baru.length;
      lines.push(`## ${name}`, d.hilang.length || d.baru.length ? '' : 'Tidak ada perubahan.');
      d.hilang.forEach(k => lines.push(`- HILANG: ${k}`)); d.baru.forEach(k => lines.push(`- BARU: ${k}`));
    }
    lines.push('', changed ? `**${changed} perubahan terdeteksi.** Kirim berkas laporan ini ke analis sebelum menjalankan antrean.` : '**Tidak ada perubahan.** Aman untuk produksi.');
  } else lines.push('Belum ada baseline. Jalankan: analyze --save-baseline');
  const rf = path.join(dirR, `analisa-${Date.now()}.md`);
  fs.writeFileSync(rf, lines.join('\n')); fs.writeFileSync(rf.replace(/\.md$/, '.json'), JSON.stringify(screens, null, 1));
  console.log(lines.join('\n')); console.log('\nLaporan: ' + rf);
  return { screens, report: rf };
}

async function reconCmd(opts) {
  const cfg = loadCfg(); const log = makeLogger(path.join(ROOT, 'logs'));
  const conn = await connectFlow(cfg, log);
  const dir = path.join(ROOT, 'recon', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  try { await runRecon({ page: conn.page, dir, only: opts.only ? opts.only.split(',') : undefined }); }
  finally { try { await conn.browser.close(); } catch { /* abaikan */ } }
}

function enqueueLocal(opts) {
  let roomCode = '';
  if (opts.room) {
    const r = roomLib.loadRoom(localRoot(), opts.room);
    if (!r) throw new Error(`Ruang karakter "${opts.room}" tidak ditemukan. Buat dulu lewat mulai.bat menu 1.`);
    if (r.status !== 'project_ready') throw new Error(`Ruang ${r.code} belum siap (tahap: ${r.status}). Lengkapi foto wajah, deskripsi penampilan, suara, dan alamat project lewat mulai.bat menu 1.`);
    if (opts.project && roomLib.projectKey(opts.project).id !== roomLib.projectKey(r.flow_project_url).id) {
      throw new Error('Alamat project yang diberikan berbeda dari project ruang ini. Untuk berganti project atau akun, pakai mulai.bat menu 2 (ganti project atau akun), bukan job baru.');
    }
    opts = { ...opts, project: r.flow_project_url, extra: roomLib.facePath(localRoot(), r), character: r.code };
    roomCode = r.code;
  }
  if (opts.archetype && !/^A-(0[1-9]|1[0-5])$/.test(String(opts.archetype).trim())) throw new Error(`Arketipe "${opts.archetype}" tidak dikenal. Pakai A-01 sampai A-15.`);
  const need = ['project', 'storyboard', 'json'];
  for (const k of need) if (!opts[k]) throw new Error(`Wajib: --${k}`);
  if (!/^https:\/\/flow\.google\.com\/(?:u\/\d+\/)?project\/[^/\s?#]+/.test(opts.project) && process.env.ALLOW_ANY_PROJECT_URL !== '1') {
    throw new Error(`Alamat project bukan alamat Flow: "${String(opts.project).slice(0, 80)}". Harus berawalan https://flow.google.com/project/ . Buka project di Chrome khusus, lalu salin alamat dari tab Flow itu (Ctrl+L, Ctrl+C).`);
  }
  if (opts.extra && !fs.existsSync(opts.extra)) throw new Error(`Foto tambahan tidak ditemukan: "${opts.extra}". Ketik alamat lengkap berkas, mulai dari C:\\ dan tanpa tanda kutip.`);
  for (const [k, label] of [['storyboard', 'Storyboard'], ['json', 'JSON prompt']]) {
    if (!fs.existsSync(opts[k])) throw new Error(`${label} tidak ditemukan: "${opts[k]}". Ketik alamat lengkap berkas, mulai dari C:\\ dan tanpa tanda kutip.`);
  }
  const rawJson = fs.readFileSync(opts.json, 'utf8');
  if (roomCode) { const am = roomLib.appearanceMismatch(roomLib.loadRoom(localRoot(), roomCode), rawJson); if (am) console.log('PERINGATAN: ' + am + ' Disarankan memakai JSON dari paket uji yang sama dengan ruang.'); }
  try { JSON.parse(rawJson); } catch (e) { throw new Error(`Berkas JSON prompt bukan JSON yang valid (${e.message}).`); }
  if (/\{\{[^}]+\}\}/.test(rawJson)) throw new Error('JSON prompt masih memuat penanda {{...}}. Isi dulu lokasi dan nilai lainnya, lalu simpan ulang.');
  const root = localRoot();
  const base = 'job-' + new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  let id = base; for (let n = 2; fs.existsSync(path.join(root, 'inbox', id)); n++) id = `${base}-${n}`;   // dua job dalam detik yang sama tidak boleh saling menimpa
  const dir = path.join(root, 'inbox', id); fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(opts.storyboard, path.join(dir, 'storyboard' + (path.extname(opts.storyboard) || '.png')));
  const extraName = opts.extra ? 'extra1' + (path.extname(opts.extra) || '.png') : null;
  if (extraName) fs.copyFileSync(opts.extra, path.join(dir, extraName));
  fs.copyFileSync(opts.json, path.join(dir, 'prompt.json'));
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({
    project_url: opts.project, resolution: opts.res || '720p', duration_sec: 10, character_code: opts.character || '', product_name: String(opts.name || path.basename(path.dirname(path.resolve(opts.storyboard)))).slice(0, 80), ...(opts.archetype ? { archetype_id: String(opts.archetype).trim() } : {}), ...(opts.category ? { category_key: String(opts.category).trim() } : {}), ...(roomCode ? { room_code: roomCode } : {}),
    storyboard_file: 'storyboard' + (path.extname(opts.storyboard) || '.png'), ...(extraName ? { extra_files: [extraName] } : {}), video_json_file: 'prompt.json'
  }, null, 1));
  console.log('Job lokal dibuat: ' + dir);
  return id;
}

function roomsCmd() {
  const rooms = roomLib.listRooms(localRoot());
  if (!rooms.length) { console.log('Belum ada ruang karakter. Buat lewat mulai.bat menu 1.'); return rooms; }
  for (const r of rooms) { const s = roomLib.summarize(r); console.log(`${s.code} — ${s.name}\n  tahap ${s.status} · foto ${s.foto} · penampilan ${s.penampilan} · suara ${s.suara} · project ${s.project} · akun ${s.akun}`); }
  return rooms;
}
function queueCmd() {
  const src = new LocalSource(localRoot(), {});
  const rows = src.summary();
  if (!rows.length) { console.log('Antrean kosong.'); return rows; }
  const ico = { downloaded: '✔', failed: '✖', queued: '…', running: '…', needs_human: '!', pushed: '↑' };
  for (const r of rows) console.log(`${ico[r.status] || '?'} ${r.id} — ${r.status}${r.error ? ' — ' + String(r.error).slice(0, 110) : ''}`);
  return rows;
}

// Alat staf sementara: kirim ruang dan job lokal ke database, lihat antrean online, unduh video.
async function staffCmd(sub, opts, io = null) {
  const st = require('./staffTool'); const own = !io; io = io || require('./wizard').makeAsker();
  try {
    const supa = await st.login(process.env, io);
    const rooms = roomLib.listRooms(localRoot());
    const codeOf = async () => opts.room || (rooms.length === 1 ? rooms[0].code : await io.ask('Kode ruang karakter' + (rooms.length ? ` (${rooms.map(r => r.code).join(', ')})` : '')));
    if (sub === 'push-char') {
      const code = await codeOf(); let ready = opts.ready;
      if (ready === undefined) ready = await io.ask('Alasan menandai karakter SIAP (minimal 10 huruf, khusus admin; Enter = jangan tandai)');
      return await st.pushChar(supa, localRoot(), { room: code, ready: ready || undefined });
    }
    if (sub === 'push-batch') return await st.pushBatch(supa, localRoot(), { room: await codeOf() });
    if (sub === 'queue') return await st.queue(supa);
    if (sub === 'videos') return await st.videos(supa, localRoot());
    throw new Error('Perintah staff: push-char | push-batch | queue | videos');
  } finally { if (own) io.close(); }
}

async function allCmd() {
  const log = makeLogger(path.join(ROOT, 'logs'));
  const source = makeSource(log);
  const n = await runLoop({ source, log, idleExit: true, noRetryConnect: true, repeatOnResume: true });
  log.info(`Selesai: ${n} job diproses pada putaran ini.`);
  if (typeof source.summary === 'function') {
    const rows = source.summary();
    log.info('Ringkasan antrean offline:');
    const ico = { downloaded: '✔', failed: '✖', queued: '…', running: '…', needs_human: '!' };
    for (const r of rows) log.info(`  ${ico[r.status] || '?'} ${r.id} — ${r.status}${r.error ? ' — ' + String(r.error).slice(0, 110) : ''}${r.status === 'queued' && r.not_before ? ' (dijadwalkan ulang ' + r.not_before.slice(11, 19) + ' UTC)' : ''}`);
    const left = rows.filter(r => r.status === 'queued').length;
    if (left) log.warn(`${left} job masih menunggu (dijadwalkan ulang setelah kegagalan). Jalankan berkas ini lagi nanti.`);
  }
}

async function main() {
  loadEnv(path.join(ROOT, '.env'));
  const [cmd, ...rest] = process.argv.slice(2); const { pos, opts } = parseArgs(rest);
  try {
    if (cmd === 'start') await runLoop({});
    else if (cmd === 'once') await runLoop({ maxJobs: 1, idleExit: true, noRetryConnect: true, repeatOnResume: true });
    else if (cmd === 'all') await allCmd();
    else if (cmd === 'doctor') { const r = await doctor(); process.exit(r.some(x => !x.pass) ? 1 : 0); }
    else if (cmd === 'analyze') await analyze(!!opts['save-baseline']);
    else if (cmd === 'recon') await reconCmd(opts);
    else if (cmd === 'enqueue-local') enqueueLocal(opts);
    else if (cmd === 'room-save') { const r = roomLib.upsertRoom(localRoot(), { code: opts.code, name: opts.name, gender: opts.gender, face: opts.face, appearance: opts.appearance, appearanceFromJson: opts['appearance-json'], voiceFile: opts.voice, project: opts.project, account: opts.account, flowVoiceName: opts['flow-voice'] }); r.notes.forEach(n => console.log(n)); console.log(`Ruang ${r.room.code} tersimpan (tahap: ${r.room.status}).`); }
    else if (cmd === 'rooms') roomsCmd();
    else if (cmd === 'staff') await staffCmd(pos[0], opts);
    else if (cmd === 'queue') queueCmd();
    else if (cmd === 'wizard-room') await require('./wizard').wizardRoom(localRoot());
    else if (cmd === 'wizard-set') await require('./wizard').wizardSet(localRoot());
    else if (cmd === 'wizard-add') await require('./wizard').wizardAdd(localRoot(), o => enqueueLocal(o));
    else console.log('Perintah: start | once | all | doctor | analyze [--save-baseline] | enqueue-local (--room KODE | --project URL) --storyboard FILE --json FILE [--res 720p] [--extra FOTO] [--archetype A-01..A-15] [--category KUNCI] | room-save --code KODE ... | rooms | queue | wizard-room | wizard-set | wizard-add | staff push-char|push-batch|queue|videos');
  } catch (e) { console.error('GAGAL: ' + e.message); process.exit(1); }
}

if (require.main === module) main();
module.exports = { runLoop, doctor, supabaseCheck, analyze, enqueueLocal, loadCfg, parseArgs, makeSource, reconCmd, roomsCmd, queueCmd, staffCmd };
