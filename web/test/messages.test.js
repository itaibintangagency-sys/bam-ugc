import { describe, expect, it } from 'vitest';
import { authErrorMessage } from '../src/lib/messages.js';

describe('pesan galat login', () => {
  it('menerjemahkan galat Supabase yang umum', () => {
    expect(authErrorMessage({ message: 'Invalid login credentials' })).toBe('Email atau kata sandi salah.');
    expect(authErrorMessage({ message: 'Email not confirmed' })).toMatch(/belum dikonfirmasi/);
    expect(authErrorMessage({ message: 'Failed to fetch' })).toMatch(/koneksi/);
    expect(authErrorMessage({ message: 'Too many requests' })).toMatch(/Tunggu/);
  });
  it('galat tak dikenal tidak membocorkan pesan mentah', () => {
    expect(authErrorMessage({ message: 'select * from secret_table failed' })).not.toMatch(/secret_table/);
    expect(authErrorMessage(null)).toBe('Gagal masuk. Coba lagi.');
  });
});
