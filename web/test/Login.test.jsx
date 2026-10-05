import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach } from 'vitest';
import { AuthProvider } from '../src/auth/AuthContext.jsx';
import Login from '../src/pages/Login.jsx';

afterEach(cleanup);

function fakeClient({ signIn } = {}) {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: { id: 'u1', name: 'Dewi', role: 'staff' }, error: null }) };
  return {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: signIn || (() => Promise.resolve({ data: { session: { user: { id: 'u1', email: 'a@b.id' } }, user: { id: 'u1', email: 'a@b.id' } }, error: null })),
      signOut: () => Promise.resolve({}),
    },
    from: () => chain,
  };
}
const tampil = (client) => render(
  <MemoryRouter initialEntries={['/masuk']}>
    <AuthProvider client={client}>
      <Routes><Route path="/masuk" element={<Login />} /><Route path="/" element={<p>DASBOR</p>} /></Routes>
    </AuthProvider>
  </MemoryRouter>
);

describe('halaman login', () => {
  it('menampilkan judul, label terhubung ke isian, dan tombol', async () => {
    tampil(fakeClient());
    expect(await screen.findByRole('heading', { name: 'Masuk' })).toBeTruthy();
    expect(screen.getByLabelText('Email').getAttribute('type')).toBe('email');
    expect(screen.getByLabelText('Kata sandi').getAttribute('type')).toBe('password');
    expect(screen.getByRole('button', { name: 'Masuk' })).toBeTruthy();
  });
  it('tombol Tampilkan/Sembunyikan mengubah jenis isian kata sandi', async () => {
    tampil(fakeClient());
    const tombol = await screen.findByRole('button', { name: 'Tampilkan' });
    fireEvent.click(tombol);
    expect(screen.getByLabelText('Kata sandi').getAttribute('type')).toBe('text');
    expect(screen.getByRole('button', { name: 'Sembunyikan' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('kirim: email dipangkas, lalu pindah ke dasbor', async () => {
    const signIn = vi.fn(() => Promise.resolve({ data: { session: { user: { id: 'u1', email: 'a@b.id' } }, user: { id: 'u1', email: 'a@b.id' } }, error: null }));
    tampil(fakeClient({ signIn }));
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: '  a@b.id  ' } });
    fireEvent.change(screen.getByLabelText('Kata sandi'), { target: { value: 'rahasia123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Masuk' }));
    await waitFor(() => expect(screen.getByText('DASBOR')).toBeTruthy());
    expect(signIn).toHaveBeenCalledWith({ email: 'a@b.id', password: 'rahasia123' });
  });
  it('galat login tampil sebagai peringatan berbahasa Indonesia dan form dapat dicoba lagi', async () => {
    const signIn = () => Promise.resolve({ data: {}, error: { message: 'Invalid login credentials' } });
    tampil(fakeClient({ signIn }));
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'a@b.id' } });
    fireEvent.change(screen.getByLabelText('Kata sandi'), { target: { value: 'salah' } });
    fireEvent.click(screen.getByRole('button', { name: 'Masuk' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Email atau kata sandi salah.');
    expect(screen.getByRole('button', { name: 'Masuk' }).disabled).toBe(false);
  });
  it('tanpa konfigurasi Supabase: peringatan jelas dan tombol Masuk nonaktif', async () => {
    tampil(null);
    expect((await screen.findByRole('alert')).textContent).toMatch(/VITE_SUPABASE_URL/);
    expect(screen.getByRole('button', { name: 'Masuk' }).disabled).toBe(true);
  });
});
