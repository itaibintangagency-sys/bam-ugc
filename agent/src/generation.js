'use strict';
// Satu putaran pembuatan video di Flow (dipakai job produksi dan video perkenalan karakter).
const path = require('path');
const crypto = require('crypto');
const { FlowError } = require('./errors');

// Kode pendek yang stabil per job, disisipkan di judul prompt. Prompt tampil di halaman detail video,
// sehingga agent bisa memastikan video yang dibuka adalah milik job ini (dan menemukannya lagi setelah agent mati).
function makeJobToken(id) {
  const h = crypto.createHash('sha1').update(String(id)).digest();
  let n = 0n; for (const b of h.subarray(0, 8)) n = (n << 8n) | BigInt(b);
  return 'J' + n.toString(36).toUpperCase().padStart(5, '0').slice(0, 5);
}

function withToken(jsonText, token) {
  if (!token) return jsonText;
  if (String(jsonText).includes(`"title": "${token} |`) || String(jsonText).includes(`"title": "${token}"`)) return jsonText;
  try {
    const o = JSON.parse(jsonText);
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('bukan objek');
    o.project = o.project && typeof o.project === 'object' ? o.project : {};
    const old = String(o.project.title || '');
    o.project.title = old ? `${token} | ${old}` : token;
    return JSON.stringify(o, null, 1);
  } catch {
    return /"title"\s*:\s*"/.test(jsonText) ? jsonText.replace(/("title"\s*:\s*")/, `$1${token} | `) : `${token}\n${jsonText}`;
  }
}

async function downloadAndReturn(o, assetUrl, credits) {
  const { flow, ev, projectUrl, outPath } = o;
  const dl = await flow.downloadOriginal(outPath);
  await ev('download', `Video diunduh (${dl.size} byte)`, { data: dl });
  await flow.backToProject(projectUrl);
  return { assetUrl, credits, dl };
}

/**
 * opts: { flow, log, ev, source, projectUrl, settings:{res,dur,n,ratio}, attachFile|null, promptText,
 *         expectedChips (angka|null), outPath, policyRetries, onFailure(kind,msg), onVideoReady(url,tried),
 *         token, resumeAssetUrl, locateFirst }
 * Mengembalikan { assetUrl, credits, dl }
 */
async function runGeneration(o) {
  const { flow, log, ev, projectUrl, settings, attachFile, promptText, expectedChips, outPath, policyRetries = 2, token } = o;

  // 1) Pemulihan unduhan: alamat video sudah tercatat, cukup unduh ulang (tanpa generate).
  if (o.resumeAssetUrl) {
    await ev('recover', 'Memakai video yang sudah dibuat sebelumnya (tanpa generate ulang)', { data: { url: o.resumeAssetUrl } });
    await flow.openAsset(o.resumeAssetUrl);
    return downloadAndReturn(o, o.resumeAssetUrl, null);
  }

  // 2) Generate pernah ditekan tetapi alamat video belum tercatat (agent mati di tengah jalan): cari lewat kode job.
  if (o.locateFirst && token) {
    await ev('locate', `Generate pernah ditekan pada percobaan sebelumnya; mencari video dengan kode ${token} (tanpa generate ulang)`);
    await flow.openProject(projectUrl);
    await flow.waitProcessingEnd();
    const f = await flow.findJobVideo(token, { projectUrl, kind: 'fatal' });
    if (o.onVideoReady) await o.onVideoReady(f.url, f.tried);
    return downloadAndReturn(o, f.url, null);
  }

  await flow.openProject(projectUrl);
  await ev('project', 'Project terbuka');

  const st = await flow.applySettings(settings);
  await ev('settings', `Setelan ${settings.res}/${settings.dur}s/x${settings.n || 1}`, { data: { credits: st.credits, model: st.model } });
  const agent = await flow.ensureAgentOff();
  if (agent === 'dimatikan') await ev('agent', 'Mode Agen dimatikan');

  await flow.clearComposer();
  if (attachFile) {
    const unique = `bamugc-${String(o.uniqueBase || 'x').replace(/[^a-z0-9]/gi, '').slice(0, 10)}-${Date.now() % 100000}${path.extname(attachFile) || '.png'}`;
    await flow.uploadAndAttach(attachFile, unique, { expect: 1 });
    await ev('attach', 'Storyboard terlampir', { data: { name: unique } });
    for (const [i, f] of (o.extraFiles || []).entries()) {
      const u2 = `bamugc-${String(o.uniqueBase || 'x').replace(/[^a-z0-9]/gi, '').slice(0, 10)}-x${i + 1}-${Date.now() % 100000}${path.extname(f) || '.png'}`;
      await flow.uploadAndAttach(f, u2, { expect: 2 + i });
      await ev('attach_extra', `Foto tambahan ${i + 1} terlampir`, { data: { name: u2 } });
    }
  }

  const n = await flow.fillPromptWithMentions(token ? withToken(promptText, token) : promptText);
  await ev('prompt', `Prompt terisi (${n} karakter)${token ? `, kode job ${token}` : ''}`);

  const cur = await flow.ensureSettings(settings);
  await ev('settings_check', `Setelan terakhir: ${cur.text}`);

  let before = await flow.generate({ expectedChips: attachFile ? 1 + (o.extraFiles || []).length : expectedChips, beforeClick: () => ev('generate_start', 'Akan menekan generate') });
  await ev('generate', 'Generate ditekan');
  let result = await flow.waitResult(before, { onPoll: s => log.info(`  … memproses (reuse=${s.reuse}, gagal=${s.fails.length}, thumbnail=${s.thumbs.length})`) });

  let retries = 0;
  while (result.status === 'failed') {
    const kind = result.kind || flow.classify(result.message);
    if (o.onFailure) await o.onFailure(kind, String(result.message).slice(0, 160));
    if (kind !== 'policy' || retries >= policyRetries) throw new FlowError(String(result.message).slice(0, 300), kind);
    retries++;
    const nb = await flow.retryFailed(before);
    if (!nb) throw new FlowError('Tombol ulang pada kartu gagal tidak ditemukan', 'policy');
    log.info(`  ↻ Ulang otomatis ${retries}/${policyRetries}`);
    result = await flow.waitResult(nb, { assumeStarted: true, onPoll: s => log.info(`  … memproses ulang (reuse=${s.reuse}, gagal=${s.fails.length})`) });
    before = nb;
  }
  await ev('wait', result.via === 'fallback' ? 'Penanda proses hilang; video dicari lewat kode job' : 'Video selesai dibuat');

  const found = token ? await flow.findJobVideo(token, { projectUrl, kind: 'unknown' }) : { url: await flow.openTopVideo(), tried: 0 };
  if (o.onVideoReady) await o.onVideoReady(found.url, found.tried);
  return downloadAndReturn(o, found.url, st.credits);
}
module.exports = { runGeneration, makeJobToken, withToken };
