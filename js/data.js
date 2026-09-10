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
  async function addVideoJob(fields) {
    const { data, error } = await client()
      .from('video_jobs')
      .insert({ current_step: 1, status: 'analyzing', frames_count: 0, ...fields })
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

  return {
    getCharacters, getCharacter,
    getProducts, getProduct, addProduct,
    getVideoJobs, getVideoJob, addVideoJob, updateVideoJob,
    getFrames, materializeFrames, updateFrame,
    stats,
  };
})();
