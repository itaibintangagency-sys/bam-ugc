/* ══════════════════════════════════════
   BA UGC — n8n webhook client
   Magnific (OmniHuman, Nano Banana, Video Combiner) TIDAK boleh dipanggil
   langsung dari browser — API key-nya bakal kelihatan siapa saja yang buka
   DevTools. Jalur amannya: browser -> webhook n8n -> Magnific.

   Isi N8N_WEBHOOK_BASE kalau webhook-nya sudah ada. Selama masih kosong,
   video-studio.html tetap jalan pakai simulasi setTimeout seperti sebelumnya
   — tidak ada yang rusak, ini cuma titik pasang begitu backend-nya siap.

   Kontrak yang diasumsikan di bawah ini (SILAKAN DIUBAH sesuai workflow n8n
   kamu yang sebenarnya — ini usulan awal, bukan spek yang sudah disepakati):

   POST {N8N_WEBHOOK_BASE}/generate-composite
     body: { job_id, character_id, product_id }
     response: { composite_image_url }

   POST {N8N_WEBHOOK_BASE}/generate-frame
     body: { frame_id, video_job_id, script, background_id }
     response: { clip_url, background_image_url }

   POST {N8N_WEBHOOK_BASE}/produce-video
     body: { job_id }
     response: { final_video_url }
   ══════════════════════════════════════ */

const N8N_WEBHOOK_BASE = ''; // contoh: 'https://n8n-crfkzibn5git.jkt3.sumopod.my.id/webhook/ba-ugc'
const N8N_READY = !!N8N_WEBHOOK_BASE;

async function n8nCall(path, payload) {
  if (!N8N_READY) throw new Error('N8N_WEBHOOK_BASE belum diisi di js/n8n-client.js');
  const res = await fetch(`${N8N_WEBHOOK_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Webhook n8n gagal (HTTP ${res.status})`);
  return res.json();
}
