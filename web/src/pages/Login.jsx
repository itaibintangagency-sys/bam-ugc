import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { authErrorMessage } from '../lib/messages.js';

export default function Login() {
  const { session, signIn, configured, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [lihat, setLihat] = useState(false);
  const [galat, setGalat] = useState('');
  const [proses, setProses] = useState(false);

  if (!loading && session) return <Navigate to="/" replace />;

  const kirim = async (e) => {
    e.preventDefault();
    setGalat(''); setProses(true);
    try { await signIn(email.trim(), password); navigate('/', { replace: true }); }
    catch (err) { setGalat(authErrorMessage(err)); setProses(false); }
  };

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="auth-mark" aria-label="BA UGC">BA<span>UGC</span></div>
        <h1 className="auth-title">Masuk</h1>
        <p className="auth-sub">Masuk untuk mulai membuat video.</p>

        {!configured && (
          <div className="auth-error" role="alert">
            Konfigurasi belum lengkap. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY di pengaturan Vercel.
          </div>
        )}
        {galat && <div className="auth-error" role="alert">{galat}</div>}

        <form onSubmit={kirim} noValidate={false}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" name="email" autoComplete="username" required placeholder="nama@bintangagency.id"
              value={email} onChange={e => setEmail(e.target.value)} disabled={proses} />
          </div>
          <div className="field">
            <label htmlFor="password">Kata sandi</label>
            <div className="password-row">
              <input id="password" type={lihat ? 'text' : 'password'} name="password" autoComplete="current-password" required
                placeholder="Kata sandi Anda" value={password} onChange={e => setPassword(e.target.value)} disabled={proses} />
              <button type="button" className="btn btn-secondary toggle" aria-pressed={lihat} onClick={() => setLihat(v => !v)}>
                {lihat ? 'Sembunyikan' : 'Tampilkan'}
              </button>
            </div>
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={proses || !configured}>
            {proses ? 'Memproses…' : 'Masuk'}
          </button>
        </form>
        <p className="auth-foot">Lupa kata sandi atau belum punya akun? Hubungi admin.</p>
      </div>
    </main>
  );
}
