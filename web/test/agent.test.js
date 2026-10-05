import { describe, expect, it } from 'vitest';
import { agentStatus, menitSejak, relatif } from '../src/lib/agent.js';

const SEKARANG = new Date('2026-10-05T12:00:00Z');
const lalu = menit => new Date(SEKARANG.getTime() - menit * 60000).toISOString();

describe('status agent dari last_seen', () => {
  it('online, tidak aktif, offline menurut batas menit', () => {
    expect(agentStatus(lalu(2), SEKARANG).level).toBe('online');
    expect(agentStatus(lalu(5), SEKARANG).level).toBe('online');
    expect(agentStatus(lalu(6), SEKARANG).level).toBe('tidak_aktif');
    expect(agentStatus(lalu(30), SEKARANG).level).toBe('tidak_aktif');
    expect(agentStatus(lalu(31), SEKARANG).level).toBe('offline');
  });
  it('kasus 5 Okt 2026: terakhir terlihat 14 jam lalu = offline walau kolom status database bilang online', () => {
    expect(agentStatus('2026-10-04T14:12:35Z', SEKARANG).level).toBe('offline');
  });
  it('tanpa last_seen atau tanggal rusak = belum pernah terhubung', () => {
    expect(agentStatus(null, SEKARANG).level).toBe('belum');
    expect(agentStatus('bukan-tanggal', SEKARANG).level).toBe('belum');
    expect(menitSejak(undefined, SEKARANG)).toBeNull();
  });
  it('waktu relatif dalam bahasa Indonesia', () => {
    expect(relatif(lalu(0), SEKARANG)).toBe('baru saja');
    expect(relatif(lalu(3), SEKARANG)).toBe('3 menit lalu');
    expect(relatif(lalu(120), SEKARANG)).toBe('2 jam lalu');
    expect(relatif(lalu(60 * 50), SEKARANG)).toBe('2 hari lalu');
    expect(relatif(null, SEKARANG)).toBe('belum pernah');
  });
  it('jam di masa depan tidak menghasilkan menit negatif', () => {
    expect(menitSejak(new Date(SEKARANG.getTime() + 600000).toISOString(), SEKARANG)).toBe(0);
  });
});
