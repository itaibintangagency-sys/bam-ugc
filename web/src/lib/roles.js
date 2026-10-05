export const ROLES = ['admin', 'staff', 'agent'];

const LABEL = { admin: 'Admin', staff: 'Staf', agent: 'Agent' };

// Bila baris user_profiles belum ada, pakai peran paling rendah (staf). Hak akses sesungguhnya tetap ditentukan RLS di database.
export function normalizeProfile(row, user) {
  const email = (user && user.email) || '';
  const role = row && ROLES.includes(row.role) ? row.role : 'staff';
  const name = (row && row.name) || email.split('@')[0] || 'Pengguna';
  return { id: (user && user.id) || null, name, role, email, fromDb: Boolean(row) };
}

export const labelRole = role => LABEL[role] || 'Staf';
export const isAdmin = profile => Boolean(profile) && profile.role === 'admin';
