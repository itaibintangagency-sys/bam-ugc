import { Navigate, Route, Routes } from 'react-router-dom';
import RequireAuth from './auth/RequireAuth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Karakter from './pages/Karakter.jsx';
import KarakterBaru from './pages/KarakterBaru.jsx';
import KarakterDetail from './pages/KarakterDetail.jsx';
import Riwayat from './pages/Riwayat.jsx';
import Produk from './pages/Produk.jsx';
import ProdukBaru from './pages/ProdukBaru.jsx';
import ProdukDetail from './pages/ProdukDetail.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/masuk" element={<Login />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/karakter" element={<Karakter />} />
        <Route path="/karakter/baru" element={<KarakterBaru />} />
        <Route path="/karakter/:id" element={<KarakterDetail />} />
        <Route path="/produk" element={<Produk />} />
        <Route path="/produk/baru" element={<ProdukBaru />} />
        <Route path="/produk/:id" element={<ProdukDetail />} />
        <Route path="/riwayat" element={<Riwayat />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
