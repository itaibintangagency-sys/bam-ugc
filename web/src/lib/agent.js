// Batas ini perkiraan; sesuaikan dengan selang detak agent sebenarnya.
export const BATAS_ONLINE_MENIT = 5;
export const BATAS_TIDAK_AKTIF_MENIT = 30;

export function menitSejak(lastSeen, now = new Date()) {
  if (!lastSeen) return null;
  const t = new Date(lastSeen).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 60000));
}

export function relatif(lastSeen, now = new Date()) {
  const m = menitSejak(lastSeen, now);
  if (m === null) return 'belum pernah';
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  const j = Math.floor(m / 60);
  if (j < 24) return `${j} jam lalu`;
  return `${Math.floor(j / 24)} hari lalu`;
}

// Kebenaran status ada pada last_seen, bukan kolom status di database (kolom itu bisa basi).
export function agentStatus(lastSeen, now = new Date()) {
  const m = menitSejak(lastSeen, now);
  if (m === null) return { level: 'belum', label: 'Belum pernah terhubung', menit: null };
  if (m <= BATAS_ONLINE_MENIT) return { level: 'online', label: 'Online', menit: m };
  if (m <= BATAS_TIDAK_AKTIF_MENIT) return { level: 'tidak_aktif', label: 'Tidak aktif', menit: m };
  return { level: 'offline', label: 'Offline', menit: m };
}
