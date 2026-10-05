'use strict';
const fs = require('fs');
const path = require('path');
const { NeedsHuman, FlowError } = require('./errors');
const { runGeneration, makeJobToken } = require('./generation');
const { checkJobAgainstRoom, appearanceMismatch } = require('./room');

// Menjalankan satu job video sampai terunduh dan terunggah. Mengembalikan status akhir.
async function processJob({ job, source, flow, cfg, log, workDir, meta = {} }) {
  const dir = path.join(workDir, job.job_id);
  fs.mkdirSync(dir, { recursive: true });
  const ev = (step, message, extra = {}) => { if (step === 'generate' || step === 'generate_start') meta.generated = true; return source.log(job.job_id, { kind: 'info', step, message, ...extra }).catch(() => {}); };
  try {
    log.info(`▶ Job ${job.job_id} (percobaan ${job.attempt}/${job.max_attempts})`);
    if (job.schema_outdated) {
      const m = 'Database belum menjalankan migrasi 20261005000500: penanda generate dan data ruang karakter tidak tersedia. Bila agent berhenti di tengah job, video bisa dibuat ulang (kredit terbuang). Jalankan berkas SQL 0500 di Supabase.';
      log.warn(m); await source.log(job.job_id, { kind: 'warn', step: 'schema_outdated', message: m }).catch(() => {});
    }
    // Job yang berasal dari ruang karakter: pastikan project dan akun Google cocok SEBELUM menyentuh Flow.
    if (job.room_code) {
      const acct = job.room && job.room.flow_account_name ? await flow.accountName().catch(() => '') : '';
      const chk = checkJobAgainstRoom(job, acct);
      for (const w of chk.warnings) { log.warn(w); await source.log(job.job_id, { kind: 'warn', step: 'room_check', message: w }).catch(() => {}); }
      if (job.room && !job.room.missing) { const am = appearanceMismatch(job.room, job.video_json); if (am) { log.warn(am); await source.log(job.job_id, { kind: 'warn', step: 'room_check', message: am }).catch(() => {}); } }
      if (chk.problems.length) throw new FlowError(chk.problems.join(' '), 'fatal');
      await ev('room_check', `Ruang ${job.room_code} cocok (project${job.room && job.room.flow_account_name ? ' dan akun' : ''})`);
    }
    await ev('prepare', 'Mengunduh storyboard');
    const sb = await source.fetchStoryboard(job, dir);
    const extras = typeof source.fetchExtras === 'function' ? await source.fetchExtras(job, dir) : [];
    const out = path.join(dir, 'video.mp4');
    const g = await runGeneration({
      flow, log, ev, projectUrl: job.project_url,
      settings: { res: job.resolution, dur: job.duration_sec, n: 1, ratio: '9:16' },
      attachFile: sb, extraFiles: extras, uniqueBase: job.job_id, promptText: job.video_json, expectedChips: 1, outPath: out,
      policyRetries: Number(process.env.POLICY_RETRIES ?? 2),
      token: makeJobToken(job.job_id),
      resumeAssetUrl: job.flow_asset_url || null,
      locateFirst: !!job.generated && !job.flow_asset_url,
      onVideoReady: async (url, tried) => {
        meta.videoReady = true;
        await source.progress(job.job_id, 'running', { flow_asset_url: url },
          { kind: 'info', step: 'video_ready', message: 'Video sudah jadi di Flow; alamatnya dicatat supaya unduhan bisa diulang tanpa generate ulang', data: { url, tile_diperiksa: tried } }).catch(() => {});
      },
      onFailure: (kind, msg) => source.log(job.job_id, { kind: 'warn', step: kind === 'timeout' ? 'generate_timeout' : 'generate_failed', message: `Gagal (${kind}): ${msg}`, result: kind }).catch(() => {})
    });
    const videoPath = await source.uploadVideo(job, out);
    await source.progress(job.job_id, 'downloaded', { video_path: videoPath, flow_asset_url: g.assetUrl, credits_observed: g.credits }, { kind: 'info', step: 'done', message: 'Selesai', result: 'ok' });
    log.info(`✔ Job ${job.job_id} selesai → ${videoPath}`);
    return 'downloaded';
  } catch (e) {
    const snap = await flow.debugSnap(`job-${String(job.job_id).slice(0, 8)}-error`);
    if (e instanceof NeedsHuman) {
      log.error(`⏸ Butuh manusia (${e.reason}): ${e.message}`);
      await source.progress(job.job_id, 'needs_human', { last_error: e.message, error_kind: e.reason }, { kind: 'error', step: 'human', message: e.message, result: e.reason, data: { snap } });
      return 'needs_human';
    }
    const kind = e instanceof FlowError ? e.kind : 'unknown';
    log.error(`✖ Job ${job.job_id} gagal (${kind}): ${e.message}`);
    return source.progress(job.job_id, 'failed', { last_error: String(e.message).slice(0, 400), error_kind: kind }, { kind: 'error', step: 'failed', message: String(e.message).slice(0, 300), result: kind, data: { snap } });
  }
}
module.exports = { processJob };
