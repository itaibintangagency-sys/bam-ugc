/* ══════════════════════════════════════
   BA UGC — Data layer
   Prototype backend: localStorage, shaped exactly like the
   Supabase schema in memory (characters, products, video_jobs, frames).
   To go live: replace the body of each DB.* function with the matching
   supabase-js call (see js/supabase-client.js for the client init) —
   page code never touches localStorage directly, so nothing else changes.
   ══════════════════════════════════════ */

const DB = (() => {
  const KEY = 'baugc_db_v1';

  function seed() {
    return {
      characters: [
        { id: 'c1', name: 'Siti', style: 'Review', voice: 'Hangat & ramah', gender: 'Perempuan', hijab: true, status: 'active', video_count: 6, created_at: daysAgo(18) },
        { id: 'c2', name: 'Rangga', style: 'Viral', voice: 'Energik & cepat', gender: 'Laki-laki', hijab: false, status: 'active', video_count: 4, created_at: daysAgo(11) },
        { id: 'c3', name: 'Maya', style: 'Storytelling', voice: 'Tenang & jelas', gender: 'Perempuan', hijab: false, status: 'active', video_count: 2, created_at: daysAgo(5) },
      ],
      products: [
        { id: 'p1', name: 'Serum Wajah Glow-C', platform: 'Shopee', price: 'Rp89.000', category: 'Skincare', created_at: daysAgo(20) },
        { id: 'p2', name: 'Kaos Oversize Basic', platform: 'TikTok Shop', price: 'Rp65.000', category: 'Fashion', created_at: daysAgo(15) },
        { id: 'p3', name: 'Botol Minum Thermos 1L', platform: 'TikTok Shop', price: 'Rp112.000', category: 'Rumah Tangga', created_at: daysAgo(9) },
        { id: 'p4', name: 'Sandal Rumah Anti-Slip', platform: 'Shopee', price: 'Rp45.000', category: 'Rumah Tangga', created_at: daysAgo(3) },
        { id: 'p5', name: 'Case HP Magnetic', platform: 'TikTok Shop', price: 'Rp38.000', category: 'Aksesoris', created_at: daysAgo(2) },
      ],
      video_jobs: [
        { id: 'v1', character_id: 'c1', product_id: 'p1', title: 'Siti × Serum Wajah Glow-C', current_step: 3, status: 'generating', frames_count: 6, time_label: '8 menit lalu', created_at: minsAgo(8) },
        { id: 'v2', character_id: 'c2', product_id: 'p2', title: 'Rangga × Kaos Oversize Basic', current_step: 2, status: 'review', frames_count: 5, time_label: '32 menit lalu', created_at: minsAgo(32) },
        { id: 'v3', character_id: 'c3', product_id: 'p3', title: 'Maya × Botol Minum Thermos 1L', current_step: 4, status: 'complete', frames_count: 8, time_label: '1 jam lalu', created_at: hoursAgo(1) },
        { id: 'v4', character_id: 'c1', product_id: 'p4', title: 'Siti × Sandal Rumah Anti-Slip', current_step: 1, status: 'draft', frames_count: 0, time_label: '2 jam lalu', created_at: hoursAgo(2) },
        { id: 'v5', character_id: 'c2', product_id: 'p5', title: 'Rangga × Case HP Magnetic', current_step: 4, status: 'complete', frames_count: 6, time_label: 'Kemarin, 19:40', created_at: hoursAgo(26) },
      ],
      frames: [],
      _seeded: true,
    };
  }

  function daysAgo(n){ return Date.now() - n*86400000; }
  function hoursAgo(n){ return Date.now() - n*3600000; }
  function minsAgo(n){ return Date.now() - n*60000; }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) { const s = seed(); save(s); return s; }
      return JSON.parse(raw);
    } catch (e) { const s = seed(); save(s); return s; }
  }

  function save(state) { localStorage.setItem(KEY, JSON.stringify(state)); }

  function uid(prefix) { return prefix + '_' + Math.random().toString(36).slice(2, 9); }

  let state = load();

  return {
    // ── Characters ──────────────────────
    getCharacters() { return [...state.characters].sort((a,b)=>b.created_at-a.created_at); },
    getCharacter(id) { return state.characters.find(c => c.id === id) || null; },
    addCharacter(data) {
      const rec = { id: uid('c'), status: 'active', video_count: 0, created_at: Date.now(), ...data };
      state.characters.unshift(rec); save(state); return rec;
    },

    // ── Products ─────────────────────────
    getProducts() { return [...state.products].sort((a,b)=>b.created_at-a.created_at); },
    getProduct(id) { return state.products.find(p => p.id === id) || null; },
    addProduct(data) {
      const rec = { id: uid('p'), created_at: Date.now(), ...data };
      state.products.unshift(rec); save(state); return rec;
    },

    // ── Video jobs ───────────────────────
    getVideoJobs() { return [...state.video_jobs].sort((a,b)=>b.created_at-a.created_at); },
    getVideoJob(id) { return state.video_jobs.find(v => v.id === id) || null; },
    addVideoJob(data) {
      const rec = { id: uid('v'), current_step: 1, status: 'draft', frames_count: 0, created_at: Date.now(), time_label: 'Baru saja', ...data };
      state.video_jobs.unshift(rec); save(state); return rec;
    },
    updateVideoJob(id, patch) {
      const idx = state.video_jobs.findIndex(v => v.id === id);
      if (idx === -1) return null;
      state.video_jobs[idx] = { ...state.video_jobs[idx], ...patch };
      save(state);
      return state.video_jobs[idx];
    },

    // ── Frames ───────────────────────────
    getFrames(videoJobId) { return state.frames.filter(f => f.video_job_id === videoJobId).sort((a,b)=>a.frame_number-b.frame_number); },
    setFrames(videoJobId, frames) {
      state.frames = state.frames.filter(f => f.video_job_id !== videoJobId);
      frames.forEach((f, i) => state.frames.push({ id: uid('f'), video_job_id: videoJobId, frame_number: i+1, status: 'pending', ...f }));
      save(state);
      return this.getFrames(videoJobId);
    },
    updateFrame(id, patch) {
      const idx = state.frames.findIndex(f => f.id === id);
      if (idx === -1) return null;
      state.frames[idx] = { ...state.frames[idx], ...patch };
      save(state);
      return state.frames[idx];
    },

    // ── Dashboard aggregates ─────────────
    stats() {
      const jobs = state.video_jobs;
      return {
        step1: jobs.filter(j => j.current_step === 1 && j.status !== 'complete').length,
        step2: jobs.filter(j => j.current_step === 2).length,
        step3: jobs.filter(j => j.current_step === 3).length,
        step4Ready: jobs.filter(j => j.current_step === 4 && j.status === 'review').length,
        doneThisWeek: jobs.filter(j => j.status === 'complete').length,
        todayCount: 9, // demo constant matching the approved dashboard hero
        targetCount: 50,
      };
    },

    _reset() { state = seed(); save(state); },
  };
})();
