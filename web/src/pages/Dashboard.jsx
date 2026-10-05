import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import StatCard from '../components/StatCard.jsx';
import { loadDashboard } from '../lib/dashboardData.js';
import { GROUPS } from '../lib/status.js';
import { agentStatus, relatif } from '../lib/agent.js';
import { isAdmin } from '../lib/roles.js';

const TONE = { online: 'ok', tidak_aktif: 'warn', offline: 'bad', belum: 'bad' };

export default function Dashboard() {
  const { client, profile } = useAuth();
  const [data, setData] = useState(null);
  const [memuat, setMemuat] = useState(true);

  const muat = useCallback(async () => {
    setMemuat(true);
    try { setData(await loadDashboard(client)); }
    catch (e) { setData({ jobs: null, kredit: 0, terpotong: false, agents: [], paused: null, errors: [String(e.message || e)] }); }
    finally { setMemuat(false); }
  }, [client]);

  useEffect(() => { muat(); const t = setInterval(muat, 30000); return () => clearInterval(t); }, [muat]);

  const admin = isAdmin(profile);
  return (
    <section aria-labelledby="judul-dasbor">
      <div className="page-head">
        <h1 id="judul-dasbor">Dasbor</h1>
        <button type="button" className="btn btn-secondary" onClick={muat} disabled={memuat}>{memuat ? 'Memuat…' : 'Muat ulang'}</button>
      </div>
      <p className="lead">{admin ? 'Ringkasan seluruh antrean dan agent.' : 'Ringkasan job milik Anda dan status agent.'}</p>

      {data && data.errors.length > 0 && (
        <div className="notice notice-bad" role="alert">
          <strong>Sebagian data tidak bisa dimuat.</strong>
          <ul>{data.errors.map(e => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      <h2>Antrean per status</h2>
      <div className="grid">
        {GROUPS.map(g => (
          <StatCard key={g.key} label={g.label} value={data && data.jobs ? data.jobs.counts[g.key] : '–'} hint={g.hint}
            tone={g.key === 'perhatian' && data && data.jobs && data.jobs.counts[g.key] > 0 ? 'bad' : 'neutral'} />
        ))}
      </div>
      {data && data.terpotong && <p className="lead">Hanya 1.000 job terbaru yang dihitung.</p>}

      <h2>Agent di laptop produksi</h2>
      {data && data.paused && data.paused.paused && (
        <div className="notice notice-warn" role="status"><strong>Agent dijeda.</strong> {data.paused.reason || 'Tanpa keterangan.'}</div>
      )}
      <div className="grid">
        {data && data.agents.length === 0 && <StatCard label="Belum ada agent" value="–" hint="Belum ada laptop yang terdaftar" tone="bad" />}
        {data && data.agents.map(a => {
          const st = agentStatus(a.last_seen);
          return <StatCard key={a.name} label={a.name} value={st.label} hint={`Terakhir terlihat ${relatif(a.last_seen)}${a.version ? ` · v${a.version}` : ''}`} tone={TONE[st.level]} />;
        })}
      </div>

      <h2>Kredit</h2>
      <div className="grid">
        <StatCard label="Kredit terpakai (teramati)" value={data && data.jobs ? data.kredit.toLocaleString('id-ID') : '–'} hint="Dari job yang tercatat; bukan saldo akun Flow" />
      </div>
    </section>
  );
}
