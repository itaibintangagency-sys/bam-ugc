import { describe, expect, it } from 'vitest';
import { isAdmin, labelRole, normalizeProfile } from '../src/lib/roles.js';

describe('profil dan peran', () => {
  const user = { id: 'u1', email: 'dewi@bintangagency.id' };
  it('memakai peran dari user_profiles bila valid', () => {
    expect(normalizeProfile({ role: 'admin', name: 'Dewi A' }, user)).toMatchObject({ role: 'admin', name: 'Dewi A', fromDb: true });
    expect(normalizeProfile({ role: 'agent', name: 'Laptop' }, user).role).toBe('agent');
  });
  it('baris tidak ada atau peran aneh = staf (paling rendah) dan nama dari email', () => {
    expect(normalizeProfile(null, user)).toMatchObject({ role: 'staff', name: 'dewi', fromDb: false });
    expect(normalizeProfile({ role: 'superadmin' }, user).role).toBe('staff');
  });
  it('isAdmin dan label peran', () => {
    expect(isAdmin({ role: 'admin' })).toBe(true);
    expect(isAdmin({ role: 'staff' })).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(labelRole('admin')).toBe('Admin'); expect(labelRole('staff')).toBe('Staf'); expect(labelRole('lain')).toBe('Staf');
  });
});
