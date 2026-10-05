import { describe, expect, it } from 'vitest';
import { loadDashboard } from '../src/lib/dashboardData.js';

// Klien tiruan: from(tabel).select(...).limit()/maybeSingle() mengembalikan hasil yang ditentukan per tabel.
function fakeClient(hasil) {
  return {
    from(tabel) {
      const h = hasil[tabel] || { data: [], error: null };
      const chain = { select: () => chain, limit: () => Promise.resolve(h), maybeSingle: () => Promise.resolve(h), then: (res, rej) => Promise.resolve(h).then(res, rej) };
      return chain;
    },
  };
}

describe('loadDashboard', () => {
  it('menghitung antrean, kredit, agent, dan kontrol', async () => {
    const d = await loadDashboard(fakeClient({
      ugc_jobs: { data: [{ status: 'queued', credits_observed: null }, { status: 'done', credits_observed: 15 }, { status: 'done', credits_observed: 20 }], error: null },
      ugc_agents: { data: [{ name: 'laptop-1', status: 'online', last_seen: '2026-10-05T10:00:00Z', version: '0.1.0' }], error: null },
      ugc_agent_control: { data: { paused: true, reason: 'uji' }, error: null },
    }));
    expect(d.jobs.counts.antre).toBe(1); expect(d.jobs.counts.selesai).toBe(2);
    expect(d.kredit).toBe(35); expect(d.agents).toHaveLength(1); expect(d.paused.paused).toBe(true); expect(d.errors).toEqual([]);
  });
  it('satu galat tidak menutup bagian lain', async () => {
    const d = await loadDashboard(fakeClient({
      ugc_jobs: { data: null, error: { message: 'permission denied' } },
      ugc_agents: { data: [{ name: 'a', last_seen: null }], error: null },
    }));
    expect(d.jobs).toBeNull(); expect(d.agents).toHaveLength(1);
    expect(d.errors).toHaveLength(1); expect(d.errors[0]).toMatch(/Antrean/);
  });
  it('menandai bila hasil terpotong di 1.000 baris', async () => {
    const banyak = Array.from({ length: 1000 }, () => ({ status: 'draft' }));
    expect((await loadDashboard(fakeClient({ ugc_jobs: { data: banyak, error: null } }))).terpotong).toBe(true);
  });
});
