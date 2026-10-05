'use strict';
// Tugas karakter untuk agent: upload foto ke project Flow, dan video perkenalan (720p, 4 detik).
const fs = require('fs');
const path = require('path');
const { NeedsHuman, FlowError } = require('./errors');
const { runGeneration, makeJobToken } = require('./generation');

async function processCharTask({ task, source, flow, cfg, log, workDir }) {
  const dir = path.join(workDir, 'char-' + task.task_id);
  fs.mkdirSync(dir, { recursive: true });
  const events = [];
  const ev = async (step, message, extra = {}) => { events.push({ step, message, ...extra }); };
  try {
    log.info(`▶ Tugas karakter ${task.kind} untuk ${task.character_code} (percobaan ${task.attempt}/${task.max_attempts})`);
    if (task.kind === 'upload_photos') {
      await flow.openProject(task.project_url);
      let n = 0;
      for (const ph of task.photos || []) {
        const file = await source.fetchCharPhoto(ph, dir);
        const unique = `bamugc-${String(task.character_code).replace(/[^a-z0-9]/gi, '')}-${ph.angle}-${Date.now() % 100000}${path.extname(file) || '.png'}`;
        await flow.uploadAsset(file, unique);
        n++; await ev('upload', `Foto ${ph.angle} terunggah`);
        log.info(`  ↑ ${ph.angle}`);
      }
      if (!n) throw new FlowError('Tidak ada foto yang disetujui untuk diupload', 'fatal');
      await source.charTaskProgress(task.task_id, 'done', { uploaded: n }, { step: 'done', message: `${n} foto terunggah` });
      log.info(`✔ ${n} foto terunggah ke project`);
      return 'done';
    }
    if (task.kind === 'intro_video') {
      const json = task.payload && task.payload.video_json;
      if (!json) throw new FlowError('JSON perkenalan kosong', 'fatal');
      const out = path.join(dir, 'intro.mp4');
      const g = await runGeneration({
        flow, log, ev, projectUrl: task.project_url, settings: { res: '720p', dur: 4, n: 1, ratio: '9:16' },
        attachFile: null, promptText: json, expectedChips: null, outPath: out, token: makeJobToken(task.task_id),
        policyRetries: Number(process.env.POLICY_RETRIES ?? 2),
        onFailure: async (kind, msg) => { events.push({ step: 'generate', message: `Gagal (${kind}): ${msg}` }); }
      });
      const videoPath = await source.uploadCharVideo(task, out);
      await source.charTaskProgress(task.task_id, 'done', { video_path: videoPath, flow_asset_url: g.assetUrl, credits_observed: g.credits }, { step: 'done', message: 'Perkenalan selesai', events });
      log.info(`✔ Perkenalan ${task.character_code} → ${videoPath}`);
      return 'done';
    }
    throw new FlowError(`Jenis tugas ${task.kind} tidak dikenal`, 'fatal');
  } catch (e) {
    const snap = await flow.debugSnap(`char-${String(task.task_id).slice(0, 8)}-error`);
    if (e instanceof NeedsHuman) {
      log.error(`⏸ Butuh manusia (${e.reason}): ${e.message}`);
      await source.charTaskProgress(task.task_id, 'needs_human', { last_error: e.message, error_kind: e.reason }, { step: 'human', message: e.message, snap, events });
      return 'needs_human';
    }
    const kind = e instanceof FlowError ? e.kind : 'unknown';
    log.error(`✖ Tugas karakter gagal (${kind}): ${e.message}`);
    return source.charTaskProgress(task.task_id, 'failed', { last_error: String(e.message).slice(0, 400), error_kind: kind }, { step: 'failed', message: String(e.message).slice(0, 300), snap, events });
  }
}
module.exports = { processCharTask };
