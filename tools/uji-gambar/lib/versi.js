'use strict';
// Memeriksa bahwa folder core di komputer ini sudah versi yang dibutuhkan alat. Tanpa ini, core lama menghasilkan galat
// membingungkan ("... is not a function"). Pesan menyebut berkas mana yang perlu disalin ulang.
const PERLU = {
  'core\\src\\dna.js': ['validateDna', 'dnaToAppearance', 'dnaToProfile', 'buildFacePrompt', 'buildSheetPrompt', 'buildSheetGridPrompt', 'validateReference', 'HUBUNGAN', 'ANGLES', 'peringatanKonflik'],
  'core\\src\\imageRequest.js': ['buildImageRequest', 'storyboardImageRequest', 'parseImageResponse', 'describeError', 'DEFAULT_MODEL'],
  'core\\src\\consistency.js': ['checkPromptSet'],
  'core\\src\\storyboardPrompt.js': ['buildStoryboardPrompt'],
  'core\\src\\videoJson.js': ['buildVideoJson'],
  'core\\src\\planner.js': ['buildPanelPlan']
};
function cekCore(core) {
  const kurang = [];
  for (const [berkas, fungsi] of Object.entries(PERLU)) {
    const hilang = fungsi.filter(f => core == null || core[f] == null);
    if (hilang.length) kurang.push({ berkas, fungsi: hilang });
  }
  return { ok: kurang.length === 0, kurang };
}
function pesanCore(r) {
  if (r.ok) return 'Folder core sudah versi yang dibutuhkan.';
  return ['Folder core di komputer ini masih versi lama. Yang kurang:', ...r.kurang.map(k => `  - ${k.berkas}: ${k.fungsi.join(', ')}`),
    'Cara memperbaiki: salin folder core dari zip terbaru ke C:\\bam-ugc-v2\\core (pilih Timpa / Replace untuk berkas yang sama), lalu jalankan lagi. Pilihan menu 8 memeriksa ulang tanpa biaya.'].join('\n');
}
module.exports = { PERLU, cekCore, pesanCore };
