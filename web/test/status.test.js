import { describe, expect, it } from 'vitest';
import { GROUPS, groupOf, summarizeJobs } from '../src/lib/status.js';

describe('status job', () => {
  it('setiap status dikenal masuk tepat satu kelompok', () => {
    const semua = GROUPS.flatMap(g => g.statuses);
    expect(new Set(semua).size).toBe(semua.length);
  });
  it('mengelompokkan status database ke kelompok yang benar', () => {
    expect(groupOf('queued')).toBe('antre');
    expect(groupOf('running')).toBe('berjalan');
    expect(groupOf('downloaded')).toBe('selesai');
    expect(groupOf('failed')).toBe('perhatian');
    expect(groupOf('needs_human')).toBe('perhatian');
    expect(groupOf('json_ready')).toBe('persiapan');
    expect(groupOf('status_aneh')).toBe('lainnya');
  });
  it('menghitung ringkasan; daftar kosong dan nilai kosong aman', () => {
    const s = summarizeJobs([{ status: 'queued' }, { status: 'queued' }, { status: 'failed' }, { status: 'x' }, null]);
    expect(s.total).toBe(5);
    expect(s.counts.antre).toBe(2); expect(s.counts.perhatian).toBe(1); expect(s.counts.lainnya).toBe(2);
    expect(summarizeJobs(null).total).toBe(0);
    expect(summarizeJobs([]).counts.antre).toBe(0);
  });
});
