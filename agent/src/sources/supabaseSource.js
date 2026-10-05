'use strict';
const path = require('path');

class SupabaseSource {
  constructor(supa, { agentName, version }) { this.supa = supa; this.agentName = agentName; this.version = version; this.kind = 'supabase'; }
  async heartbeat(info = {}) {
    return this.supa.rpc('ugc_agent_heartbeat', { p_agent: this.agentName, p_info: { version: this.version, status: 'online', ...info } });
  }
  async claim() { return this.supa.rpc('ugc_claim_next_job', { p_agent: this.agentName }); }
  async progress(jobId, status, patch = {}, event = null) {
    return this.supa.rpc('ugc_job_progress', { p_job: jobId, p_status: status, p_patch: patch, p_event: event ? { agent: this.agentName, ...event } : null });
  }
  async log(jobId, event) { return this.supa.rpc('ugc_log_event', { p_job: jobId, p_event: { agent: this.agentName, ...event } }); }
  async setPause(paused, reason) { return this.supa.rpc('ugc_set_pause', { p_paused: paused, p_reason: reason || null }); }
  async requeueStale() { return this.supa.rpc('ugc_requeue_stale', {}); }
  async claimCharTask() { return this.supa.rpc('ugc_claim_next_char_task', { p_agent: this.agentName }); }
  async charTaskProgress(taskId, status, patch = {}, event = null) {
    return this.supa.rpc('ugc_char_task_progress', { p_task: taskId, p_status: status, p_patch: patch, p_event: event ? { agent: this.agentName, ...event } : null });
  }
  async fetchCharPhoto(photo, dir) {
    const ext = path.extname(photo.path) || '.png';
    return this.supa.download(photo.bucket || 'ugc-characters', photo.path, path.join(dir, photo.angle + ext));
  }
  async uploadCharVideo(task, file) {
    return this.supa.upload('ugc-videos', `characters/${task.character_id}/intro-${task.attempt}.mp4`, file, 'video/mp4');
  }
  async fetchStoryboard(job, dir) {
    const ext = path.extname(job.storyboard.path) || '.png';
    return this.supa.download(job.storyboard.bucket, job.storyboard.path, path.join(dir, 'storyboard' + ext));
  }
  async uploadVideo(job, file) {
    return this.supa.upload('ugc-videos', `${job.batch_id}/${job.job_id}.mp4`, file, 'video/mp4');
  }
}
module.exports = { SupabaseSource };
