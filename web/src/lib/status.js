// Status job di database dikelompokkan agar mudah dibaca staf.
export const GROUPS = [
  { key: 'persiapan', label: 'Persiapan', hint: 'Draf, rencana, storyboard, JSON', statuses: ['draft', 'planned', 'storyboard_pending', 'storyboard_ready', 'json_ready'] },
  { key: 'menunggu', label: 'Siap diantre', hint: 'Sudah disetujui', statuses: ['approved'] },
  { key: 'antre', label: 'Dalam antrean', hint: 'Menunggu agent', statuses: ['queued'] },
  { key: 'berjalan', label: 'Berjalan', hint: 'Sedang dibuat di Flow', statuses: ['running'] },
  { key: 'selesai', label: 'Selesai', hint: 'Video sudah diunduh', statuses: ['downloaded', 'done'] },
  { key: 'perhatian', label: 'Perlu perhatian', hint: 'Gagal atau butuh manusia', statuses: ['failed', 'needs_human'] },
  { key: 'dibatalkan', label: 'Dibatalkan', hint: '', statuses: ['canceled'] },
];

export function groupOf(status) {
  const g = GROUPS.find(x => x.statuses.includes(status));
  return g ? g.key : 'lainnya';
}

export function summarizeJobs(rows) {
  const counts = Object.fromEntries(GROUPS.map(g => [g.key, 0]));
  counts.lainnya = 0;
  for (const r of rows || []) counts[groupOf(r && r.status)] += 1;
  return { total: (rows || []).length, counts };
}
