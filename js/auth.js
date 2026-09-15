/* ══════════════════════════════════════
   BA UGC — Auth helpers
   Mode ganda:
   - Supabase Auth aktif kalau SUPABASE_READY (lihat supabase-client.js)
   - Kalau belum dikonfigurasi, pakai "demo session" di localStorage
     supaya seluruh alur tetap bisa diklik/dites end-to-end.

   UPDATE: role sekarang dibaca dari tabel user_profiles (bukan hardcode
   'Admin' lagi). Kalau baris user_profiles belum ada untuk user itu,
   fallback ke role 'staff' (paling aman/rendah privilese) dan kasih
   warning di console.
   ══════════════════════════════════════ */

const AUTH = {
  SESSION_KEY: 'baugc_demo_session',
  _cachedProfile: null,

  async getUser() {
    if (typeof SUPABASE_READY !== 'undefined' && SUPABASE_READY) {
      const { data } = await supabaseClient.auth.getUser();
      if (!data || !data.user) return null;

      const profile = await this._getProfile(data.user.id, data.user.email);
      return {
        id: data.user.id,
        email: data.user.email,
        name: profile.name || (data.user.email || '').split('@')[0],
        role: profile.role,
        avatarPath: profile.avatar_path || null,
      };
    }
    const raw = localStorage.getItem(this.SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  },

  // Ambil profil (role, name) dari user_profiles. Di-cache per sesi biar
  // nggak query berkali-kali tiap render halaman.
  async _getProfile(userId, email) {
    if (this._cachedProfile && this._cachedProfile.id === userId) {
      return this._cachedProfile;
    }
    const { data, error } = await supabaseClient
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      console.warn('user_profiles belum ada untuk user ini — fallback ke role "staff". Minta admin tambahkan baris user_profiles secara manual atau lewat halaman Kelola Staff.', error);
      this._cachedProfile = { id: userId, name: null, role: 'staff', avatar_path: null };
      return this._cachedProfile;
    }
    this._cachedProfile = data;
    return data;
  },

  async signIn(email, password) {
    if (typeof SUPABASE_READY !== 'undefined' && SUPABASE_READY) {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      this._cachedProfile = null; // reset cache, akan di-fetch ulang di getUser()
      return data.user;
    }
    // demo mode: terima email/password apa saja yang tidak kosong
    if (!email || !password) throw new Error('Email dan password wajib diisi.');
    const user = { email, name: email.split('@')[0], role: 'admin' };
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(user));
    return user;
  },

  async signOut() {
    if (typeof SUPABASE_READY !== 'undefined' && SUPABASE_READY) {
      await supabaseClient.auth.signOut();
      this._cachedProfile = null;
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
    if (roleEl) roleEl.textContent = user.role === 'admin' ? 'Admin' : 'Staff';
    if (avatarEl) {
      avatarEl.textContent = (user.name || user.email || '?').charAt(0).toUpperCase();
      if (user.avatarPath && typeof DB !== 'undefined') {
        DB.getAvatarUrl(user.avatarPath).then(url => {
          if (url) avatarEl.innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
        }).catch(() => {});
      }
    }

    // Sembunyikan menu/elemen khusus admin kalau user ini staff
    if (user.role !== 'admin') {
      document.querySelectorAll('[data-admin-only]').forEach(el => el.style.display = 'none');
    }
    return user;
  },

  // Panggil di awal halaman yang KHUSUS admin (mis. staff.html, characters.html
  // kalau nanti Character Creator jadi admin-only). Redirect ke dashboard kalau
  // yang login ternyata staff.
  async guardAdmin() {
    const user = await this.guard();
    if (user && user.role !== 'admin') {
      window.location.href = 'dashboard.html';
      return null;
    }
    return user;
  },
};
