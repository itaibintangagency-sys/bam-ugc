'use strict';
// Mode offline: antrean berupa folder. Tidak butuh internet atau Supabase.
//   inbox/<id>/job.json, storyboard.png, prompt.json   -> masukan
//   outbox/<id>/video.mp4, result.json                  -> hasil
const fs = require('fs');
const path = require('path');
const { loadRoom } = require('../room');


// Generate dianggap "mungkin menghasilkan video" bila ditekan dan sesudahnya TIDAK ada catatan bahwa Flow menolak/menggagalkannya
// (kartu gagal). Kartu gagal berarti tidak ada video, jadi percobaan berikutnya boleh generate lagi seperti biasa.
// Waktu tunggu habis (generate_timeout) tidak menghapus tanda ini, karena video masih bisa selesai belakangan.
function wasGenerated(history) {
  let g = false;
  for (const h of history || []) {
    if (h.step === 'generate_start' || h.step === 'generate') g = true;
    else if (h.step === 'generate_failed') g = false;
  }
  return g;
}

class LocalSource {
  constructor(root, { maxAttempts = 3, backoffMinutes = 2 } = {}) {
    this.root = root; this.inbox = path.join(root, 'inbox'); this.outbox = path.join(root, 'outbox');
    this.maxAttempts = maxAttempts; this.backoffMs = backoffMinutes * 60000; this.kind = 'local';
    fs.mkdirSync(this.inbox, { recursive: true }); fs.mkdirSync(this.outbox, { recursive: true });
    this.paused = false;
  }
  _dirs() { return fs.readdirSync(this.inbox).filter(d => fs.existsSync(path.join(this.inbox, d, 'job.json'))).sort(); }
  _read(id) { const f = path.join(this.inbox, id, 'status.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { status: 'queued', attempts: 0 }; }
  _write(id, st) { fs.writeFileSync(path.join(this.inbox, id, 'status.json'), JSON.stringify(st, null, 1)); }
  async heartbeat(info = {}) {
    fs.writeFileSync(path.join(this.root, 'heartbeat.json'), JSON.stringify({ at: new Date().toISOString(), ...info }));
    return { paused: this.paused, reason: null };
  }
  async claim() {
    if (this.paused) return null;
    for (const id of this._dirs()) {
      const st = this._read(id);
      if (st.status !== 'queued') continue;
      if (st.not_before && Date.parse(st.not_before) > Date.now()) continue;
      const spec = JSON.parse(fs.readFileSync(path.join(this.inbox, id, 'job.json'), 'utf8'));
      st.status = 'running'; st.attempts = (st.attempts || 0) + 1; this._write(id, st);
      const jf = spec.video_json_file ? path.join(this.inbox, id, spec.video_json_file) : null;
      const room = spec.room_code ? (loadRoom(this.root, spec.room_code) || { missing: true, code: spec.room_code }) : null;
      return {
        job_id: id, batch_id: spec.batch_id || 'local', seq: spec.seq || 1, attempt: st.attempts, max_attempts: this.maxAttempts,
        project_url: spec.project_url, character_code: spec.character_code || '', room_code: spec.room_code || '', room, flow_asset_url: st.flow_asset_url || null,
        generated: wasGenerated(st.history),
        extra_files: (spec.extra_files || []).map(f => path.join(this.inbox, id, f)),
        resolution: spec.resolution || '720p', duration_sec: spec.duration_sec || 10,
        storyboard: { file: path.join(this.inbox, id, spec.storyboard_file || 'storyboard.png') },
        video_json: jf ? fs.readFileSync(jf, 'utf8') : spec.video_json
      };
    }
    return null;
  }
  async progress(id, status, patch = {}, event = null) {
    const st = this._read(id); st.history = st.history || [];
    let final = status;
    if (status === 'failed' && (st.attempts || 0) < this.maxAttempts && patch.error_kind !== 'fatal') {
      final = 'queued'; st.not_before = new Date(Date.now() + this.backoffMs * Math.max(st.attempts, 1)).toISOString();
    }
    if (status === 'needs_human') this.paused = true;
    Object.assign(st, { status: final, last_error: patch.last_error ?? st.last_error, error_kind: patch.error_kind ?? st.error_kind });
    if (patch.video_path) st.video_path = patch.video_path;
    if (patch.flow_asset_url) st.flow_asset_url = patch.flow_asset_url;
    if (patch.credits_observed != null) st.credits_observed = patch.credits_observed;
    if (event) st.history.push({ at: new Date().toISOString(), ...event });
    this._write(id, st);
    if (final === 'downloaded') {
      fs.mkdirSync(path.join(this.outbox, id), { recursive: true });
      fs.writeFileSync(path.join(this.outbox, id, 'result.json'), JSON.stringify(st, null, 1));
    }
    return final;
  }
  async log(id, event) { const st = this._read(id); st.history = st.history || []; st.history.push({ at: new Date().toISOString(), ...event }); this._write(id, st); }
  async claimCharTask() { return null; }  // tugas karakter hanya lewat Supabase
  async setPause(paused) { this.paused = paused; }
  // Job yang tertinggal berstatus "running" berarti agent berhenti di tengah jalan (mati, Ctrl+C, laptop mati).
  // Dikembalikan ke antrean. Bila generate sudah ditekan, claim() menandainya supaya video dicari lewat kode job
  // dan TIDAK dibuat ulang.
  async requeueStale() {
    let n = 0;
    for (const id of this._dirs()) {
      const st = this._read(id);
      if (st.status !== 'running') continue;
      st.history = st.history || [];
      const generated = wasGenerated(st.history);
      st.status = 'queued'; st.not_before = null;
      st.history.push({ at: new Date().toISOString(), kind: 'warn', step: 'requeue',
        message: generated ? 'Agent berhenti setelah generate ditekan: job dikembalikan ke antrean, video akan dicari lewat kode job (tanpa generate ulang)'
          : 'Agent berhenti di tengah job: dikembalikan ke antrean' });
      this._write(id, st); n++;
    }
    return n;
  }
  // Foto tambahan (mis. foto wajah karakter) disalin ke folder kerja, dilampirkan setelah storyboard.
  async fetchExtras(job, dir) {
    fs.mkdirSync(dir, { recursive: true });
    return (job.extra_files || []).map((f, i) => { const dest = path.join(dir, `extra${i + 1}${path.extname(f) || '.png'}`); fs.copyFileSync(f, dest); return dest; });
  }

  // Ringkasan seluruh antrean (dipakai perintah "jalankan semua").
  summary() {
    return this._dirs().map(id => { const st = this._read(id); return { id, status: st.status, attempts: st.attempts || 0, error: st.last_error || '', video: st.video_path || '', not_before: st.not_before || '' }; });
  }

  async fetchStoryboard(job, dir) {
    const dest = path.join(dir, 'storyboard' + (path.extname(job.storyboard.file) || '.png'));
    fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(job.storyboard.file, dest); return dest;
  }
  async uploadVideo(job, file) {
    const dir = path.join(this.outbox, job.job_id); fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, 'video.mp4'); fs.copyFileSync(file, dest); return dest;
  }
}
module.exports = { LocalSource };
