'use strict';
const fs = require('fs');
const path = require('path');
const { NeedsHuman, FlowError } = require('./errors');
const { runGeneration, makeJobToken } = require('./generation');

// Menjalankan satu job video sampai terunduh dan terunggah. Mengembalikan status akhir.
async function processJob({ job, source, flow, cfg, log, workDir, meta = {} }) {
  const dir = path.join(workDir, job.job_id);
  fs.mkdirSync(dir, { recursive: true });
  const ev = (step, message, extra = {}) => { if (step === 'generate' || step === 'generate_start') meta.generated = true; return source.log(job.job_id, { kind: 'info', step, message, ...extra }).catch(() => {}); };
  try {
    log.info(`▶ Job ${job.job_id} (percobaan ${job.attempt}/${job.max_attempts})`);
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
