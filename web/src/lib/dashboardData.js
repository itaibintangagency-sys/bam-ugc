import { summarizeJobs } from './status.js';

const BATAS_BARIS = 1000;

// client = klien Supabase. Setiap bagian dibaca terpisah supaya satu galat tidak menutup seluruh dasbor.
export async function loadDashboard(client) {
  const out = { jobs: null, kredit: 0, terpotong: false, agents: [], paused: null, errors: [] };

  const jobs = await client.from('ugc_jobs').select('status, credits_observed').limit(BATAS_BARIS);
  if (jobs.error) out.errors.push('Antrean tidak bisa dibaca: ' + jobs.error.message);
  else {
    out.jobs = summarizeJobs(jobs.data);
    out.kredit = (jobs.data || []).reduce((n, r) => n + (Number(r.credits_observed) || 0), 0);
    out.terpotong = (jobs.data || []).length >= BATAS_BARIS;
  }

  const ag = await client.from('ugc_agents').select('name, status, last_seen, version');
  if (ag.error) out.errors.push('Status agent tidak bisa dibaca: ' + ag.error.message);
  else out.agents = ag.data || [];

  const ctl = await client.from('ugc_agent_control').select('paused, reason').maybeSingle();
  if (ctl.error) out.errors.push('Kontrol agent tidak bisa dibaca: ' + ctl.error.message);
  else out.paused = ctl.data || null;

  return out;
}
