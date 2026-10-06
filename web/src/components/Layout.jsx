import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { isAdmin, labelRole } from '../lib/roles.js';

export default function Layout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const keluar = async () => { await signOut(); navigate('/masuk', { replace: true }); };
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">BA<span>UGC</span></div>
        <nav className="nav-utama" aria-label="Menu utama">
          <NavLink to="/" end>Dasbor</NavLink>
          <NavLink to="/karakter">Karakter</NavLink>
          {isAdmin(profile) && <NavLink to="/riwayat">Riwayat generate</NavLink>}
        </nav>
        <div className="account">
          <div className="account-text">
            <strong>{profile ? profile.name : '…'}</strong>
            <span className="badge">{profile ? labelRole(profile.role) : ''}</span>
          </div>
          <button type="button" className="btn btn-secondary" onClick={keluar}>Keluar</button>
        </div>
      </header>
      <main className="app-main"><Outlet /></main>
    </div>
  );
}
