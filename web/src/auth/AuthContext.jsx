import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase.js';
import { normalizeProfile } from '../lib/roles.js';

const Ctx = createContext(null);

// client dapat diganti saat pengujian; di produksi memakai klien Supabase bersama.
export function AuthProvider({ children, client = supabase }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(Boolean(client));

  const loadProfile = useCallback(async (user) => {
    if (!client || !user) { setProfile(null); return; }
    const { data } = await client.from('user_profiles').select('id, name, role').eq('id', user.id).maybeSingle();
    setProfile(normalizeProfile(data, user));
  }, [client]);

  useEffect(() => {
    if (!client) return undefined;
    let aktif = true;
    client.auth.getSession().then(async ({ data }) => {
      if (!aktif) return;
      setSession(data.session || null);
      await loadProfile(data.session && data.session.user);
      if (aktif) setLoading(false);
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, s) => {
      setSession(s || null);
      if (!s) setProfile(null);
    });
    return () => { aktif = false; sub.subscription.unsubscribe(); };
  }, [client, loadProfile]);

  const signIn = useCallback(async (email, password) => {
    if (!client) throw new Error('Konfigurasi Supabase belum diatur.');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setSession(data.session || null);
    await loadProfile(data.user);
    return data;
  }, [client, loadProfile]);

  const signOut = useCallback(async () => {
    if (client) await client.auth.signOut();
    setSession(null); setProfile(null);
  }, [client]);

  const value = useMemo(() => ({ client, session, profile, loading, signIn, signOut, configured: Boolean(client) }), [client, session, profile, loading, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth harus dipakai di dalam AuthProvider');
  return v;
}
