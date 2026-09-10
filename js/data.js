/* ══════════════════════════════════════
   BA UGC — Data layer (LIVE)
   Bicara langsung ke skema Supabase ASLI.

   UPDATE dari versi sebelumnya:
   - Tambah N8N_BASE_URL — ganti dengan URL n8n kamu, dipakai buat semua
     panggilan generate (composite, frame plan, frame clip, produce) dan
     pembuatan akun staff.
   - Step 1 (genCompositeBtn), Step 2 (pickStyle), Step 3 (genFrame) di
     video-studio.html sekarang beneran manggil AI lewat fungsi-fungsi
     baru di bawah — bukan simulasi timeout lagi.
   - Tambah fungsi user_profiles (getStaffList, createStaff) untuk
     halaman staff.html.
   ══════════════════════════════════════ */

// ⚠️ GANTI dengan URL n8n kamu (contoh: https://xxx.sumopod.my.id/webhook)
const N8N_BASE_URL = 'https://GANTI-DENGAN-URL-N8N-KAMU/webhook';

const DB = (() => {
  function client() {
    if (typeof SUPABASE_READY === 'undefined' || !SUPABASE_READY) {
      throw new Error('Supabase belum dikonfigurasi — isi SUPABASE_URL & SUPABASE_ANON_KEY di js/supabase-client.js dulu.');
    }
    return supabaseClient;
  }

  async function callWebhook(path, body) {
    const res = await fetch(`${N8N_BASE_URL}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Backend gagal (${path}): ${res.status}`);
    return res.json();
  }

  function titleOf(job) {
    const charName = (job.characters && job.characters.name) || 'Karakter';
    const prodName = (job.products && job.products.name) || job.product_name || 'Produk';
    return `${charName} × ${prodName}`;
  }

  // ── Characters (READ ONLY — Character Creator masih menunggu desain ulang) ──
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
    const user = await AUTH.getUser();
    let query = client().from('video_jobs').select('*, characters(name), products(name)').order('created_at', { ascending: false });
    // Staff cuma lihat video miliknya sendiri (RLS juga menegakkan ini di server,
    // filter di sini cuma supaya query lebih ringan / UX lebih cepat)
    if (user && user.role !== 'admin') query = query.eq('created_by', user.id);
    const { data, error } = await query;
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
  async function addVideoJob(fields) {
    const user = await AUTH.getUser();
    const { data, error } = await client()
      .from('video_jobs')
      .insert({ current_step: 1, status: 'analyzing', frames_count: 0, created_by: user ? user.id : null, ...fields })
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

  // ── GENERATE — panggil backend n8n (Magnific) ──────────────
  // Ganti simulasi lama (setTimeout/toast) dengan panggilan beneran.

  // Step 1: compositing karakter + produk
  async function generateComposite(jobId) {
    return callWebhook('generate-composite', { job_id: jobId });
  }

  // Step 2: AI susun rencana scene (ganti buildFramePlan() yang hardcoded)
  async function generateFramePlan(jobId, style) {
    return callWebhook('generate-frame-plan', { job_id: jobId, style });
  }

  // Step 3: generate 1 klip video untuk 1 frame (TTS + OmniHuman)
  async function generateFrameClip(frameId) {
    return callWebhook('generate-frame-clip', { frame_id: frameId });
  }

  // Step 4: gabung semua klip approved jadi 1 video final
  async function produceVideo(jobId) {
    return callWebhook('produce-video', { job_id: jobId });
  }

  // ── Staff management (admin only — RLS di Supabase juga menegakkan ini) ──
  async function getStaffList() {
    const { data, error } = await client().from('user_profiles').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }
  async function createStaff({ email, password, name }) {
    // Lewat backend n8n karena butuh service_role key — TIDAK BOLEH dari browser.
    return callWebhook('create-staff', { email, password, name });
  }

  // ── Profil (ganti password) ──────────────
  async function updateOwnPassword(newPassword) {
    if (typeof SUPABASE_READY === 'undefined' || !SUPABASE_READY) {
      throw new Error('Ganti password perlu Supabase Auth aktif (tidak tersedia di mode demo).');
    }
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  // ── Dashboard aggregates ──
  function stats(jobs) {
    return {
      step1: jobs.filter(j => j.current_step === 1 && j.status !== 'completed').length,
      step2: jobs.filter(j => j.current_step === 2).length,
      step3: jobs.filter(j => j.current_step === 3).length,
      step4Ready: jobs.filter(j => j.current_step === 4 && j.status !== 'completed').length,
      doneThisWeek: jobs.filter(j => j.status === 'completed').length,
    };
  }

  return {
    getCharacters, getCharacter,
    getProducts, getProduct, addProduct,
    getVideoJobs, getVideoJob, addVideoJob, updateVideoJob,
    getFrames, materializeFrames, updateFrame,
    generateComposite, generateFramePlan, generateFrameClip, produceVideo,
    getStaffList, createStaff,
    updateOwnPassword,
    stats,
  };
})();
