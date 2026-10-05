import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

export default function RequireAuth({ children }) {
  const { session, loading } = useAuth();
  if (loading) return <p className="status-muted" role="status">Memuat…</p>;
  if (!session) return <Navigate to="/masuk" replace />;
  return children;
}
