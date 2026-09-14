/* ══════════════════════════════════════
   BA UGC — Auth helpers
   Mode ganda:
   - Supabase Auth aktif kalau SUPABASE_READY (lihat supabase-client.js)
   - Kalau belum dikonfigurasi, pakai "demo session" di localStorage
     supaya seluruh alur tetap bisa diklik/dites end-to-end.
   ══════════════════════════════════════ */

const AUTH = {
  SESSION_KEY: 'baugc_demo_session',

  async getUser() {
    if (typeof SUPABASE_READY !== 'undefined' && SUPABASE_READY) {
      const { data } = await supabaseClient.auth.getUser();
      return data && data.user ? { email: data.user.email, name: (data.user.email || '').split('@')[0], role: 'Admin' } : null;
    }
    const raw = localStorage.getItem(this.SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  },

  async signIn(email, password) {
    if (typeof SUPABASE_READY !== 'undefined' && SUPABASE_READY) {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data.user;
    }
    // demo mode: terima email/password apa saja yang tidak kosong
    if (!email || !password) throw new Error('Email dan password wajib diisi.');
    const user = { email, name: email.split('@')[0], role: 'Admin' };
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(user));
    return user;
  },

  async signOut() {
    if (typeof SUPABASE_READY !== 'undefined' && SUPABASE_READY) {
      await supabaseClient.auth.signOut();
    } else {
      localStorage.removeItem(this.SESSION_KEY);
    }
    window.location.href = 'login.html';
  },

  // Panggil di tiap halaman terproteksi. Redirect ke login kalau belum ada sesi.
  async guard() {
    const user = await this.getUser();
    if (!user) { window.location.href = 'login.html'; return null; }
    const nameEl = document.querySelector('[data-acct-name]');
    const roleEl = document.querySelector('[data-acct-role]');
    const avatarEl = document.querySelector('[data-acct-avatar]');
    if (nameEl) nameEl.textContent = user.name || user.email;
    if (roleEl) roleEl.textContent = user.role || 'Admin';
    if (avatarEl) avatarEl.textContent = (user.name || user.email || '?').charAt(0).toUpperCase();
    return user;
  },
};
