/* ══════════════════════════════════════
   BA UGC — Data layer (LIVE)
   Bicara langsung ke skema Supabase ASLI (bukan skema yang saya karang
   di supabase/schema.sql — itu sudah usang, abaikan).

   Status per tabel:
   - characters      : READ ONLY. Penciptaan karakter (Character Creator)
                        SENGAJA belum disambung — alur aslinya berbasis
                        collecting_photos bertahap (lihat characters.html),
                        bukan generate instan. Menunggu desain ulang.
   - products        : full CRUD, live.
   - video_jobs      : full CRUD, live. `title` bukan kolom asli — dihitung
                        di sini dari nama karakter + product_name.
   - frames          : full CRUD, live. Rencana scene (script/label/waktu
                        per frame) disimpan sebagai JSON di
                        video_jobs.frame_plan (kolom ini masih kosong di
                        semua baris asli, jadi struktur JSON di bawah ini
                        adalah usulan, bukan yang sudah given).

   frame_plan JSON shape yang dipakai di sini:
   {
     "style": "short" | "story" | "unbox",
     "frames": [
       { "frame_number": 1, "label": "Hook", "time_range": "0-3s", "script": "..." },
       ...
     ]
   }
   ══════════════════════════════════════ */

const DB = (() => {
  function client() {
    if (typeof SUPABASE_READY === 'undefined' || !SUPABASE_READY) {
      throw new Error('Supabase belum dikonfigurasi — isi SUPABASE_URL & SUPABASE_ANON_KEY di js/supabase-client.js dulu.');
    }
    return supabaseClient;
  }

  function titleOf(job) {
    const charName = (job.characters && job.characters.name) || 'Karakter';
    const prodName = (job.products && job.products.name) || job.product_name || 'Produk';
    return `${charName} × ${prodName}`;
  }

  // ── Characters (READ ONLY) ──────────────────────
  async function getCharacters() {
    const { data, error } = await client().from('characters').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }
  async function getCharacter(id) {
    const { data, error } = await client().from('characters').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }

  // ── Products ─────────────────────────
  async function getProducts() {
    const { data, error } = await client().from('products').select('*').eq('status', 'active').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }
  async function getProduct(id) {
    const { data, error } = await client().from('products').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }
  async function addProduct(fields) {
    const { data, error } = await client().from('products').insert({ status: 'active', ...fields }).select().single();
    if (error) throw error;
    return data;
  }

  // ── Video jobs ───────────────────────
  async function getVideoJobs() {
    const { data, error } = await client()
      .from('video_jobs')
      .select('*, characters(name), products(name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data.map(j => ({ ...j, title: titleOf(j) }));
  }
  async function getVideoJob(id) {
    const { data, error } = await client()
      .from('video_jobs')
      .select('*, characters(name), products(name)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? { ...data, title: titleOf(data) } : null;
  }
  async function currentUserId() {
    const { data } = await client().auth.getUser();
    return data && data.user ? data.user.id : null;
  }

  async function addVideoJob(fields) {
    const uid = await currentUserId();
    const { data, error } = await client()
      .from('video_jobs')
      .insert({ current_step: 1, status: 'analyzing', frames_count: 0, created_by: uid, ...fields })
      .select('*, characters(name), products(name)')
      .single();
    if (error) throw error;
    return { ...data, title: titleOf(data) };
  }
  async function updateVideoJob(id, patch) {
    const { data, error } = await client()
      .from('video_jobs')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, characters(name), products(name)')
      .single();
    if (error) throw error;
    return { ...data, title: titleOf(data) };
  }

  // ── Frames ───────────────────────────
  // Rencana (Step 2) ditulis ke video_jobs.frame_plan lewat updateVideoJob.
  // Baris `frames` baru dibuat saat Step 3 mulai generate eksekusi per-scene.
  async function getFrames(videoJobId) {
    const { data, error } = await client().from('frames').select('*').eq('video_job_id', videoJobId).order('frame_number', { ascending: true });
    if (error) throw error;
    return data;
  }
  async function materializeFrames(videoJobId, planFrames) {
    const rows = planFrames.map(f => ({
      video_job_id: videoJobId,
      frame_number: f.frame_number,
      script: f.script,
      status: 'pending',
    }));
    const { data, error } = await client().from('frames').insert(rows).select().order('frame_number', { ascending: true });
    if (error) throw error;
    return data;
  }
  async function updateFrame(id, patch) {
    const { data, error } = await client().from('frames').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  // ── Dashboard aggregates (dihitung di client dari getVideoJobs()) ──
  function stats(jobs) {
    return {
      step1: jobs.filter(j => j.current_step === 1 && j.status !== 'completed').length,
      step2: jobs.filter(j => j.current_step === 2).length,
      step3: jobs.filter(j => j.current_step === 3).length,
      step4Ready: jobs.filter(j => j.current_step === 4 && j.status !== 'completed').length,
      doneThisWeek: jobs.filter(j => j.status === 'completed').length,
    };
  }

  // ── Storage helpers (untuk thumbnail) ──
  async function signedUrl(bucket, path, expiresSec = 3600) {
    if (!path) return null;
    const { data, error } = await client().storage.from(bucket).createSignedUrl(path, expiresSec);
    if (error) { console.warn('signedUrl gagal', bucket, path, error.message); return null; }
    return data.signedUrl;
  }
  async function getCharacterPrimaryPhoto(characterId) {
    const { data, error } = await client()
      .from('character_photos')
      .select('storage_path')
      .eq('character_id', characterId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return signedUrl('character-assets', data.storage_path);
  }
  async function uploadFile(bucket, path, file) {
    const { error } = await client().storage.from(bucket).upload(path, file, { upsert: true });
    if (error) throw error;
    return path;
  }

  // ── Backgrounds (untuk thumbnail scene) ──
  async function getBackgrounds() {
    const { data, error } = await client().from('backgrounds').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const withUrls = await Promise.all(data.map(async b => ({ ...b, _signedUrl: await signedUrl('product-assets', b.storage_path) })));
    return withUrls;
  }
  async function addBackground(fields, file) {
    const path = `bg_${Date.now()}_${(file.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '')}`;
    await uploadFile('product-assets', path, file);
    const { data, error } = await client().from('backgrounds').insert({ storage_path: path, type: 'uploaded', ...fields }).select().single();
    if (error) throw error;
    return { ...data, _signedUrl: await signedUrl('product-assets', path) };
  }

  // ── Avatar profil ──────────────────────
  // Butuh bucket "avatars" (privat) + kolom user_profiles.avatar_path —
  // keduanya BELUM ADA sampai SQL di bawah dijalankan manual. Sebelum itu,
  // fungsi ini akan gagal dengan pesan error yang jelas (bukan diam-diam rusak).
  async function uploadAvatar(userId, file) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${userId}/avatar.${ext}`;
    await uploadFile('avatars', path, file);
    const { error } = await client().from('user_profiles').update({ avatar_path: path }).eq('id', userId);
    if (error) throw error;
    return signedUrl('avatars', path);
  }
  async function getAvatarUrl(avatarPath) {
    if (!avatarPath) return null;
    return signedUrl('avatars', avatarPath);
  }

  return {
    getCharacters, getCharacter, getCharacterPrimaryPhoto,
    getProducts, getProduct, addProduct,
    getVideoJobs, getVideoJob, addVideoJob, updateVideoJob,
    getFrames, materializeFrames, updateFrame,
    getBackgrounds, addBackground, signedUrl, uploadFile,
    uploadAvatar, getAvatarUrl,
    stats,
  };
})();
